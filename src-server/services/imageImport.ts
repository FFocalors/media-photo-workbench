import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { getLogger } from "../utils/logger";
import { getEventById } from "./events";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";

export type ImportSourceType = "host_import";

export interface ImportScanFile {
  filename: string;
  path: string;
  size: number;
  extension: string;
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
  total: number;
  success: number;
  failed: number;
  skipped: number;
  imported: ImportedImageSummary[];
  errors: ImportErrorItem[];
}

interface ExifInfo {
  shotAt: string;
  cameraModel: string;
  lensModel: string;
}

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg"]);

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

async function listJpegFiles(folderPath: string): Promise<ImportScanFile[]> {
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
    getLogger().warn({ err, filePath }, "EXIF 读取失败，继续导入");
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

export async function scanImportFolder(eventId: string, folderPath: string): Promise<ImportScanResult> {
  ensureEventReady(eventId);
  const files = await listJpegFiles(folderPath);
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
}): Promise<ImportStartResult> {
  const sourceType = input.sourceType ?? "host_import";
  if (sourceType !== "host_import") {
    throw { code: "UNSUPPORTED_SOURCE_TYPE", message: "第一版只支持 host_import" };
  }

  const event = ensureEventReady(input.eventId);
  const files = await listJpegFiles(input.folderPath);
  const workingDir = ensureEventWorkingDirs(event.slug);
  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  const sharp = loadSharp();
  const db = getDatabase();

  const result: ImportStartResult = {
    eventId: input.eventId,
    folderPath: input.folderPath,
    sourceType,
    total: files.length,
    success: 0,
    failed: 0,
    skipped: 0,
    imported: [],
    errors: []
  };

  fs.ensureDirSync(workspace.hostImportOriginalDir);
  fs.ensureDirSync(workspace.thumbsDir);
  fs.ensureDirSync(workspace.previewsDir);

  for (const file of files) {
    let originalTarget = "";
    let thumbPath = "";
    let previewPath = "";

    try {
      const fileHash = await hashFile(file.path);
      const duplicate = db.prepare("SELECT id FROM images WHERE file_hash = ? LIMIT 1").get(fileHash);
      if (duplicate) {
        result.skipped += 1;
        continue;
      }

      const imageId = generateImageId();
      const safeOriginalName = sanitizeFilename(file.filename);
      const storedFilename = `${sanitizeFilename(event.slug)}_${formatDateForFilename()}_${imageId}_${safeOriginalName}`;
      originalTarget = path.join(workspace.hostImportOriginalDir, storedFilename);
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

      db.prepare(`
        INSERT INTO images (
          id, event_id, original_filename, stored_filename, thumb_path, preview_path,
          original_path, edited_path, photographer, camera_model, lens_model, shot_at,
          rating, status, category, remark, source, file_size, file_hash, exif_shot_at,
          width, height, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, 0, 'unselected', '', '', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        imageId,
        event.id,
        file.filename,
        storedFilename,
        thumbPath,
        previewPath,
        originalTarget,
        exif.cameraModel,
        exif.lensModel,
        exif.shotAt,
        sourceType,
        file.size,
        fileHash,
        exif.shotAt,
        metadata.width ?? 0,
        metadata.height ?? 0,
        now,
        now
      );

      result.success += 1;
      result.imported.push({
        id: imageId,
        originalFilename: file.filename,
        storedFilename,
        originalPath: originalTarget,
        thumbPath,
        previewPath
      });
    } catch (err: any) {
      result.failed += 1;
      result.errors.push({
        filename: file.filename,
        path: file.path,
        reason: err?.message || "导入失败"
      });
      getLogger().error({ err, file, originalTarget, thumbPath, previewPath }, "图片导入失败");
    }
  }

  const now = nowTimestamp();
  db.prepare(`
    UPDATE events
    SET total_images = (SELECT COUNT(*) FROM images WHERE event_id = ? AND is_deleted = 0), updated_at = ?
    WHERE id = ?
  `).run(event.id, now, event.id);

  getLogger().info({ eventId: event.id, workingDir, result }, "图片导入完成");
  return result;
}
