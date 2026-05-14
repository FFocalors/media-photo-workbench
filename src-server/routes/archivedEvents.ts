import { Router } from "express";
import { listArchivedEvents } from "../services/archive";
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

export default router;
