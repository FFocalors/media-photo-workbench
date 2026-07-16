const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const requireDist = (relativePath) => require(path.join(dist, relativePath));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createMemoryReceiptStore() {
  const receipts = new Map();
  const keyFor = (eventId, filePath) => `${eventId}\0${path.resolve(filePath).toLowerCase()}`;
  return {
    receipts,
    store: {
      list(eventId) {
        return Array.from(receipts.values()).filter((receipt) => receipt.eventId === eventId);
      },
      save(receipt) {
        receipts.set(keyFor(receipt.eventId, receipt.filePath), { ...receipt });
      }
    },
    get(eventId, filePath) {
      return receipts.get(keyFor(eventId, filePath));
    }
  };
}

async function returnSuccessfulImport(input, suffix = "success") {
  const imported = input.files.map((file, index) => ({
    id: `img_${suffix}_${index}`,
    originalFilename: file.filename,
    storedFilename: file.filename,
    originalPath: file.path,
    thumbPath: `${file.path}.thumb.webp`,
    previewPath: `${file.path}.preview.webp`
  }));
  for (const item of imported) {
    await input.options?.onImageImported?.(item);
  }
  input.options?.onProgress?.({
    total: input.files.length,
    processed: input.files.length,
    success: input.files.length,
    failed: 0,
    skipped: 0,
    errors: [],
    currentFileName: "",
    importedCount: imported.length,
    totalBytes: input.files.reduce((sum, file) => sum + file.size, 0),
    processedBytes: input.files.reduce((sum, file) => sum + file.size, 0)
  });
  return {
    eventId: input.eventId,
    folderPath: input.folderPath,
    sourceType: input.sourceType,
    photographer: input.photographer,
    device: input.device,
    remark: "",
    total: input.files.length,
    success: input.files.length,
    failed: 0,
    skipped: 0,
    imported,
    errors: []
  };
}

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-camera-watcher-"));
  const firstDirectory = path.join(tempRoot, "working", "first", "原图", "相机FTP");
  const secondDirectory = path.join(tempRoot, "working", "second", "原图", "相机FTP");
  fs.mkdirSync(firstDirectory, { recursive: true });
  fs.mkdirSync(secondDirectory, { recursive: true });

  const realtime = requireDist("realtime/socket.js");
  const images = requireDist("services/images.js");
  let imageCreatedEvents = 0;
  realtime.emitImageCreated = () => { imageCreatedEvents += 1; };
  images.getImageDtoById = (id) => ({ id, event_id: "evt_first" });

  const watcherModelModule = requireDist("services/camera-ftp/cameraFtpWatcherModel.js");
  const watcherModule = requireDist("services/cameraFtpWatcher.js");
  let importCalls = 0;
  const importedFiles = [];
  const receiptMap = new Map();
  const receiptStore = {
    list(eventId) {
      return Array.from(receiptMap.values()).filter((receipt) => receipt.eventId === eventId);
    },
    save(receipt) {
      receiptMap.set(`${receipt.eventId}\0${path.resolve(receipt.filePath).toLowerCase()}`, { ...receipt });
    }
  };
  const fakeImporter = async (input) => {
    importCalls += 1;
    assert.equal(path.resolve(input.folderPath), path.resolve(input.files[0].path, ".."), "watcher must import from the final camera original directory");
    const duplicate = importCalls === 2;
    const imported = duplicate ? [] : input.files.map((file, index) => ({
      id: `img_test_${importCalls}_${index}`,
      originalFilename: file.filename,
      storedFilename: file.filename,
      originalPath: file.path,
      thumbPath: `${file.path}.thumb.webp`,
      previewPath: `${file.path}.preview.webp`
    }));
    for (const item of imported) {
      importedFiles.push(item.originalFilename);
      await input.options?.onImageImported?.(item);
    }
    input.options?.onProgress?.({
      total: input.files.length,
      processed: input.files.length,
      success: duplicate ? 0 : input.files.length,
      failed: 0,
      skipped: duplicate ? input.files.length : 0,
      errors: [],
      currentFileName: "",
      importedCount: imported.length,
      totalBytes: input.files.reduce((sum, file) => sum + file.size, 0),
      processedBytes: input.files.reduce((sum, file) => sum + file.size, 0)
    });
    return {
      eventId: input.eventId,
      folderPath: input.folderPath,
      sourceType: input.sourceType,
      photographer: input.photographer,
      device: input.device,
      remark: "",
      total: input.files.length,
      success: duplicate ? 0 : input.files.length,
      failed: 0,
      skipped: duplicate ? input.files.length : 0,
      imported,
      errors: []
    };
  };

  const testing = {
    stabilityIntervalMs: 35,
    stabilityChecks: 3,
    importBatchDelayMs: 10,
    maxWaitMs: 2000,
    importer: fakeImporter,
    receiptStore
  };
  const faultInjectionResults = {};
  const faultInjectionFailures = [];
  const runFaultInjectionCase = async (name, callback) => {
    try {
      await callback();
      faultInjectionResults[name] = "passed";
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      faultInjectionResults[name] = `failed: ${message}`;
      faultInjectionFailures.push(`${name}: ${message}`);
    }
  };
  const createIsolatedInput = (eventId, eventSlug, directory, options = {}) => ({
    eventId,
    eventName: `Fault ${eventSlug}`,
    eventSlug,
    directory,
    cameraName: "Fault Camera",
    photographer: "",
    baseUrl: "http://127.0.0.1:3030",
    scanExistingOnStart: options.scanExistingOnStart,
    createDirectory: options.createDirectory,
    testing: {
      stabilityIntervalMs: 20,
      stabilityChecks: 1,
      importBatchDelayMs: 0,
      maxWaitMs: 160,
      importer: options.importer,
      receiptStore: options.receiptStore
    }
  });

  try {
    assert.equal(
      watcherModule.classifyCameraFtpCandidate,
      watcherModelModule.classifyCameraFtpCandidate,
      "the legacy watcher module must re-export the pure candidate classifier"
    );
    assert.equal(
      watcherModule.coalesceCameraFtpWatcherRecords,
      watcherModelModule.coalesceCameraFtpWatcherRecords,
      "the legacy watcher module must re-export the pure record coalescer"
    );
    assert.deepEqual(watcherModelModule.classifyCameraFtpCandidate("photo.JPG"), { accepted: true, reason: "" });
    assert.equal(watcherModelModule.classifyCameraFtpCandidate("photo.png").accepted, false);
    assert.equal(watcherModelModule.classifyCameraFtpCandidate(".hidden.jpg").accepted, false);
    assert.equal(watcherModelModule.classifyCameraFtpCandidate("photo.part").accepted, false);
    assert.equal(
      watcherModelModule.normalizeCameraFtpWatcherPath(path.join(".", "camera", "photo.jpg")),
      path.resolve(".", "camera", "photo.jpg"),
      "the model must own watcher path normalization"
    );
    assert.equal(
      watcherModelModule.createCameraFtpFileFingerprint(42, 1234.9),
      "42:1234",
      "the model must preserve the watcher file fingerprint format"
    );
    assert.equal(watcherModelModule.isSameCameraFtpWatcherContext(null, {
      eventId: "evt_first",
      directory: firstDirectory
    }), false);
    assert.equal(watcherModelModule.isSameCameraFtpWatcherContext({
      eventId: "evt_first",
      directory: path.join(firstDirectory, ".")
    }, {
      eventId: "evt_first",
      directory: firstDirectory
    }), true, "context equality must remain event-and-normalized-path based");

    const duplicateRecordPath = path.join(firstDirectory, "same-notification.jpg");
    const baseRecord = {
      id: "record_receiving",
      filename: "same-notification.jpg",
      path: duplicateRecordPath,
      eventId: "evt_first",
      eventName: "First Event",
      status: "receiving",
      size: 1024,
      detectedAt: "2026-07-15T10:26:00.000Z",
      receivedAt: "2026-07-15T10:26:00.000Z",
      updatedAt: "2026-07-15T10:26:01.000Z",
      importedAt: "",
      finishedAt: "",
      taskId: "",
      reason: "等待 IIS FTP 写入完成",
      error: ""
    };
    const coalescedRecords = watcherModelModule.coalesceCameraFtpWatcherRecords([
      baseRecord,
      {
        ...baseRecord,
        id: "record_imported",
        status: "imported",
        updatedAt: "2026-07-15T10:26:08.000Z",
        importedAt: "2026-07-15T10:26:08.000Z",
        finishedAt: "2026-07-15T10:26:08.000Z",
        reason: "自动导入成功"
      }
    ]);
    assert.equal(coalescedRecords.length, 1, "one file path must expose only its latest watcher state");
    assert.equal(coalescedRecords[0].status, "imported", "a stale receiving notification must not mask a completed import");

    const watcherSource = fs.readFileSync(path.join(root, "src-server", "services", "cameraFtpWatcher.ts"), "utf8");
    const watcherModelSource = fs.readFileSync(path.join(root, "src-server", "services", "camera-ftp", "cameraFtpWatcherModel.ts"), "utf8");
    assert.doesNotMatch(watcherModelSource, /from\s+["'](?:fs|fs-extra|crypto)["']/, "the watcher model boundary must remain free of filesystem and hashing IO");
    assert.match(watcherSource, /candidateReservations\.add\(normalized\)[\s\S]*finally[\s\S]*candidateReservations\.delete\(normalized\)/, "candidate registration must cover the asynchronous stat window");

    const firstInput = {
      eventId: "evt_first",
      eventName: "First Event",
      eventSlug: "first",
      directory: firstDirectory,
      cameraName: "Test Camera",
      photographer: "",
      baseUrl: "http://127.0.0.1:3030",
      testing
    };
    const legacyImportedFile = path.join(firstDirectory, "legacy-imported.jpg");
    fs.writeFileSync(legacyImportedFile, Buffer.from([0xff, 0xd8, 0x30, 0x31, 0xff, 0xd9]));
    receiptMap.set(`evt_first\0${path.resolve(legacyImportedFile).toLowerCase()}`, {
      eventId: "evt_first",
      filePath: legacyImportedFile,
      fileSize: fs.statSync(legacyImportedFile).size,
      modifiedMs: 0,
      result: "imported"
    });
    await watcherModule.startCameraFtpWatcher(firstInput);
    await watcherModule.startCameraFtpWatcher(firstInput);
    assert.equal(watcherModule.getCameraFtpWatcherStatus().eventId, "evt_first");
    await wait(180);
    assert.equal(importCalls, 0, "existing camera_ftp image rows must bootstrap receipts without re-importing on upgrade");

    const growingFile = path.join(firstDirectory, "growing.jpg");
    fs.writeFileSync(growingFile, Buffer.from([0xff, 0xd8, 0x01]));
    await wait(45);
    fs.appendFileSync(growingFile, Buffer.from([0x02, 0x03, 0xff, 0xd9]));
    await wait(55);
    assert.equal(importCalls, 0, "a growing file must not be imported before it becomes stable");

    await waitFor(() => watcherModule.getCameraFtpWatcherStatus().recentRecords.some((record) => record.filename === "growing.jpg" && record.status === "imported"));
    assert.equal(importCalls, 1);
    assert.equal(imageCreatedEvents, 1, "successful camera import must publish image-created through the realtime abstraction");
    assert.deepEqual(importedFiles, ["growing.jpg"]);
    assert.equal(watcherModule.isCameraFtpWatcherBusy(), false);

    const duplicateFile = path.join(firstDirectory, "duplicate.jpeg");
    fs.writeFileSync(duplicateFile, Buffer.from([0xff, 0xd8, 0x04, 0xff, 0xd9]));
    await waitFor(() => watcherModule.getCameraFtpWatcherStatus().recentRecords.some((record) => record.filename === "duplicate.jpeg" && record.status === "skipped"));
    assert.equal(importCalls, 2);
    assert.equal(imageCreatedEvents, 1);

    fs.writeFileSync(growingFile, Buffer.from([0xff, 0xd8, 0x10, 0x11, 0x12, 0xff, 0xd9]));
    await waitFor(() => importCalls === 3);
    assert.equal(imageCreatedEvents, 2, "new content uploaded to the same landing path must be imported again");

    watcherModule.shutdownCameraFtpWatcher();
    await watcherModule.startCameraFtpWatcher(firstInput);
    await wait(250);
    assert.equal(importCalls, 3, "unchanged FTP files must not be re-imported after the watcher restarts");
    assert.equal(watcherModule.getCameraFtpWatcherStatus().pendingCount, 0);
    assert.equal(watcherModule.getCameraFtpWatcherStatus().queuedCount, 0);
    assert.equal(watcherModule.getCameraFtpWatcherStatus().importingCount, 0);

    await watcherModule.startCameraFtpWatcher({
      ...firstInput,
      eventId: "evt_second",
      eventName: "Second Event",
      eventSlug: "second",
      directory: secondDirectory
    });
    assert.equal(watcherModule.getCameraFtpWatcherStatus().eventId, "evt_second");
    assert.equal(watcherModule.getCameraFtpWatcherStatus().directory, path.resolve(secondDirectory));

    const callsBeforeOldDirectoryWrite = importCalls;
    fs.writeFileSync(path.join(firstDirectory, "must-not-import.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await wait(250);
    assert.equal(importCalls, callsBeforeOldDirectoryWrite, "the old event directory must not remain watched after a switch");

    watcherModule.shutdownCameraFtpWatcher();
    assert.equal(watcherModule.getCameraFtpWatcherStatus().running, false);
    assert.equal(watcherModule.isCameraFtpWatcherBusy(), false);

    await runFaultInjectionCase("missingDirectoryDoesNotGetCreated", async () => {
      const missingDirectory = path.join(tempRoot, "missing-repository", "原图", "相机FTP");
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await assert.rejects(
          () => isolatedWatcher.start(createIsolatedInput(
            "evt_missing",
            "missing",
            missingDirectory,
            { createDirectory: false, scanExistingOnStart: false }
          )),
          (error) => error?.code === "FTP_PATH_INVALID",
          "a missing repository path must return the stable FTP_PATH_INVALID code"
        );
        assert.equal(fs.existsSync(missingDirectory), false, "read-only recovery must not recreate a missing repository path");
        assert.equal(isolatedWatcher.getStatus().running, false);
      } finally {
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("directoryDisappearsAfterStart", async () => {
      const directory = path.join(tempRoot, "fault-directory-disappears", "原图", "相机FTP");
      const detachedDirectory = `${directory}-detached`;
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_disappears", "disappears", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            return returnSuccessfulImport(input, `directory_${calls}`);
          }
        }));
        fs.renameSync(directory, detachedDirectory);
        const status = await isolatedWatcher.scanExistingFiles();
        assert.equal(fs.existsSync(directory), false, "a scan must not silently recreate a disappeared repository directory");
        assert.notEqual(status.lastError, "", "directory loss must remain visible in watcher status");
        assert.equal(calls, 0, "directory loss must not create a false import");
      } finally {
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("shutdownDuringStabilityCheck", async () => {
      const directory = path.join(tempRoot, "fault-shutdown-stability", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_shutdown_stability", "shutdown-stability", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            return returnSuccessfulImport(input, `shutdown_stability_${calls}`);
          }
        }));
        fs.writeFileSync(path.join(directory, "still-uploading.jpg"), Buffer.from([0xff, 0xd8, 0x01]));
        await waitFor(() => isolatedWatcher.getStatus().pendingCount > 0);
        await Promise.resolve(isolatedWatcher.shutdown());
        assert.equal(isolatedWatcher.getStatus().running, false);
        assert.equal(isolatedWatcher.isBusy(), false, "shutdown must cancel pending stability timers");
        await wait(220);
        assert.equal(calls, 0, "a file that never became stable must not import after shutdown");
        assert.equal(memoryReceipts.receipts.size, 0, "an unfinished transfer must not gain a success receipt");
      } finally {
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("switchBlockedAndShutdownDrainsActiveImport", async () => {
      const directory = path.join(tempRoot, "fault-active-import", "原图", "相机FTP");
      const switchDirectory = path.join(tempRoot, "fault-active-import-next", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      fs.mkdirSync(switchDirectory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      const importGate = createDeferred();
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_active_import", "active-import", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            await importGate.promise;
            return returnSuccessfulImport(input, `active_import_${calls}`);
          }
        }));
        const activeFile = path.join(directory, "active-import.jpg");
        fs.writeFileSync(activeFile, Buffer.from([0xff, 0xd8, 0x20, 0xff, 0xd9]));
        await isolatedWatcher.scanExistingFiles();
        await waitFor(() => isolatedWatcher.getStatus().importingCount === 1);
        await assert.rejects(
          () => isolatedWatcher.start(createIsolatedInput("evt_active_import_next", "active-import-next", switchDirectory, {
            scanExistingOnStart: false,
            createDirectory: false,
            receiptStore: memoryReceipts.store,
            importer: async (input) => returnSuccessfulImport(input, "active_import_next")
          })),
          (error) => error?.code === "FTP_UPLOAD_IN_PROGRESS",
          "an event switch must stay blocked while an import owns the source file"
        );
        assert.equal(isolatedWatcher.getStatus().eventId, "evt_active_import");

        const shutdownResult = isolatedWatcher.shutdown();
        assert.equal(typeof shutdownResult?.then, "function", "shutdown during import must expose an awaitable drain contract");
        importGate.resolve();
        await shutdownResult;
        assert.equal(isolatedWatcher.getStatus().running, false);
        assert.equal(isolatedWatcher.isBusy(), false);
        assert.equal(memoryReceipts.get("evt_active_import", activeFile)?.result, "imported", "a safely completed in-flight import must retain its receipt");
      } finally {
        importGate.resolve();
        await wait(80);
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("shutdownTimeoutReportsUndrainedState", async () => {
      const directory = path.join(tempRoot, "fault-shutdown-timeout", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const importGate = createDeferred();
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_shutdown_timeout", "shutdown-timeout", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: createMemoryReceiptStore().store,
          importer: async (input) => {
            await importGate.promise;
            return returnSuccessfulImport(input, "shutdown_timeout");
          }
        }));
        fs.writeFileSync(path.join(directory, "slow-import.jpg"), Buffer.from([0xff, 0xd8, 0x21, 0xff, 0xd9]));
        await isolatedWatcher.scanExistingFiles();
        await waitFor(() => isolatedWatcher.getStatus().busy === true && isolatedWatcher.getStatus().importingCount === 1);
        const result = await isolatedWatcher.shutdown(5);
        assert.equal(result.drained, false, "shutdown timeout must be explicit instead of pretending the import drained");
        assert.equal(isolatedWatcher.getStatus().running, false);
      } finally {
        importGate.resolve();
        await wait(80);
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("downtimeScanSkipsHistoryAndFindsNewFile", async () => {
      const directory = path.join(tempRoot, "fault-downtime-scan", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      let calls = 0;
      const importer = async (input) => {
        calls += 1;
        return returnSuccessfulImport(input, `downtime_${calls}`);
      };
      const firstWatcher = new watcherModule.CameraFtpWatcher();
      const liveFile = path.join(directory, "before-shutdown.jpg");
      try {
        await firstWatcher.start(createIsolatedInput("evt_downtime", "downtime", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer
        }));
        fs.writeFileSync(liveFile, Buffer.from([0xff, 0xd8, 0x30, 0xff, 0xd9]));
        await firstWatcher.scanExistingFiles();
        await waitFor(() => memoryReceipts.get("evt_downtime", liveFile)?.result === "imported");
      } finally {
        await Promise.resolve(firstWatcher.shutdown());
      }

      const downtimeFile = path.join(directory, "during-downtime.jpg");
      fs.writeFileSync(downtimeFile, Buffer.from([0xff, 0xd8, 0x31, 0xff, 0xd9]));
      const restartedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await restartedWatcher.start(createIsolatedInput("evt_downtime", "downtime", directory, {
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer
        }));
        await waitFor(() => memoryReceipts.get("evt_downtime", downtimeFile)?.result === "imported");
        assert.equal(calls, 2, "restart scan must import only the downtime file and skip unchanged history");
        assert.equal(memoryReceipts.get("evt_downtime", liveFile)?.result, "imported");
      } finally {
        await Promise.resolve(restartedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("samePathSameMetadataContentChange", async () => {
      const directory = path.join(tempRoot, "fault-same-metadata", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      let calls = 0;
      const importer = async (input) => {
        calls += 1;
        return returnSuccessfulImport(input, `same_metadata_${calls}`);
      };
      const targetFile = path.join(directory, "camera-overwrite.jpg");
      fs.writeFileSync(targetFile, Buffer.from([0xff, 0xd8, 0x40, 0x41, 0xff, 0xd9]));
      const firstWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await firstWatcher.start(createIsolatedInput("evt_same_metadata", "same-metadata", directory, {
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer
        }));
        await waitFor(() => memoryReceipts.get("evt_same_metadata", targetFile)?.result === "imported");
      } finally {
        await Promise.resolve(firstWatcher.shutdown());
      }

      const historicalReceipt = memoryReceipts.get("evt_same_metadata", targetFile);
      assert.ok(historicalReceipt, "first import must persist a receipt");
      fs.writeFileSync(targetFile, Buffer.from([0xff, 0xd8, 0x41, 0x40, 0xff, 0xd9]));
      fs.utimesSync(targetFile, new Date(historicalReceipt.modifiedMs), new Date(historicalReceipt.modifiedMs));
      const overwrittenStat = fs.statSync(targetFile);
      assert.equal(overwrittenStat.size, historicalReceipt.fileSize);
      assert.equal(Math.trunc(overwrittenStat.mtimeMs), Math.trunc(historicalReceipt.modifiedMs), "fault fixture must preserve the size/mtime fingerprint");

      const restartedWatcher = new watcherModule.CameraFtpWatcher();
      try {
        await restartedWatcher.start(createIsolatedInput("evt_same_metadata", "same-metadata", directory, {
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer
        }));
        await waitFor(() => calls === 2, 1200);
        assert.equal(calls, 2, "same-path camera overwrite must be re-evaluated when content changed even if size/mtime match");
      } finally {
        await Promise.resolve(restartedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("failedDatabaseImportRemainsRetryable", async () => {
      const directory = path.join(tempRoot, "fault-import-retry", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      const targetFile = path.join(directory, "database-retry.jpg");
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_import_retry", "import-retry", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error("database write failed"), { code: "DB_WRITE_FAILED" });
            return returnSuccessfulImport(input, `import_retry_${calls}`);
          }
        }));
        fs.writeFileSync(targetFile, Buffer.from([0xff, 0xd8, 0x50, 0xff, 0xd9]));
        await isolatedWatcher.scanExistingFiles();
        await waitFor(() => isolatedWatcher.getStatus().recentRecords.some((record) => record.path === path.resolve(targetFile) && record.status === "failed"));
        assert.equal(memoryReceipts.get("evt_import_retry", targetFile), undefined, "database failure must not persist a success receipt");
        await isolatedWatcher.scanExistingFiles();
        await waitFor(() => calls === 2, 1200);
        await waitFor(() => memoryReceipts.get("evt_import_retry", targetFile)?.result === "imported");
      } finally {
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("taskRecordFailureIsContained", async () => {
      const directory = path.join(tempRoot, "fault-task-record", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      const tasks = requireDist("services/tasks.js");
      const logger = requireDist("utils/logger.js");
      const originalCreateTask = tasks.createTask;
      const originalSafeLog = logger.safeLog;
      const diagnosticLogs = [];
      const unhandledRejections = [];
      const onUnhandledRejection = (reason) => { unhandledRejections.push(reason); };
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      process.on("unhandledRejection", onUnhandledRejection);
      tasks.createTask = () => { throw Object.assign(new Error("task storage unavailable"), { code: "TASK_WRITE_FAILED" }); };
      logger.safeLog = (...args) => { diagnosticLogs.push(args); };
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_task_failure", "task-failure", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            return returnSuccessfulImport(input, `task_failure_${calls}`);
          }
        }));
        const targetFile = path.join(directory, "task-record-failure.jpg");
        fs.writeFileSync(targetFile, Buffer.from([0xff, 0xd8, 0x60, 0xff, 0xd9]));
        await isolatedWatcher.scanExistingFiles();
        await wait(260);
        assert.equal(unhandledRejections.length, 0, "task record failure must not escape as an unhandled rejection");
        const record = isolatedWatcher.getStatus().recentRecords.find((item) => item.path === path.resolve(targetFile));
        assert.equal(record?.status, "imported", "task-center failure must not roll back a safely completed image import");
        assert.equal(calls, 1);
        assert.equal(memoryReceipts.get("evt_task_failure", targetFile)?.result, "imported");
        assert.ok(diagnosticLogs.some(([level, _details, message]) => level === "warn" && /任务中心/.test(message || "")), "continuing without a task record must emit a diagnostic warning");
        assert.equal(isolatedWatcher.isBusy(), false, "task record failure must release the import queue");
      } finally {
        tasks.createTask = originalCreateTask;
        logger.safeLog = originalSafeLog;
        process.removeListener("unhandledRejection", onUnhandledRejection);
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    await runFaultInjectionCase("broadcastFailureDoesNotRollbackImport", async () => {
      const directory = path.join(tempRoot, "fault-broadcast", "原图", "相机FTP");
      fs.mkdirSync(directory, { recursive: true });
      const memoryReceipts = createMemoryReceiptStore();
      const originalEmitImageCreated = realtime.emitImageCreated;
      let calls = 0;
      const isolatedWatcher = new watcherModule.CameraFtpWatcher();
      realtime.emitImageCreated = () => { throw Object.assign(new Error("socket broadcast unavailable"), { code: "SOCKET_BROADCAST_FAILED" }); };
      const targetFile = path.join(directory, "broadcast-failure.jpg");
      try {
        await isolatedWatcher.start(createIsolatedInput("evt_broadcast", "broadcast", directory, {
          scanExistingOnStart: false,
          createDirectory: false,
          receiptStore: memoryReceipts.store,
          importer: async (input) => {
            calls += 1;
            return returnSuccessfulImport(input, `broadcast_${calls}`);
          }
        }));
        fs.writeFileSync(targetFile, Buffer.from([0xff, 0xd8, 0x70, 0xff, 0xd9]));
        await isolatedWatcher.scanExistingFiles();
        const terminalRecord = await waitFor(() => isolatedWatcher.getStatus().recentRecords.find((record) => (
          record.path === path.resolve(targetFile) && ["imported", "failed"].includes(record.status)
        )));
        assert.equal(terminalRecord.status, "imported", "Socket.IO failure must not roll back an image that the importer already stored safely");
        assert.equal(memoryReceipts.get("evt_broadcast", targetFile)?.result, "imported");
        assert.equal(calls, 1);
      } finally {
        realtime.emitImageCreated = originalEmitImageCreated;
        await Promise.resolve(isolatedWatcher.shutdown());
      }
    });

    if (faultInjectionFailures.length > 0) {
      throw new Error(`watcher fault-injection contracts failed:\n- ${faultInjectionFailures.join("\n- ")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      tests: {
        jpgOnlyCandidateFilter: "passed",
        growingFileGate: "passed",
        stableImport: "passed",
        duplicateSkip: "passed",
        samePathContentChange: "passed",
        legacyImageReceiptBootstrap: "passed",
        restartReceiptDeduplication: "passed",
        concurrentNotificationCoalescing: "passed",
        asynchronousCandidateReservation: "passed",
        realtimeImageCreated: "passed",
        singletonStart: "passed",
        watcherSwitch: "passed",
        oldDirectoryDetached: "passed",
        cleanShutdown: "passed",
        ...faultInjectionResults
      }
    }, null, 2));
  } finally {
    try { watcherModule.shutdownCameraFtpWatcher(); } catch (_) {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
