import { type Request, Router } from "express";
import { requireHostOnly } from "../middleware/hostOnly";
import { getCameraFtpOrchestrator } from "../services/cameraFtpOrchestrator";
import {
  buildCameraFtpDiagnosticSnapshot,
  getLastCameraFtpOperation,
  recordCameraFtpOperation
} from "../services/cameraFtpDiagnostics";
import { getConfig } from "../config/config";
import { getLogger } from "../utils/logger";
import { getCurrentOperationId } from "../utils/operationContext";
import { getElevatedAdminOperationStatus } from "../utils/elevatedPowerShell";
import { sendError, sendSuccess } from "../utils/response";

const router = Router();
const orchestrator = getCameraFtpOrchestrator();

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function errorStatus(code: string): number {
  if (["FTP_EVENT_NOT_FOUND", "IIS_SITE_NOT_FOUND", "FTP_ACCOUNT_NOT_FOUND"].includes(code)) return 404;
  if ([
    "FTP_UPLOAD_IN_PROGRESS",
    "CAMERA_FTP_SWITCH_IN_PROGRESS",
    "IIS_SITE_CONFLICT",
    "IIS_SITE_ADOPTION_REQUIRED",
    "FTP_CONTROL_PORT_IN_USE",
    "FTP_CONTROL_PORT_RESERVED",
    "IIS_SITE_PORT_CONFLICT",
    "PORT_USED_BY_OTHER_PROCESS",
    "NO_AVAILABLE_FTP_PORT",
    "FTP_ACCOUNT_CONFLICT",
    "FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED",
    "FIREWALL_RULE_POLICY_BLOCKED",
    "CAMERA_FTP_CONFIG_MISMATCH",
    "FTP_CONFIGURATION_VERIFICATION_FAILED",
    "IIS_FTP_FEATURE_MISSING",
    "FTP_SERVICE_NOT_FOUND",
    "FTP_SERVICE_NOT_RUNNING",
    "MANAGED_SITE_ID_MISMATCH",
    "SITE_NOT_STARTED",
    "SITE_BINDING_MISMATCH",
    "PHYSICAL_PATH_MISMATCH",
    "IIS_AUTH_CONFIGURATION_MISMATCH",
    "FTP_AUTHORIZATION_MISMATCH",
    "FTP_ACCOUNT_STATE_MISMATCH",
    "FTP_ACCOUNT_PASSWORD_UPDATE_FAILED",
    "FTP_ACCOUNT_PERMISSION_FAILED",
    "FTP_DIRECTORY_ACL_NONCANONICAL",
    "FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH",
    "PASSIVE_PORT_MISMATCH",
    "FIREWALL_RULE_MISMATCH",
    "CONTROL_PORT_NOT_LISTENING",
    "CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH",
    "ACTIVE_EVENT_ID_MISMATCH",
    "CAMERA_FTP_CONFIG_SAVE_MISMATCH",
    "CAMERA_FTP_WATCHER_NOT_RUNNING",
    "CAMERA_FTP_WATCHER_TARGET_MISMATCH",
    "CAMERA_FTP_NODE_STATE_MISMATCH",
    "FTP_EVENT_SWITCH_FAILED",
    "FTP_SITE_STOP_FAILED",
    "FTP_TARGET_ACL_UPDATE_FAILED",
    "FTP_PHYSICAL_PATH_UPDATE_FAILED",
    "FTP_WATCHER_SWITCH_FAILED",
    "FTP_SITE_RESTART_FAILED",
    "FTP_SWITCH_VERIFY_FAILED",
    "FTP_SWITCH_ROLLBACK_FAILED",
    "FTP_ACTIVE_EVENT_STATE_MISMATCH",
    "WINDOWS_RESTART_REQUIRED",
    "IIS_COMPONENT_INSTALL_INCOMPLETE",
    "IIS_CONFIGURATION_NOT_READY",
    "IIS_MANAGEMENT_API_NOT_READY",
    "IIS_DEPENDENCY_SERVICE_START_FAILED",
    "IIS_FTP_SERVICE_PENDING_TIMEOUT",
    "IIS_SYSTEM_CONFIGURATION_DAMAGED",
    "IIS_SHARED_FTP_SERVICE_CONFIRMATION_REQUIRED",
    "ELEVATED_SCRIPT_TIMEOUT",
    "ELEVATED_STATE_UNKNOWN",
    "FTP_SERVICE_MUST_BE_STOPPED",
    "FTP_SERVICE_STATE_UNKNOWN",
    "FTP_SETUP_REQUIRED"
  ].includes(code)) return 409;
  if (["ADMIN_REQUIRED", "UAC_CANCELLED", "HOST_ONLY_OPERATION"].includes(code)) return 403;
  if (code === "UNSUPPORTED_PLATFORM") return 400;
  return 400;
}

// The detailed status contains host paths, local account metadata and recent
// filenames, so the whole camera FTP management namespace is host-only.
router.use((req, res, next) => {
  requireHostOnly(req, res, next);
});

router.use((req, res, next) => {
  const operationId = getCurrentOperationId();
  res.on("finish", () => {
    const errorCode = typeof res.locals.cameraFtpErrorCode === "string"
      ? res.locals.cameraFtpErrorCode
      : null;
    // Successful polling is an observation, not the last meaningful FTP
    // operation. Observation failures remain useful and are retained.
    if (operationId && shouldRecordCameraFtpOperation(req.method, req.path, errorCode)) {
      recordCameraFtpOperation(operationId, typeof res.locals.cameraFtpErrorCode === "string"
        ? res.locals.cameraFtpErrorCode
        : null);
    }
  });
  next();
});

export function shouldRecordCameraFtpOperation(method: string, requestPath: string, errorCode: string | null): boolean {
  const isObservationRequest = method.toUpperCase() === "GET"
    && (requestPath === "/status" || requestPath === "/diagnostics" || requestPath === "/admin-operation");
  return !isObservationRequest || Boolean(errorCode);
}

function firstErrorText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/("?[\w.-]*(?:password|passphrase|secret|token|securestring|credential)[\w.-]*"?\s*[=:：]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/[A-Za-z]:\\+[^\r\n"',;}]+/g, "[redacted-path]")
    .replace(/\\\\+[^\r\n"',;}]+/g, "[redacted-path]");
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /(?:password|passphrase|secret|token|securestring|credential)/i.test(key);
}

function isPathDiagnosticKey(key: string): boolean {
  return /(?:path|directory|folder|filename)/i.test(key);
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[truncated]";
  if (typeof value === "string") return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    isSensitiveDiagnosticKey(key)
      ? "[redacted]"
      : isPathDiagnosticKey(key)
        ? "[redacted-path]"
      : sanitizeDiagnosticValue(item, depth + 1)
  ]));
}

function sendCameraFtpValidationError(
  res: any,
  code: string,
  message: string,
  nextAction: string
): void {
  res.locals.cameraFtpErrorCode = code;
  sendError(res, code, message, 400, undefined, buildCameraFtpValidationErrorMetadata(message, nextAction));
}

export function buildCameraFtpValidationErrorMetadata(message: string, nextAction: string) {
  return {
    title: message,
    impact: "尚未执行任何 Windows、IIS、账户、目录权限或防火墙修改。",
    nextAction,
    rollbackStatus: "not_required",
    operationId: getCurrentOperationId(),
    retryable: true
  };
}

function handleError(res: any, error: any, fallbackCode: string, fallbackMessage: string): void {
  const code = typeof error?.code === "string" ? error.code : fallbackCode;
  res.locals.cameraFtpErrorCode = code;
  const requestOperationId = getCurrentOperationId();
  const message = redactDiagnosticText(
    typeof error?.message === "string" && error.message ? error.message : fallbackMessage
  );
  const source = error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : null;
  const operationData = source?.data && typeof source.data === "object" ? source.data : null;
  const diagnosticDetails = source?.details && typeof source.details === "object"
    ? sanitizeDiagnosticValue(source.details) as Record<string, unknown>
    : undefined;
  const sanitizedOperationData = operationData
    ? sanitizeDiagnosticValue(operationData) as Record<string, any>
    : undefined;
  const legacyDetails = error?.details && typeof error.details === "object"
    ? sanitizeDiagnosticValue(error.details) as Record<string, unknown>
    : undefined;
  const sourceOperationId = typeof source?.operationId === "string" ? source.operationId : undefined;
  const details = source ? {
    operationId: requestOperationId || sourceOperationId,
    childOperationId: sourceOperationId && sourceOperationId !== requestOperationId ? sourceOperationId : undefined,
    parentOperationId: typeof source.parentOperationId === "string" ? source.parentOperationId : undefined,
    operation: typeof source.operation === "string" ? source.operation : undefined,
    scriptName: typeof source.scriptName === "string" ? source.scriptName : undefined,
    stage: typeof source.stage === "string" ? source.stage : undefined,
    technicalMessage: typeof source.technicalMessage === "string" ? redactDiagnosticText(source.technicalMessage) : undefined,
    exceptionType: typeof source.exceptionType === "string" ? source.exceptionType : undefined,
    command: typeof source.command === "string" ? redactDiagnosticText(source.command) : undefined,
    siteName: typeof source.siteName === "string" ? source.siteName : undefined,
    rollbackAttempted: typeof source.rollbackAttempted === "boolean" ? source.rollbackAttempted : undefined,
    rollbackSucceeded: typeof source.rollbackSucceeded === "boolean" || source.rollbackSucceeded === null ? source.rollbackSucceeded : undefined,
    exitCode: typeof source.exitCode === "number" ? source.exitCode : undefined,
    timestamp: typeof source.timestamp === "string" ? source.timestamp : undefined,
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map((item: unknown) => typeof item === "string"
        ? redactDiagnosticText(item)
        : item && typeof item === "object" && typeof (item as any).message === "string"
          ? redactDiagnosticText((item as any).message)
          : "").filter(Boolean)
      : undefined,
    // `conflict` remains for backward-compatible UI actions. The explicitly
    // named fields preserve the full, sanitized transaction report.
    conflict: diagnosticDetails,
    diagnostics: diagnosticDetails,
    completedSteps: Array.isArray(sanitizedOperationData?.completedSteps)
      ? sanitizedOperationData.completedSteps
      : Array.isArray(sanitizedOperationData?.steps)
        ? sanitizedOperationData.steps
        : undefined,
    failedStep: sanitizedOperationData?.failedStep && typeof sanitizedOperationData.failedStep === "object" ? sanitizedOperationData.failedStep : undefined,
    rollback: sanitizedOperationData?.rollback && typeof sanitizedOperationData.rollback === "object" ? sanitizedOperationData.rollback : undefined,
    preflight: sanitizedOperationData?.preflight && typeof sanitizedOperationData.preflight === "object" ? sanitizedOperationData.preflight : undefined,
    provisioningPlan: sanitizedOperationData?.plan && typeof sanitizedOperationData.plan === "object" ? sanitizedOperationData.plan : undefined
  } : legacyDetails
    ? { ...legacyDetails, conflict: legacyDetails, diagnostics: legacyDetails }
    : undefined;
  const rollbackData = operationData?.rollback && typeof operationData.rollback === "object" ? operationData.rollback : null;
  const elevatedStateUncertain = ["ELEVATED_SCRIPT_TIMEOUT", "ELEVATED_STATE_UNKNOWN"].includes(code);
  const rollbackAttempted = typeof source?.rollbackAttempted === "boolean"
    ? source.rollbackAttempted
    : typeof rollbackData?.attempted === "boolean"
      ? rollbackData.attempted
      : undefined;
  const rollbackStatus = elevatedStateUncertain
    ? "unknown"
    : rollbackAttempted === false
      ? "not_required"
      : firstErrorText(
          error?.rollbackStatus,
          source?.rollbackStatus,
          rollbackData?.status
        ) || (source?.rollbackSucceeded === true
          ? "success"
          : source?.rollbackSucceeded === false
            ? "failed"
            : undefined);
  const structuredTechnicalDetails = firstErrorText(
    error?.technicalDetails,
    source?.technicalDetails,
    details?.technicalMessage
  );
  const structuredImpact = firstErrorText(error?.impact, source?.impact);
  const structuredNextAction = firstErrorText(error?.nextAction, source?.nextAction, source?.advice);
  const structuredError = {
    title: redactDiagnosticText(firstErrorText(
      error?.title,
      source?.title,
      elevatedStateUncertain ? "管理员配置仍在执行或状态待确认" : fallbackMessage
    ) || fallbackMessage),
    impact: redactDiagnosticText(structuredImpact || (elevatedStateUncertain
      ? "管理员进程已经启动，可能仍在修改 Windows 组件。工作台不会强制结束它，也不会把等待超时当作配置失败或重启理由。"
      : "本次操作未得到成功确认；任何不完整变更都不会被视为成功。")),
    nextAction: redactDiagnosticText(structuredNextAction || (elevatedStateUncertain
      ? "请保持工作台运行并等待当前阶段结束；只有进度状态确认可以安全重试后，才能重新检测并生成新的配置计划。"
      : "请根据失败阶段检查后重试；若回滚状态不明确，请先查看技术详情。")),
    rollbackStatus: rollbackStatus || "unknown",
    operationId: firstErrorText(requestOperationId, error?.operationId, source?.operationId, details?.operationId),
    retryable: typeof error?.retryable === "boolean"
      ? error.retryable
      : typeof source?.retryable === "boolean"
        ? source.retryable
        : !["ELEVATED_SCRIPT_TIMEOUT", "ELEVATED_STATE_UNKNOWN"].includes(code),
    technicalDetails: structuredTechnicalDetails ? redactDiagnosticText(structuredTechnicalDetails) : undefined
  };
  if (!error?.code) {
    getLogger().error({
      code,
      stage: details?.stage,
      operationId: structuredError.operationId,
      exceptionType: typeof error?.name === "string" ? error.name : typeof error
    }, fallbackMessage);
    sendError(res, code, message, 500, details, structuredError);
    return;
  }
  getLogger().warn({ code, stage: details?.stage, operationId: structuredError.operationId }, fallbackMessage);
  sendError(res, code, message, errorStatus(code), details, structuredError);
}

router.get("/status", async (req, res) => {
  try {
    sendSuccess(res, await orchestrator.getStatus({ forceSystemRefresh: req.query.refresh === "1" }));
  } catch (error) {
    handleError(res, error, "IIS_STATUS_CHECK_FAILED", "读取 IIS FTP 状态失败");
  }
});

router.get("/admin-operation", async (_req, res) => {
  try {
    sendSuccess(res, await getElevatedAdminOperationStatus());
  } catch (error) {
    handleError(res, error, "ELEVATED_OPERATION_STATUS_FAILED", "读取管理员配置进度失败");
  }
});

router.delete("/pending-provisioning", async (_req, res) => {
  try {
    sendSuccess(res, await orchestrator.clearPendingProvisioning());
  } catch (error) {
    handleError(res, error, "CONFIG_WRITE_FAILED", "清除待继续的 IIS FTP 配置失败");
  }
});

router.get("/diagnostics", async (_req, res) => {
  try {
    const requestOperationId = getCurrentOperationId();
    if (!requestOperationId) {
      throw Object.assign(new Error("无法建立诊断操作标识。"), { code: "DIAGNOSTIC_OPERATION_ID_MISSING" });
    }
    const status = await orchestrator.getStatus();
    sendSuccess(res, buildCameraFtpDiagnosticSnapshot({
      config: getConfig().cameraFtp,
      status,
      requestOperationId,
      lastOperation: getLastCameraFtpOperation()
    }));
  } catch (error) {
    handleError(res, error, "CAMERA_FTP_DIAGNOSTICS_FAILED", "生成相机 FTP 脱敏诊断信息失败");
  }
});

router.post("/provisioning-plan", async (req, res) => {
  try {
    const goals = new Set(["setup", "repair", "start", "restart", "adopt-site"]);
    const goal = typeof req.body?.goal === "string" && goals.has(req.body.goal)
      ? req.body.goal as "setup" | "repair" | "start" | "restart" | "adopt-site"
      : "setup";
    sendSuccess(res, await orchestrator.prepareProvisioningPlan({
      goal,
      eventId: typeof req.body?.eventId === "string" ? req.body.eventId.trim() : undefined,
      username: typeof req.body?.username === "string" ? req.body.username.trim() : undefined,
      controlPort: Number(req.body?.controlPort),
      passivePortStart: Number(req.body?.passivePortStart),
      passivePortEnd: Number(req.body?.passivePortEnd),
      targetSiteName: typeof req.body?.targetSiteName === "string" ? req.body.targetSiteName.trim() : undefined,
      targetSiteId: Number.isInteger(Number(req.body?.targetSiteId)) ? Number(req.body.targetSiteId) : undefined
    }));
  } catch (error) {
    handleError(res, error, "IIS_STATUS_CHECK_FAILED", "生成 IIS FTP 配置计划失败");
  }
});

router.post("/setup", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendCameraFtpValidationError(
        res,
        "ADMIN_REQUIRED",
        "初始化会修改 Windows 功能、IIS、账户、ACL 和防火墙，需要用户明确确认。",
        "请查看配置计划，确认后重新执行初始化。"
      );
      return;
    }
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    const allowLegacyFirewallRuleUpdate = req.body?.allowLegacyFirewallRuleUpdate === true;
    const allowAclTightening = req.body?.allowAclTightening === true;
    const allowSharedFtpServiceStart = req.body?.allowSharedFtpServiceStart === true;
    if (password !== confirmPassword) {
      sendCameraFtpValidationError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", "请重新输入并确认相同的 FTP 密码。");
      return;
    }
    sendSuccess(res, await orchestrator.setup({ baseUrl: getBaseUrl(req), eventId, username, password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening, allowSharedFtpServiceStart }));
  } catch (error) {
    handleError(res, error, "IIS_FTP_INSTALL_FAILED", "初始化 Windows IIS FTP 失败");
  }
});

router.post("/adopt-site", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendCameraFtpValidationError(
        res,
        "IIS_SITE_ADOPTION_REQUIRED",
        "接管会修改现有 IIS FTP 站点，需要用户明确确认。",
        "请先核对待接管站点与配置计划，再明确确认。"
      );
      return;
    }
    const siteName = typeof req.body?.siteName === "string" ? req.body.siteName.trim() : "";
    if (!siteName) {
      sendCameraFtpValidationError(res, "IIS_SITE_ADOPTION_REQUIRED", "请选择需要接管的 IIS FTP 站点。", "请从管理员检测结果中选择站点后重试。");
      return;
    }
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : undefined;
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : undefined;
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    const allowLegacyFirewallRuleUpdate = req.body?.allowLegacyFirewallRuleUpdate === true;
    const allowAclTightening = req.body?.allowAclTightening === true;
    const allowSharedFtpServiceStart = req.body?.allowSharedFtpServiceStart === true;
    if (password !== undefined && confirmPassword !== undefined && password !== confirmPassword) {
      sendCameraFtpValidationError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", "请重新输入并确认相同的 FTP 密码。");
      return;
    }
    sendSuccess(res, await orchestrator.adoptSite({ siteName, eventId, username, password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening, allowSharedFtpServiceStart, baseUrl: getBaseUrl(req) }));
  } catch (error) {
    handleError(res, error, "IIS_SITE_ADOPTION_FAILED", "接管 IIS FTP 站点失败");
  }
});

router.post("/discover-sites", async (req, res) => {
  try {
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    sendSuccess(res, await orchestrator.discoverSites({ baseUrl: getBaseUrl(req), eventId, controlPort, passivePortStart, passivePortEnd }));
  } catch (error) {
    handleError(res, error, "IIS_STATUS_CHECK_FAILED", "管理员检测 IIS FTP 站点失败");
  }
});

router.post("/start", async (req, res) => {
  try {
    sendSuccess(res, await orchestrator.start({
      baseUrl: getBaseUrl(req),
      allowAclTightening: req.body?.allowAclTightening === true,
      allowSharedFtpServiceStart: req.body?.allowSharedFtpServiceStart === true
    }));
  } catch (error) {
    handleError(res, error, "IIS_SERVICE_START_FAILED", "启动 IIS FTP 服务失败");
  }
});

router.post("/stop", async (_req, res) => {
  try {
    sendSuccess(res, await orchestrator.stop());
  } catch (error) {
    handleError(res, error, "IIS_SERVICE_STOP_FAILED", "停止 IIS FTP 服务失败");
  }
});

router.post("/restart", async (req, res) => {
  try {
    sendSuccess(res, await orchestrator.restart({
      baseUrl: getBaseUrl(req),
      allowAclTightening: req.body?.allowAclTightening === true,
      allowSharedFtpServiceStart: req.body?.allowSharedFtpServiceStart === true
    }));
  } catch (error) {
    handleError(res, error, "IIS_CONFIG_FAILED", "重启 IIS FTP 服务失败");
  }
});

router.post("/repair", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendCameraFtpValidationError(
        res,
        "ADMIN_REQUIRED",
        "修复会修改项目管理的 IIS FTP 配置，需要用户明确确认。",
        "请查看修复计划，确认后重新执行。"
      );
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : undefined;
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    const allowLegacyFirewallRuleUpdate = req.body?.allowLegacyFirewallRuleUpdate === true;
    const allowAclTightening = req.body?.allowAclTightening === true;
    const allowSharedFtpServiceStart = req.body?.allowSharedFtpServiceStart === true;
    sendSuccess(res, await orchestrator.repair({ baseUrl: getBaseUrl(req), password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening, allowSharedFtpServiceStart }));
  } catch (error) {
    handleError(res, error, "IIS_CONFIG_FAILED", "修复 IIS FTP 配置失败");
  }
});

router.post("/check-port", async (req, res) => {
  try {
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    const fullInspection = req.body?.fullInspection === true;
    sendSuccess(res, await orchestrator.checkPort({ controlPort, passivePortStart, passivePortEnd, fullInspection }));
  } catch (error) {
    handleError(res, error, "FTP_CONTROL_PORT_INVALID", "检测 FTP 控制端口失败");
  }
});

router.patch("/credentials", async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : undefined;
    if (confirmPassword !== undefined && password !== confirmPassword) {
      sendCameraFtpValidationError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", "请重新输入并确认相同的 FTP 密码。");
      return;
    }
    sendSuccess(res, await orchestrator.updateCredentials({ username, password, baseUrl: getBaseUrl(req) }));
  } catch (error) {
    handleError(res, error, "FTP_CREDENTIAL_UPDATE_FAILED", "更新 FTP 账户设置失败");
  }
});

router.patch("/active-event", async (req, res) => {
  try {
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    if (!eventId && req.body?.unlink === true && req.body?.confirm === true) {
      sendSuccess(res, await orchestrator.clearActiveEvent({ baseUrl: getBaseUrl(req) }));
      return;
    }
    if (!eventId) {
      sendCameraFtpValidationError(
        res,
        "FTP_EVENT_NOT_FOUND",
        "请选择 FTP 接收活动；解除关联需要明确确认。",
        "请选择活动；如需解除关联，请单独执行并明确确认。"
      );
      return;
    }
    sendSuccess(res, await orchestrator.switchActiveEvent({ eventId, baseUrl: getBaseUrl(req) }));
  } catch (error) {
    handleError(res, error, "IIS_CONFIG_FAILED", "切换 FTP 接收活动失败");
  }
});

router.post("/open-folder", async (_req, res) => {
  try {
    sendSuccess(res, await orchestrator.openFolder());
  } catch (error) {
    handleError(res, error, "FTP_PATH_INVALID", "打开 FTP 接收目录失败");
  }
});

export default router;
