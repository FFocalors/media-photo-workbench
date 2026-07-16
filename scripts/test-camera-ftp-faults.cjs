const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Local development rebuilds better-sqlite3 for Electron. Keep the test
// runnable through the ordinary `node scripts/...` command by transparently
// relaunching under Electron's matching Node ABI when needed.
if (!process.versions.electron && process.env.MPW_CAMERA_FAULTS_ELECTRON_CHILD !== "1") {
  const electronExecutable = require("electron");
  const childTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-camera-faults-"));
  const child = spawnSync(electronExecutable, [__filename], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MPW_CAMERA_FAULTS_ELECTRON_CHILD: "1",
      MPW_CAMERA_FAULTS_TEMP_ROOT: childTempRoot
    },
    stdio: "inherit"
  });
  try {
    fs.rmSync(childTempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    console.warn(`temporary fault-test workspace cleanup was deferred: ${error.message}`);
  }
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  return;
}

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const requireDist = (relativePath) => require(path.join(dist, relativePath));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

async function main() {
  const parentOwnedTempRoot = process.env.MPW_CAMERA_FAULTS_TEMP_ROOT || "";
  const tempRoot = parentOwnedTempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "mpw-camera-faults-"));
  const repositoryPath = path.join(tempRoot, "repository");
  const configPath = path.join(tempRoot, "config");
  const databasePath = path.join(tempRoot, "data", "faults.db");
  const eventId = "evt_fault_injection";
  const eventSlug = "fault-injection";
  const cameraDirectory = path.join(repositoryPath, "working", eventSlug, "原图", "相机FTP");
  const taskEventId = "evt_task_fault_injection";
  const taskEventSlug = "task-fault-injection";
  const taskCameraDirectory = path.join(repositoryPath, "working", taskEventSlug, "原图", "相机FTP");
  const diagnostics = [];
  let db = null;
  let watcher = null;

  try {
    fs.mkdirSync(repositoryPath, { recursive: true });

    const configModule = requireDist("config/config.js");
    configModule.loadConfig(configPath);
    configModule.saveConfig({ repository: { path: repositoryPath } });

    const databaseModule = requireDist("db/database.js");
    db = databaseModule.initDatabase(databasePath);
    db.prepare(`
      INSERT INTO events (
        id, name, slug, date, location, status,
        total_images, selected_images, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', 'active', 0, 0, datetime('now'), datetime('now'))
    `).run(eventId, "Fault Injection Event", eventSlug, "2026-07-15");
    db.prepare(`
      INSERT INTO events (
        id, name, slug, date, location, status,
        total_images, selected_images, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', 'active', 0, 0, datetime('now'), datetime('now'))
    `).run(taskEventId, "Task Fault Injection Event", taskEventSlug, "2026-07-15");

    const loggerModule = requireDist("utils/logger.js");
    const originalSafeLog = loggerModule.safeLog;
    loggerModule.safeLog = (level, detail, message) => {
      diagnostics.push({ level, detail, message: message || "" });
      originalSafeLog(level, detail, message);
    };

    const sharpPath = require.resolve("sharp");
    const realSharp = require(sharpPath);
    let failThumbnailGeneration = false;
    const faultInjectingSharp = (...args) => {
      const pipeline = realSharp(...args);
      if (!failThumbnailGeneration) return pipeline;
      const originalToFile = pipeline.toFile.bind(pipeline);
      pipeline.toFile = async (targetPath, ...rest) => {
        if (String(targetPath).includes(`${path.sep}缩略图${path.sep}`)) {
          throw Object.assign(new Error("INJECTED_THUMBNAIL_FAILURE"), {
            code: "INJECTED_THUMBNAIL_FAILURE"
          });
        }
        return originalToFile(targetPath, ...rest);
      };
      return pipeline;
    };
    Object.assign(faultInjectingSharp, realSharp);
    require.cache[sharpPath].exports = faultInjectingSharp;

    const imageImportModule = requireDist("services/imageImport.js");
    const eventWorkspaceModule = requireDist("services/eventWorkspace.js");
    eventWorkspaceModule.ensureEventWorkingDirs(eventSlug);
    eventWorkspaceModule.ensureEventWorkingDirs(taskEventSlug);

    const makeJpeg = async (filename, rgb, directory = cameraDirectory) => {
      const filePath = path.join(directory, filename);
      await realSharp({
        create: {
          width: 16,
          height: 12,
          channels: 3,
          background: rgb
        }
      }).jpeg({ quality: 90 }).toFile(filePath);
      return {
        filename,
        path: filePath,
        size: fs.statSync(filePath).size
      };
    };

    const importOne = (file, options = {}) => imageImportModule.importImageFiles({
      eventId,
      files: [file],
      folderPath: cameraDirectory,
      sourceType: "camera_ftp",
      device: "Fault Test Camera",
      options: {
        concurrency: 1,
        maxErrors: 10,
        ...options
      }
    });

    const countImageFor = (targetEventId, filename) => db.prepare(
      "SELECT COUNT(*) AS count FROM images WHERE event_id = ? AND original_filename = ?"
    ).get(targetEventId, filename).count;
    const countImage = (filename) => countImageFor(eventId, filename);

    // A failed images INSERT must never be counted as an imported image. The
    // IIS-landed original remains in place so a later safe retry is possible.
    const databaseFailureFile = await makeJpeg("db-failure.jpg", { r: 190, g: 40, b: 40 });
    db.exec(`
      CREATE TRIGGER inject_camera_image_insert_failure
      BEFORE INSERT ON images
      WHEN NEW.original_filename = 'db-failure.jpg'
      BEGIN
        SELECT RAISE(ABORT, 'INJECTED_DATABASE_WRITE_FAILURE');
      END;
    `);
    const databaseFailure = await importOne(databaseFailureFile);
    assert.equal(databaseFailure.success, 0, "a failed images INSERT must not report success");
    assert.equal(databaseFailure.failed, 1);
    assert.equal(databaseFailure.imported.length, 0);
    assert.equal(countImage(databaseFailureFile.filename), 0, "a failed images INSERT must leave no image row");
    assert.equal(fs.existsSync(databaseFailureFile.path), true, "database failure must preserve the IIS-landed original");
    assert.equal(databaseFailure.errors[0]?.code, "IMAGE_DATABASE_WRITE_FAILED");
    assert.equal(databaseFailure.errors[0]?.stage, "database");
    assert.equal(databaseFailure.errors[0]?.retryable, true);

    db.exec("DROP TRIGGER inject_camera_image_insert_failure");
    const safeRetry = await importOne(databaseFailureFile);
    assert.equal(safeRetry.success, 1, "the preserved original must remain safely retryable");
    assert.equal(countImage(databaseFailureFile.filename), 1);
    const retriedRow = db.prepare(
      "SELECT original_path FROM images WHERE event_id = ? AND original_filename = ?"
    ).get(eventId, databaseFailureFile.filename);
    assert.equal(path.resolve(retriedRow.original_path), path.resolve(databaseFailureFile.path));

    // Thumbnail generation is critical before the image row is committed.
    // Failure is per-file, keeps the original, and does not create a false row.
    const thumbnailFailureFile = await makeJpeg("thumbnail-failure.jpg", { r: 40, g: 160, b: 80 });
    failThumbnailGeneration = true;
    const thumbnailFailure = await importOne(thumbnailFailureFile);
    failThumbnailGeneration = false;
    assert.equal(thumbnailFailure.success, 0);
    assert.equal(thumbnailFailure.failed, 1);
    assert.equal(countImage(thumbnailFailureFile.filename), 0);
    assert.equal(fs.existsSync(thumbnailFailureFile.path), true, "thumbnail failure must preserve the original");
    assert.equal(thumbnailFailure.errors[0]?.code, "IMAGE_THUMBNAIL_FAILED");
    assert.equal(thumbnailFailure.errors[0]?.stage, "thumbnail");
    assert.equal(thumbnailFailure.errors[0]?.retryable, true);

    const corruptImagePath = path.join(cameraDirectory, "corrupt-image.jpg");
    fs.writeFileSync(corruptImagePath, Buffer.from("this-is-not-a-jpeg", "utf8"));
    const corruptImageFile = {
      filename: path.basename(corruptImagePath),
      path: corruptImagePath,
      size: fs.statSync(corruptImagePath).size
    };
    const corruptImage = await importOne(corruptImageFile);
    assert.equal(corruptImage.success, 0);
    assert.equal(corruptImage.failed, 1);
    assert.equal(corruptImage.errors[0]?.code, "IMAGE_THUMBNAIL_FAILED");
    assert.equal(corruptImage.errors[0]?.stage, "thumbnail");
    assert.equal(countImage(corruptImageFile.filename), 0);
    assert.equal(fs.existsSync(corruptImageFile.path), true, "a corrupt JPG must remain available for diagnosis or retry");

    // EXIF is optional metadata. A parser failure must be diagnosable but must
    // not prevent a valid image, its preview, and its thumbnail from landing.
    const exifrPath = require.resolve("exifr");
    const exifrModule = require(exifrPath);
    const originalExifParse = exifrModule.parse;
    exifrModule.parse = async () => {
      throw Object.assign(new Error("INJECTED_EXIF_FAILURE"), { code: "INJECTED_EXIF_FAILURE" });
    };
    const exifFailureFile = await makeJpeg("exif-failure.jpg", { r: 40, g: 80, b: 190 });
    const exifFailure = await importOne(exifFailureFile);
    exifrModule.parse = originalExifParse;
    assert.equal(exifFailure.success, 1, "EXIF failure is non-critical for the core image import");
    assert.equal(exifFailure.failed, 0);
    assert.equal(countImage(exifFailureFile.filename), 1);
    const exifRow = db.prepare(
      "SELECT exif_shot_at, camera_model, lens_model FROM images WHERE event_id = ? AND original_filename = ?"
    ).get(eventId, exifFailureFile.filename);
    assert.deepEqual(exifRow, { exif_shot_at: "", camera_model: "", lens_model: "" });
    assert.ok(
      diagnostics.some((entry) => JSON.stringify(entry.detail || {}).includes("INJECTED_EXIF_FAILURE")),
      "EXIF failure must leave a diagnostic breadcrumb"
    );

    // Task finalization occurs after the importer has committed the image. An
    // in-memory task-center failure may degrade diagnostics, but must not undo
    // or delete that core image row.
    const taskFailureFile = await makeJpeg(
      "task-record-failure.jpg",
      { r: 150, g: 100, b: 30 },
      taskCameraDirectory
    );
    const tasksModule = requireDist("services/tasks.js");
    const originalFinishTask = tasksModule.finishTask;
    tasksModule.finishTask = () => {
      throw Object.assign(new Error("INJECTED_TASK_RECORD_FAILURE"), {
        code: "INJECTED_TASK_RECORD_FAILURE"
      });
    };
    const watcherModule = requireDist("services/cameraFtpWatcher.js");
    watcher = new watcherModule.CameraFtpWatcher();
    const receipts = new Map();
    await watcher.start({
      eventId: taskEventId,
      eventName: "Task Fault Injection Event",
      eventSlug: taskEventSlug,
      directory: taskCameraDirectory,
      cameraName: "Fault Test Camera",
      photographer: "",
      baseUrl: "http://127.0.0.1:3030",
      scanExistingOnStart: false,
      testing: {
        stabilityIntervalMs: 10,
        stabilityChecks: 1,
        importBatchDelayMs: 0,
        maxWaitMs: 500,
        importer: imageImportModule.importImageFiles,
        receiptStore: {
          list: () => Array.from(receipts.values()),
          save: (receipt) => receipts.set(`${receipt.eventId}\0${receipt.filePath}`, { ...receipt })
        }
      }
    });
    await watcher.scanExistingFiles();
    await waitFor(() => countImageFor(taskEventId, taskFailureFile.filename) === 1 && !watcher.isBusy());
    assert.equal(
      countImageFor(taskEventId, taskFailureFile.filename),
      1,
      "task-center failure must not roll back the committed image row"
    );
    assert.equal(fs.existsSync(taskFailureFile.path), true);
    assert.ok(
      diagnostics.some((entry) => JSON.stringify(entry.detail || {}).includes("INJECTED_TASK_RECORD_FAILURE")),
      "task-center failure must remain diagnosable"
    );
    await watcher.shutdown();
    watcher = null;
    tasksModule.finishTask = originalFinishTask;

    // Socket.IO delivery is a post-commit observer. Its failure must preserve
    // the successful image result and database row, while emitting a warning.
    const socketFailureFile = await makeJpeg("socket-failure.jpg", { r: 120, g: 50, b: 160 });
    const socketFailure = await importOne(socketFailureFile, {
      onImageImported: async () => {
        throw Object.assign(new Error("INJECTED_SOCKET_BROADCAST_FAILURE"), {
          code: "INJECTED_SOCKET_BROADCAST_FAILURE"
        });
      }
    });
    assert.equal(socketFailure.success, 1, "Socket.IO failure must not change a committed import to failed");
    assert.equal(socketFailure.failed, 0);
    assert.equal(countImage(socketFailureFile.filename), 1, "Socket.IO failure must preserve the image row");
    assert.equal(fs.existsSync(socketFailureFile.path), true);
    assert.ok(
      diagnostics.some((entry) => (
        entry.level === "warn"
          && JSON.stringify(entry.detail || {}).includes("INJECTED_SOCKET_BROADCAST_FAILURE")
      )),
      "Socket.IO failure must produce a diagnosable warning"
    );

    console.log(JSON.stringify({
      ok: true,
      tests: {
        databaseWriteFailureNoFalseSuccess: "passed",
        databaseFailureOriginalPreservedAndRetryable: "passed",
        thumbnailFailureNoFalseRow: "passed",
        exifFailureIsNonCriticalAndDiagnosable: "passed",
        taskRecordFailureDoesNotRollbackCoreImage: "passed",
        socketBroadcastFailureDoesNotRollbackCoreImage: "passed",
        socketBroadcastFailureIsDiagnosable: "passed"
      },
      safety: {
        realIisMutation: false,
        realAccountAclFirewallServiceMutation: false,
        workspace: tempRoot
      }
    }, null, 2));
  } finally {
    try { await watcher?.shutdown(); } catch (_) {}
    try { requireDist("db/database.js").closeDatabase(); } catch (_) {}
    if (!parentOwnedTempRoot) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (error) {
        console.warn(`temporary fault-test workspace cleanup was deferred: ${error.message}`);
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  }
);
