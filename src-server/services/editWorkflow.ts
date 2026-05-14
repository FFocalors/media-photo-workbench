import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { emitImageUpdated } from "../realtime/socket";
import { getLogger } from "../utils/logger";
import { createZipArchive, ZipFileEntry } from "../utils/zip";
import { getEventById } from "./events";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";
import { getImageDtoById, ImageDto, ImageRow } from "./images";

export interface EditPackageError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface EditPackageManifestItem {
  image_id: string;
  event_id: string;
  original_filename: string;
  export_filename: string;
  stored_filename: string;
  file_hash: string;
  original_path: string;
}

export interface EditPackageResult {
  packageId: string;
  packagePath: string;
  downloadUrl: string;
  total: number;
  success: number;
  skipped: number;
  errors: EditPackageError[];
}

export interface EditPackageDownload {
  packageId: string;
  eventId: string;
  filePath: string;
  filename: string;
}

export interface EditedUploadError {
  filename: string;
  reason: string;
}

export interface EditedUploadItem {
  imageId: string;
  originalFilename: string;
  uploadedFilename: string;
  editedPath: string;
  matchedBy: "manifest" | "filename";
  status: "edited";
}

export interface EditedUploadResult {
  total: number;
  matched: number;
  unmatched: number;
  errors: EditedUploadError[];
  items: EditedUploadItem[];
  images: ImageDto[];
}

export interface EditedUploadSourceFile {
  fieldName: string;
  originalFilename: string;
  path: string;
  size: number;
  mimeType?: string;
}

interface ExportJobRow {
  id: string;
  event_id: string;
  type: string;
  output_path: string;
  status: string;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const RETURN_FOLDER_README = [
  "请把修好的 JPG/JPEG 放在这个文件夹里。",
  "回传时可以直接把整个“已修图回传”文件夹拖入“修图流转 -> 已修图回传”。",
  "本文件夹内的 edit_manifest.json 请保留，不要删除。",
  "",
  "建议保留原文件名，或只追加常见后缀：",
  "- IMG_0001.JPG",
  "- IMG_0001_final.JPG",
  "- IMG_0001_已修.JPG",
  "",
  "不建议改成完全无关的文件名，否则无 manifest 时可能无法自动匹配。"
].join("\r\n");

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function nowIso(): string {
  return new Date().toISOString();
}

function generatePackageId(): string {
  return `pkg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
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
    throw { code: "MISSING_IMAGE_PROCESSOR", message: "缺少 sharp 依赖，无法处理已修图" };
  }
}

function makeEditedStoredFilename(eventSlug: string, image: ImageRow, uploadedFilename: string): string {
  const extension = path.extname(uploadedFilename).toLowerCase() || ".jpg";
  const originalBase = path.parse(sanitizeFilename(image.original_filename)).name || image.id;
  return `${sanitizeFilename(eventSlug)}_edited_${image.id}_${originalBase}${extension}`;
}

async function removePreviousEditedFiles(editedDir: string, image: ImageRow): Promise<string[]> {
  const removed: string[] = [];
  const candidates = new Set<string>();
  if (image.edited_path) {
    candidates.add(image.edited_path);
  }

  if (await fs.pathExists(editedDir)) {
    const legacyNeedle = `_edited_${image.id}_`;
    const entries = await fs.readdir(editedDir);
    for (const entry of entries) {
      if (entry.includes(legacyNeedle)) {
        candidates.add(path.join(editedDir, entry));
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate && await fs.pathExists(candidate)) {
      await fs.remove(candidate);
      removed.push(candidate);
    }
  }

  return removed;
}

async function regenerateDisplayAssets(input: {
  sourcePath: string;
  image: ImageRow;
  workspace: ReturnType<typeof getEventWorkspacePaths>;
}): Promise<{ thumbPath: string; previewPath: string }> {
  const sharp = loadSharp();
  await fs.ensureDir(input.workspace.thumbsDir);
  await fs.ensureDir(input.workspace.previewsDir);

  const thumbPath = input.image.thumb_path || path.join(input.workspace.thumbsDir, `${input.image.id}.webp`);
  const previewPath = input.image.preview_path || path.join(input.workspace.previewsDir, `${input.image.id}.webp`);

  await sharp(input.sourcePath)
    .rotate()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(thumbPath);
  await sharp(input.sourcePath)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86 })
    .toFile(previewPath);

  return { thumbPath, previewPath };
}

function ensureEventReady(eventId: string) {
  const event = getEventById(eventId);
  if (!event) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (event.status === "archived" || event.status === "deleted") {
    throw { code: "EVENT_NOT_EDITABLE", message: "归档或删除状态的活动不能执行修图流转" };
  }
  return event;
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

function makeUniqueExportFilename(originalFilename: string, imageId: string, used: Set<string>): string {
  const parsed = path.parse(sanitizeFilename(originalFilename));
  let candidate = `${parsed.name || imageId}${parsed.ext || ".jpg"}`;
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }

  candidate = `${parsed.name || "image"}_${imageId}${parsed.ext || ".jpg"}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function normalizeMatchName(filename: string): string {
  const parsed = path.parse(path.basename(filename));
  return parsed.name
    .replace(/([_-](edit|edited|retouch|retouched|final|done|已修|修图|成片))+$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function getEditImages(eventId: string): ImageRow[] {
  return getDatabase().prepare(`
    SELECT * FROM images
    WHERE event_id = ? AND status = 'edit' AND is_deleted = 0
    ORDER BY created_at ASC, id ASC
  `).all(eventId) as ImageRow[];
}

function getEventImages(eventId: string): ImageRow[] {
  return getDatabase().prepare(`
    SELECT * FROM images
    WHERE event_id = ? AND is_deleted = 0
    ORDER BY created_at ASC, id ASC
  `).all(eventId) as ImageRow[];
}

function getImageByEventAndId(eventId: string, imageId: string): ImageRow | undefined {
  return getDatabase().prepare(`
    SELECT * FROM images
    WHERE id = ? AND event_id = ? AND is_deleted = 0
  `).get(imageId, eventId) as ImageRow | undefined;
}

function getExportJob(packageId: string): ExportJobRow | undefined {
  return getDatabase().prepare(`
    SELECT id, event_id, type, output_path, status
    FROM export_jobs
    WHERE id = ? AND type = 'edit_package'
  `).get(packageId) as ExportJobRow | undefined;
}

function recordExportJob(input: {
  packageId: string;
  eventId: string;
  packagePath: string;
  total: number;
  success: number;
  skipped: number;
  manifest: EditPackageManifestItem[];
}): void {
  const now = nowTimestamp();
  getDatabase().prepare(`
    INSERT INTO export_jobs (
      id, event_id, type, status, spec, quality, total, finished,
      success_count, failed_count, output_path, operator, created_at, updated_at
    )
    VALUES (?, ?, 'edit_package', 'success', ?, 0, ?, ?, ?, ?, ?, '', ?, ?)
  `).run(
    input.packageId,
    input.eventId,
    JSON.stringify({ manifest_count: input.manifest.length }),
    input.total,
    input.total,
    input.success,
    input.skipped,
    input.packagePath,
    now,
    now
  );
}

export async function createEditPackage(eventId: string, baseUrl: string): Promise<EditPackageResult> {
  const event = ensureEventReady(eventId);
  ensureEventWorkingDirs(event.slug);

  const images = getEditImages(eventId);
  if (images.length === 0) {
    throw { code: "NO_EDIT_IMAGES", message: "暂无待修图片，请先在图片墙将图片标记为“待修图”" };
  }

  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  await fs.ensureDir(workspace.editQueueDir);
  await fs.ensureDir(workspace.zipExportDir);

  const usedFilenames = new Set<string>();
  const manifest: EditPackageManifestItem[] = [];
  const errors: EditPackageError[] = [];
  const entries: ZipFileEntry[] = [];
  const packageId = generatePackageId();

  for (const image of images) {
    if (!image.original_path || !(await fs.pathExists(image.original_path))) {
      errors.push({
        imageId: image.id,
        filename: image.original_filename,
        reason: "原图文件不存在，已跳过"
      });
      continue;
    }

    const exportFilename = makeUniqueExportFilename(image.original_filename, image.id, usedFilenames);
    manifest.push({
      image_id: image.id,
      event_id: image.event_id,
      original_filename: image.original_filename,
      export_filename: exportFilename,
      stored_filename: image.stored_filename,
      file_hash: image.file_hash,
      original_path: image.original_path
    });
    entries.push({
      name: `待修原图/${exportFilename}`,
      path: image.original_path
    });
  }

  const manifestContent = JSON.stringify(manifest, null, 2);
  entries.push({
    name: "edit_manifest.json",
    content: manifestContent
  });
  entries.push({
    name: "已修图回传/edit_manifest.json",
    content: manifestContent
  });
  entries.push({
    name: "已修图回传/请把修好的JPG放在这里.txt",
    content: RETURN_FOLDER_README
  });

  const packagePath = path.join(workspace.zipExportDir, `待修包_${sanitizeFilename(event.slug)}_${formatDateForFilename()}_${packageId}.zip`);
  await createZipArchive(entries, packagePath);

  recordExportJob({
    packageId,
    eventId,
    packagePath,
    total: images.length,
    success: manifest.length,
    skipped: errors.length,
    manifest
  });
  writeOperationLog({
    type: "edit_package_created",
    targetType: "edit_package",
    targetId: packageId,
    eventId,
    detail: {
      package_path: packagePath,
      total: images.length,
      success: manifest.length,
      skipped: errors.length
    }
  });

  return {
    packageId,
    packagePath,
    downloadUrl: `${baseUrl}/api/edit-packages/${encodeURIComponent(packageId)}/download`,
    total: images.length,
    success: manifest.length,
    skipped: errors.length,
    errors
  };
}

export function assertEditPackageDownload(packageId: string): EditPackageDownload {
  const job = getExportJob(packageId);
  if (!job) {
    throw { code: "EDIT_PACKAGE_NOT_FOUND", message: "待修包不存在" };
  }
  if (job.status !== "success" || !job.output_path || !fs.existsSync(job.output_path)) {
    throw { code: "EDIT_PACKAGE_FILE_NOT_FOUND", message: "待修包文件不存在" };
  }
  return {
    packageId: job.id,
    eventId: job.event_id,
    filePath: job.output_path,
    filename: path.basename(job.output_path)
  };
}

export function recordEditPackageDownload(download: EditPackageDownload): void {
  const now = nowTimestamp();
  getDatabase().prepare(`
    INSERT INTO download_logs (image_id, event_id, type, operator, device, file_path, created_at)
    VALUES ('', ?, 'zip', '', '', ?, ?)
  `).run(download.eventId, download.filePath, now);

  writeOperationLog({
    type: "edit_package_downloaded",
    targetType: "edit_package",
    targetId: download.packageId,
    eventId: download.eventId,
    detail: { file_path: download.filePath }
  });
}

function parseManifestFile(file: EditedUploadSourceFile | undefined): EditPackageManifestItem[] {
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file.path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("manifest 不是数组");
    }
    return parsed.filter((item) => item && typeof item.image_id === "string" && typeof item.original_filename === "string");
  } catch (err) {
    getLogger().warn({ err, file: file.originalFilename }, "edit_manifest.json 解析失败");
    throw { code: "INVALID_EDIT_MANIFEST", message: "edit_manifest.json 解析失败" };
  }
}

function buildManifestLookup(manifest: EditPackageManifestItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of manifest) {
    map.set(normalizeMatchName(item.export_filename || item.original_filename), item.image_id);
    map.set(normalizeMatchName(item.original_filename), item.image_id);
  }
  return map;
}

function buildFilenameLookup(images: ImageRow[]): Map<string, ImageRow> {
  const map = new Map<string, ImageRow>();
  for (const image of images) {
    const key = normalizeMatchName(image.original_filename);
    if (!map.has(key)) {
      map.set(key, image);
    }
  }
  return map;
}

function findMatch(input: {
  eventId: string;
  file: EditedUploadSourceFile;
  manifestLookup: Map<string, string>;
  filenameLookup: Map<string, ImageRow>;
}): { image?: ImageRow; matchedBy?: "manifest" | "filename" } {
  const normalized = normalizeMatchName(input.file.originalFilename);
  const manifestImageId = input.manifestLookup.get(normalized);
  if (manifestImageId) {
    const image = getImageByEventAndId(input.eventId, manifestImageId);
    if (image) {
      return { image, matchedBy: "manifest" };
    }
  }

  const image = input.filenameLookup.get(normalized);
  if (image) {
    return { image, matchedBy: "filename" };
  }

  return {};
}

export async function uploadEditedImages(input: {
  eventId: string;
  files: EditedUploadSourceFile[];
  manifestFile?: EditedUploadSourceFile;
  baseUrl: string;
}): Promise<EditedUploadResult> {
  const event = ensureEventReady(input.eventId);
  ensureEventWorkingDirs(event.slug);

  const repositoryPath = getConfig().repository.path;
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  await fs.ensureDir(workspace.editedDir);

  const manifest = parseManifestFile(input.manifestFile);
  const manifestLookup = buildManifestLookup(manifest);
  const filenameLookup = buildFilenameLookup(getEventImages(input.eventId));
  const result: EditedUploadResult = {
    total: input.files.length,
    matched: 0,
    unmatched: 0,
    errors: [],
    items: [],
    images: []
  };

  for (const file of input.files) {
    const extension = path.extname(file.originalFilename).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      result.unmatched += 1;
      result.errors.push({ filename: file.originalFilename, reason: "仅支持 JPG/JPEG 已修图" });
      continue;
    }

    const { image, matchedBy } = findMatch({
      eventId: input.eventId,
      file,
      manifestLookup,
      filenameLookup
    });

    if (!image || !matchedBy) {
      result.unmatched += 1;
      result.errors.push({ filename: file.originalFilename, reason: "未能匹配到原图" });
      continue;
    }

    try {
      const now = nowTimestamp();
      const storedFilename = makeEditedStoredFilename(event.slug, image, file.originalFilename);
      const editedPath = path.join(workspace.editedDir, storedFilename);
      const removedPreviousFiles = await removePreviousEditedFiles(workspace.editedDir, image);
      await fs.copy(file.path, editedPath, { overwrite: true });
      const displayAssets = await regenerateDisplayAssets({
        sourcePath: editedPath,
        image,
        workspace
      });

      getDatabase().prepare(`
        UPDATE images
        SET edited_path = ?, thumb_path = ?, preview_path = ?, status = 'edited', updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(editedPath, displayAssets.thumbPath, displayAssets.previewPath, now, image.id, input.eventId);

      writeOperationLog({
        type: "edited_image_uploaded",
        targetType: "image",
        targetId: image.id,
        eventId: input.eventId,
        detail: {
          upload_filename: file.originalFilename,
          edited_path: editedPath,
          replaced_files: removedPreviousFiles,
          thumb_path: displayAssets.thumbPath,
          preview_path: displayAssets.previewPath,
          matched_by: matchedBy,
          previous_status: image.status
        }
      });

      const dto = getImageDtoById(image.id, input.baseUrl);
      result.matched += 1;
      result.items.push({
        imageId: image.id,
        originalFilename: image.original_filename,
        uploadedFilename: file.originalFilename,
        editedPath,
        matchedBy,
        status: "edited"
      });
      result.images.push(dto);

      emitImageUpdated({
        eventId: dto.event_id,
        imageId: dto.id,
        image: dto,
        action: "edited_uploaded",
        updatedAt: nowIso()
      });
    } catch (err: any) {
      result.unmatched += 1;
      result.errors.push({ filename: file.originalFilename, reason: err?.message || "已修图保存失败" });
      getLogger().error({ err, file, imageId: image.id }, "已修图保存失败");
    }
  }

  return result;
}
