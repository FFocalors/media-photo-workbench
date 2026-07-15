import { type Request, Router } from "express";
import { requireHostOnly } from "../middleware/hostOnly";
import { getCameraFtpOrchestrator } from "../services/cameraFtpOrchestrator";
import { getLogger } from "../utils/logger";
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

function handleError(res: any, error: any, fallbackCode: string, fallbackMessage: string): void {
  const code = typeof error?.code === "string" ? error.code : fallbackCode;
  const message = typeof error?.message === "string" && error.message ? error.message : fallbackMessage;
  const source = error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : null;
  const operationData = source?.data && typeof source.data === "object" ? source.data : null;
  const diagnosticDetails = source?.details && typeof source.details === "object" ? source.details : undefined;
  const details = source ? {
    operationId: typeof source.operationId === "string" ? source.operationId : undefined,
    operation: typeof source.operation === "string" ? source.operation : undefined,
    scriptName: typeof source.scriptName === "string" ? source.scriptName : undefined,
    stage: typeof source.stage === "string" ? source.stage : undefined,
    technicalMessage: typeof source.technicalMessage === "string" ? source.technicalMessage : undefined,
    exceptionType: typeof source.exceptionType === "string" ? source.exceptionType : undefined,
    command: typeof source.command === "string" ? source.command : undefined,
    siteName: typeof source.siteName === "string" ? source.siteName : undefined,
    rollbackAttempted: typeof source.rollbackAttempted === "boolean" ? source.rollbackAttempted : undefined,
    rollbackSucceeded: typeof source.rollbackSucceeded === "boolean" || source.rollbackSucceeded === null ? source.rollbackSucceeded : undefined,
    exitCode: typeof source.exitCode === "number" ? source.exitCode : undefined,
    timestamp: typeof source.timestamp === "string" ? source.timestamp : undefined,
    warnings: Array.isArray(source.warnings)
      ? source.warnings.map((item: unknown) => typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as any).message === "string"
          ? (item as any).message
          : "").filter(Boolean)
      : undefined,
    // `conflict` remains for backward-compatible UI actions. The explicitly
    // named fields preserve the full, sanitized transaction report.
    conflict: diagnosticDetails,
    diagnostics: diagnosticDetails,
    completedSteps: Array.isArray(operationData?.completedSteps)
      ? operationData.completedSteps
      : Array.isArray(operationData?.steps)
        ? operationData.steps
        : undefined,
    failedStep: operationData?.failedStep && typeof operationData.failedStep === "object" ? operationData.failedStep : undefined,
    rollback: operationData?.rollback && typeof operationData.rollback === "object" ? operationData.rollback : undefined,
    preflight: operationData?.preflight && typeof operationData.preflight === "object" ? operationData.preflight : undefined,
    provisioningPlan: operationData?.plan && typeof operationData.plan === "object" ? operationData.plan : undefined
  } : error?.details && typeof error.details === "object"
    ? { conflict: error.details, diagnostics: error.details }
    : undefined;
  if (!error?.code) {
    getLogger().error({ error }, fallbackMessage);
    sendError(res, code, message, 500, details);
    return;
  }
  getLogger().warn({ code, stage: details?.stage, operationId: details?.operationId }, fallbackMessage);
  sendError(res, code, message, errorStatus(code), details);
}

router.get("/status", async (req, res) => {
  try {
    sendSuccess(res, await orchestrator.getStatus({ forceSystemRefresh: req.query.refresh === "1" }));
  } catch (error) {
    handleError(res, error, "IIS_STATUS_CHECK_FAILED", "读取 IIS FTP 状态失败");
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
      sendError(res, "ADMIN_REQUIRED", "初始化会修改 Windows 功能、IIS、账户、ACL 和防火墙，需要用户明确确认。", 400);
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
    if (password !== confirmPassword) {
      sendError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", 400);
      return;
    }
    sendSuccess(res, await orchestrator.setup({ baseUrl: getBaseUrl(req), eventId, username, password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening }));
  } catch (error) {
    handleError(res, error, "IIS_FTP_INSTALL_FAILED", "初始化 Windows IIS FTP 失败");
  }
});

router.post("/adopt-site", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendError(res, "IIS_SITE_ADOPTION_REQUIRED", "接管会修改现有 IIS FTP 站点，需要用户明确确认。", 400);
      return;
    }
    const siteName = typeof req.body?.siteName === "string" ? req.body.siteName.trim() : "";
    if (!siteName) {
      sendError(res, "IIS_SITE_ADOPTION_REQUIRED", "请选择需要接管的 IIS FTP 站点。", 400);
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
    if (password !== undefined && confirmPassword !== undefined && password !== confirmPassword) {
      sendError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", 400);
      return;
    }
    sendSuccess(res, await orchestrator.adoptSite({ siteName, eventId, username, password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening, baseUrl: getBaseUrl(req) }));
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
    sendSuccess(res, await orchestrator.start({ baseUrl: getBaseUrl(req), allowAclTightening: req.body?.allowAclTightening === true }));
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
    sendSuccess(res, await orchestrator.restart({ baseUrl: getBaseUrl(req), allowAclTightening: req.body?.allowAclTightening === true }));
  } catch (error) {
    handleError(res, error, "IIS_CONFIG_FAILED", "重启 IIS FTP 服务失败");
  }
});

router.post("/repair", async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      sendError(res, "ADMIN_REQUIRED", "修复会修改项目管理的 IIS FTP 配置，需要用户明确确认。", 400);
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : undefined;
    const controlPort = Number(req.body?.controlPort);
    const passivePortStart = Number(req.body?.passivePortStart);
    const passivePortEnd = Number(req.body?.passivePortEnd);
    const allowLegacyFirewallRuleUpdate = req.body?.allowLegacyFirewallRuleUpdate === true;
    const allowAclTightening = req.body?.allowAclTightening === true;
    sendSuccess(res, await orchestrator.repair({ baseUrl: getBaseUrl(req), password, controlPort, passivePortStart, passivePortEnd, allowLegacyFirewallRuleUpdate, allowAclTightening }));
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
      sendError(res, "FTP_PASSWORD_INVALID", "两次输入的 FTP 密码不一致。", 400);
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
      sendError(res, "FTP_EVENT_NOT_FOUND", "请选择 FTP 接收活动；解除关联需要明确确认。", 400);
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
