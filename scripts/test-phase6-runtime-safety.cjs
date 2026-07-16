const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function watcher(overrides = {}) {
  return {
    running: true,
    busy: false,
    directory: "D:\\sensitive\\working\\event\\原图\\相机FTP",
    eventId: "event-001",
    eventName: "校运会",
    pendingCount: 0,
    queuedCount: 0,
    importingCount: 0,
    unstableCount: 0,
    lastReceivedAt: "",
    lastScanAt: "2026-07-16T00:00:00.000Z",
    lastError: "password=NeverPersistThis",
    recentRecords: [{ filename: "IMG_PRIVATE.JPG", path: "D:\\sensitive\\IMG_PRIVATE.JPG" }],
    ...overrides
  };
}

function cameraStatus() {
  return {
    provider: "iis",
    inspectionLevel: "partial",
    inspectionOutcome: "admin_required",
    inspectionSource: "ordinary",
    inspectedAt: "2026-07-16T00:00:00.000Z",
    requiresAdminForFullInspection: true,
    requiresAdminForSystemChanges: true,
    platform: {},
    windowsFeatures: {},
    service: {},
    site: { name: "UnrelatedCustomerSite", physicalPath: "D:\\other-secret" },
    binding: {},
    authentication: {},
    authorization: {},
    account: { username: "unrelated-account", password: "NeverPersistThis" },
    acl: {},
    activeEvent: { id: "event-001", name: "校运会", date: "", status: "active", slug: "sports", valid: true },
    ftpPath: "D:\\sensitive\\working\\event\\原图\\相机FTP",
    watcher: watcher(),
    controlPort: 2121,
    passivePorts: {},
    firewall: {},
    port: {},
    networkAddresses: {},
    conflicts: {},
    warnings: ["SecureString=NeverPersistThis"],
    initialized: true,
    passwordConfigured: true,
    passwordResetRequired: false,
    requiresAdmin: true,
    repairable: true,
    missingItems: [],
    lastError: { code: "ADMIN_REQUIRED", message: "password=NeverPersistThis" },
    startupRecovery: null
  };
}

function main() {
  const operationContext = require(path.join(root, "dist-server", "utils", "operationContext.js"));
  const response = require(path.join(root, "dist-server", "utils", "response.js"));
  const diagnostics = require(path.join(root, "dist-server", "services", "cameraFtpDiagnostics.js"));
  const cameraFtpRoute = require(path.join(root, "dist-server", "routes", "cameraFtp.js"));

  let middlewareId = "";
  const headers = new Map();
  operationContext.operationContextMiddleware({
    header: () => "client-operation-001"
  }, {
    setHeader: (key, value) => headers.set(key, value)
  }, () => {
    middlewareId = operationContext.getCurrentOperationId();
  });
  assert.equal(middlewareId, "client-operation-001");
  assert.equal(headers.get("X-Operation-Id"), "client-operation-001");

  let generatedId = "";
  operationContext.operationContextMiddleware({ header: () => "bad value with spaces" }, {
    setHeader: (_key, value) => { generatedId = value; }
  }, () => {
    assert.equal(operationContext.getCurrentOperationId(), generatedId);
  });
  assert.match(generatedId, /^[0-9a-f-]{36}$/i);

  operationContext.runWithOperationId("phase6-operation-001", () => {
    assert.equal(operationContext.getOrCreateOperationId(), "phase6-operation-001");
    const payload = response.buildApiErrorPayload("EXPECTED_FAILURE", "测试错误");
    assert.equal(payload.operationId, "phase6-operation-001");
    const validation = cameraFtpRoute.buildCameraFtpValidationErrorMetadata("输入无效", "请修正后重试");
    assert.equal(validation.operationId, "phase6-operation-001");
    assert.equal(validation.rollbackStatus, "not_required");
    assert.equal(validation.retryable, true);
    assert.ok(validation.title && validation.impact && validation.nextAction);
  });

  assert.equal(cameraFtpRoute.shouldRecordCameraFtpOperation("GET", "/status", null), false);
  assert.equal(cameraFtpRoute.shouldRecordCameraFtpOperation("GET", "/diagnostics", null), false);
  assert.equal(cameraFtpRoute.shouldRecordCameraFtpOperation("GET", "/status", "IIS_STATUS_CHECK_FAILED"), true);
  assert.equal(cameraFtpRoute.shouldRecordCameraFtpOperation("POST", "/repair", null), true);

  const sanitizedErrorDetails = cameraFtpRoute.sanitizeDiagnosticValue({
    ftpPassword: "NeverPersistThis",
    accessToken: "NeverPersistThis",
    account_password: "NeverPersistThis",
    actualSite: { physicalPath: "D:\\sensitive\\working", siteName: "ManagedSite" },
    technicalMessage: "cameraSecret=NeverPersistThis; directory=D:\\sensitive\\working"
  });
  const sanitizedErrorText = JSON.stringify(sanitizedErrorDetails);
  assert.equal(sanitizedErrorText.includes("NeverPersistThis"), false);
  assert.equal(sanitizedErrorText.includes("D:\\\\sensitive"), false);
  assert.match(sanitizedErrorText, /redacted/);

  const config = {
    provider: "iis",
    siteName: "MediaPhotoWorkbenchFTP",
    managedSiteId: 7,
    username: "camera",
    accountManaged: true,
    activeEventId: "event-001",
    controlPort: 2121,
    passivePortStart: 50000,
    passivePortEnd: 50100,
    password: "NeverPersistThis",
    SecureString: "NeverPersistThis",
    tempInputPath: "C:\\Temp\\secret.input.json"
  };
  const snapshot = diagnostics.buildCameraFtpDiagnosticSnapshot({
    config,
    status: cameraStatus(),
    requestOperationId: "diagnostic-request-001",
    lastOperation: {
      operationId: "camera-operation-001",
      errorCode: "ROLLBACK_PARTIAL",
      completedAt: "2026-07-16T00:00:00.000Z"
    },
    now: new Date("2026-07-16T00:00:00.000Z"),
    platform: { os: "win32", arch: "x64", release: "test", version: "Windows 11" }
  });
  assert.equal(snapshot.operationId, "camera-operation-001");
  assert.equal(snapshot.diagnosticRequestOperationId, "diagnostic-request-001");
  assert.equal(snapshot.ftp.siteName, "MediaPhotoWorkbenchFTP");
  assert.equal(snapshot.ftp.managedSiteId, 7);
  assert.equal(snapshot.ftp.controlPort, 2121);
  assert.equal(snapshot.ftp.activeEvent.name, "校运会");
  assert.equal(snapshot.ftp.watcher.running, true);
  assert.equal(snapshot.ftp.lastErrorCode, "ADMIN_REQUIRED");

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "NeverPersistThis",
    "SecureString",
    "tempInputPath",
    "sensitive\\\\working",
    "IMG_PRIVATE.JPG",
    "UnrelatedCustomerSite",
    "unrelated-account",
    "ftpPath",
    "directory",
    "recentRecords"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }

  const appSource = fs.readFileSync(path.join(root, "src-server", "app.ts"), "utf8");
  const routeSource = fs.readFileSync(path.join(root, "src-server", "routes", "cameraFtp.ts"), "utf8");
  const orchestratorSource = fs.readFileSync(path.join(root, "src-server", "services", "cameraFtpOrchestrator.ts"), "utf8");
  const loggerSource = fs.readFileSync(path.join(root, "src-server", "utils", "logger.ts"), "utf8");
  const elevatedSource = fs.readFileSync(path.join(root, "src-server", "utils", "elevatedPowerShell.ts"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
  const settingsSource = fs.readFileSync(path.join(root, "src", "pages", "host", "Settings.tsx"), "utf8");
  assert.match(appSource, /operationContextMiddleware/);
  assert.match(routeSource, /router\.get\("\/diagnostics"/);
  assert.match(routeSource, /childOperationId/);
  assert.doesNotMatch(routeSource, /getLogger\(\)\.error\(\{\s*error[,}]/);
  assert.match(orchestratorSource, /getOrCreateOperationId/);
  assert.match(loggerSource, /getCurrentOperationId/);
  assert.match(loggerSource, /parentOperationId/);
  assert.match(elevatedSource, /parentOperationId/);
  assert.match(apiSource, /X-Operation-Id/);
  assert.match(apiSource, /normalized\.error = \{ \.\.\.normalized\.error, operationId \}/);
  assert.match(settingsSource, /redactDiagnosticCopyText/);
  assert.match(settingsSource, /未收集 FTP 密码、账户详情、图片路径/);

  console.log(JSON.stringify({
    suite: "phase6RuntimeSafety",
    passed: [
      "api_operation_id_accepts_safe_correlation_id",
      "invalid_incoming_operation_id_is_replaced",
      "response_error_inherits_operation_context",
      "validation_errors_use_complete_structured_metadata",
      "status_polling_does_not_replace_last_meaningful_operation",
      "server_error_details_redact_compound_secrets_and_paths",
      "diagnostic_snapshot_is_allow_listed",
      "diagnostic_snapshot_excludes_secrets_paths_and_other_sites",
      "operation_id_reaches_orchestrator_and_frontend"
    ]
  }, null, 2));
}

main();
