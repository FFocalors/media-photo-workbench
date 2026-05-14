import { Request, Response, Router } from "express";
import { sendError, sendSuccess } from "../utils/response";
import {
  assertImageDownloadFile,
  assertImageFile,
  deleteImage,
  ImageDownloadType,
  recordImageDownload,
  updateImageCategory,
  updateImageRating,
  updateImageRemark,
  updateImageStatus
} from "../services/images";
import { getLogger } from "../utils/logger";
import { emitImageDeletedLogical, emitImageUpdated } from "../realtime/socket";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function handleImageError(res: Response, err: any, fallbackMessage: string): void {
  if (err?.code === "IMAGE_NOT_FOUND" || err?.code === "IMAGE_FILE_NOT_FOUND") {
    sendError(res, err.code, err.message, 404);
    return;
  }
  if (err?.code) {
    sendError(res, err.code, err.message, 400);
    return;
  }
  getLogger().error({ err }, fallbackMessage);
  sendError(res, "IMAGE_OPERATION_FAILED", fallbackMessage, 500);
}

function sendDownload(req: Request, res: Response, type: ImageDownloadType): void {
  try {
    const imageId = String(req.params.id);
    const download = assertImageDownloadFile(imageId, type);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.download(download.filePath, download.filename, (err) => {
      if (err) {
        getLogger().error({ err, imageId, type }, "图片下载失败");
        if (!res.headersSent) {
          sendError(res, "IMAGE_DOWNLOAD_FAILED", "图片下载失败", 500);
        }
        return;
      }
      recordImageDownload(download.image, type, download.filePath);
    });
  } catch (err: any) {
    handleImageError(res, err, "图片下载失败");
  }
}

router.get("/:id/thumb", (req, res) => {
  try {
    const { filePath } = assertImageFile(req.params.id, "thumb");
    res.sendFile(filePath);
  } catch (err: any) {
    handleImageError(res, err, "读取缩略图失败");
  }
});

router.get("/:id/preview", (req, res) => {
  try {
    const { filePath } = assertImageFile(req.params.id, "preview");
    res.sendFile(filePath);
  } catch (err: any) {
    handleImageError(res, err, "读取预览图失败");
  }
});

router.get("/:id/download/original", (req, res) => {
  sendDownload(req, res, "original");
});

router.get("/:id/download/preview", (req, res) => {
  sendDownload(req, res, "preview");
});

router.get("/:id/download/edited", (req, res) => {
  sendDownload(req, res, "edited");
});

router.delete("/:id", (req, res) => {
  try {
    const image = deleteImage(req.params.id, getBaseUrl(req));
    emitImageDeletedLogical({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "image_deleted_logical",
      updatedAt: nowIso()
    });
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "删除图片失败");
  }
});

router.patch("/:id/rating", (req, res) => {
  try {
    const image = updateImageRating(req.params.id, Number(req.body.rating), getBaseUrl(req));
    emitImageUpdated({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "rating_changed",
      updatedAt: nowIso()
    });
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片星级失败");
  }
});

router.patch("/:id/status", (req, res) => {
  try {
    const image = updateImageStatus(req.params.id, req.body.status, getBaseUrl(req));
    emitImageUpdated({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "status_changed",
      updatedAt: nowIso()
    });
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片状态失败");
  }
});

router.patch("/:id/category", (req, res) => {
  try {
    const image = updateImageCategory(req.params.id, req.body.category, getBaseUrl(req));
    emitImageUpdated({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "category_changed",
      updatedAt: nowIso()
    });
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片分类失败");
  }
});

router.patch("/:id/remark", (req, res) => {
  try {
    const image = updateImageRemark(req.params.id, req.body.remark, getBaseUrl(req));
    emitImageUpdated({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "remark_changed",
      updatedAt: nowIso()
    });
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片备注失败");
  }
});

export default router;
