import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getPendingCameraFtpEventId, reserveCameraFtpEventLifecycle } from "./cameraFtpRuntimeState";
import { getDatabase } from "../db/database";
import { getLogger } from "../utils/logger";
import { deleteCameraFtpReceiptsForEvent } from "./cameraFtpReceipts";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";
import {
  cleanupEventPurgeJournal,
  markEventPurgeDatabaseCommitted,
  prepareEventPurgeJournal,
  restoreEventPurgeJournal,
  stageEventPurgeJournal,
  type EventPurgeJournal,
  type EventPurgeTarget
} from "./eventPurgeJournal";
import { checkRepository } from "./repository";

export interface EventRow {
  id: string;
  name: string;
  slug: string;
  date: string;
  location: string;
  status: string;
  total_images: number;
  selected_images: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  name: string;
  slug?: string;
  date: string;
  location?: string;
}

export interface UpdateEventInput {
  name?: string;
  date?: string;
  location?: string;
}

export interface EventPurgeResult {
  eventId: string;
  eventName: string;
  workingPath: string;
  archivePath: string;
  includeArchive: boolean;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: {
    events: number;
    images: number;
    imageTags: number;
    downloadLogs: number;
    exportJobs: number;
    operationLogs: number;
    archivedEvents: number;
  };
}

/**
 * 生成活动 ID
 */
function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * 将中文名称转为 URL 友好的 slug
 */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || `event-${Date.now()}`;
}

/**
 * 获取当前时间戳字符串
 */
function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function writeEventOperationLog(eventId: string, type: string, detail: Record<string, unknown>): void {
  getDatabase().prepare(`
    INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
    VALUES (?, 'event', ?, '', '', ?, ?)
  `).run(type, eventId, JSON.stringify({ event_id: eventId, ...detail }), nowTimestamp());
}

function writePurgeFailureLog(eventId: string, detail: Record<string, unknown>): void {
  try {
    writeEventOperationLog(eventId, "event_purge_failed", detail);
  } catch (error) {
    getLogger().error({ error, eventId }, "活动永久删除失败日志写入失败");
  }
}

async function listArchivePathsForEvent(repositoryPath: string, event: EventRow): Promise<string[]> {
  const rows = getDatabase().prepare("SELECT archive_path FROM archived_events WHERE event_id = ?").all(event.id) as Array<{ archive_path: string }>;
  const paths = rows.map((row) => row.archive_path).filter(Boolean);
  const archiveRoot = path.join(repositoryPath, "archive");
  if (await fs.pathExists(archiveRoot)) {
    const names = await fs.readdir(archiveRoot);
    for (const name of names) {
      if (name === event.slug || name.startsWith(`${event.slug}_`)) {
        paths.push(path.join(archiveRoot, name));
      }
    }
  }
  return Array.from(new Set(paths));
}

function makePlaceholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function deleteByIds(table: string, column: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  return getDatabase().prepare(`DELETE FROM ${table} WHERE ${column} IN (${makePlaceholders(ids)})`).run(...ids).changes;
}

/**
 * 当前 FTP 接收活动的工作目录由 IIS 与 watcher 共同持有。
 * 在解除关联或切换到其他活动前，禁止归档、删除或永久清理该活动。
 */
export function assertEventNotActiveCameraFtp(eventId: string): void {
  if (eventId && (getConfig().cameraFtp.activeEventId === eventId || getPendingCameraFtpEventId() === eventId)) {
    throw {
      code: "FTP_EVENT_NOT_ALLOWED",
      message: "该活动当前正在接收相机 FTP 文件。请先在“图片导入 > 相机 FTP”中切换或解除 FTP 接收活动。"
    };
  }
}

/**
 * 获取活动列表
 */
export function listEvents(statusFilter?: string): EventRow[] {
  const db = getDatabase();
  if (statusFilter && statusFilter !== "all") {
    return db.prepare("SELECT * FROM events WHERE status = ? ORDER BY created_at DESC").all(statusFilter) as EventRow[];
  }
  return db.prepare("SELECT * FROM events WHERE status != 'deleted' ORDER BY created_at DESC").all() as EventRow[];
}

export function listDeletedEvents(): EventRow[] {
  return getDatabase().prepare("SELECT * FROM events WHERE status = 'deleted' ORDER BY updated_at DESC").all() as EventRow[];
}

/**
 * 获取单个活动
 */
export function getEventById(id: string): EventRow | undefined {
  const db = getDatabase();
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
}

/**
 * 创建新活动
 */
export function createEvent(input: CreateEventInput): { event: EventRow; workingDir: { created: boolean; path: string } } {
  const db = getDatabase();
  const logger = getLogger();
  const id = generateEventId();
  const slug = input.slug || nameToSlug(input.name);
  const now = nowTimestamp();

  // 检查 slug 是否唯一
  const existing = db.prepare("SELECT id FROM events WHERE slug = ?").get(slug);
  if (existing) {
    throw { code: "SLUG_CONFLICT", message: `slug "${slug}" 已被使用` };
  }

  // 尝试创建工作目录
  const workingDir = ensureEventWorkingDirs(slug);

  db.prepare(`
    INSERT INTO events (id, name, slug, date, location, status, total_images, selected_images, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)
  `).run(id, input.name, slug, input.date, input.location || "", now, now);

  logger.info({ id, slug, workingDir }, "新活动已创建");

  const event = getEventById(id)!;
  return { event, workingDir };
}

/**
 * 更新活动信息
 */
export function updateEvent(id: string, input: UpdateEventInput): EventRow | undefined {
  const db = getDatabase();
  const logger = getLogger();
  const now = nowTimestamp();

  const existing = getEventById(id);
  if (!existing) return undefined;

  const name = input.name ?? existing.name;
  const date = input.date ?? existing.date;
  const location = input.location ?? existing.location;

  db.prepare(`
    UPDATE events SET name = ?, date = ?, location = ?, updated_at = ? WHERE id = ?
  `).run(name, date, location, now, id);

  logger.info({ id }, "活动信息已更新");
  return getEventById(id);
}

/**
 * 更新活动状态
 */
export function updateEventStatus(id: string, status: string): EventRow | undefined {
  const db = getDatabase();
  const logger = getLogger();
  const now = nowTimestamp();

  const validStatuses = ["draft", "active", "reviewing", "archived", "deleted"];
  if (!validStatuses.includes(status)) {
    throw { code: "INVALID_STATUS", message: `无效的状态值: ${status}，允许的值: ${validStatuses.join(", ")}` };
  }

  const existing = getEventById(id);
  if (!existing) return undefined;

  if (status === "archived" || status === "deleted") {
    assertEventNotActiveCameraFtp(id);
  }

  db.prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);

  logger.info({ id, from: existing.status, to: status }, "活动状态已更新");
  return getEventById(id);
}

/**
 * 逻辑删除活动。
 *
 * 第一版不删除数据库记录、不删除工作区、不删除图片文件，只把活动状态标记为 deleted。
 */
export function deleteEvent(id: string): EventRow | undefined {
  return updateEventStatus(id, "deleted");
}

export function restoreEvent(id: string, status = "active"): EventRow | undefined {
  if (!["active", "draft"].includes(status)) {
    throw { code: "INVALID_RESTORE_STATUS", message: "活动只能恢复为 active 或 draft" };
  }

  const existing = getEventById(id);
  if (!existing) return undefined;
  if (existing.status !== "deleted") {
    throw { code: "EVENT_NOT_DELETED", message: "活动不在回收站中" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  writeEventOperationLog(id, "event_restored", {
    from: "deleted",
    to: status,
    event_name: existing.name
  });
  return getEventById(id);
}

export async function purgeEvent(id: string, input: { includeArchive?: boolean } = {}): Promise<EventPurgeResult> {
  assertEventNotActiveCameraFtp(id);
  const releaseReservation = reserveCameraFtpEventLifecycle(id, "活动永久删除");
  try {
    assertEventNotActiveCameraFtp(id);
    return await purgeEventInternal(id, input);
  } finally {
    releaseReservation();
  }
}

async function purgeEventInternal(id: string, input: { includeArchive?: boolean } = {}): Promise<EventPurgeResult> {
  const existing = getEventById(id);
  if (!existing) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (existing.status !== "deleted") {
    throw { code: "EVENT_NOT_DELETED", message: "只能永久删除回收站中的活动" };
  }
  assertEventNotActiveCameraFtp(id);

  const repoPath = getConfig().repository.path;
  const repositoryStatus = checkRepository(repoPath);
  if (!repositoryStatus.path || !repositoryStatus.exists || !repositoryStatus.readable || !repositoryStatus.writable) {
    throw { code: "REPOSITORY_NOT_READY", message: "仓库路径不可用，无法安全永久删除活动" };
  }

  const workspace = getEventWorkspacePaths(repositoryStatus.path, existing.slug);
  const archivePath = path.join(repositoryStatus.path, "archive", existing.slug);
  const includeArchive = input.includeArchive !== false;
  const archivePaths = includeArchive ? await listArchivePathsForEvent(repositoryStatus.path, existing) : [archivePath];
  const deletedFiles: string[] = [];
  let missingFiles: string[] = [];
  const errors: string[] = [];

  const imageCount = (getDatabase().prepare("SELECT COUNT(*) AS count FROM images WHERE event_id = ?").get(existing.id) as { count: number }).count;
  const purgeDetail = {
    event_name: existing.name,
    event_slug: existing.slug,
    image_count: imageCount,
    working_path: workspace.eventDir,
    archive_path: archivePath,
    archive_paths: archivePaths,
    include_archive: includeArchive
  };
  writeEventOperationLog(existing.id, "event_purge_started", purgeDetail);

  const purgeTargets: EventPurgeTarget[] = [
    { targetPath: workspace.eventDir, root: "working" },
    ...(includeArchive
      ? archivePaths.map((targetPath) => ({ targetPath, root: "archive" as const }))
      : [])
  ];
  let journal: EventPurgeJournal | null = null;
  try {
    const prepared = await prepareEventPurgeJournal(
      repositoryStatus.path,
      existing.id,
      purgeTargets
    );
    journal = prepared.journal;
    missingFiles = prepared.missingFiles;
    if (journal) await stageEventPurgeJournal(journal);
  } catch (error: any) {
    const rollbackErrors = journal ? await restoreEventPurgeJournal(journal) : [];
    writePurgeFailureLog(existing.id, {
      ...purgeDetail,
      stage: "stage_files",
      error_code: error?.code || "EVENT_PURGE_FILE_STAGE_FAILED",
      rollback_errors: rollbackErrors
    });
    throw {
      code: rollbackErrors.length > 0 ? "EVENT_PURGE_STAGE_ROLLBACK_FAILED" : (error?.code || "EVENT_PURGE_FILE_STAGE_FAILED"),
      message: rollbackErrors.length > 0
        ? `活动目录隔离失败，且部分目录未能恢复：${rollbackErrors[0]}`
        : `活动目录隔离失败，数据库未修改：${error?.message || "无法移动活动目录"}`,
      details: { rollbackErrors }
    };
  }

  let deletedRecords: {
    deletedImageTags: number;
    deletedDownloadLogs: number;
    deletedExportJobs: number;
    deletedOperationLogs: number;
    deletedImages: number;
    deletedArchivedEvents: number;
    deletedEvents: number;
  };
  try {
    const db = getDatabase();
    const imageIds = (db.prepare("SELECT id FROM images WHERE event_id = ?").all(existing.id) as Array<{ id: string }>).map((row) => row.id);
    const exportJobIds = (db.prepare("SELECT id FROM export_jobs WHERE event_id = ?").all(existing.id) as Array<{ id: string }>).map((row) => row.id);
    const operationTargetIds = Array.from(new Set([existing.id, ...imageIds, ...exportJobIds]));
    const deleteDatabaseRecords = db.transaction(() => {
      writeEventOperationLog(existing.id, "event_purged", {
        ...purgeDetail,
        staged_paths: journal
          ? purgeTargets
            .map((target) => path.resolve(target.targetPath))
            .filter((targetPath) => !missingFiles.some((missingPath) => path.resolve(missingPath) === targetPath))
          : [],
        missing_files: missingFiles
      });
      const deletedImageTags = deleteByIds("image_tags", "image_id", imageIds);
      const deletedDownloadLogs = imageIds.length > 0
        ? db.prepare(`DELETE FROM download_logs WHERE event_id = ? OR image_id IN (${makePlaceholders(imageIds)})`).run(existing.id, ...imageIds).changes
        : db.prepare("DELETE FROM download_logs WHERE event_id = ?").run(existing.id).changes;
      const deletedExportJobs = db.prepare("DELETE FROM export_jobs WHERE event_id = ?").run(existing.id).changes;
      const deletedOperationLogsByTarget = deleteByIds("operation_logs", "target_id", operationTargetIds);
      const deletedOperationLogsByDetail = db.prepare("DELETE FROM operation_logs WHERE detail LIKE ?").run(`%"event_id":"${existing.id}"%`).changes;
      deleteCameraFtpReceiptsForEvent(existing.id);
      const deletedImages = db.prepare("DELETE FROM images WHERE event_id = ?").run(existing.id).changes;
      const deletedArchivedEvents = db.prepare("DELETE FROM archived_events WHERE event_id = ?").run(existing.id).changes;
      const deletedEvents = db.prepare("DELETE FROM events WHERE id = ?").run(existing.id).changes;
      return {
        deletedImageTags,
        deletedDownloadLogs,
        deletedExportJobs,
        deletedOperationLogs: deletedOperationLogsByTarget + deletedOperationLogsByDetail,
        deletedImages,
        deletedArchivedEvents,
        deletedEvents
      };
    });
    deletedRecords = deleteDatabaseRecords();
  } catch (error: any) {
    const rollbackErrors = journal ? await restoreEventPurgeJournal(journal) : [];
    writePurgeFailureLog(existing.id, {
      ...purgeDetail,
      stage: "delete_database_records",
      error_code: error?.code || "EVENT_PURGE_DATABASE_FAILED",
      rollback_errors: rollbackErrors
    });
    throw {
      code: rollbackErrors.length > 0 ? "EVENT_PURGE_DATABASE_ROLLBACK_FAILED" : "EVENT_PURGE_DATABASE_FAILED",
      message: rollbackErrors.length > 0
        ? `活动数据库清理失败，且部分目录未能恢复：${rollbackErrors[0]}`
        : "活动数据库清理失败，活动目录已恢复，未永久删除文件。",
      details: { rollbackErrors }
    };
  }

  if (journal) {
    let commitMarkerError: unknown = null;
    try {
      await markEventPurgeDatabaseCommitted(journal);
    } catch (error) {
      // SQLite is already committed and remains the recovery authority. Keep
      // the immutable journal and continue cleanup; a missing phase marker is
      // only user-visible if file cleanup also remains pending.
      commitMarkerError = error;
      getLogger().warn({ error, eventId: existing.id }, "活动永久删除提交阶段标记写入失败，继续按不可变恢复日志清理");
    }
    const cleanup = await cleanupEventPurgeJournal(journal);
    deletedFiles.push(...cleanup.deletedFiles);
    errors.push(...cleanup.errors);
    if (commitMarkerError && cleanup.errors.length > 0) {
      errors.push("数据库已清理，但永久删除阶段标记写入失败；恢复日志仍保留，下次启动将按数据库状态重试。");
    }
  }

  return {
    eventId: existing.id,
    eventName: existing.name,
    workingPath: workspace.eventDir,
    archivePath,
    includeArchive,
    deletedFiles,
    missingFiles,
    errors,
    deletedRecords: {
      events: deletedRecords.deletedEvents,
      images: deletedRecords.deletedImages,
      imageTags: deletedRecords.deletedImageTags,
      downloadLogs: deletedRecords.deletedDownloadLogs,
      exportJobs: deletedRecords.deletedExportJobs,
      operationLogs: deletedRecords.deletedOperationLogs,
      archivedEvents: deletedRecords.deletedArchivedEvents
    }
  };
}
