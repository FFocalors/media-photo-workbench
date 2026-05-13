import { Router } from "express";
import { getConfig, saveConfig } from "../config/config";
import { checkRepository } from "../services/repository";
import { getDatabasePath } from "../utils/paths";
import { getLogger } from "../utils/logger";
import { sendSuccess, sendError } from "../utils/response";

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
      path: getDatabasePath(_appDataRoot)
    }
  });
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

export default router;
