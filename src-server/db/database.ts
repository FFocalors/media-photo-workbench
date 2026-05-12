import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { getLogger } from "../utils/logger";
import SCHEMA_SQL from "./schema";

let _db: Database.Database | null = null;

/**
 * 初始化 SQLite 数据库。
 * - 确保数据目录存在
 * - 创建数据库文件（如果不存在）
 * - 开启 WAL 模式
 * - 执行建表 SQL
 */
export function initDatabase(dbPath: string): Database.Database {
  const logger = getLogger();
  const dir = path.dirname(dbPath);
  fs.ensureDirSync(dir);

  logger.info({ dbPath }, "正在初始化数据库...");

  const db = new Database(dbPath);

  // 必须开启 WAL 模式
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 执行建表 SQL
  db.exec(SCHEMA_SQL);

  logger.info("数据库初始化完成，所有核心表已就绪");

  _db = db;
  return db;
}

/**
 * 获取已初始化的数据库实例。
 */
export function getDatabase(): Database.Database {
  if (!_db) {
    throw new Error("数据库未初始化，请先调用 initDatabase()");
  }
  return _db;
}

/**
 * 关闭数据库连接。
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    getLogger().info("数据库连接已关闭");
  }
}
