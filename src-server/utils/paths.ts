import path from "path";
import fs from "fs-extra";

/**
 * 解析应用数据根目录下的各子目录路径。
 * appDataRoot 在开发环境下为项目根目录，在生产环境下为 app.getPath("userData")。
 */

export function getDataDir(appDataRoot: string): string {
  return path.join(appDataRoot, "data");
}

export function getConfigDir(appDataRoot: string): string {
  return path.join(appDataRoot, "config");
}

export function getLogsDir(appDataRoot: string): string {
  return path.join(appDataRoot, "logs");
}

export function getDatabasePath(appDataRoot: string): string {
  return path.join(getDataDir(appDataRoot), "app.db");
}

export function getConfigFilePath(appDataRoot: string): string {
  return path.join(getConfigDir(appDataRoot), "config.json");
}

/**
 * 确保数据目录结构存在。
 */
export function ensureDataDirs(appDataRoot: string): void {
  fs.ensureDirSync(getDataDir(appDataRoot));
  fs.ensureDirSync(getConfigDir(appDataRoot));
  fs.ensureDirSync(getLogsDir(appDataRoot));
}
