import path from "path";
import fs from "fs-extra";
import { getDatabase } from "../db/database";
import { actorToLogColumns, HOST_ACTOR, type ActorInfo } from "../utils/actor";

export const IMAGE_STATUSES = ["unselected", "rejected", "archive", "edit", "edited", "publish", "published"] as const;
export type ImageStatus = typeof IMAGE_STATUSES[number];

export interface ImageRow {
  id: string;
  event_id: string;
  original_filename: string;
  stored_filename: string;
  thumb_path: string;
  preview_path: string;
  original_path: string;
  edited_path: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  shot_at: string;
  rating: number;
  status: ImageStatus;
  category: string;
  remark: string;
  source: string;
  uploaded_by_client_id: string;
  uploaded_by_name: string;
  uploaded_by_role: string;
  uploaded_at: string;
  file_size: number;
  file_hash: string;
  exif_shot_at: string;
  width: number;
  height: number;
  is_deleted: number;
  deleted_at: string;
  created_at: string;
  updated_at: string;
}

export interface ImageDto {
  id: string;
  event_id: string;
  original_filename: string;
  stored_filename: string;
  thumb_url: string;
  preview_url: string;
  file_size: number;
  width: number;
  height: number;
  shot_at: string;
  imported_at: string;
  rating: number;
  status: ImageStatus;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  source_type: string;
  uploaded_by_client_id: string;
  uploaded_by_name: string;
  uploaded_by_role: string;
  uploaded_at: string;
  edited_available: boolean;
  original_exists: boolean;
  thumb_exists: boolean;
  preview_exists: boolean;
  edited_exists: boolean;
  is_deleted: boolean;
  deleted_at: string;
  original_path?: string;
  thumb_path?: string;
  preview_path?: string;
  edited_path?: string;
}

export interface ImageListParams {
  page?: number;
  pageSize?: number;
  rating?: number;
  ratingMode?: string;
  status?: string;
  sourceType?: string;
  uploadedByClientId?: string;
  keyword?: string;
  deleted?: boolean;
}

export interface ImageListResult {
  items: ImageDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EventUploaderSummary {
  clientId: string;
  clientName: string;
  sourceType: string;
  count: number;
}

export type ImageDownloadType = "original" | "preview" | "edited";

export interface ImageDownloadFile {
  image: ImageRow;
  filePath: string;
  filename: string;
  type: ImageDownloadType;
}

export interface ImagePurgeResult {
  imageId: string;
  eventId: string;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: number;
}

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function pathExists(filePath: string): boolean {
  return Boolean(filePath && fs.existsSync(filePath));
}

function toImageDto(row: ImageRow, baseUrl: string, includePaths = false): ImageDto {
  const originalExists = pathExists(row.original_path);
  const thumbExists = pathExists(row.thumb_path);
  const previewExists = pathExists(row.preview_path);
  const editedExists = pathExists(row.edited_path);

  const dto: ImageDto = {
    id: row.id,
    event_id: row.event_id,
    original_filename: row.original_filename,
    stored_filename: row.stored_filename,
    thumb_url: `${baseUrl}/api/images/${row.id}/thumb`,
    preview_url: `${baseUrl}/api/images/${row.id}/preview`,
    file_size: row.file_size,
    width: row.width,
    height: row.height,
    shot_at: row.shot_at,
    imported_at: row.created_at,
    rating: row.rating,
    status: row.status,
    category: row.category,
    remark: row.remark,
    photographer: row.photographer,
    camera_model: row.camera_model,
    lens_model: row.lens_model,
    source_type: row.source,
    uploaded_by_client_id: row.uploaded_by_client_id || defaultUploadedByClientId(row.source),
    uploaded_by_name: row.uploaded_by_name || defaultUploadedByName(row.source),
    uploaded_by_role: row.uploaded_by_role || defaultUploadedByRole(row.source),
    uploaded_at: row.uploaded_at || row.created_at,
    edited_available: editedExists,
    original_exists: originalExists,
    thumb_exists: thumbExists,
    preview_exists: previewExists,
    edited_exists: editedExists,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at
  };

  if (includePaths) {
    dto.original_path = row.original_path;
    dto.thumb_path = row.thumb_path;
    dto.preview_path = row.preview_path;
    dto.edited_path = row.edited_path;
  }

  return dto;
}

function defaultUploadedByClientId(source: string): string {
  if (source === "host_import") return "host";
  if (source === "camera_ftp") return "camera_ftp";
  return "";
}

function defaultUploadedByName(source: string): string {
  if (source === "host_import") return "主机导入";
  if (source === "client_upload") return "客户端上传";
  if (source === "camera_ftp") return "相机 FTP";
  return "";
}

function defaultUploadedByRole(source: string): string {
  if (source === "host_import") return "host";
  if (source === "camera_ftp") return "camera";
  return "";
}

export function getImageById(id: string): ImageRow | undefined {
  const db = getDatabase();
  return db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
}

export function listEventImages(eventId: string, params: ImageListParams, baseUrl: string): ImageListResult {
  const db = getDatabase();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 80));
  const where: string[] = ["event_id = ?", params.deleted ? "is_deleted = 1" : "is_deleted = 0"];
  const values: unknown[] = [eventId];

  if (typeof params.ratingMode === "string" && !["eq", "gte"].includes(params.ratingMode)) {
    throw { code: "INVALID_RATING_MODE", message: "ratingMode 只能是 eq 或 gte" };
  }

  if (typeof params.rating === "number" && Number.isFinite(params.rating)) {
    const rating = Math.trunc(params.rating);
    if (rating < 0 || rating > 5) {
      throw { code: "INVALID_RATING", message: "rating 只能是 0-5 的整数" };
    }

    const ratingMode = params.ratingMode === "eq" ? "eq" : "gte";
    if (ratingMode === "eq") {
      where.push("rating = ?");
      values.push(rating);
    } else if (rating > 0) {
      where.push("rating >= ?");
      values.push(rating);
    }
  }

  if (params.status && params.status !== "all") {
    if (!IMAGE_STATUSES.includes(params.status as ImageStatus)) {
      throw { code: "INVALID_STATUS", message: `无效的状态值：${params.status}` };
    }
    where.push("status = ?");
    values.push(params.status);
  }

  if (params.sourceType && params.sourceType !== "all") {
    where.push("source = ?");
    values.push(params.sourceType);
  }

  if (params.uploadedByClientId && params.uploadedByClientId !== "all") {
    if (params.uploadedByClientId === "host") {
      where.push("source = ?");
      values.push("host_import");
    } else if (params.uploadedByClientId === "camera_ftp") {
      where.push("source = ?");
      values.push("camera_ftp");
    } else if (params.uploadedByClientId === "client_unknown") {
      where.push("source = ? AND uploaded_by_client_id = ''");
      values.push("client_upload");
    } else {
      where.push("uploaded_by_client_id = ?");
      values.push(params.uploadedByClientId);
    }
  }

  const keyword = params.keyword?.trim();
  if (keyword) {
    where.push("(original_filename LIKE ? OR stored_filename LIKE ? OR category LIKE ? OR remark LIKE ? OR photographer LIKE ? OR camera_model LIKE ? OR lens_model LIKE ?)");
    const like = `%${keyword}%`;
    values.push(like, like, like, like, like, like, like);
  }

  const whereSql = where.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM images WHERE ${whereSql}`).get(...values) as { count: number }).count;
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT * FROM images
    WHERE ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset) as ImageRow[];

  return {
    items: rows.map((row) => toImageDto(row, baseUrl, Boolean(params.deleted))),
    total,
    page,
    pageSize
  };
}

export function listEventUploaders(eventId: string): EventUploaderSummary[] {
  const rows = getDatabase().prepare(`
    SELECT
      CASE
        WHEN source = 'host_import' THEN 'host'
        WHEN source = 'camera_ftp' THEN 'camera_ftp'
        WHEN uploaded_by_client_id != '' THEN uploaded_by_client_id
        ELSE 'client_unknown'
      END AS clientId,
      CASE
        WHEN source = 'host_import' THEN '主机导入'
        WHEN source = 'camera_ftp' AND uploaded_by_name != '' THEN uploaded_by_name
        WHEN source = 'camera_ftp' THEN '相机 FTP'
        WHEN uploaded_by_name != '' THEN uploaded_by_name
        ELSE '客户端上传'
      END AS clientName,
      source AS sourceType,
      COUNT(*) AS count
    FROM images
    WHERE event_id = ? AND is_deleted = 0
    GROUP BY clientId, clientName, source
    ORDER BY
      CASE WHEN clientId = 'host' THEN 0 WHEN clientId = 'camera_ftp' THEN 1 ELSE 2 END,
      clientName COLLATE NOCASE ASC
  `).all(eventId) as Array<{
    clientId: string;
    clientName: string;
    sourceType: string;
    count: number;
  }>;

  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    sourceType: row.sourceType,
    count: row.count
  }));
}

export function listEventTrashedImages(eventId: string, params: ImageListParams, baseUrl: string): ImageListResult {
  return listEventImages(eventId, { ...params, deleted: true }, baseUrl);
}

function writeOperationLog(imageId: string, eventId: string, type: string, detail: Record<string, unknown>, actor: ActorInfo = HOST_ACTOR): void {
  const db = getDatabase();
  const actorColumns = actorToLogColumns(actor);
  db.prepare(`
    INSERT INTO operation_logs (
      type, target_type, target_id, operator, device,
      actor_type, actor_id, actor_name, detail, created_at
    )
    VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    imageId,
    actorColumns.operator,
    actorColumns.device,
    actorColumns.actor_type,
    actorColumns.actor_id,
    actorColumns.actor_name,
    JSON.stringify({
      event_id: eventId,
      actor_type: actorColumns.actor_type,
      actor_id: actorColumns.actor_id,
      actor_name: actorColumns.actor_name,
      ...detail
    }),
    nowTimestamp()
  );
}

function refreshEventImageCount(eventId: string): void {
  const now = nowTimestamp();
  getDatabase().prepare(`
    UPDATE events
    SET total_images = (SELECT COUNT(*) FROM images WHERE event_id = ? AND is_deleted = 0), updated_at = ?
    WHERE id = ?
  `).run(eventId, now, eventId);
}

function basenameWithoutExtension(filename: string): string {
  const parsed = path.parse(path.basename(filename || "image"));
  return parsed.name || "image";
}

export function getImageDtoById(id: string, baseUrl: string): ImageDto {
  const image = getImageById(id);
  if (!image) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }
  return toImageDto(image, baseUrl);
}

export function updateImageRating(id: string, rating: number, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw { code: "INVALID_RATING", message: "rating 只能是 0-5 的整数" };
  }

  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET rating = ?, updated_at = ? WHERE id = ?").run(rating, now, id);
  writeOperationLog(id, existing.event_id, "image_rating_changed", { from: existing.rating, to: rating }, actor);
  return getImageDtoById(id, baseUrl);
}

export function updateImageStatus(id: string, status: string, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  if (!IMAGE_STATUSES.includes(status as ImageStatus)) {
    throw { code: "INVALID_STATUS", message: `无效的状态值：${status}` };
  }

  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  writeOperationLog(id, existing.event_id, "image_status_changed", { from: existing.status, to: status }, actor);
  return getImageDtoById(id, baseUrl);
}

export function updateImageCategory(id: string, category: string, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const normalized = typeof category === "string" ? category.trim() : "";
  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET category = ?, updated_at = ? WHERE id = ?").run(normalized, now, id);
  writeOperationLog(id, existing.event_id, "image_category_changed", { from: existing.category, to: normalized }, actor);
  return getImageDtoById(id, baseUrl);
}

export function updateImageRemark(id: string, remark: string, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const normalized = typeof remark === "string" ? remark.trim() : "";
  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET remark = ?, updated_at = ? WHERE id = ?").run(normalized, now, id);
  writeOperationLog(id, existing.event_id, "image_remark_changed", { from: existing.remark, to: normalized }, actor);
  return getImageDtoById(id, baseUrl);
}

export function deleteImage(id: string, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  writeOperationLog(id, existing.event_id, "image_deleted_logical", {
    original_filename: existing.original_filename,
    original_path: existing.original_path,
    thumb_path: existing.thumb_path,
    preview_path: existing.preview_path
  }, actor);
  refreshEventImageCount(existing.event_id);
  return getImageDtoById(id, baseUrl);
}

export function restoreImage(id: string, baseUrl: string, actor: ActorInfo = HOST_ACTOR): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }
  if (!existing.is_deleted) {
    throw { code: "IMAGE_NOT_DELETED", message: "图片不在回收站中" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET is_deleted = 0, deleted_at = '', updated_at = ? WHERE id = ?").run(now, id);
  writeOperationLog(id, existing.event_id, "image_restored", {
    original_filename: existing.original_filename,
    deleted_at: existing.deleted_at
  }, actor);
  refreshEventImageCount(existing.event_id);
  return getImageDtoById(id, baseUrl);
}

function collectImageFilePaths(image: ImageRow): string[] {
  return Array.from(new Set([
    image.original_path,
    image.thumb_path,
    image.preview_path,
    image.edited_path
  ].filter(Boolean)));
}

function isPathReferencedByOtherImage(imageId: string, filePath: string): boolean {
  const row = getDatabase().prepare(`
    SELECT id FROM images
    WHERE id != ?
      AND (original_path = ? OR thumb_path = ? OR preview_path = ? OR edited_path = ?)
    LIMIT 1
  `).get(imageId, filePath, filePath, filePath, filePath);
  return Boolean(row);
}

export async function purgeImage(id: string): Promise<ImagePurgeResult> {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }
  if (!existing.is_deleted) {
    throw { code: "IMAGE_NOT_DELETED", message: "只能永久删除回收站中的图片" };
  }

  const deletedFiles: string[] = [];
  const missingFiles: string[] = [];
  const errors: string[] = [];
  const filePaths = collectImageFilePaths(existing);

  for (const filePath of filePaths) {
    try {
      if (isPathReferencedByOtherImage(existing.id, filePath)) {
        errors.push(`文件仍被其他图片记录引用，已保留：${filePath}`);
        continue;
      }
      if (!fs.existsSync(filePath)) {
        missingFiles.push(filePath);
        continue;
      }
      await fs.remove(filePath);
      deletedFiles.push(filePath);
    } catch (err: any) {
      errors.push(`${filePath}: ${err?.message || "删除失败"}`);
    }
  }

  writeOperationLog(existing.id, existing.event_id, "image_purged", {
    original_filename: existing.original_filename,
    deleted_files: deletedFiles,
    missing_files: missingFiles,
    errors
  });

  const result = getDatabase().prepare("DELETE FROM images WHERE id = ?").run(existing.id);
  refreshEventImageCount(existing.event_id);

  return {
    imageId: existing.id,
    eventId: existing.event_id,
    deletedFiles,
    missingFiles,
    errors,
    deletedRecords: result.changes
  };
}

export function assertImageFile(id: string, kind: "thumb" | "preview"): { image: ImageRow; filePath: string } {
  const image = getImageById(id);
  if (!image) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const filePath = kind === "thumb" ? image.thumb_path : image.preview_path;
  if (!filePath || !fs.existsSync(filePath)) {
    throw { code: "IMAGE_FILE_NOT_FOUND", message: kind === "thumb" ? "缩略图文件不存在" : "预览图文件不存在" };
  }

  return { image, filePath };
}

export function assertImageDownloadFile(id: string, type: ImageDownloadType): ImageDownloadFile {
  const image = getImageById(id);
  if (!image) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  if (type === "edited" && !image.edited_path) {
    throw { code: "EDITED_IMAGE_NOT_AVAILABLE", message: "暂无已修图可下载" };
  }

  const filePath = type === "original"
    ? image.original_path
    : type === "preview"
      ? image.preview_path
      : image.edited_path;

  if (!filePath || !fs.existsSync(filePath)) {
    throw { code: "IMAGE_FILE_NOT_FOUND", message: "图片文件不存在" };
  }

  const originalBase = basenameWithoutExtension(image.original_filename);
  const filename = type === "original"
    ? path.basename(image.original_filename || image.stored_filename || filePath)
    : type === "preview"
      ? `${originalBase}_preview.webp`
      : path.basename(filePath);

  return { image, filePath, filename, type };
}

export function recordImageDownload(image: ImageRow, type: ImageDownloadType, filePath: string): void {
  const now = nowTimestamp();
  const db = getDatabase();

  db.prepare(`
    INSERT INTO download_logs (image_id, event_id, type, operator, device, file_path, created_at)
    VALUES (?, ?, ?, '', '', ?, ?)
  `).run(image.id, image.event_id, type, filePath, now);

  writeOperationLog(image.id, image.event_id, "image_downloaded", {
    download_type: type,
    file_path: filePath
  });
}

export interface EventSummary {
  event_id: string;
  total_images: number;
  edited_images: number;
}

/**
 * Lightweight event summary for the title bar.
 * Uses SQL COUNT only — no filesystem access.
 *
 * "已导入": total non-deleted images (is_deleted = 0).
 * "已修": images where edited_path is non-empty (covers edited, publish, published).
 */
export function getEventSummary(eventId: string): EventSummary {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_images,
      SUM(CASE WHEN edited_path != '' THEN 1 ELSE 0 END) AS edited_images
    FROM images
    WHERE event_id = ? AND is_deleted = 0
  `).get(eventId) as { total_images: number; edited_images: number };

  return {
    event_id: eventId,
    total_images: row?.total_images ?? 0,
    edited_images: row?.edited_images ?? 0
  };
}
