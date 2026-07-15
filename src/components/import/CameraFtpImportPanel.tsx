import {
  Activity,
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Wifi,
  Wrench
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Notice, StatusPill } from "../ui/States";
import {
  adoptCameraFtpSite,
  checkCameraFtpPort,
  clearCameraFtpActiveEvent,
  type ApiResponse,
  type CameraFtpActionData,
  type CameraFtpConflictItemData,
  type CameraFtpNetworkAddressData,
  type CameraFtpOperationData,
  type CameraFtpPortCheckData,
  type CameraFtpProvisioningGoal,
  type CameraFtpProvisioningPlanData,
  type CameraFtpRecentRecordData,
  type CameraFtpStatusData,
  type CameraFtpWatcherData,
  type EventData,
  eventStatusLabels,
  fetchCameraFtpStatus,
  fetchEvents,
  discoverCameraFtpSites,
  openCameraFtpFolder,
  prepareCameraFtpProvisioning,
  repairCameraFtp,
  restartCameraFtp,
  setupCameraFtp,
  startCameraFtp,
  stopCameraFtp,
  updateCameraFtpActiveEvent,
  updateCameraFtpCredentials
} from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  buildCameraFtpErrorPresentation,
  buildCameraFtpStatusIssues,
  cameraFtpPlanCanApply,
  CAMERA_FTP_ISSUE_LEVEL_META,
  CAMERA_FTP_PLAN_ITEM_STATUS_META,
  getCameraFtpProvisioningProgress,
  getCameraFtpButtonState,
  groupCameraFtpIssues,
  localizeCameraFtpUiWarning,
  validateCameraFtpPortSettings,
  type CameraFtpErrorPresentation
} from "./cameraFtpUiState";

type MessageState = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
  diagnostic?: CameraFtpErrorPresentation;
};

type ConfirmableAction = Exclude<CameraFtpOperationData["action"], "open-folder">;

type PendingAction = {
  kind: ConfirmableAction;
  title: string;
  description: string;
  confirmLabel: string;
  tone: "info" | "success" | "warning" | "danger";
  siteName?: string;
  username?: string;
  unlink?: boolean;
  useCredentialForm?: boolean;
  allowLegacyFirewallRuleUpdate?: boolean;
  firewallRuleChanges?: FirewallRuleChangePreview[];
  plan?: CameraFtpProvisioningPlanData;
};

type FirewallRuleChangePreview = {
  kind: "control" | "passive";
  internalName: string;
  currentPort: string;
  currentRemoteAddress: string;
  targetPort: string;
  targetRemoteAddress: string;
};

type AddressOption = CameraFtpNetworkAddressData & { candidate?: boolean };

const DEFAULT_USERNAME = "camera";
const DEFAULT_HOTSPOT_ADDRESS = "192.168.137.1";
const DEFAULT_CONTROL_PORT = 21;
const PASSIVE_PORT_START = 50000;
const PASSIVE_PORT_END = 50100;

const PROVISIONING_ACTIONS: CameraFtpProvisioningGoal[] = ["setup", "repair", "start", "restart", "adopt-site"];

function isProvisioningAction(action: string | null): action is CameraFtpProvisioningGoal {
  return PROVISIONING_ACTIONS.includes(action as CameraFtpProvisioningGoal);
}

function firewallRuleChangePreviews(value: unknown): FirewallRuleChangePreview[] {
  if (!value || typeof value !== "object") return [];
  const changes = (value as Record<string, unknown>).changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const rule = item as Record<string, unknown>;
    const current = rule.current && typeof rule.current === "object" ? rule.current as Record<string, unknown> : {};
    const target = rule.target && typeof rule.target === "object" ? rule.target as Record<string, unknown> : {};
    return [{
      kind: rule.kind === "passive" ? "passive" : "control",
      internalName: typeof rule.internalName === "string" ? rule.internalName : "未知规则",
      currentPort: String(current.localPort || "未知"),
      currentRemoteAddress: String(current.remoteAddress || "未知"),
      targetPort: String(target.localPort || "未知"),
      targetRemoteAddress: String(target.remoteAddress || "LocalSubnet")
    }];
  });
}

/**
 * Ordinary polling intentionally remains non-elevated.  Preserve individual
 * administrator-confirmed values only where the partial response says
 * "unknown"; keep the response labelled partial so stale evidence is never
 * presented as a fresh full inspection.
 */
function mergePartialCameraFtpStatus(
  previous: CameraFtpStatusData | null,
  incoming: CameraFtpStatusData
): CameraFtpStatusData {
  if (!previous || previous.inspectionLevel !== "full" || incoming.inspectionLevel !== "partial") return incoming;
  const preserveUnknown = <T,>(known: T, next: T): T => {
    if (next === null || next === undefined) return known;
    if (Array.isArray(next) || typeof next !== "object") return next;
    if (typeof known !== "object" || known === null || Array.isArray(known)) return next;
    return Object.fromEntries(Object.entries(next as Record<string, unknown>).map(([key, value]) => [
      key,
      preserveUnknown((known as Record<string, unknown>)[key], value)
    ])) as T;
  };
  return {
    ...incoming,
    windowsFeatures: preserveUnknown(previous.windowsFeatures, incoming.windowsFeatures),
    site: preserveUnknown(previous.site, incoming.site),
    binding: preserveUnknown(previous.binding, incoming.binding),
    authentication: preserveUnknown(previous.authentication, incoming.authentication),
    authorization: preserveUnknown(previous.authorization, incoming.authorization),
    account: preserveUnknown(previous.account, incoming.account),
    acl: preserveUnknown(previous.acl, incoming.acl),
    passivePorts: preserveUnknown(previous.passivePorts, incoming.passivePorts),
    firewall: preserveUnknown(previous.firewall, incoming.firewall),
    port: preserveUnknown(previous.port, incoming.port),
    conflicts: preserveUnknown(previous.conflicts, incoming.conflicts)
  };
}

export function CameraFtpImportPanel() {
  const [status, setStatus] = useState<CameraFtpStatusData | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [controlPort, setControlPort] = useState(String(DEFAULT_CONTROL_PORT));
  const [passivePortStart, setPassivePortStart] = useState(String(PASSIVE_PORT_START));
  const [passivePortEnd, setPassivePortEnd] = useState(String(PASSIVE_PORT_END));
  const [portInputsDirty, setPortInputsDirty] = useState(false);
  const [portCheck, setPortCheck] = useState<CameraFtpPortCheckData | null>(null);
  const [checkingPort, setCheckingPort] = useState(false);
  const portCheckRequestId = useRef(0);
  const [manualSiteName, setManualSiteName] = useState("");
  const [discoveredSites, setDiscoveredSites] = useState<CameraFtpConflictItemData[]>([]);
  const [selectedDiscoveredSiteName, setSelectedDiscoveredSiteName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState<ConfirmableAction | "open-folder" | "discover-sites" | null>(null);
  const [preparingPlanAction, setPreparingPlanAction] = useState<CameraFtpProvisioningGoal | null>(null);
  const [provisioningPlan, setProvisioningPlan] = useState<CameraFtpProvisioningPlanData | null>(null);
  const [provisioningPhaseIndex, setProvisioningPhaseIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [lastOperation, setLastOperation] = useState<CameraFtpOperationData | null>(null);
  const [dismissedConflictSite, setDismissedConflictSite] = useState("");
  const [message, setMessage] = useState<MessageState | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<PendingAction | null>(null);
  const [lastFailedDiscovery, setLastFailedDiscovery] = useState(false);
  const operationInProgressRef = useRef(false);
  const statusRequestSequence = useRef(0);

  const loadPage = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [activeRes, reviewingRes, draftRes, statusRes] = await Promise.all([
        fetchEvents("active"),
        fetchEvents("reviewing"),
        fetchEvents("draft"),
        fetchCameraFtpStatus()
      ]);
      const nextEvents = [activeRes, reviewingRes, draftRes]
        .flatMap((response) => response.ok && response.data ? response.data : [])
        .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index);
      setEvents(nextEvents);

      if (statusRes.ok && statusRes.data) {
        setStatus((current) => mergePartialCameraFtpStatus(current, statusRes.data));
        setSelectedEventId((current) => current || statusRes.data.activeEvent?.id || nextEvents[0]?.id || "");
      } else if (!quiet) {
        setMessage(apiErrorMessage(statusRes, "无法读取 Windows IIS FTP 状态。"));
      }
    } catch (error) {
      if (!quiet) {
        setMessage({
          tone: "danger",
          title: "后端服务未连接",
          body: "请确认完整 Electron 工作台和本机后端服务正在运行后重试。"
        });
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async (showFeedback = true, applyDuringOperation = false): Promise<CameraFtpStatusData | null> => {
    const requestId = ++statusRequestSequence.current;
    if (showFeedback) setRefreshing(true);
    try {
      const response = await fetchCameraFtpStatus(showFeedback);
      if (response.ok && response.data) {
        if (requestId === statusRequestSequence.current && (!operationInProgressRef.current || applyDuringOperation)) {
          setStatus((current) => mergePartialCameraFtpStatus(current, response.data));
        }
        if (showFeedback) {
          setLastFailedAction(null);
          setLastFailedDiscovery(false);
          setMessage({ tone: "success", title: "状态已刷新", body: "已重新检测 IIS、端口、防火墙、账户、目录权限和文件监听状态。" });
        }
        return response.data;
      } else if (showFeedback) {
        setMessage(apiErrorMessage(response, "无法刷新 IIS FTP 状态。"));
      }
    } catch {
      if (showFeedback) setMessage({ tone: "danger", title: "刷新失败", body: "请求失败，请确认本机后端服务正在运行。" });
    } finally {
      if (showFeedback) setRefreshing(false);
    }
    return null;
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (activeAction) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeAction, refreshStatus]);

  useEffect(() => {
    if (!activeAction || !isProvisioningAction(activeAction)) {
      setProvisioningPhaseIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setProvisioningPhaseIndex((current) => Math.min(current + 1, 6));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [activeAction]);

  useEffect(() => {
    if (status?.account?.username && !credentialsDirty) {
      setUsername(status.account.username);
    }
  }, [credentialsDirty, status?.account?.username]);

  useEffect(() => {
    if (status && (!status.passwordConfigured || status.passwordResetRequired || status.account?.exists === false)) {
      setEditingCredentials(true);
    }
  }, [status?.account?.exists, status?.passwordConfigured, status?.passwordResetRequired]);

  useEffect(() => {
    if (portInputsDirty || !status) return;
    setControlPort(String(status.controlPort || DEFAULT_CONTROL_PORT));
    setPassivePortStart(String(status.passivePorts?.start || PASSIVE_PORT_START));
    setPassivePortEnd(String(status.passivePorts?.end || PASSIVE_PORT_END));
  }, [portInputsDirty, status?.controlPort, status?.passivePorts?.end, status?.passivePorts?.start]);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEventId(status?.activeEvent?.id || events[0]?.id || "");
    }
  }, [events, selectedEventId, status?.activeEvent?.id]);

  useEffect(() => {
    const candidates = discoveredSites.length > 0
      ? discoveredSites
      : status?.conflicts?.items?.filter((item) => item.type === "site" && item.adoptable) ?? [];
    setSelectedDiscoveredSiteName((current) => candidates.some((site) => site.siteName === current)
      ? current
      : candidates[0]?.siteName || "");
  }, [discoveredSites, status?.conflicts?.items]);

  const networkOptions = useMemo(() => buildAddressOptions(status), [status]);

  useEffect(() => {
    if (networkOptions.length === 0) {
      setSelectedAddress("");
      return;
    }
    if (networkOptions.some((item) => item.address === selectedAddress)) return;
    const recommended = status?.networkAddresses?.recommendedAddress;
    const nextAddress = networkOptions.find((item) => item.address === recommended)?.address
      || networkOptions.find((item) => !item.candidate)?.address
      || networkOptions[0].address;
    if (selectedAddress && nextAddress !== selectedAddress) {
      setMessage({
        tone: "info",
        title: "网络连接已自动适配",
        body: `检测到 Wi-Fi 或 Windows 热点地址变化，推荐服务器地址已切换为 ${nextAddress}。IIS 仍使用 *:${status?.controlPort || DEFAULT_CONTROL_PORT}:，无需因 IP 变化重新绑定站点。`
      });
    }
    setSelectedAddress(nextAddress);
  }, [networkOptions, selectedAddress, status?.networkAddresses?.recommendedAddress]);

  const activeEvent = status?.activeEvent ?? null;
  const watcher = status?.watcher;
  const serviceReady = Boolean(
    status?.site?.started === true
      && status?.service?.running !== false
      && status?.port?.listening !== false
  );
  const uploadInProgress = Boolean(
    (watcher?.unstableCount ?? 0) > 0
      || (watcher?.pendingCount ?? 0) > 0
      || (watcher?.queuedCount ?? 0) > 0
      || (watcher?.importingCount ?? 0) > 0
  );
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const eventSelectionPending = Boolean(activeEvent && selectedEventId && selectedEventId !== activeEvent.id);
  const selectedEventPathPreview = selectedEvent
    ? `working\\${selectedEvent.slug}\\原图\\相机FTP\\`
    : "请先选择活动";
  const credentialFormValid = Boolean(
    username.trim()
      && newPassword.length >= 8
      && newPassword === confirmPassword
  );
  const portValidation = validateCameraFtpPortSettings(controlPort, passivePortStart, passivePortEnd);
  const portUnavailable = portCheck?.port?.conflict === true || portCheck?.port?.reserved === true;
  const portConfigurationChanged = Boolean(
    status?.initialized
      && portValidation.valid
      && (portValidation.controlPort !== status.controlPort
        || portValidation.passivePortStart !== status.passivePorts.start
        || portValidation.passivePortEnd !== status.passivePorts.end)
  );
  const availablePorts = Array.from(new Set([
    ...(portCheck?.port?.availablePorts ?? []),
    ...(message?.diagnostic?.availablePorts ?? []),
    ...(status?.port?.availablePorts ?? [])
  ])).filter((port) => port !== portValidation.controlPort);
  const recommendedPort = availablePorts[0] ?? null;
  const firstSetupRequired = status?.initialized !== true;
  const uiBusy = Boolean(activeAction || preparingPlanAction);
  const buttonState = getCameraFtpButtonState({
    status,
    busy: uiBusy,
    selectedEvent: Boolean(selectedEvent),
    credentialFormValid,
    portFormValid: portValidation.valid,
    serviceReady
  });
  const canConfigureAndStart = buttonState.configureAndStart;
  const canUnlinkEvent = Boolean(
    activeEvent
      && !uploadInProgress
      && (status?.site?.exists === false || status?.site?.started === false)
  );
  const statusAdoptionSites = status?.conflicts?.items?.filter((item) => item.type === "site" && item.adoptable) ?? [];
  const adoptionSites = discoveredSites.length > 0 ? discoveredSites : statusAdoptionSites;
  const siteConflict = adoptionSites.find((item) => item.siteName === selectedDiscoveredSiteName)
    || adoptionSites[0]
    || null;
  const showSiteConflict = Boolean(siteConflict && siteConflict.siteName !== dismissedConflictSite);
  const overall = getOverallStatus(status, activeAction || preparingPlanAction, message?.diagnostic?.code === "UAC_CANCELLED", serviceReady);
  const serviceSummary = getServiceSummary(status, activeAction || preparingPlanAction, serviceReady);
  const cameraActivity = getCameraActivityMeta(watcher, serviceReady);
  const recentStatusCounts = countRecentRecordStatuses(watcher?.recentRecords ?? []);
  const displayedControlPort = firstSetupRequired
    ? portValidation.controlPort ?? status?.controlPort ?? DEFAULT_CONTROL_PORT
    : status?.controlPort ?? portValidation.controlPort ?? DEFAULT_CONTROL_PORT;
  const portAvailability = getPortAvailabilityMeta(portValidation.valid, portCheck, checkingPort);
  const visibleIssues = useMemo(() => {
    const portIssues = portUnavailable ? [{
      id: "form-port-conflict",
      code: portCheck?.port.reserved ? "FTP_CONTROL_PORT_RESERVED" : "FTP_CONTROL_PORT_IN_USE",
      level: "user_confirmation" as const,
      title: `控制端口 ${portValidation.controlPort ?? displayedControlPort} 需要用户选择`,
      message: buildPortConflictSummary(portCheck)
    }] : [];
    const combined = [...buildCameraFtpStatusIssues(status), ...portIssues, ...(provisioningPlan?.issues ?? [])];
    return combined.filter((issue, index) => combined.findIndex((candidate) => candidate.id === issue.id || (candidate.code === issue.code && candidate.message === issue.message)) === index);
  }, [displayedControlPort, portCheck, portUnavailable, portValidation.controlPort, provisioningPlan?.issues, status]);
  const issueGroups = useMemo(() => groupCameraFtpIssues(visibleIssues), [visibleIssues]);
  const provisioningProgress = getCameraFtpProvisioningProgress(provisioningPhaseIndex);

  const runPortCheck = useCallback(async (showFeedback = false) => {
    const validation = validateCameraFtpPortSettings(controlPort, passivePortStart, passivePortEnd);
    if (!validation.valid || validation.controlPort === null || validation.passivePortStart === null || validation.passivePortEnd === null) {
      setPortCheck(null);
      return;
    }
    const requestId = ++portCheckRequestId.current;
    setCheckingPort(true);
    try {
      const response = await checkCameraFtpPort({
        controlPort: validation.controlPort,
        passivePortStart: validation.passivePortStart,
        passivePortEnd: validation.passivePortEnd,
        fullInspection: showFeedback
      });
      if (requestId !== portCheckRequestId.current) return;
      if (response.ok && response.data) {
        setPortCheck(response.data);
        if (showFeedback) {
          const conflict = response.data.port.conflict === true || response.data.port.reserved === true;
          const needsAdmin = response.data.requiresAdminForFullInspection || response.data.port.conflict === null;
          setMessage({
            tone: conflict || needsAdmin ? "warning" : "success",
            title: conflict ? "控制端口存在冲突" : needsAdmin ? "控制端口归属尚未确认" : "控制端口可用",
            body: conflict
              ? buildPortConflictSummary(response.data)
              : needsAdmin
                ? `TCP ${response.data.controlPort} 当前没有活动监听，但普通权限无法确认是否存在已绑定但未启动的 IIS FTP 站点。请执行管理员检测。`
                : `TCP ${response.data.controlPort} 当前未被其他程序或无关 IIS FTP 站点占用。`
          });
        }
      } else if (showFeedback) {
        setMessage(apiErrorMessage(response, "检测 FTP 控制端口失败。"));
      }
    } catch {
      if (requestId !== portCheckRequestId.current) return;
      if (showFeedback) setMessage({ tone: "danger", title: "端口检测失败", body: "请求失败，请确认本机后端服务正在运行。" });
    } finally {
      if (requestId === portCheckRequestId.current) setCheckingPort(false);
    }
  }, [controlPort, passivePortEnd, passivePortStart]);

  useEffect(() => {
    portCheckRequestId.current += 1;
    setCheckingPort(false);
    if (!portValidation.valid || uiBusy) {
      if (!portValidation.valid) setPortCheck(null);
      return;
    }
    const timer = window.setTimeout(() => void runPortCheck(false), 450);
    return () => window.clearTimeout(timer);
  }, [portValidation.valid, runPortCheck, uiBusy]);

  const useRecommendedPort = (port = recommendedPort) => {
    if (!port) return;
    setControlPort(String(port));
    setPortInputsDirty(true);
    setProvisioningPlan(null);
    setMessage({ tone: "info", title: "已选择推荐端口", body: `控制端口已改为 ${port}，请确认后重新检测并配置；工作台不会擅自切换端口。` });
  };

  const copyText = async (value: string, label: string) => {
    if (!value) {
      setMessage({ tone: "warning", title: "暂无可复制内容", body: `${label}尚未检测到。` });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ tone: "success", title: "已复制", body: `${label}已复制到剪贴板。` });
    } catch {
      setMessage({ tone: "danger", title: "复制失败", body: "系统未允许剪贴板写入，请手动复制页面内容。" });
    }
  };

  const buildPendingAction = (kind: ConfirmableAction, siteName?: string): PendingAction => {
    const definitions: Record<Exclude<ConfirmableAction, "credentials" | "active-event" | "adopt-site">, Omit<PendingAction, "kind">> = {
      setup: {
        title: "配置并启动 Windows IIS FTP",
        description: `将使用控制端口 ${portValidation.controlPort ?? controlPort} 和被动端口 ${passivePortStart}-${passivePortEnd} 完成账户、IIS、目录权限、防火墙与启动配置。确认后 Windows 会请求管理员权限；端口冲突时不会停止其他程序、修改无关站点或自动切换端口。`,
        confirmLabel: "配置并启动 FTP",
        tone: "info"
      },
      start: {
        title: "启动 IIS FTP 服务",
        description: "将启动 Microsoft FTP Service 和工作台 IIS FTP 站点。Windows 可能请求管理员权限。",
        confirmLabel: "启动",
        tone: "success"
      },
      stop: {
        title: "停止 IIS FTP 服务",
        description: "停止后相机无法继续上传，但文件 watcher 仍会处理接收目录中已有的稳定文件。",
        confirmLabel: "停止",
        tone: "warning"
      },
      restart: {
        title: "重启 IIS FTP 服务",
        description: "将重启工作台管理的 IIS FTP 站点，并确保 Microsoft FTP Service 已启动，用于应用最新配置。Windows 可能请求管理员权限。",
        confirmLabel: "重启",
        tone: "warning"
      },
      repair: {
        title: "自动配置并启动 IIS FTP",
        description: `只校正工作台托管站点、账户、ACL、防火墙、*:${portValidation.controlPort ?? controlPort}: binding、被动端口 ${passivePortStart}-${passivePortEnd} 和服务状态。不会停止其他程序、修改无关 IIS 站点或强占冲突端口。Windows 会请求管理员权限。`,
        confirmLabel: "自动配置并启动 FTP",
        tone: "info"
      }
    };

    if (kind === "adopt-site") {
      return {
        kind,
        siteName,
        useCredentialForm: !status?.passwordConfigured,
        title: "接管现有 IIS FTP 站点",
        description: `接管会调整所选站点授权、物理路径、控制端口 ${portValidation.controlPort ?? controlPort} 和安全配置，并把 IIS 服务器级被动端口设为 ${passivePortStart}-${passivePortEnd}；不会删除原目录或文件，也不会修改其他 IIS 站点。Windows 会请求管理员权限。`,
        confirmLabel: "确认接管",
        tone: "warning"
      };
    }
    if (kind === "active-event") {
      return {
        kind,
        title: "切换 FTP 接收活动",
        description: `IIS FTP 物理路径和 watcher 将切换到“${selectedEvent?.name || "所选活动"}”。旧活动 FTP 文件不会被删除。`,
        confirmLabel: "切换活动",
        tone: "warning"
      };
    }
    if (kind === "credentials") {
      return {
        kind,
        username: username.trim(),
        title: status?.account?.exists ? "更新 FTP 账户" : "创建 FTP 账户",
        description: "Windows 将创建或更新工作台管理的本地 FTP 账户，并同步 IIS 授权和目录权限。密码不会保存到配置、数据库或日志。",
        confirmLabel: status?.account?.exists ? "更新全局账户" : "创建全局账户",
        tone: "info"
      };
    }
    return {
      kind,
      ...definitions[kind],
      ...(kind === "setup" ? { username: username.trim(), useCredentialForm: true } : {}),
      ...(kind === "repair" && (!status?.passwordConfigured || status?.passwordResetRequired || status?.account?.exists === false)
        ? { username: username.trim(), useCredentialForm: true }
        : {})
    };
  };

  const requestAction = async (kind: ConfirmableAction, siteName?: string) => {
    const action = buildPendingAction(kind, siteName);
    if (!isProvisioningAction(kind)) {
      setPendingAction(action);
      return;
    }

    const validation = validateCameraFtpPortSettings(controlPort, passivePortStart, passivePortEnd);
    if (!validation.valid || validation.controlPort === null || validation.passivePortStart === null || validation.passivePortEnd === null) {
      setMessage({ tone: "warning", title: "FTP 端口设置无效", body: validation.controlPortError || validation.passiveRangeError });
      return;
    }

    setPreparingPlanAction(kind);
    setProvisioningPlan(null);
    setMessage({ tone: "info", title: "正在生成配置计划", body: "工作台正在只读检查当前状态并整理需要创建、修复或确认的项目，不会在此阶段修改系统。" });
    try {
      const targetSite = adoptionSites.find((site) => site.siteName === siteName) || siteConflict;
      const response = await prepareCameraFtpProvisioning({
        goal: kind,
        eventId: selectedEventId || activeEvent?.id || undefined,
        username: username.trim() || status?.account?.username || DEFAULT_USERNAME,
        controlPort: validation.controlPort,
        passivePortStart: validation.passivePortStart,
        passivePortEnd: validation.passivePortEnd,
        ...(kind === "adopt-site" ? {
          targetSiteName: siteName || targetSite?.siteName,
          targetSiteId: targetSite?.siteId
        } : {})
      });
      if (response.ok && response.data) {
        const plan = response.data;
        const nextAction = { ...action, plan, description: plan.summary || action.description };
        setProvisioningPlan(plan);
        if (cameraFtpPlanCanApply(plan)) {
          setPendingAction(nextAction);
          setMessage(null);
        } else {
          setLastFailedAction(nextAction);
          setMessage({
            tone: "danger",
            title: "配置计划存在阻塞项",
            body: plan.summary || "请先按下方阻塞错误处理外部资源冲突，再重新生成配置计划。"
          });
        }
      } else {
        const diagnostic = buildCameraFtpErrorPresentation(response, "无法生成 IIS FTP 配置计划。");
        setLastFailedAction(action);
        setMessage({ tone: diagnostic.tone, title: diagnostic.title, body: diagnostic.body, diagnostic });
      }
    } catch {
      setLastFailedAction(action);
      setMessage({ tone: "danger", title: "配置计划生成失败", body: "请求失败，请确认本机后端服务正在运行后重试。" });
    } finally {
      setPreparingPlanAction(null);
    }
  };

  const validateCredentialForm = (context: "setup" | "credentials" | "adopt" | "repair"): boolean => {
    const normalizedUsername = username.trim();
    if (!selectedEvent && context !== "credentials") {
      setMessage({ tone: "warning", title: "请先选择接收活动", body: "请选择草稿、进行中或选片中的活动，再继续配置 FTP。" });
      return false;
    }
    if (!normalizedUsername) {
      setMessage({ tone: "warning", title: "用户名不能为空", body: "请输入用于相机 FTP 登录的全局用户名。" });
      return false;
    }
    if (!newPassword) {
      setMessage({ tone: "warning", title: "请输入新密码", body: "FTP 密码至少需要 8 位。" });
      return false;
    }
    if (newPassword.length < 8) {
      setMessage({ tone: "warning", title: "密码长度不足", body: "FTP 密码至少需要 8 位，可使用字母、数字和常规符号。" });
      return false;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ tone: "warning", title: "两次密码不一致", body: "请重新确认新密码。" });
      return false;
    }
    return true;
  };

  const validateAndRequestSetup = () => {
    if (!validateCredentialForm("setup")) return;
    if (!validatePortForm()) return;
    void requestAction("setup");
  };

  const validateAndRequestAdoption = (siteName: string) => {
    if (!status?.passwordConfigured && !validateCredentialForm("adopt")) return;
    if (!validatePortForm()) return;
    void requestAction("adopt-site", siteName);
  };

  const validatePortForm = (): boolean => {
    if (portValidation.valid) return true;
    setMessage({
      tone: "warning",
      title: "FTP 端口设置无效",
      body: portValidation.controlPortError || portValidation.passiveRangeError
    });
    return false;
  };

  const validateAndRequestRepair = () => {
    if ((!status?.passwordConfigured || status?.passwordResetRequired || status?.account?.exists === false)
      && !validateCredentialForm("repair")) return;
    if (!validatePortForm()) return;
    void requestAction("repair");
  };

  const validateAndRequestCredentials = () => {
    if (!validateCredentialForm("credentials")) return;
    void requestAction("credentials");
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.plan && !cameraFtpPlanCanApply(action.plan)) {
      setPendingAction(null);
      setProvisioningPlan(action.plan);
      setMessage({ tone: "danger", title: "配置计划存在阻塞项", body: "阻塞项未解决前不会执行系统修改。请按问题提示处理后重新生成配置计划。" });
      return;
    }
    const confirmedPorts = validateCameraFtpPortSettings(controlPort, passivePortStart, passivePortEnd);
    if (["setup", "repair", "adopt-site"].includes(action.kind)
      && (!confirmedPorts.valid || confirmedPorts.controlPort === null || confirmedPorts.passivePortStart === null || confirmedPorts.passivePortEnd === null)) {
      setMessage({ tone: "warning", title: "FTP 端口设置无效", body: confirmedPorts.controlPortError || confirmedPorts.passiveRangeError });
      return;
    }
    const portRequest = {
      controlPort: confirmedPorts.controlPort ?? DEFAULT_CONTROL_PORT,
      passivePortStart: confirmedPorts.passivePortStart ?? PASSIVE_PORT_START,
      passivePortEnd: confirmedPorts.passivePortEnd ?? PASSIVE_PORT_END
    };
    const allowAclTightening = action.plan?.confirmations.some((confirmation) => confirmation.key === "tighten-broad-acl") === true;
    setPendingAction(null);
    operationInProgressRef.current = true;
    statusRequestSequence.current += 1;
    setActiveAction(action.kind);
    setProvisioningPhaseIndex(0);
    setLastOperation(null);
    setLastFailedAction(null);
    setLastFailedDiscovery(false);
    setMessage(action.kind === "active-event" && !action.unlink
      ? {
          tone: "info",
          title: `正在切换到“${selectedEvent?.name || "所选活动"}”`,
          body: "当前接收活动保持不变，直到 IIS 路径、站点状态和 watcher 全部验证通过；操作期间状态轮询已暂停。"
        }
      : { tone: "info", title: "正在处理", body: "请等待操作完成；如出现 Windows 用户账户控制窗口，请确认本次工作台操作。" });
    try {
      let response: ApiResponse<CameraFtpActionData>;
      switch (action.kind) {
        case "setup":
          {
            const passwordForRequest = newPassword;
            response = await setupCameraFtp({
              eventId: selectedEventId,
              username: username.trim(),
              password: passwordForRequest,
              confirmPassword: passwordForRequest,
              ...portRequest,
              allowLegacyFirewallRuleUpdate: action.allowLegacyFirewallRuleUpdate === true,
              allowAclTightening
            });
          }
          break;
        case "adopt-site":
          {
            const passwordForRequest = action.useCredentialForm ? newPassword : undefined;
            response = await adoptCameraFtpSite(action.siteName || siteConflict?.siteName || "", {
              eventId: selectedEventId || activeEvent?.id,
              username: username.trim(),
              ...portRequest,
              allowLegacyFirewallRuleUpdate: action.allowLegacyFirewallRuleUpdate === true,
              allowAclTightening,
              ...(passwordForRequest ? { password: passwordForRequest, confirmPassword: passwordForRequest } : {})
            });
          }
          break;
        case "start":
          response = await startCameraFtp({ allowAclTightening });
          break;
        case "stop":
          response = await stopCameraFtp();
          break;
        case "restart":
          response = await restartCameraFtp({ allowAclTightening });
          break;
        case "repair":
          {
            const passwordForRequest = action.useCredentialForm ? newPassword : undefined;
            response = await repairCameraFtp({
              ...portRequest,
              allowLegacyFirewallRuleUpdate: action.allowLegacyFirewallRuleUpdate === true,
              allowAclTightening,
              ...(passwordForRequest ? { password: passwordForRequest } : {})
            });
          }
          break;
        case "credentials":
          {
            const passwordForRequest = newPassword;
            response = await updateCameraFtpCredentials({ username: username.trim(), password: passwordForRequest });
          }
          break;
        case "active-event":
          response = action.unlink
            ? await clearCameraFtpActiveEvent()
            : await updateCameraFtpActiveEvent(selectedEventId);
          break;
      }

      if (response.ok && response.data) {
        if (action.kind === "setup" || action.kind === "credentials" || ((action.kind === "adopt-site" || action.kind === "repair") && action.useCredentialForm)) {
          setNewPassword("");
          setConfirmPassword("");
          setCredentialsDirty(false);
          setEditingCredentials(false);
        }
        setStatus(response.data.status);
        setProvisioningPlan(null);
        if (["setup", "repair", "adopt-site"].includes(action.kind)) {
          setControlPort(String(response.data.status.controlPort));
          setPassivePortStart(String(response.data.status.passivePorts.start));
          setPassivePortEnd(String(response.data.status.passivePorts.end));
          setPortInputsDirty(false);
        }
        setLastOperation(response.data.operation);
        setMessage({
          tone: "success",
          title: action.unlink ? "FTP 接收活动已解除" : operationTitle(action.kind),
          body: response.data.operation?.message || "操作已完成，并已重新检测 IIS FTP 状态。"
        });
        if (action.kind === "active-event") {
          setSelectedEventId(response.data.status.activeEvent?.id || (action.unlink ? events[0]?.id || "" : selectedEventId));
        }
      } else {
        const diagnostic = buildCameraFtpErrorPresentation(response, "IIS FTP 操作失败。");
        setLastFailedDiscovery(false);
        if (response.error?.code === "FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED"
          && ["setup", "repair", "adopt-site"].includes(action.kind)) {
          const firewallRuleChanges = firewallRuleChangePreviews(response.error.details?.conflict);
          const confirmationAction: PendingAction = {
            ...action,
            allowLegacyFirewallRuleUpdate: true,
            firewallRuleChanges,
            title: "确认更新旧 FTP 防火墙规则",
            description: "检测到早期版本创建的本地 FTP 防火墙规则。继续后仅更新下方明确列出的规则，使其匹配当前控制端口、被动端口和 LocalSubnet 范围；不会修改组策略规则或其他防火墙规则。",
            confirmLabel: "确认更新并继续",
            tone: "danger"
          };
          setLastFailedAction(confirmationAction);
          setPendingAction(confirmationAction);
        } else {
          setLastFailedAction(action);
        }
        setMessage({ tone: diagnostic.tone, title: diagnostic.title, body: diagnostic.body, diagnostic });
        const authoritativeStatus = await refreshStatus(false, true);
        if (action.kind === "active-event") {
          setSelectedEventId(authoritativeStatus?.activeEvent?.id || activeEvent?.id || events[0]?.id || "");
        }
      }
    } catch {
      setLastFailedAction(action);
      setMessage({ tone: "danger", title: "操作失败", body: "请求失败，请确认本机后端服务正在运行。" });
      if (action.kind === "active-event") {
        const authoritativeStatus = await refreshStatus(false, true);
        setSelectedEventId(authoritativeStatus?.activeEvent?.id || activeEvent?.id || events[0]?.id || "");
      }
    } finally {
      operationInProgressRef.current = false;
      setActiveAction(null);
    }
  };

  const handleDiscoverSites = async () => {
    if (!selectedEventId) {
      setMessage({ tone: "warning", title: "请先选择接收活动", body: "管理员检测需要用所选活动预览目标接收目录。" });
      return;
    }
    setActiveAction("discover-sites");
    setMessage({ tone: "info", title: "正在请求管理员检测", body: "Windows 将弹出 UAC；本次操作只读取 IIS FTP 站点，不修改站点、目录或文件。" });
    try {
      if (!portValidation.valid || portValidation.controlPort === null || portValidation.passivePortStart === null || portValidation.passivePortEnd === null) {
        setMessage({ tone: "warning", title: "FTP 端口设置无效", body: portValidation.controlPortError || portValidation.passiveRangeError });
        return;
      }
      const response = await discoverCameraFtpSites({
        eventId: selectedEventId,
        controlPort: portValidation.controlPort,
        passivePortStart: portValidation.passivePortStart,
        passivePortEnd: portValidation.passivePortEnd
      });
      if (response.ok && response.data) {
        setLastFailedDiscovery(false);
        setStatus(response.data.status);
        setDiscoveredSites(response.data.sites);
        setSelectedDiscoveredSiteName(response.data.sites[0]?.siteName || "");
        setMessage({
          tone: response.data.sites.length > 0 ? "success" : "info",
          title: response.data.sites.length > 0 ? `发现 ${response.data.sites.length} 个可接管站点` : "未发现可接管站点",
          body: response.data.sites.length > 0
            ? "请选择站点并确认接管；检测过程没有修改真实 IIS。"
            : `没有发现使用控制端口 ${portValidation.controlPort} 的可接管 IIS FTP 站点，可继续配置或选择其他端口。`
        });
      } else {
        const diagnostic = buildCameraFtpErrorPresentation(response, "管理员检测 IIS FTP 站点失败。");
        setLastFailedDiscovery(true);
        setLastFailedAction(null);
        setMessage({ tone: diagnostic.tone, title: diagnostic.title, body: diagnostic.body, diagnostic });
        await refreshStatus(false);
      }
    } catch {
      setLastFailedDiscovery(true);
      setMessage({ tone: "danger", title: "管理员检测失败", body: "请求失败，请确认本机后端服务正在运行。" });
    } finally {
      setActiveAction(null);
    }
  };

  const copyTechnicalDetails = async () => {
    const details = message?.diagnostic?.technicalDetails;
    if (!details) return;
    try {
      await navigator.clipboard.writeText(details);
    } catch {
      setMessage({ tone: "danger", title: "复制失败", body: "系统未允许剪贴板写入，请打开日志目录查看详情。" });
    }
  };

  const openLogsDirectory = async () => {
    const logsDir = window.mediaPhotoWorkbench?.getRuntimeInfo?.().logsDir;
    if (!logsDir) {
      setMessage({ tone: "warning", title: "日志目录不可用", body: "请在完整 Electron 工作台中打开日志目录。" });
      return;
    }
    const result = await window.mediaPhotoWorkbench?.openPath(logsDir);
    if (result) {
      setMessage({ tone: "danger", title: "无法打开日志目录", body: result });
    }
  };

  const retryLastFailedAction = () => {
    if (!lastFailedAction) return;
    const action = lastFailedAction;
    setMessage(null);
    if (isProvisioningAction(action.kind)) {
      void requestAction(action.kind, action.siteName);
      return;
    }
    setPendingAction(action);
  };

  const handleOpenFolder = async () => {
    setActiveAction("open-folder");
    try {
      const response = await openCameraFtpFolder();
      if (response.ok && response.data) {
        setStatus(response.data.status);
        setMessage({ tone: "success", title: "已打开 FTP 文件夹", body: response.data.path || response.data.status.ftpPath });
      } else {
        setMessage(apiErrorMessage(response, "无法打开当前 FTP 接收目录。"));
      }
    } catch {
      setMessage({ tone: "danger", title: "打开失败", body: "请求失败，请确认当前 FTP 接收活动和仓库路径有效。" });
    } finally {
      setActiveAction(null);
    }
  };

  const handleSwitchEvent = () => {
    if (!selectedEventId || selectedEventId === activeEvent?.id) return;
    if (uploadInProgress) {
      setMessage({
        tone: "warning",
        title: "暂时不能切换活动",
        body: `当前仍有 ${watcher?.unstableCount ?? 0} 个未稳定文件和 ${(watcher?.queuedCount ?? 0) + (watcher?.importingCount ?? 0)} 个待处理文件。请等待上传与导入完成。`
      });
      return;
    }
    void requestAction("active-event");
  };

  const handleUnlinkEvent = () => {
    if (!activeEvent || uploadInProgress) return;
    if (!canUnlinkEvent) {
      setMessage({
        tone: "warning",
        title: "请先停止 FTP",
        body: "解除活动关联是独立操作。请先使用“停止 FTP”确认站点已停止，且没有上传或导入中的文件。"
      });
      return;
    }
    setPendingAction({
      kind: "active-event",
      unlink: true,
      title: "解除 FTP 活动关联",
      description: "FTP 站点必须已经停止。本操作只关闭 watcher 并清除当前活动关联，不会启动或停止 IIS，也不会删除接收目录和其中的文件。",
      confirmLabel: "确认解除关联",
      tone: "warning"
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[460px] items-center justify-center rounded-2xl border border-slate-100 bg-white text-sm text-slate-400 shadow-sm">
        <Loader2 className="mr-2 animate-spin" size={18} />
        正在检测 Windows IIS FTP 环境...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className={cn(
        "rounded-2xl border p-5 shadow-sm sm:p-6",
        serviceReady ? "border-emerald-100 bg-emerald-50/35" : "border-slate-100 bg-white"
      )}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                serviceReady ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600"
              )}>
                {serviceReady ? <CheckCircle2 size={20} /> : <Server size={20} />}
              </span>
              <h2 className="text-lg font-semibold text-slate-900">
                {serviceReady ? "相机 FTP 已启动" : "相机 FTP · Windows IIS"}
              </h2>
              <StatusPill tone={overall.tone}>{overall.label}</StatusPill>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {serviceReady
                ? "FTP 服务正在运行，相机可以使用下方参数连接并上传图片。文件会直接写入当前活动的“原图/相机FTP”最终目录。"
                : "工作台统一检测和管理 Windows IIS FTP。支持 FTP 传输的相机上传后，文件稳定检测、原地登记和缩略图生成会自动完成。"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {serviceReady && (
              <>
                <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50" disabled={!buttonState.stop} onClick={() => void requestAction("stop")} type="button"><Square size={14} />停止 FTP</button>
                <button className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50 disabled:opacity-50" disabled={!buttonState.restart || portConfigurationChanged} onClick={() => void requestAction("restart")} type="button"><RotateCcw size={15} />重启 FTP</button>
              </>
            )}
            <button
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={refreshing || uiBusy}
              onClick={() => void refreshStatus(true)}
              type="button"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
              刷新状态
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="当前接收活动" value={activeEvent?.name || "未选择"} />
          <SummaryTile label="推荐地址" value={status?.networkAddresses?.recommendedAddress || "等待检测"} />
          <SummaryTile label="控制端口" value={`${displayedControlPort}`} />
          <SummaryTile label="当前用户名" value={status?.account?.username || DEFAULT_USERNAME} />
          <SummaryTile label="接收目录" value={status?.ftpPath || "未配置"} title={status?.ftpPath} />
          <SummaryTile label="服务状态" value={serviceSummary.label} tone={serviceSummary.tone} />
          <SummaryTile label="相机连接活动" value={cameraActivity.label} tone={cameraActivity.tone === "success" ? "success" : cameraActivity.tone === "warning" ? "warning" : "neutral"} />
          <SummaryTile label="最近接收时间" value={formatDateTime(watcher?.lastReceivedAt)} />
        </div>

        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Camera className={cn("mt-0.5 shrink-0", cameraActivity.tone === "info" ? "text-blue-600" : cameraActivity.tone === "success" ? "text-emerald-600" : cameraActivity.tone === "warning" ? "text-amber-600" : "text-slate-400")} size={18} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">相机连接与传输</p>
                <StatusPill tone={cameraActivity.tone}>{cameraActivity.label}</StatusPill>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{cameraActivity.description}</p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-xs text-slate-500 sm:text-right">
            <span>最近连接</span><span className="font-medium text-slate-700">{formatDateTime(cameraActivity.lastConnectionAt)}</span>
            <span>实时连接数</span><span className="font-medium text-slate-700">无法可靠获取</span>
            <span>最近客户端 IP</span><span className="font-medium text-slate-700">未提供</span>
          </div>
        </div>
      </section>

      {!uiBusy && message?.diagnostic ? (
        <DiagnosticErrorCard
          diagnostic={message.diagnostic}
          onAdopt={(message.diagnostic.adoptableSiteName || siteConflict?.siteName)
            ? () => validateAndRequestAdoption(message.diagnostic?.adoptableSiteName || siteConflict?.siteName || "")
            : undefined}
          onCopy={() => void copyTechnicalDetails()}
          onOpenLogs={() => void openLogsDirectory()}
          onSelectPort={message.diagnostic.availablePorts.length > 0 ? useRecommendedPort : undefined}
          onRetry={lastFailedAction
            ? retryLastFailedAction
            : lastFailedDiscovery
              ? () => void handleDiscoverSites()
              : undefined}
        />
      ) : !uiBusy && message ? <Notice tone={message.tone} title={message.title}>{message.body}</Notice> : null}
      {preparingPlanAction && (
        <Notice tone="info" title="正在生成配置计划">
          正在执行只读 Preflight，并区分已符合、可自动修复、需要确认和阻塞项目；此阶段不会修改 Windows 或 IIS。
        </Notice>
      )}
      {activeAction && isProvisioningAction(activeAction) && (
        <CameraFtpProvisioningProgress phases={provisioningProgress} />
      )}
      {activeAction && !isProvisioningAction(activeAction) && (
        <Notice tone="info" title="正在配置 Windows IIS FTP">
          操作进行中，请勿重复点击。如 Windows 显示用户账户控制窗口，请核对应用后允许本次系统配置。
        </Notice>
      )}
      <Panel title={firstSetupRequired ? "首次配置 FTP" : serviceReady ? "FTP 设置（按需展开）" : "配置已完成 · FTP 接收活动与全局账户"} icon={<Settings2 size={18} />}>
        <details key={serviceReady ? "ftp-settings-ready" : "ftp-settings-open"} open={!serviceReady}>
          <summary className="cursor-pointer rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            {serviceReady ? "查看或修改接收活动、全局账户和端口设置" : "完成下列设置后配置并启动 FTP"}
          </summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">1</span>
              <h4 className="text-sm font-semibold text-slate-800">选择 FTP 接收活动</h4>
            </div>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
              disabled={uiBusy || events.length === 0}
              onChange={(event) => { setSelectedEventId(event.target.value); setProvisioningPlan(null); }}
              value={selectedEventId}
            >
              {events.length === 0 && <option value="">暂无可用活动</option>}
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.name} · {eventStatusLabels[event.status as keyof typeof eventStatusLabels] || event.status}</option>
              ))}
            </select>
            <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
              <p>活动：{selectedEvent?.name || "未选择"}</p>
              <p>日期：{selectedEvent?.date || "未填写"}</p>
              <p>状态：{selectedEvent ? eventStatusLabels[selectedEvent.status as keyof typeof eventStatusLabels] || selectedEvent.status : "未选择"}</p>
              <p className="break-all text-blue-700">目录：{selectedEventPathPreview}</p>
              {eventSelectionPending && (
                <p className="rounded-md bg-amber-50 px-2.5 py-2 font-medium text-amber-700">
                  待切换，尚未生效。当前仍由“{activeEvent?.name}”接收相机上传。
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">2</span>
              <h4 className="text-sm font-semibold text-slate-800">设置全局 FTP 账户</h4>
            </div>
            {status?.passwordConfigured && !editingCredentials ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <CheckCircle2 className="shrink-0 text-emerald-600" size={18} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-800">FTP 密码已设置</p>
                      <p className="mt-0.5 truncate text-xs text-emerald-700" title={status.account?.username || username}>当前账户：{status.account?.username || username}</p>
                    </div>
                  </div>
                  <button className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50" disabled={uiBusy} onClick={() => { setEditingCredentials(true); setCredentialsDirty(false); }} type="button">修改账户或密码</button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-emerald-700">为保护账户安全，工作台只记住“已设置”状态，不读取或回显真实密码。</p>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">用户名</span>
                  <input className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" disabled={uiBusy} onChange={(event) => { setUsername(event.target.value); setCredentialsDirty(true); setProvisioningPlan(null); }} value={username} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-xs font-medium text-slate-500">新密码</span>
                    <input autoComplete="new-password" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" disabled={uiBusy} onChange={(event) => { setNewPassword(event.target.value); setCredentialsDirty(true); }} placeholder="至少 8 位" type="password" value={newPassword} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-slate-500">确认密码</span>
                    <input autoComplete="new-password" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" disabled={uiBusy} onChange={(event) => { setConfirmPassword(event.target.value); setCredentialsDirty(true); }} placeholder="再次输入" type="password" value={confirmPassword} />
                  </label>
                </div>
                {!firstSetupRequired && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {status?.passwordConfigured && (
                      <button className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100" disabled={uiBusy} onClick={() => { setUsername(status.account?.username || DEFAULT_USERNAME); setNewPassword(""); setConfirmPassword(""); setCredentialsDirty(false); setEditingCredentials(false); }} type="button">取消修改</button>
                    )}
                    <button className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-400" disabled={uiBusy || !activeEvent || !credentialFormValid} onClick={validateAndRequestCredentials} type="button">保存账户修改</button>
                  </div>
                )}
                <p className="text-xs leading-5 text-slate-500">真实密码仅在本次编辑期间保存在当前页面内存中，不写入配置、数据库或日志。所有活动共用这一套账户。</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">3</span>
              <h4 className="text-sm font-semibold text-slate-800">设置 FTP 控制端口</h4>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">控制端口</span>
              <input
                aria-describedby="camera-ftp-control-port-help"
                className={cn("w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500", portValidation.controlPortError ? "border-red-300" : "border-slate-200")}
                disabled={uiBusy}
                inputMode="numeric"
                max="65535"
                min="1"
                onChange={(event) => { setControlPort(event.target.value); setPortInputsDirty(true); setProvisioningPlan(null); }}
                type="number"
                value={controlPort}
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill tone={portAvailability.tone}>{portAvailability.label}</StatusPill>
              <button className="rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400" disabled={!portValidation.valid || checkingPort || uiBusy} onClick={() => void runPortCheck(true)} type="button">
                {checkingPort ? "检测中..." : portCheck?.requiresAdminForFullInspection ? "管理员检测" : "重新检测"}
              </button>
              {recommendedPort && portUnavailable && (
                <button className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700" onClick={() => useRecommendedPort()} type="button">使用推荐端口 {recommendedPort}</button>
              )}
            </div>
            <p className={cn("mt-2 text-xs leading-5", portValidation.controlPortError ? "text-red-600" : "text-slate-500")} id="camera-ftp-control-port-help">
              {portValidation.controlPortError || "推荐使用 21；允许 1–65535，不能与被动端口范围重叠。修改时会请求 UAC。"}
            </p>
            {portCheck?.port?.conflict === true && <p className="mt-2 text-xs leading-5 text-red-600">{buildPortConflictSummary(portCheck)}</p>}
            {portConfigurationChanged && <p className="mt-2 rounded-md bg-blue-50 px-2.5 py-2 text-xs leading-5 text-blue-700">端口修改尚未应用。请点击“自动配置并启动 FTP”，确认 UAC 后同步 IIS binding 与防火墙。</p>}
            <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">高级：被动端口范围</summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label><span className="mb-1 block text-[11px] text-slate-500">起始端口</span><input className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" disabled={uiBusy} inputMode="numeric" max="65535" min="1" onChange={(event) => { setPassivePortStart(event.target.value); setPortInputsDirty(true); setProvisioningPlan(null); }} type="number" value={passivePortStart} /></label>
                <label><span className="mb-1 block text-[11px] text-slate-500">结束端口</span><input className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" disabled={uiBusy} inputMode="numeric" max="65535" min="1" onChange={(event) => { setPassivePortEnd(event.target.value); setPortInputsDirty(true); setProvisioningPlan(null); }} type="number" value={passivePortEnd} /></label>
              </div>
              <p className={cn("mt-2 text-[11px] leading-4", portValidation.passiveRangeError ? "text-red-600" : "text-amber-700")}>{portValidation.passiveRangeError || "此配置是 IIS 服务器级设置，会影响本机所有 IIS FTP 站点；普通用户建议保持 50000–50100。"}</p>
            </details>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">4</span>
              <h4 className="text-sm font-semibold text-slate-800">{firstSetupRequired ? "配置并启动" : "管理当前配置"}</h4>
            </div>
            {firstSetupRequired ? (
              <>
                <p className="text-xs leading-5 text-slate-500">无需先做管理员诊断、保存账户或手动启动。确认摘要后，工作台会自动请求 UAC，检测冲突并完成 IIS 配置与启动。</p>
                <button className="mt-4 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold leading-5 text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500" disabled={!canConfigureAndStart} onClick={validateAndRequestSetup} title="配置并启动 FTP" type="button">
                  {activeAction === "setup" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                  配置并启动 FTP
                </button>
              </>
            ) : (
              <>
                <div className="space-y-2 text-xs leading-5 text-slate-600">
                  <p>当前活动：{activeEvent?.name || "未关联"}</p>
                  <p className="break-all">接收目录：{status?.ftpPath || "未关联"}</p>
                  <p>账户：{status?.account?.username || username}</p>
                </div>
                <div className="mt-4 grid gap-2">
                  <button className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium leading-5 text-white hover:bg-blue-700 disabled:bg-slate-300" disabled={uiBusy || !selectedEventId || selectedEventId === activeEvent?.id || uploadInProgress} onClick={handleSwitchEvent} type="button">
                    {activeAction === "active-event"
                      ? `正在切换到“${selectedEvent?.name || "所选活动"}”`
                      : uploadInProgress
                        ? "上传处理中，暂不可切换"
                        : "切换 FTP 接收活动"}
                  </button>
                  <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50" disabled={uiBusy || !activeEvent} onClick={() => void handleOpenFolder()} type="button">打开接收目录</button>
                  <button className="rounded-lg px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50" disabled={uiBusy || !canUnlinkEvent} onClick={handleUnlinkEvent} type="button">解除活动关联</button>
                </div>
                {!canUnlinkEvent && activeEvent && (
                  <p className="mt-3 text-xs leading-5 text-amber-700">解除关联前必须先停止 FTP，并等待上传和导入完成。</p>
                )}
              </>
            )}
          </div>
          </div>
        </details>
      </Panel>

      {provisioningPlan && !pendingAction && !activeAction && (
        <CameraFtpProvisioningPlanSummary plan={provisioningPlan} />
      )}
      {issueGroups.length > 0 && (
        <CameraFtpIssueCenter
          groups={issueGroups}
          onUseRecommendedPort={recommendedPort ? () => useRecommendedPort(recommendedPort) : undefined}
        />
      )}
      <Notice tone="warning" title="仅限可信局域网使用">
        普通 FTP 不加密用户名、密码和传输内容。请只在可信 Wi-Fi 或 Windows 热点中使用，并为相机 FTP 设置独立密码，不要复用 Windows、校园网或其他账户密码。
      </Notice>

      <details key={serviceReady ? "iis-management-ready" : "iis-management-open"} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" open={!serviceReady}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          IIS 环境与高级管理{serviceReady ? "（FTP 正常运行，按需查看）" : ""}
        </summary>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <Panel title="IIS 环境状态" icon={<ShieldCheck size={18} />}>
          <div className="grid gap-2 sm:grid-cols-2">
            <EnvironmentRow label="IIS FTP 组件" meta={featureMeta(status)} detail={featureDetail(status)} />
            <EnvironmentRow label="Microsoft FTP Service" meta={booleanMeta(status?.service?.running, status?.service?.exists ? "已停止" : "未安装")} detail={status?.service?.startType || status?.service?.name} />
            <EnvironmentRow label="IIS FTP 站点" meta={booleanMeta(status?.site?.started, status?.site?.exists ? "已停止" : "未配置")} detail={status?.site?.name} />
            <EnvironmentRow label="FTP 控制端口" meta={portMeta(status)} detail={portDetail(status)} />
            <EnvironmentRow label="被动端口" meta={booleanMeta(status?.passivePorts?.correct, status?.passivePorts?.configured ? "需要修复" : "未配置")} detail={`${status?.passivePorts?.start ?? PASSIVE_PORT_START}-${status?.passivePorts?.end ?? PASSIVE_PORT_END}`} />
            <EnvironmentRow label="Windows 防火墙" meta={booleanMeta(status?.firewall?.correct, "需要修复")} detail="LocalSubnet · Any" />
            <EnvironmentRow label="本地账户" meta={accountMeta(status)} detail={status?.account?.username || DEFAULT_USERNAME} />
            <EnvironmentRow label="目录权限" meta={booleanMeta(status?.acl?.correct, status?.acl?.exists ? "需要修复" : "未配置")} detail={status?.acl?.path} />
            <EnvironmentRow label="文件监听" meta={booleanMeta(status?.watcher?.running, status?.activeEvent ? "已停止" : "未配置")} detail={status?.watcher?.directory} />
          </div>
          {status?.acl?.broadInheritedAccess === true && (
            <Notice className="mt-4" tone="warning" title="检测到上级目录继承权限">
              当前 FTP 根目录继承了面向宽泛 Windows 用户组的可写权限。工作台不会删除其他合法权限，请由管理员检查仓库上级目录 ACL。
            </Notice>
          )}
        </Panel>

        <Panel title="服务操作" icon={<Settings2 size={18} />}>
          <p className="text-sm leading-6 text-slate-500">
            普通状态检测不请求管理员权限。初始化、接管、修复和系统服务操作时，Windows 才会弹出 UAC。
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <ActionButton
              disabled={firstSetupRequired ? !canConfigureAndStart : !buttonState.repair}
              icon={<Wrench size={15} />}
              label={firstSetupRequired ? "配置并启动 FTP" : "自动配置并启动 FTP"}
              loading={activeAction === (firstSetupRequired ? "setup" : "repair")}
              onClick={firstSetupRequired ? validateAndRequestSetup : validateAndRequestRepair}
              primary={!serviceReady}
            />
            <ActionButton disabled={!buttonState.discoverSites} icon={<ShieldCheck size={15} />} label="管理员诊断（只读）" loading={activeAction === "discover-sites"} onClick={() => void handleDiscoverSites()} />
            <ActionButton disabled={!buttonState.start || portConfigurationChanged} icon={<Play size={15} />} label="启动 FTP" loading={activeAction === "start"} onClick={() => void requestAction("start")} />
            <ActionButton disabled={!buttonState.stop} icon={<Square size={14} />} label="停止 FTP" loading={activeAction === "stop"} onClick={() => void requestAction("stop")} />
            <ActionButton disabled={!buttonState.restart || portConfigurationChanged} icon={<RotateCcw size={15} />} label="重启 FTP" loading={activeAction === "restart"} onClick={() => void requestAction("restart")} />
          </div>
          {buttonState.passwordMessage && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{buttonState.passwordMessage}</p>}
          {adoptionSites.length > 0 && (
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <label className="block text-xs font-medium text-blue-800">管理员检测到的可接管站点</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700" onChange={(event) => { setSelectedDiscoveredSiteName(event.target.value); setProvisioningPlan(null); }} value={siteConflict?.siteName || ""}>
                  {adoptionSites.map((site) => <option key={site.siteName} value={site.siteName}>{site.siteName} · {site.binding || `FTP :${displayedControlPort}`} · {site.status || "状态未知"}</option>)}
                </select>
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300" disabled={uiBusy || !siteConflict || (!status?.passwordConfigured && !credentialFormValid)} onClick={() => validateAndRequestAdoption(siteConflict?.siteName || "")} type="button">确认接管所选站点</button>
              </div>
              <p className="mt-2 text-xs leading-5 text-blue-700">接管前会再次确认；不会删除原目录或原文件，失败时恢复原站点配置和状态。</p>
            </div>
          )}
          <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">高级：手动输入站点名</summary>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">仅在管理员检测无法列出站点时使用</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                  disabled={uiBusy}
                  onChange={(event) => { setManualSiteName(event.target.value); setProvisioningPlan(null); }}
                  placeholder="例如 MPW-IIS-FTP-Test"
                  value={manualSiteName}
                />
                <button
                  className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  disabled={uiBusy || !manualSiteName.trim() || !(selectedEvent || activeEvent) || (!status?.passwordConfigured && !credentialFormValid)}
                  onClick={() => validateAndRequestAdoption(manualSiteName.trim())}
                  type="button"
                >
                  显式接管
                </button>
              </div>
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">手动输入不是默认流程；只有确认并通过 UAC 后才会修改，失败会回滚。</p>
          </details>
          {status?.requiresAdminForFullInspection && (
            <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">
              普通权限只能部分检测 IIS；上方管理按钮仍可使用，点击后会按需自动请求 UAC。取消 UAC 不会修改现有配置。
            </div>
          )}
          {(lastOperation?.steps?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              {lastOperation?.steps?.map((step, index) => (
                <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" key={step.id || `${step.label}-${index}`}>
                  {step.status === "success" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={14} /> : step.status === "failed" ? <AlertCircle className="mt-0.5 shrink-0 text-red-500" size={14} /> : <Loader2 className="mt-0.5 shrink-0 text-blue-500" size={14} />}
                  <span>{step.label}{step.message ? `：${step.message}` : ""}</span>
                </div>
              ))}
            </div>
          )}
          </Panel>
        </div>
      </details>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="局域网连接方式" icon={<Wifi size={18} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NetworkModeCard
              addresses={status?.networkAddresses?.wlan ?? []}
              body="相机和主机需连接同一个 Wi-Fi。部分校园网可能开启客户端隔离，导致同一 Wi-Fi 下仍无法互访。"
              empty="未检测到可用 WLAN IPv4"
              title="模式 1：同一 Wi-Fi"
              onCopy={(address) => void copyText(address, "WLAN IP")}
            />
            <NetworkModeCard
              addresses={status?.networkAddresses?.hotspot ? [status.networkAddresses.hotspot] : []}
              body="让相机连接电脑开启的 Windows 热点。此模式适合校园网设备隔离场景。"
              empty={`热点尚未检测到；常见地址 ${status?.networkAddresses?.hotspotCandidate || DEFAULT_HOTSPOT_ADDRESS}`}
              title="模式 2：Windows 热点"
              onCopy={(address) => void copyText(address, "Windows 热点 IP")}
            />
          </div>
          {(status?.networkAddresses?.warnings?.length ?? 0) > 0 && (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">{status?.networkAddresses.warnings.join("；")}</p>
          )}
        </Panel>

        <Panel title="相机连接参数" icon={<KeyRound size={18} />}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">服务器地址</span>
            <select className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" onChange={(event) => setSelectedAddress(event.target.value)} value={selectedAddress}>
              {networkOptions.length === 0 && <option value="">暂无可用地址</option>}
              {networkOptions.map((option) => <option key={option.id} value={option.address}>{option.label} · {option.address}{option.candidate ? "（候选）" : ""}</option>)}
            </select>
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ParameterTile label="服务器类型" value="FTP" />
            <ParameterTile label="端口" value={`${displayedControlPort}`} />
            <ParameterTile label="文件夹" value="/" />
            <ParameterTile label="PASV" value="开启" />
            <ParameterTile label="匿名登录" value="关闭" />
            <ParameterTile label="代理服务器" value="关闭" />
            <ParameterTile label="用户名" value={status?.account?.username || username || DEFAULT_USERNAME} />
            <ParameterTile label="密码" value={status?.passwordConfigured ? "已设置" : "未设置"} />
            <ParameterTile label="被动端口" value={`${status?.passivePorts?.start ?? PASSIVE_PORT_START}-${status?.passivePorts?.end ?? PASSIVE_PORT_END}`} />
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
            多台相机可以共用同一 FTP 账户同时上传。请为不同相机设置不同的文件名前缀，避免同名文件被覆盖。
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <CopyButton disabled={!status?.networkAddresses?.hotspot?.address} label="复制热点 IP" onClick={() => void copyText(status?.networkAddresses?.hotspot?.address || "", "Windows 热点 IP")} />
            <CopyButton disabled={(status?.networkAddresses?.wlan?.length ?? 0) === 0} label="复制 WLAN IP" onClick={() => void copyText(status?.networkAddresses?.wlan?.[0]?.address || "", "WLAN IP")} />
            <CopyButton disabled={!status?.account?.username} label="复制用户名" onClick={() => void copyText(status?.account?.username || "", "FTP 用户名")} />
            <CopyButton disabled={!selectedAddress} label="复制完整参数说明" onClick={() => void copyText(buildCameraParameters(status, selectedAddress, displayedControlPort), "相机连接参数说明")} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">已通过 Nikon Z6III 真机验证；其他支持标准 FTP 上传的相机也可按相同参数尝试连接。完整参数说明不会复制密码内容。</p>
        </Panel>
      </div>

      <Panel title="最近接收" icon={<Activity size={18} />}>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
          {(watcher?.unstableCount ?? 0) > 0 && <RecentStatChip label="正在接收" tone="info" value={watcher?.unstableCount ?? 0} />}
          {((watcher?.pendingCount ?? 0) + (watcher?.queuedCount ?? 0)) > 0 && <RecentStatChip label="等待稳定" tone="info" value={(watcher?.pendingCount ?? 0) + (watcher?.queuedCount ?? 0)} />}
          {(watcher?.importingCount ?? 0) > 0 && <RecentStatChip label="正在导入" tone="info" value={watcher?.importingCount ?? 0} />}
          {recentStatusCounts.imported > 0 && <RecentStatChip label="成功" tone="success" value={recentStatusCounts.imported} />}
          {recentStatusCounts.skipped > 0 && <RecentStatChip label="跳过" tone="warning" value={recentStatusCounts.skipped} />}
          {recentStatusCounts.failed > 0 && <RecentStatChip label="失败" tone="danger" value={recentStatusCounts.failed} />}
          <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-slate-400">
            <Clock3 size={14} />
            <span className="truncate">最近接收 {formatDateTime(watcher?.lastReceivedAt)}</span>
          </div>
        </div>
        {watcher?.lastError && <Notice className="mb-4" tone="warning" title="watcher 最近错误">{watcher.lastError}</Notice>}
        {(watcher?.recentRecords?.length ?? 0) > 0 ? (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {watcher?.recentRecords.map((record) => <RecentRecordRow key={record.id} record={record} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center text-sm text-slate-400">
            相机 FTP 上传到当前活动“原图/相机FTP”目录后，文件稳定检测和原地导入结果会显示在这里。
          </div>
        )}
      </Panel>

      {showSiteConflict && siteConflict && (
        <Panel title="发现可接管的 IIS FTP 站点" icon={<AlertCircle size={18} />}>
          <Notice tone="warning" title="需要用户确认后才能接管">
            工作台不会自动接管、重命名或删除现有 IIS 站点，也不会删除原根目录和文件。
          </Notice>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryTile label="站点名称" value={siteConflict.siteName || "未知"} />
            <SummaryTile label="根目录" value={siteConflict.physicalPath || "未知"} title={siteConflict.physicalPath} />
            <SummaryTile label="绑定" value={siteConflict.binding || `*:${displayedControlPort}:`} />
            <SummaryTile label="端口" value={`${siteConflict.port || displayedControlPort}`} />
            <SummaryTile label="状态" value={siteConflict.status || "可接管"} tone="warning" />
          </div>
          {(siteConflict.verifiedWithNikon || siteConflict.siteName === "MPW-IIS-FTP-Test") && (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">该测试站点已通过 Nikon Z6III 实机上传验证。</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => setDismissedConflictSite(siteConflict.siteName || "dismissed")} type="button">暂不处理</button>
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={uiBusy || !(selectedEvent || activeEvent) || (!status?.passwordConfigured && !credentialFormValid)} onClick={() => validateAndRequestAdoption(siteConflict.siteName || "")} type="button">接管现有站点</button>
          </div>
        </Panel>
      )}

      {pendingAction && (
        <ConfirmDialog
          confirmLabel={pendingAction.confirmLabel}
          confirming={Boolean(activeAction)}
          description={pendingAction.description}
          details={confirmDetails(pendingAction, status, selectedEvent, displayedControlPort, passivePortStart, passivePortEnd)}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmPendingAction()}
          title={pendingAction.title}
          tone={pendingAction.tone}
        >
          {pendingAction.plan && <CameraFtpProvisioningPlanSummary plan={pendingAction.plan} />}
          <div className={cn(
            "mt-3 rounded-xl border px-4 py-3 text-xs leading-5",
            pendingAction.allowLegacyFirewallRuleUpdate
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-blue-100 bg-blue-50 text-blue-700"
          )}>
            {pendingAction.allowLegacyFirewallRuleUpdate
              ? "这是一次额外的高风险确认。工作台只会更新弹窗列出的本地旧规则；策略规则、无关规则和其他程序不会被修改或停止。"
              : "管理员权限只用于本次 IIS、Windows 服务、本地账户、目录 ACL 或防火墙配置，不会让应用以后始终以管理员身份运行。"}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-2 text-slate-900">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function CameraFtpProvisioningProgress({ phases }: { phases: ReturnType<typeof getCameraFtpProvisioningProgress> }) {
  const current = phases.find((phase) => phase.status === "running") || phases[phases.length - 1];
  return (
    <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 shrink-0 animate-spin text-blue-600" size={20} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-blue-900">正在执行完整 FTP 配置计划</h3>
          <p className="mt-1 text-sm leading-6 text-blue-800">{current?.label}。如出现 Windows 用户账户控制窗口，请确认本次工作台操作。</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {phases.map((phase, index) => (
              <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white/80 px-3 py-2 text-xs" key={phase.id}>
                {phase.status === "success" ? (
                  <CheckCircle2 className="shrink-0 text-emerald-600" size={15} />
                ) : phase.status === "running" ? (
                  <Loader2 className="shrink-0 animate-spin text-blue-600" size={15} />
                ) : (
                  <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px] text-slate-400">{index + 1}</span>
                )}
                <span className={phase.status === "pending" ? "text-slate-400" : "font-medium text-slate-700"}>{phase.label.replace(/^正在/, "")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CameraFtpProvisioningPlanSummary({ plan }: { plan: CameraFtpProvisioningPlanData }) {
  const blocked = !cameraFtpPlanCanApply(plan);
  const attentionItems = plan.items.filter((item) => item.status === "blocked" || item.status === "user_confirmation_required");
  const routineIssues = plan.issues.filter((issue) => issue.level === "info" || issue.level === "auto_repair");
  const attentionIssues = plan.issues.filter((issue) => issue.level === "blocked" || issue.level === "user_confirmation");
  const statusCounts = Object.entries(CAMERA_FTP_PLAN_ITEM_STATUS_META)
    .map(([status, meta]) => ({ status, meta, count: plan.items.filter((item) => item.status === status).length }))
    .filter((entry) => entry.count > 0);
  return (
    <section className={cn("min-w-0 rounded-2xl border p-4 sm:p-5", blocked ? "border-red-200 bg-red-50" : "border-blue-100 bg-blue-50")}>
      <div className="flex items-start gap-3">
        {blocked ? <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={20} /> : <Settings2 className="mt-0.5 shrink-0 text-blue-600" size={20} />}
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", blocked ? "text-red-900" : "text-blue-900")}>{blocked ? "配置计划存在阻塞项" : "配置计划摘要"}</h3>
          <p className={cn("mt-1 text-sm leading-6", blocked ? "text-red-800" : "text-blue-800")}>{plan.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {statusCounts.map(({ status, meta, count }) => <StatusPill key={status} tone={meta.tone}>{meta.label} {count}</StatusPill>)}
          </div>
          {attentionItems.length > 0 && (
            <div className="mt-3 space-y-2">
              {attentionItems.map((item) => {
                const meta = CAMERA_FTP_PLAN_ITEM_STATUS_META[item.status];
                return (
                  <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2" key={item.id}>
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-700">{item.label}</p><p className="mt-0.5 break-words text-xs leading-5 text-slate-500">{item.summary}</p></div>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  </div>
                );
              })}
            </div>
          )}
          {attentionIssues.length > 0 && (
            <div className="mt-3 space-y-2">
              {attentionIssues.map((issue) => {
                const meta = CAMERA_FTP_ISSUE_LEVEL_META[issue.level];
                return <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs" key={issue.id}><StatusPill tone={meta.tone}>{meta.label}</StatusPill><p className="min-w-0 break-words leading-5 text-slate-600"><span className="font-semibold text-slate-700">{issue.title}：</span>{issue.message}</p></div>;
              })}
            </div>
          )}
          {plan.confirmations.length > 0 && (
            <div className="mt-3 space-y-2">
              {plan.confirmations.map((confirmation) => <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" key={confirmation.key}><span className="font-semibold">{confirmation.title}：</span>{confirmation.message}</div>)}
            </div>
          )}
          <details className="mt-3 rounded-lg border border-white/80 bg-white/60 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">查看全部配置项（{plan.items.length}）</summary>
            <div className="mt-2 max-h-[min(38vh,320px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {plan.items.map((item) => {
              const meta = CAMERA_FTP_PLAN_ITEM_STATUS_META[item.status];
              return (
                <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2" key={item.id}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700">{item.label}</p>
                    <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">{item.summary}</p>
                  </div>
                  <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                </div>
              );
            })}
            </div>
          </details>
          {routineIssues.length > 0 && (
            <details className="mt-2 rounded-lg border border-white/80 bg-white/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">查看普通信息与自动修复项（{routineIssues.length}）</summary>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {routineIssues.map((issue) => {
                const meta = CAMERA_FTP_ISSUE_LEVEL_META[issue.level];
                return (
                  <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs" key={issue.id}>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    <p className="min-w-0 break-words leading-5 text-slate-600"><span className="font-semibold text-slate-700">{issue.title}：</span>{issue.message}</p>
                  </div>
                );
              })}
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

function CameraFtpIssueCenter({ groups, onUseRecommendedPort }: {
  groups: ReturnType<typeof groupCameraFtpIssues>;
  onUseRecommendedPort?: () => void;
}) {
  const sortedGroups = [...groups].sort((left, right) => {
    const priority = { blocked: 0, user_confirmation: 1, auto_repair: 2, info: 3 } as const;
    return priority[left.level] - priority[right.level];
  });
  return (
    <section className="space-y-2" aria-label="FTP 检测结果分类">
      {sortedGroups.map((group) => {
        const hasPortChoice = group.level === "user_confirmation" && group.items.some((item) => /PORT|端口/i.test(`${item.code}${item.title}`));
        const critical = group.level === "blocked" || group.level === "user_confirmation";
        return (
          <details className={cn("rounded-xl border bg-white px-4 py-3 shadow-sm", group.level === "blocked" ? "border-red-200" : group.level === "user_confirmation" ? "border-amber-200" : "border-slate-100")} key={group.level} open={critical}>
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800"><span className="mr-2">{group.label}</span><StatusPill tone={group.tone}>{group.items.length} 项</StatusPill>{!critical && <span className="ml-2 text-xs font-normal text-slate-400">默认收起</span>}</summary>
            <div className="mt-3 max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {group.items.map((item) => (
                <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 text-xs" key={item.id}>
                  <p className="font-semibold text-slate-700">{item.title}</p>
                  <p className="mt-0.5 break-words leading-5 text-slate-600">{item.message}</p>
                </div>
              ))}
              {hasPortChoice && onUseRecommendedPort && (
                <button className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50" onClick={onUseRecommendedPort} type="button">
                  使用推荐端口
                </button>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function DiagnosticErrorCard({ diagnostic, onAdopt, onCopy, onOpenLogs, onRetry, onSelectPort }: {
  diagnostic: CameraFtpErrorPresentation;
  onAdopt?: () => void;
  onCopy: () => void;
  onOpenLogs: () => void;
  onRetry?: () => void;
  onSelectPort?: (port: number) => void;
}) {
  const warning = diagnostic.tone === "warning";
  return (
    <section className={cn(
      "rounded-2xl border p-5",
      warning ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
    )}>
      <div className="flex items-start gap-3">
        <AlertCircle className={warning ? "text-amber-600" : "text-red-600"} size={20} />
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", warning ? "text-amber-900" : "text-red-900")}>{diagnostic.title}</h3>
          <p className={cn("mt-1 text-sm leading-6", warning ? "text-amber-800" : "text-red-800")}>{diagnostic.body}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">失败阶段</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.stage}</dd></div>
            <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">建议</dt><dd className="mt-1 leading-5 text-slate-700">{diagnostic.advice}</dd></div>
            {diagnostic.conflictPort !== undefined && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">冲突端口</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.conflictPort}</dd></div>}
            {diagnostic.conflictOwner && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">占用来源</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.conflictOwner}</dd></div>}
            {diagnostic.rollbackAttempted !== undefined && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">自动回滚</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.rollbackSummary || (diagnostic.rollbackAttempted ? "已尝试，结果未知" : "未修改系统，无需回滚")}</dd></div>}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onRetry} type="button">重试</button>}
            {onSelectPort && diagnostic.availablePorts.slice(0, 3).map((port) => <button className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700" key={port} onClick={() => onSelectPort(port)} type="button">选择端口 {port}</button>)}
            {onAdopt && <button className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50" onClick={onAdopt} type="button">接管现有站点</button>}
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onCopy} type="button">复制技术详情</button>
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onOpenLogs} type="button">打开日志目录</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value, tone = "neutral", title, className }: { label: string; value: string; tone?: "neutral" | "success" | "warning" | "danger"; title?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-slate-50 px-4 py-3", className)}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-medium", tone === "success" ? "text-emerald-600" : tone === "warning" ? "text-amber-700" : tone === "danger" ? "text-red-600" : "text-slate-800")} title={title || value}>{value}</p>
    </div>
  );
}

function RecentStatChip({ label, value, tone }: { label: string; value: number; tone: "info" | "success" | "warning" | "danger" }) {
  const toneClass = tone === "success"
    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
    : tone === "warning"
      ? "border-amber-100 bg-amber-50 text-amber-700"
      : tone === "danger"
        ? "border-red-100 bg-red-50 text-red-700"
        : "border-blue-100 bg-blue-50 text-blue-700";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", toneClass)}>
      <span>{label}</span>
      <strong className="font-semibold tabular-nums">{value}</strong>
    </span>
  );
}

function ParameterTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800" title={value}>{value}</p>
    </div>
  );
}

type StatusMeta = { tone: "success" | "warning" | "danger" | "neutral" | "info"; label: string };

function EnvironmentRow({ label, meta, detail }: { label: string; meta: StatusMeta; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {detail && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={detail}>{detail}</p>}
      </div>
      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
    </div>
  );
}

function ActionButton({ disabled, icon, label, loading, onClick, primary = false }: { disabled: boolean; icon: ReactNode; label: string; loading: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      className={cn(
        "flex min-h-[46px] min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-semibold leading-5 transition-colors",
        disabled
          ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
          : primary
            ? "border border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
            : "border border-blue-200 bg-white text-blue-700 shadow-sm hover:bg-blue-50"
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {loading ? <Loader2 className="animate-spin" size={15} /> : icon}
      <span className="whitespace-normal break-words">{label}</span>
    </button>
  );
}

function CopyButton({ disabled = false, label, onClick }: { disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={disabled} onClick={onClick} type="button">
      <Copy size={13} />
      {label}
    </button>
  );
}

function NetworkModeCard({ title, body, addresses, empty, onCopy }: { title: string; body: string; addresses: CameraFtpNetworkAddressData[]; empty: string; onCopy: (address: string) => void }) {
  return (
    <div className="flex min-h-[190px] flex-col rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-slate-800"><Wifi size={16} className="text-blue-600" /><h4 className="text-sm font-semibold">{title}</h4></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{body}</p>
      <div className="mt-3 space-y-2">
        {addresses.length > 0 ? addresses.map((item) => (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2" key={item.id || `${item.interfaceName}-${item.address}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-blue-600">{item.address}</p>
              <p className="truncate text-[11px] text-slate-400">{item.interfaceName || item.label}</p>
            </div>
            <button aria-label={`复制 ${item.label || item.address}`} className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600" onClick={() => onCopy(item.address)} title="复制地址" type="button"><Copy size={13} /></button>
          </div>
        )) : <p className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-400">{empty}</p>}
      </div>
    </div>
  );
}

function RecentRecordRow({ record }: { record: CameraFtpRecentRecordData }) {
  const meta = recordStatusMeta(record.status);
  const statusIcon = recordStatusIcon(record.status);
  const detailMessage = record.status === "failed" ? record.error || record.reason : "";
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800" title={record.filename}>{record.filename}</p>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-slate-400">
            <span>{formatBytes(record.size)}</span>
            <span>接收 {formatDateTime(record.receivedAt || record.detectedAt)}</span>
            {record.importedAt && <span>导入 {formatDateTime(record.importedAt)}</span>}
          </div>
        </div>
        <StatusPill tone={meta.tone}><span className="flex items-center gap-1.5">{statusIcon}{meta.label}</span></StatusPill>
      </div>
      {detailMessage && (
        <p className="mt-2 break-words text-xs leading-5 text-red-600">
          {detailMessage}
        </p>
      )}
    </div>
  );
}

function buildAddressOptions(status: CameraFtpStatusData | null): AddressOption[] {
  const network = status?.networkAddresses;
  const result: AddressOption[] = [];
  const seen = new Set<string>();
  const add = (item: CameraFtpNetworkAddressData | null | undefined, candidate = false) => {
    if (!item?.address || seen.has(item.address)) return;
    seen.add(item.address);
    result.push({ ...item, candidate });
  };
  add(network?.hotspot);
  network?.wlan?.forEach((item) => add(item));
  network?.ethernet?.forEach((item) => add(item));
  network?.lan?.forEach((item) => add(item));
  if (!network?.hotspot && network?.hotspotCandidate) {
    add({
      id: `hotspot-candidate-${network.hotspotCandidate}`,
      label: "Windows 热点候选",
      address: network.hotspotCandidate,
      interfaceName: "热点开启后请刷新确认",
      kind: "hotspot"
    }, true);
  }
  return result;
}

function getOverallStatus(status: CameraFtpStatusData | null, action: string | null, uacCancelled = false, serviceReady = false): StatusMeta {
  if (action) return { tone: "info", label: action === "start" || action === "restart" ? "正在启动" : "正在配置" };
  if (uacCancelled) return { tone: "warning", label: "UAC 被取消" };
  if (!status) return { tone: "danger", label: "配置异常" };
  if (!status.platform?.supported) return { tone: "danger", label: "配置异常" };
  if (serviceReady) return { tone: "success", label: "运行中" };
  if (status.lastError && status.inspectionLevel !== "partial") return { tone: "danger", label: "配置异常" };
  if (status.conflicts?.items?.length || status.port?.conflict === true || status.account?.conflict === true) return { tone: "warning", label: "需要用户选择" };
  if (!status.passwordConfigured || !status.activeEvent?.valid) return { tone: "warning", label: "需要配置" };
  if (status.windowsFeatures?.ftpService?.installed === false || status.site?.exists === false) return { tone: "warning", label: "需要配置" };
  if (status.service?.running === false || status.site?.started === false) return { tone: "warning", label: "已停止" };
  if (hasUnknownSystemDetection(status)) return { tone: "warning", label: "需管理员检测" };
  if (!status.passwordConfigured || !status.activeEvent?.valid || status.binding?.correct === false || status.authentication?.correct === false || status.authorization?.correct === false || status.acl?.correct === false || status.firewall?.correct === false) {
    return { tone: "warning", label: "配置不完整" };
  }
  return { tone: "success", label: "运行中" };
}

function featureMeta(status: CameraFtpStatusData | null): StatusMeta {
  if (!status?.windowsFeatures) return { tone: "neutral", label: "检测失败" };
  const features = [status.windowsFeatures.ftpService, status.windowsFeatures.ftpExtensibility, status.windowsFeatures.managementTools];
  if (features.some((item) => item?.installed == null)) return { tone: "neutral", label: "需管理员检测" };
  if (features.every((item) => item?.installed)) return { tone: "success", label: "正常" };
  return { tone: "warning", label: "未安装" };
}

function featureDetail(status: CameraFtpStatusData | null): string {
  const features = status?.windowsFeatures;
  if (!features) return "等待检测";
  if ([features.ftpService, features.ftpExtensibility, features.managementTools].some((item) => item?.installed == null)) {
    return "普通权限无法读取完整 IIS 组件状态";
  }
  return [features.ftpService, features.ftpExtensibility, features.managementTools]
    .filter((item) => !item?.installed)
    .map((item) => item?.featureName)
    .filter(Boolean)
    .join("、") || "FTP 服务、扩展性与管理工具已安装";
}

function booleanMeta(value: boolean | null | undefined, falseLabel: string): StatusMeta {
  if (value === true) return { tone: "success", label: "正常" };
  if (value == null) return { tone: "neutral", label: "需管理员检测" };
  return { tone: falseLabel.includes("冲突") ? "danger" : "warning", label: falseLabel };
}

function portMeta(status: CameraFtpStatusData | null): StatusMeta {
  if (!status?.port) return { tone: "neutral", label: "检测失败" };
  if (status.port.conflict === true) return { tone: "danger", label: "冲突" };
  if (status.port.listening == null) return { tone: "neutral", label: "检测失败" };
  return status.port.listening ? { tone: "success", label: "正常" } : { tone: "warning", label: "未监听" };
}

function portDetail(status: CameraFtpStatusData | null): string {
  const port = status?.controlPort ?? DEFAULT_CONTROL_PORT;
  if (!status?.port) return `TCP ${port}`;
  return [`TCP ${status.port.configuredPort || port}`, status.port.processName, status.port.pid ? `PID ${status.port.pid}` : "", status.port.iisSiteName].filter(Boolean).join(" · ");
}

function getPortAvailabilityMeta(valid: boolean, portCheck: CameraFtpPortCheckData | null, checking: boolean): StatusMeta {
  if (!valid) return { tone: "danger", label: "输入无效" };
  if (checking) return { tone: "info", label: "检测中" };
  if (!portCheck) return { tone: "neutral", label: "等待检测" };
  if (portCheck.port.reserved === true) return { tone: "danger", label: "Windows 保留" };
  if (portCheck.port.conflict === true) return { tone: "danger", label: "端口冲突" };
  if (portCheck.requiresAdminForFullInspection || portCheck.port.conflict === null) return { tone: "warning", label: "需管理员确认" };
  return { tone: "success", label: "可用" };
}

function buildPortConflictSummary(check: CameraFtpPortCheckData | null): string {
  if (!check) return "当前控制端口存在冲突。工作台不会停止其他程序、修改无关 IIS 站点或自动切换端口。";
  const port = check.controlPort;
  if (check.port.reserved === true) {
    return `TCP ${port} 属于 Windows 保留端口${check.port.reservedRange ? `（${check.port.reservedRange}）` : ""}。请选择其他端口。`;
  }
  if (check.port.processName) {
    return `${check.port.processName}${check.port.pid ? `（PID ${check.port.pid}）` : ""}正在使用 TCP ${port}。工作台不会结束该进程，请选择其他端口。`;
  }
  if ((check.port.iisSiteNames?.length ?? 0) > 0) {
    return `IIS FTP 站点“${check.port.iisSiteNames.join("、")}”正在使用 TCP ${port}。无关站点不会被修改；请选择其他端口，或仅对明确可接管站点执行接管。`;
  }
  return `TCP ${port} 当前不可安全使用。工作台不会强行占用，请选择推荐端口后重新检测。`;
}

function accountMeta(status: CameraFtpStatusData | null): StatusMeta {
  if (!status?.account) return { tone: "neutral", label: "检测失败" };
  if (status.account.conflict === true) return { tone: "danger", label: "冲突" };
  if (status.account.exists == null || status.account.enabled == null) return { tone: "neutral", label: "需管理员检测" };
  if (!status.account.exists) return { tone: "warning", label: "未配置" };
  if (!status.account.enabled) return { tone: "danger", label: "已禁用" };
  return { tone: "success", label: "正常" };
}

function hasUnknownSystemDetection(status: CameraFtpStatusData): boolean {
  return [
    status.windowsFeatures?.ftpService?.installed,
    status.windowsFeatures?.ftpExtensibility?.installed,
    status.windowsFeatures?.managementTools?.installed,
    status.service?.exists,
    status.service?.running,
    status.site?.exists,
    status.site?.started,
    status.binding?.correct,
    status.authentication?.correct,
    status.authorization?.correct,
    status.account?.exists,
    status.account?.enabled,
    status.acl?.correct,
    status.passivePorts?.correct,
    status.firewall?.correct,
    status.port?.listening
  ].some((value) => value == null);
}

function getServiceSummary(status: CameraFtpStatusData | null, action: string | null, serviceReady: boolean): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  if (action === "start" || action === "restart") return { label: "正在启动", tone: "neutral" };
  if (action) return { label: "正在配置", tone: "neutral" };
  if (serviceReady) return { label: "运行中", tone: "success" };
  if (!status || status.lastError) return { label: "配置异常", tone: "danger" };
  if (!status.initialized || status.site?.exists === false) return { label: "需要配置", tone: "warning" };
  if (status.site?.started == null) return { label: "需要管理员检测", tone: "neutral" };
  return { label: "已停止", tone: "warning" };
}

type CameraActivityMeta = StatusMeta & {
  description: string;
  lastConnectionAt: string;
};

function getCameraActivityMeta(watcher: CameraFtpWatcherData | undefined, serviceReady: boolean): CameraActivityMeta {
  if (!serviceReady) {
    return {
      tone: "neutral",
      label: "暂无相机连接",
      description: "FTP 服务未运行时相机无法建立上传连接。",
      lastConnectionAt: watcher?.lastReceivedAt || ""
    };
  }
  const transferring = (watcher?.unstableCount ?? 0) > 0
    || (watcher?.pendingCount ?? 0) > 0
    || (watcher?.queuedCount ?? 0) > 0
    || (watcher?.importingCount ?? 0) > 0;
  if (transferring) {
    return {
      tone: "info",
      label: "正在传输",
      description: "watcher 检测到文件正在接收、等待稳定或进入自动导入流程。",
      lastConnectionAt: watcher?.lastReceivedAt || ""
    };
  }
  const lastReceivedAt = watcher?.lastReceivedAt ? new Date(watcher.lastReceivedAt).getTime() : Number.NaN;
  const recentlyActive = Number.isFinite(lastReceivedAt) && Date.now() - lastReceivedAt <= 5 * 60 * 1000;
  if (recentlyActive) {
    return {
      tone: "success",
      label: "最近有相机连接",
      description: "最近 5 分钟检测到相机 FTP 文件活动；这表示近期连接，不代表相机仍保持在线。",
      lastConnectionAt: watcher?.lastReceivedAt || ""
    };
  }
  if (watcher?.running) {
    return {
      tone: "neutral",
      label: "暂无相机连接活动",
      description: "FTP 已就绪，但最近 5 分钟没有检测到文件接收活动。",
      lastConnectionAt: watcher.lastReceivedAt || ""
    };
  }
  return {
    tone: "warning",
    label: "连接状态未知",
    description: "当前没有可用于推断相机活动的 watcher 数据。",
    lastConnectionAt: watcher?.lastReceivedAt || ""
  };
}

function countRecentRecordStatuses(records: CameraFtpRecentRecordData[]): Record<CameraFtpRecentRecordData["status"], number> {
  return records.reduce<Record<CameraFtpRecentRecordData["status"], number>>((counts, record) => {
    counts[record.status] += 1;
    return counts;
  }, { receiving: 0, waiting: 0, importing: 0, imported: 0, skipped: 0, failed: 0 });
}

function recordStatusMeta(status: CameraFtpRecentRecordData["status"]): StatusMeta {
  const map: Record<CameraFtpRecentRecordData["status"], StatusMeta> = {
    receiving: { tone: "info", label: "正在接收" },
    waiting: { tone: "info", label: "等待稳定" },
    importing: { tone: "info", label: "正在导入" },
    imported: { tone: "success", label: "导入成功" },
    skipped: { tone: "warning", label: "重复跳过" },
    failed: { tone: "danger", label: "导入失败" }
  };
  return map[status];
}

function recordStatusIcon(status: CameraFtpRecentRecordData["status"]): ReactNode {
  if (status === "imported") return <CheckCircle2 size={13} />;
  if (status === "failed") return <AlertCircle size={13} />;
  if (status === "receiving" || status === "waiting" || status === "importing") return <Loader2 className="animate-spin" size={13} />;
  return <Clock3 size={13} />;
}

function apiErrorMessage<T>(response: ApiResponse<T>, fallback: string): MessageState {
  const diagnostic = buildCameraFtpErrorPresentation(response, fallback);
  return { tone: diagnostic.tone, title: diagnostic.title, body: diagnostic.body, diagnostic };
}

function operationTitle(action: ConfirmableAction): string {
  const labels: Record<ConfirmableAction, string> = {
    setup: "IIS FTP 已配置并启动",
    "adopt-site": "IIS FTP 站点接管完成",
    start: "IIS FTP 已启动",
    stop: "IIS FTP 已停止",
    restart: "IIS FTP 已重启",
    repair: "IIS FTP 修复完成",
    credentials: "FTP 账户设置已保存",
    "active-event": "FTP 接收活动已切换"
  };
  return labels[action];
}

function confirmDetails(
  action: PendingAction,
  status: CameraFtpStatusData | null,
  selectedEvent: EventData | null,
  controlPort: number,
  passivePortStart: string,
  passivePortEnd: string
): Array<{ label: string; value: string }> {
  if (action.allowLegacyFirewallRuleUpdate) {
    const changes = action.firewallRuleChanges || [];
    return [
      { label: "风险级别", value: "高：将修改已有的本地 Windows 防火墙规则" },
      ...changes.map((change) => ({
        label: change.kind === "passive" ? "被动端口规则" : "控制端口规则",
        value: `${change.currentPort} / ${change.currentRemoteAddress} → ${change.targetPort} / ${change.targetRemoteAddress}`
      })),
      { label: "修改边界", value: "只更新上述本地规则，不修改组策略或其他规则" },
      { label: "失败保护", value: "配置后续失败时恢复规则原值" }
    ];
  }
  if (action.kind === "setup") {
    return [
      { label: "接收活动", value: selectedEvent?.name || "未选择" },
      { label: "接收目录", value: selectedEvent ? `working\\${selectedEvent.slug}\\原图\\相机FTP\\` : "未确定" },
      { label: "用户名", value: action.username || status?.account?.username || DEFAULT_USERNAME },
      { label: "系统修改", value: "确认后自动请求 Windows 管理员权限" },
      { label: "控制 / 被动端口", value: `${controlPort} / ${passivePortStart}-${passivePortEnd}` }
    ];
  }
  if (action.kind === "active-event") {
    if (action.unlink) {
      return [
        { label: "当前活动", value: status?.activeEvent?.name || "未设置" },
        { label: "IIS 站点", value: status?.site?.name || "MediaPhotoWorkbenchFTP" },
        { label: "数据保留", value: "接收目录与文件不会删除" }
      ];
    }
    return [
      { label: "当前活动", value: status?.activeEvent?.name || "未设置" },
      { label: "目标活动", value: selectedEvent?.name || "未选择" },
      { label: "接收目录", value: selectedEvent ? `working\\${selectedEvent.slug}\\原图\\相机FTP\\` : "未确定" }
    ];
  }
  if (action.kind === "adopt-site") {
    return [
      { label: "站点名称", value: action.siteName || "未识别" },
      { label: "控制端口", value: `${controlPort}` },
      { label: "数据保留", value: "不删除原目录和文件" }
    ];
  }
  if (action.kind === "credentials") {
    return [
      { label: "用户名", value: action.username || status?.account?.username || DEFAULT_USERNAME },
      { label: "密码", value: "仅本次安全提交，不回显" }
    ];
  }
  return [
    { label: "IIS 站点", value: status?.site?.name || "MediaPhotoWorkbenchFTP" },
    { label: "控制端口", value: `${controlPort}` },
    { label: "被动端口", value: `${passivePortStart}-${passivePortEnd}` }
  ];
}

function buildCameraParameters(status: CameraFtpStatusData | null, address: string, controlPort: number): string {
  return [
    "相机 FTP 连接参数",
    `服务器类型：FTP`,
    `服务器地址：${address}`,
    `文件夹：/`,
    `端口：${controlPort}`,
    "PASV：开启",
    "匿名登录：关闭",
    "代理服务器：关闭",
    `用户名：${status?.account?.username || DEFAULT_USERNAME}`,
    `密码：${status?.passwordConfigured ? "已设置，请在相机中填写" : "未设置，请先在工作台设置"}`,
    `被动端口：${status?.passivePorts?.start ?? PASSIVE_PORT_START}-${status?.passivePorts?.end ?? PASSIVE_PORT_END}`,
    "多相机：请为不同相机设置不同文件名前缀，避免同名文件被覆盖。",
    "说明：此文本不包含 FTP 密码。"
  ].join("\n");
}

function formatDateTime(value?: string): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
