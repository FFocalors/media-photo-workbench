import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { getLogger } from "../utils/logger";
import SCHEMA_SQL from "./schema";

let _db: Database.Database | null = null;
let _dbPath = "";

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function runLightweightMigrations(db: Database.Database): void {
  const logger = getLogger();

  if (!columnExists(db, "images", "is_deleted")) {
    db.exec("ALTER TABLE images ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0");
    logger.info("数据库迁移完成：images.is_deleted");
  }

  if (!columnExists(db, "images", "deleted_at")) {
    db.exec("ALTER TABLE images ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
    logger.info("数据库迁移完成：images.deleted_at");
  }

  const imageColumns = [
    ["uploaded_by_client_id", "TEXT NOT NULL DEFAULT ''"],
    ["uploaded_by_name", "TEXT NOT NULL DEFAULT ''"],
    ["uploaded_by_role", "TEXT NOT NULL DEFAULT ''"],
    ["uploaded_at", "TEXT NOT NULL DEFAULT ''"]
  ] as const;
  for (const [column, definition] of imageColumns) {
    if (!columnExists(db, "images", column)) {
      db.exec(`ALTER TABLE images ADD COLUMN ${column} ${definition}`);
      logger.info(`数据库迁移完成：images.${column}`);
    }
  }

  const operationLogColumns = [
    ["actor_type", "TEXT NOT NULL DEFAULT ''"],
    ["actor_id", "TEXT NOT NULL DEFAULT ''"],
    ["actor_name", "TEXT NOT NULL DEFAULT ''"]
  ] as const;
  for (const [column, definition] of operationLogColumns) {
    if (!columnExists(db, "operation_logs", column)) {
      db.exec(`ALTER TABLE operation_logs ADD COLUMN ${column} ${definition}`);
      logger.info(`数据库迁移完成：operation_logs.${column}`);
    }
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(is_deleted)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_event_hash ON images(event_id, file_hash)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_uploaded_by_client ON images(event_id, uploaded_by_client_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_operation_logs_actor ON operation_logs(actor_type, actor_id)");
}

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
  try {
    runLightweightMigrations(db);
  } catch (err) {
    logger.error({ err, dbPath }, "数据库轻量迁移失败");
    throw err;
  }

  logger.info("数据库初始化完成，所有核心表已就绪");

  _db = db;
  _dbPath = dbPath;
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

export function getCurrentDatabasePath(): string {
  return _dbPath;
}

export function checkpointDatabase(): void {
  const db = getDatabase();
  db.pragma("wal_checkpoint(TRUNCATE)");
}

export async function backupDatabase(targetPath: string): Promise<void> {
  const db = getDatabase();
  fs.ensureDirSync(path.dirname(targetPath));
  checkpointDatabase();
  await db.backup(targetPath);
}

/**
 * 关闭数据库连接。
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = "";
    getLogger().info("数据库连接已关闭");
  }
}
