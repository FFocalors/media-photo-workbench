const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const serverDist = process.env.MPW_LOG_ROTATION_TEST_DIST || path.join(root, "dist-server");
const loggerModule = require(path.join(serverDist, "utils", "logger.js"));

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-log-rotation-"));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function write(directory, fileName, contents) {
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function main() {
  withTempDirectory((directory) => {
    const activePath = write(directory, "server.log", "small");
    const result = loggerModule.rotateServerLogsBeforeOpen(directory, { maxBytes: 100, retention: 3 });
    assert.equal(result.rotated, false);
    assert.equal(result.skippedReason, "below_threshold");
    assert.equal(fs.readFileSync(activePath, "utf8"), "small");
  });

  withTempDirectory((directory) => {
    const secret = "password=Never-Return-Log-Contents!";
    write(directory, "server.log", secret);
    const result = loggerModule.rotateServerLogsBeforeOpen(directory, {
      maxBytes: Buffer.byteLength(secret),
      retention: 3,
      now: () => new Date("2026-07-16T06:33:00.123Z")
    });
    const expectedHistoricalPath = path.join(directory, "server.20260716T063300.123Z.log");
    assert.equal(result.rotated, true, "a log at the exact threshold must rotate before it is opened");
    assert.equal(result.rotatedLogPath, expectedHistoricalPath);
    assert.equal(fs.existsSync(path.join(directory, "server.log")), false);
    assert.equal(fs.readFileSync(expectedHistoricalPath, "utf8"), secret, "rotation must preserve existing bytes");
    assert.equal(JSON.stringify(result).includes(secret), false, "rotation results must never expose log contents");
  });

  withTempDirectory((directory) => {
    write(directory, "server.20260716T063300.123Z.log", "existing-history");
    write(directory, "server.log", "rotate-me");
    const result = loggerModule.rotateServerLogsBeforeOpen(directory, {
      maxBytes: 1,
      retention: 5,
      now: () => new Date("2026-07-16T06:33:00.123Z")
    });
    assert.equal(path.basename(result.rotatedLogPath), "server.20260716T063300.123Z-1.log");
    assert.equal(fs.readFileSync(path.join(directory, "server.20260716T063300.123Z.log"), "utf8"), "existing-history");
    assert.equal(fs.readFileSync(result.rotatedLogPath, "utf8"), "rotate-me");
  });

  withTempDirectory((directory) => {
    write(directory, "server.log", "small");
    const managedOldest = write(directory, "server.20260713T000000.000Z.log", "oldest");
    const managedOld = write(directory, "server.20260714T000000.000Z.log", "old");
    const managedNew = write(directory, "server.20260715T000000.000Z.log", "new");
    const managedNewest = write(directory, "server.20260716T000000.000Z.log", "newest");
    const unmanaged = write(directory, "server.log.old", "unmanaged");
    const anotherLog = write(directory, "audit.log", "unmanaged");
    const matchingDirectory = path.join(directory, "server.20200101T000000.000Z.log");
    fs.mkdirSync(matchingDirectory);

    const result = loggerModule.rotateServerLogsBeforeOpen(directory, { maxBytes: 100, retention: 2 });
    assert.deepEqual(
      result.prunedLogPaths.map((item) => path.basename(item)).sort(),
      [path.basename(managedOldest), path.basename(managedOld)].sort()
    );
    assert.equal(fs.existsSync(managedOldest), false);
    assert.equal(fs.existsSync(managedOld), false);
    assert.equal(fs.existsSync(managedNew), true);
    assert.equal(fs.existsSync(managedNewest), true);
    assert.equal(fs.readFileSync(unmanaged, "utf8"), "unmanaged", "unmanaged historical names must not be pruned");
    assert.equal(fs.readFileSync(anotherLog, "utf8"), "unmanaged");
    assert.equal(fs.statSync(matchingDirectory).isDirectory(), true, "matching directories must never be removed");
  });

  withTempDirectory((directory) => {
    const activeDirectory = path.join(directory, "server.log");
    fs.mkdirSync(activeDirectory);
    const result = loggerModule.rotateServerLogsBeforeOpen(directory, { maxBytes: 1, retention: 1 });
    assert.equal(result.rotated, false);
    assert.equal(result.skippedReason, "not_regular_file");
    assert.equal(fs.statSync(activeDirectory).isDirectory(), true);
  });

  withTempDirectory((directory) => {
    write(directory, "server.log", "already-open-active-log");
    const probe = spawnSync(process.execPath, ["-e", `
      const loggerModule = require(${JSON.stringify(path.join(serverDist, "utils", "logger.js"))});
      loggerModule.initLogger(${JSON.stringify(directory)});
      const result = loggerModule.rotateServerLogsBeforeOpen(${JSON.stringify(directory)}, { maxBytes: 1, retention: 0 });
      if (result.rotated || result.skippedReason !== "active_log_open") process.exit(2);
      process.stdout.write("active-log-guard-passed");
      process.exit(0);
    `], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: process.env
    });
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);
    assert.match(probe.stdout, /active-log-guard-passed/);
    assert.equal(
      fs.readdirSync(directory).some((fileName) => /^server\.\d{8}T/.test(fileName)),
      false,
      "an active log held by the initialized logger must not be renamed"
    );
  });

  const loggerSource = fs.readFileSync(path.join(root, "src-server", "utils", "logger.ts"), "utf8");
  const initStart = loggerSource.indexOf("export function initLogger");
  const rotateCall = loggerSource.indexOf("rotateServerLogsBeforeOpen(logsDir)", initStart);
  const pinoOpen = loggerSource.indexOf("_logger = pino(", initStart);
  assert.ok(rotateCall > initStart && pinoOpen > rotateCall, "startup rotation must complete before pino opens server.log");
  assert.match(loggerSource, /activeLogFilePath[\s\S]*skippedReason = "active_log_open"/);

  console.log(JSON.stringify({
    suite: "serverLogRotation",
    passed: [
      "below_threshold_keeps_active_log",
      "threshold_rotates_before_open_without_exposing_contents",
      "timestamp_collision_uses_unique_managed_name",
      "retention_prunes_only_managed_historical_files",
      "non_regular_active_path_is_never_rotated",
      "initialized_active_log_is_never_rotated",
      "startup_rotation_order_contract"
    ]
  }, null, 2));
}

main();
