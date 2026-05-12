import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import { getDatabase } from "../db/database";
import { getConfig } from "../config/config";
import { getLogger } from "../utils/logger";

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

/**
 * 活动仓库工作目录结构（依据 AGENTS.md 定义）
 */
const EVENT_SUBDIRS = [
  "original/host_import",
  "original/client_upload",
  "original/remote_import",
  "thumbs",
  "previews",
  "edit_queue",
  "edited",
  "export/publish",
  "export/compressed",
  "export/zip",
  "manifests"
];

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

/**
 * 在仓库中为活动创建工作目录结构。
 * 如果仓库路径未设置或不存在，跳过。
 */
function ensureEventWorkingDirs(eventSlug: string): { created: boolean; path: string } {
  const logger = getLogger();
  const config = getConfig();
  const repoPath = config.repository.path;

  if (!repoPath) {
    logger.info("仓库路径未设置，跳过创建活动工作目录");
    return { created: false, path: "" };
  }

  if (!fs.existsSync(repoPath)) {
    logger.warn({ repoPath }, "仓库路径不存在，跳过创建活动工作目录");
    return { created: false, path: "" };
  }

  const eventDir = path.join(repoPath, "working", eventSlug);

  try {
    for (const subdir of EVENT_SUBDIRS) {
      fs.ensureDirSync(path.join(eventDir, subdir));
    }
    logger.info({ eventDir }, "活动工作目录已创建");
    return { created: true, path: eventDir };
  } catch (err) {
    logger.error({ err, eventDir }, "创建活动工作目录失败");
    return { created: false, path: eventDir };
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

  db.prepare(`
    INSERT INTO events (id, name, slug, date, location, status, total_images, selected_images, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', 0, 0, ?, ?)
  `).run(id, input.name, slug, input.date, input.location || "", now, now);

  logger.info({ id, slug }, "新活动已创建");

  // 尝试创建工作目录
  const workingDir = ensureEventWorkingDirs(slug);

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
