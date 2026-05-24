import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { actorToLogColumns, HOST_ACTOR, normalizeActor, type ActorInfo } from "../utils/actor";
import { safeLog } from "../utils/logger";
import { getEventById } from "./events";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";

export type ImportSourceType = "host_import" | "client_upload";

export interface ImportScanFile {
  filename: string;
  path: string;
  size: number;
  extension: string;
}

export interface ImportSourceFile {
  filename: string;
  path: string;
  size: number;
  mimeType?: string;
}

export interface ImportScanResult {
  eventId: string;
  folderPath: string;
  count: number;
  totalSize: number;
  files: ImportScanFile[];
}

export interface ImportErrorItem {
  filename: string;
  path: string;
  reason: string;
}

export interface ImportedImageSummary {
  id: string;
  originalFilename: string;
  storedFilename: string;
  originalPath: string;
  thumbPath: string;
  previewPath: string;
}

export interface ImportStartResult {
  eventId: string;
  folderPath: string;
  sourceType: ImportSourceType;
  photographer: string;
  device: string;
  remark: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  imported: ImportedImageSummary[];
  errors: ImportErrorItem[];
}

export interface ImportProgressSnapshot {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  errors: ImportErrorItem[];
  currentFileName: string;
  importedCount: number;
  totalBytes: number;
  processedBytes: number;
}

export interface ImportImageFilesOptions {
  concurrency?: number;
  maxErrors?: number;
  isCancelled?: () => boolean;
  onProgress?: (snapshot: ImportProgressSnapshot) => void;
  onImageImported?: (image: ImportedImageSummary) => void | Promise<void>;
}

interface ExifInfo {
  shotAt: string;
  cameraModel: string;
  lensModel: string;
}

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const SUPPORTED_FORMAT_LABEL = "JPG/JPEG/PNG";

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function generateImageId(): string {
  return `img_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_");
}

function formatDateForFilename(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function assertFolder(folderPath: string): Promise<void> {
  if (!folderPath || typeof folderPath !== "string") {
    throw { code: "INVALID_FOLDER_PATH", message: "folderPath 必须是非空字符串" };
  }

  let stat;
  try {
    stat = await fs.stat(folderPath);
  } catch {
    throw { code: "FOLDER_NOT_FOUND", message: `文件夹不存在：${folderPath}` };
  }

  if (!stat.isDirectory()) {
    throw { code: "NOT_A_DIRECTORY", message: `路径不是文件夹：${folderPath}` };
  }
}

async function listSupportedImageFiles(folderPath: string): Promise<ImportScanFile[]> {
  await assertFolder(folderPath);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files: ImportScanFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

    const filePath = path.join(folderPath, entry.name);
    const stat = await fs.stat(filePath);
    files.push({
      filename: entry.name,
      path: filePath,
      size: stat.size,
      extension
    });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename, "zh-Hans-CN"));
}

function validateSupportedSourceFile(file: ImportSourceFile): string | null {
  const extension = path.extname(file.filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return `仅支持 ${SUPPORTED_FORMAT_LABEL} 文件`;
  }

  const mimeType = file.mimeType?.trim().toLowerCase();
  if (mimeType && mimeType !== "application/octet-stream" && !SUPPORTED_MIME_TYPES.has(mimeType)) {
    return `文件类型 ${mimeType} 不受支持，仅支持 ${SUPPORTED_FORMAT_LABEL}`;
  }
  if (mimeType && mimeType !== "application/octet-stream") {
    const expectedMimeType = extension === ".png" ? "image/png" : "image/jpeg";
    if (mimeType !== expectedMimeType) {
      return `文件扩展名与类型不匹配：${extension} / ${mimeType}`;
    }
  }

  return null;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function loadSharp(): any {
  try {
    return require("sharp");
  } catch {
    throw { code: "MISSING_IMAGE_PROCESSOR", message: "缺少 sharp 依赖，请先安装依赖后再导入图片" };
  }
}

function loadExifr(): any | null {
  try {
    return require("exifr");
  } catch {
    return null;
  }
}

async function readExif(filePath: string): Promise<ExifInfo> {
  const empty: ExifInfo = { shotAt: "", cameraModel: "", lensModel: "" };
  const exifr = loadExifr();
  if (!exifr) return empty;

  try {
    const data = await exifr.parse(filePath, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: false,
      xmp: false,
      icc: false
    });

    if (!data) return empty;

    const shotDate = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
    const shotAt = shotDate instanceof Date ? shotDate.toISOString() : typeof shotDate === "string" ? shotDate : "";
    const make = typeof data.Make === "string" ? data.Make.trim() : "";
    const model = typeof data.Model === "string" ? data.Model.trim() : "";

    return {
      shotAt,
      cameraModel: [make, model].filter(Boolean).join(" "),
      lensModel: typeof data.LensModel === "string" ? data.LensModel : typeof data.LensID === "string" ? data.LensID : ""
    };
  } catch (err) {
    safeLog("debug", { err, filePath }, "EXIF 读取失败，继续导入");
    return empty;
  }
}

function ensureEventReady(eventId: string) {
  const event = getEventById(eventId);
  if (!event) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (event.status === "archived" || event.status === "deleted") {
    throw { code: "EVENT_NOT_IMPORTABLE", message: "归档或删除状态的活动不能导入图片" };
  }
  return event;
}

function getOriginalTargetDir(sourceType: ImportSourceType, workspace: ReturnType<typeof getEventWorkspacePaths>): string {
  return sourceType === "client_upload" ? workspace.clientUploadOriginalDir : workspace.hostImportOriginalDir;
}

function getDefaultImportConcurrency(): number {
  const cpuCount = os.cpus().length || 2;
  return Math.min(4, Math.max(2, cpuCount - 1));
}

function getProcessedCount(result: Pick<ImportStartResult, "success" | "failed" | "skipped">): number {
  return result.success + result.failed + result.skipped;
}

function createProgressSnapshot(
  result: ImportStartResult,
  currentFileName = "",
  totalBytes = 0,
  processedBytes = 0
): ImportProgressSnapshot {
  return {
    total: result.total,
    processed: getProcessedCount(result),
    success: result.success,
    failed: result.failed,
    skipped: result.skipped,
    errors: result.errors,
    currentFileName,
    importedCount: result.imported.length,
    totalBytes,
    processedBytes
  };
}

function writeImportLog(input: {
  imageId: string;
  eventId: string;
  sourceType: ImportSourceType;
  photographer: string;
  device: string;
  originalFilename: string;
  storedFilename: string;
  actor: ActorInfo;
}): void {
  const actorColumns = actorToLogColumns(input.actor);
  getDatabase().prepare(`
    INSERT INTO operation_logs (
      type, target_type, target_id, operator, device,
      actor_type, actor_id, actor_name, detail, created_at
    )
    VALUES ('image_imported', 'image', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.imageId,
    actorColumns.operator || input.photographer,
    input.device || actorColumns.device,
    actorColumns.actor_type,
    actorColumns.actor_id,
    actorColumns.actor_name,
    JSON.stringify({
      event_id: input.eventId,
      source_type: input.sourceType,
      original_filename: input.originalFilename,
      stored_filename: input.storedFilename,
      actor_type: actorColumns.actor_type,
      actor_id: actorColumns.actor_id,
      actor_name: actorColumns.actor_name
    }),
    nowTimestamp()
  );
}

export async function scanImportFolder(eventId: string, folderPath: string): Promise<ImportScanResult> {
  ensureEventReady(eventId);
  const files = await listSupportedImageFiles(folderPath);
  return {
    eventId,
    folderPath,
    count: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files
  };
}

export async function importImages(input: {
  eventId: string;
  folderPath: string;
  sourceType?: ImportSourceType;
  options?: ImportImageFilesOptions;
}): Promise<ImportStartResult> {
  const sourceType = input.sourceType ?? "host_import";
  if (sourceType !== "host_import") {
    throw { code: "UNSUPPORTED_SOURCE_TYPE", message: "文件夹导入只支持 host_import" };
  }

  ensureEventReady(input.eventId);
  const files = await listSupportedImageFiles(input.folderPath);
  return importImageFiles({
    eventId: input.eventId,
    files,
    folderPath: input.folderPath,
    sourceType,
    options: input.options
  });
}

export async function importSelectedImageFiles(input: {
  eventId: string;
  filePaths: unknown;
  sourceType?: ImportSourceType;
  options?: ImportImageFilesOptions;
}): Promise<ImportStartResult> {
  const sourceType = input.sourceType ?? "host_import";
  if (sourceType !== "host_import") {
    throw { code: "UNSUPPORTED_SOURCE_TYPE", message: "指定文件导入只支持 host_import" };
  }
  if (!Array.isArray(input.filePaths) || input.filePaths.length === 0) {
    throw { code: "INVALID_FILE_PATHS", message: "filePaths 必须是非空数组" };
  }

  ensureEventReady(input.eventId);
  const files: ImportSourceFile[] = [];
  const preflightErrors: ImportErrorItem[] = [];

  for (const value of input.filePaths) {
    if (typeof value !== "string" || !value.trim()) {
      preflightErrors.push({
        filename: "",
        path: String(value ?? ""),
        reason: "文件路径必须是非空字符串"
      });
      continue;
    }

    const filePath = path.resolve(value);
    const filename = path.basename(filePath);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        preflightErrors.push({
          filename,
          path: filePath,
          reason: "路径不是文件"
        });
        continue;
      }

      files.push({
        filename,
        path: filePath,
        size: stat.size
      });
    } catch {
      preflightErrors.push({
        filename,
        path: filePath,
        reason: "文件不存在或不可读取"
      });
    }
  }

  const result = await importImageFiles({
    eventId: input.eventId,
    files,
    folderPath: "",
    sourceType,
    options: input.options
  });
  result.total += preflightErrors.length;
  result.failed += preflightErrors.length;
  const maxErrors = input.options?.maxErrors ?? 100;
  result.errors.unshift(...preflightErrors.slice(0, Math.max(0, maxErrors - result.errors.length)));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  input.options?.onProgress?.(createProgressSnapshot(result, "", totalBytes, totalBytes));
  return result;
}

export async function importImageFiles(input: {
  eventId: string;
  files: ImportSourceFile[];
  folderPath?: string;
  sourceType: ImportSourceType;
  photographer?: string;
  device?: string;
  remark?: string;
  actor?: ActorInfo;
  options?: ImportImageFilesOptions;
}): Promise<ImportStartResult> {
  const sourceType = input.sourceType;
  const event = ensureEventReady(input.eventId);
  const workingDir = ensureEventWorkingDirs(event.slug);
  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  const originalDir = getOriginalTargetDir(sourceType, workspace);
  const sharp = loadSharp();
  const db = getDatabase();
  const photographer = input.photographer?.trim() ?? "";
  const device = input.device?.trim() ?? "";
  const remark = input.remark?.trim() ?? "";
  const actor = sourceType === "client_upload"
    ? normalizeActor(input.actor, { type: "client", id: "", name: "客户端" })
    : normalizeActor(input.actor, HOST_ACTOR);
  const maxErrors = input.options?.maxErrors ?? 100;
  const concurrency = Math.min(
    Math.max(1, input.options?.concurrency ?? getDefaultImportConcurrency()),
    Math.max(1, input.files.length || 1)
  );
  const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
  let processedBytes = 0;

  const result: ImportStartResult = {
    eventId: input.eventId,
    folderPath: input.folderPath ?? "",
    sourceType,
    photographer,
    device,
    remark,
    total: input.files.length,
    success: 0,
    failed: 0,
    skipped: 0,
    imported: [],
    errors: []
  };

  fs.ensureDirSync(originalDir);
  fs.ensureDirSync(workspace.thumbsDir);
  fs.ensureDirSync(workspace.previewsDir);

  const duplicateStmt = db.prepare("SELECT id FROM images WHERE event_id = ? AND file_hash = ? LIMIT 1");
  const insertImageStmt = db.prepare(`
    INSERT INTO images (
      id, event_id, original_filename, stored_filename, thumb_path, preview_path,
      original_path, edited_path, photographer, camera_model, lens_model, shot_at,
      rating, status, category, remark, source,
      uploaded_by_client_id, uploaded_by_name, uploaded_by_role, uploaded_at,
      file_size, file_hash, exif_shot_at,
      width, height, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, 'unselected', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateEventStmt = db.prepare(`
    UPDATE events
    SET total_images = (SELECT COUNT(*) FROM images WHERE event_id = ? AND is_deleted = 0), updated_at = ?
    WHERE id = ?
  `);
  const seenHashes = new Set<string>();

  const addError = (file: ImportSourceFile, reason: string) => {
    result.failed += 1;
    if (result.errors.length < maxErrors) {
      result.errors.push({
        filename: file.filename,
        path: file.path,
        reason
      });
    }
  };

  const markProcessed = (file: ImportSourceFile) => {
    processedBytes += file.size;
  };

  const reportProgress = (currentFileName = "") => {
    input.options?.onProgress?.(createProgressSnapshot(result, currentFileName, totalBytes, processedBytes));
  };

  const processFile = async (file: ImportSourceFile) => {
    let originalTarget = "";
    let thumbPath = "";
    let previewPath = "";

    try {
      if (input.options?.isCancelled?.()) {
        return;
      }

      const unsupportedReason = validateSupportedSourceFile(file);
      if (unsupportedReason) {
        addError(file, unsupportedReason);
        markProcessed(file);
        reportProgress(file.filename);
        return;
      }

      const fileHash = await hashFile(file.path);
      if (input.options?.isCancelled?.()) {
        return;
      }

      const duplicate = duplicateStmt.get(event.id, fileHash);
      if (duplicate || seenHashes.has(fileHash)) {
        result.skipped += 1;
        seenHashes.add(fileHash);
        markProcessed(file);
        reportProgress(file.filename);
        return;
      }
      seenHashes.add(fileHash);

      const imageId = generateImageId();
      const safeOriginalName = sanitizeFilename(file.filename);
      const storedFilename = `${sanitizeFilename(event.slug)}_${formatDateForFilename()}_${imageId}_${safeOriginalName}`;
      originalTarget = path.join(originalDir, storedFilename);
      thumbPath = path.join(workspace.thumbsDir, `${imageId}.webp`);
      previewPath = path.join(workspace.previewsDir, `${imageId}.webp`);

      await fs.copy(file.path, originalTarget, { overwrite: false, errorOnExist: true });

      const metadata = await sharp(originalTarget).metadata();
      await sharp(originalTarget)
        .rotate()
        .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(thumbPath);
      await sharp(originalTarget)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86 })
        .toFile(previewPath);

      const exif = await readExif(originalTarget);
      const now = nowTimestamp();

      insertImageStmt.run(
        imageId,
        event.id,
        file.filename,
        storedFilename,
        thumbPath,
        previewPath,
        originalTarget,
        photographer,
        exif.cameraModel,
        exif.lensModel,
        exif.shotAt,
        remark,
        sourceType,
        actor.type === "client" ? actor.id : "host",
        sourceType === "host_import" ? "主机" : actor.name || device || "客户端",
        actor.type,
        now,
        file.size,
        fileHash,
        exif.shotAt,
        metadata.width ?? 0,
        metadata.height ?? 0,
        now,
        now
      );
      writeImportLog({
        imageId,
        eventId: event.id,
        sourceType,
        photographer,
        device,
        originalFilename: file.filename,
        storedFilename,
        actor
      });

      const imported: ImportedImageSummary = {
        id: imageId,
        originalFilename: file.filename,
        storedFilename,
        originalPath: originalTarget,
        thumbPath,
        previewPath
      };
      result.success += 1;
      result.imported.push(imported);
      try {
        await input.options?.onImageImported?.(imported);
      } catch {
        // Realtime broadcast failure should not fail the import.
      }
      markProcessed(file);
      reportProgress(file.filename);
    } catch (err: any) {
      addError(file, err?.message || "导入失败");
      markProcessed(file);
      reportProgress(file.filename);
    }
  };

  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < input.files.length) {
      if (input.options?.isCancelled?.()) break;
      const index = nextIndex;
      nextIndex += 1;
      const file = input.files[index];
      await processFile(file);
    }
  });

  await Promise.all(workers);

  const now = nowTimestamp();
  try {
    updateEventStmt.run(event.id, now, event.id);
  } catch (err) {
    safeLog("warn", { err, eventId: event.id }, "导入完成后更新活动统计失败");
  }

  safeLog("info", {
    eventId: event.id,
    workingDir,
    total: result.total,
    success: result.success,
    failed: result.failed,
    skipped: result.skipped,
    concurrency
  }, "图片导入完成");
  return result;
}
