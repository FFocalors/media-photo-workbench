/**
 * 前端 API 客户端。
 * 所有接口统一使用 { ok, data, error } 响应格式。
 * API 不可用时抛出错误，由调用方处理。
 */

// 声明全局类型已在 src/global.d.ts 中定义
import { getActorHeaders, getClientIdentity, getCurrentActor } from "./clientIdentity";

const CLIENT_API_BASE_KEY = "mediaPhotoWorkbench.clientApiBaseUrl";
const CLIENT_RECENT_HOSTS_KEY = "mediaPhotoWorkbench.clientRecentHosts";

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("主机地址必须以 http:// 或 https:// 开头");
  }
  return trimmed;
}

export function setClientApiBase(baseUrl: string): string {
  const normalized = normalizeApiBaseUrl(baseUrl);
  localStorage.setItem(CLIENT_API_BASE_KEY, normalized);
  saveRecentClientHost(normalized);
  return normalized;
}

export function getClientApiBase(): string {
  return localStorage.getItem(CLIENT_API_BASE_KEY) ?? getSameOriginApiBase() ?? "";
}

export function clearClientApiBase(): void {
  localStorage.removeItem(CLIENT_API_BASE_KEY);
}

export function getRecentClientHosts(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLIENT_RECENT_HOSTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentClientHost(baseUrl: string): void {
  const hosts = [baseUrl, ...getRecentClientHosts().filter((item) => item !== baseUrl)].slice(0, 6);
  localStorage.setItem(CLIENT_RECENT_HOSTS_KEY, JSON.stringify(hosts));
}

export function getApiBase(): string {
  if (window.location.pathname.startsWith("/client")) {
    const clientBase = getClientApiBase();
    if (clientBase) return clientBase;
  }

  // 生产 / 打包模式：页面由后端统一端口托管，直接使用当前页面同源地址。
  const sameOrigin = getSameOriginApiBase();
  if (sameOrigin) return sameOrigin;

  // 开发模式（Vite 5173）：使用 Electron preload 注入的真实 API 端口。
  const runtimeInfo = (window as any).mediaPhotoWorkbench?.getRuntimeInfo?.();
  if (runtimeInfo?.apiBaseUrl) return runtimeInfo.apiBaseUrl;

  // 兜底：preload legacy apiBaseUrl property
  const legacyApiBase = (window as any).mediaPhotoWorkbench?.apiBaseUrl;
  if (legacyApiBase) return legacyApiBase;

  // 最终兜底
  return "http://localhost:3030";
}

function getSameOriginApiBase(): string | null {
  const { protocol, host, port } = window.location;
  if ((protocol !== "http:" && protocol !== "https:") || !host) {
    return null;
  }

  // Vite 开发服务（5173）不提供 API，不要使用同源地址。
  if (port === "5173") {
    return null;
  }

  return `${protocol}//${host}`;
}

// ---------- 统一响应类型 ----------

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error: ApiError | null;
  operationId?: string;
}

export interface ApiError {
  code: string;
  title?: string;
  message: string;
  impact?: string;
  nextAction?: string;
  rollbackStatus?: string;
  operationId?: string;
  retryable?: boolean;
  technicalDetails?: string;
  details?: ApiErrorDetails;
}

export interface ApiErrorDetails {
  title?: string;
  impact?: string;
  nextAction?: string;
  advice?: string;
  rollbackStatus?: string;
  retryable?: boolean;
  technicalDetails?: string;
  operationId?: string;
  childOperationId?: string;
  parentOperationId?: string;
  operation?: string;
  scriptName?: string;
  stage?: string;
  technicalMessage?: string;
  exceptionType?: string;
  command?: string;
  siteName?: string;
  rollbackAttempted?: boolean;
  rollbackSucceeded?: boolean | null;
  exitCode?: number;
  timestamp?: string;
  warnings?: string[];
  conflict?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  completedSteps?: Array<Record<string, unknown>>;
  failedStep?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  provisioningPlan?: Record<string, unknown>;
}

/**
 * 通用请求封装。
 * 自动解析 JSON 并检查 ok 字段。
 */
async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${getApiBase()}${path}`, options);
  return parseApiResponse<T>(res);
}

async function requestFromBase<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${normalizeApiBaseUrl(baseUrl)}${path}`, options);
  return parseApiResponse<T>(res);
}

function redactErrorResponseText(value: string): string {
  return value
    .replace(/("?[\w.-]*(?:password|passphrase|secret|token|securestring|credential)[\w.-]*"?\s*[=:：]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[已隐藏]")
    .replace(/[A-Za-z]:\\+[^\r\n"',;}]+/g, "[路径已隐藏]")
    .replace(/\\\\+[^\r\n"',;}]+/g, "[路径已隐藏]");
}

function apiProtocolFailure<T>(input: {
  code: string;
  title: string;
  message: string;
  status: number;
  contentType: string;
  operationId?: string;
}): ApiResponse<T> {
  return {
    ok: false,
    data: null as T,
    error: {
      code: input.code,
      title: input.title,
      message: input.message,
      impact: "当前操作没有得到可确认的 API 结果。",
      nextAction: "请确认主机服务仍在运行后重试；若问题持续，请使用操作 ID 查看后端日志。",
      rollbackStatus: "unknown",
      operationId: input.operationId,
      retryable: true,
      technicalDetails: `HTTP ${input.status || "unknown"}；Content-Type: ${input.contentType || "unknown"}`
    },
    operationId: input.operationId
  };
}

export async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get("Content-Type") || "";
  const headerOperationId = res.headers.get("X-Operation-Id") || undefined;
  const rawText = await res.text();
  if (/\bjson\b/i.test(contentType)) {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(rawText);
    } catch {
      const failure = apiProtocolFailure<T>({
        code: "HTTP_INVALID_JSON_RESPONSE",
        title: "接口响应损坏",
        message: "接口声明返回 JSON，但内容不完整或无法解析。",
        status: res.status,
        contentType,
        operationId: headerOperationId
      });
      if (failure.error) failure.error.technicalDetails += "；JSON 解析失败";
      return failure;
    }

    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return apiProtocolFailure<T>({
        code: "HTTP_INVALID_JSON_ENVELOPE",
        title: "接口响应格式异常",
        message: "接口返回的 JSON 不符合统一响应格式。",
        status: res.status,
        contentType,
        operationId: headerOperationId
      });
    }

    const parsed = parsedValue as Record<string, unknown>;
    const bodyOperationId = typeof parsed.operationId === "string" ? parsed.operationId : undefined;
    const operationId = headerOperationId || bodyOperationId;
    const hasData = Object.prototype.hasOwnProperty.call(parsed, "data");
    const hasError = Object.prototype.hasOwnProperty.call(parsed, "error");
    const errorValue = parsed.error;
    const validError = Boolean(
      errorValue
      && typeof errorValue === "object"
      && !Array.isArray(errorValue)
      && typeof (errorValue as Record<string, unknown>).code === "string"
      && typeof (errorValue as Record<string, unknown>).message === "string"
    );
    const validSuccess = parsed.ok === true && hasData && hasError && errorValue === null;
    const validFailure = parsed.ok === false && hasData && parsed.data === null && hasError && validError;

    if (!validSuccess && !validFailure) {
      return apiProtocolFailure<T>({
        code: "HTTP_INVALID_JSON_ENVELOPE",
        title: "接口响应格式异常",
        message: "接口返回的 JSON 缺少有效的 ok、data 或 error 字段。",
        status: res.status,
        contentType,
        operationId
      });
    }
    if (validSuccess && !res.ok) {
      return apiProtocolFailure<T>({
        code: "HTTP_STATUS_ENVELOPE_MISMATCH",
        title: "接口状态不一致",
        message: "接口返回了失败的 HTTP 状态，但响应内容却声明操作成功；本次结果不会按成功处理。",
        status: res.status,
        contentType,
        operationId
      });
    }

    const normalized = { ...parsed, operationId } as unknown as ApiResponse<T>;
    if (validFailure && normalized.error && operationId) {
      normalized.error = { ...normalized.error, operationId };
    }
    return normalized;
  }

  const text = redactErrorResponseText(rawText);
  const operationId = headerOperationId;
  const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
  const message = looksLikeHtml
    ? "接口返回了前端页面而不是 JSON。请重启完整应用，确认本地后端已加载最新接口。"
    : (text.trim() || `接口返回非 JSON 响应，HTTP ${res.status}`);
  return {
    ok: false,
    data: null as T,
    error: {
      code: `HTTP_${res.status || "NON_JSON_RESPONSE"}`,
      title: looksLikeHtml ? "接口路由异常" : "接口响应异常",
      message,
      impact: "当前操作没有得到可确认的 API 结果。",
      nextAction: looksLikeHtml
        ? "请重启完整应用，并确认页面与本地后端来自同一版本。"
        : "请确认主机服务仍在运行后重试；若问题持续，请查看后端日志。",
      rollbackStatus: "unknown",
      operationId,
      retryable: true,
      technicalDetails: `HTTP ${res.status || "unknown"}；Content-Type: ${contentType || "unknown"}`
    },
    operationId
  };
}

function getActorHeadersToBody() {
  return getCurrentActor();
}

// ---------- Health ----------

export interface HealthData {
  service: string;
  server: { port: number; configuredPort?: number; status: string };
  database: { status: string; path?: string };
  repository: {
    configured: boolean;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    freeSpace: number | null;
    totalSpace: number | null;
    freeSpaceBytes?: number | null;
    totalSpaceBytes?: number | null;
    usedSpaceBytes?: number | null;
    freeSpaceText?: string;
    totalSpaceText?: string;
    capacityError?: string;
    path: string;
  };
  config: {
    loaded: boolean;
    server: { port: number };
    repository: { path: string };
  };
  network?: {
    localhost: string;
    lanAddresses: Array<{ name: string; address: string; family: string; internal: boolean }>;
    hotspotAddress: string;
  };
}

export async function fetchHealth(): Promise<ApiResponse<HealthData>> {
  return request<HealthData>("/api/health");
}

export async function fetchHealthFrom(baseUrl: string, options?: RequestInit): Promise<ApiResponse<HealthData>> {
  return requestFromBase<HealthData>(baseUrl, "/api/health", options);
}

// ---------- Online Clients ----------

export interface ClientPresenceData {
  clientId: string;
  clientName: string;
  displayName?: string;
  role: "client";
  connectedAt: string;
  lastSeenAt: string;
  userAgent?: string;
  address?: string;
}

export interface OnlineClientsData {
  clients: ClientPresenceData[];
}

export async function fetchOnlineClients(): Promise<ApiResponse<OnlineClientsData>> {
  return request<OnlineClientsData>("/api/clients/online");
}

// ---------- Settings ----------

export type BatchSelectionBehavior = "clear" | "keep";

export interface SettingsData {
  server: { port: number };
  repository: { path: string };
  database: {
    path: string;
    configuredPath?: string;
    defaultPath?: string;
    autoBackupEnabled: boolean;
    lastAutoBackupAt: string;
    autoBackupRetention: number;
  };
  gallery: {
    batchSelectionBehavior: BatchSelectionBehavior;
  };
  cameraFtp?: CameraFtpConfigData;
}

export async function fetchSettings(): Promise<ApiResponse<SettingsData>> {
  return request<SettingsData>("/api/settings");
}

export async function updateGallerySettings(input: {
  batchSelectionBehavior?: BatchSelectionBehavior;
}): Promise<ApiResponse<SettingsData["gallery"]>> {
  return request<SettingsData["gallery"]>("/api/settings/gallery", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

// ---------- Camera FTP ----------

export interface CameraFtpConfigData {
  provider: "iis";
  siteName: string;
  managedSiteId: number;
  username: string;
  accountManaged: boolean;
  activeEventId: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  firewallControlRuleName: string;
  firewallPassiveRuleName: string;
  passwordResetRequired: boolean;
  pendingProvisioning: CameraFtpPendingProvisioningData | null;
}

export interface CameraFtpPendingProvisioningData {
  action: "setup" | "repair" | "start" | "restart" | "adopt";
  eventId: string;
  username: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  targetSiteName: string;
  createdAt: string;
}

export type CameraFtpRecordStatus = "receiving" | "waiting" | "importing" | "imported" | "skipped" | "failed";

export type CameraFtpCheckState =
  | "ready"
  | "ok"
  | "running"
  | "installed"
  | "configured"
  | "missing"
  | "not_installed"
  | "not_configured"
  | "stopped"
  | "conflict"
  | "repair_required"
  | "failed"
  | "unknown";

export interface CameraFtpNetworkAddressData {
  id: string;
  label: string;
  address: string;
  interfaceName: string;
  kind: "hotspot" | "wlan" | "ethernet" | "lan";
  detected?: boolean;
  recommended?: boolean;
}

export interface CameraFtpRecentRecordData {
  id: string;
  filename: string;
  path?: string;
  eventId: string;
  eventName: string;
  status: CameraFtpRecordStatus;
  size: number;
  receivedAt: string;
  importedAt: string;
  detectedAt?: string;
  updatedAt: string;
  taskId?: string;
  reason?: string;
  error?: string;
}

export interface CameraFtpPlatformData {
  isWindows: boolean;
  isWindows11: boolean;
  supported: boolean;
  name?: string;
  version?: string;
  reason?: string;
}

export interface CameraFtpFeatureData {
  featureName: string;
  installed: boolean | null;
  state: CameraFtpCheckState | string;
  error?: string;
}

export interface CameraFtpWindowsFeaturesData {
  ftpService: CameraFtpFeatureData;
  ftpExtensibility: CameraFtpFeatureData;
  managementTools: CameraFtpFeatureData;
}

export interface CameraFtpServiceData {
  exists: boolean | null;
  name: string;
  status: string;
  startType: string;
  running: boolean | null;
  pending?: boolean | null;
  processId?: number | null;
  startName?: string;
  serviceType?: string;
  message?: string;
}

export interface CameraFtpSiteData {
  id: number | null;
  exists: boolean | null;
  name: string;
  status: string;
  started: boolean | null;
  physicalPath: string;
  binding: string;
  controlPort: number;
  sslEnabled: boolean | null;
  adoptable: boolean | null;
  managed: boolean | null;
}

export interface CameraFtpBindingData {
  value: string;
  host: string;
  port: number;
  allUnassigned: boolean | null;
  correct: boolean | null;
}

export interface CameraFtpAuthenticationData {
  basicEnabled: boolean | null;
  anonymousEnabled: boolean | null;
  correct: boolean | null;
}

export interface CameraFtpAuthorizationData {
  configured: boolean | null;
  username: string;
  read: boolean | null;
  write: boolean | null;
  correct: boolean | null;
}

export interface CameraFtpAccountData {
  username: string;
  exists: boolean | null;
  enabled: boolean | null;
  managed: boolean | null;
  description?: string;
  conflict?: boolean | null;
}

export interface CameraFtpActiveEventData {
  id: string;
  name: string;
  date: string;
  status: string;
  slug: string;
  valid: boolean;
}

export interface CameraFtpAclData {
  path: string;
  exists: boolean | null;
  read: boolean | null;
  write: boolean | null;
  correct: boolean | null;
  broadInheritedAccess: boolean | null;
}

export interface CameraFtpWatcherData {
  running: boolean;
  busy: boolean;
  directory: string;
  eventId: string;
  eventName: string;
  pendingCount: number;
  queuedCount: number;
  importingCount: number;
  unstableCount: number;
  lastReceivedAt: string;
  lastError: string;
  recentRecords: CameraFtpRecentRecordData[];
}

export interface CameraFtpPassivePortsData {
  start: number;
  end: number;
  configured: boolean | null;
  correct: boolean | null;
}

export interface CameraFtpFirewallRuleData {
  name: string;
  exists: boolean | null;
  enabled: boolean | null;
  profile: string;
  remoteAddress: string;
  correct: boolean | null;
}

export interface CameraFtpFirewallData {
  controlRule: CameraFtpFirewallRuleData;
  passiveRule: CameraFtpFirewallRuleData;
  correct: boolean | null;
}

export interface CameraFtpNetworkAddressesData {
  hotspot: CameraFtpNetworkAddressData | null;
  wlan: CameraFtpNetworkAddressData[];
  ethernet: CameraFtpNetworkAddressData[];
  lan: CameraFtpNetworkAddressData[];
  recommendedAddress: string;
  hotspotCandidate: string;
  warnings: string[];
}

export interface CameraFtpPortData {
  configuredPort: number;
  listening: boolean | null;
  pid?: number | null;
  processName?: string;
  ownedByMicrosoftFtp: boolean | null;
  conflict: boolean | null;
  reserved: boolean | null;
  reservedRange?: string;
  iisSiteName?: string;
  iisSiteNames: string[];
  ownedByManagedSite: boolean | null;
  adoptable: boolean | null;
  canChangePort: boolean;
  availablePorts: number[];
  recommendation?: string;
}

export interface CameraFtpConflictItemData {
  type: "port" | "site" | "user" | "path" | string;
  code: string;
  message: string;
  siteId?: number;
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

export interface CameraFtpConflictsData {
  portConflict: boolean | null;
  siteConflict: boolean | null;
  userConflict: boolean | null;
  pathConflict: boolean | null;
  items: CameraFtpConflictItemData[];
}

export interface CameraFtpStartupRecoveryWarningData {
  code: string;
  message: string;
}

export interface CameraFtpStartupRecoveryData {
  status: "restored" | "skipped" | "failed" | "already_running";
  checkedAt: string;
  decision: {
    action: "restore" | "keep" | "skip";
    status: "eligible" | "already_running" | "skipped";
    reasonCode: string;
    inspectionLevel: "full" | "partial" | "unknown" | "admin_required";
    shouldStartWatcher: boolean;
    shouldScan: boolean;
    warnings: CameraFtpStartupRecoveryWarningData[];
  };
  warnings: CameraFtpStartupRecoveryWarningData[];
}

export interface CameraFtpStatusData {
  provider: "iis";
  inspectionLevel: "full" | "partial";
  inspectionOutcome?: "confirmed" | "partial" | "unknown" | "admin_required";
  inspectionSource?: "ordinary" | "administrator";
  inspectedAt?: string;
  requiresAdminForFullInspection: boolean;
  requiresAdminForSystemChanges: boolean;
  platform: CameraFtpPlatformData;
  windowsFeatures: CameraFtpWindowsFeaturesData;
  service: CameraFtpServiceData;
  serviceDependencies: CameraFtpServiceData[];
  unrelatedAutoStartSites: Array<{ id: number; name: string; state: string }>;
  initializationState: "features_missing" | "restart_pending" | "config_not_ready" | "service_missing" | "service_disabled" | "service_stopped" | "service_pending" | "site_missing" | "ready" | "blocked";
  resumeState: "none" | "restart_required" | "ready_to_continue" | "blocked";
  completedStages: string[];
  nextStage: string;
  safeToRetry: boolean;
  pendingProvisioning: CameraFtpPendingProvisioningData | null;
  site: CameraFtpSiteData;
  binding: CameraFtpBindingData;
  authentication: CameraFtpAuthenticationData;
  authorization: CameraFtpAuthorizationData;
  account: CameraFtpAccountData;
  activeEvent: CameraFtpActiveEventData | null;
  ftpPath: string;
  acl: CameraFtpAclData;
  watcher: CameraFtpWatcherData;
  controlPort: number;
  passivePorts: CameraFtpPassivePortsData;
  firewall: CameraFtpFirewallData;
  port: CameraFtpPortData;
  networkAddresses: CameraFtpNetworkAddressesData;
  conflicts: CameraFtpConflictsData;
  warnings: string[];
  initialized: boolean;
  passwordConfigured: boolean;
  passwordResetRequired?: boolean;
  requiresAdmin: boolean;
  repairable: boolean;
  missingItems: string[];
  lastError: { code: string; message: string } | null;
  startupRecovery?: CameraFtpStartupRecoveryData | null;
}

export interface CameraFtpDiagnosticData {
  generatedAt: string;
  operationId: string;
  diagnosticRequestOperationId: string;
  platform: {
    os: string;
    arch: string;
    release: string;
    version: string;
  };
  ftp: {
    provider: "iis";
    siteName: string;
    managedSiteId: number | null;
    accountManaged: boolean;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    activeEvent: { id: string; name: string } | null;
    inspectionLevel: "full" | "partial";
    inspectionOutcome: "confirmed" | "partial" | "unknown" | "admin_required";
    inspectionSource: "ordinary" | "administrator";
    initialized: boolean;
    requiresAdmin: boolean;
    watcher: {
      running: boolean;
      busy: boolean;
      eventId: string;
      pendingCount: number;
      queuedCount: number;
      importingCount: number;
      unstableCount: number;
      lastScanAt: string;
    };
    lastErrorCode: string | null;
  };
}

export interface CameraFtpOperationData {
  action: "setup" | "adopt-site" | "start" | "stop" | "restart" | "repair" | "credentials" | "active-event" | "open-folder";
  status: "pending" | "running" | "success" | "failed";
  message: string;
  operationId?: string;
  steps?: Array<{ id?: string; label: string; status: "pending" | "running" | "success" | "failed"; message?: string }>;
  requiresAdmin?: boolean;
}

export type CameraFtpProvisioningGoal = "setup" | "repair" | "start" | "restart" | "adopt-site";

export type CameraFtpProvisioningPlanItemStatus =
  | "already_ok"
  | "create"
  | "update"
  | "repair"
  | "user_confirmation_required"
  | "blocked";

export type CameraFtpIssueLevel = "info" | "auto_repair" | "user_confirmation" | "blocked";

export interface CameraFtpProvisioningPlanItemData {
  id: string;
  category: string;
  label: string;
  summary: string;
  status: CameraFtpProvisioningPlanItemStatus;
  managedResource: boolean;
  confirmationKey?: string;
  risk: "normal" | "high" | string;
}

export interface CameraFtpProvisioningConfirmationData {
  key: string;
  title: string;
  message: string;
  risk: "normal" | "high" | string;
}

export interface CameraFtpIssueData {
  id: string;
  code: string;
  level: CameraFtpIssueLevel;
  title: string;
  message: string;
  planItemId?: string;
}

export interface CameraFtpProvisioningPlanData {
  planId: string;
  operationId?: string;
  target: CameraFtpProvisioningGoal;
  summary: string;
  items: CameraFtpProvisioningPlanItemData[];
  requiresAdmin: boolean;
  canApply: boolean;
  generatedAt: string;
  confirmations: CameraFtpProvisioningConfirmationData[];
  issues: CameraFtpIssueData[];
}

export interface CameraFtpActionData {
  operation: CameraFtpOperationData;
  status: CameraFtpStatusData;
  path?: string;
}

export type CameraFtpAdminOperationState =
  | "idle"
  | "running"
  | "timed_out_waiting"
  | "completed"
  | "failed"
  | "abandoned";

export interface CameraFtpAdminOperationData {
  state: CameraFtpAdminOperationState;
  operationId?: string;
  parentOperationId?: string;
  action?: string;
  scriptName?: string;
  stage?: string;
  phaseIndex: number;
  phaseCount: number;
  progressPercent: number;
  indeterminate: boolean;
  startedAt?: string;
  stageStartedAt?: string;
  lastProgressAt?: string;
  elapsedMs: number;
  estimatedRemainingMinMs: number | null;
  estimatedRemainingMaxMs: number | null;
  estimateExceeded: boolean;
  processId?: number;
  safeToRetry: boolean;
}

export interface CameraFtpSiteDiscoveryData {
  sites: CameraFtpConflictItemData[];
  status: CameraFtpStatusData;
}

export async function fetchCameraFtpStatus(forceSystemRefresh = false): Promise<ApiResponse<CameraFtpStatusData>> {
  return request<CameraFtpStatusData>(`/api/camera-ftp/status${forceSystemRefresh ? "?refresh=1" : ""}`);
}

export async function fetchCameraFtpAdminOperation(): Promise<ApiResponse<CameraFtpAdminOperationData>> {
  return request<CameraFtpAdminOperationData>("/api/camera-ftp/admin-operation");
}

export async function fetchCameraFtpDiagnostics(): Promise<ApiResponse<CameraFtpDiagnosticData>> {
  return request<CameraFtpDiagnosticData>("/api/camera-ftp/diagnostics");
}

export function clearCameraFtpPendingProvisioning(): Promise<ApiResponse<CameraFtpStatusData>> {
  return request<CameraFtpStatusData>("/api/camera-ftp/pending-provisioning", { method: "DELETE" });
}

function postCameraFtpAction<T = CameraFtpActionData>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  return request<T>(`/api/camera-ftp/${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export function prepareCameraFtpProvisioning(input: {
  goal: CameraFtpProvisioningGoal;
  eventId?: string;
  username?: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  targetSiteName?: string;
  targetSiteId?: number;
}): Promise<ApiResponse<CameraFtpProvisioningPlanData>> {
  return postCameraFtpAction<CameraFtpProvisioningPlanData>("provisioning-plan", input);
}

export function setupCameraFtp(input: {
  eventId: string;
  username: string;
  password: string;
  confirmPassword: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  allowLegacyFirewallRuleUpdate?: boolean;
  allowAclTightening?: boolean;
  allowSharedFtpServiceStart?: boolean;
}): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("setup", { ...input, confirm: true });
}

export function adoptCameraFtpSite(siteName: string, input?: {
  eventId?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
  controlPort?: number;
  passivePortStart?: number;
  passivePortEnd?: number;
  allowLegacyFirewallRuleUpdate?: boolean;
  allowAclTightening?: boolean;
  allowSharedFtpServiceStart?: boolean;
}): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("adopt-site", { siteName, ...input, confirm: true });
}

export function discoverCameraFtpSites(input: {
  eventId?: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
}): Promise<ApiResponse<CameraFtpSiteDiscoveryData>> {
  return postCameraFtpAction<CameraFtpSiteDiscoveryData>("discover-sites", input);
}

export function startCameraFtp(input?: { allowAclTightening?: boolean; allowSharedFtpServiceStart?: boolean }): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("start", input);
}

export function stopCameraFtp(): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("stop");
}

export function restartCameraFtp(input?: { allowAclTightening?: boolean; allowSharedFtpServiceStart?: boolean }): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("restart", input);
}

export function repairCameraFtp(input: { password?: string; controlPort: number; passivePortStart: number; passivePortEnd: number; allowLegacyFirewallRuleUpdate?: boolean; allowAclTightening?: boolean; allowSharedFtpServiceStart?: boolean }): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("repair", { ...input, confirm: true });
}

export interface CameraFtpPortCheckData {
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  inspectionLevel: "partial" | "full";
  requiresAdminForFullInspection: boolean;
  port: CameraFtpPortData;
  conflicts: CameraFtpConflictsData;
}

export function checkCameraFtpPort(input: { controlPort: number; passivePortStart: number; passivePortEnd: number; fullInspection?: boolean }): Promise<ApiResponse<CameraFtpPortCheckData>> {
  return postCameraFtpAction<CameraFtpPortCheckData>("check-port", input);
}

export function updateCameraFtpCredentials(input: { username: string; password: string }): Promise<ApiResponse<CameraFtpActionData>> {
  return request<CameraFtpActionData>("/api/camera-ftp/credentials", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateCameraFtpActiveEvent(eventId: string): Promise<ApiResponse<CameraFtpActionData>> {
  return request<CameraFtpActionData>("/api/camera-ftp/active-event", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId })
  });
}

export function clearCameraFtpActiveEvent(): Promise<ApiResponse<CameraFtpActionData>> {
  return request<CameraFtpActionData>("/api/camera-ftp/active-event", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId: "", unlink: true, confirm: true })
  });
}

export function openCameraFtpFolder(): Promise<ApiResponse<CameraFtpActionData>> {
  return postCameraFtpAction("open-folder");
}

export interface DatabaseBackupData {
  backupPath: string;
  size: number;
  createdAt: string;
  method: "sqlite-backup";
  kind: "manual" | "auto" | "migration";
}

export interface DatabaseBackupListItem {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  kind: "manual" | "auto" | "migration" | "unknown";
}

export interface DatabaseMigrationData {
  oldPath: string;
  newPath: string;
  backupPath: string;
  requiresRestart: boolean;
}

export async function backupDatabaseNow(): Promise<ApiResponse<DatabaseBackupData>> {
  return request<DatabaseBackupData>("/api/settings/database/backup", {
    method: "POST"
  });
}

export async function fetchDatabaseBackups(): Promise<ApiResponse<DatabaseBackupListItem[]>> {
  return request<DatabaseBackupListItem[]>("/api/settings/database/backups");
}

export async function migrateDatabaseLocation(input: {
  targetDirectory?: string;
  targetPath?: string;
}): Promise<ApiResponse<DatabaseMigrationData>> {
  return request<DatabaseMigrationData>("/api/settings/database/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

// ---------- Repository ----------

export interface RepositoryCheckData {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  freeSpace: number | null;
  totalSpace: number | null;
  freeSpaceBytes?: number | null;
  totalSpaceBytes?: number | null;
  usedSpaceBytes?: number | null;
  freeSpaceText?: string;
  totalSpaceText?: string;
  capacityError?: string;
  path: string;
}

export async function checkRepository(): Promise<ApiResponse<RepositoryCheckData>> {
  return request<RepositoryCheckData>("/api/repository/check");
}

export interface UpdateRepositoryData extends RepositoryCheckData {
  saved: boolean;
}

export async function updateRepositoryPath(
  repoPath: string
): Promise<ApiResponse<UpdateRepositoryData>> {
  return request<UpdateRepositoryData>("/api/settings/repository", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath })
  });
}

// ---------- Events ----------

export interface EventData {
  id: string;
  name: string;
  slug: string;
  date: string;
  location: string;
  status: string;
  total_images: number;
  selected_images: number;
  created_at: string;
  updated_at: string;
}

export const eventStatusLabels = {
  draft: "草稿",
  active: "进行中",
  reviewing: "选片中",
  archived: "已归档",
  deleted: "已删除"
} as const;

export type EventStatus = keyof typeof eventStatusLabels;

export interface CreateEventData {
  event: EventData;
  workingDir: { created: boolean; path: string };
}

export async function fetchEvents(status?: string): Promise<ApiResponse<EventData[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<EventData[]>(`/api/events${query}`);
}

export async function fetchEventTrash(): Promise<ApiResponse<EventData[]>> {
  return request<EventData[]>("/api/events/trash");
}

export async function fetchEventById(id: string): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`);
}

export interface EventSummaryData {
  event_id: string;
  total_images: number;
  edited_images: number;
}

export async function fetchEventSummary(eventId: string): Promise<ApiResponse<EventSummaryData>> {
  return request<EventSummaryData>(`/api/events/${eventId}/summary`);
}

export async function createEvent(input: {
  name: string;
  slug?: string;
  date: string;
  location?: string;
}): Promise<ApiResponse<CreateEventData>> {
  return request<CreateEventData>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateEvent(
  id: string,
  input: { name?: string; date?: string; location?: string }
): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateEventStatus(
  id: string,
  status: EventStatus
): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export async function deleteEvent(id: string): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`, {
    method: "DELETE"
  });
}

export async function restoreEvent(id: string, status: "active" | "draft" = "active"): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}/restore`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export interface EventPurgeData {
  eventId: string;
  eventName: string;
  workingPath: string;
  archivePath: string;
  includeArchive: boolean;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: {
    events: number;
    images: number;
    imageTags: number;
    downloadLogs: number;
    exportJobs: number;
    operationLogs: number;
    archivedEvents: number;
  };
}

export async function purgeEvent(id: string, includeArchive = true): Promise<ApiResponse<EventPurgeData>> {
  return request<EventPurgeData>(`/api/events/${id}/purge`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ includeArchive })
  });
}

// ---------- Import ----------

export interface ImportScanFile {
  filename: string;
  path: string;
  size: number;
  extension: string;
}

export interface ImportScanData {
  eventId: string;
  folderPath: string;
  count: number;
  totalSize: number;
  files: ImportScanFile[];
}

export interface ImportErrorItem {
  filename: string;
  path: string;
  reason: string;
}

export interface ImportedImageSummary {
  id: string;
  originalFilename: string;
  storedFilename: string;
  originalPath: string;
  thumbPath: string;
  previewPath: string;
}

export interface ImportStartData {
  eventId: string;
  folderPath: string;
  sourceType: "host_import" | "client_upload" | "camera_ftp";
  total: number;
  success: number;
  failed: number;
  skipped: number;
  imported: ImportedImageSummary[];
  errors: ImportErrorItem[];
}

export interface ImportTaskStartData {
  taskId: string;
  total: number;
  mode: "folder" | "files";
}

export type ImportStartInput = string | {
  folderPath?: string;
  filePaths?: string[];
};

export async function scanImportFolder(eventId: string, folderPath: string): Promise<ApiResponse<ImportScanData>> {
  return request<ImportScanData>(`/api/events/${eventId}/import/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath })
  });
}

export async function startImport(eventId: string, input: ImportStartInput): Promise<ApiResponse<ImportStartData | ImportTaskStartData>> {
  const body = typeof input === "string" ? { folderPath: input } : input;
  return request<ImportStartData | ImportTaskStartData>(`/api/events/${eventId}/import/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export interface ClientUploadData extends ImportStartData {
  photographer: string;
  device: string;
  remark: string;
}

export interface ClientUploadTaskData {
  taskId: string;
  total: number;
  photographer: string;
  device: string;
  remark: string;
  clientId?: string;
  clientName?: string;
  clientRole?: string;
}

export async function uploadClientImages(
  eventId: string,
  input: {
    files: File[];
    photographer?: string;
    device?: string;
    remark?: string;
  }
): Promise<ApiResponse<ClientUploadData | ClientUploadTaskData>> {
  const formData = new FormData();
  for (const file of input.files) {
    formData.append("files", file);
  }
  formData.append("photographer", input.photographer ?? "");
  formData.append("device", input.device ?? "");
  formData.append("remark", input.remark ?? "");
  const identity = getClientIdentity();
  formData.append("clientId", identity.clientId);
  formData.append("clientName", input.device?.trim() || identity.clientName || "客户端");
  formData.append("clientRole", "client");

  return request<ClientUploadData | ClientUploadTaskData>(`/api/events/${eventId}/upload`, {
    method: "POST",
    body: formData
  });
}

// ---------- Images ----------

export const imageStatusLabels = {
  unselected: "未筛选",
  rejected: "废片",
  archive: "留档",
  edit: "待修图",
  edited: "已修图",
  publish: "可发布",
  published: "已发布"
} as const;

export type ImageStatus = keyof typeof imageStatusLabels;

export const imageStatusOptions = Object.keys(imageStatusLabels) as ImageStatus[];

export interface EventImageData {
  id: string;
  event_id: string;
  original_filename: string;
  stored_filename: string;
  thumb_url: string;
  preview_url: string;
  file_size: number;
  width: number;
  height: number;
  shot_at: string;
  imported_at: string;
  rating: number;
  status: ImageStatus;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  source_type: string;
  uploaded_by_client_id: string;
  uploaded_by_name: string;
  uploaded_by_role: string;
  uploaded_at: string;
  edited_available: boolean;
  original_exists: boolean;
  thumb_exists: boolean;
  preview_exists: boolean;
  edited_exists: boolean;
  is_deleted: boolean;
  deleted_at: string;
  original_path?: string;
  thumb_path?: string;
  preview_path?: string;
  edited_path?: string;
}

export interface EventImagesParams {
  page?: number;
  pageSize?: number;
  rating?: number;
  ratingMode?: "eq" | "gte";
  status?: ImageStatus | "all";
  source_type?: string;
  uploadedByClientId?: string;
  keyword?: string;
}

export interface EventImagesData {
  items: EventImageData[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizeImageData(image: EventImageData): EventImageData {
  const originalExists = typeof image.original_exists === "boolean" ? image.original_exists : true;
  const thumbExists = typeof image.thumb_exists === "boolean" ? image.thumb_exists : true;
  const previewExists = typeof image.preview_exists === "boolean" ? image.preview_exists : true;
  const editedExists = typeof image.edited_exists === "boolean" ? image.edited_exists : Boolean(image.edited_available);

  return {
    ...image,
    edited_available: typeof image.edited_available === "boolean" ? image.edited_available : editedExists,
    original_exists: originalExists,
    thumb_exists: thumbExists,
    preview_exists: previewExists,
    edited_exists: editedExists,
    is_deleted: typeof image.is_deleted === "boolean" ? image.is_deleted : false,
    deleted_at: image.deleted_at ?? "",
    uploaded_by_client_id: image.uploaded_by_client_id ?? (image.source_type === "host_import" ? "host" : image.source_type === "camera_ftp" ? "camera_ftp" : ""),
    uploaded_by_name: image.uploaded_by_name ?? (image.source_type === "camera_ftp" ? "相机 FTP" : ""),
    uploaded_by_role: image.uploaded_by_role ?? (image.source_type === "camera_ftp" ? "camera" : ""),
    uploaded_at: image.uploaded_at ?? image.imported_at ?? ""
  };
}

function normalizeImageResponse(response: ApiResponse<EventImageData>): ApiResponse<EventImageData> {
  if (!response.ok || !response.data) {
    return response;
  }

  return {
    ...response,
    data: normalizeImageData(response.data)
  };
}

export async function fetchEventImages(eventId: string, params: EventImagesParams = {}): Promise<ApiResponse<EventImagesData>> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const response = await request<EventImagesData>(`/api/events/${eventId}/images${query ? `?${query}` : ""}`);
  if (!response.ok || !response.data) {
    return response;
  }

  return {
    ...response,
    data: {
      ...response.data,
      items: response.data.items.map(normalizeImageData)
    }
  };
}

export async function fetchEventTrashedImages(eventId: string, params: EventImagesParams = {}): Promise<ApiResponse<EventImagesData>> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const response = await request<EventImagesData>(`/api/events/${eventId}/images/trash${query ? `?${query}` : ""}`);
  if (!response.ok || !response.data) {
    return response;
  }

  return {
    ...response,
    data: {
      ...response.data,
      items: response.data.items.map(normalizeImageData)
    }
  };
}

export interface EventUploaderData {
  clientId: string;
  clientName: string;
  sourceType: string;
  count: number;
}

export async function fetchEventUploaders(eventId: string): Promise<ApiResponse<EventUploaderData[]>> {
  return request<EventUploaderData[]>(`/api/events/${eventId}/uploaders`);
}

export async function updateImageRating(id: string, rating: number): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/rating`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getActorHeaders() },
    body: JSON.stringify({ rating, actor: getActorHeadersToBody() })
  });
  return normalizeImageResponse(response);
}

export async function updateImageStatus(id: string, status: ImageStatus): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getActorHeaders() },
    body: JSON.stringify({ status, actor: getActorHeadersToBody() })
  });
  return normalizeImageResponse(response);
}

export async function updateImageCategory(id: string, category: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getActorHeaders() },
    body: JSON.stringify({ category, actor: getActorHeadersToBody() })
  });
  return normalizeImageResponse(response);
}

export async function updateImageRemark(id: string, remark: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/remark`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getActorHeaders() },
    body: JSON.stringify({ remark, actor: getActorHeadersToBody() })
  });
  return normalizeImageResponse(response);
}

export async function deleteImage(id: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}`, {
    method: "DELETE",
    headers: getActorHeaders()
  });
  return normalizeImageResponse(response);
}

export async function restoreImage(id: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/restore`, {
    method: "PATCH",
    headers: getActorHeaders()
  });
  return normalizeImageResponse(response);
}

export interface ImagePurgeData {
  imageId: string;
  eventId: string;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: number;
}

export async function purgeImage(id: string): Promise<ApiResponse<ImagePurgeData>> {
  return request<ImagePurgeData>(`/api/images/${id}/purge`, {
    method: "DELETE"
  });
}

export type ImageDownloadType = "original" | "preview" | "edited";

export function getImageDownloadUrl(id: string, type: ImageDownloadType): string {
  return `${getApiBase()}/api/images/${encodeURIComponent(id)}/download/${type}`;
}

function getFilenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

export async function downloadImageFile(id: string, type: ImageDownloadType, fallbackFilename = "image"): Promise<void> {
  const res = await fetch(getImageDownloadUrl(id, type));

  if (!res.ok) {
    let message = "下载失败";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Tasks ----------

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface TaskErrorItem {
  filename?: string;
  path?: string;
  imageId?: string;
  reason: string;
}

export interface TaskData {
  id: string;
  taskId?: string;
  type: string;
  eventId: string;
  title: string;
  status: TaskStatus;
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: TaskErrorItem[];
  result: Record<string, any> | null;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  currentFileName: string;
}

export async function fetchTasks(): Promise<ApiResponse<TaskData[]>> {
  return request<TaskData[]>("/api/tasks");
}

export async function fetchTask(taskId: string): Promise<ApiResponse<TaskData>> {
  return request<TaskData>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function cancelTask(taskId: string): Promise<ApiResponse<TaskData>> {
  return request<TaskData>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST"
  });
}

// ---------- Batch ZIP Download ----------

export type DownloadZipType = "original" | "preview" | "edited" | "best";
export type DownloadZipFilenameMode = "original" | "sequence";

export interface CreateDownloadZipTaskData {
  taskId: string;
}

export async function createDownloadZipTask(
  eventId: string,
  input: {
    imageIds: string[];
    type?: DownloadZipType;
    filenameMode?: DownloadZipFilenameMode;
  }
): Promise<ApiResponse<CreateDownloadZipTaskData>> {
  return request<CreateDownloadZipTaskData>(`/api/events/${eventId}/download/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getDownloadPackageUrl(packageId: string): string {
  return `${getApiBase()}/api/download-packages/${encodeURIComponent(packageId)}/download`;
}

// ---------- Edit Workflow ----------

export interface EditPackageError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface EditPackageData {
  packageId: string;
  name: string;
  packageIndex: number;
  packageTotal: number;
  packagePath: string;
  downloadUrl: string;
  total: number;
  success: number;
  skipped: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  errors: EditPackageError[];
}

export interface DeleteEditPackageData {
  packageId: string;
  eventId: string;
  deletedFiles: string[];
  missingFiles: string[];
  deletedRecords: {
    exportJobs: number;
  };
}

export interface EditPackageWarning {
  type: "duplicatedImageIds";
  imageIds: string[];
  reason: string;
}

export interface EditPackagesData {
  eventId: string;
  splitMode: "count" | "custom";
  packageCount: number;
  packages: EditPackageData[];
  total: number;
  success: number;
  skipped: number;
  errors: EditPackageError[];
  warnings: EditPackageWarning[];
}

export async function createEditPackage(
  eventId: string,
  input: {
    splitMode?: "count" | "custom";
    packageCount?: number;
    packages?: Array<{ name: string; imageIds: string[] }>;
  } = {}
): Promise<ApiResponse<EditPackagesData>> {
  return request<EditPackagesData>(`/api/events/${eventId}/edit-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function fetchEditPackages(eventId: string): Promise<ApiResponse<EditPackageData[]>> {
  return request<EditPackageData[]>(`/api/events/${eventId}/edit-packages`);
}

export async function deleteEditPackage(packageId: string): Promise<ApiResponse<DeleteEditPackageData>> {
  return request<DeleteEditPackageData>(`/api/edit-packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE"
  });
}

export function getEditPackageDownloadUrl(packageId: string): string {
  return `${getApiBase()}/api/edit-packages/${encodeURIComponent(packageId)}/download`;
}

export async function downloadEditPackage(packageId: string, fallbackFilename = "待修包.zip"): Promise<void> {
  const res = await fetch(getEditPackageDownloadUrl(packageId));

  if (!res.ok) {
    let message = "待修包下载失败";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface EditedUploadError {
  filename: string;
  reason: string;
}

export interface EditedUploadItem {
  imageId: string;
  originalFilename: string;
  uploadedFilename: string;
  editedPath: string;
  matchedBy: "manifest" | "filename";
  status: "edited";
}

export interface EditedUploadData {
  total: number;
  matched: number;
  unmatched: number;
  errors: EditedUploadError[];
  items: EditedUploadItem[];
}

export interface EditedUploadTaskData {
  taskId: string;
  total: number;
  mode: "edited_upload";
}

export async function uploadEditedImages(
  eventId: string,
  input: {
    files: File[];
    manifestFile?: File | null;
  }
): Promise<ApiResponse<EditedUploadData | EditedUploadTaskData>> {
  const formData = new FormData();
  if (input.manifestFile) {
    formData.append("manifest", input.manifestFile);
  }
  for (const file of input.files) {
    formData.append("files", file);
  }

  return request<EditedUploadData | EditedUploadTaskData>(`/api/events/${eventId}/edited/upload`, {
    method: "POST",
    body: formData
  });
}

// ---------- Publish Export ----------

export type PublishExportMode = "selected" | "publish" | "edited" | "rating";
export type PublishExportSize = "original" | "3000px" | "1920px";
export type PublishExportFilenameMode = "original" | "event_original" | "sequence";

export interface PublishExportError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface PublishExportData {
  jobId: string;
  eventId: string;
  mode: PublishExportMode;
  size: PublishExportSize;
  quality: number;
  filenameMode: PublishExportFilenameMode;
  limitFileSize10Mb: boolean;
  status: "success" | "failed";
  total: number;
  success: number;
  failed: number;
  outputDir: string;
  zipPath: string;
  downloadUrl: string;
  errors: PublishExportError[];
  createdAt: string;
  updatedAt: string;
}

export async function createPublishExport(
  eventId: string,
  input: {
    mode: PublishExportMode;
    imageIds?: string[];
    ratingMin?: number;
    size: PublishExportSize;
    quality: number;
    filenameMode?: PublishExportFilenameMode;
    limitFileSize10Mb?: boolean;
  }
): Promise<ApiResponse<PublishExportData>> {
  return request<PublishExportData>(`/api/events/${eventId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function fetchPublishExport(jobId: string): Promise<ApiResponse<PublishExportData>> {
  return request<PublishExportData>(`/api/exports/${encodeURIComponent(jobId)}`);
}

export function getPublishExportDownloadUrl(jobId: string): string {
  return `${getApiBase()}/api/exports/${encodeURIComponent(jobId)}/download`;
}

export async function downloadPublishExport(jobId: string, fallbackFilename = "publish.zip"): Promise<void> {
  const res = await fetch(getPublishExportDownloadUrl(jobId));

  if (!res.ok) {
    let message = "发布包下载失败";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Archive ----------

export interface ArchiveMissingFile {
  imageId?: string;
  type: "original" | "edited" | "export";
  sourcePath: string;
  reason: string;
}

export interface ArchivePrepareData {
  archivePath: string;
  totalImages: number;
  thumbCopied: number;
  originalCopied: number;
  editedCopied: number;
  exportCopied: number;
  missingFiles: ArchiveMissingFile[];
  manifestPath: string;
  eventDbPath: string;
}

export interface ArchiveVerifyData {
  archivePath: string;
  verified: boolean;
  missingFiles: string[];
  mismatchedFiles: Array<{ path: string; expectedHash: string; actualHash: string }>;
  checkedAt: string;
}

export interface ArchivedEventData {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_date: string;
  total_images: number;
  edited_images: number;
  published_images: number;
  archive_path: string;
  archived_at: string;
}

export interface ArchiveMetadataFileStatus {
  name: string;
  path: string;
  exists: boolean;
  size: number;
}

export interface ArchivedImageSummary {
  image_id: string;
  original_filename: string;
  stored_filename: string;
  rating: number;
  status: string;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  shot_at: string;
  original_path: string;
  edited_path: string;
  file_hash: string;
  thumb_url: string;
  thumb_archive_path: string;
  has_thumb: boolean;
  has_original: boolean;
  has_edited: boolean;
  original_retained: boolean;
  edited_retained: boolean;
}

export interface ArchivedEventDetailData {
  archivedEvent: ArchivedEventData;
  event: {
    id: string;
    name: string;
    slug: string;
    date: string;
    status: "archived";
  };
  archivePath: string;
  archivedAt: string;
  counts: {
    total_images: number;
    thumb_files: number;
    original_files: number;
    edited_files: number;
    export_files: number;
    missing_files: number;
  };
  files: Array<{
    image_id: string;
    type: "thumb" | "original" | "edited" | "export";
    source_path: string;
    archive_path: string;
    exists: boolean;
    file_hash: string;
    size: number;
  }>;
  images: ArchivedImageSummary[];
  missingFiles: string[];
  metadataFiles: ArchiveMetadataFileStatus[];
}

export interface ArchivedEventDeleteData {
  id: string;
  eventId: string;
  archivePath: string;
  deletedArchive: boolean;
  missingFiles: string[];
  deletedRecords: {
    archivedEvents: number;
  };
}

export interface ArchiveCleanupData {
  eventId: string;
  status: "archived";
  workingDir: string;
  archivePath: string;
  cleaned: boolean;
  archivedEvent: ArchivedEventData;
}

export interface ArchiveCleanupTaskData {
  taskId: string;
  total: number;
  mode: "archive_cleanup";
}

export async function prepareEventArchive(eventId: string): Promise<ApiResponse<ArchivePrepareData>> {
  return request<ArchivePrepareData>(`/api/events/${eventId}/archive/prepare`, {
    method: "POST"
  });
}

export async function verifyEventArchive(eventId: string, archivePath?: string): Promise<ApiResponse<ArchiveVerifyData>> {
  return request<ArchiveVerifyData>(`/api/events/${eventId}/archive/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archivePath })
  });
}

export async function cleanupEventArchive(eventId: string, archivePath: string): Promise<ApiResponse<ArchiveCleanupData | ArchiveCleanupTaskData>> {
  return request<ArchiveCleanupData | ArchiveCleanupTaskData>(`/api/events/${eventId}/archive/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, archivePath })
  });
}

export async function fetchArchivedEvents(): Promise<ApiResponse<ArchivedEventData[]>> {
  return request<ArchivedEventData[]>("/api/archived-events");
}

export async function fetchArchivedEventDetail(id: string): Promise<ApiResponse<ArchivedEventDetailData>> {
  return request<ArchivedEventDetailData>(`/api/archived-events/${encodeURIComponent(id)}`);
}

export async function deleteArchivedEvent(id: string): Promise<ApiResponse<ArchivedEventDeleteData>> {
  return request<ArchivedEventDeleteData>(`/api/archived-events/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
