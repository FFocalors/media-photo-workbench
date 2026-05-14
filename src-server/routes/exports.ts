import { Router } from "express";
import type { Request } from "express";
import { sendError, sendSuccess } from "../utils/response";
import {
  assertPublishExportDownload,
  getPublishExportJob,
  recordPublishExportDownload
} from "../services/publishExport";
import { getLogger } from "../utils/logger";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/:jobId", (req, res) => {
  try {
    sendSuccess(res, getPublishExportJob(req.params.jobId, getBaseUrl(req)));
  } catch (err: any) {
    if (err?.code === "EXPORT_JOB_NOT_FOUND") {
      sendError(res, err.code, err.message, 404);
      return;
    }
    getLogger().error({ err }, "获取导出任务失败");
    sendError(res, "GET_EXPORT_JOB_FAILED", "获取导出任务失败", 500);
  }
});

router.get("/:jobId/download", (req, res) => {
  try {
    const download = assertPublishExportDownload(req.params.jobId);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.download(download.filePath, download.filename, (err) => {
      if (err) {
        getLogger().error({ err, jobId: req.params.jobId }, "发布包下载失败");
        if (!res.headersSent) {
          sendError(res, "EXPORT_DOWNLOAD_FAILED", "发布包下载失败", 500);
        }
        return;
      }
      recordPublishExportDownload(download);
    });
  } catch (err: any) {
    if (err?.code === "EXPORT_JOB_NOT_FOUND" || err?.code === "EXPORT_FILE_NOT_FOUND") {
      sendError(res, err.code, err.message, 404);
      return;
    }
    getLogger().error({ err }, "发布包下载失败");
    sendError(res, "EXPORT_DOWNLOAD_FAILED", "发布包下载失败", 500);
  }
});

export default router;
