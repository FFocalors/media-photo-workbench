import { Router } from "express";
import { sendError } from "../utils/response";
import { assertEditPackageDownload, recordEditPackageDownload } from "../services/editWorkflow";
import { getLogger } from "../utils/logger";

const router = Router();

router.get("/:packageId/download", (req, res) => {
  try {
    const download = assertEditPackageDownload(req.params.packageId);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.download(download.filePath, download.filename, (err) => {
      if (err) {
        getLogger().error({ err, packageId: req.params.packageId }, "待修包下载失败");
        if (!res.headersSent) {
          sendError(res, "EDIT_PACKAGE_DOWNLOAD_FAILED", "待修包下载失败", 500);
        }
        return;
      }
      recordEditPackageDownload(download);
    });
  } catch (err: any) {
    if (err?.code === "EDIT_PACKAGE_NOT_FOUND" || err?.code === "EDIT_PACKAGE_FILE_NOT_FOUND") {
      sendError(res, err.code, err.message, 404);
      return;
    }
    getLogger().error({ err }, "待修包下载失败");
    sendError(res, "EDIT_PACKAGE_DOWNLOAD_FAILED", "待修包下载失败", 500);
  }
});

export default router;
