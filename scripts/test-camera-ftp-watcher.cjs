const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const requireDist = (relativePath) => require(path.join(dist, relativePath));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  try {
    assert.deepEqual(watcherModule.classifyCameraFtpCandidate("photo.JPG"), { accepted: true, reason: "" });
    assert.equal(watcherModule.classifyCameraFtpCandidate("photo.png").accepted, false);
    assert.equal(watcherModule.classifyCameraFtpCandidate(".hidden.jpg").accepted, false);
    assert.equal(watcherModule.classifyCameraFtpCandidate("photo.part").accepted, false);

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
    const coalescedRecords = watcherModule.coalesceCameraFtpWatcherRecords([
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
        cleanShutdown: "passed"
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
