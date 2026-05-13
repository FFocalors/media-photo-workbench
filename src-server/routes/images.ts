import { Request, Response, Router } from "express";
import { sendError, sendSuccess } from "../utils/response";
import {
  assertImageFile,
  updateImageCategory,
  updateImageRating,
  updateImageRemark,
  updateImageStatus
} from "../services/images";
import { getLogger } from "../utils/logger";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
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

router.patch("/:id/rating", (req, res) => {
  try {
    const image = updateImageRating(req.params.id, Number(req.body.rating), getBaseUrl(req));
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片星级失败");
  }
});

router.patch("/:id/status", (req, res) => {
  try {
    const image = updateImageStatus(req.params.id, req.body.status, getBaseUrl(req));
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片状态失败");
  }
});

router.patch("/:id/category", (req, res) => {
  try {
    const image = updateImageCategory(req.params.id, req.body.category, getBaseUrl(req));
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片分类失败");
  }
});

router.patch("/:id/remark", (req, res) => {
  try {
    const image = updateImageRemark(req.params.id, req.body.remark, getBaseUrl(req));
    sendSuccess(res, image);
  } catch (err: any) {
    handleImageError(res, err, "更新图片备注失败");
  }
});

export default router;
