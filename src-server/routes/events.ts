import { Router } from "express";
import { sendSuccess, sendError } from "../utils/response";
import {
  listEvents,
  getEventById,
  createEvent,
  updateEvent,
  updateEventStatus,
  CreateEventInput
} from "../services/events";
import { importImages, scanImportFolder } from "../services/imageImport";
import { getLogger } from "../utils/logger";

const router = Router();

/**
 * GET /api/events
 * 获取活动列表，支持 ?status=draft|active|reviewing 筛选。
 */
router.get("/", (req, res) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const events = listEvents(statusFilter);
    sendSuccess(res, events);
  } catch (err) {
    getLogger().error({ err }, "获取活动列表失败");
    sendError(res, "LIST_EVENTS_FAILED", "获取活动列表失败", 500);
  }
});

/**
 * POST /api/events
 * 创建新活动。
 */
router.post("/", (req, res) => {
  const logger = getLogger();
  const { name, slug, date, location } = req.body;

  // 参数校验
  if (!name || typeof name !== "string") {
    sendError(res, "MISSING_NAME", "name 字段必须是非空字符串");
    return;
  }
  if (!date || typeof date !== "string") {
    sendError(res, "MISSING_DATE", "date 字段必须是非空字符串");
    return;
  }

  try {
    const input: CreateEventInput = { name, date, location };
    if (slug) input.slug = slug;
    const result = createEvent(input);
    sendSuccess(res, result, 201);
  } catch (err: any) {
    if (err?.code === "SLUG_CONFLICT") {
      sendError(res, err.code, err.message, 409);
    } else if (err?.code === "REPOSITORY_NOT_READY" || err?.code === "CREATE_EVENT_DIR_FAILED") {
      sendError(res, err.code, err.message, 400);
    } else {
      logger.error({ err }, "创建活动失败");
      sendError(res, "CREATE_EVENT_FAILED", "创建活动失败", 500);
    }
  }
});

/**
 * POST /api/events/:id/import/scan
 * 扫描本地文件夹中的 JPG/JPEG 文件。
 */
router.post("/:id/import/scan", async (req, res) => {
  const { folderPath } = req.body;

  if (!folderPath || typeof folderPath !== "string") {
    sendError(res, "INVALID_FOLDER_PATH", "folderPath 字段必须是非空字符串");
    return;
  }

  try {
    const result = await scanImportFolder(req.params.id, folderPath);
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, err.code === "EVENT_NOT_FOUND" ? 404 : 400);
    } else {
      getLogger().error({ err }, "扫描导入文件夹失败");
      sendError(res, "SCAN_IMPORT_FAILED", "扫描导入文件夹失败", 500);
    }
  }
});

/**
 * POST /api/events/:id/import/start
 * 同步导入本地文件夹中的 JPG/JPEG 文件。
 */
router.post("/:id/import/start", async (req, res) => {
  const { folderPath } = req.body;

  if (!folderPath || typeof folderPath !== "string") {
    sendError(res, "INVALID_FOLDER_PATH", "folderPath 字段必须是非空字符串");
    return;
  }

  try {
    const result = await importImages({
      eventId: req.params.id,
      folderPath,
      sourceType: "host_import"
    });
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, err.code === "EVENT_NOT_FOUND" ? 404 : 400);
    } else {
      getLogger().error({ err }, "图片导入失败");
      sendError(res, "IMPORT_IMAGES_FAILED", "图片导入失败", 500);
    }
  }
});

/**
 * GET /api/events/:id
 * 获取单个活动详情。
 */
router.get("/:id", (req, res) => {
  try {
    const event = getEventById(req.params.id);
    if (!event) {
      sendError(res, "EVENT_NOT_FOUND", "活动不存在", 404);
      return;
    }
    sendSuccess(res, event);
  } catch (err) {
    getLogger().error({ err }, "获取活动详情失败");
    sendError(res, "GET_EVENT_FAILED", "获取活动详情失败", 500);
  }
});

/**
 * PATCH /api/events/:id
 * 更新活动基本信息。
 */
router.patch("/:id", (req, res) => {
  const { name, date, location } = req.body;

  try {
    const event = updateEvent(req.params.id, { name, date, location });
    if (!event) {
      sendError(res, "EVENT_NOT_FOUND", "活动不存在", 404);
      return;
    }
    sendSuccess(res, event);
  } catch (err) {
    getLogger().error({ err }, "更新活动失败");
    sendError(res, "UPDATE_EVENT_FAILED", "更新活动失败", 500);
  }
});

/**
 * PATCH /api/events/:id/status
 * 更新活动状态。
 */
router.patch("/:id/status", (req, res) => {
  const { status } = req.body;

  if (!status || typeof status !== "string") {
    sendError(res, "MISSING_STATUS", "status 字段必须是非空字符串");
    return;
  }

  try {
    const event = updateEventStatus(req.params.id, status);
    if (!event) {
      sendError(res, "EVENT_NOT_FOUND", "活动不存在", 404);
      return;
    }
    sendSuccess(res, event);
  } catch (err: any) {
    if (err?.code === "INVALID_STATUS") {
      sendError(res, err.code, err.message);
    } else {
      getLogger().error({ err }, "更新活动状态失败");
      sendError(res, "UPDATE_STATUS_FAILED", "更新活动状态失败", 500);
    }
  }
});

export default router;
