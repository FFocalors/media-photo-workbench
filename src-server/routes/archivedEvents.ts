import { Router } from "express";
import { deleteArchivedEvent, getArchivedEventDetail, getArchivedEventThumbPath, listArchivedEvents } from "../services/archive";
import { getLogger } from "../utils/logger";
import { sendError, sendSuccess } from "../utils/response";

const router = Router();

router.get("/", (_req, res) => {
  try {
    sendSuccess(res, listArchivedEvents());
  } catch (err) {
    getLogger().error({ err }, "获取归档活动列表失败");
    sendError(res, "LIST_ARCHIVED_EVENTS_FAILED", "获取归档活动列表失败", 500);
  }
});

router.get("/:id", async (req, res) => {
  try {
    sendSuccess(res, await getArchivedEventDetail(req.params.id));
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "ARCHIVED_EVENT_NOT_FOUND"
        || err.code === "ARCHIVE_PATH_NOT_FOUND"
        || err.code === "ARCHIVE_MANIFEST_NOT_FOUND"
        ? 404
        : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err, archivedEventId: req.params.id }, "获取归档活动详情失败");
    sendError(res, "GET_ARCHIVED_EVENT_DETAIL_FAILED", "获取归档活动详情失败", 500);
  }
});

router.get("/:id/thumb/:imageId", async (req, res) => {
  try {
    res.sendFile(await getArchivedEventThumbPath(req.params.id, req.params.imageId));
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "ARCHIVED_EVENT_NOT_FOUND"
        || err.code === "ARCHIVE_PATH_NOT_FOUND"
        || err.code === "ARCHIVE_MANIFEST_NOT_FOUND"
        || err.code === "ARCHIVE_THUMB_NOT_FOUND"
        ? 404
        : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err, archivedEventId: req.params.id, imageId: req.params.imageId }, "获取归档缩略图失败");
    sendError(res, "GET_ARCHIVED_THUMB_FAILED", "获取归档缩略图失败", 500);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    sendSuccess(res, await deleteArchivedEvent(req.params.id));
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "ARCHIVED_EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err, archivedEventId: req.params.id }, "删除归档活动失败");
    sendError(res, "DELETE_ARCHIVED_EVENT_FAILED", "删除归档活动失败", 500);
  }
});

export default router;
