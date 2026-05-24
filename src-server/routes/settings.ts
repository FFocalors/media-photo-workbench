import { Router } from "express";
import { getConfig, saveConfig, type BatchSelectionBehavior } from "../config/config";
import { checkRepository } from "../services/repository";
import { getCurrentDatabasePath } from "../db/database";
import { getDefaultDatabasePath, resolveDatabasePath } from "../utils/paths";
import { getLogger } from "../utils/logger";
import { sendSuccess, sendError } from "../utils/response";
import {
  createDatabaseBackup,
  listDatabaseBackups,
  migrateDatabaseLocation,
  toServiceError
} from "../services/databaseMaintenance";

let _appDataRoot = "";

export function setAppDataRoot(root: string): void {
  _appDataRoot = root;
}

const router = Router();

/**
 * GET /api/settings
 * 返回当前配置信息。
 */
router.get("/", (_req, res) => {
  const config = getConfig();
  sendSuccess(res, {
    server: config.server,
    repository: config.repository,
    database: {
      path: getCurrentDatabasePath() || resolveDatabasePath(_appDataRoot, config.database.path),
      configuredPath: config.database.path,
      defaultPath: getDefaultDatabasePath(_appDataRoot),
      autoBackupEnabled: config.database.autoBackupEnabled,
      lastAutoBackupAt: config.database.lastAutoBackupAt,
      autoBackupRetention: config.database.autoBackupRetention
    },
    gallery: config.gallery
  });
});

/**
 * PATCH /api/settings/gallery
 * 更新图片墙偏好设置。
 */
router.patch("/gallery", (req, res) => {
  const behavior = req.body?.batchSelectionBehavior as BatchSelectionBehavior | undefined;
  if (behavior !== undefined && behavior !== "clear" && behavior !== "keep") {
    sendError(res, "INVALID_BATCH_SELECTION_BEHAVIOR", "batchSelectionBehavior 只能是 clear 或 keep");
    return;
  }

  const config = getConfig();
  try {
    const next = saveConfig({
      gallery: {
        ...config.gallery,
        batchSelectionBehavior: behavior ?? config.gallery.batchSelectionBehavior
      }
    });
    sendSuccess(res, next.gallery);
  } catch (err) {
    getLogger().error({ err }, "保存图片墙偏好失败");
    sendError(res, "SAVE_GALLERY_SETTINGS_FAILED", "保存图片墙偏好失败", 500);
  }
});

/**
 * PATCH /api/settings/repository
 * 更新仓库路径。
 * 保存路径到配置文件，并返回路径检查结果。
 * 不会自动创建仓库目录。
 */
router.patch("/repository", (req, res) => {
  const logger = getLogger();
  const { path: repoPath } = req.body;

  if (typeof repoPath !== "string") {
    sendError(res, "INVALID_PATH", "path 字段必须是字符串");
    return;
  }

  const normalizedRepoPath = repoPath.trim();
  if (!normalizedRepoPath) {
    sendError(res, "INVALID_PATH", "仓库路径不能为空");
    return;
  }

  try {
    // 保存路径到配置
    saveConfig({ repository: { path: normalizedRepoPath } });

    // 检查路径状态（不会自动创建目录）
    const checkResult = checkRepository(normalizedRepoPath);

    logger.info({ repoPath: normalizedRepoPath, checkResult }, "仓库路径已更新");

    sendSuccess(res, {
      saved: true,
      ...checkResult
    });
  } catch (err) {
    logger.error({ err }, "更新仓库路径失败");
    sendError(res, "SAVE_CONFIG_FAILED", "保存配置失败", 500);
  }
});

/**
 * POST /api/settings/database/backup
 * 手动备份当前 SQLite 数据库到仓库 metadata/database-backups。
 */
router.post("/database/backup", async (_req, res) => {
  try {
    const result = await createDatabaseBackup("manual");
    sendSuccess(res, result);
  } catch (err) {
    const serviceError = toServiceError(err, "DATABASE_BACKUP_FAILED", "数据库备份失败");
    sendError(res, serviceError.code ?? "DATABASE_BACKUP_FAILED", serviceError.message, serviceError.status ?? 500);
  }
});

/**
 * GET /api/settings/database/backups
 * 返回当前仓库中的数据库备份列表。
 */
router.get("/database/backups", async (_req, res) => {
  try {
    const backups = await listDatabaseBackups();
    sendSuccess(res, backups);
  } catch (err) {
    const serviceError = toServiceError(err, "DATABASE_BACKUP_LIST_FAILED", "读取数据库备份列表失败");
    sendError(res, serviceError.code ?? "DATABASE_BACKUP_LIST_FAILED", serviceError.message, serviceError.status ?? 500);
  }
});

/**
 * POST /api/settings/database/migrate
 * 将数据库复制到新位置并写入 config.database.path。当前进程仍使用旧连接，重启后生效。
 */
router.post("/database/migrate", async (req, res) => {
  try {
    const result = await migrateDatabaseLocation({
      targetDirectory: typeof req.body?.targetDirectory === "string" ? req.body.targetDirectory : undefined,
      targetPath: typeof req.body?.targetPath === "string" ? req.body.targetPath : undefined
    });
    sendSuccess(res, result);
  } catch (err) {
    const serviceError = toServiceError(err, "DATABASE_MIGRATION_FAILED", "数据库位置迁移失败");
    sendError(res, serviceError.code ?? "DATABASE_MIGRATION_FAILED", serviceError.message, serviceError.status ?? 500);
  }
});

export default router;
