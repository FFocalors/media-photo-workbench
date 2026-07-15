import os from "os";
import path from "path";
import type { CameraFtpConfig } from "../config/config";
import {
  runElevatedPowerShellJsonScript,
  runPowerShellJsonScript,
  type PowerShellJsonDiagnostics
} from "../utils/elevatedPowerShell";
import { safeLog } from "../utils/logger";

export type DetectionBoolean = boolean | null;

export interface IisFeatureStatus {
  featureName: string;
  installed: DetectionBoolean;
  state: string;
  error: string;
}

export interface IisFtpPlatformStatus {
  isWindows: boolean;
  isWindows11: boolean;
  supported: boolean;
  version: string;
}

export interface IisFtpServiceStatus {
  name: string;
  exists: DetectionBoolean;
  status: string;
  startType: string;
  running: DetectionBoolean;
}

export interface IisFtpSiteStatus {
  id: number | null;
  exists: DetectionBoolean;
  name: string;
  status: string;
  started: DetectionBoolean;
  physicalPath: string;
  binding: string;
  controlPort: number;
  sslEnabled: DetectionBoolean;
  adoptable: DetectionBoolean;
  managed: DetectionBoolean;
}

export interface IisFtpBindingStatus {
  value: string;
  host: string;
  port: number;
  allUnassigned: DetectionBoolean;
  correct: DetectionBoolean;
}

export interface IisFtpAuthenticationStatus {
  basicEnabled: DetectionBoolean;
  anonymousEnabled: DetectionBoolean;
  correct: DetectionBoolean;
}

export interface IisFtpAuthorizationStatus {
  configured: DetectionBoolean;
  username: string;
  read: DetectionBoolean;
  write: DetectionBoolean;
  correct: DetectionBoolean;
}

export interface IisFtpAccountStatus {
  exists: DetectionBoolean;
  username: string;
  enabled: DetectionBoolean;
  managed: DetectionBoolean;
  description: string;
  conflict: DetectionBoolean;
}

export interface IisFtpAclStatus {
  path: string;
  exists: DetectionBoolean;
  read: DetectionBoolean;
  write: DetectionBoolean;
  correct: DetectionBoolean;
  broadInheritedAccess: DetectionBoolean;
}

export interface IisFtpPassivePortsStatus {
  start: number;
  end: number;
  configured: DetectionBoolean;
  correct: DetectionBoolean;
}

export interface IisFtpFirewallRuleStatus {
  name: string;
  exists: DetectionBoolean;
  enabled: DetectionBoolean;
  profile: string;
  remoteAddress: string;
  correct: DetectionBoolean;
}

export interface IisFtpFirewallStatus {
  controlRule: IisFtpFirewallRuleStatus;
  passiveRule: IisFtpFirewallRuleStatus;
  correct: DetectionBoolean;
}

export interface IisFtpPortStatus {
  configuredPort: number;
  listening: DetectionBoolean;
  pid: number | null;
  processName: string;
  ownedByMicrosoftFtp: DetectionBoolean;
  conflict: DetectionBoolean;
  reserved: DetectionBoolean;
  reservedRange: string;
  iisSiteName: string;
  iisSiteNames: string[];
  ownedByManagedSite: DetectionBoolean;
  adoptable: DetectionBoolean;
  canChangePort: boolean;
  availablePorts: number[];
  recommendation: string;
}

export interface IisFtpConflict {
  type: string;
  code: string;
  message: string;
  siteName?: string;
  physicalPath?: string;
  binding?: string;
  port?: number;
  status?: string;
  adoptable?: boolean;
  verifiedWithNikon?: boolean;
  pid?: number;
  processName?: string;
  source?: string;
  recommendation?: string;
  availablePorts?: number[];
  canChangePort?: boolean;
}

export interface IisFtpConflicts {
  portConflict: DetectionBoolean;
  siteConflict: DetectionBoolean;
  userConflict: DetectionBoolean;
  pathConflict: DetectionBoolean;
  items: IisFtpConflict[];
}

export interface IisFtpLastError {
  code: string;
  message: string;
}

export interface IisFtpSystemStatus {
  platform: IisFtpPlatformStatus;
  windowsFeatures: {
    ftpService: IisFeatureStatus;
    ftpExtensibility: IisFeatureStatus;
    managementTools: IisFeatureStatus;
  };
  service: IisFtpServiceStatus;
  site: IisFtpSiteStatus;
  binding: IisFtpBindingStatus;
  authentication: IisFtpAuthenticationStatus;
  authorization: IisFtpAuthorizationStatus;
  account: IisFtpAccountStatus;
  acl: IisFtpAclStatus;
  passivePorts: IisFtpPassivePortsStatus;
  firewall: IisFtpFirewallStatus;
  port: IisFtpPortStatus;
  conflicts: IisFtpConflicts;
  requiresAdmin: boolean;
  repairable: boolean;
  missingItems: string[];
  warnings: string[];
  lastError: IisFtpLastError | null;
}

export interface IisFtpManagerInput {
  config: CameraFtpConfig;
  physicalPath: string;
  allowLegacyFirewallRuleUpdate?: boolean;
  allowAclTightening?: boolean;
}

export interface IisFtpActionResult {
  operationId?: string;
  action: string;
  status: "success" | "failed";
  message: string;
  steps: Array<{ name: string; status: string; message: string }>;
  warnings: string[];
  requiresAdmin: boolean;
  systemStatus?: IisFtpSystemStatus;
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

function numberValue(value: unknown, fallback: number): number {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): DetectionBoolean {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    const message = objectValue(item).message;
    return typeof message === "string" && message ? [message] : [];
  });
}

function currentPlatform(): IisFtpPlatformStatus {
  const version = os.release();
  const build = Number(version.split(".")[2] || 0);
  const isWindows = process.platform === "win32";
  const isWindows11 = isWindows && build >= 22000;
  return { isWindows, isWindows11, supported: isWindows11, version };
}

function unknownFeature(featureName: string): IisFeatureStatus {
  return { featureName, installed: null, state: "unknown", error: "" };
}

function unknownFirewallRule(name: string): IisFtpFirewallRuleStatus {
  return { name, exists: null, enabled: null, profile: "unknown", remoteAddress: "unknown", correct: null };
}

export function createUnknownIisFtpStatus(config: CameraFtpConfig, physicalPath: string): IisFtpSystemStatus {
  const normalized: IisFtpSystemStatus = {
    platform: currentPlatform(),
    windowsFeatures: {
      ftpService: unknownFeature("IIS-FTPServer"),
      ftpExtensibility: unknownFeature("IIS-FTPExtensibility"),
      managementTools: unknownFeature("IIS-ManagementScriptingTools")
    },
    service: { name: "ftpsvc", exists: null, status: "unknown", startType: "unknown", running: null },
    site: {
      id: null,
      exists: null,
      name: config.siteName,
      status: "unknown",
      started: null,
      physicalPath: "",
      binding: "",
      controlPort: config.controlPort,
      sslEnabled: null,
      adoptable: null,
      managed: null
    },
    binding: { value: "", host: "", port: config.controlPort, allUnassigned: null, correct: null },
    authentication: { basicEnabled: null, anonymousEnabled: null, correct: null },
    authorization: { configured: null, username: config.username, read: null, write: null, correct: null },
    account: {
      exists: null,
      username: config.username,
      enabled: null,
      managed: null,
      description: "",
      conflict: null
    },
    acl: { path: physicalPath, exists: null, read: null, write: null, correct: null, broadInheritedAccess: null },
    passivePorts: {
      start: config.passivePortStart,
      end: config.passivePortEnd,
      configured: null,
      correct: null
    },
    firewall: {
      controlRule: unknownFirewallRule(config.firewallControlRuleName),
      passiveRule: unknownFirewallRule(config.firewallPassiveRuleName),
      correct: null
    },
    port: {
      configuredPort: config.controlPort,
      listening: null,
      pid: null,
      processName: "",
      ownedByMicrosoftFtp: null,
      conflict: null,
      reserved: null,
      reservedRange: "",
      iisSiteName: "",
      iisSiteNames: [],
      ownedByManagedSite: null,
      adoptable: null,
      canChangePort: true,
      availablePorts: [],
      recommendation: ""
    },
    conflicts: { portConflict: null, siteConflict: null, userConflict: null, pathConflict: null, items: [] },
    requiresAdmin: false,
    repairable: false,
    missingItems: [],
    warnings: [],
    lastError: null
  };
  return normalized;
}

function normalizeFeature(raw: unknown, fallback: IisFeatureStatus): IisFeatureStatus {
  const item = objectValue(raw);
  return {
    featureName: stringValue(item.featureName, fallback.featureName),
    installed: booleanValue(item.installed),
    state: stringValue(item.state, fallback.state),
    error: stringValue(item.error)
  };
}

function normalizeFirewallRule(raw: unknown, fallback: IisFtpFirewallRuleStatus): IisFtpFirewallRuleStatus {
  const item = objectValue(raw);
  return {
    name: stringValue(item.name, fallback.name),
    exists: booleanValue(item.exists),
    enabled: booleanValue(item.enabled),
    profile: stringValue(item.profile, fallback.profile),
    remoteAddress: stringValue(item.remoteAddress, fallback.remoteAddress),
    correct: booleanValue(item.correct)
  };
}

/** Pure DTO normalizer used by both runtime code and IIS fixture tests. */
export function normalizeIisFtpStatus(
  raw: unknown,
  config: CameraFtpConfig,
  physicalPath: string
): IisFtpSystemStatus {
  const sourceRoot = objectValue(raw);
  const source = objectValue(sourceRoot.systemStatus || sourceRoot.status || sourceRoot);
  const fallback = createUnknownIisFtpStatus(config, physicalPath);
  const platform = objectValue(source.platform);
  const features = objectValue(source.windowsFeatures);
  const service = objectValue(source.service);
  const site = objectValue(source.site);
  const binding = objectValue(source.binding);
  const authentication = objectValue(source.authentication);
  const authorization = objectValue(source.authorization);
  const account = objectValue(source.account);
  const acl = objectValue(source.acl);
  const passivePorts = objectValue(source.passivePorts);
  const firewall = objectValue(source.firewall);
  const port = objectValue(source.port);
  const conflicts = objectValue(source.conflicts);
  const conflictItems = Array.isArray(conflicts.items) ? conflicts.items : [];
  const lastError = objectValue(source.lastError);

  const normalized: IisFtpSystemStatus = {
    platform: {
      isWindows: typeof platform.isWindows === "boolean" ? platform.isWindows : fallback.platform.isWindows,
      isWindows11: typeof platform.isWindows11 === "boolean" ? platform.isWindows11 : fallback.platform.isWindows11,
      supported: typeof platform.supported === "boolean" ? platform.supported : fallback.platform.supported,
      version: stringValue(platform.version, fallback.platform.version)
    },
    windowsFeatures: {
      ftpService: normalizeFeature(features.ftpService, fallback.windowsFeatures.ftpService),
      ftpExtensibility: normalizeFeature(features.ftpExtensibility, fallback.windowsFeatures.ftpExtensibility),
      managementTools: normalizeFeature(features.managementTools, fallback.windowsFeatures.managementTools)
    },
    service: {
      name: stringValue(service.name, "ftpsvc"),
      exists: booleanValue(service.exists),
      status: stringValue(service.status, "unknown"),
      startType: stringValue(service.startType, "unknown"),
      running: booleanValue(service.running)
    },
    site: {
      id: nullableNumber(site.id),
      exists: booleanValue(site.exists),
      name: stringValue(site.name, config.siteName),
      status: stringValue(site.status, "unknown"),
      started: booleanValue(site.started),
      physicalPath: stringValue(site.physicalPath),
      binding: stringValue(site.binding),
      controlPort: numberValue(site.controlPort, config.controlPort),
      sslEnabled: booleanValue(site.sslEnabled),
      adoptable: booleanValue(site.adoptable),
      managed: booleanValue(site.managed)
    },
    binding: {
      value: stringValue(binding.value, stringValue(site.binding)),
      host: stringValue(binding.host),
      port: numberValue(binding.port, config.controlPort),
      allUnassigned: booleanValue(binding.allUnassigned),
      correct: booleanValue(binding.correct)
    },
    authentication: {
      basicEnabled: booleanValue(authentication.basicEnabled),
      anonymousEnabled: booleanValue(authentication.anonymousEnabled),
      correct: booleanValue(authentication.correct)
    },
    authorization: {
      configured: booleanValue(authorization.configured),
      username: stringValue(authorization.username, config.username),
      read: booleanValue(authorization.read),
      write: booleanValue(authorization.write),
      correct: booleanValue(authorization.correct)
    },
    account: {
      exists: booleanValue(account.exists),
      username: stringValue(account.username, config.username),
      enabled: booleanValue(account.enabled),
      managed: booleanValue(account.managed),
      description: stringValue(account.description),
      conflict: booleanValue(account.conflict)
    },
    acl: {
      path: stringValue(acl.path, physicalPath),
      exists: booleanValue(acl.exists),
      read: booleanValue(acl.read),
      write: booleanValue(acl.write),
      correct: booleanValue(acl.correct),
      broadInheritedAccess: booleanValue(acl.broadInheritedAccess)
    },
    passivePorts: {
      start: numberValue(passivePorts.start, config.passivePortStart),
      end: numberValue(passivePorts.end, config.passivePortEnd),
      configured: booleanValue(passivePorts.configured),
      correct: booleanValue(passivePorts.correct)
    },
    firewall: {
      controlRule: normalizeFirewallRule(firewall.controlRule, fallback.firewall.controlRule),
      passiveRule: normalizeFirewallRule(firewall.passiveRule, fallback.firewall.passiveRule),
      correct: booleanValue(firewall.correct)
    },
    port: {
      configuredPort: numberValue(port.configuredPort, config.controlPort),
      listening: booleanValue(port.listening),
      pid: nullableNumber(port.pid),
      processName: stringValue(port.processName),
      ownedByMicrosoftFtp: booleanValue(port.ownedByMicrosoftFtp),
      conflict: booleanValue(port.conflict),
      reserved: booleanValue(port.reserved),
      reservedRange: stringValue(port.reservedRange),
      iisSiteName: stringValue(port.iisSiteName),
      iisSiteNames: Array.isArray(port.iisSiteNames)
        ? port.iisSiteNames.filter((value: unknown): value is string => typeof value === "string")
        : [],
      ownedByManagedSite: booleanValue(port.ownedByManagedSite),
      adoptable: booleanValue(port.adoptable),
      canChangePort: port.canChangePort !== false,
      availablePorts: Array.isArray(port.availablePorts)
        ? port.availablePorts.map(Number).filter((value: number) => Number.isInteger(value) && value >= 1 && value <= 65535)
        : [],
      recommendation: stringValue(port.recommendation)
    },
    conflicts: {
      portConflict: booleanValue(conflicts.portConflict),
      siteConflict: booleanValue(conflicts.siteConflict),
      userConflict: booleanValue(conflicts.userConflict),
      pathConflict: booleanValue(conflicts.pathConflict),
      items: conflictItems.map((value) => {
        const item = objectValue(value);
        return {
          type: stringValue(item.type),
          code: stringValue(item.code),
          message: stringValue(item.message),
          siteName: typeof item.siteName === "string" ? item.siteName : undefined,
          physicalPath: typeof item.physicalPath === "string" ? item.physicalPath : undefined,
          binding: typeof item.binding === "string" ? item.binding : undefined,
          port: Number.isFinite(Number(item.port)) ? Number(item.port) : undefined,
          status: typeof item.status === "string" ? item.status : undefined,
          adoptable: typeof item.adoptable === "boolean" ? item.adoptable : undefined,
          verifiedWithNikon: typeof item.verifiedWithNikon === "boolean" ? item.verifiedWithNikon : undefined,
          pid: Number.isFinite(Number(item.pid)) ? Number(item.pid) : undefined,
          processName: typeof item.processName === "string" ? item.processName : undefined,
          source: typeof item.source === "string" ? item.source : undefined,
          recommendation: typeof item.recommendation === "string" ? item.recommendation : undefined,
          availablePorts: Array.isArray(item.availablePorts)
            ? item.availablePorts.map(Number).filter((portNumber: number) => Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535)
            : undefined,
          canChangePort: typeof item.canChangePort === "boolean" ? item.canChangePort : undefined
        };
      })
    },
    requiresAdmin: source.requiresAdmin === true,
    repairable: source.repairable === true,
    missingItems: stringArray(source.missingItems),
    warnings: stringArray(source.warnings),
    lastError: lastError.code || lastError.message
      ? { code: stringValue(lastError.code, "IIS_STATUS_CHECK_FAILED"), message: stringValue(lastError.message) }
      : null
  };
  return normalized;
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
