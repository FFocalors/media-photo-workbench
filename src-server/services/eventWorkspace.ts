import path from "path";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getLogger } from "../utils/logger";
import { checkRepository } from "./repository";

export const EVENT_SUBDIRS = [
  "原图/主机导入",
  "原图/客户端上传",
  "原图/远程导入",
  "缩略图",
  "预览图",
  "待修图",
  "已修图",
  "导出/发布图",
  "导出/压缩图",
  "导出/压缩包",
  "清单"
];

export interface EventWorkspacePaths {
  eventDir: string;
  hostImportOriginalDir: string;
  clientUploadOriginalDir: string;
  remoteImportOriginalDir: string;
  thumbsDir: string;
  previewsDir: string;
  editQueueDir: string;
  editedDir: string;
  publishExportDir: string;
  compressedExportDir: string;
  zipExportDir: string;
  manifestsDir: string;
}

export function getEventWorkspacePaths(repositoryPath: string, eventSlug: string): EventWorkspacePaths {
  const eventDir = path.join(repositoryPath, "working", eventSlug);
  return {
    eventDir,
    hostImportOriginalDir: path.join(eventDir, "原图", "主机导入"),
    clientUploadOriginalDir: path.join(eventDir, "原图", "客户端上传"),
    remoteImportOriginalDir: path.join(eventDir, "原图", "远程导入"),
    thumbsDir: path.join(eventDir, "缩略图"),
    previewsDir: path.join(eventDir, "预览图"),
    editQueueDir: path.join(eventDir, "待修图"),
    editedDir: path.join(eventDir, "已修图"),
    publishExportDir: path.join(eventDir, "导出", "发布图"),
    compressedExportDir: path.join(eventDir, "导出", "压缩图"),
    zipExportDir: path.join(eventDir, "导出", "压缩包"),
    manifestsDir: path.join(eventDir, "清单")
  };
}

export function ensureEventWorkingDirs(eventSlug: string): { created: boolean; path: string } {
  const logger = getLogger();
  const config = getConfig();
  const repoPath = config.repository.path;

  const repositoryStatus = checkRepository(repoPath);
  if (!repositoryStatus.path) {
    throw { code: "REPOSITORY_NOT_READY", message: "请先在系统设置中配置仓库路径" };
  }
  if (!repositoryStatus.exists) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不存在：${repositoryStatus.path}` };
  }
  if (!repositoryStatus.readable) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不可读：${repositoryStatus.path}` };
  }
  if (!repositoryStatus.writable) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不可写：${repositoryStatus.path}` };
  }

  const paths = getEventWorkspacePaths(repoPath, eventSlug);

  try {
    for (const subdir of EVENT_SUBDIRS) {
      fs.ensureDirSync(path.join(paths.eventDir, subdir));
    }
    logger.info({ eventDir: paths.eventDir }, "活动工作目录已创建");
    return { created: true, path: paths.eventDir };
  } catch (err) {
    logger.error({ err, eventDir: paths.eventDir }, "创建活动工作目录失败");
    throw { code: "CREATE_EVENT_DIR_FAILED", message: `创建活动工作目录失败：${paths.eventDir}` };
  }
}
