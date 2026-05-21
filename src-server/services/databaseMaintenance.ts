import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { getConfig, saveConfig, type AppConfig } from "../config/config";
import { backupDatabase, checkpointDatabase, getCurrentDatabasePath } from "../db/database";
import { checkRepository } from "./repository";
import { safeLog } from "../utils/logger";

export interface DatabaseBackupResult {
  backupPath: string;
  size: number;
  createdAt: string;
  method: "sqlite-backup";
  kind: "manual" | "auto" | "migration";
}

export interface DatabaseBackupListItem {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  kind: "manual" | "auto" | "migration" | "unknown";
}

export interface DatabaseMigrationResult {
  oldPath: string;
  newPath: string;
  backupPath: string;
  requiresRestart: true;
}

interface ServiceError extends Error {
  code?: string;
  status?: number;
}

function createServiceError(code: string, message: string, status = 400): ServiceError {
  const err = new Error(message) as ServiceError;
  err.code = code;
  err.status = status;
  return err;
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function getBackupKindFromName(name: string): DatabaseBackupListItem["kind"] {
  if (name.startsWith("app-manual-")) return "manual";
  if (name.startsWith("app-auto-")) return "auto";
  if (name.startsWith("app-migration-")) return "migration";
  return "unknown";
}

function ensureBackupDirectory(): string {
  const config = getConfig();
  const repoPath = config.repository.path.trim();
  if (!repoPath) {
    throw createServiceError("REPOSITORY_NOT_CONFIGURED", "请先配置仓库路径后再备份数据库。");
  }

  const repoCheck = checkRepository(repoPath);
  if (!repoCheck.exists) {
    throw createServiceError("REPOSITORY_NOT_FOUND", `仓库路径不存在：${repoPath}`);
  }
  if (!repoCheck.readable) {
    throw createServiceError("REPOSITORY_NOT_READABLE", `仓库路径不可读：${repoPath}`);
  }
  if (!repoCheck.writable) {
    throw createServiceError("REPOSITORY_NOT_WRITABLE", `仓库路径不可写：${repoPath}`);
  }

  const backupDir = path.join(repoPath, "metadata", "database-backups");
  fs.ensureDirSync(backupDir);
  return backupDir;
}

export async function createDatabaseBackup(kind: "manual" | "auto" | "migration" = "manual"): Promise<DatabaseBackupResult> {
  const backupDir = ensureBackupDirectory();
  const createdAt = new Date().toISOString();
  const backupPath = path.join(backupDir, `app-${kind}-${formatTimestamp()}.db`);

  try {
    await backupDatabase(backupPath);
    const stat = await fs.stat(backupPath);
    const result: DatabaseBackupResult = {
      backupPath,
      size: stat.size,
      createdAt,
      method: "sqlite-backup",
      kind
    };

    if (kind === "auto") {
      const config = getConfig();
      saveConfig({
        database: {
          ...config.database,
          lastAutoBackupAt: createdAt
        }
      });
      await pruneAutoBackups(config.database.autoBackupRetention);
    }

    safeLog("info", { backupPath, kind, size: result.size }, "数据库备份完成");
    return result;
  } catch (err) {
    safeLog("warn", { err, backupPath, kind }, "数据库备份失败");
    throw err;
  }
}

export async function listDatabaseBackups(): Promise<DatabaseBackupListItem[]> {
  const backupDir = ensureBackupDirectory();
  const names = await fs.readdir(backupDir);
  const items: DatabaseBackupListItem[] = [];

  for (const name of names) {
    if (!name.toLowerCase().endsWith(".db")) continue;
    const itemPath = path.join(backupDir, name);
    try {
      const stat = await fs.stat(itemPath);
      if (!stat.isFile()) continue;
      items.push({
        name,
        path: itemPath,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        kind: getBackupKindFromName(name)
      });
    } catch {
      // Ignore files that disappear while listing.
    }
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function pruneAutoBackups(retention: number): Promise<void> {
  const backups = (await listDatabaseBackups())
    .filter((item) => item.kind === "auto")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const item of backups.slice(retention)) {
    try {
      await fs.remove(item.path);
      safeLog("info", { backupPath: item.path }, "已清理过期自动数据库备份");
    } catch (err) {
      safeLog("warn", { err, backupPath: item.path }, "清理过期自动数据库备份失败");
    }
  }
}

export async function runStartupAutoBackup(): Promise<DatabaseBackupResult | null> {
  const config = getConfig();
  if (!config.database.autoBackupEnabled) return null;

  const lastBackupAt = config.database.lastAutoBackupAt
    ? new Date(config.database.lastAutoBackupAt).getTime()
    : 0;
  const ageMs = Date.now() - lastBackupAt;
  if (lastBackupAt > 0 && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) {
    return null;
  }

  try {
    return await createDatabaseBackup("auto");
  } catch (err) {
    safeLog("warn", { err }, "启动自动备份数据库失败，已跳过，不影响应用启动");
    return null;
  }
}

function normalizeForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSubPath(parentPath: string, childPath: string): boolean {
  const parent = normalizeForCompare(parentPath);
  const child = normalizeForCompare(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function validateMigrationTarget(targetPath: string): void {
  const normalized = normalizeForCompare(targetPath);
  const blockedSegments = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}dist${path.sep}`,
    `${path.sep}dist-server${path.sep}`,
    `${path.sep}release${path.sep}`,
    `${path.sep}release-pack${path.sep}`,
    `${path.sep}release-win${path.sep}`,
    `${path.sep}temp${path.sep}`
  ];
  if (blockedSegments.some((segment) => normalized.includes(segment))) {
    throw createServiceError("INVALID_DATABASE_TARGET", "目标位置不适合作为数据库目录，请选择稳定的本机数据目录。");
  }

  const repoPath = getConfig().repository.path.trim();
  if (repoPath && isSubPath(path.join(repoPath, "working"), targetPath)) {
    throw createServiceError("INVALID_DATABASE_TARGET", "不能将数据库迁移到图片仓库 working 活动目录内。");
  }
}

async function ensureDirectoryWritable(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  const probePath = path.join(dir, `.mpw-write-test-${Date.now()}.tmp`);
  try {
    await fs.writeFile(probePath, "ok", "utf8");
  } finally {
    await fs.remove(probePath).catch(() => undefined);
  }
}

function verifyDatabaseFile(dbPath: string): void {
  let verifyDb: Database.Database | null = null;
  try {
    verifyDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    verifyDb.prepare("SELECT name FROM sqlite_master LIMIT 1").all();
  } finally {
    verifyDb?.close();
  }
}

export async function migrateDatabaseLocation(input: {
  targetDirectory?: string;
  targetPath?: string;
}): Promise<DatabaseMigrationResult> {
  const oldPath = getCurrentDatabasePath();
  if (!oldPath) {
    throw createServiceError("DATABASE_NOT_INITIALIZED", "数据库尚未初始化，无法迁移。", 500);
  }

  const targetPath = input.targetPath?.trim()
    ? path.resolve(input.targetPath.trim())
    : input.targetDirectory?.trim()
      ? path.join(path.resolve(input.targetDirectory.trim()), "app.db")
      : "";

  if (!targetPath) {
    throw createServiceError("INVALID_DATABASE_TARGET", "请选择目标数据库目录。");
  }

  if (normalizeForCompare(oldPath) === normalizeForCompare(targetPath)) {
    throw createServiceError("SAME_DATABASE_PATH", "目标数据库路径与当前路径相同。");
  }

  validateMigrationTarget(targetPath);
  const targetDir = path.dirname(targetPath);
  await ensureDirectoryWritable(targetDir);

  if (await fs.pathExists(targetPath)) {
    throw createServiceError("TARGET_DATABASE_EXISTS", `目标数据库文件已存在：${targetPath}`);
  }

  const previousDatabaseConfig: AppConfig["database"] = { ...getConfig().database };
  const backup = await createDatabaseBackup("migration");
  const tempPath = path.join(targetDir, `app.db.migrating-${Date.now()}.tmp`);

  try {
    checkpointDatabase();
    await backupDatabase(tempPath);
    const stat = await fs.stat(tempPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw createServiceError("MIGRATED_DATABASE_EMPTY", "迁移生成的数据库文件为空。", 500);
    }

    await fs.rename(tempPath, targetPath);
    verifyDatabaseFile(targetPath);

    saveConfig({
      database: {
        ...previousDatabaseConfig,
        path: targetPath
      }
    });

    safeLog("info", { oldPath, targetPath, backupPath: backup.backupPath }, "数据库位置迁移完成，重启后生效");
    return {
      oldPath,
      newPath: targetPath,
      backupPath: backup.backupPath,
      requiresRestart: true
    };
  } catch (err) {
    await fs.remove(tempPath).catch(() => undefined);
    try {
      saveConfig({ database: previousDatabaseConfig });
    } catch (restoreErr) {
      safeLog("error", { restoreErr }, "数据库迁移失败后恢复配置失败");
    }
    safeLog("error", { err, oldPath, targetPath }, "数据库位置迁移失败，配置已回滚");
    throw err;
  }
}

export function toServiceError(err: unknown, fallbackCode: string, fallbackMessage: string): ServiceError {
  if (err instanceof Error) {
    const serviceErr = err as ServiceError;
    if (!serviceErr.code) serviceErr.code = fallbackCode;
    if (!serviceErr.status) serviceErr.status = 500;
    return serviceErr;
  }
  return createServiceError(fallbackCode, fallbackMessage, 500);
}
