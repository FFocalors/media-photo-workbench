import { Router } from "express";
import {
  assertDownloadPackageDownload,
  recordDownloadPackageDownload
} from "../services/downloadPackages";
import { sendError } from "../utils/response";
import { getLogger } from "../utils/logger";

const router = Router();

router.get("/:packageId/download", (req, res) => {
  try {
    const download = assertDownloadPackageDownload(req.params.packageId);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.download(download.filePath, download.filename, (err) => {
      if (err) {
        getLogger().error({ err, packageId: req.params.packageId }, "批量下载包下载失败");
        if (!res.headersSent) {
          sendError(res, "DOWNLOAD_PACKAGE_DOWNLOAD_FAILED", "批量下载包下载失败", 500);
        }
        return;
      }
      recordDownloadPackageDownload(download);
    });
  } catch (err: any) {
    if (err?.code === "DOWNLOAD_PACKAGE_NOT_FOUND" || err?.code === "DOWNLOAD_PACKAGE_FILE_NOT_FOUND") {
      sendError(res, err.code, err.message, 404);
      return;
    }
    getLogger().error({ err }, "批量下载包下载失败");
    sendError(res, "DOWNLOAD_PACKAGE_DOWNLOAD_FAILED", "批量下载包下载失败", 500);
  }
});

export default router;
