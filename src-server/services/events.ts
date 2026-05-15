import crypto from "crypto";
import { promises as nativeFs } from "fs";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { getLogger } from "../utils/logger";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";
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

async function makeWritableRecursive(targetPath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.lstat(targetPath);
  } catch {
    return;
  }

  try {
    await fs.chmod(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Windows/OneDrive may keep some entries locked; deletion will surface final errors.
  }

  if (!stat.isDirectory()) return;

  let entries: string[];
  try {
    entries = await fs.readdir(targetPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    await makeWritableRecursive(path.join(targetPath, entry));
  }
}

async function removeDirectoryIfExists(targetPath: string, missingFiles: string[], errors: string[], deletedFiles: string[]): Promise<void> {
  if (!targetPath || !(await fs.pathExists(targetPath))) {
    missingFiles.push(targetPath);
    return;
  }

  try {
    await makeWritableRecursive(targetPath);
    await nativeFs.rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 400
    });
    deletedFiles.push(targetPath);
  } catch (err: any) {
    errors.push(`${targetPath}: ${err?.message || "删除失败"}`);
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
  const existing = getEventById(id);
  if (!existing) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (existing.status !== "deleted") {
    throw { code: "EVENT_NOT_DELETED", message: "只能永久删除回收站中的活动" };
  }

  const repoPath = getConfig().repository.path;
  const repositoryStatus = checkRepository(repoPath);
  if (!repositoryStatus.path || !repositoryStatus.exists || !repositoryStatus.readable || !repositoryStatus.writable) {
    throw { code: "REPOSITORY_NOT_READY", message: "仓库路径不可用，无法安全永久删除活动" };
  }

  const workspace = getEventWorkspacePaths(repositoryStatus.path, existing.slug);
  const archivePath = path.join(repositoryStatus.path, "archive", existing.slug);
  const includeArchive = input.includeArchive === true;
  const deletedFiles: string[] = [];
  const missingFiles: string[] = [];
  const errors: string[] = [];

  const imageCount = (getDatabase().prepare("SELECT COUNT(*) AS count FROM images WHERE event_id = ?").get(existing.id) as { count: number }).count;
  const purgeDetail = {
    event_name: existing.name,
    event_slug: existing.slug,
    image_count: imageCount,
    working_path: workspace.eventDir,
    archive_path: archivePath,
    include_archive: includeArchive
  };
  writeEventOperationLog(existing.id, "event_purge_started", purgeDetail);

  await removeDirectoryIfExists(workspace.eventDir, missingFiles, errors, deletedFiles);
  if (includeArchive) {
    await removeDirectoryIfExists(archivePath, missingFiles, errors, deletedFiles);
  }

  if (errors.length > 0) {
    writeEventOperationLog(existing.id, "event_purge_failed", {
      ...purgeDetail,
      errors
    });
    throw {
      code: "EVENT_PURGE_FILE_FAILED",
      message: `活动文件删除未完成：${errors[0]}`
    };
  }

  writeEventOperationLog(existing.id, "event_purged", {
    ...purgeDetail,
    deleted_files: deletedFiles,
    missing_files: missingFiles
  });

  const db = getDatabase();
  const deletedImages = db.prepare("DELETE FROM images WHERE event_id = ?").run(existing.id).changes;
  const deletedEvents = db.prepare("DELETE FROM events WHERE id = ?").run(existing.id).changes;

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
      events: deletedEvents,
      images: deletedImages
    }
  };
}
