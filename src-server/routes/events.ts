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
import {
  ImportImageFilesOptions,
  ImportProgressSnapshot,
  importImageFiles,
  importSelectedImageFiles,
  scanImportFolder
} from "../services/imageImport";
import { getImageDtoById, listEventImages, listEventTrashedImages, listEventUploaders } from "../services/images";
import { getLogger } from "../utils/logger";
import { emitImageCreated } from "../realtime/socket";
import { parseMultipartForm } from "../utils/multipart";
import { normalizeActor } from "../utils/actor";
import { createEditPackage, EditedUploadProgressSnapshot, listEditPackages, uploadEditedImages } from "../services/editWorkflow";
import { createPublishExport } from "../services/publishExport";
import { cleanupEventArchive, prepareEventArchive, verifyEventArchive } from "../services/archive";
import { createDownloadZipTask } from "../services/downloadPackages";
import { createTask, failTask, finishTask, isTaskCancellationRequested, updateTask } from "../services/tasks";

const router = Router();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return Number(value);
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

type ImportProgressSample = {
  at: number;
  processed: number;
  processedBytes: number;
};

function estimateRemainingMs(input: {
  startedAtMs: number;
  now: number;
  snapshot: ImportProgressSnapshot;
  samples: ImportProgressSample[];
}): number | null {
  const { startedAtMs, now, snapshot, samples } = input;
  if (snapshot.processed <= 0 || snapshot.total <= snapshot.processed) return null;

  const elapsedMs = now - startedAtMs;
  const minElapsedMs = 5000;
  const minProcessed = Math.min(8, Math.max(2, Math.ceil(snapshot.total * 0.01)));
  if (elapsedMs < minElapsedMs || snapshot.processed < minProcessed || samples.length === 0) {
    return null;
  }

  const windowMs = 30000;
  const minWindowMs = 3000;
  const baseline =
    samples.find((sample) => now - sample.at >= minWindowMs && now - sample.at <= windowMs) ??
    samples.find((sample) => now - sample.at >= minWindowMs);

  if (!baseline) return null;

  const durationMs = now - baseline.at;
  if (durationMs < minWindowMs) return null;

  const remainingBytes = snapshot.totalBytes - snapshot.processedBytes;
  const processedBytesDelta = snapshot.processedBytes - baseline.processedBytes;
  if (snapshot.totalBytes > 0 && remainingBytes > 0 && processedBytesDelta > 0) {
    return Math.max(0, Math.round((remainingBytes / processedBytesDelta) * durationMs));
  }

  const remainingItems = snapshot.total - snapshot.processed;
  const processedDelta = snapshot.processed - baseline.processed;
  if (remainingItems > 0 && processedDelta > 0) {
    return Math.max(0, Math.round((remainingItems / processedDelta) * durationMs));
  }

  return null;
}

function startImportBackgroundTask(input: {
  taskId: string;
  baseUrl: string;
  total: number;
  run: (options: ImportImageFilesOptions) => Promise<{
    total: number;
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{ filename: string; path: string; reason: string }>;
    imported: Array<{ id: string }>;
  }>;
  cleanup?: () => Promise<void>;
}): void {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let lastProgressAt = 0;
  const progressSamples: ImportProgressSample[] = [];

  const applyProgress = (snapshot: ImportProgressSnapshot) => {
    if (isTaskCancellationRequested(input.taskId)) return;
    const now = Date.now();
    if (now - lastProgressAt < 500 && snapshot.processed < snapshot.total) return;
    lastProgressAt = now;
    const estimatedRemainingMs = estimateRemainingMs({
      startedAtMs,
      now,
      snapshot,
      samples: progressSamples
    });
    progressSamples.push({
      at: now,
      processed: snapshot.processed,
      processedBytes: snapshot.processedBytes
    });
    while (progressSamples.length > 0 && now - progressSamples[0].at > 60000) {
      progressSamples.shift();
    }
    updateTask(input.taskId, {
      status: "running",
      startedAt,
      total: snapshot.total,
      finished: snapshot.processed,
      successCount: snapshot.success,
      failedCount: snapshot.failed,
      skippedCount: snapshot.skipped,
      errors: snapshot.errors,
      elapsedMs: now - startedAtMs,
      estimatedRemainingMs,
      currentFileName: snapshot.currentFileName
    });
  };

  void (async () => {
    try {
      updateTask(input.taskId, {
        status: "running",
        startedAt,
        total: input.total,
        elapsedMs: 0,
        estimatedRemainingMs: null
      });

      const result = await input.run({
        maxErrors: 100,
        isCancelled: () => isTaskCancellationRequested(input.taskId),
        onProgress: applyProgress,
        onImageImported: (image) => emitCreatedImages([image.id], input.baseUrl)
      });

      const finished = result.success + result.failed + result.skipped;
      const elapsedMs = Date.now() - startedAtMs;
      const resultPayload = {
        total: result.total,
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
        importedCount: result.imported.length,
        errors: result.errors
      };

      if (isTaskCancellationRequested(input.taskId)) {
        updateTask(input.taskId, {
          status: "cancelled",
          total: result.total,
          finished,
          successCount: result.success,
          failedCount: result.failed,
          skippedCount: result.skipped,
          errors: result.errors,
          result: resultPayload,
          elapsedMs,
          estimatedRemainingMs: null,
          currentFileName: "",
          finishedAt: nowIso()
        });
        return;
      }

      updateTask(input.taskId, {
        total: result.total,
        finished,
        successCount: result.success,
        failedCount: result.failed,
        skippedCount: result.skipped,
        errors: result.errors,
        elapsedMs,
        estimatedRemainingMs: null,
        currentFileName: ""
      });
      finishTask(input.taskId, resultPayload);
    } catch (err: any) {
      failTask(input.taskId, [{ reason: err?.message || "导入任务失败" }]);
    } finally {
      await input.cleanup?.();
    }
  })();
}

function estimateSimpleRemainingMs(input: {
  startedAtMs: number;
  processed: number;
  total: number;
}): number | null {
  if (input.processed <= 0 || input.total <= input.processed) return null;
  const elapsedMs = Date.now() - input.startedAtMs;
  if (elapsedMs < 1500) return null;
  return Math.max(0, Math.round((elapsedMs / input.processed) * (input.total - input.processed)));
}

function startEditedUploadBackgroundTask(input: {
  taskId: string;
  eventId: string;
  files: Parameters<typeof uploadEditedImages>[0]["files"];
  manifestFile?: Parameters<typeof uploadEditedImages>[0]["manifestFile"];
  baseUrl: string;
  cleanup?: () => Promise<void>;
}): void {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let lastProgressAt = 0;

  const applyProgress = (snapshot: EditedUploadProgressSnapshot) => {
    if (isTaskCancellationRequested(input.taskId)) return;
    const now = Date.now();
    if (now - lastProgressAt < 500 && snapshot.processed < snapshot.total) return;
    lastProgressAt = now;
    updateTask(input.taskId, {
      status: "running",
      startedAt,
      total: snapshot.total,
      finished: snapshot.processed,
      successCount: snapshot.matched,
      failedCount: snapshot.unmatched,
      skippedCount: 0,
      errors: snapshot.errors,
      elapsedMs: now - startedAtMs,
      estimatedRemainingMs: estimateSimpleRemainingMs({
        startedAtMs,
        processed: snapshot.processed,
        total: snapshot.total
      }),
      currentFileName: snapshot.currentFileName
    });
  };

  void (async () => {
    try {
      updateTask(input.taskId, {
        status: "running",
        startedAt,
        total: input.files.length,
        elapsedMs: 0,
        estimatedRemainingMs: null
      });

      const result = await uploadEditedImages({
        eventId: input.eventId,
        files: input.files,
        manifestFile: input.manifestFile,
        baseUrl: input.baseUrl,
        options: {
          maxErrors: 100,
          isCancelled: () => isTaskCancellationRequested(input.taskId),
          onProgress: applyProgress
        }
      });
      const elapsedMs = Date.now() - startedAtMs;
      const responseData = {
        total: result.total,
        matched: result.matched,
        unmatched: result.unmatched,
        errors: result.errors,
        items: result.items
      };

      updateTask(input.taskId, {
        total: result.total,
        finished: result.matched + result.unmatched,
        successCount: result.matched,
        failedCount: result.unmatched,
        skippedCount: 0,
        errors: result.errors,
        result: responseData,
        elapsedMs,
        estimatedRemainingMs: null,
        currentFileName: ""
      });

      if (isTaskCancellationRequested(input.taskId)) {
        updateTask(input.taskId, {
          status: "cancelled",
          finishedAt: nowIso()
        });
        return;
      }

      finishTask(input.taskId, responseData);
    } catch (err: any) {
      failTask(input.taskId, [{ reason: err?.message || "已修图回传任务失败" }]);
    } finally {
      await input.cleanup?.();
    }
  })();
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
      rating: parseOptionalNumber(req.query.rating),
      ratingMode: typeof req.query.ratingMode === "string" ? req.query.ratingMode : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type : undefined,
      uploadedByClientId: typeof req.query.uploadedByClientId === "string" ? req.query.uploadedByClientId : undefined,
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
      rating: parseOptionalNumber(req.query.rating),
      ratingMode: typeof req.query.ratingMode === "string" ? req.query.ratingMode : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      sourceType: typeof req.query.source_type === "string" ? req.query.source_type : undefined,
      uploadedByClientId: typeof req.query.uploadedByClientId === "string" ? req.query.uploadedByClientId : undefined,
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
 * GET /api/events/:id/uploaders
 * 获取当前活动中出现过的上传来源 / 上传者。
 */
router.get("/:id/uploaders", (req, res) => {
  try {
    sendSuccess(res, listEventUploaders(req.params.id));
  } catch (err) {
    getLogger().error({ err }, "获取活动上传者列表失败");
    sendError(res, "LIST_EVENT_UPLOADERS_FAILED", "获取活动上传者列表失败", 500);
  }
});

/**
 * POST /api/events/:id/import/scan
 * 扫描本地文件夹中的 JPG/JPEG/PNG 文件。
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
 * 创建本地文件夹或指定路径 JPG/JPEG/PNG 导入任务。
 */
router.post("/:id/import/start", async (req, res) => {
  const { folderPath, filePaths } = req.body ?? {};

  if (filePaths !== undefined && !Array.isArray(filePaths)) {
    sendError(res, "INVALID_FILE_PATHS", "filePaths 必须是数组");
    return;
  }
  if (filePaths === undefined && (!folderPath || typeof folderPath !== "string")) {
    sendError(res, "INVALID_IMPORT_SOURCE", "folderPath 或 filePaths 至少提供一个");
    return;
  }

  try {
    const baseUrl = getBaseUrl(req);
    if (Array.isArray(filePaths)) {
      const task = createTask({
        type: "host_import",
        eventId: req.params.id,
        title: `导入 ${filePaths.length} 张图片`,
        total: filePaths.length
      });

      startImportBackgroundTask({
        taskId: task.id,
        baseUrl,
        total: filePaths.length,
        run: (options) => importSelectedImageFiles({
          eventId: req.params.id,
          filePaths,
          sourceType: "host_import",
          options
        })
      });

      sendSuccess(res, { taskId: task.id, total: filePaths.length, mode: "files" }, 202);
      return;
    }

    const scan = await scanImportFolder(req.params.id, folderPath);
    const task = createTask({
      type: "host_import",
      eventId: req.params.id,
      title: `导入 ${scan.count} 张图片`,
      total: scan.count
    });

    startImportBackgroundTask({
      taskId: task.id,
      baseUrl,
      total: scan.count,
      run: (options) => importImageFiles({
        eventId: req.params.id,
        files: scan.files,
        folderPath,
        sourceType: "host_import",
        options
      })
    });

    sendSuccess(res, { taskId: task.id, total: scan.count, mode: "folder" }, 202);
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
 * 客户端通过 multipart/form-data 上传 JPG/JPEG/PNG 文件。
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
      sendError(res, "NO_UPLOAD_FILES", "请至少选择一个 JPG/JPEG/PNG 文件");
      return;
    }

    const files = uploadFiles.map((file) => ({
      filename: file.originalFilename,
      path: file.path,
      size: file.size,
      mimeType: file.mimeType
    }));
    const photographer = form.fields.photographer ?? "";
    const device = form.fields.device ?? "";
    const remark = form.fields.remark ?? "";
    const clientId = form.fields.clientId ?? "";
    const clientName = form.fields.clientName ?? device ?? "客户端";
    const clientRole = form.fields.clientRole ?? "client";
    const actor = normalizeActor({
      type: "client",
      id: clientId,
      name: clientName
    }, { type: "client", id: clientId, name: clientName || "客户端" });
    const formForTask = form;
    form = null;

    const task = createTask({
      type: "client_upload_import",
      eventId: req.params.id,
      title: `客户端上传处理 ${files.length} 张图片`,
      total: files.length
    });

    startImportBackgroundTask({
      taskId: task.id,
      baseUrl: getBaseUrl(req),
      total: files.length,
      run: (options) => importImageFiles({
        eventId: req.params.id,
        files,
        sourceType: "client_upload",
        photographer,
        device,
        remark,
        actor,
        options
      }),
      cleanup: () => formForTask.cleanup()
    });

    sendSuccess(res, {
      taskId: task.id,
      total: files.length,
      photographer,
      device,
      remark,
      clientId,
      clientName,
      clientRole
    }, 202);
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
  const task = createTask({
    type: "edit_package",
    eventId: req.params.id,
    title: "生成待修包",
    total: 1
  });
  try {
    updateTask(task.id, { status: "running" });
    const result = await createEditPackage(req.params.id, getBaseUrl(req), {
      splitMode: req.body?.splitMode,
      packageCount: req.body?.packageCount,
      packages: req.body?.packages
    });
    const errors = result.errors.slice(0, 100).map((error) => ({
      imageId: error.imageId,
      filename: error.filename,
      reason: error.reason
    }));
    updateTask(task.id, {
      total: result.total,
      finished: result.total,
      successCount: result.success,
      failedCount: errors.length,
      skippedCount: result.skipped,
      errors,
      result: {
        packageCount: result.packageCount,
        packages: result.packages,
        total: result.total,
        success: result.success,
        failed: errors.length,
        skipped: result.skipped,
        errors,
        downloadUrl: result.packages[0]?.downloadUrl
      }
    });
    finishTask(task.id, {
      packageCount: result.packageCount,
      packages: result.packages,
      total: result.total,
      success: result.success,
      failed: errors.length,
      skipped: result.skipped,
      errors,
      downloadUrl: result.packages[0]?.downloadUrl
    });
    sendSuccess(res, result);
  } catch (err: any) {
    failTask(task.id, [{ reason: err?.message || "生成待修包失败" }]);
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
 * GET /api/events/:id/edit-packages
 * 查询当前活动已生成的待修包列表。
 */
router.get("/:id/edit-packages", (req, res) => {
  try {
    sendSuccess(res, listEditPackages(req.params.id, getBaseUrl(req)));
  } catch (err: any) {
    if (err?.code) {
      const status = err.code === "EVENT_NOT_FOUND" ? 404 : 400;
      sendError(res, err.code, err.message, status);
    } else {
      getLogger().error({ err }, "获取待修包列表失败");
      sendError(res, "LIST_EDIT_PACKAGES_FAILED", "获取待修包列表失败", 500);
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

    const task = createTask({
      type: "edited_upload",
      eventId: req.params.id,
      title: `回传已修图 ${imageFiles.length} 张`,
      total: imageFiles.length
    });

    const formForTask = form;
    form = null;
    startEditedUploadBackgroundTask({
      taskId: task.id,
      eventId: req.params.id,
      files: imageFiles,
      manifestFile,
      baseUrl: getBaseUrl(req),
      cleanup: () => formForTask.cleanup()
    });

    sendSuccess(res, {
      taskId: task.id,
      total: imageFiles.length,
      mode: "edited_upload"
    }, 202);
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
    const errors = result.errors.slice(0, 100).map((error) => ({
      imageId: error.imageId,
      filename: error.filename,
      reason: error.reason
    }));
    updateTask(task.id, {
      total: result.total,
      finished: result.total,
      successCount: result.success,
      failedCount: result.failed,
      skippedCount: 0,
      errors,
      result: {
        jobId: result.jobId,
        downloadUrl: result.downloadUrl,
        outputDir: result.outputDir,
        zipPath: result.zipPath,
        total: result.total,
        success: result.success,
        failed: result.failed,
        skipped: 0,
        errors
      }
    });
    finishTask(task.id, {
      jobId: result.jobId,
      downloadUrl: result.downloadUrl,
      outputDir: result.outputDir,
      zipPath: result.zipPath,
      total: result.total,
      success: result.success,
      failed: result.failed,
      skipped: 0,
      errors
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
    const errors = result.missingFiles.slice(0, 100).map((item: any) => ({
      imageId: item.imageId,
      filename: item.filename || item.archivePath || item.sourcePath,
      reason: item.reason || "归档文件缺失"
    }));
    updateTask(task.id, {
      total: result.totalImages,
      finished: result.totalImages,
      successCount: result.thumbCopied,
      failedCount: errors.length,
      skippedCount: 0,
      errors,
      result: {
        archivePath: result.archivePath,
        total: result.totalImages,
        success: result.thumbCopied,
        failed: errors.length,
        skipped: 0,
        errors,
        missingFiles: result.missingFiles,
        manifestPath: result.manifestPath,
        eventDbPath: result.eventDbPath
      }
    });
    finishTask(task.id, {
      archivePath: result.archivePath,
      totalImages: result.totalImages,
      total: result.totalImages,
      success: result.thumbCopied,
      failed: errors.length,
      skipped: 0,
      originalCopied: result.originalCopied,
      editedCopied: result.editedCopied,
      exportCopied: result.exportCopied,
      missingFiles: result.missingFiles,
      errors,
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
 * 创建归档 working 工作区清理任务。
 */
router.post("/:id/archive/cleanup", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendError(res, "ARCHIVE_CLEANUP_NOT_CONFIRMED", "清理工作区需要二次确认", 400);
      return;
    }

    const archivePath = typeof req.body?.archivePath === "string" ? req.body.archivePath : undefined;
    const task = createTask({
      type: "archive_cleanup",
      eventId: req.params.id,
      title: "清理归档工作区",
      total: 0
    });

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    let lastProgressAt = 0;

    updateTask(task.id, {
      status: "running",
      startedAt,
      elapsedMs: 0,
      estimatedRemainingMs: null
    });

    void (async () => {
      try {
        const result = await cleanupEventArchive(req.params.id, {
          confirm: true,
          archivePath,
          onProgress: (progress) => {
            const now = Date.now();
            if (now - lastProgressAt < 500 && progress.finished < progress.total) return;
            lastProgressAt = now;
            const elapsedMs = now - startedAtMs;
            const estimatedRemainingMs = progress.finished > 0 && progress.total > progress.finished
              ? Math.max(0, Math.round((elapsedMs / progress.finished) * (progress.total - progress.finished)))
              : null;
            updateTask(task.id, {
              status: "running",
              startedAt,
              total: progress.total,
              finished: progress.finished,
              elapsedMs,
              estimatedRemainingMs,
              currentFileName: progress.currentPath
            });
          }
        });

        const elapsedMs = Date.now() - startedAtMs;
        updateTask(task.id, {
          successCount: 1,
          elapsedMs,
          estimatedRemainingMs: null,
          currentFileName: "",
          result: result as unknown as Record<string, unknown>
        });
        finishTask(task.id, result as unknown as Record<string, unknown>);
      } catch (err: any) {
        failTask(task.id, [{ reason: err?.message || "清理工作区失败" }]);
      }
    })();

    sendSuccess(res, { taskId: task.id, total: 0, mode: "archive_cleanup" }, 202);
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
      includeArchive: req.body?.includeArchive !== false
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
