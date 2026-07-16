import path from "path";
import { createReadStream, promises as nativeFs, watch, type FSWatcher } from "fs";
import { createHash } from "crypto";
import fs from "fs-extra";
import { emitImageCreated } from "../realtime/socket";
import { safeLog } from "../utils/logger";
import { getImageDtoById } from "./images";
import {
  cameraFtpReceiptStore,
  type CameraFtpFileReceipt,
  type CameraFtpReceiptResult
} from "./cameraFtpReceipts";
import {
  importImageFiles,
  type ImportProgressSnapshot,
  type ImportSourceFile
} from "./imageImport";
import { createTask, failTask, finishTask, updateTask } from "./tasks";
import {
  classifyCameraFtpCandidate,
  coalesceCameraFtpWatcherRecords,
  createCameraFtpFileFingerprint,
  isSameCameraFtpWatcherContext as sameContext,
  isTerminalCameraFtpWatcherRecordStatus as isTerminalRecordStatus,
  normalizeCameraFtpWatcherPath as normalizePath,
  type CameraFtpWatcherContext,
  type CameraFtpWatcherPendingFileState as PendingFile,
  type CameraFtpWatcherRecord,
  type CameraFtpWatcherRuntimeOptions as RuntimeOptions,
  type CameraFtpWatcherStableFileState as StableFile,
  type CameraFtpWatcherStatus,
  type CameraFtpWatcherTestingOptions,
  type StartCameraFtpWatcherInput
} from "./camera-ftp/cameraFtpWatcherModel";

export {
  classifyCameraFtpCandidate,
  coalesceCameraFtpWatcherRecords,
  createCameraFtpFileFingerprint,
  isSameCameraFtpWatcherContext,
  isTerminalCameraFtpWatcherRecordStatus,
  normalizeCameraFtpWatcherPath
} from "./camera-ftp/cameraFtpWatcherModel";
export type {
  CameraFtpCandidateClassification,
  CameraFtpWatcherContext,
  CameraFtpWatcherPendingFileState,
  CameraFtpWatcherRecord,
  CameraFtpWatcherRecordStatus,
  CameraFtpWatcherRuntimeOptions,
  CameraFtpWatcherStableFileState,
  CameraFtpWatcherStatus,
  CameraFtpWatcherTestingOptions,
  StartCameraFtpWatcherInput
} from "./camera-ftp/cameraFtpWatcherModel";

const DEFAULT_STABILITY_INTERVAL_MS = 1500;
const DEFAULT_STABILITY_CHECKS = 3;
const DEFAULT_IMPORT_BATCH_DELAY_MS = 500;
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000;
const MAX_READ_RETRIES = 3;
const READ_RETRY_DELAY_MS = 1000;
const RECENT_RECORD_LIMIT = 100;

function nowIso(): string {
  return new Date().toISOString();
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRuntimeOptions(testing?: CameraFtpWatcherTestingOptions): RuntimeOptions {
  return {
    stabilityIntervalMs: Math.max(10, testing?.stabilityIntervalMs ?? DEFAULT_STABILITY_INTERVAL_MS),
    stabilityChecks: Math.max(1, Math.trunc(testing?.stabilityChecks ?? DEFAULT_STABILITY_CHECKS)),
    importBatchDelayMs: Math.max(0, testing?.importBatchDelayMs ?? DEFAULT_IMPORT_BATCH_DELAY_MS),
    maxWaitMs: Math.max(100, testing?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS),
    importer: testing?.importer ?? importImageFiles,
    receiptStore: testing?.receiptStore ?? cameraFtpReceiptStore
  };
}

export class CameraFtpWatcher {
  private watcher: FSWatcher | null = null;
  private context: CameraFtpWatcherContext | null = null;
  private generation = 0;
  private options: RuntimeOptions = createRuntimeOptions();
  private pendingFiles = new Map<string, PendingFile>();
  private candidateReservations = new Set<string>();
  private queuedForImport = new Set<string>();
  private importingFiles = new Set<string>();
  private processedFiles = new Map<string, string>();
  private processedContentHashes = new Map<string, string>();
  private readyQueue: StableFile[] = [];
  private importBatchTimer: NodeJS.Timeout | null = null;
  private activeImportPromise: Promise<void> | null = null;
  private recentRecords: CameraFtpWatcherRecord[] = [];
  private lastReceivedAt = "";
  private lastScanAt = "";
  private lastError = "";

  getContext(): CameraFtpWatcherContext | null {
    return this.context ? { ...this.context } : null;
  }

  setBaseUrl(baseUrl: string): void {
    if (this.context && baseUrl) this.context = { ...this.context, baseUrl };
  }

  getStatus(limit = 30): CameraFtpWatcherStatus {
    return {
      running: Boolean(this.watcher && this.context),
      busy: this.isBusy(),
      directory: this.context?.directory ?? "",
      eventId: this.context?.eventId ?? "",
      eventName: this.context?.eventName ?? "",
      pendingCount: this.pendingFiles.size,
      queuedCount: this.queuedForImport.size,
      importingCount: this.importingFiles.size,
      unstableCount: this.pendingFiles.size,
      lastReceivedAt: this.lastReceivedAt,
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      recentRecords: coalesceCameraFtpWatcherRecords(this.recentRecords)
        .slice(0, Math.max(1, Math.min(RECENT_RECORD_LIMIT, limit)))
    };
  }

  isBusy(): boolean {
    return this.candidateReservations.size > 0
      || this.pendingFiles.size > 0
      || this.queuedForImport.size > 0
      || this.importingFiles.size > 0
      || this.readyQueue.length > 0
      || Boolean(this.importBatchTimer)
      || Boolean(this.activeImportPromise);
  }

  async start(input: StartCameraFtpWatcherInput): Promise<CameraFtpWatcherStatus> {
    const nextContext: CameraFtpWatcherContext = {
      eventId: input.eventId,
      eventName: input.eventName,
      eventSlug: input.eventSlug,
      directory: normalizePath(input.directory),
      cameraName: input.cameraName || "相机 FTP",
      photographer: input.photographer || "",
      baseUrl: input.baseUrl
    };
    if (!nextContext.eventId || !nextContext.directory) {
      throw Object.assign(new Error("相机 FTP watcher 缺少活动或目录。"), { code: "FTP_PATH_INVALID" });
    }
    if (input.createDirectory !== false) {
      await fs.ensureDir(nextContext.directory);
    }
    let stat;
    try {
      stat = await nativeFs.stat(nextContext.directory);
    } catch (error: any) {
      throw Object.assign(new Error("相机 FTP 接收目录不存在或当前不可访问。"), {
        code: "FTP_PATH_INVALID",
        cause: error
      });
    }
    if (!stat.isDirectory()) {
      throw Object.assign(new Error("相机 FTP 接收路径不是目录。"), { code: "FTP_PATH_INVALID" });
    }

    if (this.watcher && sameContext(this.context, nextContext)) {
      this.context = { ...this.context!, baseUrl: nextContext.baseUrl };
      return this.getStatus();
    }
    if (this.isBusy()) {
      throw Object.assign(new Error("仍有相机文件正在上传或导入，暂时不能切换监听活动。"), {
        code: "FTP_UPLOAD_IN_PROGRESS"
      });
    }
    this.stop({ force: true, reason: "switch" });

    this.generation += 1;
    const generation = this.generation;
    this.context = nextContext;
    this.options = createRuntimeOptions(input.testing);
    this.lastError = "";
    this.processedFiles.clear();
    this.processedContentHashes.clear();
    await this.restoreProcessedFileReceipts(nextContext, generation);

    this.watcher = watch(nextContext.directory, { persistent: true }, (_eventType, filename) => {
      if (!this.context || this.generation !== generation) return;
      this.lastScanAt = nowIso();
      if (filename) {
        void this.enqueueCandidate(path.join(nextContext.directory, filename.toString()), generation);
      } else {
        void this.scanDirectory(generation);
      }
    });
    this.watcher.on("error", (error) => {
      if (this.generation !== generation) return;
      this.lastError = error.message || "目录监听失败";
      safeLog("error", { error, eventId: nextContext.eventId, directory: nextContext.directory }, "相机 FTP watcher 发生错误");
    });
    safeLog("info", { eventId: nextContext.eventId, directory: nextContext.directory }, "相机 FTP watcher 已启动");
    if (input.scanExistingOnStart !== false) await this.scanDirectory(generation);
    return this.getStatus();
  }

  async scanExistingFiles(): Promise<CameraFtpWatcherStatus> {
    if (this.context) await this.scanDirectory(this.generation);
    return this.getStatus();
  }

  stop(options: { force?: boolean; reason?: string } = {}): void {
    if (!options.force && this.isBusy()) {
      throw Object.assign(new Error("仍有相机文件正在上传或导入，暂时不能停止 watcher。"), {
        code: "FTP_UPLOAD_IN_PROGRESS"
      });
    }
    const previous = this.context;
    this.generation += 1;
    try {
      this.watcher?.close();
    } catch {
      // Closing an already-closed fs watcher is harmless.
    }
    this.watcher = null;
    for (const pending of this.pendingFiles.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pendingFiles.clear();
    this.candidateReservations.clear();
    this.queuedForImport.clear();
    this.readyQueue = [];
    if (this.importBatchTimer) clearTimeout(this.importBatchTimer);
    this.importBatchTimer = null;
    if (options.force) this.importingFiles.clear();
    if (previous) {
      this.recentRecords = this.recentRecords.filter((record) => (
        record.eventId !== previous.eventId || isTerminalRecordStatus(record.status)
      ));
    }
    this.context = null;
    if (previous) {
      safeLog("info", {
        eventId: previous.eventId,
        directory: previous.directory,
        reason: options.reason || "manual"
      }, "相机 FTP watcher 已停止");
    }
  }

  async shutdown(timeoutMs = 15_000): Promise<{ drained: boolean }> {
    const previous = this.context;
    const activeImport = this.activeImportPromise;
    this.generation += 1;
    try {
      this.watcher?.close();
    } catch {
      // Closing an already-closed fs watcher is harmless.
    }
    this.watcher = null;
    for (const pending of this.pendingFiles.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pendingFiles.clear();
    this.candidateReservations.clear();
    this.queuedForImport.clear();
    this.readyQueue = [];
    if (this.importBatchTimer) clearTimeout(this.importBatchTimer);
    this.importBatchTimer = null;

    let drained = true;
    if (activeImport) {
      let timeout: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          activeImport,
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              drained = false;
              resolve();
            }, Math.max(0, timeoutMs));
          })
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    this.importingFiles.clear();
    this.context = null;
    if (previous) {
      safeLog(drained ? "info" : "warn", {
        eventId: previous.eventId,
        directory: previous.directory,
        drained,
        timeoutMs
      }, drained
        ? "相机 FTP watcher 已停止，活动导入已安全收尾"
        : "相机 FTP watcher 已停止，但活动导入未在退出时限内完成；原图将由下次启动补扫");
    }
    return { drained };
  }

  private pushRecord(input: Omit<CameraFtpWatcherRecord, "id" | "detectedAt" | "receivedAt" | "updatedAt" | "importedAt" | "finishedAt" | "taskId" | "error"> & { taskId?: string; error?: string }): string {
    const timestamp = nowIso();
    const id = `camera_ftp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const inputPath = normalizePath(input.path).toLowerCase();
    this.recentRecords = this.recentRecords.filter((record) => (
      record.eventId !== input.eventId
        || normalizePath(record.path).toLowerCase() !== inputPath
        || isTerminalRecordStatus(record.status)
    ));
    this.recentRecords = [{
      id,
      detectedAt: timestamp,
      receivedAt: timestamp,
      updatedAt: timestamp,
      importedAt: "",
      finishedAt: "",
      taskId: input.taskId ?? "",
      error: input.error ?? "",
      ...input
    }, ...this.recentRecords].slice(0, RECENT_RECORD_LIMIT);
    this.lastReceivedAt = timestamp;
    return id;
  }

  private updateRecord(recordId: string, patch: Partial<CameraFtpWatcherRecord>): void {
    const timestamp = nowIso();
    this.recentRecords = this.recentRecords.map((record) => {
      if (record.id !== recordId) return record;
      const finished = patch.status === "imported" || patch.status === "skipped" || patch.status === "failed";
      return {
        ...record,
        ...patch,
        updatedAt: timestamp,
        importedAt: patch.status === "imported" ? timestamp : (patch.importedAt ?? record.importedAt),
        finishedAt: finished ? timestamp : (patch.finishedAt ?? record.finishedAt)
      };
    });
  }

  private async scanDirectory(generation: number): Promise<void> {
    const context = this.context;
    if (!context || generation !== this.generation) return;
    this.lastScanAt = nowIso();
    try {
      const entries = await nativeFs.readdir(context.directory, { withFileTypes: true });
      await Promise.all(entries
        .filter((entry) => entry.isFile())
        .map((entry) => this.enqueueCandidate(path.join(context.directory, entry.name), generation)));
    } catch (error: any) {
      this.lastError = error?.message || "扫描相机 FTP 接收目录失败";
      safeLog("warn", { error, eventId: context.eventId, directory: context.directory }, "扫描相机 FTP 接收目录失败");
    }
  }

  private async restoreProcessedFileReceipts(context: CameraFtpWatcherContext, generation: number): Promise<void> {
    try {
      const directoryKey = `${normalizePath(context.directory).toLowerCase()}${path.sep}`;
      const receipts = this.options.receiptStore.list(context.eventId);
      const restoreReceipt = async (receipt: CameraFtpFileReceipt) => {
        if (generation !== this.generation || this.context?.eventId !== context.eventId) return;
        const normalized = normalizePath(receipt.filePath);
        const fileKey = normalized.toLowerCase();
        if (!fileKey.startsWith(directoryKey)) return;
        try {
          const stat = await nativeFs.stat(normalized);
          if (!stat.isFile()) return;
          const currentFingerprint = createCameraFtpFileFingerprint(stat.size, stat.mtimeMs);
          const receiptFingerprint = receipt.modifiedMs > 0
            ? createCameraFtpFileFingerprint(receipt.fileSize, receipt.modifiedMs)
            : "";
          const legacyImageMatches = receipt.modifiedMs <= 0 && stat.size === receipt.fileSize;
          if (currentFingerprint === receiptFingerprint || legacyImageMatches) {
            if (receipt.contentHash) {
              const currentContentHash = await this.hashFileContent(normalized);
              if (currentContentHash !== receipt.contentHash) return;
              this.processedContentHashes.set(normalized, currentContentHash);
            }
            this.processedFiles.set(normalized, currentFingerprint);
          }
        } catch {
          // Missing historical files do not block watcher startup.
        }
      };
      for (let index = 0; index < receipts.length; index += 4) {
        await Promise.all(receipts.slice(index, index + 4).map(restoreReceipt));
      }
      safeLog("info", {
        eventId: context.eventId,
        restoredCount: this.processedFiles.size
      }, "相机 FTP watcher 已恢复历史文件处理回执");
    } catch (error) {
      safeLog("warn", { error, eventId: context.eventId }, "读取相机 FTP 文件处理回执失败，将继续执行数据库去重");
    }
  }

  private async enqueueCandidate(filePath: string, generation: number): Promise<void> {
    const context = this.context;
    if (!context || generation !== this.generation) return;
    const normalized = normalizePath(filePath);
    if (!classifyCameraFtpCandidate(normalized).accepted) return;
    if (this.candidateReservations.has(normalized)
      || this.pendingFiles.has(normalized)
      || this.queuedForImport.has(normalized)
      || this.importingFiles.has(normalized)) return;

    this.candidateReservations.add(normalized);
    try {
      const stat = await nativeFs.stat(normalized);
      if (!stat.isFile() || !this.context || generation !== this.generation) return;
      if (this.pendingFiles.has(normalized)
        || this.queuedForImport.has(normalized)
        || this.importingFiles.has(normalized)) return;
      const fingerprint = createCameraFtpFileFingerprint(stat.size, stat.mtimeMs);
      if (this.processedFiles.get(normalized) === fingerprint) {
        const previousContentHash = this.processedContentHashes.get(normalized);
        if (!previousContentHash || await this.hashFileContent(normalized) === previousContentHash) return;
      }
      this.processedFiles.delete(normalized);
      this.processedContentHashes.delete(normalized);
      const recordId = this.pushRecord({
        filename: path.basename(normalized),
        path: normalized,
        eventId: context.eventId,
        eventName: context.eventName,
        status: "receiving",
        size: stat.size,
        reason: "等待 IIS FTP 写入完成"
      });
      this.pendingFiles.set(normalized, {
        generation,
        path: normalized,
        filename: path.basename(normalized),
        recordId,
        firstSeenAtMs: Date.now(),
        lastSize: stat.size,
        lastMtimeMs: stat.mtimeMs,
        stableChecks: 0,
        timer: null
      });
      this.schedulePendingCheck(normalized);
    } catch {
      // IIS may emit a filesystem notification before the file can be stat'ed.
      // A later notification or scan will retry it.
    } finally {
      this.candidateReservations.delete(normalized);
    }
  }

  private schedulePendingCheck(filePath: string): void {
    const pending = this.pendingFiles.get(filePath);
    if (!pending) return;
    pending.timer = setTimeout(() => {
      void this.checkPendingFile(filePath);
    }, this.options.stabilityIntervalMs);
  }

  private async checkPendingFile(filePath: string): Promise<void> {
    const pending = this.pendingFiles.get(filePath);
    const context = this.context;
    if (!pending || !context || pending.generation !== this.generation) return;

    try {
      const stat = await nativeFs.stat(pending.path);
      if (!stat.isFile()) {
        this.failPending(pending, "路径不是文件");
        return;
      }
      const unchanged = stat.size > 0
        && stat.size === pending.lastSize
        && stat.mtimeMs === pending.lastMtimeMs;
      pending.stableChecks = unchanged ? pending.stableChecks + 1 : 0;
      pending.lastSize = stat.size;
      pending.lastMtimeMs = stat.mtimeMs;
      this.updateRecord(pending.recordId, {
        size: stat.size,
        status: unchanged ? "waiting" : "receiving",
        reason: unchanged ? "等待稳定检测完成" : "文件仍在上传"
      });

      if (pending.stableChecks >= this.options.stabilityChecks) {
        if (!await this.canReadFile(pending.path)) {
          this.failPending(pending, "文件读取失败，可能仍在写入、文件损坏或权限不足。");
          return;
        }
        const contentHash = await this.hashFileContent(pending.path);
        const verifiedStat = await nativeFs.stat(pending.path);
        if (verifiedStat.size !== stat.size || verifiedStat.mtimeMs !== stat.mtimeMs) {
          pending.lastSize = verifiedStat.size;
          pending.lastMtimeMs = verifiedStat.mtimeMs;
          pending.stableChecks = 0;
          this.updateRecord(pending.recordId, {
            size: verifiedStat.size,
            status: "receiving",
            reason: "文件在内容校验期间继续变化，重新等待稳定"
          });
          this.schedulePendingCheck(filePath);
          return;
        }
        this.pendingFiles.delete(filePath);
        this.queueStableFile({
          path: pending.path,
          filename: pending.filename,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash,
          recordId: pending.recordId
        });
        return;
      }

      if (Date.now() - pending.firstSeenAtMs > this.options.maxWaitMs) {
        this.failPending(pending, "等待 IIS FTP 写入完成超时。");
        return;
      }
      this.schedulePendingCheck(filePath);
    } catch (error: any) {
      if (Date.now() - pending.firstSeenAtMs > this.options.maxWaitMs) {
        this.failPending(pending, error?.message || "文件读取失败");
      } else {
        this.schedulePendingCheck(filePath);
      }
    }
  }

  private failPending(pending: PendingFile, reason: string): void {
    this.pendingFiles.delete(pending.path);
    this.lastError = reason;
    this.updateRecord(pending.recordId, { status: "failed", reason, error: reason });
  }

  private async canReadFile(filePath: string): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_READ_RETRIES; attempt += 1) {
      try {
        const handle = await nativeFs.open(filePath, "r");
        await handle.close();
        return true;
      } catch {
        if (attempt < MAX_READ_RETRIES) await waitMs(READ_RETRY_DELAY_MS);
      }
    }
    return false;
  }

  private queueStableFile(file: StableFile): void {
    const normalized = normalizePath(file.path);
    if (this.queuedForImport.has(normalized)
      || this.importingFiles.has(normalized)) return;
    this.queuedForImport.add(normalized);
    this.readyQueue.push(file);
    this.updateRecord(file.recordId, { status: "waiting", reason: "文件写入已稳定，等待自动导入" });
    if (!this.importBatchTimer) {
      this.importBatchTimer = setTimeout(() => {
        this.importBatchTimer = null;
        const files = this.readyQueue;
        this.readyQueue = [];
        const run = this.runImportBatch(files);
        const tracked = run.finally(() => {
          if (this.activeImportPromise === tracked) this.activeImportPromise = null;
        });
        this.activeImportPromise = tracked;
      }, this.options.importBatchDelayMs);
    }
  }

  private async runImportBatch(files: StableFile[]): Promise<void> {
    const context = this.context;
    const generation = this.generation;
    if (!context || files.length === 0) return;
    let taskId = "";
    try {
      taskId = createTask({
        type: "camera_ftp_import",
        eventId: context.eventId,
        title: `相机 FTP 自动导入 ${files.length} 张图片`,
        total: files.length
      }).id;
    } catch (error) {
      safeLog("warn", { error, eventId: context.eventId }, "相机 FTP 任务中心记录创建失败，图片导入继续");
    }
    const updateTaskSafely = (operation: () => void, stage: string) => {
      if (!taskId) return;
      try {
        operation();
      } catch (error) {
        safeLog("warn", { error, eventId: context.eventId, taskId, stage }, "相机 FTP 任务中心记录失败，核心图片结果不回滚");
      }
    };
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const sourceFiles: ImportSourceFile[] = files.map((file) => ({
      filename: file.filename,
      path: file.path,
      size: file.size
    }));
    for (const file of files) {
      const normalized = normalizePath(file.path);
      this.queuedForImport.delete(normalized);
      this.importingFiles.add(normalized);
      this.updateRecord(file.recordId, { status: "importing", taskId, reason: "正在自动导入" });
    }

    const applyProgress = (snapshot: ImportProgressSnapshot) => {
      updateTaskSafely(() => updateTask(taskId, {
        status: "running",
        startedAt,
        total: snapshot.total,
        finished: snapshot.processed,
        successCount: snapshot.success,
        failedCount: snapshot.failed,
        skippedCount: snapshot.skipped,
        errors: snapshot.errors,
        elapsedMs: Date.now() - startedAtMs,
        estimatedRemainingMs: null,
        currentFileName: snapshot.currentFileName
      }), "progress");
    };

    try {
      updateTaskSafely(() => updateTask(taskId, { status: "running", startedAt, total: files.length }), "start");
      const result = await this.options.importer({
        eventId: context.eventId,
        files: sourceFiles,
        folderPath: context.directory,
        sourceType: "camera_ftp",
        photographer: context.photographer,
        device: context.cameraName,
        actor: { type: "camera", id: "camera_ftp", name: context.cameraName },
        options: {
          maxErrors: 100,
          onProgress: applyProgress,
          onImageImported: (image) => {
            // Socket.IO payloads are shared by host and LAN clients, so media
            // URLs must stay same-origin instead of inheriting a request Host.
            try {
              const dto = getImageDtoById(image.id, "");
              emitImageCreated({
                eventId: dto.event_id,
                imageId: dto.id,
                image: dto,
                action: "image_created",
                actor: { type: "camera", id: "camera_ftp", name: context.cameraName },
                updatedAt: nowIso()
              });
            } catch (error) {
              safeLog("warn", { error, eventId: context.eventId, imageId: image.id }, "图片已安全入库，但 Socket.IO 广播失败");
            }
          }
        }
      });
      this.updateRecordsAfterImport(context.eventId, files, result);
      updateTaskSafely(() => updateTask(taskId, {
        total: result.total,
        finished: result.success + result.failed + result.skipped,
        successCount: result.success,
        failedCount: result.failed,
        skippedCount: result.skipped,
        errors: result.errors,
        elapsedMs: Date.now() - startedAtMs,
        estimatedRemainingMs: null,
        currentFileName: "",
        result: {
          total: result.total,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
          importedCount: result.imported.length,
          sourceType: "camera_ftp",
          directory: context.directory,
          errors: result.errors
        }
      }), "result");
      updateTaskSafely(() => finishTask(taskId, {
        total: result.total,
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
        importedCount: result.imported.length,
        sourceType: "camera_ftp",
        directory: context.directory,
        errors: result.errors
      }), "finish");
    } catch (error: any) {
      const reason = error?.message || "相机 FTP 自动导入失败";
      this.lastError = reason;
      for (const file of files) {
        this.updateRecord(file.recordId, { status: "failed", taskId, reason, error: reason });
      }
      updateTaskSafely(() => failTask(taskId, [{ reason }]), "fail");
      safeLog("error", { error, eventId: context.eventId, directory: context.directory }, "相机 FTP 自动导入任务失败");
    } finally {
      for (const file of files) {
        const normalized = normalizePath(file.path);
        this.importingFiles.delete(normalized);
      }
      if (generation !== this.generation) {
        safeLog("warn", { eventId: context.eventId }, "相机 FTP watcher generation 已变化，旧导入批次刚刚结束");
      }
    }
  }

  private updateRecordsAfterImport(
    eventId: string,
    files: StableFile[],
    result: Awaited<ReturnType<typeof importImageFiles>>
  ): void {
    const importedCounts = new Map<string, number>();
    for (const item of result.imported) {
      importedCounts.set(item.originalFilename, (importedCounts.get(item.originalFilename) ?? 0) + 1);
    }
    const errorsByPath = new Map(result.errors.map((error) => [normalizePath(error.path), error.reason]));
    const errorsByFilename = new Map(result.errors.map((error) => [error.filename, error.reason]));
    for (const file of files) {
      const error = errorsByPath.get(normalizePath(file.path)) || errorsByFilename.get(file.filename);
      if (error) {
        this.updateRecord(file.recordId, { status: "failed", reason: error, error });
        continue;
      }
      const importedCount = importedCounts.get(file.filename) ?? 0;
      if (importedCount > 0) {
        importedCounts.set(file.filename, importedCount - 1);
        this.updateRecord(file.recordId, { status: "imported", reason: "自动导入成功" });
        this.saveFileReceipt(eventId, file, "imported");
        this.processedFiles.set(normalizePath(file.path), createCameraFtpFileFingerprint(file.size, file.mtimeMs));
        this.processedContentHashes.set(normalizePath(file.path), file.contentHash);
      } else {
        this.updateRecord(file.recordId, { status: "skipped", reason: "已跳过同活动重复图片" });
        this.saveFileReceipt(eventId, file, "skipped");
        this.processedFiles.set(normalizePath(file.path), createCameraFtpFileFingerprint(file.size, file.mtimeMs));
        this.processedContentHashes.set(normalizePath(file.path), file.contentHash);
      }
    }
  }

  private saveFileReceipt(eventId: string, file: StableFile, result: CameraFtpReceiptResult): void {
    const receipt: CameraFtpFileReceipt = {
      eventId,
      filePath: normalizePath(file.path),
      fileSize: file.size,
      modifiedMs: file.mtimeMs,
      contentHash: file.contentHash,
      result
    };
    try {
      this.options.receiptStore.save(receipt);
    } catch (error) {
      safeLog("warn", { error, eventId, filePath: receipt.filePath }, "保存相机 FTP 文件处理回执失败");
    }
  }

  private hashFileContent(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }
}

const cameraFtpWatcher = new CameraFtpWatcher();

export function getCameraFtpWatcher(): CameraFtpWatcher {
  return cameraFtpWatcher;
}

export function setCameraFtpWatcherBaseUrl(baseUrl: string): void {
  cameraFtpWatcher.setBaseUrl(baseUrl);
}

export function getCameraFtpWatcherStatus(limit?: number): CameraFtpWatcherStatus {
  return cameraFtpWatcher.getStatus(limit);
}

export function isCameraFtpWatcherBusy(): boolean {
  return cameraFtpWatcher.isBusy();
}

export async function startCameraFtpWatcher(input: StartCameraFtpWatcherInput): Promise<CameraFtpWatcherStatus> {
  return cameraFtpWatcher.start(input);
}

export async function scanCameraFtpWatcher(): Promise<CameraFtpWatcherStatus> {
  return cameraFtpWatcher.scanExistingFiles();
}

export function stopCameraFtpWatcher(options?: { force?: boolean; reason?: string }): void {
  cameraFtpWatcher.stop(options);
}

export function shutdownCameraFtpWatcher(timeoutMs?: number): Promise<{ drained: boolean }> {
  return cameraFtpWatcher.shutdown(timeoutMs);
}
