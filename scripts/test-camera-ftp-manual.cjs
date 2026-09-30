const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const express = require("express");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const { createUnknownIisFtpStatus } = require(path.join(dist, "services/camera-ftp/iisFtpStatusTypes.js"));
const { getCameraFtpManualIssue, canRegisterManualCameraFtpSite, canSwitchCameraFtpEventFromStatus } = require(path.join(dist, "services/camera-ftp/cameraFtpManualStatus.js"));
const { runCameraFtpEventSwitchTransaction } = require(path.join(dist, "services/camera-ftp/cameraFtpSwitchTransaction.js"));
const cameraFtpRouter = require(path.join(dist, "routes/cameraFtp.js")).default;
const config = {
  siteName: "MediaPhotoWorkbenchFTP", managedSiteId: 0, username: "camera",
  controlPort: 1024, passivePortStart: 50000, passivePortEnd: 50100
};

function readyStatus() {
  const status = createUnknownIisFtpStatus(config, "C:\\workspace\\working\\event\\原图\\相机FTP");
  status.platform.supported = true;
  for (const feature of Object.values(status.windowsFeatures)) feature.installed = true;
  Object.assign(status.service, { exists: true, running: true });
  Object.assign(status.site, { id: 3, exists: true, name: config.siteName, managed: true, started: false, sslEnabled: false });
  status.binding.correct = true;
  status.authentication.correct = true;
  status.authorization.correct = true;
  Object.assign(status.account, { exists: true, enabled: true, managed: true });
  Object.assign(status.acl, { exists: true, correct: true });
  status.passivePorts.correct = true;
  status.firewall.correct = true;
  status.port.conflict = false;
  status.lastError = null;
  return status;
}

async function testRetiredRoutes() {
  const app = express();
  app.use(express.json());
  app.use("/api/camera-ftp", cameraFtpRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const port = server.address().port;
    for (const [method, endpoint] of [
      ["POST", "provisioning-plan"], ["POST", "setup"], ["POST", "repair"],
      ["POST", "adopt-site"], ["POST", "discover-sites"],
      ["PATCH", "credentials"], ["DELETE", "pending-provisioning"]
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/camera-ftp/${endpoint}`, { method });
      const payload = await response.json();
      assert.equal(response.status, 410, `${method} ${endpoint}`);
      assert.equal(payload.error.code, "IIS_AUTOMATION_REMOVED");
      assert.equal(payload.error.details.guidePath, "/host/help/camera-ftp");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function testStatusMapping() {
  const ready = readyStatus();
  assert.equal(getCameraFtpManualIssue(ready, config), null);
  assert.equal(canRegisterManualCameraFtpSite(ready, config), true);
  const changedId = { ...config, managedSiteId: 8 };
  assert.equal(canRegisterManualCameraFtpSite(ready, changedId), false);
  const registeredConfig = { ...config, managedSiteId: 3, accountManaged: true };
  assert.equal(canSwitchCameraFtpEventFromStatus(ready, registeredConfig), true);
  const staleOldPath = readyStatus();
  staleOldPath.acl.correct = false;
  assert.equal(canSwitchCameraFtpEventFromStatus(staleOldPath, registeredConfig), true, "stopped site must be able to leave an orphaned old directory");
  staleOldPath.site.started = true;
  assert.equal(canSwitchCameraFtpEventFromStatus(staleOldPath, registeredConfig), false, "running site with unwritable old path must remain blocked");
  const unknownOrdinary = readyStatus();
  unknownOrdinary.site.exists = null;
  assert.equal(canSwitchCameraFtpEventFromStatus(unknownOrdinary, registeredConfig), true, "ordinary unknown status must allow elevated transaction preflight");
  unknownOrdinary.site.exists = false;
  assert.equal(canSwitchCameraFtpEventFromStatus(unknownOrdinary, registeredConfig), false, "confirmed missing site must not offer switching");
  for (const [edit, code, section] of [
    [(status) => { status.windowsFeatures.ftpService.installed = false; }, "IIS_FTP_FEATURE_MISSING", "features"],
    [(status) => { status.service.running = false; }, "FTP_SERVICE_NOT_RUNNING", "service"],
    [(status) => { status.site.exists = false; }, "IIS_SITE_NOT_FOUND", "site"],
    [(status) => { status.authorization.correct = false; }, "FTP_AUTHORIZATION_MISMATCH", "auth"],
    [(status) => { status.acl.correct = false; }, "FTP_DIRECTORY_PERMISSION_REQUIRED", "permissions"],
    [(status) => { status.port.conflict = true; }, "FTP_CONTROL_PORT_IN_USE", "binding"],
    [(status) => { status.service.pending = true; }, "FTP_SERVICE_PENDING", "service"],
    [(status) => { status.service.startType = "Disabled"; }, "FTP_SERVICE_DISABLED", "service"],
    [(status) => { status.site.started = null; }, "IIS_SITE_STATE_UNKNOWN", "verification"],
    [(status) => { status.authentication.correct = null; }, "IIS_STATUS_ADMIN_REQUIRED", "verification"]
  ]) {
    const status = readyStatus();
    edit(status);
    const issue = getCameraFtpManualIssue(status, config);
    assert.equal(issue.code, code);
    assert.equal(issue.section, section);
    assert.equal(issue.blocksControl, true);
  }
  assert.equal(getCameraFtpManualIssue(readyStatus(), config, false).code, "PHYSICAL_PATH_MISMATCH");
  for (const [field, code, section] of [["passivePorts", "PASSIVE_PORT_MISMATCH", "passive"], ["firewall", "FIREWALL_RULE_MISMATCH", "firewall"]]) {
    const status = readyStatus();
    status[field].correct = false;
    const issue = getCameraFtpManualIssue(status, config);
    assert.equal(issue.code, code);
    assert.equal(issue.section, section);
    assert.equal(issue.blocksControl, false, "network advisory must not prevent local site control");
  }
}

async function testSwitchRollback() {
  for (const failingStage of ["validate_target_event", "check_pending_uploads", "snapshot_current_state", "prepare_target_directory", "update_iis_physical_path", "switch_watcher", "verify_switched_state", "commit_active_event"]) {
    const state = { path: "old", watcher: "old", event: "old", started: true };
    const fail = (stage) => { if (stage === failingStage) throw Object.assign(new Error(`injected ${stage}`), { code: "INJECTED_FAILURE" }); };
    const snapshot = () => ({ ...state });
    await assert.rejects(runCameraFtpEventSwitchTransaction({
      operationId: "mock-operation", fromEventId: "old", toEventId: "new",
      validateTargetEvent: () => fail("validate_target_event"),
      checkPendingUploads: () => fail("check_pending_uploads"),
      snapshotCurrentState: () => { fail("snapshot_current_state"); return snapshot(); },
      prepareTargetDirectory: () => fail("prepare_target_directory"),
      updateIisPhysicalPath: () => { state.path = "new"; fail("update_iis_physical_path"); return snapshot(); },
      switchWatcher: () => { state.watcher = "new"; fail("switch_watcher"); },
      verifySwitchedState: () => fail("verify_switched_state"),
      commitActiveEvent: () => { state.event = "new"; fail("commit_active_event"); },
      rollbackSystem: (previous) => { state.path = previous.path; state.started = previous.started; return snapshot(); },
      rollbackWatcher: (previous) => { state.watcher = previous.watcher; },
      rollbackActiveEvent: (previous) => { state.event = previous.event; },
      verifyRollback: (previous) => assert.deepEqual(state, previous)
    }), (error) => {
      assert.equal(error.diagnostics.rollbackSucceeded, true, failingStage);
      assert.equal(error.diagnostics.stage, failingStage);
      return true;
    });
    assert.deepEqual(state, { path: "old", watcher: "old", event: "old", started: true }, failingStage);
  }
  const state = { path: "old", watcher: "old", event: "old", started: true };
  const hooks = {
    operationId: "repeatable-switch", fromEventId: "old", toEventId: "new",
    validateTargetEvent: () => {}, checkPendingUploads: () => {},
    snapshotCurrentState: () => ({ ...state }), prepareTargetDirectory: () => {},
    updateIisPhysicalPath: () => { state.path = "new"; return { ...state }; },
    switchWatcher: () => { state.watcher = "new"; },
    verifySwitchedState: () => {}, commitActiveEvent: () => { state.event = "new"; },
    rollbackSystem: (previous) => { state.path = previous.path; return { ...state }; },
    rollbackWatcher: (previous) => { state.watcher = previous.watcher; },
    rollbackActiveEvent: (previous) => { state.event = previous.event; },
    verifyRollback: (previous) => assert.deepEqual(state, previous)
  };
  await runCameraFtpEventSwitchTransaction(hooks);
  await runCameraFtpEventSwitchTransaction(hooks);
  assert.deepEqual(state, { path: "new", watcher: "new", event: "new", started: true }, "repeat switch must be idempotent");
  hooks.verifySwitchedState = () => { throw new Error("injected verification failure"); };
  hooks.rollbackSystem = () => { throw new Error("injected rollback failure"); };
  hooks.verifyRollback = () => {};
  await assert.rejects(runCameraFtpEventSwitchTransaction(hooks), (error) => {
    assert.equal(error.code, "FTP_SWITCH_ROLLBACK_FAILED");
    assert.equal(error.diagnostics.rollbackSucceeded, false);
    return true;
  });
}

function testScriptBoundary() {
  const control = fs.readFileSync(path.join(root, "scripts/windows/iis-ftp-control.ps1"), "utf8");
  const common = fs.readFileSync(path.join(root, "scripts/windows/iis-ftp-common.ps1"), "utf8");
  assert.match(control, /Get-MpwDirectoryAclStatus/);
  assert.match(control, /FTP_DIRECTORY_PERMISSION_REQUIRED/);
  assert.match(control, /update_iis_physical_path/);
  assert.doesNotMatch(control, /Enable-WindowsOptionalFeature|Start-MpwFtpService|Grant-MpwDirectoryAccess|Restore-MpwDirectoryAclSnapshot|Remove-MpwDirectoryAccountAccess|Set-Acl|icacls|Set-Service/i);
  assert.match(control, /inheritedModifyAllowed/, "path switch must verify inherited Modify access");
  assert.match(control, /verify_active_event_directory/, "start and restart must verify the active directory inside the elevated control transaction");
  assert.match(control, /previousSiteStarted/, "start must report prior site state for watcher rollback without a separate status probe");
  assert.doesNotMatch(common, /Enable-WindowsOptionalFeature|New-LocalUser|Set-LocalUser|Start-Service|Set-Service|New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|Set-Acl|icacls/i);
  assert.doesNotMatch(common, /\[IO\.Directory\]::CreateDirectory/, "manual mode must never create an IIS target directory");
  const guide = fs.readFileSync(path.join(root, "src/pages/host/CameraFtpGuide.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "src/components/import/CameraFtpImportPanel.tsx"), "utf8");
  const orchestrator = fs.readFileSync(path.join(root, "src-server/services/cameraFtpOrchestrator.ts"), "utf8");
  for (const token of ["status?.canStart", "status?.canStop", "status?.canRestart", "status?.canSwitchEvent", "管理员只读检测", "复制诊断信息", "TransientNotice"]) {
    assert.ok(panel.includes(token), `manual FTP panel must include ${token}`);
  }
  assert.doesNotMatch(panel, /自动修复|自动初始化|配置进度|密码输入|provisioning-plan|fetchCameraFtpAdminOperation/);
  assert.match(panel, /IIS 站点状态尚未确认，并非配置异常/);
  assert.match(panel, /当前没有有效的 FTP 接收活动/);
  assert.match(orchestrator, /canSwitchCameraFtpEventFromStatus\(system, config\)/, "event switching must use tested readiness logic");
  const startBody = orchestrator.match(/private async startUnlocked\([\s\S]*?\n  async stop\(/)?.[0] || "";
  const restartBody = orchestrator.match(/private async restartUnlocked\([\s\S]*?\n  async switchActiveEvent\(/)?.[0] || "";
  const switchSnapshotBody = orchestrator.match(/snapshotCurrentState: async \(\) => \{[\s\S]*?\n        prepareTargetDirectory:/)?.[0] || "";
  assert.doesNotMatch(startBody, /getStatusElevated/, "start must not launch a redundant elevated status probe");
  assert.doesNotMatch(restartBody, /getStatusElevated/, "restart must not launch a redundant elevated status probe");
  assert.match(switchSnapshotBody, /getStatusElevated/, "switch must retain an authoritative pre-mutation snapshot");
  assert.doesNotMatch(switchSnapshotBody, /this\.manager\.getStatus\(/, "switch must not run an ordinary probe before the elevated snapshot");
  assert.match(panel, /refresh\(false, false\).*?60000/s, "background refresh must reuse cached status instead of forcing expensive IIS detection");
  assert.match(orchestrator, /restorePhysicalPath/, "switch rollback must support stopped orphaned source paths");
  assert.match(control, /'restore-path'/, "rollback action must be present in the pure control script");
  assert.match(control, /expectedCurrentPath/, "rollback must compare the exact expected current path");
  assert.match(control, /\[string\]\$siteSnapshot\.state -ne 'Stopped' -or \$currentPath -ne \$expectedCurrentPath/, "orphan rollback must reject running or changed sites");
  assert.match(orchestrator, /system\.acl\.correct !== true && system\.site\.started !== false/, "only stopped orphaned source paths may bypass old ACL preflight");
  assert.match(guide, /VITE_CAMERA_FTP_DOCS_URL/, "official docs link must remain configurable");
  assert.match(guide, /target="_blank"/, "official docs must open outside the app");
  for (const section of ["features", "service", "account", "site", "binding", "auth", "permissions", "passive", "firewall", "verification", "troubleshooting"]) {
    assert.match(guide, new RegExp(`id="${section}"`));
  }
  for (const step of ["启用或关闭 Windows 功能", "本地用户和组", "添加 FTP 站点", "FTP 身份验证", "FTP 授权规则", "高级安全 Windows Defender 防火墙"]) {
    assert.ok(guide.includes(step), `GUI guide must explain ${step}`);
  }
  assert.match(guide, /<details[^>]*>[\s\S]*?<summary[^>]*>高级：/, "PowerShell examples should be secondary");
  const bundled = require(path.join(root, "package.json")).build.extraResources.find((entry) => entry.from === "scripts/windows").filter;
  assert.deepEqual(bundled, ["iis-ftp-common.ps1", "iis-ftp-status.ps1", "iis-ftp-control.ps1"]);
  for (const retired of ["iis-ftp-setup.ps1", "iis-ftp-adopt.ps1", "iis-ftp-credentials.ps1"]) {
    assert.equal(fs.existsSync(path.join(root, "scripts/windows", retired)), false);
  }
  const parser = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `& { $errors = $null; foreach ($file in @('iis-ftp-common.ps1','iis-ftp-status.ps1','iis-ftp-control.ps1')) { [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path '${path.join(root, "scripts/windows").replace(/'/g, "''")}' $file), [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | Out-String | Write-Error; exit 1 } }; exit 0 }`], { encoding: "utf8", timeout: 30000 });
  if (parser.error) throw parser.error;
  assert.equal(parser.status, 0, parser.stderr || parser.stdout);
}

(async () => {
  testStatusMapping();
  testScriptBoundary();
  await testSwitchRollback();
  await testRetiredRoutes();
  console.log("camera FTP manual-mode contracts passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
