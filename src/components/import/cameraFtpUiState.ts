import type {
  CameraFtpIssueData,
  CameraFtpIssueLevel,
  CameraFtpProvisioningPlanData,
  CameraFtpProvisioningPlanItemStatus,
  CameraFtpStatusData
} from "../../lib/api";

export type { CameraFtpErrorPresentation } from "./camera-ftp/cameraFtpErrorPresentation";
export {
  buildCameraFtpErrorPresentation,
  stageLabel
} from "./camera-ftp/cameraFtpErrorPresentation";

export type CameraFtpProvisioningPhaseStatus = "pending" | "running" | "success";

export interface CameraFtpProvisioningPhasePresentation {
  id: string;
  label: string;
  status: CameraFtpProvisioningPhaseStatus;
}

export type CameraFtpInspectionObservationSource = "ordinary" | "admin";

export interface CameraFtpInspectionSnapshot {
  source: CameraFtpInspectionObservationSource;
  label: string;
  status: CameraFtpStatusData;
  inspectedAt: string;
}

export interface CameraFtpStatusUiState {
  current: CameraFtpInspectionSnapshot | null;
  lastFullInspection: CameraFtpInspectionSnapshot | null;
}

export interface CameraFtpStatusObservation {
  source: CameraFtpInspectionObservationSource;
  status: CameraFtpStatusData;
  inspectedAt: string;
  requestId: number;
  latestRequestId: number;
}

/** Keep current truth and historical administrator evidence in separate lanes. */
export function applyCameraFtpStatusObservation(
  state: CameraFtpStatusUiState,
  observation: CameraFtpStatusObservation
): CameraFtpStatusUiState {
  if (observation.requestId < observation.latestRequestId) return state;

  const current: CameraFtpInspectionSnapshot = {
    source: observation.source,
    label: observation.source === "admin" ? "当前管理员完整检测" : "当前普通检测",
    status: observation.status,
    inspectedAt: observation.inspectedAt
  };
  const lastFullInspection = observation.source === "admin"
    && observation.status.inspectionLevel === "full"
    ? { ...current, label: "最近管理员完整检测" }
    : state.lastFullInspection;

  return { current, lastFullInspection };
}

export const CAMERA_FTP_PROVISIONING_PHASES = [
  { id: "environment", label: "正在检查系统环境" },
  { id: "account", label: "正在配置 FTP 账户" },
  { id: "acl", label: "正在修复目录权限" },
  { id: "iis", label: "正在配置 IIS FTP 站点" },
  { id: "network", label: "正在配置端口和防火墙" },
  { id: "start", label: "正在启动 FTP 服务" },
  { id: "verify", label: "正在验证连接状态" }
] as const;

export function getCameraFtpProvisioningProgress(
  activeIndex: number,
  completed = false
): CameraFtpProvisioningPhasePresentation[] {
  const normalizedIndex = Math.max(0, Math.min(activeIndex, CAMERA_FTP_PROVISIONING_PHASES.length - 1));
  return CAMERA_FTP_PROVISIONING_PHASES.map((phase, index) => ({
    ...phase,
    status: completed || index < normalizedIndex ? "success" : index === normalizedIndex ? "running" : "pending"
  }));
}

export const CAMERA_FTP_ISSUE_LEVEL_META: Record<CameraFtpIssueLevel, { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  info: { label: "信息提示", tone: "info" },
  auto_repair: { label: "可自动修复", tone: "success" },
  user_confirmation: { label: "需要用户确认", tone: "warning" },
  blocked: { label: "阻塞错误", tone: "danger" }
};

export function groupCameraFtpIssues(issues: CameraFtpIssueData[]): Array<{
  level: CameraFtpIssueLevel;
  label: string;
  tone: "info" | "success" | "warning" | "danger";
  items: CameraFtpIssueData[];
}> {
  return (Object.keys(CAMERA_FTP_ISSUE_LEVEL_META) as CameraFtpIssueLevel[])
    .map((level) => ({ level, ...CAMERA_FTP_ISSUE_LEVEL_META[level], items: issues.filter((issue) => issue.level === level) }))
    .filter((group) => group.items.length > 0);
}

export function cameraFtpPlanCanApply(plan: CameraFtpProvisioningPlanData | null): boolean {
  return Boolean(plan?.canApply && !plan.items.some((item) => item.status === "blocked") && !plan.issues.some((issue) => issue.level === "blocked"));
}

export const CAMERA_FTP_PLAN_ITEM_STATUS_META: Record<CameraFtpProvisioningPlanItemStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  already_ok: { label: "已符合", tone: "success" },
  create: { label: "将创建", tone: "neutral" },
  update: { label: "将更新", tone: "neutral" },
  repair: { label: "将修复", tone: "warning" },
  user_confirmation_required: { label: "需要确认", tone: "warning" },
  blocked: { label: "无法继续", tone: "danger" }
};

export function buildCameraFtpStatusIssues(status: CameraFtpStatusData | null): CameraFtpIssueData[] {
  if (!status) return [];
  const issues: CameraFtpIssueData[] = [];
  const add = (issue: CameraFtpIssueData) => {
    if (!issues.some((item) => item.id === issue.id)) issues.push(issue);
  };

  if (status.inspectionLevel === "partial") {
    add({
      id: "partial-inspection",
      code: "PARTIAL_INSPECTION",
      level: "info",
      title: "普通权限部分检测",
      message: "部分 IIS 配置需要在执行系统操作时通过 UAC 完整确认，不会阻止填写配置。"
    });
  }
  if (status.acl?.correct === false) {
    add({ id: "acl-repair", code: "FTP_ACL_REPAIR_REQUIRED", level: "auto_repair", title: "目录权限需要修复", message: "工作台可在配置时补齐 FTP 账户所需权限，并保留其他合法 ACL。" });
  }
  if (status.passivePorts?.correct === false) {
    add({ id: "pasv-repair", code: "FTP_PASSIVE_PORTS_REPAIR_REQUIRED", level: "auto_repair", title: "被动端口配置不一致", message: "工作台可同步当前 PASV 范围；应用前会提示这是 IIS 服务器级配置。" });
  }
  if (status.firewall?.correct === false) {
    add({ id: "firewall-repair", code: "FTP_FIREWALL_REPAIR_REQUIRED", level: "auto_repair", title: "防火墙规则需要修复", message: "工作台可校正自己管理的控制端口与被动端口规则。" });
  }
  if (status.conflicts?.pathConflict === true) {
    add({ id: "path-repair", code: "FTP_PATH_REPAIR_REQUIRED", level: "auto_repair", title: "接收目录需要同步", message: "工作台可同步 IIS physicalPath 与 watcher，不移动或删除已有文件。" });
  }
  if (status.acl?.broadInheritedAccess === true) {
    add({ id: "broad-acl", code: "FTP_ACL_BROAD_ACCESS", level: "user_confirmation", title: "目录继承了宽泛写权限", message: "收紧上级目录写权限可能影响其他用户，需要管理员确认后处理。" });
  }
  if (status.port?.conflict === true) {
    add({ id: "port-conflict", code: "FTP_CONTROL_PORT_IN_USE", level: "user_confirmation", title: `控制端口 ${status.controlPort} 需要用户选择`, message: status.port.recommendation || "请选择推荐端口，或明确接管可接管的 IIS FTP 站点。" });
  }
  if (status.account?.conflict === true) {
    add({ id: "account-conflict", code: "FTP_ACCOUNT_CONFLICT", level: "user_confirmation", title: "FTP 用户名与现有账户冲突", message: "请选择其他用户名，或仅在确认账户归属后继续。" });
  }
  status.conflicts?.items?.filter((item) => item.type === "site" && item.adoptable).forEach((item, index) => {
    add({ id: `adopt-site-${item.siteName || index}`, code: item.code || "IIS_SITE_ADOPTION_REQUIRED", level: "user_confirmation", title: `可接管 IIS FTP 站点${item.siteName ? `：${item.siteName}` : ""}`, message: item.recommendation || "接管只会在明确确认后执行，也可以选择其他控制端口。" });
  });
  if (status.lastError && status.inspectionLevel !== "partial") {
    add({ id: "last-error", code: status.lastError.code, level: "blocked", title: "最近一次 IIS FTP 操作失败", message: localizeCameraFtpUiWarning(status.lastError.message) });
  }
  status.warnings?.forEach((warning, index) => {
    if (/could not be read without elevated access|configuration access is incomplete/i.test(warning)) return;
    if (/inherits write-capable access for broad Windows principals/i.test(warning)) return;
    add({ id: `status-warning-${index}`, code: "CAMERA_FTP_STATUS_WARNING", level: "info", title: "配置提示", message: localizeCameraFtpUiWarning(warning) });
  });
  return issues;
}

export interface CameraFtpButtonState {
  configureAndStart: boolean;
  discoverSites: boolean;
  start: boolean;
  stop: boolean;
  restart: boolean;
  repair: boolean;
  passwordMessage: string;
}

export function getCameraFtpButtonState(input: {
  status: CameraFtpStatusData | null;
  busy: boolean;
  selectedEvent: boolean;
  credentialFormValid: boolean;
  portFormValid: boolean;
  serviceReady: boolean;
}): CameraFtpButtonState {
  const initialized = input.status?.initialized === true;
  const passwordConfigured = input.status?.passwordConfigured === true;
  const activeEventValid = input.status?.activeEvent?.valid === true;
  const managementReady = initialized && activeEventValid && !input.busy;
  return {
    configureAndStart: Boolean(
      !initialized
        && input.status?.platform?.supported
        && input.selectedEvent
        && input.credentialFormValid
        && input.portFormValid
        && !input.busy
    ),
    discoverSites: Boolean(input.selectedEvent && !input.busy),
    start: managementReady && passwordConfigured && !input.serviceReady,
    stop: managementReady && input.status?.site?.started === true,
    restart: managementReady && passwordConfigured,
    repair: managementReady && input.portFormValid,
    passwordMessage: initialized && !passwordConfigured
      ? "FTP 账户尚未设置密码，请先完成账户配置。"
      : ""
  };
}

export interface CameraFtpPortSettingsValidation {
  valid: boolean;
  controlPort: number | null;
  passivePortStart: number | null;
  passivePortEnd: number | null;
  controlPortError: string;
  passiveRangeError: string;
}

export function validateCameraFtpPortSettings(
  controlPortText: string,
  passivePortStartText: string,
  passivePortEndText: string
): CameraFtpPortSettingsValidation {
  const parsePort = (value: string): number | null => {
    if (!/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
  };
  const controlPort = parsePort(controlPortText);
  const passivePortStart = parsePort(passivePortStartText);
  const passivePortEnd = parsePort(passivePortEndText);
  const controlPortError = controlPort === null ? "控制端口必须是 1–65535 之间的整数。" : "";
  let passiveRangeError = "";
  if (passivePortStart === null || passivePortEnd === null || passivePortStart > passivePortEnd) {
    passiveRangeError = "被动端口必须是 1–65535 之间的有效范围。";
  } else if (controlPort !== null && controlPort >= passivePortStart && controlPort <= passivePortEnd) {
    passiveRangeError = "控制端口不能落入被动端口范围。";
  }
  return {
    valid: !controlPortError && !passiveRangeError,
    controlPort,
    passivePortStart,
    passivePortEnd,
    controlPortError,
    passiveRangeError
  };
}

export function localizeCameraFtpUiWarning(message: string): string {
  if (!message) return "检测到一项 IIS FTP 配置提醒。";
  if (/could not be read without elevated access|configuration access is incomplete/i.test(message)) {
    return "普通权限下无法读取完整 IIS 站点配置，执行系统操作时工作台会自动请求管理员权限。";
  }
  if (/inherits write-capable access for broad Windows principals/i.test(message)) {
    return "FTP 接收目录继承了面向宽泛 Windows 用户组的可写权限，请由管理员确认上级目录权限。";
  }
  return /^[\x00-\x7F]+$/.test(message)
    ? "检测到一项 IIS FTP 配置提醒，请查看状态卡或日志中的结构化诊断。"
    : message;
}
