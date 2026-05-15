import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { getEventById } from "./events";
import { getEventWorkspacePaths } from "./eventWorkspace";
import { ImageRow } from "./images";
import { createTask, failTask, finishTask, updateTask, TaskErrorItem } from "./tasks";
import { createZipArchive, ZipFileEntry } from "../utils/zip";
import { getLogger } from "../utils/logger";

export type DownloadZipType = "original" | "preview" | "edited" | "best";
export type DownloadZipFilenameMode = "original" | "sequence";

export interface CreateDownloadZipInput {
  imageIds: string[];
  type?: DownloadZipType;
  filenameMode?: DownloadZipFilenameMode;
  baseUrl: string;
}

export interface CreateDownloadZipResult {
  taskId: string;
}

export interface DownloadPackageInfo {
  packageId: string;
  eventId: string;
  type: DownloadZipType;
  packagePath: string;
  downloadUrl: string;
  total: number;
  success: number;
  failed: number;
  errors: TaskErrorItem[];
  createdAt: string;
}

export interface DownloadPackageDownload {
  packageId: string;
  eventId: string;
  filePath: string;
  filename: string;
}

const packages = new Map<string, DownloadPackageInfo>();

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function formatDateForFilename(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function generatePackageId(): string {
  return `zip_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_");
}

function basenameWithoutExtension(filename: string): string {
  const parsed = path.parse(filename);
  return parsed.name || filename;
}

function uniqueEntryName(filename: string, usedNames: Set<string>): string {
  const normalized = sanitizeFilename(filename);
  const parsed = path.parse(normalized);
  let candidate = normalized;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${parsed.name}_${index}${parsed.ext}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function writeOperationLog(type: string, targetId: string, eventId: string, detail: Record<string, unknown>): void {
  getDatabase().prepare(`
    INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
    VALUES (?, 'download_package', ?, '', '', ?, ?)
  `).run(type, targetId, JSON.stringify({ event_id: eventId, ...detail }), nowTimestamp());
}

function getImagesByIds(eventId: string, imageIds: string[]): Map<string, ImageRow> {
  if (imageIds.length === 0) return new Map();
  const placeholders = imageIds.map(() => "?").join(",");
  const rows = getDatabase().prepare(`
    SELECT * FROM images
    WHERE event_id = ? AND is_deleted = 0 AND id IN (${placeholders})
  `).all(eventId, ...imageIds) as ImageRow[];
  return new Map(rows.map((image) => [image.id, image]));
}

function pickDownloadFile(image: ImageRow, type: DownloadZipType): { filePath: string; filename: string } | { error: string } {
  if (type === "preview") {
    if (image.preview_path && fs.existsSync(image.preview_path)) {
      return {
        filePath: image.preview_path,
        filename: `${basenameWithoutExtension(image.original_filename)}_preview.webp`
      };
    }
    return { error: "预览图文件不存在" };
  }

  if (type === "edited") {
    if (image.edited_path && fs.existsSync(image.edited_path)) {
      return {
        filePath: image.edited_path,
        filename: path.basename(image.edited_path)
      };
    }
    return { error: "暂无已修图或已修图文件不存在" };
  }

  if (type === "best" && image.edited_path && fs.existsSync(image.edited_path)) {
    return {
      filePath: image.edited_path,
      filename: path.basename(image.edited_path)
    };
  }

  if (image.original_path && fs.existsSync(image.original_path)) {
    return {
      filePath: image.original_path,
      filename: image.original_filename || path.basename(image.original_path)
    };
  }

  return { error: "原图文件不存在" };
}

async function runDownloadZipTask(taskId: string, eventId: string, input: Required<CreateDownloadZipInput>): Promise<void> {
  const event = getEventById(eventId);
  if (!event) {
    failTask(taskId, [{ reason: "活动不存在" }]);
    return;
  }

  const packageId = generatePackageId();
  const timestamp = formatDateForFilename();
  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  const packagePath = path.join(workspace.zipExportDir, `批量下载_${sanitizeFilename(event.slug)}_${timestamp}_${packageId}.zip`);
  const downloadUrl = `${input.baseUrl}/api/download-packages/${encodeURIComponent(packageId)}/download`;
  const errors: TaskErrorItem[] = [];
  const entries: ZipFileEntry[] = [];
  const usedNames = new Set<string>();
  const imageMap = getImagesByIds(eventId, input.imageIds);

  let successCount = 0;
  let failedCount = 0;

  updateTask(taskId, {
    status: "running",
    total: input.imageIds.length
  });

  input.imageIds.forEach((imageId, index) => {
    const image = imageMap.get(imageId);
    if (!image) {
      failedCount += 1;
      errors.push({ imageId, reason: "图片不存在、已删除或不属于当前活动" });
      updateTask(taskId, { finished: index + 1, successCount, failedCount, errors });
      return;
    }

    const picked = pickDownloadFile(image, input.type);
    if ("error" in picked) {
      failedCount += 1;
      errors.push({ imageId, filename: image.original_filename, reason: picked.error });
      updateTask(taskId, { finished: index + 1, successCount, failedCount, errors });
      return;
    }

    successCount += 1;
    const originalName = picked.filename || image.original_filename || path.basename(picked.filePath);
    const sequencePrefix = String(successCount).padStart(3, "0");
    const entryName = input.filenameMode === "sequence"
      ? uniqueEntryName(`${sequencePrefix}_${originalName}`, usedNames)
      : uniqueEntryName(originalName, usedNames);
    entries.push({ name: entryName, path: picked.filePath });
    updateTask(taskId, { finished: index + 1, successCount, failedCount, errors });
  });

  if (entries.length === 0) {
    const result = {
      packageId,
      eventId,
      type: input.type,
      total: input.imageIds.length,
      success: 0,
      failed: failedCount,
      errors
    };
    failTask(taskId, errors.length > 0 ? errors : [{ reason: "没有可打包下载的图片" }], result);
    writeOperationLog("download_zip_failed", packageId, eventId, result);
    return;
  }

  try {
    await fs.ensureDir(workspace.zipExportDir);
    await createZipArchive(entries, packagePath);
    const info: DownloadPackageInfo = {
      packageId,
      eventId,
      type: input.type,
      packagePath,
      downloadUrl,
      total: input.imageIds.length,
      success: successCount,
      failed: failedCount,
      errors,
      createdAt: nowTimestamp()
    };
    packages.set(packageId, info);
    writeOperationLog("download_zip_created", packageId, eventId, {
      package_path: packagePath,
      type: input.type,
      filename_mode: input.filenameMode,
      total: info.total,
      success: info.success,
      failed: info.failed,
      errors: info.errors
    });
    finishTask(taskId, {
      packageId,
      packagePath,
      downloadUrl,
      total: info.total,
      success: info.success,
      failed: info.failed,
      errors: info.errors
    });
  } catch (err: any) {
    const taskErrors = [{ reason: err?.message || "批量 ZIP 生成失败" }];
    failTask(taskId, taskErrors, {
      packageId,
      packagePath,
      total: input.imageIds.length,
      success: successCount,
      failed: failedCount + 1,
      errors: [...errors, ...taskErrors]
    });
    writeOperationLog("download_zip_failed", packageId, eventId, {
      package_path: packagePath,
      error: err?.message || "批量 ZIP 生成失败"
    });
    getLogger().error({ err, eventId, packagePath }, "批量 ZIP 生成失败");
  }
}

export function createDownloadZipTask(eventId: string, input: CreateDownloadZipInput): CreateDownloadZipResult {
  const event = getEventById(eventId);
  if (!event) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (event.status === "deleted") {
    throw { code: "EVENT_NOT_DOWNLOADABLE", message: "已删除活动不能生成下载包" };
  }
  if (!Array.isArray(input.imageIds) || input.imageIds.length === 0) {
    throw { code: "NO_DOWNLOAD_IMAGES", message: "请先选择需要下载的图片" };
  }

  const type = input.type ?? "best";
  if (!["original", "preview", "edited", "best"].includes(type)) {
    throw { code: "INVALID_DOWNLOAD_ZIP_TYPE", message: "下载类型无效" };
  }
  const filenameMode = input.filenameMode ?? "sequence";
  if (!["original", "sequence"].includes(filenameMode)) {
    throw { code: "INVALID_FILENAME_MODE", message: "文件命名方式无效" };
  }

  const task = createTask({
    type: "download_zip",
    eventId,
    title: `生成批量下载 ZIP：${event.name}`,
    total: input.imageIds.length
  });

  void runDownloadZipTask(task.id, eventId, {
    imageIds: input.imageIds,
    type,
    filenameMode,
    baseUrl: input.baseUrl
  });

  return { taskId: task.id };
}

export function assertDownloadPackageDownload(packageId: string): DownloadPackageDownload {
  const info = packages.get(packageId);
  if (!info) {
    throw { code: "DOWNLOAD_PACKAGE_NOT_FOUND", message: "下载包不存在或服务已重启" };
  }
  if (!fs.existsSync(info.packagePath)) {
    throw { code: "DOWNLOAD_PACKAGE_FILE_NOT_FOUND", message: "下载包文件不存在" };
  }
  return {
    packageId,
    eventId: info.eventId,
    filePath: info.packagePath,
    filename: path.basename(info.packagePath)
  };
}

export function recordDownloadPackageDownload(download: DownloadPackageDownload): void {
  const now = nowTimestamp();
  getDatabase().prepare(`
    INSERT INTO download_logs (image_id, event_id, type, operator, device, file_path, created_at)
    VALUES ('', ?, 'zip', '', '', ?, ?)
  `).run(download.eventId, download.filePath, now);
  writeOperationLog("download_zip_downloaded", download.packageId, download.eventId, {
    package_path: download.filePath
  });
}
