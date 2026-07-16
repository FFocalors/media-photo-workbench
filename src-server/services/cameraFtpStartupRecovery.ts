import path from "path";

export type CameraFtpStartupInspectionLevel = "full" | "partial" | "unknown" | "admin_required";

export interface CameraFtpStartupWarning {
  code: string;
  message: string;
}

export interface CameraFtpStartupWatcherState {
  running: boolean;
  eventId: string;
  directory: string;
}

export interface CameraFtpStartupRecoveryDecisionInput {
  activeEventId: string;
  eventExists: boolean;
  eventStatus: string;
  repositoryConfigured: boolean;
  repositoryAvailable: boolean;
  repositoryPath: string;
  expectedPath: string;
  receiveDirectoryExists: boolean;
  receiveDirectoryAccessible: boolean;
  currentInspectionLevel: CameraFtpStartupInspectionLevel;
  siteExists: boolean | null;
  siteStarted: boolean | null;
  sitePhysicalPath: string;
  watcher: CameraFtpStartupWatcherState;
}

export interface CameraFtpStartupRecoveryDecision {
  action: "restore" | "keep" | "skip";
  status: "eligible" | "already_running" | "skipped";
  reasonCode: string;
  inspectionLevel: CameraFtpStartupInspectionLevel;
  shouldStartWatcher: boolean;
  shouldScan: boolean;
  warnings: CameraFtpStartupWarning[];
}

function warning(code: string, message: string): CameraFtpStartupWarning {
  return { code, message };
}

function skipped(
  input: CameraFtpStartupRecoveryDecisionInput,
  reasonCode: string,
  message: string
): CameraFtpStartupRecoveryDecision {
  return {
    action: "skip",
    status: "skipped",
    reasonCode,
    inspectionLevel: input.currentInspectionLevel,
    shouldStartWatcher: false,
    shouldScan: false,
    warnings: [warning(reasonCode, message)]
  };
}

/** Canonicalizes a Windows path lexically without touching the filesystem. */
export function normalizeCameraFtpWindowsPath(value: string): string {
  if (!value) return "";
  const withoutExtendedPrefix = value.replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "");
  if (!path.win32.isAbsolute(withoutExtendedPrefix)) return "";
  const normalized = path.win32.normalize(withoutExtendedPrefix.normalize("NFC"));
  const root = path.win32.parse(normalized).root;
  const withoutTrailingSeparators = normalized.length > root.length
    ? normalized.replace(/[\\/]+$/, "")
    : normalized;
  return withoutTrailingSeparators.toLocaleLowerCase("en-US");
}

export function sameCameraFtpWindowsPath(left: string, right: string): boolean {
  if (!left || !right) return false;
  return normalizeCameraFtpWindowsPath(left) === normalizeCameraFtpWindowsPath(right);
}

export function decideCameraFtpStartupRecovery(
  input: CameraFtpStartupRecoveryDecisionInput
): CameraFtpStartupRecoveryDecision {
  if (!input.activeEventId) {
    return skipped(input, "NO_ACTIVE_EVENT", "没有保存的 FTP 接收活动，启动时无需恢复文件监听。");
  }
  if (!input.eventExists) {
    return skipped(input, "ACTIVE_EVENT_NOT_FOUND", "保存的 FTP 接收活动不存在，未恢复文件监听。");
  }
  if (!["draft", "active", "reviewing"].includes(input.eventStatus)) {
    return skipped(input, "EVENT_NOT_RECEIVABLE", "保存的 FTP 接收活动当前不可接收文件，未恢复文件监听。");
  }
  if (!input.repositoryConfigured || !input.repositoryAvailable || !input.repositoryPath) {
    return skipped(input, "REPOSITORY_UNAVAILABLE", "图片仓库未配置或当前不可访问，未恢复文件监听。");
  }
  if (!input.expectedPath || !input.receiveDirectoryExists || !input.receiveDirectoryAccessible) {
    return skipped(input, "RECEIVE_PATH_UNAVAILABLE", "相机 FTP 接收目录不存在或不可访问，未创建目录也未恢复文件监听。");
  }
  if (input.siteExists !== true) {
    return skipped(
      input,
      input.siteExists === null ? "IIS_SITE_STATE_UNKNOWN" : "IIS_SITE_NOT_FOUND",
      input.siteExists === null
        ? "普通权限下无法确认当前 IIS FTP 站点，未恢复文件监听。"
        : "当前 IIS FTP 站点不存在，未恢复文件监听。"
    );
  }
  if (!input.sitePhysicalPath) {
    return skipped(input, "IIS_PHYSICAL_PATH_UNKNOWN", "无法确认 IIS FTP physicalPath，未恢复文件监听。");
  }
  if (!sameCameraFtpWindowsPath(input.sitePhysicalPath, input.expectedPath)) {
    return skipped(input, "IIS_PHYSICAL_PATH_MISMATCH", "IIS FTP physicalPath 与当前活动接收目录不一致，请显式修复后重试。");
  }

  const warnings: CameraFtpStartupWarning[] = [];
  if (["partial", "admin_required"].includes(input.currentInspectionLevel)) {
    warnings.push(warning(
      "ADMIN_INSPECTION_RECOMMENDED",
      "当前普通权限检查仍有未知项；已仅依据明确匹配的 physicalPath 恢复 watcher，可按需执行管理员只读检测。"
    ));
  }
  if (input.siteStarted === null) {
    warnings.push(warning(
      "IIS_SITE_STATE_UNKNOWN",
      "当前无法确认 IIS FTP 站点是否运行；这不会改变已校验目录的 watcher 恢复结果。"
    ));
  }

  if (input.watcher.running) {
    if (input.watcher.eventId !== input.activeEventId
      || !sameCameraFtpWindowsPath(input.watcher.directory, input.expectedPath)) {
      return skipped(input, "WATCHER_TARGET_MISMATCH", "已有 watcher 指向其他活动或目录，启动恢复未自动切换它。");
    }
    return {
      action: "keep",
      status: "already_running",
      reasonCode: "WATCHER_ALREADY_RUNNING",
      inspectionLevel: input.currentInspectionLevel,
      shouldStartWatcher: false,
      shouldScan: false,
      warnings
    };
  }

  return {
    action: "restore",
    status: "eligible",
    reasonCode: "WATCHER_RESTORE_ELIGIBLE",
    inspectionLevel: input.currentInspectionLevel,
    shouldStartWatcher: true,
    shouldScan: true,
    warnings
  };
}

interface StartupConfigView {
  repository: { path: string };
  cameraFtp: { activeEventId: string };
}

interface StartupEventView {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface CameraFtpStartupRecoveryDependencies {
  getConfig: () => StartupConfigView;
  getEvent: (eventId: string) => StartupEventView | undefined;
  inspectRepository: (repositoryPath: string) => Promise<{ configured: boolean; available: boolean }>;
  inspectReceiveDirectory: (receivePath: string) => Promise<{ exists: boolean; accessible: boolean; isDirectory?: boolean }>;
  inspectCurrent: (input: { config: StartupConfigView["cameraFtp"]; physicalPath: string }) => Promise<{
    currentInspectionLevel: CameraFtpStartupInspectionLevel;
    site: { exists: boolean | null; started: boolean | null; physicalPath: string };
  }>;
  getWatcherStatus: () => CameraFtpStartupWatcherState;
  startWatcher: (input: {
    eventId: string;
    eventName: string;
    eventSlug: string;
    directory: string;
    cameraName: string;
    photographer: string;
    baseUrl: string;
    createDirectory: false;
    scanExistingOnStart: true;
  }) => Promise<CameraFtpStartupWatcherState>;
  scanWatcher?: () => Promise<CameraFtpStartupWatcherState>;
  log?: (level: "info" | "warn" | "error", data: Record<string, unknown>, message: string) => void;
}

export interface CameraFtpStartupRecoveryResult {
  status: "restored" | "skipped" | "failed" | "already_running";
  decision: CameraFtpStartupRecoveryDecision;
  watcher: CameraFtpStartupWatcherState;
  warnings: CameraFtpStartupWarning[];
  checkedAt: string;
}

function expectedReceivePath(repositoryPath: string, eventSlug: string): string {
  return path.join(repositoryPath, "working", eventSlug, "原图", "相机FTP");
}

export async function runCameraFtpStartupRecovery(
  input: { baseUrl: string },
  dependencies: CameraFtpStartupRecoveryDependencies
): Promise<CameraFtpStartupRecoveryResult> {
  const checkedAt = new Date().toISOString();
  const config = dependencies.getConfig();
  const activeEventId = config.cameraFtp.activeEventId || "";
  const repositoryPath = config.repository.path || "";
  const repository = await dependencies.inspectRepository(repositoryPath);
  const event = activeEventId ? dependencies.getEvent(activeEventId) : undefined;
  const initialWatcher = dependencies.getWatcherStatus();
  const finishEarly = (decision: CameraFtpStartupRecoveryDecision): CameraFtpStartupRecoveryResult => {
    dependencies.log?.("warn", { reasonCode: decision.reasonCode }, "相机 FTP watcher 启动恢复已跳过");
    return { status: "skipped", decision, watcher: initialWatcher, warnings: decision.warnings, checkedAt };
  };
  const baseDecisionInput: CameraFtpStartupRecoveryDecisionInput = {
    activeEventId,
    eventExists: Boolean(event),
    eventStatus: event?.status || "not_found",
    repositoryConfigured: repository.configured,
    repositoryAvailable: repository.available,
    repositoryPath,
    expectedPath: "",
    receiveDirectoryExists: false,
    receiveDirectoryAccessible: false,
    currentInspectionLevel: "unknown",
    siteExists: null,
    siteStarted: null,
    sitePhysicalPath: "",
    watcher: initialWatcher
  };
  if (!activeEventId || !event || !["draft", "active", "reviewing"].includes(event.status)
    || !repository.configured || !repository.available || !repositoryPath) {
    return finishEarly(decideCameraFtpStartupRecovery(baseDecisionInput));
  }

  const receivePath = event && repositoryPath ? expectedReceivePath(repositoryPath, event.slug) : "";
  const receiveDirectory = receivePath
    ? await dependencies.inspectReceiveDirectory(receivePath)
    : { exists: false, accessible: false, isDirectory: false };
  const directoryDecisionInput: CameraFtpStartupRecoveryDecisionInput = {
    ...baseDecisionInput,
    expectedPath: receivePath,
    receiveDirectoryExists: receiveDirectory.exists && receiveDirectory.isDirectory !== false,
    receiveDirectoryAccessible: receiveDirectory.accessible
  };
  if (!directoryDecisionInput.receiveDirectoryExists || !directoryDecisionInput.receiveDirectoryAccessible) {
    return finishEarly(decideCameraFtpStartupRecovery(directoryDecisionInput));
  }

  let currentInspection: Awaited<ReturnType<CameraFtpStartupRecoveryDependencies["inspectCurrent"]>>;
  try {
    currentInspection = await dependencies.inspectCurrent({
      config: config.cameraFtp,
      physicalPath: receivePath
    });
  } catch (error: any) {
    const decision = decideCameraFtpStartupRecovery(directoryDecisionInput);
    const inspectionFailure = warning("IIS_INSPECTION_FAILED", error?.message || "普通权限 IIS FTP 检测失败。");
    return {
      status: "skipped",
      decision,
      watcher: initialWatcher,
      warnings: [...decision.warnings, inspectionFailure],
      checkedAt
    };
  }
  const watcherBefore = dependencies.getWatcherStatus();
  const decision = decideCameraFtpStartupRecovery({
    activeEventId,
    eventExists: true,
    eventStatus: event.status,
    repositoryConfigured: repository.configured,
    repositoryAvailable: repository.available,
    repositoryPath,
    expectedPath: receivePath,
    receiveDirectoryExists: receiveDirectory.exists && receiveDirectory.isDirectory !== false,
    receiveDirectoryAccessible: receiveDirectory.accessible,
    currentInspectionLevel: currentInspection.currentInspectionLevel,
    siteExists: currentInspection.site.exists,
    siteStarted: currentInspection.site.started,
    sitePhysicalPath: currentInspection.site.physicalPath,
    watcher: watcherBefore
  });

  if (decision.action === "skip") {
    dependencies.log?.("warn", { reasonCode: decision.reasonCode }, "相机 FTP watcher 启动恢复已跳过");
    return { status: "skipped", decision, watcher: watcherBefore, warnings: decision.warnings, checkedAt };
  }
  if (decision.action === "keep") {
    dependencies.log?.("info", { reasonCode: decision.reasonCode }, "相机 FTP watcher 已处于正确目录");
    return { status: "already_running", decision, watcher: watcherBefore, warnings: decision.warnings, checkedAt };
  }

  try {
    const watcher = await dependencies.startWatcher({
      eventId: event!.id,
      eventName: event!.name,
      eventSlug: event!.slug,
      directory: receivePath,
      cameraName: "相机 FTP",
      photographer: "",
      baseUrl: input.baseUrl,
      createDirectory: false,
      scanExistingOnStart: true
    });
    dependencies.log?.("info", { eventId: event!.id, directory: receivePath }, "相机 FTP watcher 已通过启动校验并完成补扫");
    return { status: "restored", decision, watcher, warnings: decision.warnings, checkedAt };
  } catch (error: any) {
    const failure = warning(
      "WATCHER_RESTORE_FAILED",
      error?.message || "相机 FTP watcher 启动恢复失败。"
    );
    dependencies.log?.("error", { code: error?.code || failure.code, message: failure.message }, "相机 FTP watcher 启动恢复失败");
    return {
      status: "failed",
      decision,
      watcher: dependencies.getWatcherStatus(),
      warnings: [...decision.warnings, failure],
      checkedAt
    };
  }
}
