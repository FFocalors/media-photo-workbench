import { Request, Router } from "express";
import { sendSuccess, sendError } from "../utils/response";
import {
  listEvents,
  getEventById,
  createEvent,
  updateEvent,
  updateEventStatus,
  deleteEvent,
  listDeletedEvents,
  purgeEvent,
  restoreEvent,
  CreateEventInput
} from "../services/events";
import { importImageFiles, importImages, scanImportFolder } from "../services/imageImport";
import { getImageDtoById, listEventImages, listEventTrashedImages } from "../services/images";
import { getLogger } from "../utils/logger";
import { emitImageCreated } from "../realtime/socket";
import { parseMultipartForm } from "../utils/multipart";
import { createEditPackage, uploadEditedImages } from "../services/editWorkflow";
import { createPublishExport } from "../services/publishExport";
import { cleanupEventArchive, prepareEventArchive, verifyEventArchive } from "../services/archive";
import { createDownloadZipTask } from "../services/downloadPackages";
import { createTask, failTask, finishTask, updateTask } from "../services/tasks";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emitCreatedImages(importedIds: string[], baseUrl: string): void {
  for (const imageId of importedIds) {
    const image = getImageDtoById(imageId, baseUrl);
    emitImageCreated({
      eventId: image.event_id,
      imageId: image.id,
      image,
      action: "image_created",
      updatedAt: nowIso()
    });
  }
}

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
 * GET /api/events/trash
 * 获取已逻辑删除的活动列表。
 */
router.get("/trash", (_req, res) => {
  try {
    sendSuccess(res, listDeletedEvents());
  } catch (err) {
    getLogger().error({ err }, "获取活动回收站失败");
    sendError(res, "LIST_EVENT_TRASH_FAILED", "获取活动回收站失败", 500);
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
 * GET /api/events/:id/images/trash
 * 查询活动图片回收站。
 */
router.get("/:id/images/trash", (req, res) => {
  try {
    const result = listEventTrashedImages(req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      rating: req.query.rating ? Number(req.query.rating) : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type : undefined,
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined
    }, `${req.protocol}://${req.get("host")}`);
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, 400);
    } else {
      getLogger().error({ err }, "查询图片回收站失败");
      sendError(res, "LIST_IMAGE_TRASH_FAILED", "查询图片回收站失败", 500);
    }
  }
});

/**
 * GET /api/events/:id/images
 * 查询活动下的真实图片列表。
 */
router.get("/:id/images", (req, res) => {
  try {
    const result = listEventImages(req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      rating: req.query.rating ? Number(req.query.rating) : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type : undefined,
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined
    }, `${req.protocol}://${req.get("host")}`);
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, 400);
    } else {
      getLogger().error({ err }, "查询活动图片失败");
      sendError(res, "LIST_IMAGES_FAILED", "查询活动图片失败", 500);
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
    emitCreatedImages(result.imported.map((image) => image.id), getBaseUrl(req));
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
 * POST /api/events/:id/upload
 * 客户端通过 multipart/form-data 上传 JPG/JPEG 文件。
 */
router.post("/:id/upload", async (req, res) => {
  let form: Awaited<ReturnType<typeof parseMultipartForm>> | null = null;

  try {
    form = await parseMultipartForm(req, {
      maxFiles: 500,
      maxBytes: 512 * 1024 * 1024
    });

    const uploadFiles = form.files.filter((file) => file.fieldName === "files");
    if (uploadFiles.length === 0) {
      sendError(res, "NO_UPLOAD_FILES", "请至少选择一个 JPG/JPEG 文件");
      return;
    }

    const result = await importImageFiles({
      eventId: req.params.id,
      files: uploadFiles.map((file) => ({
        filename: file.originalFilename,
        path: file.path,
        size: file.size
      })),
      sourceType: "client_upload",
      photographer: form.fields.photographer ?? "",
      device: form.fields.device ?? "",
      remark: form.fields.remark ?? ""
    });

    emitCreatedImages(result.imported.map((image) => image.id), getBaseUrl(req));
    sendSuccess(res, {
      ...result,
      photographer: form.fields.photographer ?? "",
      device: form.fields.device ?? "",
      remark: form.fields.remark ?? ""
    });
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, err.code === "EVENT_NOT_FOUND" ? 404 : 400);
    } else {
      getLogger().error({ err }, "客户端上传图片失败");
      sendError(res, "CLIENT_UPLOAD_FAILED", "客户端上传图片失败", 500);
    }
  } finally {
    await form?.cleanup();
  }
});

/**
 * POST /api/events/:id/edit-package
 * 将当前活动 status = edit 的图片打包为待修包。
 */
router.post("/:id/edit-package", async (req, res) => {
  try {
    const result = await createEditPackage(req.params.id, getBaseUrl(req));
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
    } else {
      getLogger().error({ err }, "生成待修包失败");
      sendError(res, "CREATE_EDIT_PACKAGE_FAILED", "生成待修包失败", 500);
    }
  }
});

/**
 * POST /api/events/:id/edited/upload
 * 上传已修图，并按 edit_manifest.json 或文件名匹配原图。
 */
router.post("/:id/edited/upload", async (req, res) => {
  let form: Awaited<ReturnType<typeof parseMultipartForm>> | null = null;

  try {
    form = await parseMultipartForm(req, {
      maxFiles: 500,
      maxBytes: 512 * 1024 * 1024
    });

    const manifestFile = form.files.find((file) =>
      file.fieldName === "manifest" || file.originalFilename.toLowerCase() === "edit_manifest.json"
    );
    const imageFiles = form.files.filter((file) => file !== manifestFile);
    if (imageFiles.length === 0) {
      sendError(res, "NO_EDITED_FILES", "请至少选择一个 JPG/JPEG 已修图文件");
      return;
    }

    const result = await uploadEditedImages({
      eventId: req.params.id,
      files: imageFiles,
      manifestFile,
      baseUrl: getBaseUrl(req)
    });

    const { images: _images, ...responseData } = result;
    sendSuccess(res, responseData);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, err.code === "EVENT_NOT_FOUND" ? 404 : 400);
    } else {
      getLogger().error({ err }, "上传已修图失败");
      sendError(res, "UPLOAD_EDITED_IMAGES_FAILED", "上传已修图失败", 500);
    }
  } finally {
    await form?.cleanup();
  }
});

/**
 * POST /api/events/:id/download/zip
 * 创建批量 ZIP 下载任务。
 */
router.post("/:id/download/zip", (req, res) => {
  try {
    const result = createDownloadZipTask(req.params.id, {
      imageIds: Array.isArray(req.body.imageIds) ? req.body.imageIds : [],
      type: req.body.type,
      filenameMode: req.body.filenameMode,
      baseUrl: getBaseUrl(req)
    });
    sendSuccess(res, result, 202);
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
    } else {
      getLogger().error({ err }, "创建批量下载任务失败");
      sendError(res, "CREATE_DOWNLOAD_ZIP_TASK_FAILED", "创建批量下载任务失败", 500);
    }
  }
});

/**
 * POST /api/events/:id/export
 * 生成正式发布图和发布 ZIP。
 */
router.post("/:id/export", async (req, res) => {
  const task = createTask({
    type: "publish_export",
    eventId: req.params.id,
    title: "发布导出",
    total: 1
  });
  try {
    updateTask(task.id, { status: "running" });
    const result = await createPublishExport({
      eventId: req.params.id,
      mode: req.body.mode,
      imageIds: Array.isArray(req.body.imageIds) ? req.body.imageIds : undefined,
      ratingMin: req.body.ratingMin,
      size: req.body.size,
      quality: Number(req.body.quality ?? 90),
      filenameMode: req.body.filenameMode,
      limitFileSize10Mb: req.body.limitFileSize10Mb === true,
      baseUrl: getBaseUrl(req)
    });
    finishTask(task.id, {
      jobId: result.jobId,
      downloadUrl: result.downloadUrl,
      outputDir: result.outputDir,
      zipPath: result.zipPath,
      total: result.total,
      success: result.success,
      failed: result.failed,
      errors: result.errors
    });
    sendSuccess(res, result);
  } catch (err: any) {
    failTask(task.id, [{ reason: err?.message || "发布导出失败" }]);
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
    } else {
      getLogger().error({ err }, "发布导出失败");
      sendError(res, "PUBLISH_EXPORT_FAILED", "发布导出失败", 500);
    }
  }
});

/**
 * POST /api/events/:id/archive/prepare
 * 生成活动归档目录、清单、CSV 和独立 event.db。
 */
router.post("/:id/archive/prepare", async (req, res) => {
  const task = createTask({
    type: "archive_prepare",
    eventId: req.params.id,
    title: "生成活动归档",
    total: 1
  });
  try {
    updateTask(task.id, { status: "running" });
    const result = await prepareEventArchive(req.params.id);
    finishTask(task.id, {
      archivePath: result.archivePath,
      totalImages: result.totalImages,
      originalCopied: result.originalCopied,
      editedCopied: result.editedCopied,
      exportCopied: result.exportCopied,
      missingFiles: result.missingFiles,
      manifestPath: result.manifestPath,
      eventDbPath: result.eventDbPath
    });
    sendSuccess(res, result);
  } catch (err: any) {
    failTask(task.id, [{ reason: err?.message || "生成活动归档失败" }]);
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err }, "生成活动归档失败");
    sendError(res, "ARCHIVE_PREPARE_FAILED", "生成活动归档失败", 500);
  }
});

/**
 * POST /api/events/:id/archive/verify
 * 验证活动归档完整性。
 */
router.post("/:id/archive/verify", async (req, res) => {
  try {
    const result = await verifyEventArchive(
      req.params.id,
      typeof req.body?.archivePath === "string" ? req.body.archivePath : undefined
    );
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" || err.code === "ARCHIVE_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err }, "验证活动归档失败");
    sendError(res, "ARCHIVE_VERIFY_FAILED", "验证活动归档失败", 500);
  }
});

/**
 * POST /api/events/:id/archive/cleanup
 * 归档验证通过后清理 working 工作区。
 */
router.post("/:id/archive/cleanup", async (req, res) => {
  try {
    const result = await cleanupEventArchive(req.params.id, {
      confirm: req.body?.confirm === true,
      archivePath: typeof req.body?.archivePath === "string" ? req.body.archivePath : undefined
    });
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" || err.code === "ARCHIVE_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
      return;
    }
    getLogger().error({ err }, "清理归档工作区失败");
    sendError(res, "ARCHIVE_CLEANUP_FAILED", "清理归档工作区失败", 500);
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

/**
 * PATCH /api/events/:id/restore
 * 从活动回收站恢复活动。
 */
router.patch("/:id/restore", (req, res) => {
  try {
    const status = typeof req.body?.status === "string" ? req.body.status : "active";
    const event = restoreEvent(req.params.id, status);
    if (!event) {
      sendError(res, "EVENT_NOT_FOUND", "活动不存在", 404);
      return;
    }
    sendSuccess(res, event);
  } catch (err: any) {
    if (err?.code) {
      sendError(res, err.code, err.message, 400);
    } else {
      getLogger().error({ err }, "恢复活动失败");
      sendError(res, "RESTORE_EVENT_FAILED", "恢复活动失败", 500);
    }
  }
});

/**
 * DELETE /api/events/:id
 * 逻辑删除活动，只标记 status = deleted，不删除文件。
 */
router.delete("/:id", (req, res) => {
  try {
    const event = deleteEvent(req.params.id);
    if (!event) {
      sendError(res, "EVENT_NOT_FOUND", "活动不存在", 404);
      return;
    }
    sendSuccess(res, event);
  } catch (err) {
    getLogger().error({ err }, "删除活动失败");
    sendError(res, "DELETE_EVENT_FAILED", "删除活动失败", 500);
  }
});

/**
 * DELETE /api/events/:id/purge
 * 永久删除已进入回收站的活动。
 */
router.delete("/:id/purge", async (req, res) => {
  try {
    const result = await purgeEvent(req.params.id, {
      includeArchive: req.body?.includeArchive === true
    });
    sendSuccess(res, result);
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
    } else {
      getLogger().error({ err }, "永久删除活动失败");
      sendError(res, "PURGE_EVENT_FAILED", "永久删除活动失败", 500);
    }
  }
});

export default router;
