import path from "path";
import type { CameraFtpConfig } from "../config/config";
import {
  createUnknownIisFtpStatus,
  normalizeIisFtpStatus,
  type IisFtpActionResult,
  type IisFtpSystemStatus
} from "./camera-ftp/iisFtpStatusTypes";
import {
  runElevatedPowerShellJsonScript,
  runPowerShellJsonScript,
  type PowerShellJsonDiagnostics
} from "../utils/elevatedPowerShell";
import { safeLog } from "../utils/logger";

export {
  createUnknownIisFtpStatus,
  normalizeIisFtpStatus
} from "./camera-ftp/iisFtpStatusTypes";
export type {
  DetectionBoolean,
  IisFeatureStatus,
  IisFtpAccountStatus,
  IisFtpAclStatus,
  IisFtpActionResult,
  IisFtpAuthenticationStatus,
  IisFtpAuthorizationStatus,
  IisFtpBindingStatus,
  IisFtpConflict,
  IisFtpConflicts,
  IisFtpFirewallRuleStatus,
  IisFtpFirewallStatus,
  IisFtpLastError,
  IisFtpPassivePortsStatus,
  IisFtpPlatformStatus,
  IisFtpPortStatus,
  IisFtpServiceStatus,
  IisFtpSiteStatus,
  IisFtpSystemStatus
} from "./camera-ftp/iisFtpStatusTypes";

export interface IisFtpManagerInput {
  config: CameraFtpConfig;
  physicalPath: string;
  allowLegacyFirewallRuleUpdate?: boolean;
  allowAclTightening?: boolean;
}

interface ScriptActionData {
  operationId?: string;
  action?: string;
  status?: string | Record<string, unknown>;
  message?: string;
  steps?: Array<{ name?: string; status?: string; message?: string }>;
  warnings?: unknown[];
  requiresAdmin?: boolean;
  systemStatus?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  completedSteps?: unknown[];
  failedStep?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
}

const ACCOUNT_DESCRIPTION = "Media Photo Workbench Managed FTP Account";

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    const message = objectValue(item).message;
    return typeof message === "string" && message ? [message] : [];
  });
}

function statusErrorCode(error: any): string {
  return typeof error?.code === "string" ? error.code : "IIS_STATUS_CHECK_FAILED";
}

function statusErrorMessage(error: any): string {
  return typeof error?.message === "string" && error.message ? error.message : "无法检测 Windows IIS FTP 状态。";
}

function isPermissionLimitedStatusError(code: string): boolean {
  return ["ADMIN_REQUIRED", "ACCESS_DENIED", "EACCES", "IIS_STATUS_ADMIN_REQUIRED"].includes(code);
}

function assertPhysicalPath(physicalPath: string): void {
  if (!physicalPath || !path.isAbsolute(physicalPath)) {
    throw Object.assign(new Error("当前 FTP 接收目录无效。"), { code: "FTP_PATH_INVALID" });
  }
}

export function validateCameraFtpCredentials(username: string, password: string): void {
  const normalizedUsername = username.trim();
  if (!normalizedUsername || normalizedUsername.length > 20 || /["\/\\[\]:;|=,+*?<>@]/.test(normalizedUsername) || normalizedUsername.endsWith(".")) {
    throw Object.assign(new Error("FTP 用户名无效，请使用 1-20 位普通字符且不要包含 Windows 用户名禁用符号。"), {
      code: "FTP_CREDENTIAL_UPDATE_FAILED"
    });
  }
  if (!password) {
    throw Object.assign(new Error("FTP 密码不能为空。"), { code: "FTP_PASSWORD_REQUIRED" });
  }
  if (password.length < 8 || password.trim().length === 0) {
    throw Object.assign(new Error("FTP 密码至少需要 8 位。"), { code: "FTP_PASSWORD_INVALID" });
  }
}

export function validateCameraFtpPorts(controlPort: number, passivePortStart: number, passivePortEnd: number): void {
  const validPort = (value: number) => Number.isInteger(value) && value >= 1 && value <= 65535;
  if (!validPort(controlPort)) {
    throw Object.assign(new Error("FTP 控制端口必须是 1 到 65535 之间的整数。"), {
      code: "FTP_CONTROL_PORT_INVALID",
      details: { controlPort }
    });
  }
  if (!validPort(passivePortStart) || !validPort(passivePortEnd) || passivePortStart > passivePortEnd) {
    throw Object.assign(new Error("FTP 被动端口范围无效，请输入 1 到 65535 之间且起始端口不大于结束端口的整数。"), {
      code: "FTP_PORT_RANGE_CONFLICT",
      details: { controlPort, passivePortStart, passivePortEnd }
    });
  }
  if (controlPort >= passivePortStart && controlPort <= passivePortEnd) {
    throw Object.assign(new Error("FTP 控制端口不能落入被动端口范围。"), {
      code: "FTP_PORT_RANGE_CONFLICT",
      details: { controlPort, passivePortStart, passivePortEnd }
    });
  }
}

function baseScriptInput(input: IisFtpManagerInput, requirePath = true): Record<string, unknown> {
  if (requirePath) assertPhysicalPath(input.physicalPath);
  validateCameraFtpPorts(input.config.controlPort, input.config.passivePortStart, input.config.passivePortEnd);
  return {
    siteName: input.config.siteName,
    managedSiteId: input.config.managedSiteId,
    username: input.config.username,
    physicalPath: input.physicalPath ? path.resolve(input.physicalPath) : "",
    binding: `*:${input.config.controlPort}:`,
    controlPort: input.config.controlPort,
    passivePortStart: input.config.passivePortStart,
    passivePortEnd: input.config.passivePortEnd,
    firewallControlRuleName: input.config.firewallControlRuleName,
    firewallPassiveRuleName: input.config.firewallPassiveRuleName,
    firewallProfile: "Any",
    firewallRemoteAddress: "LocalSubnet",
    allowLegacyFirewallRuleUpdate: input.allowLegacyFirewallRuleUpdate === true,
    accountDescription: ACCOUNT_DESCRIPTION
  };
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("[redacted]"), value);
}

function redactDiagnosticValue(value: unknown, secrets: string[], key = ""): unknown {
  if (/password|secret|token|securestring/i.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, redactDiagnosticValue(entryValue, secrets, entryKey)]));
  }
  return value;
}

function normalizeActionResult(
  action: string,
  raw: ScriptActionData,
  input: IisFtpManagerInput,
  secrets: string[] = []
): IisFtpActionResult {
  const embeddedStatus = raw.systemStatus || (raw.status && typeof raw.status === "object" ? raw.status : undefined);
  return {
    operationId: typeof raw.operationId === "string" ? raw.operationId : undefined,
    action: raw.action || action,
    status: raw.status === "failed" ? "failed" : "success",
    message: redactSecrets(raw.message || "操作已完成。", secrets),
    steps: Array.isArray(raw.steps)
      ? raw.steps.map((step) => ({
          name: step.name || "",
          status: step.status || "unknown",
          message: redactSecrets(step.message || "", secrets)
        }))
      : [],
    warnings: stringArray(raw.warnings).map((warning) => redactSecrets(warning, secrets)),
    requiresAdmin: raw.requiresAdmin === true,
    systemStatus: embeddedStatus ? normalizeIisFtpStatus(embeddedStatus, input.config, input.physicalPath) : undefined
  };
}

async function withSecretRedaction<T>(operation: () => Promise<T>, secrets: string[]): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const code = typeof error?.code === "string" ? error.code : "IIS_CONFIG_FAILED";
    const message = redactSecrets(
      typeof error?.message === "string" ? error.message : "Windows IIS FTP 操作失败。",
      secrets
    );
    const source = error?.diagnostics && typeof error.diagnostics === "object"
      ? error.diagnostics as PowerShellJsonDiagnostics
      : undefined;
    const diagnostics = source
      ? redactDiagnosticValue(source, secrets) as PowerShellJsonDiagnostics
      : undefined;
    const transactionData = diagnostics?.data && typeof diagnostics.data === "object"
      ? diagnostics.data as Record<string, unknown>
      : undefined;
    const completedSteps = Array.isArray(transactionData?.completedSteps)
      ? transactionData.completedSteps.map((step) => {
          const entry = objectValue(step);
          return { name: stringValue(entry.name), status: stringValue(entry.status) };
        })
      : [];
    safeLog("warn", {
      code,
      operationId: diagnostics?.operationId,
      stage: diagnostics?.stage,
      technicalMessage: diagnostics?.technicalMessage,
      exceptionType: diagnostics?.exceptionType,
      command: diagnostics?.command,
      diagnostics: diagnostics?.details,
      completedSteps,
      failedStep: transactionData?.failedStep,
      rollback: transactionData?.rollback,
      preflight: transactionData?.preflight,
      provisioningPlan: transactionData?.plan,
      rollbackAttempted: diagnostics?.rollbackAttempted,
      rollbackSucceeded: diagnostics?.rollbackSucceeded
    }, "IIS FTP 管理事务失败，已保留结构化阶段与回滚结果");
    throw Object.assign(new Error(message), { code, ...(diagnostics ? { diagnostics } : {}) });
  }
}

export class IisFtpManager {
  private readonly statusCache = new Map<string, { expiresAt: number; value: IisFtpSystemStatus }>();
  private readonly statusInFlight = new Map<string, Promise<IisFtpSystemStatus>>();
  private statusCacheGeneration = 0;

  async getStatus(input: IisFtpManagerInput, options: { force?: boolean } = {}): Promise<IisFtpSystemStatus> {
    const key = JSON.stringify([
      input.config.siteName,
      input.config.managedSiteId,
      input.config.username,
      input.config.accountManaged,
      input.config.activeEventId,
      input.config.controlPort,
      input.config.passivePortStart,
      input.config.passivePortEnd,
      input.physicalPath
    ]);
    const now = Date.now();
    if (!options.force) {
      const cached = this.statusCache.get(key);
      if (cached && cached.expiresAt > now) return cached.value;
      const inFlight = this.statusInFlight.get(key);
      if (inFlight) return inFlight;
    }

    const generation = this.statusCacheGeneration;
    const probe = this.probeStatus(input);
    this.statusInFlight.set(key, probe);
    try {
      const value = await probe;
      if (generation === this.statusCacheGeneration) {
        this.statusCache.set(key, { expiresAt: Date.now() + 15_000, value });
      }
      return value;
    } finally {
      if (this.statusInFlight.get(key) === probe) this.statusInFlight.delete(key);
    }
  }

  private invalidateStatusCache(): void {
    this.statusCacheGeneration += 1;
    this.statusCache.clear();
    this.statusInFlight.clear();
  }

  private async runMutationScript<T>(operation: () => Promise<T>): Promise<T> {
    this.invalidateStatusCache();
    try {
      return await operation();
    } finally {
      this.invalidateStatusCache();
    }
  }

  private async probeStatus(input: IisFtpManagerInput): Promise<IisFtpSystemStatus> {
    const fallback = createUnknownIisFtpStatus(input.config, input.physicalPath);
    if (!fallback.platform.isWindows) {
      fallback.lastError = { code: "UNSUPPORTED_PLATFORM", message: "Windows IIS FTP 仅支持 Windows 11。" };
      fallback.warnings.push(fallback.lastError.message);
      return fallback;
    }
    try {
      const raw = await runPowerShellJsonScript<unknown>("iis-ftp-status.ps1", {
        action: "status",
        ...baseScriptInput(input, false)
      }, { timeoutMs: 45_000 });
      return normalizeIisFtpStatus(raw, input.config, input.physicalPath);
    } catch (error: any) {
      const code = statusErrorCode(error);
      const message = statusErrorMessage(error);
      fallback.requiresAdmin = isPermissionLimitedStatusError(code);
      fallback.repairable = fallback.platform.supported;
      fallback.lastError = { code: code === "IIS_SCRIPT_NOT_FOUND" ? code : "IIS_STATUS_CHECK_FAILED", message };
      fallback.warnings.push(
        fallback.requiresAdmin
          ? "普通权限无法读取完整 IIS 状态；当前各项保持 unknown，未误判为不存在。"
          : message
      );
      safeLog("warn", { code, requiresAdmin: fallback.requiresAdmin }, "IIS FTP 状态检测未完成");
      return fallback;
    }
  }

  async getStatusElevated(input: IisFtpManagerInput): Promise<IisFtpSystemStatus> {
    if (process.platform !== "win32") return this.getStatus(input);
    const raw = await this.runMutationScript(() => runElevatedPowerShellJsonScript<unknown>("iis-ftp-status.ps1", {
        action: "status",
        ...baseScriptInput(input, false)
      }, { timeoutMs: 60_000 }));
    const status = normalizeIisFtpStatus(raw, input.config, input.physicalPath);
    if (status.requiresAdmin || status.site.exists === null) {
      throw Object.assign(new Error("管理员权限下仍无法完整读取 IIS FTP 站点配置。"), {
        code: status.lastError?.code || "IIS_STATUS_CHECK_FAILED"
      });
    }
    return status;
  }

  async setup(input: IisFtpManagerInput & { password?: string }): Promise<IisFtpActionResult> {
    return this.provision("setup", input, { allowAclTightening: input.allowAclTightening === true });
  }

  async repair(input: IisFtpManagerInput & { password?: string }): Promise<IisFtpActionResult> {
    return this.provision("repair", input, { allowAclTightening: input.allowAclTightening === true });
  }

  async adoptSite(input: IisFtpManagerInput & { targetSiteName: string; password?: string }): Promise<IisFtpActionResult> {
    if (!input.targetSiteName.trim()) {
      throw Object.assign(new Error("请选择需要接管的 IIS FTP 站点。"), { code: "IIS_SITE_ADOPTION_REQUIRED" });
    }
    return this.provision("adopt", input, {
      targetSiteName: input.targetSiteName.trim(),
      confirmAdoption: true,
      allowAclTightening: input.allowAclTightening === true
    });
  }

  async start(input: IisFtpManagerInput): Promise<IisFtpActionResult> {
    // Start is intentionally a reconciliation target, not a blind runtime
    // toggle. Missing managed configuration is repaired in the same elevated
    // transaction before the site is started and verified.
    return this.provision("start", input, { allowAclTightening: input.allowAclTightening === true });
  }

  async stop(input: IisFtpManagerInput): Promise<IisFtpActionResult> {
    return this.control("stop", input);
  }

  async restart(input: IisFtpManagerInput): Promise<IisFtpActionResult> {
    return this.provision("restart", input, { allowAclTightening: input.allowAclTightening === true });
  }

  async setPhysicalPath(input: IisFtpManagerInput): Promise<IisFtpActionResult> {
    return this.control("set-path", input);
  }

  async updateCredentials(input: IisFtpManagerInput & {
    username: string;
    password: string;
    previousUsername: string;
  }): Promise<IisFtpActionResult> {
    validateCameraFtpCredentials(input.username, input.password);
    const raw = await withSecretRedaction(() => this.runMutationScript(() => runElevatedPowerShellJsonScript<ScriptActionData>("iis-ftp-credentials.ps1", {
        action: "set",
        ...baseScriptInput({
          ...input,
          config: { ...input.config, username: input.username.trim() }
        }),
        username: input.username.trim(),
        previousUsername: input.previousUsername,
        password: input.password
      })), [input.password]);
    safeLog("info", {
      action: "credentials",
      usernameChanged: input.username.trim() !== input.previousUsername,
      passwordReset: true
    }, "IIS FTP 账户设置已更新");
    return normalizeActionResult("credentials", raw, {
      ...input,
      config: { ...input.config, username: input.username.trim() }
    }, [input.password]);
  }

  private async control(action: "start" | "stop" | "restart" | "set-path", input: IisFtpManagerInput): Promise<IisFtpActionResult> {
    const raw = await this.runMutationScript(() => runElevatedPowerShellJsonScript<ScriptActionData>("iis-ftp-control.ps1", {
        action,
        ...baseScriptInput(input)
      }));
    safeLog("info", { action, siteName: input.config.siteName }, "IIS FTP 控制操作完成");
    return normalizeActionResult(action, raw, input);
  }

  private async provision(
    action: "setup" | "repair" | "start" | "restart" | "adopt",
    input: IisFtpManagerInput & { password?: string },
    confirmation: { targetSiteName?: string; confirmAdoption?: boolean; allowAclTightening?: boolean } = {}
  ): Promise<IisFtpActionResult> {
    const secrets = input.password ? [input.password] : [];
    const raw = await withSecretRedaction(() => this.runMutationScript(() => runElevatedPowerShellJsonScript<ScriptActionData>("iis-ftp-setup.ps1", {
        action,
        ...baseScriptInput(input),
        ...(confirmation.targetSiteName ? { targetSiteName: confirmation.targetSiteName } : {}),
        ...(confirmation.confirmAdoption ? { confirmAdoption: true } : {}),
        ...(confirmation.allowAclTightening ? { allowAclTightening: true } : {}),
        ...(input.password ? { password: input.password } : {})
      })), secrets);
    safeLog("info", {
      action,
      operationId: raw.operationId,
      siteName: confirmation.targetSiteName || input.config.siteName,
      reconciled: true,
      steps: Array.isArray(raw.steps)
        ? raw.steps.map((step) => ({ name: stringValue(step.name), status: stringValue(step.status) }))
        : [],
      preflight: raw.preflight,
      provisioningPlan: raw.plan,
      verification: raw.systemStatus,
      rollback: raw.rollback
    }, "IIS FTP 统一配置事务完成");
    return normalizeActionResult(action, raw, input, secrets);
  }
}

const iisFtpManager = new IisFtpManager();

export function getIisFtpManager(): IisFtpManager {
  return iisFtpManager;
}
