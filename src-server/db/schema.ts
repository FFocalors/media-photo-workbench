/**
 * SQLite 数据库 Schema 定义。
 * 所有表使用 CREATE TABLE IF NOT EXISTS，确保可重复执行。
 */

const SCHEMA_SQL = `
-- 活动表
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  date          TEXT NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('draft', 'active', 'reviewing', 'archived', 'deleted')),
  total_images  INTEGER NOT NULL DEFAULT 0,
  selected_images INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 图片表
CREATE TABLE IF NOT EXISTS images (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename   TEXT NOT NULL,
  thumb_path        TEXT NOT NULL DEFAULT '',
  preview_path      TEXT NOT NULL DEFAULT '',
  original_path     TEXT NOT NULL DEFAULT '',
  edited_path       TEXT NOT NULL DEFAULT '',
  photographer      TEXT NOT NULL DEFAULT '',
  camera_model      TEXT NOT NULL DEFAULT '',
  lens_model        TEXT NOT NULL DEFAULT '',
  shot_at           TEXT NOT NULL DEFAULT '',
  rating            INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'unselected'
                    CHECK (status IN ('unselected', 'rejected', 'archive', 'edit', 'edited', 'publish', 'published')),
  category          TEXT NOT NULL DEFAULT '',
  remark            TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'host_import'
                    CHECK (source IN ('host_import', 'client_upload', 'remote_import', 'manual_import')),
  uploaded_by_client_id TEXT NOT NULL DEFAULT '',
  uploaded_by_name  TEXT NOT NULL DEFAULT '',
  uploaded_by_role  TEXT NOT NULL DEFAULT '',
  uploaded_at       TEXT NOT NULL DEFAULT '',
  file_size         INTEGER NOT NULL DEFAULT 0,
  file_hash         TEXT NOT NULL DEFAULT '',
  exif_shot_at      TEXT NOT NULL DEFAULT '',
  width             INTEGER NOT NULL DEFAULT 0,
  height            INTEGER NOT NULL DEFAULT 0,
  is_deleted        INTEGER NOT NULL DEFAULT 0,
  deleted_at        TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 图片标签关联表
CREATE TABLE IF NOT EXISTS image_tags (
  image_id  TEXT NOT NULL,
  tag_id    TEXT NOT NULL,
  PRIMARY KEY (image_id, tag_id),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  operator    TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',
  actor_type  TEXT NOT NULL DEFAULT '',
  actor_id    TEXT NOT NULL DEFAULT '',
  actor_name  TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 下载日志表
CREATE TABLE IF NOT EXISTS download_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id    TEXT NOT NULL DEFAULT '',
  event_id    TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'original'
              CHECK (type IN ('original', 'preview', 'edited', 'zip', 'export')),
  operator    TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',
  file_path   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 导出任务表
CREATE TABLE IF NOT EXISTS export_jobs (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  spec          TEXT NOT NULL DEFAULT '',
  quality       INTEGER NOT NULL DEFAULT 90,
  total         INTEGER NOT NULL DEFAULT 0,
  finished      INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  output_path   TEXT NOT NULL DEFAULT '',
  operator      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 归档活动摘要表
CREATE TABLE IF NOT EXISTS archived_events (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  event_slug      TEXT NOT NULL,
  event_date      TEXT NOT NULL,
  total_images    INTEGER NOT NULL DEFAULT 0,
  edited_images   INTEGER NOT NULL DEFAULT 0,
  published_images INTEGER NOT NULL DEFAULT 0,
  archive_path    TEXT NOT NULL DEFAULT '',
  archived_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_images_event_id ON images(event_id);
CREATE INDEX IF NOT EXISTS idx_images_status ON images(status);
CREATE INDEX IF NOT EXISTS idx_images_rating ON images(rating);
CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash);
CREATE INDEX IF NOT EXISTS idx_images_event_hash ON images(event_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_operation_logs_target ON operation_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_download_logs_image ON download_logs(image_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_event ON export_jobs(event_id);
`;

export default SCHEMA_SQL;
