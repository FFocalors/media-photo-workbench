import type { ApiErrorDetails, ApiResponse } from "../../../lib/api";

const STAGE_LABELS: Record<string, string> = {
  read_input: "读取提权输入文件",
  validate_input: "校验配置参数",
  check_permissions: "确认管理员权限",
  validate_configuration: "校验 FTP 配置",
  preflight_account: "检查本地 FTP 账户",
  preflight_port: "检查 FTP 控制端口",
  preflight_firewall: "检查 FTP 防火墙规则",
  inspect_windows_environment: "检测 Windows IIS 环境",
  inspect_iis_sites: "读取 IIS FTP 站点",
  inspect_iis_site: "读取 IIS FTP 站点",
  enable_iis_features: "启用 IIS FTP 组件",
  open_iis_configuration: "打开 IIS 配置",
  prepare_receive_directory: "准备接收目录",
  configure_local_account: "创建或更新本地 FTP 账户",
  configure_directory_acl: "设置目录权限",
  configure_iis_site: "配置 IIS FTP 站点",
  configure_ftp_authorization: "配置 FTP 授权规则",
  configure_physical_path: "切换 FTP 接收目录",
  validate_target_event: "校验目标活动",
  check_pending_uploads: "检查上传与导入任务",
  snapshot_current_state: "记录切换前状态",
  prepare_target_directory: "准备目标接收目录",
  update_target_acl: "设置目标目录权限",
  update_iis_physical_path: "切换 IIS 接收目录",
  switch_watcher: "切换文件监听",
  restart_ftp_site: "恢复 FTP 站点运行状态",
  preserve_stopped_site: "保持 FTP 站点停止",
  verify_switched_state: "验证活动切换结果",
  commit_active_event: "提交 FTP 接收活动",
  rollback_physical_path: "回滚 IIS 接收目录",
  rollback_target_acl: "回滚目标目录权限",
  rollback_watcher: "回滚文件监听",
  rollback_site_state: "回滚 FTP 站点状态",
  rollback_active_event: "回滚 FTP 接收活动",
  configure_passive_ports: "配置 IIS 被动端口",
  commit_iis_configuration: "保存 IIS 配置",
  configure_firewall: "配置 Windows 防火墙",
  start_ftp_service: "启动 Microsoft FTP Service",
  start_ftp_site: "启动 IIS FTP 站点",
  verify_ftp_listener: "验证 FTP 控制端口监听",
  restart_ftp_service: "重启 IIS FTP",
  stop_ftp_site: "停止 IIS FTP 站点",
  verify_configuration: "验证最终配置",
  uac_requested: "等待 Windows 管理员授权",
  uac_cancelled: "Windows 管理员授权已取消",
  launch_failed: "启动管理员脚本",
  process_starting: "启动管理员脚本",
  process_started: "执行管理员脚本",
  process_completed: "读取管理员脚本结果",
  result_file_missing: "读取管理员脚本结果",
  parse_result: "解析管理员脚本结果",
  timeout: "等待管理员脚本完成",
  unknown: "未知阶段"
};

const STAGE_ADVICE: Record<string, string> = {
  read_input: "请重试；若仍失败，请打开日志目录检查临时文件权限。",
  validate_configuration: "请确认活动接收目录存在且可访问；OneDrive 目录应保持已同步状态，符号链接或目录联接不能作为 FTP 根目录。",
  inspect_iis_sites: "本机可能已有 IIS FTP 站点使用当前控制端口，请选择其他端口，或先执行管理员只读检测后再明确接管。",
  inspect_iis_site: "请先执行“管理员检测可接管站点”，不要手工猜测站点名。",
  configure_local_account: "请换用未被其他 Windows 账户占用的 FTP 用户名后重试。",
  configure_directory_acl: "工作台会自动重建非规范顺序的目录 ACL，并在写入后验证相机账户的实际读写权限。若仍失败，请展开技术详情核对所有者、继承状态、HRESULT 和拒绝规则；安全策略或安全软件阻止时需由管理员处理。",
  configure_iis_site: "请检查是否已有 IIS FTP 站点使用当前控制端口；无关站点不会被自动修改。",
  configure_passive_ports: "请确认 IIS FTP 服务已安装；该设置会影响本机所有 IIS FTP 站点。",
  preflight_firewall: "请查看待更新规则及目标端口；本地旧规则必须再次确认，组策略规则不会被工作台强制修改。",
  configure_firewall: "防火墙服务正常时也可能因规则来源、参数或安全策略而失败；请查看技术详情中的命令与策略来源后重试。",
  start_ftp_service: "请在 Windows 服务中确认 Microsoft FTP Service 可启动。",
  start_ftp_site: "工作台不会启动或修改无关 IIS 站点。请重试；若仍失败，请复制包含 HRESULT、FTPSVC 状态和站点状态的技术详情。",
  verify_ftp_listener: "站点已执行启动，但控制端口尚未形成 FTPSVC 监听。请重新检测端口；工作台不会停止其他程序或强占端口。",
  verify_configuration: "请根据下方具体失败项重试；工作台会分别显示站点、端口、账户、权限、PASV 和防火墙的实际检测结果。",
  snapshot_current_state: "请重新执行管理员检测，确认工作台保存的 Site ID 与当前托管 IIS FTP 站点一致。",
  update_target_acl: "目标活动目录权限更新失败；工作台不会改变当前 FTP 接收活动，请查看 ACL 与回滚详情。",
  update_iis_physical_path: "IIS 接收目录切换失败；请查看 physicalPath 和 Site ID 的实际值。",
  switch_watcher: "IIS 已处理，但文件监听未能切换；工作台会恢复原活动、原目录和原 watcher。",
  restart_ftp_site: "接收目录已修改，但托管 FTP 站点未恢复到切换前运行状态；请查看回滚结果。",
  verify_switched_state: "请核对 IIS physicalPath、站点状态、binding、监听端口和 watcher 目录的逐项实际值。",
  commit_active_event: "IIS 与 watcher 已通过验证，但工作台未能保存新活动；系统会恢复原活动。",
  launch_failed: "请确认 Windows PowerShell 5.1 可用，并重新接受 UAC。",
  process_starting: "请确认 Windows PowerShell 5.1 可用，并重新接受 UAC。",
  result_file_missing: "请重试并打开日志目录；工作台已记录脚本退出阶段和退出码。",
  parse_result: "请重试并打开日志目录；工作台已保留脱敏的结果解析诊断。",
  timeout: "请等待先前的 Windows 管理操作结束后再重试。"
};

export interface CameraFtpErrorPresentation {
  code: string;
  tone: "info" | "danger" | "warning";
  title: string;
  body: string;
  stage: string;
  advice: string;
  technicalDetails: string;
  operationId?: string;
  childOperationId?: string;
  retryable: boolean;
  rollbackAttempted?: boolean;
  rollbackSucceeded?: boolean | null;
  rollbackSummary?: string;
  conflictPort?: number;
  conflictOwner?: string;
  adoptableSiteName?: string;
  availablePorts: number[];
}

function redactTechnicalText(value: string): string {
  return value
    .replace(/("?[\w.-]*(?:password|passphrase|secret|token|securestring|credential)[\w.-]*"?\s*[=:：]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[已隐藏]")
    .replace(/[A-Za-z]:\\+[^\r\n"',;}]+/g, "[路径已隐藏]")
    .replace(/\\\\+[^\r\n"',;}]+/g, "[路径已隐藏]");
}

function sanitizeTechnicalValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[内容已截断]";
  if (/(?:password|passphrase|secret|token|securestring|credential)/i.test(key)) return "[已隐藏]";
  if (/(?:path|directory|folder|filename)/i.test(key)) return "[路径已隐藏]";
  if (typeof value === "string") return redactTechnicalText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTechnicalValue(item, "", depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
    childKey,
    sanitizeTechnicalValue(item, childKey, depth + 1)
  ]));
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function stageLabel(stage?: string): string {
  if (!stage) return "未知阶段";
  return STAGE_LABELS[stage] || "IIS FTP 系统配置";
}

export function buildCameraFtpErrorPresentation<T>(
  response: ApiResponse<T>,
  fallback = "Windows IIS FTP 操作失败。"
): CameraFtpErrorPresentation {
  const apiError = response.error;
  const code = apiError?.code || "CAMERA_FTP_ERROR";
  const details: ApiErrorDetails = apiError?.details || {};
  const operationId = firstText(
    apiError?.operationId,
    response.operationId,
    details.parentOperationId,
    details.operationId
  );
  const childOperationId = firstText(
    details.childOperationId,
    details.operationId && details.operationId !== operationId ? details.operationId : undefined
  );
  const explicitTitle = firstText(apiError?.title, details.title);
  const explicitImpact = firstText(apiError?.impact, details.impact);
  const explicitNextAction = firstText(apiError?.nextAction, details.nextAction, details.advice);
  const explicitTechnicalDetails = firstText(
    apiError?.technicalDetails,
    details.technicalDetails,
    details.technicalMessage
  );
  const explicitRetryable = typeof apiError?.retryable === "boolean"
    ? apiError.retryable
    : typeof details.retryable === "boolean"
      ? details.retryable
      : true;
  if (code === "UAC_CANCELLED") {
    const uacTechnicalDetails = [
      `错误码：${code}`,
      operationId ? `API 请求 operationId：${operationId}` : "",
      childOperationId && childOperationId !== operationId ? `提权子 operationId：${childOperationId}` : "",
      explicitTechnicalDetails ? `技术摘要：${explicitTechnicalDetails}` : ""
    ].filter(Boolean).join("\n");
    return {
      code,
      tone: "warning",
      title: redactTechnicalText(explicitTitle || "Windows 管理员授权已取消"),
      body: redactTechnicalText(explicitImpact || "本次系统配置未执行，现有 IIS、账户、目录和防火墙设置未被修改。"),
      stage: stageLabel(details.stage || "uac_cancelled"),
      advice: redactTechnicalText(explicitNextAction || "需要继续时可重新点击原操作并接受 UAC。"),
      technicalDetails: redactTechnicalText(uacTechnicalDetails),
      operationId,
      childOperationId: childOperationId && childOperationId !== operationId ? childOperationId : undefined,
      retryable: explicitRetryable,
      rollbackAttempted: false,
      availablePorts: []
    };
  }

  const stage = details.stage || (code === "IIS_SITE_ADOPTION_REQUIRED" ? "inspect_iis_sites" : "unknown");
  const conflict = details.conflict && typeof details.conflict === "object" ? details.conflict : {};
  const conflictPort = Number.isInteger(Number(conflict.port)) ? Number(conflict.port) : undefined;
  const conflictOwner = typeof conflict.processName === "string" && conflict.processName
    ? `${conflict.processName}${Number.isInteger(Number(conflict.pid)) ? `（PID ${Number(conflict.pid)}）` : ""}`
    : typeof conflict.siteName === "string" && conflict.siteName
      ? `IIS 站点 ${conflict.siteName}`
      : typeof conflict.source === "string" && conflict.source === "windowsReservedPort"
        ? "Windows 保留端口"
        : undefined;
  const conflictSiteName = typeof conflict.siteName === "string" && conflict.siteName
    ? conflict.siteName
    : details.siteName;
  const adoptableSiteName = conflictSiteName
    && (conflict.adoptable === true || code === "IIS_SITE_ADOPTION_REQUIRED")
      ? conflictSiteName
      : undefined;
  const availablePorts = Array.isArray(conflict.availablePorts)
    ? conflict.availablePorts.map(Number).filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535)
    : [];
  const firewallChanges = Array.isArray(conflict.changes)
    ? conflict.changes.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const firewallChangeLines = firewallChanges.map((item) => {
    const current = item.current && typeof item.current === "object" ? item.current as Record<string, unknown> : {};
    const target = item.target && typeof item.target === "object" ? item.target as Record<string, unknown> : {};
    const kind = item.kind === "passive" ? "被动端口规则" : "控制端口规则";
    return `${kind}：${String(current.localPort || "未知")} / ${String(current.remoteAddress || "未知")} -> ${String(target.localPort || "未知")} / ${String(target.remoteAddress || "未知")}`;
  });
  const warningLines = Array.isArray(details.warnings)
    ? details.warnings.filter((item): item is string => typeof item === "string" && item.length > 0).map((item) => `回滚提示：${item}`)
    : [];
  const verificationDiagnostics = details.diagnostics && typeof details.diagnostics === "object"
    ? details.diagnostics
    : {};
  const failedVerificationCodes = Array.isArray(verificationDiagnostics.failedCodes)
    ? verificationDiagnostics.failedCodes.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const verificationFailureLabels: Record<string, string> = {
    IIS_FTP_FEATURE_MISSING: "IIS FTP Windows 功能未启用",
    FTP_SERVICE_NOT_FOUND: "Microsoft FTP Service 不存在",
    FTP_SERVICE_NOT_RUNNING: "Microsoft FTP Service 未运行",
    SITE_NOT_STARTED: "目标 IIS FTP 站点未启动",
    CONTROL_PORT_NOT_LISTENING: "控制端口未形成监听",
    CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH: "控制端口监听不属于目标 FTPSVC 站点",
    SITE_BINDING_MISMATCH: "IIS FTP binding 与控制端口不一致",
    PHYSICAL_PATH_MISMATCH: "IIS physicalPath 与当前活动接收目录不一致",
    MANAGED_SITE_ID_MISMATCH: "托管 Site ID 与实际 IIS 站点不一致",
    FTP_ACCOUNT_STATE_MISMATCH: "FTP 本地账户不存在、未启用或不归工作台管理",
    FTP_ACCOUNT_PASSWORD_UPDATE_FAILED: "FTP 本地账户密码更新未完成",
    FTP_ACCOUNT_PERMISSION_FAILED: "FTP 账户未获得接收目录写入权限",
    FTP_DIRECTORY_ACL_NONCANONICAL: "接收目录 ACL 顺序仍不规范",
    FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH: "确认的目录权限收紧未生效",
    IIS_AUTH_CONFIGURATION_MISMATCH: "IIS Basic、Anonymous 或 SSL 配置不一致",
    FTP_AUTHORIZATION_MISMATCH: "IIS FTP Read + Write 授权不一致",
    FIREWALL_RULE_MISMATCH: "Windows 防火墙规则与当前端口不一致",
    PASSIVE_PORT_MISMATCH: "IIS 被动端口范围不一致",
    FTP_CONTROL_PORT_IN_USE: "控制端口被无关资源占用",
    IIS_SITE_PORT_CONFLICT: "其他 IIS FTP 站点占用当前端口"
  };
  const verificationFailureBody = failedVerificationCodes.length > 0
    ? `最终验证未通过：${failedVerificationCodes.map((item) => `${verificationFailureLabels[item] || "未知检查项"}（${item}）`).join("；")}。`
    : "";
  const structuredReport = details.diagnostics || details.completedSteps || details.failedStep || details.rollback || details.preflight || details.provisioningPlan
    ? JSON.stringify(sanitizeTechnicalValue({
        diagnostics: details.diagnostics,
        completedSteps: details.completedSteps,
        failedStep: details.failedStep,
        rollback: details.rollback,
        preflight: details.preflight,
        provisioningPlan: details.provisioningPlan
      }), null, 2)
    : "";
  const rollbackStatus = firstText(
    apiError?.rollbackStatus,
    details.rollbackStatus,
    details.rollback?.status
  ) || "";
  const rollbackAttempted = rollbackStatus === "not_required"
    ? false
    : rollbackStatus
      ? true
      : typeof details.rollbackAttempted === "boolean"
        ? details.rollbackAttempted
        : undefined;
  const rollbackSucceeded = rollbackStatus === "success"
    ? true
    : rollbackStatus === "partial" || rollbackStatus === "failed"
      ? false
      : typeof details.rollbackSucceeded === "boolean" || details.rollbackSucceeded === null
        ? details.rollbackSucceeded
        : undefined;
  const rollbackSummary = rollbackAttempted === false || rollbackStatus === "not_required"
    ? "未修改系统，无需回滚"
    : rollbackStatus === "success" && rollbackSucceeded !== false
      ? "已按快照恢复并完成验证"
      : rollbackStatus === "partial" || rollbackStatus === "failed" || rollbackSucceeded === false
        ? "未完全恢复，请查看技术详情后再重试"
        : rollbackAttempted
          ? "已尝试回滚，验证结果未知"
          : undefined;
  const technicalLines = [
    `错误码：${code}`,
    `失败阶段：${stageLabel(stage)} (${stage})`,
    operationId ? `API 请求 operationId：${operationId}` : "",
    childOperationId && childOperationId !== operationId ? `提权子 operationId：${childOperationId}` : "",
    details.scriptName ? `脚本：${details.scriptName}` : "",
    details.exceptionType ? `异常类型：${details.exceptionType}` : "",
    details.command ? `命令：${details.command}` : "",
    details.exitCode !== undefined ? `退出码：${details.exitCode}` : "",
    explicitTechnicalDetails ? `技术摘要：${explicitTechnicalDetails}` : "",
    typeof conflict.hresult === "string" && conflict.hresult ? `HRESULT：${conflict.hresult}` : "",
    typeof conflict.sourceExceptionType === "string" && conflict.sourceExceptionType ? `底层异常：${conflict.sourceExceptionType}` : "",
    typeof conflict.ftpServiceState === "string" && conflict.ftpServiceState ? `FTPSVC 状态：${conflict.ftpServiceState}` : "",
    typeof conflict.stateBefore === "string" && conflict.stateBefore ? `站点原状态：${conflict.stateBefore}` : "",
    typeof conflict.stateAfter === "string" && conflict.stateAfter ? `站点失败后状态：${conflict.stateAfter}` : "",
    typeof conflict.siteState === "string" && conflict.siteState ? `站点状态：${conflict.siteState}` : "",
    typeof conflict.innerTechnicalMessage === "string" && conflict.innerTechnicalMessage ? `内部摘要：${conflict.innerTechnicalMessage}` : "",
    rollbackAttempted !== undefined ? `已尝试回滚：${rollbackAttempted ? "是" : "否"}` : "",
    rollbackSucceeded !== undefined ? `回滚结果：${rollbackSucceeded === null ? "未知" : rollbackSucceeded ? "成功" : "未完全成功"}` : "",
    conflictPort !== undefined ? `冲突端口：${conflictPort}` : "",
    conflictOwner ? `占用来源：${conflictOwner}` : "",
    availablePorts.length > 0 ? `可用端口：${availablePorts.join("、")}` : "",
    ...warningLines,
    ...firewallChangeLines,
    structuredReport ? `结构化事务报告：\n${structuredReport}` : ""
  ].filter(Boolean).join("\n");

  const bodyByCode: Record<string, string> = {
    IIS_SITE_ADOPTION_REQUIRED: "检测到已有 IIS FTP 站点需要明确确认后才能接管，工作台没有修改该站点。",
    IIS_SITE_PORT_CONFLICT: `其他 IIS FTP 站点正在使用控制端口${conflictPort ? ` ${conflictPort}` : ""}，工作台没有修改该站点。`,
    FTP_CONTROL_PORT_IN_USE: `FTP 控制端口${conflictPort ? ` ${conflictPort}` : ""}已被占用。`,
    PORT_USED_BY_OTHER_PROCESS: `其他程序正在使用 FTP 控制端口${conflictPort ? ` ${conflictPort}` : ""}${conflictOwner ? `：${conflictOwner}` : ""}。`,
    FTP_CONTROL_PORT_RESERVED: `控制端口${conflictPort ? ` ${conflictPort}` : ""}属于 Windows 保留端口范围。`,
    FTP_CONTROL_PORT_INVALID: "FTP 控制端口无效，请输入 1–65535 之间的整数。",
    FTP_PORT_RANGE_CONFLICT: "FTP 控制端口与被动端口范围冲突，或被动端口范围无效。",
    NO_AVAILABLE_FTP_PORT: "未检测到可安全推荐的 FTP 控制端口。",
    FTP_PATH_INVALID: "当前活动的 FTP 接收目录未通过路径校验。",
    FTP_PATH_CREATE_FAILED: "无法创建当前活动的 FTP 接收目录。",
    FTP_ACCOUNT_CONFLICT: "创建 FTP 本地账户失败：该用户名已属于非工作台管理的 Windows 账户。",
    FTP_ACL_FAILED: "设置 FTP 接收目录权限失败。",
    FTP_ACL_EFFECTIVE_ACCESS_DENIED: "目录 ACL 已写入，但 FTP 相机账户仍未获得所需的实际读写权限。",
    FTP_ACL_TIGHTEN_FAILED: "目录权限收紧失败，工作台没有继续配置 IIS 站点。",
    FTP_ACL_SNAPSHOT_FAILED: "无法在修改前读取并保存目录 ACL 快照，工作台已中止配置。",
    FTP_ACL_ROLLBACK_FAILED: "目录 ACL 回滚失败，当前权限可能未完全恢复。",
    FTP_ACL_ROLLBACK_VERIFY_FAILED: "目录 ACL 已执行回滚，但与修改前的安全描述符不一致。",
    FIREWALL_ROLLBACK_VERIFY_FAILED: "防火墙规则已执行回滚，但与修改前的规则快照不一致。",
    FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED: "检测到需要修改的旧版本地 FTP 防火墙规则，工作台尚未执行修改。",
    FIREWALL_RULE_POLICY_BLOCKED: "检测到由 Windows 策略管理或无法唯一识别的 FTP 防火墙规则，工作台不会强制修改。",
    FIREWALL_CONFIG_FAILED: "配置 Windows 防火墙 FTP 规则失败。",
    IIS_SERVICE_START_FAILED: "Microsoft FTP Service 或 IIS FTP 站点启动失败。",
    IIS_FTP_SERVICE_START_FAILED: "Microsoft FTP Service 未能进入运行状态。",
    IIS_FTP_SITE_START_UNAVAILABLE: "当前 IIS 未提供 FTP 站点启动方法，可能缺少 FTP Service 组件。",
    IIS_FTP_SITE_START_FAILED: "Microsoft FTP Service 已检查，但工作台托管的 IIS FTP 站点启动失败。",
    IIS_FTP_SITE_STOP_FAILED: "工作台托管的 IIS FTP 站点停止失败。",
    IIS_FTP_LISTENER_START_FAILED: "IIS FTP 站点已执行启动，但实际控制端口没有形成 FTPSVC 监听。",
    FTP_CONFIGURATION_VERIFICATION_FAILED: verificationFailureBody || "多个 IIS FTP 关键配置项未通过最终验证。",
    ACTIVE_EVENT_ID_MISMATCH: "工作台保存的 FTP 接收活动与本次配置目标不一致。",
    CAMERA_FTP_CONFIG_SAVE_MISMATCH: "IIS 已配置，但工作台未能正确保存控制端口或被动端口配置。",
    CAMERA_FTP_WATCHER_NOT_RUNNING: "IIS 已配置，但相机 FTP 文件监听未能启动。",
    CAMERA_FTP_WATCHER_TARGET_MISMATCH: "相机 FTP 文件监听的活动或目录与 IIS 接收目录不一致。",
    CAMERA_FTP_NODE_STATE_MISMATCH: verificationFailureBody || "IIS 配置完成后，工作台本地配置或文件监听状态未通过最终验证。",
    FTP_EVENT_SWITCH_FAILED: "FTP 接收活动切换事务失败。",
    FTP_SITE_STOP_FAILED: "工作台托管的 IIS FTP 站点未能在切换目录前停止。",
    FTP_TARGET_ACL_UPDATE_FAILED: "无法为目标活动的相机 FTP 目录设置账户权限。",
    FTP_PHYSICAL_PATH_UPDATE_FAILED: "无法把 IIS FTP physicalPath 切换到目标活动目录。",
    FTP_WATCHER_SWITCH_FAILED: "相机 FTP 文件监听未能切换到目标活动目录。",
    FTP_SITE_RESTART_FAILED: "IIS FTP 目录已处理，但站点未恢复到切换前的运行状态。",
    FTP_SWITCH_VERIFY_FAILED: verificationFailureBody || "IIS、watcher 或目标活动状态未通过切换后的逐项验证。",
    FTP_SWITCH_ROLLBACK_FAILED: "活动切换失败，且原 IIS 路径、watcher、站点状态或 activeEventId 至少有一项未完全恢复。",
    FTP_ACTIVE_EVENT_STATE_MISMATCH: "IIS 和 watcher 已切换，但工作台未能提交新的 activeEventId。",
    IIS_FTP_FEATURE_MISSING: verificationFailureLabels.IIS_FTP_FEATURE_MISSING,
    FTP_SERVICE_NOT_FOUND: verificationFailureLabels.FTP_SERVICE_NOT_FOUND,
    FTP_SERVICE_NOT_RUNNING: verificationFailureLabels.FTP_SERVICE_NOT_RUNNING,
    SITE_NOT_STARTED: verificationFailureLabels.SITE_NOT_STARTED,
    CONTROL_PORT_NOT_LISTENING: verificationFailureLabels.CONTROL_PORT_NOT_LISTENING,
    CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH: verificationFailureLabels.CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH,
    SITE_BINDING_MISMATCH: verificationFailureLabels.SITE_BINDING_MISMATCH,
    PHYSICAL_PATH_MISMATCH: verificationFailureLabels.PHYSICAL_PATH_MISMATCH,
    MANAGED_SITE_ID_MISMATCH: verificationFailureLabels.MANAGED_SITE_ID_MISMATCH,
    FTP_ACCOUNT_STATE_MISMATCH: verificationFailureLabels.FTP_ACCOUNT_STATE_MISMATCH,
    FTP_ACCOUNT_PASSWORD_UPDATE_FAILED: verificationFailureLabels.FTP_ACCOUNT_PASSWORD_UPDATE_FAILED,
    FTP_ACCOUNT_PERMISSION_FAILED: verificationFailureLabels.FTP_ACCOUNT_PERMISSION_FAILED,
    FTP_DIRECTORY_ACL_NONCANONICAL: verificationFailureLabels.FTP_DIRECTORY_ACL_NONCANONICAL,
    FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH: verificationFailureLabels.FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH,
    IIS_AUTH_CONFIGURATION_MISMATCH: verificationFailureLabels.IIS_AUTH_CONFIGURATION_MISMATCH,
    FTP_AUTHORIZATION_MISMATCH: verificationFailureLabels.FTP_AUTHORIZATION_MISMATCH,
    FIREWALL_RULE_MISMATCH: verificationFailureLabels.FIREWALL_RULE_MISMATCH,
    PASSIVE_PORT_MISMATCH: verificationFailureLabels.PASSIVE_PORT_MISMATCH,
    WINDOWS_RESTART_REQUIRED: "Windows 已启用所需的 IIS FTP 组件，但系统要求重启后才能继续配置。当前操作已安全停止。",
    ELEVATED_SCRIPT_NO_RESULT: "Windows 管理员脚本已退出，但没有生成完整的结构化结果。",
    ELEVATED_RESULT_INVALID_JSON: "Windows 管理员脚本返回的诊断结果不完整。",
    ELEVATED_SCRIPT_LAUNCH_FAILED: "Windows 管理员脚本未能启动。",
    ELEVATED_SCRIPT_TIMEOUT: "等待 Windows 管理员脚本完成时超时。"
  };
  const bodyByStage: Record<string, string> = {
    read_input: "Windows 管理员脚本未能读取安全输入文件。",
    inspect_iis_sites: "Windows 管理员脚本未能读取 IIS FTP 站点配置。",
    inspect_iis_site: "Windows 管理员脚本未能读取 IIS FTP 站点配置。",
    configure_local_account: "创建或更新 FTP 本地账户失败。",
    configure_directory_acl: "设置 FTP 接收目录权限失败。",
    configure_iis_site: "配置 IIS FTP 站点失败。",
    configure_ftp_authorization: "配置 IIS FTP 授权规则失败。",
    configure_passive_ports: "配置 IIS 服务器级被动端口失败。",
    preflight_firewall: "FTP 防火墙规则预检未通过。",
    configure_firewall: "配置 Windows 防火墙失败。",
    start_ftp_service: "Microsoft FTP Service 启动失败。",
    start_ftp_site: "IIS FTP 站点启动失败。",
    verify_ftp_listener: "FTP 控制端口监听验证失败。",
    verify_configuration: "IIS FTP 最终配置验证未通过。",
    snapshot_current_state: "无法记录切换前的 IIS、活动和 watcher 状态。",
    update_target_acl: "目标活动目录权限更新失败。",
    update_iis_physical_path: "IIS FTP 接收目录更新失败。",
    switch_watcher: "相机 FTP 文件监听切换失败。",
    restart_ftp_site: "IIS FTP 站点未恢复到切换前状态。",
    verify_switched_state: "FTP 活动切换后的最终状态验证失败。",
    commit_active_event: "新 FTP 接收活动提交失败。",
    rollback_physical_path: "原 IIS FTP 接收目录回滚失败。",
    rollback_target_acl: "目标活动目录权限回滚失败。",
    rollback_watcher: "原相机 FTP watcher 回滚失败。",
    rollback_site_state: "原 IIS FTP 站点状态回滚失败。",
    rollback_active_event: "原 activeEventId 回滚失败。"
  };
  const responseMessage = apiError?.message || "";
  const resolvedTitle = explicitTitle || (code === "FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED"
    ? "需要确认防火墙规则变更"
    : details.operation === "active-event" || code.startsWith("FTP_SWITCH_") || code === "FTP_EVENT_SWITCH_FAILED"
      ? "FTP 接收活动切换失败"
      : "FTP 配置失败");
  const resolvedBody = explicitImpact || verificationFailureBody || bodyByCode[code]
    || bodyByStage[stage]
    || (/^[\x00-\x7F]+$/.test(responseMessage) ? fallback : responseMessage || fallback);
  const resolvedAdvice = explicitNextAction || (typeof conflict.recommendation === "string" && conflict.recommendation
    ? (/^[\x00-\x7F]+$/.test(conflict.recommendation)
        ? "请选择工作台推荐的其他控制端口后重新检测；不会自动停止程序或修改无关 IIS 站点。"
        : conflict.recommendation)
    : STAGE_ADVICE[stage] || "请按下方失败阶段检查后重试；需要更多信息时可复制技术详情并打开日志目录。");
  const neutral = code === "ADMIN_REQUIRED"
    || code === "IIS_STATUS_ADMIN_REQUIRED"
    || code === "UNKNOWN"
    || /_UNKNOWN$/.test(code);
  return {
    code,
    tone: neutral
      ? "info"
      : code === "FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED"
        ? "warning"
        : "danger",
    title: redactTechnicalText(resolvedTitle),
    body: redactTechnicalText(resolvedBody),
    stage: stageLabel(stage),
    advice: redactTechnicalText(resolvedAdvice),
    technicalDetails: redactTechnicalText(technicalLines),
    operationId,
    childOperationId: childOperationId && childOperationId !== operationId ? childOperationId : undefined,
    retryable: explicitRetryable,
    rollbackAttempted,
    rollbackSucceeded,
    rollbackSummary,
    conflictPort,
    conflictOwner,
    adoptableSiteName,
    availablePorts
  };
}
