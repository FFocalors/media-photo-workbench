import type { CameraFtpConfig } from "../../config/config";
import type { IisFtpSystemStatus } from "./iisFtpStatusTypes";

export const CAMERA_FTP_GUIDE_PATH = "/host/help/camera-ftp";

export interface CameraFtpManualIssue {
  code: string;
  section: string;
  message: string;
  blocksControl: boolean;
}

export function getCameraFtpManualIssue(system: IisFtpSystemStatus, config: CameraFtpConfig, expectedPathMatches?: boolean): CameraFtpManualIssue | null {
  if (!system.platform.supported) return { code: "UNSUPPORTED_PLATFORM", section: "requirements", message: "相机 FTP 需要 Windows 11。", blocksControl: true };
  if (system.windowsFeatures.ftpService.installed === false || system.windowsFeatures.ftpExtensibility.installed === false || system.windowsFeatures.managementTools.installed === false) {
    return { code: "IIS_FTP_FEATURE_MISSING", section: "features", message: "IIS FTP 组件未完整启用。", blocksControl: true };
  }
  if (system.service.exists === false) return { code: "FTP_SERVICE_NOT_FOUND", section: "service", message: "未找到 Microsoft FTP Service。", blocksControl: true };
  if (system.site.exists === false) return { code: "IIS_SITE_NOT_FOUND", section: "site", message: "未找到工作台 FTP 站点。", blocksControl: true };
  if (system.site.exists === null) return { code: system.lastError?.code || "IIS_STATUS_ADMIN_REQUIRED", section: "verification", message: "暂时无法确认 IIS 站点状态，请执行管理员只读检测。", blocksControl: true };
  if (system.site.name !== config.siteName || system.site.managed !== true || (config.managedSiteId > 0 && system.site.id !== config.managedSiteId)) {
    return { code: "MANAGED_SITE_ID_MISMATCH", section: "site", message: "站点身份或 FTP 账户标记与工作台设置不符。", blocksControl: true };
  }
  if (system.binding.correct === false) return { code: "SITE_BINDING_MISMATCH", section: "binding", message: "站点绑定与控制端口不符。", blocksControl: true };
  if (system.authentication.correct === false || system.site.sslEnabled === true) return { code: "IIS_AUTH_CONFIGURATION_MISMATCH", section: "auth", message: "FTP 身份验证或 SSL 设置不符。", blocksControl: true };
  if (system.authorization.correct === false) return { code: "FTP_AUTHORIZATION_MISMATCH", section: "auth", message: "FTP 读写授权规则不符。", blocksControl: true };
  if (system.account.exists === false || system.account.enabled === false || system.account.managed === false) {
    return { code: "FTP_ACCOUNT_STATE_MISMATCH", section: "account", message: "FTP 账户缺失、已禁用或缺少工作台标记。", blocksControl: true };
  }
  if (expectedPathMatches === false) return { code: "PHYSICAL_PATH_MISMATCH", section: "site", message: "站点物理路径与当前接收活动不一致，请先执行活动切换。", blocksControl: true };
  if (system.acl.exists === false || system.acl.correct === false) return { code: "FTP_DIRECTORY_PERMISSION_REQUIRED", section: "permissions", message: "接收目录缺少可继承的读写权限。", blocksControl: true };
  if (system.port.conflict === true) return { code: "FTP_CONTROL_PORT_IN_USE", section: "binding", message: "控制端口已被其他站点或进程占用。", blocksControl: true };
  if (system.service.pending === true) return { code: "FTP_SERVICE_PENDING", section: "service", message: "Microsoft FTP Service 正在切换状态，请稍后重新检测。", blocksControl: true };
  if (system.service.startType?.toLowerCase() === "disabled") return { code: "FTP_SERVICE_DISABLED", section: "service", message: "Microsoft FTP Service 已禁用，请手工调整启动类型。", blocksControl: true };
  if (system.service.running === false) return { code: "FTP_SERVICE_NOT_RUNNING", section: "service", message: "Microsoft FTP Service 尚未运行。", blocksControl: true };
  if (system.site.started === null) return { code: "IIS_SITE_STATE_UNKNOWN", section: "verification", message: "无法确认工作台 FTP 站点运行状态，请使用管理员只读检测。", blocksControl: true };
  if ([system.windowsFeatures.ftpService.installed, system.windowsFeatures.ftpExtensibility.installed,
    system.windowsFeatures.managementTools.installed, system.service.exists, system.service.running,
    system.binding.correct, system.authentication.correct, system.authorization.correct,
    system.account.exists, system.account.enabled, system.account.managed, system.acl.correct, system.port.conflict].some((value) => value === null)) {
    return { code: "IIS_STATUS_ADMIN_REQUIRED", section: "verification", message: "关键配置仍有未知状态，请使用管理员只读检测。", blocksControl: true };
  }
  if (system.lastError) return { code: system.lastError.code, section: "troubleshooting", message: system.lastError.message, blocksControl: true };
  if (system.passivePorts.correct === false) return { code: "PASSIVE_PORT_MISMATCH", section: "passive", message: "IIS 被动端口范围与工作台设置不符；站点可启停，但相机传输可能失败。", blocksControl: false };
  if (system.firewall.correct === false) return { code: "FIREWALL_RULE_MISMATCH", section: "firewall", message: "FTP 防火墙规则需要手工核对；站点可启停，但远程连接可能失败。", blocksControl: false };
  return null;
}

export function canRegisterManualCameraFtpSite(system: IisFtpSystemStatus, config: CameraFtpConfig): boolean {
  return config.managedSiteId === 0
    && system.site.id !== null && system.site.id > 0
    && system.site.name === config.siteName
    && system.site.managed === true
    && system.binding.correct === true
    && system.authentication.correct === true
    && system.authorization.correct === true
    && system.site.sslEnabled === false
    && system.account.exists === true
    && system.account.enabled === true
    && system.account.managed === true;
}

export function canSwitchCameraFtpEventFromStatus(system: IisFtpSystemStatus, config: CameraFtpConfig): boolean {
  if (!config.accountManaged || config.managedSiteId <= 0) return false;
  // Unknown ordinary inspection is not a negative result. The switch
  // transaction obtains a fresh elevated snapshot before changing IIS.
  if (system.site.exists === null) return true;
  return system.site.exists === true
    && system.site.id === config.managedSiteId
    && system.site.managed === true
    && system.binding.correct === true
    && system.authentication.correct === true
    && system.authorization.correct === true
    && system.account.managed === true
    && typeof system.site.started === "boolean"
    // A stopped site can be moved away from an orphaned, unwritable old path.
    // The elevated rollback action can restore that exact former path without
    // incorrectly treating it as a new writable target.
    && (system.acl.correct === true || (system.site.started === false && system.acl.correct === false));
}
