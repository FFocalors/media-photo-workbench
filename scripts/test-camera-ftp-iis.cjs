const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");

function requireDist(relativePath) {
  return require(path.join(dist, relativePath));
}

function cloneFixture(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function mergeFixture(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? cloneFixture(base) : cloneFixture(override);
  }
  const output = cloneFixture(base);
  for (const [key, value] of Object.entries(override)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && output[key]
      && typeof output[key] === "object"
      && !Array.isArray(output[key])
    ) {
      output[key] = mergeFixture(output[key], value);
    } else {
      output[key] = cloneFixture(value);
    }
  }
  return output;
}

function warningCodes(result) {
  return (result.warnings || []).map((warning) => typeof warning === "string" ? warning : warning.code);
}

function containsSecretField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretField);
  return Object.entries(value).some(([key, item]) =>
    /^(?:password|newPassword|confirmPassword|oldPassword|currentPassword|secret|token)$/i.test(key) || containsSecretField(item)
  );
}

function writePowerShellScript(directory, name, contents) {
  const scriptPath = path.join(directory, name);
  fs.writeFileSync(scriptPath, contents.replace(/^\n/, ""), "utf8");
  return scriptPath;
}

async function withWindowsScriptsDirectory(directory, callback) {
  const previous = process.env.MPW_WINDOWS_SCRIPTS_DIR;
  process.env.MPW_WINDOWS_SCRIPTS_DIR = directory;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.MPW_WINDOWS_SCRIPTS_DIR;
    else process.env.MPW_WINDOWS_SCRIPTS_DIR = previous;
  }
}

async function withTemporaryDirectoryEnvironment(directory, callback) {
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;
  process.env.TEMP = directory;
  process.env.TMP = directory;
  try {
    return await callback();
  } finally {
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    if (previousTmp === undefined) delete process.env.TMP;
    else process.env.TMP = previousTmp;
  }
}

function assertNoElevatedOperationDirectories(tempDirectory, message) {
  const elevatedRoot = path.join(tempDirectory, "MediaPhotoWorkbench", "elevated");
  const directories = fs.existsSync(elevatedRoot)
    ? fs.readdirSync(elevatedRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  assert.deepEqual(directories, [], message);
}

function getWindowsPowerShellExecutable() {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-iis-logic-"));
  try {
    const configDir = path.join(tempRoot, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
      server: { port: 3037 },
      repository: { path: "D:\\example-repository" },
      database: { path: "", autoBackupEnabled: true, lastAutoBackupAt: "", autoBackupRetention: 10 },
      gallery: { batchSelectionBehavior: "keep" },
      cameraFtp: {
        enabled: true,
        eventId: "evt_legacy",
        directory: "D:\\retired-config\\incoming",
        cameraName: "Legacy Camera",
        photographer: "Legacy User",
        port: 2021,
        username: "legacy-camera",
        password: "must-not-survive",
        pasvMin: 2130,
        pasvMax: 2140
      }
    }, null, 2));

    const configModule = requireDist("config/config.js");
    const responseModule = requireDist("utils/response.js");
    const legacyErrorDetails = {
      title: "Legacy title",
      impact: "Legacy impact",
      advice: "Legacy next action",
      operationId: "legacy-operation-1",
      retryable: false,
      technicalMessage: "Legacy technical details",
      rollbackAttempted: true,
      rollbackSucceeded: true,
      rollback: { status: "success" }
    };
    const promotedLegacyError = responseModule.buildApiErrorPayload(
      "LEGACY_ERROR",
      "Legacy message",
      legacyErrorDetails
    );
    assert.equal(promotedLegacyError.code, "LEGACY_ERROR");
    assert.equal(promotedLegacyError.message, "Legacy message");
    assert.strictEqual(promotedLegacyError.details, legacyErrorDetails, "legacy details must remain available to old clients");
    assert.equal(promotedLegacyError.title, "Legacy title");
    assert.equal(promotedLegacyError.impact, "Legacy impact");
    assert.equal(promotedLegacyError.nextAction, "Legacy next action");
    assert.equal(promotedLegacyError.rollbackStatus, "success");
    assert.equal(promotedLegacyError.operationId, "legacy-operation-1");
    assert.equal(promotedLegacyError.retryable, false);
    assert.equal(promotedLegacyError.technicalDetails, "Legacy technical details");

    let responseStatus = 0;
    let responseBody = null;
    const fakeResponse = {
      status(statusCode) {
        responseStatus = statusCode;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      }
    };
    responseModule.sendError(fakeResponse, "STRUCTURED_ERROR", "Structured message", 409, {
      operationId: "legacy-operation-2",
      rollback: { status: "failed" }
    }, {
      title: "Structured title",
      impact: "Structured impact",
      nextAction: "Structured next action",
      operationId: "top-operation-2",
      retryable: true,
      technicalDetails: "Structured technical details"
    });
    assert.equal(responseStatus, 409);
    assert.deepEqual(responseBody.error, {
      code: "STRUCTURED_ERROR",
      message: "Structured message",
      details: {
        operationId: "legacy-operation-2",
        rollback: { status: "failed" }
      },
      title: "Structured title",
      impact: "Structured impact",
      nextAction: "Structured next action",
      rollbackStatus: "failed",
      operationId: "top-operation-2",
      retryable: true,
      technicalDetails: "Structured technical details"
    });
    const migrated = configModule.loadConfig(configDir);
    const persisted = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));

    assert.equal(migrated.cameraFtp.provider, "iis");
    assert.equal(migrated.cameraFtp.managedSiteId, 0, "legacy configuration must not claim ownership of a same-named IIS site");
    assert.equal(migrated.cameraFtp.activeEventId, "evt_legacy");
    assert.equal(migrated.cameraFtp.controlPort, 21);
    assert.equal(migrated.cameraFtp.passivePortStart, 50000);
    assert.equal(migrated.cameraFtp.passivePortEnd, 50100);
    assert.equal(migrated.cameraFtp.passwordResetRequired, true);
    assert.equal(migrated.server.port, 3030, "legacy fallback ports must not pollute the preferred server port");
    assert.equal(containsSecretField(persisted), false, "migrated config must not contain a password field");
    assert.equal(persisted.cameraFtp.managedSiteId, 0);
    for (const legacyKey of ["enabled", "eventId", "directory", "cameraName", "photographer", "port", "pasvMin", "pasvMax"]) {
      assert.equal(Object.hasOwn(persisted.cameraFtp, legacyKey), false, `legacy field ${legacyKey} must be removed`);
    }

    const customPortConfig = configModule.normalizeCameraFtpConfig({
      controlPort: 2021,
      passivePortStart: 51000,
      passivePortEnd: 51100
    });
    assert.equal(customPortConfig.controlPort, 2021, "a valid configured control port must not migrate back to 21");
    assert.equal(customPortConfig.passivePortStart, 51000);
    assert.equal(customPortConfig.passivePortEnd, 51100);

    const overlappingCustomPortConfig = configModule.normalizeCameraFtpConfig({
      controlPort: 50050,
      passivePortStart: 50000,
      passivePortEnd: 50100
    });
    assert.equal(overlappingCustomPortConfig.controlPort, 50050, "an overlapping legacy range must not force a valid custom control port back to 21");
    assert.equal(overlappingCustomPortConfig.passivePortStart, 50101);
    assert.equal(overlappingCustomPortConfig.passivePortEnd, 50201);

    const networkModule = requireDist("utils/windowsNetworkAddresses.js");
    assert.equal(
      networkModule.classifyWindowsNetworkAddress("Microsoft Wi-Fi Direct Virtual Adapter", "192.168.137.1"),
      "hotspot",
      "the Windows hotspot address must survive virtual-adapter filtering"
    );
    assert.equal(
      networkModule.classifyWindowsNetworkAddress("Microsoft Wi-Fi Direct Virtual Adapter", "192.168.50.1"),
      "hotspot",
      "a detected Wi-Fi Direct hotspot must not depend on one hard-coded address"
    );
    assert.equal(networkModule.classifyWindowsNetworkAddress("VMware Network Adapter", "192.168.80.1"), null);
    assert.equal(networkModule.classifyWindowsNetworkAddress("Wi-Fi", "10.20.30.40"), "wlan");
    assert.equal(networkModule.classifyWindowsNetworkAddress("Ethernet", "10.20.30.41"), "ethernet");
    assert.equal(networkModule.classifyWindowsNetworkAddress("Wi-Fi", "169.254.10.4"), null);

    const fakeInterfaces = {
      "Wi-Fi": [{ address: "10.20.30.40", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:01", internal: false, cidr: "10.20.30.40/24" }],
      "Microsoft Wi-Fi Direct Virtual Adapter": [{ address: "192.168.137.1", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:02", internal: false, cidr: "192.168.137.1/24" }],
      "VMware Network Adapter": [{ address: "192.168.99.1", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:03", internal: false, cidr: "192.168.99.1/24" }]
    };
    const addresses = networkModule.getWindowsNetworkAddresses(fakeInterfaces);
    assert.equal(addresses.hotspot.address, "192.168.137.1");
    assert.equal(addresses.wlan.length, 1);
    assert.equal(addresses.recommendedAddress, "192.168.137.1");
    assert.equal(addresses.lan.some((item) => item.interfaceName.includes("VMware")), false);

    const workspaceModule = requireDist("services/eventWorkspace.js");
    const workspace = workspaceModule.getEventWorkspacePaths("D:\\MediaPhotoWorkspace", "event_slug");
    assert.equal(workspace.cameraFtpOriginalDir, path.win32.join("D:\\MediaPhotoWorkspace", "working", "event_slug", "原图", "相机FTP"));
    assert.equal(workspace.cameraFtpReceiveDir, workspace.cameraFtpOriginalDir, "IIS landing and camera original directories must be identical");
    assert.equal(workspaceModule.EVENT_SUBDIRS.includes("ftp"), false, "new activities must not create the obsolete ftp staging directory");

    const imageImportModule = requireDist("services/imageImport.js");
    const uploadedOriginal = path.join(workspace.cameraFtpOriginalDir, "CAM-A_DSC_0001.JPG");
    const inPlacePlacement = imageImportModule.resolveImportOriginalPlacement({
      sourceType: "camera_ftp",
      file: { filename: "CAM-A_DSC_0001.JPG", path: uploadedOriginal },
      originalDir: workspace.cameraFtpOriginalDir,
      eventSlug: "event_slug",
      imageId: "img_test"
    });
    assert.equal(inPlacePlacement.copyRequired, false);
    assert.equal(inPlacePlacement.originalTarget, path.resolve(uploadedOriginal));
    assert.equal(inPlacePlacement.storedFilename, "CAM-A_DSC_0001.JPG");
    assert.throws(
      () => imageImportModule.resolveImportOriginalPlacement({
        sourceType: "camera_ftp",
        file: { filename: "outside.jpg", path: path.join(tempRoot, "outside.jpg") },
        originalDir: workspace.cameraFtpOriginalDir,
        eventSlug: "event_slug",
        imageId: "img_outside"
      }),
      (error) => error && error.code === "FTP_PATH_INVALID",
      "camera FTP in-place imports must reject files outside the active original directory"
    );

    const managerModule = requireDist("services/iisFtpManager.js");
    const statusTypesModule = requireDist("services/camera-ftp/iisFtpStatusTypes.js");
    assert.equal(
      managerModule.createUnknownIisFtpStatus,
      statusTypesModule.createUnknownIisFtpStatus,
      "the IIS manager facade must preserve the unknown-status constructor entrypoint"
    );
    assert.equal(
      managerModule.normalizeIisFtpStatus,
      statusTypesModule.normalizeIisFtpStatus,
      "the IIS manager facade must preserve the status normalizer entrypoint"
    );
    managerModule.validateCameraFtpCredentials("mpw-camera", "SafePass123!");
    assert.doesNotThrow(() => managerModule.validateCameraFtpPorts(21, 50000, 50100));
    assert.doesNotThrow(() => managerModule.validateCameraFtpPorts(2021, 51000, 51100));
    assert.throws(
      () => managerModule.validateCameraFtpPorts(50000, 50000, 50100),
      (error) => error && error.code === "FTP_PORT_RANGE_CONFLICT"
    );
    assert.throws(
      () => managerModule.validateCameraFtpPorts(65536, 50000, 50100),
      (error) => error && error.code === "FTP_CONTROL_PORT_INVALID"
    );
    assert.throws(
      () => managerModule.validateCameraFtpCredentials("mpw-camera", "short"),
      (error) => error && error.code === "FTP_PASSWORD_INVALID"
    );

    const initializedGuardModule = requireDist("services/cameraFtpOrchestrator.js");
    assert.throws(
      () => initializedGuardModule.assertCameraFtpInitialized({ accountManaged: false, managedSiteId: 0, passwordResetRequired: true }),
      (error) => error && error.code === "FTP_SETUP_REQUIRED",
      "service operations must reject an uninitialized IIS configuration"
    );
    assert.doesNotThrow(
      () => initializedGuardModule.assertCameraFtpInitialized({ accountManaged: true, managedSiteId: 42, passwordResetRequired: true }),
      "stop and repair may run after setup even when a password reset is pending"
    );
    assert.throws(
      () => initializedGuardModule.assertCameraFtpInitialized(
        { accountManaged: true, managedSiteId: 42, passwordResetRequired: true },
        { requirePassword: true }
      ),
      (error) => error && error.code === "FTP_PASSWORD_REQUIRED",
      "start and restart must require a configured password"
    );

    const powerShellModule = requireDist("utils/elevatedPowerShell.js");
    const literalSource = "C:\\临时 文件夹\\O'Brien\\脚本.ps1";
    assert.equal(
      powerShellModule.powershellLiteral(literalSource),
      "'C:\\临时 文件夹\\O''Brien\\脚本.ps1'",
      "PowerShell single-quoted literals must preserve Unicode/spaces and double apostrophes"
    );
    assert.equal(powerShellModule.powershellLiteral("摄影 用户'O"), "'摄影 用户''O'");
    assert.throws(
      () => powerShellModule.parsePowerShellJsonEnvelope({
        ok: false,
        operation: "setup",
        stage: "uac_cancelled",
        timestamp: "2026-01-01T00:00:00.000Z",
        data: null,
        error: { code: "UAC_CANCELLED", message: "cancelled" }
      }),
      (error) => error && error.code === "UAC_CANCELLED" && error.message === "cancelled"
    );
    assert.throws(
      () => powerShellModule.parsePowerShellJsonEnvelope({ ok: true, data: { ready: true } }),
      (error) => error && error.code === "ELEVATED_RESULT_INVALID_SCHEMA"
        && error.diagnostics.details.invalidFields.includes("operation")
        && error.diagnostics.details.invalidFields.includes("timestamp"),
      "missing structured-result fields must never be treated as success"
    );
    assert.throws(
      () => powerShellModule.resolveWindowsScriptPath("../iis-ftp-setup.ps1"),
      (error) => error && error.code === "IIS_CONFIG_FAILED",
      "script traversal must be rejected before any process starts"
    );

    let powerShellIpc = "skipped_non_windows";
    let powerShellInvalidParameters = "skipped_non_windows";
    let powerShellFailureExit = "skipped_non_windows";
    let powerShellTimeout = "skipped_non_windows";
    let powerShellTemporaryCleanup = "skipped_non_windows";
    let powerShellParserAndDotSource = "skipped_non_windows";
    if (process.platform === "win32") {
      const mockScriptsDir = path.join(tempRoot, "模拟 PowerShell 脚本's");
      const isolatedIpcTemp = path.join(tempRoot, "隔离 IPC 临时目录");
      const unicodeReceivePath = path.join(tempRoot, "活动 一号", "相机 FTP 接收 O'Brien");
      fs.mkdirSync(mockScriptsDir, { recursive: true });
      fs.mkdirSync(isolatedIpcTemp, { recursive: true });
      fs.mkdirSync(unicodeReceivePath, { recursive: true });
      fs.copyFileSync(
        path.join(root, "scripts", "windows", "iis-ftp-common.ps1"),
        path.join(mockScriptsDir, "iis-ftp-common.ps1")
      );

      writePowerShellScript(mockScriptsDir, "mock-json-roundtrip.ps1", String.raw`
param(
    [string]$InputPath,
    [string]$OutputPath
)

. (Join-Path $PSScriptRoot 'iis-ftp-common.ps1')

$action = 'roundtrip'
try {
    $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
    Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @('action', 'requestId', 'username', 'physicalPath', 'password', 'note')
    $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('roundtrip')
    $username = Assert-MpwUsername -Username ([string](Get-MpwInputValue -InputObject $inputObject -Name 'username' -DefaultValue ''))
    $physicalPath = Assert-MpwPhysicalPath -PhysicalPath ([string](Get-MpwInputValue -InputObject $inputObject -Name 'physicalPath' -DefaultValue ''))
    $password = Assert-MpwPassword -Password (Get-MpwInputValue -InputObject $inputObject -Name 'password')
    $data = [ordered]@{
        requestId = [string](Get-MpwInputValue -InputObject $inputObject -Name 'requestId' -DefaultValue '')
        username = $username
        physicalPath = $physicalPath
        note = [string](Get-MpwInputValue -InputObject $inputObject -Name 'note' -DefaultValue '')
        password = $password
        nested = [ordered]@{ token = $password; accepted = $true }
    }
    Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Data $data
    exit 0
}
catch {
    $safe = ConvertTo-MpwSafeException -ErrorRecord $_
    Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -ErrorObject $safe
    exit 2
}
`);
      writePowerShellScript(mockScriptsDir, "mock-failure-exit.ps1", String.raw`
param(
    [string]$InputPath,
    [string]$OutputPath
)
exit 37
`);
      writePowerShellScript(mockScriptsDir, "mock-timeout.ps1", String.raw`
param(
    [string]$InputPath,
    [string]$OutputPath
)
Start-Sleep -Seconds 30
exit 0
`);
      writePowerShellScript(mockScriptsDir, "mock-invalid-json.ps1", String.raw`
param(
    [string]$InputPath,
    [string]$OutputPath
)
[IO.File]::WriteAllText($OutputPath, '{invalid-json', [Text.UTF8Encoding]::new($false))
exit 0
`);

      await withTemporaryDirectoryEnvironment(isolatedIpcTemp, async () => withWindowsScriptsDirectory(mockScriptsDir, async () => {
        assert.equal(path.resolve(os.tmpdir()), path.resolve(isolatedIpcTemp), "the IPC test must be isolated from the user's real temp directory");
        const secret = "Temp-Only-Secret!42";
        const ipcResult = await powerShellModule.runPowerShellJsonScript("mock-json-roundtrip.ps1", {
          action: "roundtrip",
          requestId: "请求 01'O",
          username: "摄影 用户'O",
          physicalPath: unicodeReceivePath,
          password: secret,
          note: "中文、空格与 apostrophe 均需原样保留"
        }, { timeoutMs: 10_000 });
        assert.equal(ipcResult.requestId, "请求 01'O");
        assert.equal(ipcResult.username, "摄影 用户'O");
        assert.equal(path.resolve(ipcResult.physicalPath), path.resolve(unicodeReceivePath));
        assert.equal(ipcResult.note, "中文、空格与 apostrophe 均需原样保留");
        assert.equal(ipcResult.nested.accepted, true);
        assert.equal(containsSecretField(ipcResult), false, "PowerShell JSON output must strip secret-bearing fields");
        assert.equal(JSON.stringify(ipcResult).includes(secret), false, "the password value must never appear in parsed output");
        assertNoElevatedOperationDirectories(isolatedIpcTemp, "successful JSON IPC must remove its short-lived operation directory");

        await assert.rejects(
          powerShellModule.runPowerShellJsonScript("mock-json-roundtrip.ps1", {
            action: "roundtrip",
            username: "mpw-camera",
            physicalPath: unicodeReceivePath,
            password: secret,
            unexpectedParameter: "blocked"
          }, { timeoutMs: 10_000 }),
          (error) => error && error.code === "INVALID_PARAMETER" && !error.message.includes(secret),
          "unknown JSON parameters must fail before any Windows mutation"
        );
        powerShellInvalidParameters = "passed";
        assertNoElevatedOperationDirectories(isolatedIpcTemp, "rejected parameters must still remove the operation directory");

        await assert.rejects(
          powerShellModule.runPowerShellJsonScript("mock-failure-exit.ps1", {}, { timeoutMs: 10_000 }),
          (error) => error && error.code === "ELEVATED_SCRIPT_NO_RESULT" && /37/.test(error.message),
          "a non-zero process exit without an envelope must preserve the exit code in a safe error"
        );
        powerShellFailureExit = "passed";
        assertNoElevatedOperationDirectories(isolatedIpcTemp, "a failed child exit must still remove the operation directory");

        await assert.rejects(
          powerShellModule.runPowerShellJsonScript("mock-invalid-json.ps1", {}, { timeoutMs: 10_000 }),
          (error) => error && error.code === "ELEVATED_RESULT_INVALID_JSON" && /无效的 JSON|无效 JSON/.test(error.message),
          "malformed script output must map to a structured safe error"
        );
        assertNoElevatedOperationDirectories(isolatedIpcTemp, "invalid JSON output must still remove the operation directory");

        const timeoutStartedAt = Date.now();
        await assert.rejects(
          powerShellModule.runPowerShellJsonScript("mock-timeout.ps1", {}, { timeoutMs: 5_000 }),
          (error) => error && error.code === "ELEVATED_SCRIPT_TIMEOUT" && !containsSecretField(error),
          "timeout mapping must be testable without starting an elevated process"
        );
        assert.ok(Date.now() - timeoutStartedAt >= 4_500, "the timeout test must exercise the process timer");
        assert.ok(Date.now() - timeoutStartedAt < 15_000, "the timeout mock must be terminated promptly");
        await powerShellModule.cleanupStaleElevatedOperationDirs(Date.now() + 16 * 60 * 1000);
        assertNoElevatedOperationDirectories(isolatedIpcTemp, "the stale-operation fallback must remove any timeout residue");
        powerShellTimeout = "passed";
        powerShellTemporaryCleanup = "passed";
        powerShellIpc = "passed";
      }));

      const validationHarness = writePowerShellScript(tempRoot, "validate-all-iis-ftp-scripts.ps1", String.raw`
param([Parameter(Mandatory = $true)][string]$ScriptsDirectory)

$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath $ScriptsDirectory -Filter '*.ps1' -File | Sort-Object Name)
$parserFailures = [Collections.Generic.List[object]]::new()
$loadFailures = [Collections.Generic.List[object]]::new()
foreach ($file in $files) {
    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    foreach ($parseError in @($parseErrors)) {
        [void]$parserFailures.Add([ordered]@{ file = $file.Name; message = $parseError.Message })
    }
}
if ($parserFailures.Count -eq 0) {
    foreach ($file in $files) {
        try {
            . $file.FullName
        }
        catch {
            [void]$loadFailures.Add([ordered]@{ file = $file.Name; message = $_.Exception.Message })
        }
    }
}
$result = [ordered]@{
    ok = $parserFailures.Count -eq 0 -and $loadFailures.Count -eq 0
    fileCount = $files.Count
    parserFailures = @($parserFailures)
    dotSourceFailures = @($loadFailures)
}
'MPW_TEST_RESULT:' + ($result | ConvertTo-Json -Depth 8 -Compress)
if (-not $result.ok) { exit 1 }
exit 0
`);
      const productionScriptsDir = path.join(root, "scripts", "windows");
      const validationResult = spawnSync(
        getWindowsPowerShellExecutable(),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", validationHarness, "-ScriptsDirectory", productionScriptsDir],
        { encoding: "utf8", windowsHide: true, timeout: 30_000, shell: false }
      );
      assert.equal(validationResult.error, undefined, validationResult.error?.message);
      const resultLine = String(validationResult.stdout || "").split(/\r?\n/).find((line) => line.startsWith("MPW_TEST_RESULT:"));
      assert.ok(resultLine, `PowerShell validation harness did not return JSON: ${validationResult.stderr || validationResult.stdout}`);
      const scriptValidation = JSON.parse(resultLine.slice("MPW_TEST_RESULT:".length));
      assert.equal(validationResult.status, 0, JSON.stringify(scriptValidation));
      assert.equal(scriptValidation.ok, true, JSON.stringify(scriptValidation));
      assert.equal(scriptValidation.fileCount, fs.readdirSync(productionScriptsDir).filter((name) => name.endsWith(".ps1")).length);
      assert.ok(scriptValidation.fileCount >= 6, "all IIS FTP PowerShell entry scripts must be covered");
      assert.deepEqual(scriptValidation.parserFailures, []);
      assert.deepEqual(scriptValidation.dotSourceFailures, []);
      powerShellParserAndDotSource = "passed_no_entrypoints_invoked";
    }

    const hostOnlyModule = requireDist("middleware/hostOnly.js");
    const fakeRequest = (remoteAddress, origin) => ({
      socket: { remoteAddress },
      get: (name) => name.toLowerCase() === "origin" ? origin : undefined
    });
    assert.equal(hostOnlyModule.isHostRequest(fakeRequest("127.0.0.1", "http://localhost:5173")), true);
    assert.equal(hostOnlyModule.isHostRequest(fakeRequest("192.168.137.110", "http://192.168.137.1:3030")), false);
    assert.equal(hostOnlyModule.isHostRequest(fakeRequest("127.0.0.1", "https://evil.example")), false);

    const orchestratorModule = requireDist("services/cameraFtpOrchestrator.js");
    const switchTransactionModule = requireDist("services/camera-ftp/cameraFtpSwitchTransaction.js");
    assert.equal(
      orchestratorModule.runCameraFtpEventSwitchTransaction,
      switchTransactionModule.runCameraFtpEventSwitchTransaction,
      "the orchestrator facade must preserve the existing switch transaction entrypoint"
    );
    const readOnlyRepository = path.join(tempRoot, "read-only-preflight-repository");
    const readOnlyReceivePath = orchestratorModule.resolveCameraFtpReceivePath(
      readOnlyRepository,
      "read_only_event"
    );
    assert.equal(
      readOnlyReceivePath,
      path.join(readOnlyRepository, "working", "read_only_event", "原图", "相机FTP")
    );
    assert.equal(
      fs.existsSync(readOnlyRepository),
      false,
      "read-only provisioning path resolution must not create the repository or event directory"
    );

    const startupRecoveryModule = requireDist("services/cameraFtpStartupRecovery.js");
    assert.equal(typeof startupRecoveryModule.decideCameraFtpStartupRecovery, "function");
    assert.equal(typeof startupRecoveryModule.runCameraFtpStartupRecovery, "function");

    const startupRepository = path.join(tempRoot, "startup-recovery-repository");
    const startupExpectedPath = orchestratorModule.resolveCameraFtpReceivePath(startupRepository, "event_slug");
    const startupDecisionFixture = (overrides = {}) => mergeFixture({
      activeEventId: "evt_startup",
      eventExists: true,
      eventStatus: "active",
      repositoryConfigured: true,
      repositoryAvailable: true,
      repositoryPath: startupRepository,
      expectedPath: startupExpectedPath,
      receiveDirectoryExists: true,
      receiveDirectoryAccessible: true,
      currentInspectionLevel: "full",
      siteExists: true,
      siteStarted: true,
      sitePhysicalPath: startupExpectedPath,
      watcher: {
        running: false,
        eventId: "",
        directory: ""
      }
    }, overrides);
    const decideStartupRecovery = startupRecoveryModule.decideCameraFtpStartupRecovery;

    const noActiveEventDecision = decideStartupRecovery(startupDecisionFixture({
      activeEventId: "",
      eventExists: false
    }));
    assert.equal(noActiveEventDecision.action, "skip");
    assert.equal(noActiveEventDecision.status, "skipped");
    assert.equal(noActiveEventDecision.reasonCode, "NO_ACTIVE_EVENT");
    assert.equal(noActiveEventDecision.shouldStartWatcher, false);
    assert.equal(noActiveEventDecision.shouldScan, false);

    const missingEventDecision = decideStartupRecovery(startupDecisionFixture({ eventExists: false }));
    assert.equal(missingEventDecision.action, "skip");
    assert.equal(missingEventDecision.reasonCode, "ACTIVE_EVENT_NOT_FOUND");
    assert.equal(missingEventDecision.shouldStartWatcher, false);

    const archivedEventDecision = decideStartupRecovery(startupDecisionFixture({ eventStatus: "archived" }));
    assert.equal(archivedEventDecision.action, "skip");
    assert.equal(archivedEventDecision.reasonCode, "EVENT_NOT_RECEIVABLE");
    assert.equal(archivedEventDecision.shouldStartWatcher, false);

    for (const repositoryState of [
      { repositoryConfigured: false, repositoryAvailable: false },
      { repositoryConfigured: true, repositoryAvailable: false }
    ]) {
      const repositoryUnavailableDecision = decideStartupRecovery(startupDecisionFixture(repositoryState));
      assert.equal(repositoryUnavailableDecision.action, "skip");
      assert.equal(repositoryUnavailableDecision.reasonCode, "REPOSITORY_UNAVAILABLE");
      assert.equal(repositoryUnavailableDecision.shouldStartWatcher, false);
      assert.equal(repositoryUnavailableDecision.shouldScan, false);
    }

    for (const directoryState of [
      { receiveDirectoryExists: false, receiveDirectoryAccessible: false },
      { receiveDirectoryExists: true, receiveDirectoryAccessible: false }
    ]) {
      const receivePathUnavailableDecision = decideStartupRecovery(startupDecisionFixture(directoryState));
      assert.equal(receivePathUnavailableDecision.action, "skip");
      assert.equal(receivePathUnavailableDecision.reasonCode, "RECEIVE_PATH_UNAVAILABLE");
      assert.equal(receivePathUnavailableDecision.shouldStartWatcher, false);
      assert.equal(receivePathUnavailableDecision.shouldScan, false);
    }

    const unknownInspectionDecision = decideStartupRecovery(startupDecisionFixture({
      currentInspectionLevel: "unknown",
      siteExists: null,
      siteStarted: null,
      sitePhysicalPath: ""
    }));
    assert.equal(unknownInspectionDecision.action, "skip");
    assert.equal(unknownInspectionDecision.status, "skipped");
    assert.ok(
      ["IIS_SITE_STATE_UNKNOWN", "IIS_PHYSICAL_PATH_UNKNOWN"].includes(unknownInspectionDecision.reasonCode),
      "unknown ordinary inspection must remain unknown instead of being treated as a missing or healthy IIS site"
    );
    assert.equal(unknownInspectionDecision.inspectionLevel, "unknown");
    assert.equal(unknownInspectionDecision.shouldStartWatcher, false);

    const missingSiteDecision = decideStartupRecovery(startupDecisionFixture({
      siteExists: false,
      siteStarted: false,
      sitePhysicalPath: ""
    }));
    assert.equal(missingSiteDecision.action, "skip");
    assert.equal(missingSiteDecision.reasonCode, "IIS_SITE_NOT_FOUND");
    assert.equal(missingSiteDecision.shouldStartWatcher, false);

    const physicalPathMismatchDecision = decideStartupRecovery(startupDecisionFixture({
      sitePhysicalPath: path.join(startupRepository, "working", "different_event", "原图", "相机FTP")
    }));
    assert.equal(physicalPathMismatchDecision.action, "skip");
    assert.equal(physicalPathMismatchDecision.status, "skipped");
    assert.equal(physicalPathMismatchDecision.reasonCode, "IIS_PHYSICAL_PATH_MISMATCH");
    assert.equal(physicalPathMismatchDecision.shouldStartWatcher, false);
    assert.equal(physicalPathMismatchDecision.shouldScan, false);

    const partialStoppedSiteDecision = decideStartupRecovery(startupDecisionFixture({
      currentInspectionLevel: "partial",
      siteStarted: false,
      sitePhysicalPath: `${startupExpectedPath.toUpperCase()}${path.sep}`
    }));
    assert.equal(partialStoppedSiteDecision.action, "restore");
    assert.equal(partialStoppedSiteDecision.status, "eligible");
    assert.equal(partialStoppedSiteDecision.inspectionLevel, "partial");
    assert.equal(partialStoppedSiteDecision.shouldStartWatcher, true);
    assert.equal(partialStoppedSiteDecision.shouldScan, true);
    assert.ok(warningCodes(partialStoppedSiteDecision).includes("ADMIN_INSPECTION_RECOMMENDED"));

    const adminRequiredStoppedSiteDecision = decideStartupRecovery(startupDecisionFixture({
      currentInspectionLevel: "admin_required",
      siteStarted: false
    }));
    assert.equal(adminRequiredStoppedSiteDecision.action, "restore");
    assert.equal(adminRequiredStoppedSiteDecision.status, "eligible");
    assert.equal(adminRequiredStoppedSiteDecision.inspectionLevel, "admin_required");
    assert.equal(adminRequiredStoppedSiteDecision.shouldStartWatcher, true);
    assert.ok(warningCodes(adminRequiredStoppedSiteDecision).includes("ADMIN_INSPECTION_RECOMMENDED"));

    const unknownRuntimeDecision = decideStartupRecovery(startupDecisionFixture({
      currentInspectionLevel: "partial",
      siteStarted: null
    }));
    assert.equal(unknownRuntimeDecision.action, "restore", "an unknown IIS runtime does not make the matching watcher path unsafe");
    assert.equal(unknownRuntimeDecision.status, "eligible", "unknown IIS runtime must not be reported as a completed success");
    assert.notEqual(unknownRuntimeDecision.status, "success");
    assert.ok(warningCodes(unknownRuntimeDecision).includes("IIS_SITE_STATE_UNKNOWN"));

    const stoppedSiteWithMatchingWatcherDecision = decideStartupRecovery(startupDecisionFixture({
      siteStarted: false,
      watcher: {
        running: true,
        eventId: "evt_startup",
        directory: startupExpectedPath
      }
    }));
    assert.equal(stoppedSiteWithMatchingWatcherDecision.action, "keep");
    assert.equal(stoppedSiteWithMatchingWatcherDecision.status, "already_running");
    assert.equal(stoppedSiteWithMatchingWatcherDecision.shouldStartWatcher, false);

    const mismatchedWatcherDecision = decideStartupRecovery(startupDecisionFixture({
      siteStarted: false,
      watcher: {
        running: true,
        eventId: "evt_other",
        directory: path.join(startupRepository, "working", "other_event", "原图", "相机FTP")
      }
    }));
    assert.equal(mismatchedWatcherDecision.action, "skip");
    assert.equal(mismatchedWatcherDecision.reasonCode, "WATCHER_TARGET_MISMATCH");
    assert.equal(mismatchedWatcherDecision.shouldStartWatcher, false);

    const startupRecoverySourcePath = path.join(root, "src-server", "services", "cameraFtpStartupRecovery.ts");
    const startupRecoverySource = fs.readFileSync(startupRecoverySourcePath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const forbiddenStartupMutationPatterns = [
      ["administrator inspection", /\bgetStatusElevated\b|\brunElevatedPowerShellJsonScript\b/],
      ["configuration mutation", /\bsaveConfig\b/],
      ["directory creation", /\bensureEventWorkingDirs\b|\bensureDir\s*\(|\bmkdir\s*\(/],
      ["IIS mutation", /\brunMutationScript\b|\.\s*(?:setup|repair|restart|setPhysicalPath|adoptSite|updateCredentials)\s*\(/]
    ];
    for (const [label, pattern] of forbiddenStartupMutationPatterns) {
      assert.doesNotMatch(startupRecoverySource, pattern, `startup recovery must not perform ${label}`);
    }

    fs.mkdirSync(startupExpectedPath, { recursive: true });
    const startupConfig = {
      repository: { path: startupRepository },
      cameraFtp: {
        activeEventId: "evt_startup",
        controlPort: 21,
        passivePortStart: 50000,
        passivePortEnd: 50100
      }
    };
    const currentInspection = {
      currentInspectionLevel: "partial",
      site: {
        exists: true,
        started: false,
        physicalPath: startupExpectedPath
      }
    };
    const startupConfigBefore = JSON.stringify(startupConfig);
    const currentInspectionBefore = JSON.stringify(currentInspection);
    const startupCalls = [];
    const forbiddenStartupCalls = [];
    let startupScanCount = 0;
    const healthyWatcherStatus = {
      running: true,
      eventId: "evt_startup",
      directory: startupExpectedPath,
      pendingCount: 0,
      queuedCount: 0,
      importingCount: 0,
      unstableCount: 0,
      lastScanAt: "2026-07-15T00:00:00.000Z"
    };
    const forbiddenDependency = (name) => async () => {
      forbiddenStartupCalls.push(name);
      throw new Error(`startup recovery must not call ${name}`);
    };
    const startupDependencies = {
      getConfig: () => {
        startupCalls.push("config:read");
        return startupConfig;
      },
      getEvent: (eventId) => {
        startupCalls.push("event:read");
        assert.equal(eventId, "evt_startup");
        return { id: eventId, name: "启动恢复活动", slug: "event_slug", status: "active" };
      },
      inspectRepository: async (repositoryPath) => {
        startupCalls.push("repository:inspect");
        assert.equal(repositoryPath, startupRepository);
        return { configured: true, available: true };
      },
      inspectReceiveDirectory: async (receivePath) => {
        startupCalls.push("directory:inspect");
        assert.equal(receivePath, startupExpectedPath);
        return { exists: true, accessible: true, isDirectory: true };
      },
      inspectCurrent: async (input) => {
        startupCalls.push("iis:inspect-current-readonly");
        assert.equal(input.physicalPath, startupExpectedPath);
        return currentInspection;
      },
      getWatcherStatus: () => ({
        running: false,
        eventId: "",
        directory: "",
        pendingCount: 0,
        queuedCount: 0,
        importingCount: 0,
        unstableCount: 0
      }),
      startWatcher: async (input) => {
        startupCalls.push("watcher:start");
        assert.equal(input.eventId, "evt_startup");
        assert.equal(input.directory, startupExpectedPath);
        assert.equal(input.createDirectory, false, "startup recovery must require the pre-existing receive directory");
        if (input.scanExistingOnStart !== false) startupScanCount += 1;
        return healthyWatcherStatus;
      },
      scanWatcher: async () => {
        startupCalls.push("watcher:scan");
        startupScanCount += 1;
        return healthyWatcherStatus;
      },
      log: () => undefined,
      requestElevation: forbiddenDependency("requestElevation"),
      inspectElevated: forbiddenDependency("inspectElevated"),
      saveConfig: forbiddenDependency("saveConfig"),
      setupIis: forbiddenDependency("setupIis"),
      repairIis: forbiddenDependency("repairIis"),
      adoptIis: forbiddenDependency("adoptIis"),
      setPhysicalPath: forbiddenDependency("setPhysicalPath"),
      createReceiveDirectory: forbiddenDependency("createReceiveDirectory")
    };
    const successfulStartupRecovery = await withTemporaryDirectoryEnvironment(tempRoot, () => (
      startupRecoveryModule.runCameraFtpStartupRecovery(
        { baseUrl: "http://localhost:3030" },
        startupDependencies
      )
    ));
    assert.equal(successfulStartupRecovery.status, "restored");
    assert.equal(successfulStartupRecovery.decision.action, "restore");
    assert.equal(successfulStartupRecovery.watcher.running, true);
    assert.equal(startupScanCount, 1, "startup restore must backfill existing files exactly once");
    assert.ok(startupCalls.includes("iis:inspect-current-readonly"));
    assert.ok(startupCalls.indexOf("watcher:start") > startupCalls.indexOf("iis:inspect-current-readonly"));
    assert.deepEqual(forbiddenStartupCalls, []);
    assert.equal(JSON.stringify(startupConfig), startupConfigBefore, "startup recovery must not rewrite saved target configuration");
    assert.equal(JSON.stringify(currentInspection), currentInspectionBefore, "startup recovery must not mutate the detected IIS snapshot");
    assertNoElevatedOperationDirectories(tempRoot, "ordinary startup recovery must not create UAC operation IPC directories");

    fs.rmSync(startupExpectedPath, { recursive: true, force: true });
    let failedStartupScanCount = 0;
    const failedStartupRecovery = await withTemporaryDirectoryEnvironment(tempRoot, () => (
      startupRecoveryModule.runCameraFtpStartupRecovery(
        { baseUrl: "http://localhost:3030" },
        {
          ...startupDependencies,
          inspectReceiveDirectory: async () => {
            startupCalls.push("directory:inspect-before-disconnect");
            return { exists: true, accessible: true, isDirectory: true };
          },
          startWatcher: async (input) => {
            assert.equal(input.createDirectory, false);
            assert.equal(fs.existsSync(startupExpectedPath), false, "fixture simulates a repository disconnect after preflight");
            throw Object.assign(new Error("receive directory disappeared before watcher start"), {
              code: "RECEIVE_PATH_UNAVAILABLE"
            });
          },
          scanWatcher: async () => {
            failedStartupScanCount += 1;
            return healthyWatcherStatus;
          }
        }
      )
    ));
    assert.equal(failedStartupRecovery.status, "failed");
    assert.equal(failedStartupRecovery.decision.action, "restore");
    assert.ok(warningCodes(failedStartupRecovery).includes("WATCHER_RESTORE_FAILED"));
    assert.equal(failedStartupScanCount, 0, "a failed watcher start must never report or run the backfill scan");
    assert.equal(fs.existsSync(startupExpectedPath), false, "startup recovery must not recreate a disappeared receive directory");
    assert.deepEqual(forbiddenStartupCalls, []);
    assert.equal(JSON.stringify(startupConfig), startupConfigBefore);
    assert.equal(JSON.stringify(currentInspection), currentInspectionBefore);
    assertNoElevatedOperationDirectories(tempRoot, "failed startup recovery must not request elevation");

    assert.equal(
      orchestratorModule.requiresElevatedCameraFtpSiteStateInspection({
        requiresAdmin: false,
        site: { exists: true, started: false }
      }),
      false
    );
    assert.equal(
      orchestratorModule.requiresElevatedCameraFtpSiteStateInspection({
        requiresAdmin: true,
        site: { exists: true, started: false }
      }),
      true,
      "a partial ordinary-permission snapshot must be elevated before unlink authorization"
    );
    assert.equal(
      orchestratorModule.requiresElevatedCameraFtpSiteStateInspection({
        requiresAdmin: false,
        site: { exists: null, started: false }
      }),
      true,
      "unknown IIS site existence must be elevated before unlink authorization"
    );
    assert.equal(
      orchestratorModule.requiresElevatedCameraFtpSiteStateInspection({
        requiresAdmin: false,
        site: { exists: true, started: null }
      }),
      true,
      "unknown IIS runtime state must be elevated before unlink authorization"
    );

    const successfulCommitSequence = [];
    await orchestratorModule.commitCameraFtpNodeState({
      startWatcher: async () => { successfulCommitSequence.push("watcher:apply"); },
      saveConfig: () => { successfulCommitSequence.push("config:apply"); },
      verifyState: () => { successfulCommitSequence.push("state:verify"); },
      restoreConfig: () => { successfulCommitSequence.push("config:rollback"); },
      restoreWatcher: async () => { successfulCommitSequence.push("watcher:rollback"); }
    });
    assert.deepEqual(
      successfulCommitSequence,
      ["watcher:apply", "config:apply", "state:verify"],
      "provisioning must make the watcher healthy before committing the matching config"
    );

    const failedCommitSequence = [];
    const configCommitError = Object.assign(new Error("config write failed"), { code: "CONFIG_WRITE_FAILED" });
    await assert.rejects(
      orchestratorModule.commitCameraFtpNodeState({
        startWatcher: async () => { failedCommitSequence.push("watcher:apply"); },
        saveConfig: () => {
          failedCommitSequence.push("config:apply");
          throw configCommitError;
        },
        restoreConfig: () => { failedCommitSequence.push("config:rollback"); },
        restoreWatcher: async () => { failedCommitSequence.push("watcher:rollback"); }
      }),
      (error) => error === configCommitError,
      "a failed config commit must preserve the original error after successful Node-state rollback"
    );
    assert.deepEqual(
      failedCommitSequence,
      ["watcher:apply", "config:apply", "config:rollback", "watcher:rollback"]
    );

    const failedVerificationSequence = [];
    const verificationError = Object.assign(new Error("watcher target mismatch"), {
      code: "CAMERA_FTP_WATCHER_TARGET_MISMATCH"
    });
    await assert.rejects(
      orchestratorModule.commitCameraFtpNodeState({
        startWatcher: async () => { failedVerificationSequence.push("watcher:apply"); },
        saveConfig: () => { failedVerificationSequence.push("config:apply"); },
        verifyState: () => {
          failedVerificationSequence.push("state:verify");
          throw verificationError;
        },
        restoreConfig: () => { failedVerificationSequence.push("config:rollback"); },
        restoreWatcher: async () => { failedVerificationSequence.push("watcher:rollback"); }
      }),
      (error) => error === verificationError,
      "a failed final Node-state verification must preserve its granular error after local rollback"
    );
    assert.deepEqual(
      failedVerificationSequence,
      ["watcher:apply", "config:apply", "state:verify", "config:rollback", "watcher:rollback"]
    );

    const runSwitchTransactionFixture = async ({
      failStage = "",
      oldStarted = true,
      rollbackFailure = ""
    } = {}) => {
      const oldPath = path.join(tempRoot, "旧 活动", "原图", "相机FTP");
      const targetPath = path.join(tempRoot, "新 活动 中文", "原图", "相机FTP");
      const state = { activeEventId: "evt_old", path: oldPath, watcherPath: oldPath, started: oldStarted };
      const stages = [];
      const snapshot = { ...state };
      const failure = (stage, code = "") => Object.assign(new Error(`synthetic ${stage} failure`), {
        ...(code ? { code } : {}),
        diagnostics: { stage }
      });
      const hooks = {
        operationId: "switch-operation-test",
        fromEventId: "evt_old",
        toEventId: "evt_new",
        validateTargetEvent: () => {
          if (failStage === "validate_target_event") throw failure(failStage);
        },
        checkPendingUploads: () => {
          if (failStage === "check_pending_uploads") throw failure(failStage, "FTP_UPLOAD_IN_PROGRESS");
        },
        snapshotCurrentState: () => snapshot,
        prepareTargetDirectory: () => {
          if (failStage === "prepare_target_directory") throw failure(failStage);
        },
        updateIisPhysicalPath: () => {
          if (["update_target_acl", "update_iis_physical_path", "restart_ftp_site"].includes(failStage)) {
            throw failure(failStage);
          }
          state.path = targetPath;
          return { path: targetPath, started: oldStarted };
        },
        switchWatcher: () => {
          state.watcherPath = targetPath;
          if (failStage === "switch_watcher") throw failure(failStage);
        },
        verifySwitchedState: () => {
          assert.equal(state.activeEventId, "evt_old", "activeEventId must remain old until final verification succeeds");
          assert.equal(state.path, targetPath);
          assert.equal(state.watcherPath, targetPath);
          assert.equal(state.started, oldStarted);
          if (failStage === "verify_switched_state") throw failure(failStage);
        },
        commitActiveEvent: () => {
          state.activeEventId = "evt_new";
          if (failStage === "commit_active_event") throw failure(failStage);
        },
        rollbackSystem: () => {
          if (rollbackFailure === "rollback_physical_path") throw failure(rollbackFailure, "FTP_SWITCH_ROLLBACK_FAILED");
          state.path = oldPath;
          state.started = oldStarted;
          return { path: oldPath, started: oldStarted };
        },
        rollbackWatcher: () => {
          if (rollbackFailure === "rollback_watcher") throw failure(rollbackFailure, "FTP_SWITCH_ROLLBACK_FAILED");
          state.watcherPath = oldPath;
        },
        rollbackActiveEvent: () => {
          if (rollbackFailure === "rollback_active_event") throw failure(rollbackFailure, "FTP_SWITCH_ROLLBACK_FAILED");
          state.activeEventId = "evt_old";
        },
        verifyRollback: () => {
          if (rollbackFailure) return;
          assert.deepEqual(state, snapshot, "failed switches must restore path, watcher, site state and active event atomically");
        },
        onStage: (entry) => stages.push(`${entry.stage}:${entry.status}`)
      };
      try {
        const result = await orchestratorModule.runCameraFtpEventSwitchTransaction(hooks);
        return { result, state, stages, oldPath, targetPath };
      } catch (error) {
        return { error, state, stages, oldPath, targetPath };
      }
    };

    for (const oldStarted of [true, false]) {
      const successfulSwitch = await runSwitchTransactionFixture({ oldStarted });
      assert.equal(successfulSwitch.error, undefined);
      assert.equal(successfulSwitch.state.activeEventId, "evt_new");
      assert.equal(successfulSwitch.state.path, successfulSwitch.targetPath);
      assert.equal(successfulSwitch.state.watcherPath, successfulSwitch.targetPath);
      assert.equal(successfulSwitch.state.started, oldStarted, "a stopped site must stay stopped after switching events");
      assert.deepEqual(successfulSwitch.result.completedStages, [
        "validate_target_event",
        "check_pending_uploads",
        "snapshot_current_state",
        "prepare_target_directory",
        "update_iis_physical_path",
        "switch_watcher",
        "verify_switched_state",
        "commit_active_event"
      ]);
    }

    const granularSwitchFailures = [
      ["update_target_acl", "FTP_TARGET_ACL_UPDATE_FAILED"],
      ["update_iis_physical_path", "FTP_PHYSICAL_PATH_UPDATE_FAILED"],
      ["switch_watcher", "FTP_WATCHER_SWITCH_FAILED"],
      ["restart_ftp_site", "FTP_SITE_RESTART_FAILED"],
      ["verify_switched_state", "FTP_SWITCH_VERIFY_FAILED"],
      ["commit_active_event", "FTP_ACTIVE_EVENT_STATE_MISMATCH"]
    ];
    for (const [failStage, expectedCode] of granularSwitchFailures) {
      const failedSwitch = await runSwitchTransactionFixture({ failStage });
      assert.equal(failedSwitch.error.code, expectedCode, `stage ${failStage} must keep a granular switch error`);
      assert.equal(failedSwitch.error.diagnostics.stage, failStage);
      assert.equal(failedSwitch.error.diagnostics.rollbackSucceeded, true);
      assert.equal(failedSwitch.state.activeEventId, "evt_old");
      assert.equal(failedSwitch.state.path, failedSwitch.oldPath);
      assert.equal(failedSwitch.state.watcherPath, failedSwitch.oldPath);
    }

    const blockedBeforeSnapshot = await runSwitchTransactionFixture({ failStage: "check_pending_uploads" });
    assert.equal(blockedBeforeSnapshot.error.code, "FTP_UPLOAD_IN_PROGRESS");
    assert.equal(blockedBeforeSnapshot.error.diagnostics.rollbackAttempted, false);
    assert.equal(blockedBeforeSnapshot.state.activeEventId, "evt_old");
    assert.equal(
      orchestratorModule.resolveCameraFtpSwitchSnapshotFallbackPath({
        repositoryPath: "D:\\repository"
      }),
      "",
      "a deleted old event must fall back to authoritative IIS site inspection instead of blocking the snapshot"
    );
    assert.equal(
      orchestratorModule.resolveCameraFtpSwitchSnapshotFallbackPath({
        watcherDirectory: "D:\\repository\\working\\old\\原图\\相机FTP",
        repositoryPath: "D:\\repository"
      }),
      "D:\\repository\\working\\old\\原图\\相机FTP",
      "an existing watcher directory remains the strongest non-elevated snapshot hint"
    );
    const incompleteRollback = await runSwitchTransactionFixture({
      failStage: "verify_switched_state",
      rollbackFailure: "rollback_watcher"
    });
    assert.equal(incompleteRollback.error.code, "FTP_SWITCH_ROLLBACK_FAILED");
    assert.equal(incompleteRollback.error.diagnostics.rollbackSucceeded, false);
    assert.ok(incompleteRollback.error.diagnostics.details.rollback.some((item) => item.stage === "rollback_watcher" && item.status === "failed"));

    const orchestratorSource = fs.readFileSync(
      path.join(root, "src-server", "services", "cameraFtpOrchestrator.ts"),
      "utf8"
    );
    const methodSource = (startMarker, endMarker) => {
      const startIndex = orchestratorSource.indexOf(startMarker);
      const endIndex = orchestratorSource.indexOf(endMarker, startIndex + startMarker.length);
      assert.ok(startIndex >= 0 && endIndex > startIndex, `expected orchestrator source markers: ${startMarker}`);
      return orchestratorSource.slice(startIndex, endIndex);
    };
    const discoverSitesSource = methodSource("async discoverSites", "private async adoptSiteUnlocked");
    assert.equal(
      discoverSitesSource.includes("prepareEventDirectory"),
      false,
      "administrator discovery is a read-only preflight and must not create the event directory"
    );
    assert.equal(discoverSitesSource.includes("eventFtpPath(event)"), true);

    const clearActiveEventSource = methodSource("async clearActiveEvent", "async openFolder");
    assert.equal(
      clearActiveEventSource.includes("lastKnownManagedSiteStarted"),
      true,
      "the safety comment must keep the display-only lastKnown boundary explicit"
    );
    assert.equal(
      /site:\s*\{[^}]*started:\s*this\.lastKnownManagedSiteStarted/s.test(clearActiveEventSource),
      false,
      "unlink authorization must never substitute a cached display state for raw IIS state"
    );
    assert.equal(clearActiveEventSource.includes("requiresElevatedCameraFtpSiteStateInspection"), true);
    assert.equal(clearActiveEventSource.includes("getStatusElevated"), true);

    const startSource = methodSource("private async startUnlocked", "async stop");
    const startManagerIndex = startSource.indexOf("this.manager.start(");
    const startWatcherIndex = startSource.indexOf("startCameraFtpWatcher(");
    assert.ok(
      startManagerIndex >= 0 && startWatcherIndex > startManagerIndex,
      "start must finish the manager's full reconcile before starting or switching the watcher"
    );
    assert.equal(startSource.includes("restoreCameraFtpWatcherSnapshot"), true);

    const stopSource = methodSource("private async stopUnlocked", "async restart");
    assert.equal(
      stopSource.includes("allowedEvent(config.activeEventId)"),
      false,
      "stopping an owned IIS site must not depend on a still-valid receive event"
    );
    assert.equal(stopSource.includes("this.manager.stop("), true);
    assert.equal(
      stopSource.includes('physicalPath: ""'),
      false,
      "stop should reuse a valid event path when available and only fall back to an empty control context"
    );

    const restartSource = methodSource("private async restartUnlocked", "async updateCredentials");
    assert.equal(
      restartSource.includes("this.manager.restartRuntime("),
      true,
      "a running owned site must remain runtime-restartable when its saved event no longer exists"
    );
    assert.ok(
      restartSource.indexOf("stopCameraFtpWatcher(") < restartSource.indexOf("this.manager.restartRuntime("),
      "orphaned runtime restart must not preserve a watcher for an invalid event"
    );
    const restartManagerIndex = restartSource.indexOf("this.manager.restart(");
    const restartWatcherIndex = restartSource.indexOf("startCameraFtpWatcher(");
    assert.ok(
      restartManagerIndex >= 0 && restartWatcherIndex > restartManagerIndex,
      "restart must finish the manager's full reconcile before starting or switching the watcher"
    );
    assert.equal(restartSource.includes("restoreCameraFtpWatcherSnapshot"), true);

    const switchActiveEventSource = methodSource("private async switchActiveEventUnlocked", "async clearActiveEvent");
    const snapshotStageSource = switchActiveEventSource.slice(
      switchActiveEventSource.indexOf("snapshotCurrentState:"),
      switchActiveEventSource.indexOf("prepareTargetDirectory:")
    );
    assert.equal(
      snapshotStageSource.includes("allowedEvent(config.activeEventId)"),
      false,
      "snapshotting a managed site must not require the previous saved event row to still exist"
    );
    assert.equal(snapshotStageSource.includes("resolveCameraFtpSwitchSnapshotFallbackPath"), true);

    const managerSource = fs.readFileSync(
      path.join(root, "src-server", "services", "iisFtpManager.ts"),
      "utf8"
    );
    assert.match(
      managerSource,
      /baseScriptInput\(input,\s*action === "set-path"\)/,
      "runtime start, stop and restart controls must not require a current event physicalPath"
    );

    const switchSource = methodSource("private async switchActiveEventUnlocked", "async clearActiveEvent");
    assert.equal(switchSource.includes("this.manager.setPhysicalPath("), true);
    assert.equal(switchSource.includes("this.manager.stop("), false, "event switching must not split stop and path update into separate IIS transactions");
    assert.equal(switchSource.includes("this.manager.start("), false, "the set-path script must restore the exact original site state itself");
    assert.ok(
      switchSource.indexOf("verifySwitchedSite(") < switchSource.indexOf("commitActiveEvent:"),
      "activeEventId may only be committed after system and watcher verification"
    );
    assert.equal(switchSource.includes("pathAction?.systemStatus"), false, "switch verification must never reuse the pre-restart set-path snapshot");

    const lock = new orchestratorModule.CameraFtpSwitchLock();
    let releaseLock;
    const heldOperation = lock.runExclusive(() => new Promise((resolve) => { releaseLock = resolve; }));
    await Promise.resolve();
    await assert.rejects(
      lock.runExclusive(async () => undefined),
      (error) => error && error.code === "CAMERA_FTP_SWITCH_IN_PROGRESS"
    );
    releaseLock();
    await heldOperation;
    assert.equal(lock.isLocked(), false);
    assert.throws(
      () => orchestratorModule.assertCameraFtpSwitchAllowed({ pendingCount: 1, queuedCount: 0, importingCount: 0, unstableCount: 0 }),
      (error) => error && error.code === "FTP_UPLOAD_IN_PROGRESS"
    );
    assert.throws(
      () => orchestratorModule.assertCameraFtpSwitchAllowed({ busy: true, pendingCount: 0, queuedCount: 0, importingCount: 0, unstableCount: 0 }),
      (error) => error && error.code === "FTP_UPLOAD_IN_PROGRESS",
      "hidden reservations/timers represented by watcher.busy must block an event switch"
    );
    const idleWatcher = { pendingCount: 0, queuedCount: 0, importingCount: 0, unstableCount: 0 };
    assert.throws(
      () => orchestratorModule.assertCameraFtpUnlinkAllowed(idleWatcher, { exists: true, started: true }),
      (error) => error && error.code === "FTP_SERVICE_MUST_BE_STOPPED",
      "unlink must never stop the IIS site implicitly"
    );
    assert.doesNotThrow(() => orchestratorModule.assertCameraFtpUnlinkAllowed(idleWatcher, { exists: true, started: false }));
    assert.throws(
      () => managerModule.validateCameraFtpCredentials("bad/name", "SafePass123!"),
      (error) => error && error.code === "FTP_CREDENTIAL_UPDATE_FAILED"
    );

    const unknownStatus = managerModule.createUnknownIisFtpStatus(migrated.cameraFtp, "");
    assert.equal(unknownStatus.site.id, null);
    assert.equal(unknownStatus.site.exists, null, "unknown IIS access must not be reported as site missing");
    assert.equal(unknownStatus.binding.correct, null);
    assert.equal(containsSecretField(unknownStatus), false);

    const partialStatus = managerModule.normalizeIisFtpStatus({
      requiresAdmin: true,
      service: { name: "ftpsvc", exists: true, status: "Running", startType: "Automatic", running: true },
      site: { exists: null, id: null, managed: null },
      account: { username: "mpw-camera", exists: true, enabled: true, managed: false, conflict: true },
      passivePorts: { start: null, end: null, configured: null, correct: null },
      port: { listening: false, ownedByMicrosoftFtp: false, conflict: false },
      warnings: [{ code: "ADMIN_REQUIRED", message: "IIS site configuration could not be read without elevated access." }]
    }, migrated.cameraFtp, "");
    assert.equal(partialStatus.requiresAdmin, true);
    assert.equal(partialStatus.service.running, true, "requiresAdmin must not erase independently detected service state");
    assert.equal(partialStatus.site.exists, null, "permission-limited IIS fields must remain unknown");
    assert.equal(partialStatus.account.conflict, true, "requiresAdmin must not erase independently detected account conflicts");
    assert.equal(partialStatus.passivePorts.start, 50000, "partial status must preserve the configured PASV range instead of displaying 0-0");
    assert.equal(partialStatus.passivePorts.end, 50100);
    assert.deepEqual(partialStatus.warnings, ["IIS site configuration could not be read without elevated access."]);
    const inspection = orchestratorModule.getCameraFtpInspectionState({
      ...partialStatus,
      lastError: { code: "ADMIN_REQUIRED", message: "full IIS inspection requires elevation" }
    });
    assert.equal(inspection.inspectionLevel, "partial");
    assert.equal(inspection.requiresAdminForFullInspection, true);
    assert.equal(inspection.requiresAdminForSystemChanges, true);
    assert.equal(inspection.lastError, null, "permission-limited status must remain a successful partial response, not a global error");

    let readonlyStatus = unknownStatus;
    if (process.platform === "win32") {
      readonlyStatus = await managerModule.getIisFtpManager().getStatus({
        config: migrated.cameraFtp,
        physicalPath: ""
      });
      assert.equal(containsSecretField(readonlyStatus), false, "read-only IIS status must never expose a password field");
      assert.equal(typeof readonlyStatus.requiresAdmin, "boolean");
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(Object.hasOwn(packageJson.dependencies || {}, "ftp-srv"), false, "ftp-srv dependency must be removed");
    assert.equal(packageJson.build.extraResources.some((item) => item.from === "scripts/windows"), true);
    const canonicalExample = JSON.parse(fs.readFileSync(path.join(root, "config", "config.example.json"), "utf8"));
    assert.equal(canonicalExample.cameraFtp.managedSiteId, 0);
    assert.equal(canonicalExample.cameraFtp.username, "camera");
    assert.equal(fs.existsSync(path.join(root, "config.example.json")), false, "only config/config.example.json should remain canonical");
    const cameraPanelSource = fs.readFileSync(path.join(root, "src", "components", "import", "CameraFtpImportPanel.tsx"), "utf8");
    assert.equal(cameraPanelSource.includes("配置并启动 FTP"), true);
    assert.equal(cameraPanelSource.includes("使用推荐端口"), true);
    assert.equal(cameraPanelSource.includes("高级：被动端口范围"), true);
    assert.equal(cameraPanelSource.includes("停止并解除关联"), false);
    assert.equal(cameraPanelSource.includes("原图/相机FTP"), true);
    assert.equal(cameraPanelSource.includes("多台相机可以共用同一 FTP 账户"), true);
    assert.equal(cameraPanelSource.includes("待切换，尚未生效"), true);
    assert.equal(cameraPanelSource.includes("operationInProgressRef"), true);

    const schemaSource = fs.readFileSync(path.join(root, "src-server", "db", "schema.ts"), "utf8");
    const receiptStoreSource = fs.readFileSync(path.join(root, "src-server", "services", "cameraFtpReceipts.ts"), "utf8");
    assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS camera_ftp_file_receipts/);
    assert.match(schemaSource, /PRIMARY KEY \(event_id, path_key\)/);
    assert.match(schemaSource, /result IN \('imported', 'skipped'\)/);
    assert.match(receiptStoreSource, /ON CONFLICT\(event_id, path_key\) DO UPDATE SET/);
    assert.match(receiptStoreSource, /source = 'camera_ftp'/);
    assert.match(receiptStoreSource, /modifiedMs: 0/);
    assert.doesNotMatch(receiptStoreSource, /password|secret|token/i);

    console.log(JSON.stringify({
      ok: true,
      tests: {
        configMigration: "passed",
        legacySecretRemoval: "passed",
        managedSiteIdentityMigration: "passed",
        partialReadOnlyStatus: "passed",
        configurableControlPort: "passed",
        portRangeValidation: "passed",
        networkClassification: "passed",
        hotspotVirtualAdapter: "passed",
        ftpPathConstruction: "passed",
        inPlaceOriginalImport: "passed",
        persistentCameraFtpFileReceiptSchema: "passed",
        credentialValidation: "passed",
        structuredErrorMapping: "passed",
        apiErrorEnvelopeCompatibility: "passed",
        powershellLiteralEscaping: "passed",
        powerShellJsonIpc: powerShellIpc,
        powerShellInvalidParameters,
        powerShellFailureExit,
        powerShellTimeout,
        powerShellTemporaryCleanup,
        powerShellParserAndDotSource,
        uacCancellationMapping: "passed_pure_logic_no_uac_prompt",
        hostOnlyGuard: "passed",
        managementLockAndSwitchGuard: "passed",
        readOnlyDiscoveryPath: "passed",
        unlinkRawStatusGate: "passed",
        provisioningNodeRollback: "passed",
        activeEventAtomicSwitchAndRollback: "passed",
        activeEventStoppedSitePreservation: "passed",
        activeEventGranularFailureStages: "passed",
        activeEventUnicodePath: "passed",
        activeEventIncompleteRollbackReporting: "passed",
        reconcileBeforeWatcher: "passed",
        serviceAndAssociationSeparation: "passed",
        startupRecoveryDecisionMatrix: "passed_fixture_only",
        startupRecoveryPartialTruth: "passed_fixture_only",
        startupRecoveryReadOnlyExecution: "passed_fixture_only_no_uac_no_iis_mutation",
        startupRecoveryBackfill: "passed_fixture_only_exactly_once",
        startupRecoveryDirectoryDisconnect: "passed_fixture_only_no_directory_creation",
        partialInspectionContract: "passed",
        firstSetupUiContract: "passed",
        iisStatusFacadeCompatibility: "passed",
        unknownStatusSemantics: "passed",
        readOnlyStatus: process.platform === "win32" ? "passed" : "skipped_non_windows"
      },
      currentReadOnlyIis: {
        platform: readonlyStatus.platform,
        service: readonlyStatus.service,
        site: readonlyStatus.site,
        port: readonlyStatus.port,
        firewall: readonlyStatus.firewall,
        account: readonlyStatus.account,
        requiresAdmin: readonlyStatus.requiresAdmin,
        warnings: readonlyStatus.warnings,
        lastError: readonlyStatus.lastError
      }
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
