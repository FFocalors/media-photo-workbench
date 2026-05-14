import path from "path";
import fs from "fs-extra";
import { getDatabase } from "../db/database";

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
  edited_available: boolean;
  original_exists: boolean;
  thumb_exists: boolean;
  preview_exists: boolean;
  edited_exists: boolean;
  is_deleted: boolean;
  deleted_at: string;
}

export interface ImageListParams {
  page?: number;
  pageSize?: number;
  rating?: number;
  status?: string;
  sourceType?: string;
  keyword?: string;
}

export interface ImageListResult {
  items: ImageDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type ImageDownloadType = "original" | "preview" | "edited";

export interface ImageDownloadFile {
  image: ImageRow;
  filePath: string;
  filename: string;
  type: ImageDownloadType;
}

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function pathExists(filePath: string): boolean {
  return Boolean(filePath && fs.existsSync(filePath));
}

function toImageDto(row: ImageRow, baseUrl: string): ImageDto {
  const originalExists = pathExists(row.original_path);
  const thumbExists = pathExists(row.thumb_path);
  const previewExists = pathExists(row.preview_path);
  const editedExists = pathExists(row.edited_path);

  return {
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
    edited_available: editedExists,
    original_exists: originalExists,
    thumb_exists: thumbExists,
    preview_exists: previewExists,
    edited_exists: editedExists,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at
  };
}

export function getImageById(id: string): ImageRow | undefined {
  const db = getDatabase();
  return db.prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRow | undefined;
}

export function listEventImages(eventId: string, params: ImageListParams, baseUrl: string): ImageListResult {
  const db = getDatabase();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 80));
  const where: string[] = ["event_id = ?", "is_deleted = 0"];
  const values: unknown[] = [eventId];

  if (typeof params.rating === "number" && Number.isFinite(params.rating) && params.rating > 0) {
    where.push("rating >= ?");
    values.push(params.rating);
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
    items: rows.map((row) => toImageDto(row, baseUrl)),
    total,
    page,
    pageSize
  };
}

function writeOperationLog(imageId: string, eventId: string, type: string, detail: Record<string, unknown>): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
    VALUES (?, 'image', ?, '', '', ?, ?)
  `).run(type, imageId, JSON.stringify({ event_id: eventId, ...detail }), nowTimestamp());
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

export function updateImageRating(id: string, rating: number, baseUrl: string): ImageDto {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw { code: "INVALID_RATING", message: "rating 只能是 0-5 的整数" };
  }

  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET rating = ?, updated_at = ? WHERE id = ?").run(rating, now, id);
  writeOperationLog(id, existing.event_id, "image_rating_changed", { from: existing.rating, to: rating });
  return getImageDtoById(id, baseUrl);
}

export function updateImageStatus(id: string, status: string, baseUrl: string): ImageDto {
  if (!IMAGE_STATUSES.includes(status as ImageStatus)) {
    throw { code: "INVALID_STATUS", message: `无效的状态值：${status}` };
  }

  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  writeOperationLog(id, existing.event_id, "image_status_changed", { from: existing.status, to: status });
  return getImageDtoById(id, baseUrl);
}

export function updateImageCategory(id: string, category: string, baseUrl: string): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const normalized = typeof category === "string" ? category.trim() : "";
  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET category = ?, updated_at = ? WHERE id = ?").run(normalized, now, id);
  writeOperationLog(id, existing.event_id, "image_category_changed", { from: existing.category, to: normalized });
  return getImageDtoById(id, baseUrl);
}

export function updateImageRemark(id: string, remark: string, baseUrl: string): ImageDto {
  const existing = getImageById(id);
  if (!existing) {
    throw { code: "IMAGE_NOT_FOUND", message: "图片不存在" };
  }

  const normalized = typeof remark === "string" ? remark.trim() : "";
  const now = nowTimestamp();
  getDatabase().prepare("UPDATE images SET remark = ?, updated_at = ? WHERE id = ?").run(normalized, now, id);
  writeOperationLog(id, existing.event_id, "image_remark_changed", { from: existing.remark, to: normalized });
  return getImageDtoById(id, baseUrl);
}

export function deleteImage(id: string, baseUrl: string): ImageDto {
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
  });
  refreshEventImageCount(existing.event_id);
  return getImageDtoById(id, baseUrl);
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
