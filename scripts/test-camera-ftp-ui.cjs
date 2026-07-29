const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function findFile(directory, fileName) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(target, fileName);
      if (nested) return nested;
    } else if (entry.name === fileName) {
      return target;
    }
  }
  return "";
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-camera-ftp-ui-"));
  try {
    const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
    const compile = spawnSync(process.execPath, [tsc,
      path.join(root, "src", "components", "import", "cameraFtpUiState.ts"),
      path.join(root, "src", "lib", "api.ts"),
      "--outDir", tempRoot,
      "--target", "ES2020",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--lib", "ES2020,DOM",
      "--esModuleInterop",
      "--skipLibCheck"
    ], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(compile.status, 0, compile.stdout || compile.stderr);
    fs.writeFileSync(path.join(tempRoot, "package.json"), '{"type":"commonjs"}\n');
    const compiledModule = findFile(tempRoot, "cameraFtpUiState.js");
    assert.ok(compiledModule, "camera FTP UI state module must compile for the test harness");
    const ui = require(compiledModule);
    const compiledErrorPresentationModule = findFile(tempRoot, "cameraFtpErrorPresentation.js");
    assert.ok(compiledErrorPresentationModule, "camera FTP error presentation boundary must compile for the test harness");
    const errorPresentation = require(compiledErrorPresentationModule);
    const compiledApiModule = findFile(tempRoot, "api.js");
    assert.ok(compiledApiModule, "API response parser must compile for the test harness");
    const api = require(compiledApiModule);
    assert.strictEqual(
      ui.buildCameraFtpErrorPresentation,
      errorPresentation.buildCameraFtpErrorPresentation,
      "the legacy UI state facade must re-export the error presentation builder"
    );
    assert.strictEqual(
      ui.stageLabel,
      errorPresentation.stageLabel,
      "the legacy UI state facade must re-export stage labels from the dedicated boundary"
    );

    const baseStatus = {
      initialized: false,
      passwordConfigured: false,
      platform: { supported: true },
      activeEvent: { valid: true },
      site: { started: false }
    };
    const firstUse = ui.getCameraFtpButtonState({
      status: baseStatus,
      busy: false,
      selectedEvent: true,
      credentialFormValid: true,
      portFormValid: true,
      serviceReady: false
    });
    assert.equal(firstUse.configureAndStart, true);
    assert.equal(firstUse.start, false);
    assert.equal(firstUse.stop, false);
    assert.equal(firstUse.restart, false);
    assert.equal(firstUse.repair, false);
    assert.equal(firstUse.discoverSites, true);

    const configuredWithoutPassword = ui.getCameraFtpButtonState({
      status: { ...baseStatus, initialized: true },
      busy: false,
      selectedEvent: true,
      credentialFormValid: false,
      portFormValid: true,
      serviceReady: false
    });
    assert.equal(configuredWithoutPassword.start, false);
    assert.equal(configuredWithoutPassword.restart, false);
    assert.match(configuredWithoutPassword.passwordMessage, /密码/);

    const running = ui.getCameraFtpButtonState({
      status: {
        ...baseStatus,
        initialized: true,
        passwordConfigured: true,
        site: { started: true }
      },
      busy: false,
      selectedEvent: true,
      credentialFormValid: false,
      portFormValid: true,
      serviceReady: true
    });
    assert.equal(running.start, false);
    assert.equal(running.stop, true);
    assert.equal(running.restart, true);
    assert.equal(running.repair, true);

    const partialRunning = ui.getCameraFtpButtonState({
      status: {
        initialized: true,
        passwordConfigured: true,
        activeEvent: { valid: true },
        site: { started: null }
      },
      busy: false,
      selectedEvent: true,
      credentialFormValid: false,
      portFormValid: true,
      serviceReady: true
    });
    assert.equal(
      partialRunning.stop,
      true,
      "a verified managed listener must remain stoppable when ordinary inspection cannot read site.started"
    );

    const orphanedRunningSite = ui.getCameraFtpButtonState({
      status: {
        initialized: true,
        passwordConfigured: true,
        activeEvent: null,
        site: { started: null }
      },
      busy: false,
      selectedEvent: true,
      credentialFormValid: false,
      portFormValid: true,
      serviceReady: true
    });
    assert.equal(
      orphanedRunningSite.stop,
      true,
      "an owned running site must remain stoppable after its saved event is deleted"
    );
    assert.equal(
      orphanedRunningSite.restart,
      true,
      "an owned running site may be runtime-restarted after its saved event is deleted"
    );
    assert.equal(
      orphanedRunningSite.repair,
      false,
      "provisioning repair must still require a valid receive event"
    );

    const orphanedStoppedSite = ui.getCameraFtpButtonState({
      status: {
        initialized: true,
        passwordConfigured: true,
        activeEvent: null,
        site: { started: false }
      },
      busy: false,
      selectedEvent: true,
      credentialFormValid: false,
      portFormValid: true,
      serviceReady: false
    });
    assert.equal(orphanedStoppedSite.stop, false);
    assert.equal(
      orphanedStoppedSite.restart,
      false,
      "a stopped orphaned site must not be reactivated before choosing a valid receive event"
    );

    assert.equal(
      typeof ui.applyCameraFtpStatusObservation,
      "function",
      "camera FTP status observations must be reduced by a pure function"
    );
    assert.equal(
      ui.isCameraFtpRuntimeReady({
        initialized: true,
        site: { started: null },
        service: { running: true },
        port: { listening: true, ownedByMicrosoftFtp: true }
      }),
      true,
      "a managed IIS FTP listener must remain operational when ordinary permissions cannot read the site object"
    );
    assert.equal(
      ui.isCameraFtpRuntimeReady({
        initialized: true,
        site: { started: false },
        service: { running: true },
        port: { listening: true, ownedByMicrosoftFtp: true }
      }),
      false,
      "an explicit stopped-site observation must override listener inference"
    );
    assert.equal(
      ui.isCameraFtpRuntimeReady({
        initialized: true,
        site: { started: null },
        service: { running: false },
        port: { listening: true, ownedByMicrosoftFtp: true }
      }),
      false,
      "a stopped FTPSVC must never be presented as operational"
    );
    const fullInspectionAt = "2026-07-15T02:00:00.000Z";
    const ordinaryInspectionAt = "2026-07-15T02:01:00.000Z";
    const refreshedAt = "2026-07-15T02:02:00.000Z";
    const stalePollAt = "2026-07-15T02:00:30.000Z";
    const fullAdminStatus = {
      inspectionLevel: "full",
      site: { exists: true, started: true, physicalPath: "D:\\workspace\\old-full" },
      port: { listening: true, conflict: false },
      firewall: { correct: true },
      warnings: []
    };
    const partialOrdinaryStatus = {
      inspectionLevel: "partial",
      site: { exists: null, started: null, physicalPath: "" },
      port: { listening: null, conflict: null },
      firewall: { correct: null },
      warnings: ["ordinary inspection could not read IIS configuration"]
    };
    const initialInspectionState = { current: null, lastFullInspection: null };
    const afterAdminInspection = ui.applyCameraFtpStatusObservation(initialInspectionState, {
      source: "admin",
      status: fullAdminStatus,
      inspectedAt: fullInspectionAt,
      requestId: 1,
      latestRequestId: 1
    });
    assert.deepEqual(afterAdminInspection.current.status, fullAdminStatus);
    assert.deepEqual(afterAdminInspection.lastFullInspection.status, fullAdminStatus);

    const afterOrdinaryInspection = ui.applyCameraFtpStatusObservation(afterAdminInspection, {
      source: "ordinary",
      status: partialOrdinaryStatus,
      inspectedAt: ordinaryInspectionAt,
      requestId: 2,
      latestRequestId: 2
    });
    assert.deepEqual(
      afterOrdinaryInspection.current.status,
      partialOrdinaryStatus,
      "a new partial/unknown response is the current server fact and must not inherit old full values"
    );
    assert.equal(afterOrdinaryInspection.current.status.site.started, null);
    assert.equal(afterOrdinaryInspection.current.status.port.listening, null);
    assert.equal(afterOrdinaryInspection.current.status.firewall.correct, null);
    assert.deepEqual(
      afterOrdinaryInspection.lastFullInspection.status,
      fullAdminStatus,
      "the last administrator inspection remains a separate historical snapshot"
    );
    assert.equal(afterOrdinaryInspection.current.label, "当前普通检测");
    assert.equal(afterOrdinaryInspection.current.inspectedAt, ordinaryInspectionAt);
    assert.equal(afterOrdinaryInspection.lastFullInspection.label, "最近管理员完整检测");
    assert.equal(afterOrdinaryInspection.lastFullInspection.inspectedAt, fullInspectionAt);

    const refreshedPartialStatus = {
      ...partialOrdinaryStatus,
      site: { exists: true, started: false, physicalPath: "D:\\workspace\\current-refresh" },
      warnings: []
    };
    const afterRefresh = ui.applyCameraFtpStatusObservation(afterOrdinaryInspection, {
      source: "ordinary",
      status: refreshedPartialStatus,
      inspectedAt: refreshedAt,
      requestId: 4,
      latestRequestId: 4
    });
    const afterStalePoll = ui.applyCameraFtpStatusObservation(afterRefresh, {
      source: "ordinary",
      status: { ...fullAdminStatus, site: { ...fullAdminStatus.site, physicalPath: "D:\\workspace\\stale-poll" } },
      inspectedAt: stalePollAt,
      requestId: 3,
      latestRequestId: 4
    });
    assert.strictEqual(
      afterStalePoll,
      afterRefresh,
      "an older initial-load or polling response must not overwrite a newer refresh"
    );
    assert.deepEqual(afterStalePoll.current.status, refreshedPartialStatus);
    assert.equal(afterStalePoll.current.inspectedAt, refreshedAt);
    assert.equal(afterStalePoll.lastFullInspection.inspectedAt, fullInspectionAt);

    const adminOperationBase = {
      operationId: "22222222-2222-4222-8222-222222222222",
      scriptName: "iis-ftp-setup.ps1",
      phaseCount: 7,
      indeterminate: false,
      elapsedMs: 20_000,
      estimatedRemainingMinMs: 0,
      estimatedRemainingMaxMs: 120_000,
      estimateExceeded: false,
      safeToRetry: false
    };
    const advancedAdminOperation = {
      ...adminOperationBase,
      state: "running",
      stage: "configure_firewall",
      phaseIndex: 4,
      progressPercent: 70
    };
    const staleAdminOperation = {
      ...adminOperationBase,
      state: "running",
      stage: "uac_requested",
      phaseIndex: 0,
      progressPercent: 2,
      elapsedMs: 25_000
    };
    assert.deepEqual(
      ui.mergeCameraFtpAdminOperationObservation(advancedAdminOperation, staleAdminOperation),
      { ...advancedAdminOperation, elapsedMs: 25_000 },
      "late progress polling must not move the phase or percentage backwards"
    );
    const completedAdminOperation = {
      ...adminOperationBase,
      state: "completed",
      stage: "completed",
      phaseIndex: 6,
      progressPercent: 100,
      elapsedMs: 26_000,
      estimatedRemainingMinMs: null,
      estimatedRemainingMaxMs: null,
      safeToRetry: true
    };
    assert.strictEqual(
      ui.mergeCameraFtpAdminOperationObservation(completedAdminOperation, staleAdminOperation),
      completedAdminOperation,
      "a late running response must not replace completed progress in React state"
    );

    const validPorts = ui.validateCameraFtpPortSettings("2021", "50000", "50100");
    assert.equal(validPorts.valid, true);
    assert.equal(validPorts.controlPort, 2021);
    const overlappingPorts = ui.validateCameraFtpPortSettings("50000", "50000", "50100");
    assert.equal(overlappingPorts.valid, false);
    assert.match(overlappingPorts.passiveRangeError, /不能落入/);
    const invalidControlPort = ui.validateCameraFtpPortSettings("65536", "50000", "50100");
    assert.equal(invalidControlPort.valid, false);
    assert.match(invalidControlPort.controlPortError, /1–65535/);

    const progress = ui.getCameraFtpProvisioningProgress(2);
    assert.equal(progress.length, 7);
    assert.deepEqual(progress.map((phase) => phase.status), ["success", "success", "running", "pending", "pending", "pending", "pending"]);
    assert.match(progress[0].label, /系统环境/);
    assert.match(progress[6].label, /验证连接状态/);

    const issueGroups = ui.groupCameraFtpIssues([
      { id: "info", code: "PARTIAL", level: "info", title: "部分检测", message: "普通权限" },
      { id: "repair", code: "ACL", level: "auto_repair", title: "ACL", message: "可修复" },
      { id: "confirm", code: "PORT", level: "user_confirmation", title: "端口", message: "请选择" },
      { id: "blocked", code: "SITE", level: "blocked", title: "站点", message: "启动失败" }
    ]);
    assert.deepEqual(issueGroups.map((group) => group.level), ["info", "auto_repair", "user_confirmation", "blocked"]);
    assert.deepEqual(issueGroups.map((group) => group.label), ["信息提示", "可自动修复", "需要用户确认", "阻塞错误"]);

    const basePlan = {
      planId: "plan-1",
      target: "setup",
      summary: "配置计划",
      requiresAdmin: true,
      canApply: true,
      generatedAt: new Date().toISOString(),
      confirmations: [],
      issues: [],
      items: [{ id: "site", category: "site", label: "站点", summary: "创建站点", status: "create", managedResource: true, risk: "normal" }]
    };
    assert.equal(ui.cameraFtpPlanCanApply(basePlan), true);
    assert.equal(ui.cameraFtpPlanCanApply({
      ...basePlan,
      items: [{ ...basePlan.items[0], status: "blocked" }]
    }), false);
    assert.equal(ui.cameraFtpPlanCanApply({
      ...basePlan,
      issues: [{ id: "blocked", code: "EXTERNAL", level: "blocked", title: "外部冲突", message: "不可自动处理" }]
    }), false);

    const classifiedStatusIssues = ui.buildCameraFtpStatusIssues({
      inspectionLevel: "partial",
      controlPort: 21,
      acl: { correct: false, broadInheritedAccess: true },
      passivePorts: { correct: false },
      firewall: { correct: false },
      port: { conflict: true, recommendation: "请选择其他端口" },
      account: { conflict: false },
      conflicts: { pathConflict: true, items: [] },
      warnings: [],
      lastError: null
    });
    assert.ok(classifiedStatusIssues.some((issue) => issue.level === "info" && issue.code === "PARTIAL_INSPECTION"));
    assert.ok(classifiedStatusIssues.some((issue) => issue.level === "auto_repair" && issue.code === "FTP_ACL_REPAIR_REQUIRED"));
    assert.ok(classifiedStatusIssues.some((issue) => issue.level === "auto_repair" && issue.code === "FTP_PASSIVE_PORTS_REPAIR_REQUIRED"));
    assert.ok(classifiedStatusIssues.some((issue) => issue.level === "auto_repair" && issue.code === "FTP_FIREWALL_REPAIR_REQUIRED"));
    assert.ok(classifiedStatusIssues.some((issue) => issue.level === "user_confirmation" && issue.code === "FTP_CONTROL_PORT_IN_USE"));

    const uacCancelled = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: { code: "UAC_CANCELLED", message: "The operation was canceled by the user.", details: { stage: "uac_cancelled" } }
    });
    assert.equal(uacCancelled.tone, "warning");
    assert.equal(uacCancelled.code, "UAC_CANCELLED");
    assert.match(uacCancelled.title, /授权已取消/);
    assert.doesNotMatch(uacCancelled.body, /canceled|IIS_CONFIG_FAILED/i);

    const protectedTempFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "TEMP_ACL_FAILED",
        message: "Unable to create protected temporary directory.",
        rollbackStatus: "not_required",
        details: {
          operationId: "99999999-9999-4999-8999-999999999999",
          stage: "secure_temp_directory",
          rollbackAttempted: false,
          rollbackSucceeded: null,
          diagnostics: {
            safeToRetry: true,
            systemStateChanged: false,
            attempts: [
              { rootKind: "system_temp", step: "remove_inheritance", exitCode: 5 },
              { rootKind: "local_app_data", step: "create_directory" }
            ]
          }
        }
      }
    }, "Failed to initialize Windows IIS FTP.");
    assert.equal(protectedTempFailure.stage, "保护管理员临时目录");
    assert.equal(protectedTempFailure.rollbackAttempted, false);
    assert.equal(protectedTempFailure.rollbackSummary, "未修改系统，无需回滚");
    assert.match(protectedTempFailure.advice, /icacls\.exe/);
    assert.doesNotMatch(protectedTempFailure.technicalDetails, /unknown/);

    const secret = "Do-Not-Expose-This!42";
    const firewallFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FIREWALL_CONFIG_FAILED",
        message: "Firewall configuration failed.",
        details: {
          stage: "configure_firewall",
          operationId: "operation-test-1",
          exitCode: 8,
          technicalMessage: `password=${secret}`,
          rollbackAttempted: true,
          rollbackSucceeded: true
        }
      }
    });
    assert.match(firewallFailure.body, /防火墙/);
    assert.match(firewallFailure.stage, /防火墙/);
    assert.equal(firewallFailure.technicalDetails.includes(secret), false);
    assert.match(firewallFailure.technicalDetails, /已隐藏/);
    assert.match(firewallFailure.technicalDetails, /operation-test-1/);

    const structuredTopLevelFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_EVENT_SWITCH_FAILED",
        title: "无法切换接收活动",
        message: "legacy fallback message",
        impact: "当前活动保持不变，后续文件仍进入原活动。",
        nextAction: "确认没有上传任务后重试。",
        rollbackStatus: "partial",
        operationId: "operation-top-level-1",
        retryable: false,
        technicalDetails: `password=${secret}`,
        details: {
          stage: "verify_switched_state",
          operationId: "legacy-operation-id",
          rollbackAttempted: true,
          rollbackSucceeded: true,
          technicalMessage: "legacy technical details"
        }
      }
    });
    assert.equal(structuredTopLevelFailure.title, "无法切换接收活动");
    assert.equal(structuredTopLevelFailure.body, "当前活动保持不变，后续文件仍进入原活动。");
    assert.equal(structuredTopLevelFailure.advice, "确认没有上传任务后重试。");
    assert.equal(structuredTopLevelFailure.retryable, false);
    assert.equal(structuredTopLevelFailure.rollbackSucceeded, false, "top-level rollback status must win over legacy flags");
    assert.match(structuredTopLevelFailure.technicalDetails, /operation-top-level-1/);
    assert.doesNotMatch(structuredTopLevelFailure.technicalDetails, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(structuredTopLevelFailure.technicalDetails, /已隐藏/);

    const failedBeforeSnapshot = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_EVENT_NOT_FOUND",
        message: "FTP 接收活动不存在。",
        rollbackStatus: "success",
        details: {
          stage: "snapshot_current_state",
          rollbackAttempted: false,
          rollback: {
            attempted: false,
            status: "success",
            succeeded: true,
            items: []
          }
        }
      }
    });
    assert.equal(failedBeforeSnapshot.rollbackAttempted, false);
    assert.equal(failedBeforeSnapshot.rollbackSucceeded, undefined);
    assert.match(failedBeforeSnapshot.rollbackSummary, /无需回滚/);

    const adminRequiredNotice = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "ADMIN_REQUIRED",
        title: "需要管理员检测",
        message: "普通权限无法读取完整 IIS 状态。",
        retryable: true,
        details: { stage: "inspect_iis_site" }
      }
    });
    assert.equal(adminRequiredNotice.tone, "info");
    const unknownStateNotice = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_SERVICE_STATE_UNKNOWN",
        message: "当前无法确认服务状态。",
        retryable: false,
        details: { stage: "verify_configuration" }
      }
    });
    assert.equal(unknownStateNotice.tone, "info");
    assert.equal(unknownStateNotice.retryable, false);

    const elevatedTimeout = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      operationId: "api-timeout-operation-001",
      error: {
        code: "ELEVATED_SCRIPT_TIMEOUT",
        title: "管理员配置仍在执行或状态待确认",
        message: "等待达到上限",
        impact: "管理员进程已经启动，可能仍在修改 Windows 组件。",
        nextAction: "等待后台进程结束后重新检测。",
        rollbackStatus: "unknown",
        retryable: false,
        details: {
          childOperationId: "child-timeout-operation-001",
          scriptName: "iis-ftp-setup.ps1",
          stage: "enable_iis_features",
          rollbackAttempted: false,
          rollbackSucceeded: null,
          conflict: {
            elapsedMs: 1_200_000,
            processId: 4321,
            lastProgressAt: "2026-07-23T00:00:00.000Z",
            safeToRetry: false
          }
        }
      }
    });
    assert.equal(elevatedTimeout.retryable, false);
    assert.match(elevatedTimeout.stage, /启用 IIS FTP 组件/);
    assert.match(elevatedTimeout.rollbackSummary, /状态未知/);
    assert.match(elevatedTimeout.technicalDetails, /已等待：1200 秒/);
    assert.match(elevatedTimeout.technicalDetails, /管理员进程 PID：4321/);
    assert.match(elevatedTimeout.technicalDetails, /可安全重试：否/);

    const correlatedFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      operationId: "api-request-001",
      error: {
        code: "IIS_CONFIG_FAILED",
        message: "failed",
        operationId: "api-request-001",
        details: {
          stage: "verify_configuration",
          operationId: "api-request-001",
          parentOperationId: "api-request-001",
          childOperationId: "elevated-child-001"
        }
      }
    });
    assert.equal(correlatedFailure.operationId, "api-request-001");
    assert.equal(correlatedFailure.childOperationId, "elevated-child-001");
    assert.match(correlatedFailure.technicalDetails, /API 请求 operationId：api-request-001/);
    assert.match(correlatedFailure.technicalDetails, /提权子 operationId：elevated-child-001/);

    const duplicateOperationId = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "IIS_CONFIG_FAILED",
        message: "failed",
        operationId: "same-operation-001",
        details: { operationId: "same-operation-001", childOperationId: "same-operation-001" }
      }
    });
    assert.equal(duplicateOperationId.childOperationId, undefined);
    assert.equal((duplicateOperationId.technicalDetails.match(/same-operation-001/g) || []).length, 1);

    const compoundSecretFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "IIS_CONFIG_FAILED",
        title: `ftpPassword=${secret}`,
        message: "failed",
        impact: `access_token:${secret}`,
        nextAction: `cameraSecret=${secret}`,
        details: {
          stage: "verify_configuration",
          technicalMessage: `SecureStringValue=${secret}`,
          diagnostics: {
            accountPassword: secret,
            refreshToken: secret,
            cameraSecret: secret,
            physicalPath: "D:\\sensitive\\working\\event"
          }
        }
      }
    });
    const compoundSecretPresentation = [
      compoundSecretFailure.title,
      compoundSecretFailure.body,
      compoundSecretFailure.advice,
      compoundSecretFailure.technicalDetails
    ].join("\n");
    assert.equal(compoundSecretPresentation.includes(secret), false);
    assert.equal(compoundSecretPresentation.includes("D:\\sensitive"), false);
    assert.match(compoundSecretPresentation, /已隐藏/);
    assert.match(compoundSecretPresentation, /路径已隐藏/);

    const nestedSecret = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FIREWALL_CONFIG_FAILED",
        message: "failed",
        details: { stage: "configure_firewall", technicalMessage: `payload={"password":"${secret}"}` }
      }
    });
    assert.equal(nestedSecret.technicalDetails.includes(secret), false);
    assert.match(nestedSecret.technicalDetails, /已隐藏/);

    const ftpSiteStartFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "IIS_FTP_SITE_START_FAILED",
        message: "The IIS FTP site could not be started.",
        details: {
          stage: "start_ftp_site",
          technicalMessage: "Exception from HRESULT: 0x80070020",
          command: "ftpServer.Start",
          rollbackAttempted: true,
          rollbackSucceeded: false,
          warnings: ["IIS site rollback was incomplete."],
          conflict: {
            hresult: "0x80070020",
            ftpServiceState: "Running",
            stateBefore: "Stopped",
            stateAfter: "Stopped",
            sourceExceptionType: "System.Runtime.InteropServices.COMException"
          }
        }
      }
    });
    assert.match(ftpSiteStartFailure.body, /IIS FTP 站点启动失败/);
    assert.match(ftpSiteStartFailure.stage, /启动 IIS FTP 站点/);
    assert.match(ftpSiteStartFailure.advice, /不会启动或修改无关 IIS 站点/);
    assert.match(ftpSiteStartFailure.technicalDetails, /0x80070020/);
    assert.match(ftpSiteStartFailure.technicalDetails, /FTPSVC 状态：Running/);

    const granularVerificationFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_CONFIGURATION_VERIFICATION_FAILED",
        message: "The final elevated IIS FTP status did not pass all critical checks.",
        details: {
          stage: "verify_configuration",
          operationId: "operation-verification-1",
          diagnostics: {
            failedChecks: ["siteStarted", "listener", "firewall"],
            failedCodes: ["SITE_NOT_STARTED", "CONTROL_PORT_NOT_LISTENING", "FIREWALL_RULE_MISMATCH"],
            verificationChecks: [
              { id: "siteStarted", code: "SITE_NOT_STARTED", passed: false, expected: "Started", actual: "Stopped" }
            ]
          }
        }
      }
    });
    assert.match(granularVerificationFailure.body, /SITE_NOT_STARTED/);
    assert.match(granularVerificationFailure.body, /CONTROL_PORT_NOT_LISTENING/);
    assert.match(granularVerificationFailure.body, /FIREWALL_RULE_MISMATCH/);
    assert.match(granularVerificationFailure.advice, /具体失败项/);
    assert.match(granularVerificationFailure.technicalDetails, /operation-verification-1/);
    assert.match(ftpSiteStartFailure.technicalDetails, /回滚提示/);
    assert.equal(ftpSiteStartFailure.rollbackAttempted, true);
    assert.equal(ftpSiteStartFailure.rollbackSucceeded, false);

    const aclFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_ACL_ROLLBACK_VERIFY_FAILED",
        message: "ACL rollback did not match the original descriptor.",
        details: {
          stage: "configure_directory_acl",
          rollbackAttempted: true,
          rollbackSucceeded: false,
          failedStep: { id: "directoryAcl", status: "failed" },
          rollback: { status: "partial", items: [{ resource: "directoryAcl", verified: false }] },
          diagnostics: { canonical: false, protected: true, hresult: "0x80131501" }
        }
      }
    });
    assert.match(aclFailure.body, /回滚|安全描述符/);
    assert.match(aclFailure.advice, /非规范顺序|HRESULT/);
    assert.match(aclFailure.rollbackSummary, /未完全恢复/);
    assert.match(aclFailure.technicalDetails, /failedStep/);
    assert.match(aclFailure.technicalDetails, /0x80131501/);

    const adoptFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "IIS_SITE_ADOPTION_REQUIRED",
        message: "adoption required",
        details: { stage: "inspect_iis_sites", conflict: { siteName: "ExistingFtp", adoptable: true } }
      }
    });
    assert.equal(adoptFailure.adoptableSiteName, "ExistingFtp");

    const firewallConfirmation = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED",
        message: "Legacy local FTP firewall rules require explicit confirmation.",
        details: {
          stage: "preflight_firewall",
          conflict: {
            changes: [{
              kind: "control",
              current: { localPort: "21", remoteAddress: "192.168.137.0/255.255.255.0" },
              target: { localPort: "22", remoteAddress: "LocalSubnet" }
            }]
          }
        }
      }
    });
    assert.equal(firewallConfirmation.tone, "warning");
    assert.match(firewallConfirmation.title, /确认/);
    assert.match(firewallConfirmation.body, /尚未执行修改/);
    assert.match(firewallConfirmation.technicalDetails, /21.*22/);

    const policyBlocked = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FIREWALL_RULE_POLICY_BLOCKED",
        message: "Policy rule blocked.",
        details: { stage: "preflight_firewall", conflict: { policyStoreSourceType: "GroupPolicy" } }
      }
    });
    assert.equal(policyBlocked.tone, "danger");
    assert.match(policyBlocked.body, /策略/);

    const processConflict = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "PORT_USED_BY_OTHER_PROCESS",
        message: "internal english message",
        details: {
          stage: "preflight_port",
          conflict: { port: 21, pid: 4242, processName: "example-service", availablePorts: [2021, 2022] }
        }
      }
    });
    assert.match(processConflict.body, /其他程序/);
    assert.equal(processConflict.conflictPort, 21);
    assert.match(processConflict.conflictOwner, /example-service/);
    assert.deepEqual(processConflict.availablePorts, [2021, 2022]);

    const invalidOneDrivePath = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_PATH_INVALID",
        message: "The FTP physical path cannot be a reparse point.",
        details: { stage: "validate_configuration", exitCode: 2 }
      }
    });
    assert.match(invalidOneDrivePath.body, /接收目录/);
    assert.match(invalidOneDrivePath.advice, /OneDrive/);
    assert.doesNotMatch(invalidOneDrivePath.body, /reparse point/i);

    const activeEventSwitchFailure = ui.buildCameraFtpErrorPresentation({
      ok: false,
      data: null,
      error: {
        code: "FTP_SWITCH_VERIFY_FAILED",
        message: "internal switch failure",
        details: {
          operation: "active-event",
          operationId: "switch-operation-1",
          stage: "verify_switched_state",
          rollbackAttempted: true,
          rollbackSucceeded: true,
          rollback: { status: "success", succeeded: true, items: [] },
          diagnostics: {
            failedCodes: ["PHYSICAL_PATH_MISMATCH"],
            verificationChecks: [{ id: "physicalPath", passed: false }]
          }
        }
      }
    });
    assert.equal(activeEventSwitchFailure.title, "FTP 接收活动切换失败");
    assert.match(activeEventSwitchFailure.stage, /验证.*切换结果/);
    assert.match(activeEventSwitchFailure.body, /PHYSICAL_PATH_MISMATCH/);
    assert.match(activeEventSwitchFailure.rollbackSummary, /恢复/);
    assert.match(activeEventSwitchFailure.technicalDetails, /switch-operation-1/);

    assert.match(
      ui.localizeCameraFtpUiWarning("IIS site configuration could not be read without elevated access."),
      /普通权限/
    );
    assert.doesNotMatch(
      ui.localizeCameraFtpUiWarning("The FTP root inherits write-capable access for broad Windows principals."),
      /inherits|principals/i
    );

    const panelSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "CameraFtpImportPanel.tsx"),
      "utf8"
    );
    const uiStateSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "cameraFtpUiState.ts"),
      "utf8"
    );
    const errorPresentationSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "camera-ftp", "cameraFtpErrorPresentation.ts"),
      "utf8"
    );
    const recentFilesSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "camera-ftp", "CameraFtpRecentFiles.tsx"),
      "utf8"
    );
    const provisioningFeedbackSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "camera-ftp", "CameraFtpProvisioningFeedback.tsx"),
      "utf8"
    );
    const diagnosticErrorCardSource = fs.readFileSync(
      path.join(root, "src", "components", "import", "camera-ftp", "CameraFtpDiagnosticErrorCard.tsx"),
      "utf8"
    );
    const apiSource = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
    const confirmDialogSource = fs.readFileSync(path.join(root, "src", "components", "ui", "ConfirmDialog.tsx"), "utf8");
    assert.match(uiStateSource, /export type \{ CameraFtpErrorPresentation \} from "\.\/camera-ftp\/cameraFtpErrorPresentation";/);
    assert.match(uiStateSource, /export \{[\s\S]*buildCameraFtpErrorPresentation,[\s\S]*stageLabel[\s\S]*\} from "\.\/camera-ftp\/cameraFtpErrorPresentation";/);
    assert.doesNotMatch(uiStateSource, /const STAGE_LABELS|const STAGE_ADVICE|function redactTechnicalText|function buildCameraFtpErrorPresentation/);
    assert.match(errorPresentationSource, /const STAGE_LABELS/);
    assert.match(errorPresentationSource, /const STAGE_ADVICE/);
    assert.match(errorPresentationSource, /function redactTechnicalText/);
    assert.match(errorPresentationSource, /export function buildCameraFtpErrorPresentation/);
    const loadPageStart = panelSource.indexOf("const loadPage =");
    const refreshStatusStart = panelSource.indexOf("const refreshStatus =", loadPageStart);
    assert.ok(loadPageStart >= 0 && refreshStatusStart > loadPageStart, "camera FTP page load and refresh functions must remain inspectable");
    const loadPageSource = panelSource.slice(loadPageStart, refreshStatusStart);
    assert.match(loadPageSource, /statusRequestSequence\.current/, "initial load must share the status request sequence used by polling and refresh");
    assert.match(loadPageSource, /requestId/, "initial load responses must be rejected when a newer status request has started");
    assert.match(panelSource, /管理员诊断（只读）/);
    assert.match(panelSource, /配置并启动 FTP/);
    assert.match(panelSource, /自动配置并启动 FTP/);
    assert.match(
      panelSource,
      /const runtimeOnlyRestart = kind === "restart" && !activeEvent/,
      "an orphaned runtime restart must not present a provisioning plan for a newly selected event"
    );
    assert.match(panelSource, /本次只重启工作台管理的 IIS FTP 站点/);
    assert.doesNotMatch(panelSource, /自动修复并启动 FTP/);
    assert.match(panelSource, /相机 FTP 已启动/);
    assert.match(panelSource, /最近有相机连接/);
    assert.match(panelSource, /不代表相机仍保持在线/);
    assert.match(panelSource, /实时连接数[\s\S]*无法可靠获取/);
    assert.match(panelSource, /相机连接参数/);
    assert.doesNotMatch(panelSource, /Nikon 相机连接参数/);
    assert.match(panelSource, /已通过 Nikon Z6III 真机验证/);
    assert.match(panelSource, /CameraFtpRecentFiles/);
    assert.match(recentFilesSource, /label: "导入成功"/);
    assert.match(recentFilesSource, /label: "重复跳过"/);
    assert.match(recentFilesSource, /label: "等待稳定"/);
    assert.match(recentFilesSource, /record\.status === "failed" \? record\.error \|\| record\.reason : ""/);
    assert.match(recentFilesSource, /RecentStatChip/);
    assert.match(recentFilesSource, /max-h-\[420px\]/);
    assert.doesNotMatch(panelSource, /title="最近接收与自动导入"/);
    assert.match(panelSource, /FTP 设置（按需展开）/);
    assert.match(panelSource, /FTP 密码已设置/);
    assert.match(panelSource, /只记住“已设置”状态，不读取或回显真实密码/);
    assert.match(panelSource, /修改账户或密码/);
    assert.match(panelSource, /真实密码仅在本次编辑期间保存在当前页面内存中/);
    assert.doesNotMatch(panelSource, /刷新页面后为空/);
    assert.match(panelSource, /使用推荐端口/);
    assert.match(panelSource, /fullInspection:\s*showFeedback/);
    assert.match(panelSource, /需管理员确认/);
    assert.match(panelSource, /已绑定但未启动的 IIS FTP 站点/);
    assert.match(panelSource, /高级：被动端口范围/);
    assert.match(panelSource, /whitespace-normal break-words/);
    assert.match(panelSource, /网络连接已自动适配/);
    assert.match(panelSource, /adoptionSites\.map/);
    assert.match(panelSource, /高级：手动输入站点名/);
    assert.match(panelSource, /finally\s*\{\s*setActiveAction\(null\)/);
    assert.match(panelSource, /lastFailedDiscovery[\s\S]*handleDiscoverSites/);
    assert.match(panelSource, /确认更新旧 FTP 防火墙规则/);
    assert.match(panelSource, /allowLegacyFirewallRuleUpdate:\s*action\.allowLegacyFirewallRuleUpdate === true/);
    assert.match(panelSource, /更新弹窗列出的本地旧规则/);
    assert.match(panelSource, /失败保护/);
    assert.match(panelSource, /prepareCameraFtpProvisioning/);
    assert.match(panelSource, /cameraFtpPlanCanApply/);
    assert.match(panelSource, /CameraFtpProvisioningPlanSummary/);
    assert.match(panelSource, /CameraFtpProvisioningProgress/);
    assert.match(panelSource, /fetchCameraFtpAdminOperation/);
    assert.match(panelSource, /}, 1000\);/, "admin operation progress must poll once per second");
    assert.doesNotMatch(panelSource, /}, 1400\);/, "provisioning progress must not use the former simulated timer");
    assert.match(panelSource, /adminOperationBlocking/);
    assert.match(panelSource, /adminOperation\?\.safeToRetry === false/);
    assert.match(panelSource, /CameraFtpIssueCenter/);
    assert.match(provisioningFeedbackSource, /查看全部配置项/);
    assert.match(provisioningFeedbackSource, /查看普通信息与自动修复项/);
    assert.match(provisioningFeedbackSource, /max-h-52[\s\S]*overflow-y-auto/);
    assert.match(provisioningFeedbackSource, /已等待/);
    assert.match(provisioningFeedbackSource, /预计约/);
    assert.match(provisioningFeedbackSource, /比通常耗时更长，Windows 仍在处理/);
    assert.match(provisioningFeedbackSource, /aria-valuemax=\{100\}/);
    assert.match(provisioningFeedbackSource, /aria-valuemin=\{0\}/);
    assert.match(provisioningFeedbackSource, /aria-valuenow=\{operation\?\.indeterminate \? undefined : progressPercent\}/);
    assert.match(provisioningFeedbackSource, /暂时无法准确估计/);
    assert.doesNotMatch(panelSource, /mergePartialCameraFtpStatus|preserveUnknown/, "old full fields must never be merged into a newer partial status");
    assert.match(panelSource, /applyCameraFtpStatusObservation/);
    assert.match(panelSource, /lastFullInspection/);
    assert.match(panelSource, /当前普通检测/);
    assert.match(panelSource, /最近管理员完整检测/);
    assert.match(panelSource, /operationInProgressRef/);
    assert.match(panelSource, /statusPollInFlightRef/);
    assert.match(panelSource, /}, 15000\);/, "background status polling must not continuously queue full IIS probes");
    assert.match(panelSource, /isCameraFtpRuntimeReady\(status\)/);
    assert.match(panelSource, /border-red-200 bg-white[\s\S]*text-red-700[\s\S]*停止 FTP/,
      "the primary stop action must use a restrained red border and text treatment");
    assert.match(panelSource, /<ActionButton danger disabled=\{!buttonState\.stop\}/,
      "the advanced stop action must reuse the danger button treatment");
    assert.match(panelSource, /applyDuringOperation/);
    assert.match(panelSource, /待切换，尚未生效/);
    assert.match(panelSource, /正在切换到/);
    assert.match(panelSource, /action\.kind === "repair"[\s\S]*action\.useCredentialForm/);
    assert.match(diagnosticErrorCardSource, /自动回滚/);
    assert.match(diagnosticErrorCardSource, /接管现有站点/);
    assert.match(diagnosticErrorCardSource, /请求操作 ID/);
    assert.match(diagnosticErrorCardSource, /提权子操作 ID/);
    assert.match(diagnosticErrorCardSource, /<details[\s\S]*技术详情（已脱敏）[\s\S]*diagnostic\.technicalDetails/);
    assert.match(diagnosticErrorCardSource, /diagnostic\.retryable && onRetry/);
    assert.match(panelSource, /onRetry=\{message\.diagnostic\.retryable/);
    assert.match(panelSource, /message\?\.diagnostic\?\.code === "UAC_CANCELLED"/);
    assert.match(panelSource, /void requestAction\(action\.kind, action\.siteName\)/);
    assert.match(apiSource, /\/api\/camera-ftp\/\$\{path\}/);
    assert.match(apiSource, /"provisioning-plan"/);
    assert.match(apiSource, /CameraFtpProvisioningPlanItemStatus/);
    assert.match(apiSource, /export interface CameraFtpAdminOperationData/);
    assert.match(apiSource, /\/api\/camera-ftp\/admin-operation/);
    assert.match(apiSource, /export interface ApiError[\s\S]*rollbackStatus\?: string;[\s\S]*technicalDetails\?: string;/);
    assert.match(apiSource, /title: looksLikeHtml \? "接口路由异常" : "接口响应异常"/);
    assert.match(apiSource, /repairCameraFtp\(input: \{ password\?: string/);
    assert.match(confirmDialogSource, /max-h-\[calc\(100dvh-1\.5rem\)\]/);
    assert.match(confirmDialogSource, /min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto/);
    assert.match(confirmDialogSource, /shrink-0 flex-wrap justify-end/);

    const malformedJson = await api.parseApiResponse(new Response('{"ok":', {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "X-Operation-Id": "malformed-json-operation-001"
      }
    }));
    assert.equal(malformedJson.ok, false);
    assert.equal(malformedJson.error.code, "HTTP_INVALID_JSON_RESPONSE");
    assert.equal(malformedJson.operationId, "malformed-json-operation-001");
    assert.equal(malformedJson.error.operationId, "malformed-json-operation-001");

    const falseHttpSuccess = await api.parseApiResponse(new Response(JSON.stringify({
      ok: true,
      data: { changed: true },
      error: null
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "X-Operation-Id": "status-mismatch-operation-001"
      }
    }));
    assert.equal(falseHttpSuccess.ok, false);
    assert.equal(falseHttpSuccess.error.code, "HTTP_STATUS_ENVELOPE_MISMATCH");
    assert.equal(falseHttpSuccess.operationId, "status-mismatch-operation-001");

    const invalidEnvelope = await api.parseApiResponse(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    assert.equal(invalidEnvelope.ok, false);
    assert.equal(invalidEnvelope.error.code, "HTTP_INVALID_JSON_ENVELOPE");

    console.log(JSON.stringify({
      suite: "cameraFtpUiState",
      passed: [
        "first_use_button_rules",
        "configured_service_button_rules",
        "control_and_passive_port_validation",
        "seven_phase_provisioning_progress",
        "four_level_issue_classification",
        "blocked_plan_prevents_apply",
        "status_issue_classification",
        "partial_port_inspection_not_reported_available",
        "explicit_port_inspection_requests_uac",
        "port_conflict_localization_and_suggestions",
        "password_required_state",
        "uac_cancel_localization",
        "structured_top_level_error_with_legacy_compatibility",
        "admin_required_and_unknown_state_use_neutral_tone",
        "non_retryable_error_hides_retry_action",
        "elevated_timeout_real_stage_and_retry_lock",
        "structured_stage_error",
        "onedrive_path_error_localization",
        "technical_detail_redaction",
        "nested_json_secret_redaction",
        "compound_secret_keys_and_local_paths_are_redacted",
        "parent_and_child_operation_ids_are_presented",
        "malformed_json_preserves_operation_id",
        "http_status_and_envelope_mismatch_cannot_report_success",
        "invalid_json_envelope_is_rejected",
        "legacy_firewall_rule_risk_confirmation",
        "policy_firewall_rule_blocking",
        "ftp_site_start_failure_diagnostics",
        "acl_failure_and_verified_rollback_diagnostics",
        "granular_final_verification_failures",
        "active_event_switch_granular_stage_and_rollback",
        "rollback_result_and_adoption_action",
        "warning_localization",
        "readonly_admin_discovery_before_manual_fallback",
        "automatic_resolution_primary_action",
        "button_label_visibility",
        "network_address_auto_adaptation",
        "operation_lock_release_and_retry",
        "retry_rebuilds_provisioning_plan",
        "collapsible_plan_and_issue_lists",
        "small_window_dialog_scroll_contract",
        "repair_password_dependency",
        "current_and_admin_status_are_separate",
        "partial_unknown_is_not_backfilled_from_full",
        "stale_initial_load_and_poll_results_are_ignored",
        "inspection_snapshot_labels_and_times_are_independent",
        "initial_load_and_poll_share_request_sequence",
        "running_state_visual_priority",
        "camera_activity_is_explicitly_inferred",
        "recent_record_semantic_colors",
        "compact_recent_file_layout",
        "configured_password_state_without_secret_echo",
        "generic_camera_copy_and_labels",
        "error_presentation_boundary_facade"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
