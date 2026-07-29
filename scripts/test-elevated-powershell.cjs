const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const powerShell = require(path.join(root, "dist-server", "utils", "elevatedPowerShell.js"));

function writeScript(directory, name, source) {
  fs.writeFileSync(path.join(directory, name), source.replace(/^\n/, ""), "utf8");
}

async function main() {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ suite: "elevatedPowerShell", skipped: "non_windows" }, null, 2));
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw 提权测试 空格-"));
  const scriptsDir = path.join(tempRoot, "模拟 scripts 中文");
  const ipcTemp = path.join(tempRoot, "IPC 临时目录 中文");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(ipcTemp, { recursive: true });
  fs.copyFileSync(
    path.join(root, "scripts", "windows", "iis-ftp-common.ps1"),
    path.join(scriptsDir, "iis-ftp-common.ps1")
  );

  writeScript(scriptsDir, "mock-delayed-result.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
. (Join-Path $PSScriptRoot 'iis-ftp-common.ps1')
$inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
$payload = [ordered]@{ ok = $true; operation = 'delayed'; stage = 'completed'; data = @{ path = [string]$inputObject.path; note = [string]$inputObject.note }; warnings = @(); timestamp = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 8 -Compress
$escapedPath = $OutputPath.Replace("'", "''")
$escapedPayload = $payload.Replace("'", "''")
$command = "Start-Sleep -Milliseconds 220; [IO.File]::WriteAllText('$escapedPath','$escapedPayload',[Text.UTF8Encoding]::new(" + '$false' + "))"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden
exit 0
`);

  writeScript(scriptsDir, "mock-partial-result.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
$payload = [ordered]@{ ok = $true; operation = 'partial'; stage = 'completed'; data = @{ ready = $true }; warnings = @(); timestamp = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 8 -Compress
$split = [Math]::Floor($payload.Length / 2)
[IO.File]::WriteAllText($OutputPath,$payload.Substring(0,$split),[Text.UTF8Encoding]::new($false))
Start-Sleep -Milliseconds 180
[IO.File]::AppendAllText($OutputPath,$payload.Substring($split),[Text.UTF8Encoding]::new($false))
exit 0
`);

  writeScript(scriptsDir, "mock-structured-failure.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
[ordered]@{ ok = $false; operation = 'firewall'; stage = 'configure_firewall'; code = 'FIREWALL_CONFIG_FAILED'; message = 'Firewall configuration failed.'; technicalMessage = 'Access denied by policy.'; exceptionType = 'System.UnauthorizedAccessException'; command = 'Set-NetFirewallRule'; rollbackAttempted = $true; rollbackSucceeded = $true; warnings = @(); timestamp = [DateTimeOffset]::UtcNow.ToString('o'); data = $null } | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
exit 8
`);

  writeScript(scriptsDir, "mock-no-result.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
exit 37
`);

  writeScript(scriptsDir, "mock-timeout.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
Start-Sleep -Seconds 30
exit 0
`);

  writeScript(scriptsDir, "mock-invalid-json.ps1", String.raw`
param([string]$InputPath,[string]$OutputPath)
[IO.File]::WriteAllText($OutputPath,'{"ok":false,"password":"should-never-be-logged"',[Text.UTF8Encoding]::new($false))
exit 1
`);

  const previousScripts = process.env.MPW_WINDOWS_SCRIPTS_DIR;
  const previousElevatedTempRoot = process.env.MPW_ELEVATED_TEMP_ROOT;
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const preferredElevatedRoot = path.join(ipcTemp, "MediaPhotoWorkbench", "elevated");
  process.env.MPW_WINDOWS_SCRIPTS_DIR = scriptsDir;
  process.env.MPW_ELEVATED_TEMP_ROOT = preferredElevatedRoot;
  process.env.TEMP = ipcTemp;
  process.env.TMP = ipcTemp;
  const secret = "Never-Log-This-Password!42";
  try {
    assert.match(powerShell.windowsPowerShellExecutable(), /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
    assert.equal(powerShell.powershellLiteral("C:\\中文 path\\O'Brien"), "'C:\\中文 path\\O''Brien'");
    assert.equal(
      powerShell.parseWindowsUserSid('"WORKSTATION\\\\camera","S-1-5-21-100-200-300-1001"'),
      "S-1-5-21-100-200-300-1001"
    );
    assert.equal(powerShell.parseWindowsUserSid("no SID"), null);
    assert.deepEqual(
      powerShell.elevatedOperationRootCandidates(process.env, ipcTemp)[0],
      { path: preferredElevatedRoot, kind: "configured" }
    );

    const delayed = await powerShell.runPowerShellJsonScript("mock-delayed-result.ps1", {
      action: "delayed",
      path: path.join(tempRoot, "活动 一号", "原图", "相机FTP"),
      note: "空格与中文路径",
      password: secret
    }, { timeoutMs: 10_000 });
    assert.equal(delayed.note, "空格与中文路径");
    assert.match(delayed.path, /相机FTP$/);
    assert.equal(JSON.stringify(delayed).includes(secret), false);

    const partial = await powerShell.runPowerShellJsonScript("mock-partial-result.ps1", { action: "partial" }, { timeoutMs: 10_000 });
    assert.equal(partial.ready, true, "the reader must wait for a complete JSON write");

    await assert.rejects(
      powerShell.runPowerShellJsonScript("mock-structured-failure.ps1", { action: "firewall" }, { timeoutMs: 10_000 }),
      (error) => error.code === "FIREWALL_CONFIG_FAILED"
        && error.diagnostics.stage === "configure_firewall"
        && error.diagnostics.exitCode === 8
        && error.diagnostics.rollbackSucceeded === true
    );

    await assert.rejects(
      powerShell.runPowerShellJsonScript("mock-no-result.ps1", { action: "no-result" }, { timeoutMs: 10_000 }),
      (error) => error.code === "ELEVATED_SCRIPT_NO_RESULT" && error.diagnostics.exitCode === 37
    );

    await assert.rejects(
      powerShell.runPowerShellJsonScript("mock-invalid-json.ps1", { action: "invalid", password: secret }, { timeoutMs: 10_000 }),
      (error) => error.code === "ELEVATED_RESULT_INVALID_JSON" && !JSON.stringify(error).includes(secret)
    );

    const blockedRootFile = path.join(tempRoot, "not-a-directory");
    fs.writeFileSync(blockedRootFile, "block directory creation", "utf8");
    process.env.MPW_ELEVATED_TEMP_ROOT = path.join(blockedRootFile, "configured");
    const fallback = await powerShell.runPowerShellJsonScript(
      "mock-delayed-result.ps1",
      { action: "fallback", path: "fallback", note: "fallback root" },
      { timeoutMs: 10_000 }
    );
    assert.equal(fallback.note, "fallback root", "an unusable configured temp root must fall back safely");

    process.env.TEMP = blockedRootFile;
    process.env.TMP = blockedRootFile;
    process.env.LOCALAPPDATA = blockedRootFile;
    await assert.rejects(
      powerShell.runPowerShellJsonScript(
        "mock-delayed-result.ps1",
        { action: "all-temp-roots-blocked", password: secret },
        { timeoutMs: 10_000 }
      ),
      (error) => error.code === "TEMP_ACL_FAILED"
        && error.diagnostics.stage === "secure_temp_directory"
        && error.diagnostics.rollbackAttempted === false
        && error.diagnostics.details.systemStateChanged === false
        && Array.isArray(error.diagnostics.details.attempts)
        && error.diagnostics.details.attempts.length >= 2
        && Boolean(error.diagnostics.operationId)
        && !JSON.stringify(error).includes(secret)
        && !JSON.stringify(error.diagnostics).includes(blockedRootFile)
    );
    process.env.MPW_ELEVATED_TEMP_ROOT = preferredElevatedRoot;
    process.env.TEMP = ipcTemp;
    process.env.TMP = ipcTemp;
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;

    await assert.rejects(
      powerShell.runPowerShellJsonScript("mock-timeout.ps1", { action: "timeout" }, { timeoutMs: 5_000 }),
      (error) => error.code === "ELEVATED_SCRIPT_TIMEOUT" && Boolean(error.diagnostics.stage)
    );

    assert.throws(
      () => powerShell.parsePowerShellJsonEnvelope({ ok: false, operation: "setup", stage: "uac_cancelled", code: "UAC_CANCELLED", message: "cancelled", timestamp: "2026-01-01T00:00:00.000Z", data: null }),
      (error) => error.code === "UAC_CANCELLED" && error.diagnostics.stage === "uac_cancelled"
    );
    assert.throws(
      () => powerShell.parsePowerShellJsonEnvelope({}),
      (error) => error.code === "ELEVATED_RESULT_INVALID_SCHEMA"
        && error.diagnostics.details.invalidFields.includes("ok")
        && error.diagnostics.details.invalidFields.includes("data")
    );
    assert.equal(powerShell.redactDiagnosticText(`{"password":"${secret}","stage":"test"}`).includes(secret), false);
    assert.equal(powerShell.redactDiagnosticText(`{"ftpPassword":"${secret}","stage":"test"}`).includes(secret), false);
    assert.equal(powerShell.redactDiagnosticText(`{"cameraSecret":"${secret}","stage":"test"}`).includes(secret), false);
    assert.equal(powerShell.redactDiagnosticText(`{"SecureStringValue":"${secret}","stage":"test"}`).includes(secret), false);
    assert.equal(powerShell.redactDiagnosticText(`{"ftpPassword":"${secret}`).includes(secret), false);

    const operationBase = {
      operationId: "11111111-1111-4111-8111-111111111111",
      scriptName: "iis-ftp-setup.ps1",
      phaseCount: 7,
      indeterminate: false,
      elapsedMs: 30_000,
      estimatedRemainingMinMs: 0,
      estimatedRemainingMaxMs: 120_000,
      estimateExceeded: false,
      safeToRetry: false
    };
    const advanced = {
      ...operationBase,
      state: "running",
      stage: "start_ftp_service",
      phaseIndex: 5,
      progressPercent: 80
    };
    const stale = {
      ...operationBase,
      state: "running",
      stage: "request_created",
      phaseIndex: 0,
      progressPercent: 0,
      elapsedMs: 35_000
    };
    assert.deepEqual(
      powerShell.mergeElevatedAdminOperationStatus(advanced, stale),
      { ...advanced, elapsedMs: 35_000 },
      "a late progress read must not move the administrator operation backwards"
    );
    const completed = {
      ...operationBase,
      state: "completed",
      stage: "completed",
      phaseIndex: 6,
      progressPercent: 100,
      elapsedMs: 36_000,
      estimatedRemainingMinMs: null,
      estimatedRemainingMaxMs: null,
      safeToRetry: true
    };
    assert.strictEqual(
      powerShell.mergeElevatedAdminOperationStatus(completed, stale),
      completed,
      "a late running observation must not replace an already committed terminal state"
    );

    await powerShell.cleanupStaleElevatedOperationDirs(Date.now() + 20 * 60 * 1000);
    const elevatedRoot = preferredElevatedRoot;
    const leftovers = fs.existsSync(elevatedRoot)
      ? fs.readdirSync(elevatedRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      : [];
    assert.equal(leftovers.length, 0, "all success/failure/timeout operation directories must be cleaned");

    const executorSource = fs.readFileSync(path.join(root, "src-server", "utils", "elevatedPowerShell.ts"), "utf8");
    const managerSource = fs.readFileSync(path.join(root, "src-server", "services", "iisFtpManager.ts"), "utf8");
    const routeSource = fs.readFileSync(path.join(root, "src-server", "routes", "cameraFtp.ts"), "utf8");
    assert.match(executorSource, /`\\uFEFF\$\{elevatedRunnerScript\(\)\}`/);
    assert.match(executorSource, /statusPath/);
    assert.equal(executorSource.includes("pwsh.exe"), false);
    assert.equal(powerShell.PROVISIONING_TIMEOUT_MS, 20 * 60 * 1000);
    assert.match(managerSource, /iis-ftp-setup\.ps1[\s\S]*timeoutMs: PROVISIONING_TIMEOUT_MS/);
    assert.match(executorSource, /'-StatusPath'/);
    assert.match(executorSource, /'-OperationId'/);
    assert.match(executorSource, /function recoverElevatedOperationState/);
    assert.match(executorSource, /processMayExist\(status\.processId\)/);
    assert.match(executorSource, /"timed_out_waiting"/);
    assert.match(executorSource, /"abandoned"/);
    assert.match(executorSource, /safeToRetry: false/);
    assert.match(executorSource, /temporaryPath[\s\S]*Move-Item/);
    assert.doesNotMatch(executorSource, /Write-Status -Stage 'uac_accepted'/);
    assert.doesNotMatch(executorSource, /Write-Status -Stage 'process_started'/);
    assert.match(executorSource, /process_completed:\s*\{\s*phaseIndex:\s*6,\s*progressPercent:\s*98/);
    assert.match(executorSource, /if \(!stillActive\)/);
    assert.match(routeSource, /router\.get\("\/admin-operation"/);
    assert.match(routeSource, /requestPath === "\/admin-operation"/);

    console.log(JSON.stringify({
      suite: "elevatedPowerShell",
      passed: [
        "unicode_and_space_paths",
        "delayed_result_file",
        "partial_json_write",
        "structured_nonzero_exit",
        "nonzero_without_result",
        "uac_cancel_mapping",
        "timeout_mapping",
        "invalid_json_diagnostics",
        "invalid_schema_diagnostics",
        "temporary_cleanup",
        "sid_based_temp_acl",
        "alternate_secure_temp_root",
        "all_temp_roots_blocked_diagnostics",
        "secret_redaction",
        "windows_powershell_5_1_bom",
        "twenty_minute_provisioning_timeout",
        "real_stage_status_and_recovery_contract",
        "monotonic_progress_and_terminal_state",
        "admin_operation_api_contract"
      ]
    }, null, 2));
  } finally {
    if (previousScripts === undefined) delete process.env.MPW_WINDOWS_SCRIPTS_DIR;
    else process.env.MPW_WINDOWS_SCRIPTS_DIR = previousScripts;
    if (previousElevatedTempRoot === undefined) delete process.env.MPW_ELEVATED_TEMP_ROOT;
    else process.env.MPW_ELEVATED_TEMP_ROOT = previousElevatedTempRoot;
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    if (previousTmp === undefined) delete process.env.TMP;
    else process.env.TMP = previousTmp;
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
