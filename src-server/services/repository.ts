import fs from "fs-extra";
import { getLogger } from "../utils/logger";

export interface RepositoryCheckResult {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  freeSpace: number | null;
  path: string;
}

/**
 * 检查仓库路径的状态。
 * 不会自动创建目录——如果路径不存在，返回 exists: false。
 * Windows 剩余空间当前返回 null，后续可扩展。
 */
export function checkRepository(repoPath: string): RepositoryCheckResult {
  const logger = getLogger();
  const result: RepositoryCheckResult = {
    exists: false,
    readable: false,
    writable: false,
    freeSpace: null,
    path: repoPath
  };

  if (!repoPath) {
    logger.warn("仓库路径为空");
    return result;
  }

  try {
    result.exists = fs.existsSync(repoPath);
  } catch {
    logger.warn({ repoPath }, "检查仓库路径存在性时出错");
    return result;
  }

  if (!result.exists) {
    return result;
  }

  // 检查可读
  try {
    fs.accessSync(repoPath, fs.constants.R_OK);
    result.readable = true;
  } catch {
    logger.warn({ repoPath }, "仓库路径不可读");
  }

  // 检查可写
  try {
    fs.accessSync(repoPath, fs.constants.W_OK);
    result.writable = true;
  } catch {
    logger.warn({ repoPath }, "仓库路径不可写");
  }

  // freeSpace: Windows 下可通过 child_process 调用 wmic / PowerShell 获取，
  // 第一阶段暂返回 null，避免引入复杂依赖。
  result.freeSpace = null;

  return result;
}
