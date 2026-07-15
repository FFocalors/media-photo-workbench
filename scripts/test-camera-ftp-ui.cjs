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

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-camera-ftp-ui-"));
  try {
    const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
    const compile = spawnSync(process.execPath, [tsc,
      path.join(root, "src", "components", "import", "cameraFtpUiState.ts"),
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
    const apiSource = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
    const confirmDialogSource = fs.readFileSync(path.join(root, "src", "components", "ui", "ConfirmDialog.tsx"), "utf8");
    assert.match(panelSource, /管理员诊断（只读）/);
    assert.match(panelSource, /配置并启动 FTP/);
    assert.match(panelSource, /自动配置并启动 FTP/);
    assert.doesNotMatch(panelSource, /自动修复并启动 FTP/);
    assert.match(panelSource, /相机 FTP 已启动/);
    assert.match(panelSource, /最近有相机连接/);
    assert.match(panelSource, /不代表相机仍保持在线/);
    assert.match(panelSource, /实时连接数[\s\S]*无法可靠获取/);
    assert.match(panelSource, /相机连接参数/);
    assert.doesNotMatch(panelSource, /Nikon 相机连接参数/);
    assert.match(panelSource, /已通过 Nikon Z6III 真机验证/);
    assert.match(panelSource, /label: "导入成功"/);
    assert.match(panelSource, /label: "重复跳过"/);
    assert.match(panelSource, /label: "等待稳定"/);
    assert.match(panelSource, /record\.status === "failed" \? record\.error \|\| record\.reason : ""/);
    assert.match(panelSource, /RecentStatChip/);
    assert.match(panelSource, /max-h-\[420px\]/);
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
    assert.match(panelSource, /CameraFtpIssueCenter/);
    assert.match(panelSource, /查看全部配置项/);
    assert.match(panelSource, /查看普通信息与自动修复项/);
    assert.match(panelSource, /max-h-52[\s\S]*overflow-y-auto/);
    assert.match(panelSource, /mergePartialCameraFtpStatus/);
    assert.match(panelSource, /operationInProgressRef/);
    assert.match(panelSource, /applyDuringOperation/);
    assert.match(panelSource, /待切换，尚未生效/);
    assert.match(panelSource, /正在切换到/);
    assert.match(panelSource, /action\.kind === "repair"[\s\S]*action\.useCredentialForm/);
    assert.match(panelSource, /自动回滚/);
    assert.match(panelSource, /接管现有站点/);
    assert.match(panelSource, /message\?\.diagnostic\?\.code === "UAC_CANCELLED"/);
    assert.match(panelSource, /void requestAction\(action\.kind, action\.siteName\)/);
    assert.match(apiSource, /\/api\/camera-ftp\/\$\{path\}/);
    assert.match(apiSource, /"provisioning-plan"/);
    assert.match(apiSource, /CameraFtpProvisioningPlanItemStatus/);
    assert.match(apiSource, /repairCameraFtp\(input: \{ password\?: string/);
    assert.match(confirmDialogSource, /max-h-\[calc\(100dvh-1\.5rem\)\]/);
    assert.match(confirmDialogSource, /min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto/);
    assert.match(confirmDialogSource, /shrink-0 flex-wrap justify-end/);

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
        "structured_stage_error",
        "onedrive_path_error_localization",
        "technical_detail_redaction",
        "nested_json_secret_redaction",
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
        "partial_poll_preserves_admin_evidence",
        "running_state_visual_priority",
        "camera_activity_is_explicitly_inferred",
        "recent_record_semantic_colors",
        "compact_recent_file_layout",
        "configured_password_state_without_secret_echo",
        "generic_camera_copy_and_labels"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
