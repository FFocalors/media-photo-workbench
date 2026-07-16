import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { getLogger } from "../utils/logger";
import SCHEMA_SQL from "./schema";

let _db: Database.Database | null = null;
let _dbPath = "";
let migrationBackupSequence = 0;
export const PRE_MIGRATION_BACKUP_RETENTION = 3;

export const SCHEMA_MIGRATION_IDS = [
  "20260716_001_legacy_columns",
  "20260716_002_images_camera_ftp_source",
  "20260716_003_camera_ftp_receipt_content_hash",
  "20260716_004_current_indexes"
] as const;

export class DatabaseInitializationError extends Error {
  readonly code: "DATABASE_ALREADY_INITIALIZED" | "DATABASE_INITIALIZATION_FAILED" | "DATABASE_MIGRATION_FAILED";
  readonly migrationId: string;
  readonly backupPath: string;
  readonly originalError: unknown;

  constructor(input: {
    code: "DATABASE_ALREADY_INITIALIZED" | "DATABASE_INITIALIZATION_FAILED" | "DATABASE_MIGRATION_FAILED";
    message: string;
    originalError: unknown;
    migrationId?: string;
    backupPath?: string;
  }) {
    super(input.message);
    this.name = "DatabaseInitializationError";
    this.code = input.code;
    this.migrationId = input.migrationId ?? "";
    this.backupPath = input.backupPath ?? "";
    this.originalError = input.originalError;
  }
}

interface SchemaMigration {
  id: typeof SCHEMA_MIGRATION_IDS[number];
  isNeeded(db: Database.Database): boolean;
  apply(db: Database.Database): void;
  risk: "lightweight" | "table_rebuild";
  disableForeignKeys?: boolean;
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function tableCreateSql(db: Database.Database, tableName: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function verifyDatabaseFile(dbPath: string): void {
  let verificationDb: Database.Database | null = null;
  try {
    verificationDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    const result = verificationDb.pragma("quick_check", { simple: true });
    if (result !== "ok") {
      throw new Error("DATABASE_BACKUP_QUICK_CHECK_FAILED");
    }
  } finally {
    verificationDb?.close();
  }
}

function createPreMigrationBackup(db: Database.Database, dbPath: string, migrationId: string): string {
  const backupDir = path.join(path.dirname(dbPath), ".migration-backups");
  fs.ensureDirSync(backupDir);
  migrationBackupSequence += 1;
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const safeMigrationId = migrationId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const backupPath = path.join(
    backupDir,
    `app-before-${safeMigrationId}-${timestamp}-${process.pid}-${migrationBackupSequence}.db`
  );

  try {
    db.pragma("wal_checkpoint(FULL)");
    db.exec(`VACUUM INTO ${sqlString(backupPath)}`);
    verifyDatabaseFile(backupPath);
    prunePreMigrationBackups(backupDir, migrationId, backupPath);
    return backupPath;
  } catch (error) {
    fs.removeSync(backupPath);
    throw error;
  }
}

function prunePreMigrationBackups(backupDir: string, migrationId: string, newestBackupPath: string): void {
  const safeMigrationId = migrationId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const prefix = `app-before-${safeMigrationId}-`;
  let candidates: string[];
  try {
    candidates = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".db"))
      .map((entry) => path.join(backupDir, entry.name))
      .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  } catch {
    getLogger().warn({ migrationId, code: "DATABASE_MIGRATION_BACKUP_RETENTION_SCAN_FAILED" }, "无法检查数据库迁移备份保留数量");
    return;
  }

  const ordered = [
    newestBackupPath,
    ...candidates.filter((candidate) => path.resolve(candidate) !== path.resolve(newestBackupPath))
  ];
  for (const stalePath of ordered.slice(PRE_MIGRATION_BACKUP_RETENTION)) {
    try {
      fs.removeSync(stalePath);
    } catch {
      getLogger().warn({ migrationId, fileName: path.basename(stalePath), code: "DATABASE_MIGRATION_BACKUP_RETENTION_DELETE_FAILED" }, "无法清理旧数据库迁移备份");
    }
  }
}

function recreateImageIndexes(db: Database.Database): void {
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_event_id ON images(event_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_status ON images(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_rating ON images(rating)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(is_deleted)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_event_hash ON images(event_id, file_hash)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_images_uploaded_by_client ON images(event_id, uploaded_by_client_id)");
}

function imagesSourceNeedsCameraFtpMigration(db: Database.Database): boolean {
  const createSql = tableCreateSql(db, "images");
  return Boolean(createSql && !createSql.includes("'camera_ftp'"));
}

function rebuildImagesSourceForCameraFtp(db: Database.Database): void {
  if (!imagesSourceNeedsCameraFtpMigration(db)) return;

  const columns = [
    "id",
    "event_id",
    "original_filename",
    "stored_filename",
    "thumb_path",
    "preview_path",
    "original_path",
    "edited_path",
    "photographer",
    "camera_model",
    "lens_model",
    "shot_at",
    "rating",
    "status",
    "category",
    "remark",
    "source",
    "uploaded_by_client_id",
    "uploaded_by_name",
    "uploaded_by_role",
    "uploaded_at",
    "file_size",
    "file_hash",
    "exif_shot_at",
    "width",
    "height",
    "is_deleted",
    "deleted_at",
    "created_at",
    "updated_at"
  ];
  const columnList = columns.join(", ");

  db.exec(`
        DROP TABLE IF EXISTS images_camera_ftp_migration;
        CREATE TABLE images_camera_ftp_migration (
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
                            CHECK (source IN ('host_import', 'client_upload', 'camera_ftp', 'remote_import', 'manual_import')),
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
        INSERT INTO images_camera_ftp_migration (${columnList})
        SELECT ${columnList} FROM images;
        DROP TABLE images;
        ALTER TABLE images_camera_ftp_migration RENAME TO images;
      `);
}

function legacyColumnsNeedMigration(db: Database.Database): boolean {
  const expectedColumns = [
    ["images", "is_deleted"],
    ["images", "deleted_at"],
    ["images", "uploaded_by_client_id"],
    ["images", "uploaded_by_name"],
    ["images", "uploaded_by_role"],
    ["images", "uploaded_at"],
    ["operation_logs", "actor_type"],
    ["operation_logs", "actor_id"],
    ["operation_logs", "actor_name"]
  ] as const;
  return expectedColumns.some(([tableName, columnName]) => !columnExists(db, tableName, columnName));
}

function addLegacyColumns(db: Database.Database): void {
  if (!columnExists(db, "images", "is_deleted")) {
    db.exec("ALTER TABLE images ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0");
  }

  if (!columnExists(db, "images", "deleted_at")) {
    db.exec("ALTER TABLE images ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
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
    }
  }
}

function ensureCurrentIndexes(db: Database.Database): void {
  recreateImageIndexes(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_operation_logs_actor ON operation_logs(actor_type, actor_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_camera_ftp_receipts_event ON camera_ftp_file_receipts(event_id)");
}

const CURRENT_INDEX_NAMES = [
  "idx_images_event_id",
  "idx_images_status",
  "idx_images_rating",
  "idx_images_file_hash",
  "idx_images_deleted",
  "idx_images_event_hash",
  "idx_images_uploaded_by_client",
  "idx_operation_logs_actor",
  "idx_camera_ftp_receipts_event"
] as const;

function currentIndexesNeedMigration(db: Database.Database): boolean {
  const indexes = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name)
  );
  return CURRENT_INDEX_NAMES.some((indexName) => !indexes.has(indexName));
}

const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    id: SCHEMA_MIGRATION_IDS[0],
    risk: "lightweight",
    isNeeded: legacyColumnsNeedMigration,
    apply: addLegacyColumns
  },
  {
    id: SCHEMA_MIGRATION_IDS[1],
    risk: "table_rebuild",
    disableForeignKeys: true,
    isNeeded: imagesSourceNeedsCameraFtpMigration,
    apply: rebuildImagesSourceForCameraFtp
  },
  {
    id: SCHEMA_MIGRATION_IDS[2],
    risk: "lightweight",
    isNeeded: (db) => !columnExists(db, "camera_ftp_file_receipts", "content_hash"),
    apply: (db) => {
      db.exec("ALTER TABLE camera_ftp_file_receipts ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
    }
  },
  {
    id: SCHEMA_MIGRATION_IDS[3],
    risk: "lightweight",
    isNeeded: currentIndexesNeedMigration,
    apply: ensureCurrentIndexes
  }
];

function runSchemaMigrations(db: Database.Database, dbPath: string): void {
  const logger = getLogger();
  const appliedIds = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((row) => row.id)
  );

  for (const migration of SCHEMA_MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      let stillNeeded = false;
      try {
        stillNeeded = migration.isNeeded(db);
      } catch (error) {
        throw new DatabaseInitializationError({
          code: "DATABASE_MIGRATION_FAILED",
          message: `数据库迁移账本校验失败：${migration.id}`,
          originalError: error,
          migrationId: migration.id
        });
      }
      if (stillNeeded) {
        throw new DatabaseInitializationError({
          code: "DATABASE_MIGRATION_FAILED",
          message: `数据库迁移账本与实际 Schema 不一致：${migration.id}`,
          originalError: new Error("DATABASE_SCHEMA_MIGRATION_LEDGER_MISMATCH"),
          migrationId: migration.id
        });
      }
      continue;
    }

    const needed = migration.isNeeded(db);
    let backupPath = "";
    if (needed && migration.risk === "table_rebuild") {
      try {
        backupPath = createPreMigrationBackup(db, dbPath, migration.id);
      } catch (error) {
        throw new DatabaseInitializationError({
          code: "DATABASE_MIGRATION_FAILED",
          message: `数据库迁移前备份失败：${migration.id}`,
          originalError: error,
          migrationId: migration.id
        });
      }
    }

    const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true })) === 1;
    if (needed && migration.disableForeignKeys && foreignKeysEnabled) {
      db.pragma("foreign_keys = OFF");
    }

    try {
      const executeMigration = db.transaction(() => {
        if (needed) migration.apply(db);
        if (needed && migration.disableForeignKeys) {
          const violations = db.pragma("foreign_key_check") as unknown[];
          if (violations.length > 0) {
            throw new Error("DATABASE_MIGRATION_FOREIGN_KEY_CHECK_FAILED");
          }
        }
        db.prepare(`
          INSERT INTO schema_migrations (id, applied_at, backup_path)
          VALUES (?, datetime('now', 'localtime'), ?)
        `).run(migration.id, backupPath);
      });
      executeMigration();
      appliedIds.add(migration.id);
      logger.info({ migrationId: migration.id, backupPath }, "数据库 Schema 迁移完成");
    } catch (error) {
      throw new DatabaseInitializationError({
        code: "DATABASE_MIGRATION_FAILED",
        message: `数据库 Schema 迁移失败：${migration.id}`,
        originalError: error,
        migrationId: migration.id,
        backupPath
      });
    } finally {
      if (needed && migration.disableForeignKeys && foreignKeysEnabled) {
        db.pragma("foreign_keys = ON");
      }
    }
  }
}

/**
 * 初始化 SQLite 数据库。
 * - 确保数据目录存在
 * - 创建数据库文件（如果不存在）
 * - 开启 WAL 模式
 * - 执行建表 SQL
 */
export function initDatabase(dbPath: string): Database.Database {
  if (_db) {
    throw new DatabaseInitializationError({
      code: "DATABASE_ALREADY_INITIALIZED",
      message: "数据库已经初始化，请先关闭当前连接后再初始化其他数据库",
      originalError: null
    });
  }

  const logger = getLogger();
  const dir = path.dirname(dbPath);
  fs.ensureDirSync(dir);

  logger.info({ dbPath }, "正在初始化数据库...");

  const db = new Database(dbPath);
  try {
    // 必须开启 WAL 模式；迁移失败时绝不发布这个连接为全局实例。
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const ensureSchema = db.transaction(() => db.exec(SCHEMA_SQL));
    ensureSchema();
    runSchemaMigrations(db, dbPath);

    const foreignKeyViolations = db.pragma("foreign_key_check") as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error("DATABASE_FOREIGN_KEY_CHECK_FAILED");
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      // Initialization is already failing; the original migration error is authoritative.
    }
    _db = null;
    _dbPath = "";
    const initError = error instanceof DatabaseInitializationError
      ? error
      : new DatabaseInitializationError({
        code: "DATABASE_INITIALIZATION_FAILED",
        message: "数据库初始化失败，应用已停止使用该数据库",
        originalError: error
      });
    logger.error({ err: initError, dbPath }, "数据库初始化失败，已关闭连接");
    throw initError;
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
