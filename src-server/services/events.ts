import crypto from "crypto";
import { getDatabase } from "../db/database";
import { getLogger } from "../utils/logger";
import { ensureEventWorkingDirs } from "./eventWorkspace";

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
