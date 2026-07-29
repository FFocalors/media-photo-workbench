import os from "os";
import type { CameraFtpConfig } from "../../config/config";

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
  pending: DetectionBoolean;
  processId: number | null;
  startName: string;
  serviceType: string;
}

export interface IisFtpServiceDependencyStatus extends IisFtpServiceStatus {}

export interface IisFtpUnrelatedSiteStatus {
  id: number;
  name: string;
  state: string;
}

export type IisFtpInitializationState =
  | "features_missing"
  | "restart_pending"
  | "config_not_ready"
  | "service_missing"
  | "service_disabled"
  | "service_stopped"
  | "service_pending"
  | "site_missing"
  | "ready"
  | "blocked";

export type IisFtpResumeState = "none" | "restart_required" | "ready_to_continue" | "blocked";

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
  serviceDependencies: IisFtpServiceDependencyStatus[];
  unrelatedAutoStartSites: IisFtpUnrelatedSiteStatus[];
  initializationState: IisFtpInitializationState;
  resumeState: IisFtpResumeState;
  completedStages: string[];
  nextStage: string;
  safeToRetry: boolean;
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
    service: { name: "ftpsvc", exists: null, status: "unknown", startType: "unknown", running: null, pending: null, processId: null, startName: "", serviceType: "" },
    serviceDependencies: [],
    unrelatedAutoStartSites: [],
    initializationState: "config_not_ready",
    resumeState: "none",
    completedStages: [],
    nextStage: "windows_features",
    safeToRetry: false,
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

function normalizeService(raw: unknown, fallback: IisFtpServiceStatus): IisFtpServiceStatus {
  const service = objectValue(raw);
  return {
    name: stringValue(service.name, fallback.name),
    exists: booleanValue(service.exists),
    status: stringValue(service.status, "unknown"),
    startType: stringValue(service.startType, "unknown"),
    running: booleanValue(service.running),
    pending: booleanValue(service.pending),
    processId: nullableNumber(service.processId),
    startName: stringValue(service.startName),
    serviceType: stringValue(service.serviceType)
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
    service: normalizeService(service, fallback.service),
    serviceDependencies: Array.isArray(source.serviceDependencies)
      ? source.serviceDependencies.map((item: unknown) => normalizeService(item, fallback.service))
      : [],
    unrelatedAutoStartSites: Array.isArray(source.unrelatedAutoStartSites)
      ? source.unrelatedAutoStartSites.map((item: unknown) => {
          const site = objectValue(item);
          return { id: numberValue(site.id, 0), name: stringValue(site.name), state: stringValue(site.state, "unknown") };
        }).filter((site) => site.id > 0 && site.name)
      : [],
    initializationState: ["features_missing", "restart_pending", "config_not_ready", "service_missing", "service_disabled", "service_stopped", "service_pending", "site_missing", "ready", "blocked"].includes(stringValue(source.initializationState))
      ? stringValue(source.initializationState) as IisFtpInitializationState
      : fallback.initializationState,
    resumeState: ["none", "restart_required", "ready_to_continue", "blocked"].includes(stringValue(source.resumeState))
      ? stringValue(source.resumeState) as IisFtpResumeState
      : fallback.resumeState,
    completedStages: stringArray(source.completedStages),
    nextStage: stringValue(source.nextStage, fallback.nextStage),
    safeToRetry: source.safeToRetry === true,
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
