import crypto from "crypto";
import type { IisFtpConflict, IisFtpSystemStatus } from "./iisFtpManager";

export type CameraFtpProvisioningGoal = "setup" | "repair" | "start" | "restart" | "adopt-site";
export type CameraFtpProvisioningItemStatus =
  | "already_ok"
  | "create"
  | "update"
  | "repair"
  | "user_confirmation_required"
  | "blocked";
export type CameraFtpProvisioningIssueLevel = "info" | "auto_repair" | "user_confirmation" | "blocked";
export type CameraFtpProvisioningCategory =
  | "feature"
  | "account"
  | "directory"
  | "site"
  | "binding"
  | "authentication"
  | "authorization"
  | "acl"
  | "passive_ports"
  | "firewall"
  | "service"
  | "config"
  | "watcher";

export interface CameraFtpProvisioningPlanItem {
  id: string;
  category: CameraFtpProvisioningCategory;
  label: string;
  summary: string;
  status: CameraFtpProvisioningItemStatus;
  managedResource: boolean;
  risk: "normal" | "high";
  confirmationKey?: string;
}
export interface CameraFtpProvisioningIssue {
  id: string;
  code: string;
  level: CameraFtpProvisioningIssueLevel;
  title: string;
  message: string;
  planItemId?: string;
}

export interface CameraFtpProvisioningConfirmation {
  key: string;
  title: string;
  message: string;
  risk: "normal" | "high";
}

export interface CameraFtpProvisioningPreflight {
  inspectionLevel: "partial" | "full";
  generatedAt: string;
  goal: CameraFtpProvisioningGoal;
  desired: {
    eventId: string;
    username: string;
    physicalPath: string;
    binding: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    targetSiteName: string;
    targetSiteId: number | null;
  };
  activity: {
    exists: boolean;
    valid: boolean;
    status: string;
  };
  watcher: {
    running: boolean;
    unstableCount: number;
    pendingCount: number;
    importingCount: number;
  };
  directory: {
    exists: boolean;
    legacyDirectoryExists: boolean;
  };
  system: IisFtpSystemStatus;
}

export interface CameraFtpProvisioningPlan {
  planId: string;
  operationId?: string;
  target: CameraFtpProvisioningGoal;
  targetState: "running";
  summary: string;
  items: CameraFtpProvisioningPlanItem[];
  issues: CameraFtpProvisioningIssue[];
  confirmations: CameraFtpProvisioningConfirmation[];
  requiresAdmin: boolean;
  canApply: boolean;
  generatedAt: string;
  preflight: CameraFtpProvisioningPreflight;
}

export interface CameraFtpProvisioningContext {
  goal: CameraFtpProvisioningGoal;
  eventId: string;
  eventExists: boolean;
  eventValid: boolean;
  eventStatus: string;
  username: string;
  physicalPath: string;
  directoryExists: boolean;
  legacyDirectoryExists: boolean;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  targetSiteName?: string;
  targetSiteId?: number | null;
  configMatches: boolean;
  watcher: {
    running: boolean;
    unstableCount: number;
    pendingCount: number;
    importingCount: number;
  };
  system: IisFtpSystemStatus;
  now?: string;
  planId?: string;
}

function item(
  id: string,
  category: CameraFtpProvisioningCategory,
  label: string,
  status: CameraFtpProvisioningItemStatus,
  summary: string,
  options: { managedResource?: boolean; risk?: "normal" | "high"; confirmationKey?: string } = {}
): CameraFtpProvisioningPlanItem {
  return {
    id,
    category,
    label,
    status,
    summary,
    managedResource: options.managedResource !== false,
    risk: options.risk || "normal",
    ...(options.confirmationKey ? { confirmationKey: options.confirmationKey } : {})
  };
}

function conflictFor(system: IisFtpSystemStatus, codes: string[]): IisFtpConflict | undefined {
  return system.conflicts.items.find((conflict) => codes.includes(conflict.code));
}

function featureState(system: IisFtpSystemStatus): CameraFtpProvisioningPlanItem {
  if (system.initializationState === "blocked" || Object.values(system.windowsFeatures).some((feature) => feature.state === "Unavailable")) {
    return item("windows-features", "feature", "Windows IIS FTP 组件", "blocked", "当前 Windows 版本缺少所需 IIS FTP 组件，工作台不会安装其他 FTP 服务。", { managedResource: false });
  }
  if (system.initializationState === "restart_pending") {
    return item("windows-features", "feature", "Windows IIS FTP 组件", "blocked", "IIS FTP 组件正在等待 Windows 重启；重启前不会继续修改账户、ACL、站点或防火墙。", { managedResource: false });
  }
  const values = [
    system.windowsFeatures.ftpService.installed,
    system.windowsFeatures.ftpExtensibility.installed,
    system.windowsFeatures.managementTools.installed
  ];
  if (values.every((value) => value === true)) {
    return item("windows-features", "feature", "Windows IIS FTP 组件", "already_ok", "所需 Windows 功能已启用。");
  }
  return item(
    "windows-features",
    "feature",
    "Windows IIS FTP 组件",
    values.some((value) => value === false) ? "create" : "repair",
    values.some((value) => value === false)
      ? "将启用 IIS FTP Service、FTP Extensibility 和管理脚本组件；如 Windows 要求重启会单独提示。"
      : "管理员阶段将重新确认并补齐 IIS FTP 组件。"
  );
}

function externalConflictItems(system: IisFtpSystemStatus): {
  planItem?: CameraFtpProvisioningPlanItem;
  issue?: CameraFtpProvisioningIssue;
  confirmation?: CameraFtpProvisioningConfirmation;
} {
  const account = conflictFor(system, ["FTP_ACCOUNT_CONFLICT"]);
  if (account) {
    return {
      planItem: item("external-conflict", "account", "外部账户冲突", "blocked", "该用户名已属于非工作台账户；请更换用户名，工作台不会自动修改。", { managedResource: false, risk: "high" }),
      issue: { id: "issue-account-conflict", code: account.code, level: "blocked", title: "FTP 用户名冲突", message: "该 Windows 本地账户不由工作台管理，请更换用户名或在明确的账户接管流程中处理。", planItemId: "external-conflict" }
    };
  }

  const reserved = conflictFor(system, ["FTP_CONTROL_PORT_RESERVED"]);
  if (reserved) {
    return {
      planItem: item("external-conflict", "binding", "Windows 保留端口", "blocked", `控制端口 ${reserved.port || system.port.configuredPort} 为系统保留端口，不能强制占用。`, { managedResource: false, risk: "high" }),
      issue: { id: "issue-reserved-port", code: reserved.code, level: "blocked", title: "控制端口不可用", message: reserved.recommendation || "请选择推荐的空闲端口。", planItemId: "external-conflict" }
    };
  }

  const process = conflictFor(system, ["PORT_USED_BY_OTHER_PROCESS"]);
  if (process) {
    const source = process.processName ? `${process.processName}${process.pid ? ` (PID ${process.pid})` : ""}` : "其他程序";
    return {
      planItem: item("external-conflict", "binding", "外部程序端口冲突", "blocked", `控制端口由 ${source} 占用；工作台不会停止该程序。`, { managedResource: false, risk: "high" }),
      issue: { id: "issue-process-port", code: process.code, level: "user_confirmation", title: "请选择其他控制端口", message: process.recommendation || `端口由 ${source} 占用，请使用推荐端口后重新生成计划。`, planItemId: "external-conflict" }
    };
  }

  const site = conflictFor(system, ["IIS_SITE_ADOPTION_REQUIRED", "IIS_SITE_PORT_CONFLICT"]);
  if (site) {
    if (site.adoptable === true) {
      const key = `adopt-site:${site.siteName || "unknown"}`;
      return {
        planItem: item("external-conflict", "site", "接管现有 IIS FTP 站点", "user_confirmation_required", `站点“${site.siteName || "未知"}”可在明确确认后接管；也可以更换端口。`, { managedResource: false, risk: "high", confirmationKey: key }),
        issue: { id: "issue-adopt-site", code: site.code, level: "user_confirmation", title: "需要确认接管站点", message: "工作台不会静默修改该 IIS 站点。请选择接管或改用其他端口。", planItemId: "external-conflict" },
        confirmation: { key, title: "确认接管现有 IIS FTP 站点", message: `将只修改站点“${site.siteName || "未知"}”及本次明确关联的工作台资源。`, risk: "high" }
      };
    }
    return {
      planItem: item("external-conflict", "site", "无关 IIS 站点端口冲突", "blocked", `站点“${site.siteName || "未知"}”占用目标端口；不会修改其 binding。`, { managedResource: false, risk: "high" }),
      issue: { id: "issue-iis-port", code: site.code, level: "user_confirmation", title: "请选择其他控制端口", message: site.recommendation || "当前端口属于无关 IIS 站点，请使用推荐端口后重新生成计划。", planItemId: "external-conflict" }
    };
  }
  return {};
}

function summaryFor(items: CameraFtpProvisioningPlanItem[]): string {
  const actions = items.filter((entry) => !["already_ok", "blocked", "user_confirmation_required"].includes(entry.status));
  const labels = actions.map((entry) => entry.label);
  if (items.some((entry) => entry.status === "blocked")) {
    return "检测到无法安全自动处理的外部冲突。工作台不会修改对方资源，请按提示处理后重新生成计划。";
  }
  if (items.some((entry) => entry.status === "user_confirmation_required")) {
    return labels.length > 0
      ? `确认风险项后，工作台将自动处理：${labels.join("、")}。`
      : "请先确认计划中的外部资源或服务器级变更。";
  }
  if (labels.length === 0) return "当前配置已完整；工作台将重新验证并确保 FTP 处于运行状态。";
  return `工作台将自动处理：${labels.join("、")}，随后启动并完成全量验证。`;
}

export function buildCameraFtpProvisioningPlan(context: CameraFtpProvisioningContext): CameraFtpProvisioningPlan {
  const generatedAt = context.now || new Date().toISOString();
  const system = context.system;
  const items: CameraFtpProvisioningPlanItem[] = [];
  const issues: CameraFtpProvisioningIssue[] = [];
  const confirmations: CameraFtpProvisioningConfirmation[] = [];

  if (!system.platform.supported) {
    items.push(item("platform", "feature", "Windows 平台", "blocked", "相机 FTP 自动配置仅支持 Windows 11。", { managedResource: false }));
    issues.push({ id: "issue-platform", code: "UNSUPPORTED_PLATFORM", level: "blocked", title: "当前平台不受支持", message: "请在 Windows 11 主机上执行 IIS FTP 配置。", planItemId: "platform" });
  } else {
    items.push(featureState(system));
  }
  if (system.initializationState === "restart_pending") {
    issues.push({ id: "issue-restart-pending", code: "WINDOWS_RESTART_REQUIRED", level: "blocked", title: "需要重启 Windows", message: "重启后重新打开工作台，系统会恢复不含密码的配置目标。", planItemId: "windows-features" });
  }
  if (system.initializationState === "blocked") {
    issues.push({ id: "issue-iis-system-blocked", code: system.lastError?.code || "IIS_SYSTEM_CONFIGURATION_DAMAGED", level: "blocked", title: "IIS 系统状态无法安全自动修复", message: system.lastError?.message || "请先修复 Windows IIS 组件，再重新检测。", planItemId: "windows-features" });
  }

  if (!context.eventExists || !context.eventValid) {
    items.push(item("activity", "config", "FTP 接收活动", "blocked", context.eventExists ? `活动状态“${context.eventStatus}”不允许接收。` : "接收活动不存在。", { managedResource: false }));
    issues.push({ id: "issue-activity", code: "FTP_EVENT_NOT_ALLOWED", level: "blocked", title: "接收活动不可用", message: "请选择草稿、进行中或选片中的活动。", planItemId: "activity" });
  } else {
    items.push(item("activity", "config", "FTP 接收活动", context.configMatches ? "already_ok" : "update", context.configMatches ? "当前活动与端口配置一致。" : "验证成功后才会提交 activeEventId、端口和托管站点标识。"));
  }

  items.push(item(
    "directory",
    "directory",
    "最终原图接收目录",
    context.directoryExists ? "already_ok" : "create",
    context.directoryExists ? "活动的 原图\\相机FTP 目录已存在。" : "将创建活动的 原图\\相机FTP 最终目录；上传后不再复制第二份原图。"
  ));
  if (context.legacyDirectoryExists) {
    issues.push({ id: "issue-legacy-directory", code: "LEGACY_FTP_DIRECTORY_PRESENT", level: "info", title: "检测到旧版 ftp 目录", message: "旧目录不会被删除或自动迁移；新上传只进入 原图\\相机FTP。", planItemId: "directory" });
  }

  const conflict = externalConflictItems(system);
  if (conflict.planItem) items.push(conflict.planItem);
  if (conflict.issue) issues.push(conflict.issue);
  if (conflict.confirmation) confirmations.push(conflict.confirmation);

  if (!conflict.planItem || conflict.planItem.category !== "account") {
    const accountStatus = system.account.exists === false
      ? "create"
      : system.account.exists === true && system.account.managed === true && system.account.enabled === true
        ? "already_ok"
        : "repair";
    items.push(item("account", "account", "全局 FTP 本地账户", accountStatus, accountStatus === "already_ok" ? "工作台管理账户已启用。" : accountStatus === "create" ? "将创建并标记工作台管理账户。" : "将校正并启用工作台管理账户。"));
  }

  if (!conflict.planItem || conflict.planItem.category !== "site") {
    const siteStatus = system.site.exists === false
      ? "create"
      : system.site.exists === true && system.site.managed === true
        ? "already_ok"
        : system.site.exists === null
          ? "repair"
          : "blocked";
    items.push(item("site", "site", "工作台 IIS FTP 站点", siteStatus, siteStatus === "create" ? "将在目标端口创建 wildcard FTP 站点。" : siteStatus === "already_ok" ? "已按 managedSiteId 找到工作台托管站点。" : siteStatus === "repair" ? "管理员阶段将按 managedSiteId 优先定位并校正站点。" : "现有站点所有权无法确认，不会自动覆盖。", { managedResource: siteStatus !== "blocked" }));
  }

  items.push(item("binding", "binding", "FTP wildcard binding", system.binding.correct === true ? "already_ok" : "repair", system.binding.correct === true ? `binding 已是 *:${context.controlPort}:。` : `将只校正托管站点上的 *:${context.controlPort}: binding。`));
  items.push(item("authentication", "authentication", "Basic / Anonymous / SSL", system.authentication.correct === true && system.site.sslEnabled === false ? "already_ok" : "repair", "将确保 Basic 开启、Anonymous 关闭，并使用普通 FTP 无强制 SSL。"));
  items.push(item("authorization", "authorization", "FTP Read + Write 授权", system.authorization.correct === true ? "already_ok" : "repair", `将只在目标站点授权用户“${context.username}”读写。`));

  if (system.acl.broadInheritedAccess === true) {
    const key = "tighten-broad-acl";
    items.push(item("acl", "acl", "接收目录 ACL", "user_confirmation_required", "目录具备账户读写权限，但继承了宽泛用户组写权限；收紧前需单独确认。", { risk: "high", confirmationKey: key }));
    confirmations.push({ key, title: "确认收紧宽泛目录权限", message: "仅移除目标接收目录上 Everyone、Users、Authenticated Users 的宽泛写权限，并保留 SYSTEM、Administrators、当前用户和 FTP 账户权限。", risk: "high" });
    issues.push({ id: "issue-broad-acl", code: "FTP_ACL_BROAD_WRITE", level: "user_confirmation", title: "目录权限可进一步收紧", message: "不确认时工作台不会删除现有合法 ACL；FTP 账户所需权限仍会自动补齐。", planItemId: "acl" });
  } else {
    items.push(item("acl", "acl", "接收目录 ACL", system.acl.correct === true ? "already_ok" : "repair", system.acl.correct === true ? "FTP 账户具备目标目录读写权限。" : "将补齐 FTP 账户、SYSTEM、Administrators 和当前用户的必要权限。"));
  }

  const passiveNeedsChange = system.passivePorts.correct !== true;
  items.push(item("passive-ports", "passive_ports", "IIS 被动端口范围", passiveNeedsChange ? "update" : "already_ok", passiveNeedsChange ? `将把 IIS 服务器级 PASV 范围设为 ${context.passivePortStart}-${context.passivePortEnd}。` : "IIS 服务器级 PASV 范围已匹配。", { risk: passiveNeedsChange ? "high" : "normal", ...(passiveNeedsChange ? { confirmationKey: "update-global-pasv" } : {}) }));
  if (passiveNeedsChange) {
    confirmations.push({ key: "update-global-pasv", title: "确认更新 IIS 服务器级 PASV", message: "PASV 是本机 IIS 服务器级配置，可能影响本机其他 IIS FTP 站点。", risk: "high" });
    issues.push({ id: "issue-passive", code: "IIS_PASSIVE_PORT_MISMATCH", level: "user_confirmation", title: "将更新服务器级被动端口", message: "本次总配置确认会明确包含该变更。", planItemId: "passive-ports" });
  }

  items.push(item("firewall", "firewall", "工作台 Windows 防火墙规则", system.firewall.correct === true ? "already_ok" : "repair", system.firewall.correct === true ? "控制端口和 PASV LocalSubnet 规则已匹配。" : "将创建或更新工作台固定命名的控制端口和 PASV LocalSubnet 入站规则。"));
  const dependencyNames = system.serviceDependencies.map((dependency) => dependency.name).filter(Boolean);
  const unrelatedAutoStartSites = system.unrelatedAutoStartSites || [];
  const sharedServiceConfirmationRequired = system.service.running !== true && unrelatedAutoStartSites.length > 0;
  const serviceSummary = dependencyNames.length > 0
    ? `将按系统真实依赖顺序处理 ${dependencyNames.join("、")}，再把 FTPSVC 设为自动启动并等待 Running；不会无条件启动 W3SVC。`
    : "将从 Windows 服务依赖关系动态检测所需服务，再确保 FTPSVC 自动启动并进入 Running。";
  if (sharedServiceConfirmationRequired) {
    const key = "start-shared-ftpsvc";
    const siteNames = unrelatedAutoStartSites.map((site) => site.name).join("、");
    items.push(item("service", "service", "Microsoft FTP Service", "user_confirmation_required", `${serviceSummary} 检测到无关的自动启动 FTP 站点：${siteNames}。`, { risk: "high", confirmationKey: key }));
    confirmations.push({ key, title: "确认启动共享 FTP 服务", message: `启动 Windows FTPSVC 可能同时激活这些非工作台站点：${siteNames}。工作台不会修改或停止它们。`, risk: "high" });
    issues.push({ id: "issue-shared-ftpsvc", code: "IIS_SHARED_FTP_SERVICE_CONFIRMATION_REQUIRED", level: "user_confirmation", title: "FTPSVC 为共享 Windows 服务", message: "请确认允许启动共享服务；无关 FTP 站点的配置不会被修改。", planItemId: "service" });
  } else {
    items.push(item("service", "service", "Microsoft FTP Service", system.service.running === true && system.service.startType === "Auto" ? "already_ok" : "repair", serviceSummary));
  }
  items.push(item("site-runtime", "service", context.goal === "restart" ? "重启目标 FTP 站点" : "启动目标 FTP 站点", system.site.started === true && context.goal !== "restart" ? "already_ok" : "repair", context.goal === "restart" ? "将在配置提交后重启目标站点并等待 Started。" : "将在配置提交后启动目标站点并等待 Started。"));

  const busyCount = context.watcher.unstableCount + context.watcher.pendingCount + context.watcher.importingCount;
  if (busyCount > 0 && context.goal === "adopt-site") {
    items.push(item("watcher", "watcher", "相机 FTP watcher", "blocked", "仍有文件上传、稳定检测或导入任务，暂不允许接管或切换路径。"));
    issues.push({ id: "issue-watcher-busy", code: "FTP_UPLOAD_IN_PROGRESS", level: "blocked", title: "仍有文件处理中", message: "请等待当前上传和导入完成后重新生成计划。", planItemId: "watcher" });
  } else {
    items.push(item("watcher", "watcher", "相机 FTP watcher", context.watcher.running ? "already_ok" : "repair", context.watcher.running ? "watcher 已监听最终原图目录。" : "系统验证成功后才启动或恢复 watcher。"));
  }

  if (system.requiresAdmin) {
    issues.push({ id: "issue-partial-inspection", code: "PARTIAL_INSPECTION", level: "info", title: "当前为普通权限部分检测", message: "点击执行后会在同一次 UAC 中完成管理员级 Preflight，再按计划应用配置。" });
  }
  for (const entry of items.filter((entry) => ["create", "update", "repair"].includes(entry.status))) {
    issues.push({ id: `issue-auto-${entry.id}`, code: "AUTO_REPAIR_AVAILABLE", level: "auto_repair", title: `${entry.label}可自动处理`, message: entry.summary, planItemId: entry.id });
  }

  const blocked = items.some((entry) => entry.status === "blocked");
  const adoptionConfirmationMissing = context.goal !== "adopt-site"
    && items.some((entry) => entry.confirmationKey?.startsWith("adopt-site:"));
  const canApply = !blocked && !adoptionConfirmationMissing;
  const preflight: CameraFtpProvisioningPreflight = {
    inspectionLevel: system.requiresAdmin ? "partial" : "full",
    generatedAt,
    goal: context.goal,
    desired: {
      eventId: context.eventId,
      username: context.username,
      physicalPath: context.physicalPath,
      binding: `*:${context.controlPort}:`,
      controlPort: context.controlPort,
      passivePortStart: context.passivePortStart,
      passivePortEnd: context.passivePortEnd,
      targetSiteName: context.targetSiteName || "",
      targetSiteId: context.targetSiteId ?? null
    },
    activity: { exists: context.eventExists, valid: context.eventValid, status: context.eventStatus },
    watcher: { ...context.watcher },
    directory: { exists: context.directoryExists, legacyDirectoryExists: context.legacyDirectoryExists },
    system
  };
  return {
    planId: context.planId || crypto.randomUUID(),
    target: context.goal,
    targetState: "running",
    summary: summaryFor(items),
    items,
    issues,
    confirmations,
    requiresAdmin: true,
    canApply,
    generatedAt,
    preflight
  };
}
