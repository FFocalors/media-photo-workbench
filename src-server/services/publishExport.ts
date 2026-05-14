import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { emitExportCreated } from "../realtime/socket";
import { getLogger } from "../utils/logger";
import { createZipArchive, ZipFileEntry } from "../utils/zip";
import { getEventById } from "./events";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";
import { ImageRow } from "./images";

export type PublishExportMode = "selected" | "publish" | "edited" | "rating";
export type PublishExportSize = "original" | "3000px" | "1920px";
export type PublishExportFilenameMode = "original" | "event_original" | "sequence";

export interface PublishExportInput {
  eventId: string;
  mode: PublishExportMode;
  imageIds?: string[];
  ratingMin?: number;
  size: PublishExportSize;
  quality: number;
  filenameMode?: PublishExportFilenameMode;
  limitFileSize10Mb?: boolean;
  baseUrl: string;
}

export interface PublishExportError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface PublishExportResult {
  jobId: string;
  eventId: string;
  mode: PublishExportMode;
  size: PublishExportSize;
  quality: number;
  filenameMode: PublishExportFilenameMode;
  limitFileSize10Mb: boolean;
  status: "success" | "failed";
  total: number;
  success: number;
  failed: number;
  outputDir: string;
  zipPath: string;
  downloadUrl: string;
  errors: PublishExportError[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishExportDownload {
  jobId: string;
  eventId: string;
  filePath: string;
  filename: string;
}

interface ExportJobRow {
  id: string;
  event_id: string;
  type: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  spec: string;
  quality: number;
  total: number;
  finished: number;
  success_count: number;
  failed_count: number;
  output_path: string;
  operator: string;
  created_at: string;
  updated_at: string;
}

interface ExportSourceImage {
  row: ImageRow;
  sourcePath: string;
  sourceType: "edited" | "original";
}

interface ExportWriteResult {
  fileSize: number;
  finalQuality: number;
  finalMaxSide: number | null;
  fileSizeLimitApplied: boolean;
  constrained: boolean;
}

const EXPORT_MODES: PublishExportMode[] = ["selected", "publish", "edited", "rating"];
const EXPORT_SIZES: PublishExportSize[] = ["original", "3000px", "1920px"];
const FILENAME_MODES: PublishExportFilenameMode[] = ["original", "event_original", "sequence"];
const EXPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const EXPORT_MIN_QUALITY = 35;
const EXPORT_MIN_LONG_EDGE = 640;

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateExportId(): string {
  return `export_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function formatDateForFilename(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeFilename(value: string): string {
  return (value || "image")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

function loadSharp(): any {
  try {
    return require("sharp");
  } catch {
    throw { code: "MISSING_IMAGE_PROCESSOR", message: "缺少 sharp 依赖，无法导出发布图" };
  }
}

function writeOperationLog(input: {
  type: string;
  targetType: string;
  targetId: string;
  eventId: string;
  detail: Record<string, unknown>;
}): void {
  getDatabase().prepare(`
    INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
    VALUES (?, ?, ?, '', '', ?, ?)
  `).run(
    input.type,
    input.targetType,
    input.targetId,
    JSON.stringify({ event_id: input.eventId, ...input.detail }),
    nowTimestamp()
  );
}

function ensureEventReady(eventId: string) {
  const event = getEventById(eventId);
  if (!event) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (event.status === "archived" || event.status === "deleted") {
    throw { code: "EVENT_NOT_EXPORTABLE", message: "归档或删除状态的活动不能导出发布图" };
  }
  return event;
}

function validateInput(input: PublishExportInput): Required<Pick<PublishExportInput, "mode" | "size" | "quality">> & {
  filenameMode: PublishExportFilenameMode;
  ratingMin: number;
  limitFileSize10Mb: boolean;
} {
  if (!EXPORT_MODES.includes(input.mode)) {
    throw { code: "INVALID_EXPORT_MODE", message: "无效的导出来源" };
  }
  if (!EXPORT_SIZES.includes(input.size)) {
    throw { code: "INVALID_EXPORT_SIZE", message: "无效的导出规格" };
  }
  if (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 100) {
    throw { code: "INVALID_EXPORT_QUALITY", message: "JPEG 质量必须是 1-100 的整数" };
  }

  const filenameMode = input.filenameMode ?? "sequence";
  if (!FILENAME_MODES.includes(filenameMode)) {
    throw { code: "INVALID_FILENAME_MODE", message: "无效的文件命名规则" };
  }

  const ratingMin = input.mode === "rating" ? Math.max(1, Math.min(5, Number(input.ratingMin) || 4)) : 4;
  return {
    mode: input.mode,
    size: input.size,
    quality: input.quality,
    filenameMode,
    ratingMin,
    limitFileSize10Mb: input.limitFileSize10Mb === true
  };
}

function getRowsByMode(input: PublishExportInput, ratingMin: number): { rows: ImageRow[]; errors: PublishExportError[] } {
  const db = getDatabase();
  const errors: PublishExportError[] = [];

  if (input.mode === "selected") {
    const ids = Array.from(new Set((input.imageIds ?? []).filter((id) => typeof id === "string" && id.trim())));
    if (ids.length === 0) {
      throw { code: "NO_EXPORT_IMAGES", message: "请至少选择一张图片用于导出" };
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT * FROM images
      WHERE event_id = ? AND is_deleted = 0 AND id IN (${placeholders})
    `).all(input.eventId, ...ids) as ImageRow[];
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const orderedRows: ImageRow[] = [];
    for (const id of ids) {
      const row = rowMap.get(id);
      if (row) {
        orderedRows.push(row);
      } else {
        errors.push({ imageId: id, filename: id, reason: "图片不存在或已删除，已跳过" });
      }
    }
    return { rows: orderedRows, errors };
  }

  if (input.mode === "publish") {
    return {
      rows: db.prepare(`
        SELECT * FROM images
        WHERE event_id = ? AND is_deleted = 0 AND status = 'publish'
        ORDER BY updated_at DESC, id ASC
      `).all(input.eventId) as ImageRow[],
      errors
    };
  }

  if (input.mode === "edited") {
    return {
      rows: db.prepare(`
        SELECT * FROM images
        WHERE event_id = ? AND is_deleted = 0 AND status = 'edited'
        ORDER BY updated_at DESC, id ASC
      `).all(input.eventId) as ImageRow[],
      errors
    };
  }

  return {
    rows: db.prepare(`
      SELECT * FROM images
      WHERE event_id = ? AND is_deleted = 0 AND rating >= ?
      ORDER BY rating DESC, updated_at DESC, id ASC
    `).all(input.eventId, ratingMin) as ImageRow[],
    errors
  };
}

function getExportSource(row: ImageRow): ExportSourceImage | null {
  if (row.edited_path && fs.existsSync(row.edited_path)) {
    return { row, sourcePath: row.edited_path, sourceType: "edited" };
  }
  if (row.original_path && fs.existsSync(row.original_path)) {
    return { row, sourcePath: row.original_path, sourceType: "original" };
  }
  return null;
}

function buildOutputFilename(input: {
  row: ImageRow;
  eventSlug: string;
  index: number;
  total: number;
  filenameMode: PublishExportFilenameMode;
  usedNames: Set<string>;
}): string {
  const originalBase = path.parse(sanitizeFilename(input.row.original_filename)).name || input.row.id;
  const sequence = String(input.index + 1).padStart(Math.max(3, String(input.total).length), "0");
  const base = input.filenameMode === "original"
    ? originalBase
    : input.filenameMode === "event_original"
      ? `${sanitizeFilename(input.eventSlug)}_${originalBase}`
      : `${sequence}_${originalBase}`;

  let candidate = `${base}.jpg`;
  let suffix = 2;
  while (input.usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}_${suffix}.jpg`;
    suffix += 1;
  }
  input.usedNames.add(candidate.toLowerCase());
  return candidate;
}

function getConfiguredMaxSide(size: PublishExportSize): number | null {
  return size === "3000px" ? 3000 : size === "1920px" ? 1920 : null;
}

async function getSourceLongEdge(sourcePath: string): Promise<number | null> {
  const sharp = loadSharp();
  const metadata = await sharp(sourcePath).metadata();
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  const longEdge = Math.max(width, height);
  return longEdge > 0 ? longEdge : null;
}

async function getFileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function renderJpeg(input: {
  sourcePath: string;
  outputPath: string;
  quality: number;
  maxSide: number | null;
}): Promise<void> {
  const sharp = loadSharp();
  let pipeline = sharp(input.sourcePath).rotate();
  if (input.maxSide) {
    pipeline = pipeline.resize({ width: input.maxSide, height: input.maxSide, fit: "inside", withoutEnlargement: true });
  }
  await pipeline.jpeg({ quality: input.quality }).toFile(input.outputPath);
}

async function writeExportImage(input: {
  sourcePath: string;
  outputPath: string;
  size: PublishExportSize;
  quality: number;
  limitFileSize10Mb: boolean;
}): Promise<ExportWriteResult> {
  await fs.ensureDir(path.dirname(input.outputPath));

  const fileSizeLimitApplied = input.limitFileSize10Mb;
  const configuredMaxSide = getConfiguredMaxSide(input.size);

  if (input.size === "original") {
    const sourceFileSize = await getFileSize(input.sourcePath);
    if (!fileSizeLimitApplied || sourceFileSize <= EXPORT_MAX_FILE_SIZE_BYTES) {
      await fs.copy(input.sourcePath, input.outputPath, { overwrite: false, errorOnExist: true });
      return {
        fileSize: sourceFileSize,
        finalQuality: input.quality,
        finalMaxSide: null,
        fileSizeLimitApplied,
        constrained: false
      };
    }
  }

  let quality = input.quality;
  let maxSide = configuredMaxSide;
  await renderJpeg({ sourcePath: input.sourcePath, outputPath: input.outputPath, quality, maxSide });
  let fileSize = await getFileSize(input.outputPath);
  if (!fileSizeLimitApplied || fileSize <= EXPORT_MAX_FILE_SIZE_BYTES) {
    return {
      fileSize,
      finalQuality: quality,
      finalMaxSide: maxSide,
      fileSizeLimitApplied,
      constrained: false
    };
  }

  let constrained = false;
  const minimumAttemptQuality = Math.min(input.quality, EXPORT_MIN_QUALITY);
  for (quality = input.quality - 5; quality >= minimumAttemptQuality; quality -= 5) {
    await renderJpeg({ sourcePath: input.sourcePath, outputPath: input.outputPath, quality, maxSide });
    fileSize = await getFileSize(input.outputPath);
    constrained = true;
    if (fileSize <= EXPORT_MAX_FILE_SIZE_BYTES) {
      return {
        fileSize,
        finalQuality: quality,
        finalMaxSide: maxSide,
        fileSizeLimitApplied,
        constrained
      };
    }
  }

  quality = minimumAttemptQuality;
  const sourceLongEdge = await getSourceLongEdge(input.sourcePath);
  maxSide = maxSide ?? sourceLongEdge ?? 3000;
  while (maxSide > EXPORT_MIN_LONG_EDGE) {
    maxSide = Math.max(EXPORT_MIN_LONG_EDGE, Math.floor(maxSide * 0.9));
    await renderJpeg({ sourcePath: input.sourcePath, outputPath: input.outputPath, quality, maxSide });
    fileSize = await getFileSize(input.outputPath);
    constrained = true;
    if (fileSize <= EXPORT_MAX_FILE_SIZE_BYTES) {
      return {
        fileSize,
        finalQuality: quality,
        finalMaxSide: maxSide,
        fileSizeLimitApplied,
        constrained
      };
    }
  }

  if (fileSize > EXPORT_MAX_FILE_SIZE_BYTES) {
    throw new Error("导出文件超过 10MB，自动压缩后仍无法满足平台限制");
  }

  return {
    fileSize,
    finalQuality: quality,
    finalMaxSide: maxSide,
    fileSizeLimitApplied,
    constrained
  };
}

function insertExportJob(input: {
  jobId: string;
  eventId: string;
  status: "running" | "success" | "failed";
  spec: Record<string, unknown>;
  quality: number;
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  outputPath: string;
  now: string;
}): void {
  getDatabase().prepare(`
    INSERT INTO export_jobs (
      id, event_id, type, status, spec, quality, total, finished,
      success_count, failed_count, output_path, operator, created_at, updated_at
    )
    VALUES (?, ?, 'publish', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(
    input.jobId,
    input.eventId,
    input.status,
    JSON.stringify(input.spec),
    input.quality,
    input.total,
    input.finished,
    input.successCount,
    input.failedCount,
    input.outputPath,
    input.now,
    input.now
  );
}

function updateExportJob(input: {
  jobId: string;
  status: "success" | "failed";
  spec: Record<string, unknown>;
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  outputPath: string;
}): void {
  getDatabase().prepare(`
    UPDATE export_jobs
    SET status = ?, spec = ?, total = ?, finished = ?, success_count = ?, failed_count = ?, output_path = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.status,
    JSON.stringify(input.spec),
    input.total,
    input.finished,
    input.successCount,
    input.failedCount,
    input.outputPath,
    nowTimestamp(),
    input.jobId
  );
}

function rowToResult(row: ExportJobRow, baseUrl: string): PublishExportResult {
  let spec: any = {};
  try {
    spec = JSON.parse(row.spec || "{}");
  } catch {
    spec = {};
  }

  return {
    jobId: row.id,
    eventId: row.event_id,
    mode: spec.mode ?? "selected",
    size: spec.size ?? "original",
    quality: row.quality,
    filenameMode: spec.filenameMode ?? "sequence",
    limitFileSize10Mb: spec.limitFileSize10Mb === true,
    status: row.status === "success" ? "success" : "failed",
    total: row.total,
    success: row.success_count,
    failed: row.failed_count,
    outputDir: spec.outputDir ?? "",
    zipPath: row.output_path,
    downloadUrl: `${baseUrl}/api/exports/${encodeURIComponent(row.id)}/download`,
    errors: Array.isArray(spec.errors) ? spec.errors : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createPublishExport(input: PublishExportInput): Promise<PublishExportResult> {
  const event = ensureEventReady(input.eventId);
  const normalized = validateInput(input);
  ensureEventWorkingDirs(event.slug);

  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  const timestamp = formatDateForFilename();
  const jobId = generateExportId();
  const outputDir = path.join(workspace.publishExportDir, timestamp);
  const zipPath = path.join(workspace.zipExportDir, `publish_${sanitizeFilename(event.slug)}_${timestamp}_${jobId}.zip`);
  const startedAt = nowTimestamp();

  await fs.ensureDir(outputDir);
  await fs.ensureDir(workspace.zipExportDir);

  const selection = getRowsByMode(input, normalized.ratingMin);
  const initialSpec = {
    mode: normalized.mode,
    size: normalized.size,
    limitFileSize10Mb: normalized.limitFileSize10Mb,
    filenameMode: normalized.filenameMode,
    ratingMin: normalized.ratingMin,
    outputDir,
    zipPath,
    errors: selection.errors
  };

  insertExportJob({
    jobId,
    eventId: event.id,
    status: "running",
    spec: initialSpec,
    quality: normalized.quality,
    total: selection.rows.length + selection.errors.length,
    finished: 0,
    successCount: 0,
    failedCount: selection.errors.length,
    outputPath: zipPath,
    now: startedAt
  });
  writeOperationLog({
    type: "publish_export_started",
    targetType: "export",
    targetId: jobId,
    eventId: event.id,
    detail: initialSpec
  });

  const errors = [...selection.errors];
  const exportedEntries: ZipFileEntry[] = [];
  const usedNames = new Set<string>();
  let success = 0;

  try {
    if (selection.rows.length === 0) {
      if (errors.length > 0) {
        const finalSpec = {
          ...initialSpec,
          errors
        };
        updateExportJob({
          jobId,
          status: "failed",
          spec: finalSpec,
          total: errors.length,
          finished: errors.length,
          successCount: 0,
          failedCount: errors.length,
          outputPath: ""
        });
        writeOperationLog({
          type: "publish_export_failed",
          targetType: "export",
          targetId: jobId,
          eventId: event.id,
          detail: {
            ...finalSpec,
            success: 0,
            failed: errors.length
          }
        });
        return getPublishExportJob(jobId, input.baseUrl);
      }
      throw { code: "NO_EXPORT_IMAGES", message: "当前导出条件下没有可导出的图片" };
    }

    for (let index = 0; index < selection.rows.length; index += 1) {
      const row = selection.rows[index];
      const source = getExportSource(row);
      if (!source) {
        errors.push({
          imageId: row.id,
          filename: row.original_filename,
          reason: "原图和已修图都不存在，已跳过"
        });
        continue;
      }

      const outputFilename = buildOutputFilename({
        row,
        eventSlug: event.slug,
        index,
        total: selection.rows.length,
        filenameMode: normalized.filenameMode,
        usedNames
      });
      const outputPath = path.join(outputDir, outputFilename);
      const writeResult = await writeExportImage({
        sourcePath: source.sourcePath,
        outputPath,
        size: normalized.size,
        quality: normalized.quality,
        limitFileSize10Mb: normalized.limitFileSize10Mb
      });
      exportedEntries.push({ name: outputFilename, path: outputPath });
      success += 1;

      writeOperationLog({
        type: "publish_image_exported",
        targetType: "image",
        targetId: row.id,
        eventId: event.id,
        detail: {
          export_job_id: jobId,
          source_type: source.sourceType,
          source_path: source.sourcePath,
          output_path: outputPath,
          size: normalized.size,
          quality: normalized.quality,
          file_size: writeResult.fileSize,
          final_quality: writeResult.finalQuality,
          final_max_side: writeResult.finalMaxSide,
          file_size_limit_applied: writeResult.fileSizeLimitApplied,
          constrained_for_platform: writeResult.constrained
        }
      });
    }

    if (exportedEntries.length === 0) {
      const finalSpec = {
        ...initialSpec,
        errors
      };
      updateExportJob({
        jobId,
        status: "failed",
        spec: finalSpec,
        total: selection.rows.length + selection.errors.length,
        finished: errors.length,
        successCount: 0,
        failedCount: errors.length,
        outputPath: ""
      });
      writeOperationLog({
        type: "publish_export_failed",
        targetType: "export",
        targetId: jobId,
        eventId: event.id,
        detail: {
          ...finalSpec,
          success: 0,
          failed: errors.length
        }
      });
      return getPublishExportJob(jobId, input.baseUrl);
    }

    await createZipArchive(exportedEntries, zipPath);

    const finalSpec = {
      ...initialSpec,
      errors,
      exportedFiles: exportedEntries.map((entry) => entry.name)
    };
    const failed = errors.length;
    updateExportJob({
      jobId,
      status: "success",
      spec: finalSpec,
      total: selection.rows.length + selection.errors.length,
      finished: success + failed,
      successCount: success,
      failedCount: failed,
      outputPath: zipPath
    });
    writeOperationLog({
      type: "publish_export_completed",
      targetType: "export",
      targetId: jobId,
      eventId: event.id,
      detail: {
        ...finalSpec,
        success,
        failed
      }
    });

    const result = getPublishExportJob(jobId, input.baseUrl);
    emitExportCreated({
      eventId: event.id,
      jobId,
      status: "success",
      action: "publish_export_created",
      updatedAt: nowIso(),
      exportJob: result
    });
    return result;
  } catch (err: any) {
    const failedError = {
      filename: jobId,
      reason: err?.message || "发布导出失败"
    };
    const finalErrors = [...errors, failedError];
    const finalSpec = {
      ...initialSpec,
      errors: finalErrors
    };
    updateExportJob({
      jobId,
      status: "failed",
      spec: finalSpec,
      total: selection.rows.length + selection.errors.length,
      finished: success + finalErrors.length,
      successCount: success,
      failedCount: finalErrors.length,
      outputPath: zipPath
    });
    writeOperationLog({
      type: "publish_export_failed",
      targetType: "export",
      targetId: jobId,
      eventId: event.id,
      detail: {
        ...finalSpec,
        success,
        failed: finalErrors.length
      }
    });
    getLogger().error({ err, eventId: event.id, jobId }, "发布导出失败");
    throw err?.code ? err : { code: "PUBLISH_EXPORT_FAILED", message: err?.message || "发布导出失败" };
  }
}

export function getPublishExportJob(jobId: string, baseUrl: string): PublishExportResult {
  const row = getDatabase().prepare(`
    SELECT * FROM export_jobs
    WHERE id = ? AND type = 'publish'
  `).get(jobId) as ExportJobRow | undefined;
  if (!row) {
    throw { code: "EXPORT_JOB_NOT_FOUND", message: "导出任务不存在" };
  }
  return rowToResult(row, baseUrl);
}

export function assertPublishExportDownload(jobId: string): PublishExportDownload {
  const row = getDatabase().prepare(`
    SELECT * FROM export_jobs
    WHERE id = ? AND type = 'publish'
  `).get(jobId) as ExportJobRow | undefined;
  if (!row) {
    throw { code: "EXPORT_JOB_NOT_FOUND", message: "导出任务不存在" };
  }
  if (row.status !== "success" || !row.output_path || !fs.existsSync(row.output_path)) {
    throw { code: "EXPORT_FILE_NOT_FOUND", message: "导出 ZIP 文件不存在" };
  }
  return {
    jobId: row.id,
    eventId: row.event_id,
    filePath: row.output_path,
    filename: path.basename(row.output_path)
  };
}

export function recordPublishExportDownload(download: PublishExportDownload): void {
  const now = nowTimestamp();
  getDatabase().prepare(`
    INSERT INTO download_logs (image_id, event_id, type, operator, device, file_path, created_at)
    VALUES ('', ?, 'export', '', '', ?, ?)
  `).run(download.eventId, download.filePath, now);

  writeOperationLog({
    type: "publish_export_downloaded",
    targetType: "export",
    targetId: download.jobId,
    eventId: download.eventId,
    detail: { file_path: download.filePath }
  });
}
