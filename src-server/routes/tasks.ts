import { Router } from "express";
import { cancelTask, getTask, listTasks } from "../services/tasks";
import { sendError, sendSuccess } from "../utils/response";

const router = Router();

router.get("/", (_req, res) => {
  sendSuccess(res, listTasks());
});

router.get("/:taskId", (req, res) => {
  try {
    sendSuccess(res, getTask(req.params.taskId));
  } catch (err: any) {
    sendError(res, err?.code || "TASK_NOT_FOUND", err?.message || "任务不存在", 404);
  }
});

router.post("/:taskId/cancel", (req, res) => {
  try {
    sendSuccess(res, cancelTask(req.params.taskId));
  } catch (err: any) {
    const status = err?.code === "TASK_NOT_FOUND" ? 404 : 400;
    sendError(res, err?.code || "TASK_CANCEL_FAILED", err?.message || "取消任务失败", status);
  }
});

export default router;
