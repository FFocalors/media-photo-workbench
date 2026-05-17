import fs from "fs-extra";
import { execSync } from "child_process";
import { getLogger } from "../utils/logger";

export interface RepositoryCheckResult {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  freeSpace: number | null;
  totalSpace: number | null;
  freeSpaceBytes: number | null;
  totalSpaceBytes: number | null;
  usedSpaceBytes: number | null;
  freeSpaceText: string;
  totalSpaceText: string;
  capacityError: string;
  path: string;
}

/**
 * 检查仓库路径的状态。
 * 不会自动创建目录——如果路径不存在，返回 exists: false。
 * Windows 下通过 PowerShell 获取磁盘剩余空间和总容量。
 */
export function checkRepository(repoPath: string): RepositoryCheckResult {
  const logger = getLogger();
  const result: RepositoryCheckResult = {
    exists: false,
    readable: false,
    writable: false,
    freeSpace: null,
    totalSpace: null,
    freeSpaceBytes: null,
    totalSpaceBytes: null,
    usedSpaceBytes: null,
    freeSpaceText: "",
    totalSpaceText: "",
    capacityError: "",
    path: repoPath
  };

  if (!repoPath) {
    result.capacityError = "未配置仓库路径";
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
    result.capacityError = "仓库路径不存在";
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

  // 获取磁盘剩余空间和总容量
  try {
    const diskInfo = getDiskSpace(repoPath);
    result.freeSpace = diskInfo.free;
    result.totalSpace = diskInfo.total;
    result.freeSpaceBytes = diskInfo.free;
    result.totalSpaceBytes = diskInfo.total;
    result.usedSpaceBytes = Math.max(0, diskInfo.total - diskInfo.free);
    result.freeSpaceText = formatBytes(diskInfo.free);
    result.totalSpaceText = formatBytes(diskInfo.total);
  } catch (err) {
    result.capacityError = err instanceof Error ? err.message : String(err);
    logger.warn({ repoPath, err }, "获取磁盘空间信息失败");
  }

  return result;
}

interface DiskSpaceInfo {
  free: number;
  total: number;
}

/**
 * 通过 PowerShell 获取指定路径所在磁盘的可用空间和总容量。
 * 支持中文路径、空格路径、移动硬盘、网络驱动器。
 * 使用 -EncodedCommand 传递 Base64 编码脚本，避免引号转义问题。
 * 失败时抛出异常，由调用方降级处理。
 */
function getDiskSpace(repoPath: string): DiskSpaceInfo {
  // 将路径中的单引号转义为 PowerShell 的双单引号
  const safePath = repoPath.replace(/'/g, "''");

  const psScript = `
$path = '${safePath}'
$volume = Get-Volume -FilePath $path -ErrorAction Stop
@{
  Free  = $volume.SizeRemaining
  Total = $volume.Size
} | ConvertTo-Json -Compress
`.trim();

  // PowerShell -EncodedCommand 要求 UTF-16LE (Unicode) 编码的 Base64
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");

  const output = execSync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true
    }
  );

  const parsed = JSON.parse(output.trim());
  const free = typeof parsed.Free === "number" ? parsed.Free : null;
  const total = typeof parsed.Total === "number" ? parsed.Total : null;

  if (free == null || total == null) {
    throw new Error("PowerShell 返回的磁盘信息不完整");
  }

  return { free, total };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
