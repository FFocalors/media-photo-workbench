import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { getConfig, saveConfig, type CameraFtpConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { getWindowsNetworkAddresses, type WindowsNetworkAddresses } from "../utils/windowsNetworkAddresses";
import { safeLog } from "../utils/logger";
import {
  getCameraFtpWatcher,
  getCameraFtpWatcherStatus,
  isCameraFtpWatcherBusy,
  scanCameraFtpWatcher,
  setCameraFtpWatcherBaseUrl,
  shutdownCameraFtpWatcher,
  startCameraFtpWatcher,
  stopCameraFtpWatcher,
  type CameraFtpWatcherContext,
  type CameraFtpWatcherStatus
} from "./cameraFtpWatcher";
import { ensureEventWorkingDirs, getEventWorkspacePaths } from "./eventWorkspace";
import { getEventById, type EventRow } from "./events";
import { clearPendingCameraFtpEventId, setPendingCameraFtpEventId } from "./cameraFtpRuntimeState";
import {
  getIisFtpManager,
  validateCameraFtpCredentials,
  validateCameraFtpPorts,
  type IisFtpActionResult,
  type IisFtpConflict,
  type IisFtpLastError,
  type IisFtpSystemStatus
} from "./iisFtpManager";
import {
  buildCameraFtpProvisioningPlan,
  type CameraFtpProvisioningGoal,
  type CameraFtpProvisioningPlan
} from "./cameraFtpProvisioner";

export interface CameraFtpActiveEventStatus {
  id: string;
  name: string;
  date: string;
  status: string;
  slug: string;
  valid: boolean;
}

export interface CameraFtpStatus {
  provider: "iis";
  inspectionLevel: "full" | "partial";
  requiresAdminForFullInspection: boolean;
  requiresAdminForSystemChanges: boolean;
  platform: IisFtpSystemStatus["platform"];
  windowsFeatures: IisFtpSystemStatus["windowsFeatures"];
  service: IisFtpSystemStatus["service"];
  site: IisFtpSystemStatus["site"];
  binding: IisFtpSystemStatus["binding"];
  authentication: IisFtpSystemStatus["authentication"];
  authorization: IisFtpSystemStatus["authorization"];
  account: IisFtpSystemStatus["account"];
  acl: IisFtpSystemStatus["acl"];
  activeEvent: CameraFtpActiveEventStatus | null;
  ftpPath: string;
  watcher: CameraFtpWatcherStatus;
  controlPort: number;
  passivePorts: IisFtpSystemStatus["passivePorts"];
  firewall: IisFtpSystemStatus["firewall"];
  port: IisFtpSystemStatus["port"];
  networkAddresses: WindowsNetworkAddresses;
  conflicts: IisFtpSystemStatus["conflicts"];
  warnings: string[];
  initialized: boolean;
  passwordConfigured: boolean;
  passwordResetRequired: boolean;
  requiresAdmin: boolean;
  repairable: boolean;
  missingItems: string[];
  lastError: IisFtpLastError | null;
}

export interface CameraFtpOperation {
  operationId?: string;
  action: "setup" | "adopt-site" | "start" | "stop" | "restart" | "repair" | "credentials" | "active-event" | "open-folder";
  status: "success";
  message: string;
  steps: Array<{
    id?: string;
    label: string;
    status: "pending" | "running" | "success" | "failed";
    message?: string;
  }>;
  requiresAdmin: boolean;
}

export interface CameraFtpOperationResponse {
  operation: CameraFtpOperation;
  status: CameraFtpStatus;
  path?: string;
}

export interface CameraFtpSiteDiscoveryResponse {
  sites: IisFtpConflict[];
  status: CameraFtpStatus;
}

export interface CameraFtpPortCheckResponse {
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  inspectionLevel: "partial" | "full";
  requiresAdminForFullInspection: boolean;
  port: IisFtpSystemStatus["port"];
  conflicts: IisFtpSystemStatus["conflicts"];
}

export interface CameraFtpProvisioningPlanRequest {
  goal: CameraFtpProvisioningGoal;
  eventId?: string;
  username?: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  targetSiteName?: string;
  targetSiteId?: number | null;
}

export class CameraFtpSwitchLock {
  private locked = false;

  isLocked(): boolean {
    return this.locked;
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.locked) {
      throw Object.assign(new Error("另一个 IIS FTP 管理操作正在进行，请稍后重试。"), {
        code: "CAMERA_FTP_SWITCH_IN_PROGRESS"
      });
    }
    this.locked = true;
    try {
      return await operation();
    } finally {
      this.locked = false;
    }
  }
}

export function assertCameraFtpSwitchAllowed(status: CameraFtpWatcherStatus): void {
  if (status.pendingCount > 0
    || status.queuedCount > 0
    || status.importingCount > 0
    || status.unstableCount > 0) {
    throw Object.assign(new Error("仍有相机文件正在上传或导入，请等待完成后再切换 FTP 接收活动。"), {
      code: "FTP_UPLOAD_IN_PROGRESS"
    });
  }
}

export function assertCameraFtpUnlinkAllowed(
  watcherStatus: CameraFtpWatcherStatus,
  site: Pick<IisFtpSystemStatus["site"], "exists" | "started">
): void {
  assertCameraFtpSwitchAllowed(watcherStatus);
  if (site.exists === true && site.started !== false) {
    throw Object.assign(new Error("请先停止 FTP 站点，再解除当前接收活动关联。"), {
      code: "FTP_SERVICE_MUST_BE_STOPPED"
    });
  }
  if (site.exists === null && site.started === null) {
    throw Object.assign(new Error("无法确认 FTP 站点已停止，请先执行停止 FTP 后重试。"), {
      code: "FTP_SERVICE_STATE_UNKNOWN"
    });
  }
}

export function getCameraFtpInspectionState(system: IisFtpSystemStatus): {
  inspectionLevel: "full" | "partial";
  requiresAdminForFullInspection: boolean;
  requiresAdminForSystemChanges: boolean;
  lastError: IisFtpLastError | null;
} {
  const partial = system.requiresAdmin === true;
  const permissionLimitedError = partial && ["ADMIN_REQUIRED", "IIS_STATUS_CHECK_FAILED"].includes(system.lastError?.code || "");
  return {
    inspectionLevel: partial ? "partial" : "full",
    requiresAdminForFullInspection: partial,
    requiresAdminForSystemChanges: system.platform.isWindows && system.platform.supported,
    lastError: permissionLimitedError ? null : system.lastError
  };
}

export function localizeCameraFtpWarning(message: string): string {
  if (!message) return "检测到一项 IIS FTP 配置提醒。";
  if (/could not be read without elevated access|configuration access is incomplete/i.test(message)) {
    return "普通权限下无法读取完整 IIS 站点配置，执行系统操作时工作台会自动请求管理员权限。";
  }
  if (/inherits write-capable access for broad Windows principals/i.test(message)) {
    return "FTP 接收目录继承了面向宽泛 Windows 用户组的可写权限；工作台不会自动删除其他合法权限，请由管理员确认目录上级权限。";
  }
  if (/firewall.*does not match|firewall.*LocalSubnet/i.test(message)) {
    return "Windows 防火墙 FTP 规则与当前控制端口、被动端口范围或 LocalSubnet 范围不一致。";
  }
  if (/account.*not.*managed|username.*not marked/i.test(message)) {
    return "当前用户名对应的 Windows 本地账户不是工作台管理账户，需要更换用户名或人工确认。";
  }
  if (/requires explicit adoption|identity does not match managedSiteId|no FTP binding/i.test(message)) {
    return "检测到尚未由工作台管理的 IIS FTP 站点，需要先执行管理员检测并明确确认接管。";
  }
  if (/restart may be required/i.test(message)) {
    return "Windows 提示 IIS FTP 功能可能需要重启系统后才能完全生效。";
  }
  if (/^[\x00-\x7F]+$/.test(message)) {
    return "检测到一项 IIS FTP 配置提醒，请查看状态卡或日志中的结构化诊断。";
  }
  return message;
}

export function assertCameraFtpInitialized(
  config: CameraFtpConfig,
  options: { requirePassword?: boolean } = {}
): void {
  if (!config.accountManaged || config.managedSiteId <= 0) {
    throw Object.assign(new Error("FTP 尚未完成首次配置，请先使用“配置并启动 FTP”或接管现有站点。"), {
      code: "FTP_SETUP_REQUIRED"
    });
  }
  if (options.requirePassword && config.passwordResetRequired) {
    throw Object.assign(new Error("FTP 账户尚未设置密码，请先完成账户配置。"), {
      code: "FTP_PASSWORD_REQUIRED"
    });
  }
}

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function writeOperationLog(eventId: string, type: string, detail: Record<string, unknown>): void {
  try {
    getDatabase().prepare(`
      INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
      VALUES (?, 'event', ?, 'host', '', ?, ?)
    `).run(type, eventId, JSON.stringify({ event_id: eventId, ...detail }), nowTimestamp());
  } catch (error) {
    safeLog("warn", { error, eventId, type }, "相机 FTP 操作日志写入失败");
  }
}

function allowedEvent(eventId: string): EventRow {
  if (!eventId) {
    throw Object.assign(new Error("请先选择当前 FTP 接收活动。"), { code: "FTP_EVENT_NOT_FOUND" });
  }
  const event = getEventById(eventId);
  if (!event) {
    throw Object.assign(new Error("FTP 接收活动不存在。"), { code: "FTP_EVENT_NOT_FOUND" });
  }
  if (!["draft", "active", "reviewing"].includes(event.status)) {
    throw Object.assign(new Error("归档或删除状态的活动不能接收相机 FTP 文件。"), {
      code: "FTP_EVENT_NOT_ALLOWED"
    });
  }
  return event;
}

export function resolveCameraFtpReceivePath(repositoryPath: string, eventSlug: string): string {
  if (!repositoryPath) {
    throw Object.assign(new Error("请先配置图片仓库路径。"), { code: "REPOSITORY_NOT_READY" });
  }
  return getEventWorkspacePaths(repositoryPath, eventSlug).cameraFtpReceiveDir;
}

function eventFtpPath(event: EventRow): string {
  return resolveCameraFtpReceivePath(getConfig().repository.path, event.slug);
}

function activeEventDto(event: EventRow | undefined): CameraFtpActiveEventStatus | null {
  if (!event) return null;
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    status: event.status,
    slug: event.slug,
    valid: ["draft", "active", "reviewing"].includes(event.status)
  };
}

function watcherContext(event: EventRow, directory: string, baseUrl: string): CameraFtpWatcherContext {
  return {
    eventId: event.id,
    eventName: event.name,
    eventSlug: event.slug,
    directory,
    cameraName: "相机 FTP",
    photographer: "",
    baseUrl
  };
}

type ApiOperationAction = CameraFtpOperation["action"];

function operationStepStatus(value: string): "pending" | "running" | "success" | "failed" {
  if (value === "pending" || value === "running" || value === "failed") return value;
  return "success";
}

function managerOperation(action: IisFtpActionResult, apiAction: ApiOperationAction): CameraFtpOperation {
  const actionMessages: Record<ApiOperationAction, string> = {
    setup: "IIS FTP 已完成配置并启动。",
    "adopt-site": "现有 IIS FTP 站点已接管并完成验证。",
    start: "IIS FTP 已启动。",
    stop: "IIS FTP 站点已停止，活动关联和 watcher 保持不变。",
    restart: "IIS FTP 已重启。",
    repair: "IIS FTP 配置已修复并完成验证。",
    credentials: "FTP 全局账户已更新。",
    "active-event": "FTP 接收活动已切换。",
    "open-folder": "FTP 接收目录已打开。"
  };
  const stepLabels: Record<string, string> = {
    preflight: "系统与冲突预检查",
    windowsFeatures: "IIS FTP 组件",
    account: "本地 FTP 账户",
    acl: "接收目录权限",
    accountAndAcl: "账户与目录权限",
    site: "IIS FTP 站点",
    adoptSite: "接管 IIS FTP 站点",
    authorization: "FTP 授权规则",
    firewall: "Windows 防火墙",
    start: "启动 FTP 服务",
    stop: "停止 FTP 站点",
    restart: "重启 FTP 服务",
    setPath: "切换接收目录",
    snapshot_current_state: "记录切换前状态",
    prepare_target_directory: "准备目标接收目录",
    update_target_acl: "设置目标目录权限",
    stop_ftp_site: "停止托管 FTP 站点",
    update_iis_physical_path: "切换 IIS 接收目录",
    restart_ftp_site: "恢复 FTP 站点运行状态",
    preserve_stopped_site: "保持 FTP 站点停止",
    verify_switched_state: "验证切换结果",
    verify: "最终配置验证"
  };
  return {
    operationId: action.operationId,
    action: apiAction,
    status: "success",
    message: actionMessages[apiAction],
    steps: action.steps.map((step, index) => ({
      id: `${apiAction}-${index + 1}`,
      label: stepLabels[step.name] || step.name || `步骤 ${index + 1}`,
      status: operationStepStatus(step.status),
      message: undefined
    })),
    requiresAdmin: action.requiresAdmin
  };
}

function simpleOperation(action: ApiOperationAction, message: string): CameraFtpOperation {
  return { action, status: "success", message, steps: [], requiresAdmin: false };
}

function sameWindowsPath(left: string, right: string): boolean {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

interface CameraFtpWatcherSnapshot {
  running: boolean;
  context: CameraFtpWatcherContext | null;
}

export interface CameraFtpNodeStateCommitHooks {
  startWatcher: () => Promise<void>;
  saveConfig: () => void;
  verifyState?: () => void;
  restoreConfig: () => void;
  restoreWatcher: () => Promise<void>;
}

/**
 * Commits the non-elevated half of provisioning in watcher-then-config order.
 * All callbacks are injected so rollback behavior can be exercised without
 * touching IIS, the real config file, or a real watcher.
 */
export async function commitCameraFtpNodeState(hooks: CameraFtpNodeStateCommitHooks): Promise<void> {
  try {
    await hooks.startWatcher();
    hooks.saveConfig();
    hooks.verifyState?.();
  } catch (error: any) {
    const rollbackErrors: string[] = [];
    try {
      hooks.restoreConfig();
    } catch (rollbackError: any) {
      rollbackErrors.push(rollbackError?.message || "恢复相机 FTP 配置失败");
    }
    try {
      await hooks.restoreWatcher();
    } catch (rollbackError: any) {
      rollbackErrors.push(rollbackError?.message || "恢复相机 FTP watcher 失败");
    }
    if (rollbackErrors.length > 0) {
      throw Object.assign(new Error(`${error?.message || "提交相机 FTP 本地状态失败"}；部分本地回滚失败：${rollbackErrors[0]}`), {
        code: error?.code || "CAMERA_FTP_NODE_COMMIT_FAILED",
        cause: error,
        diagnostics: {
          ...(error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : {}),
          nodeRollbackAttempted: true,
          nodeRollbackSucceeded: false,
          nodeRollbackErrors: rollbackErrors
        }
      });
    }
    throw error;
  }
}

export function requiresElevatedCameraFtpSiteStateInspection(
  status: Pick<IisFtpSystemStatus, "requiresAdmin" | "site">
): boolean {
  return status.requiresAdmin || status.site.exists === null || status.site.started === null;
}

function captureCameraFtpWatcherSnapshot(): CameraFtpWatcherSnapshot {
  return {
    running: getCameraFtpWatcherStatus().running,
    context: getCameraFtpWatcher().getContext()
  };
}

function sameWatcherTarget(left: CameraFtpWatcherContext | null, right: CameraFtpWatcherContext | null): boolean {
  return Boolean(left && right && left.eventId === right.eventId && sameWindowsPath(left.directory, right.directory));
}

async function restoreCameraFtpWatcherSnapshot(snapshot: CameraFtpWatcherSnapshot, reason: string): Promise<void> {
  const currentStatus = getCameraFtpWatcherStatus();
  const currentContext = getCameraFtpWatcher().getContext();
  if (snapshot.running && snapshot.context && currentStatus.running && sameWatcherTarget(currentContext, snapshot.context)) {
    return;
  }
  if (currentStatus.running || currentContext) {
    stopCameraFtpWatcher({ force: true, reason });
  }
  if (snapshot.running && snapshot.context) {
    await startCameraFtpWatcher(snapshot.context);
  }
}

export type CameraFtpSwitchStage =
  | "validate_target_event"
  | "check_pending_uploads"
  | "snapshot_current_state"
  | "prepare_target_directory"
  | "update_iis_physical_path"
  | "switch_watcher"
  | "verify_switched_state"
  | "commit_active_event";

export interface CameraFtpSwitchRollbackItem {
  stage: "rollback_physical_path" | "rollback_watcher" | "rollback_site_state" | "rollback_active_event";
  status: "success" | "failed" | "not_required";
  code?: string;
  message: string;
}

export interface CameraFtpEventSwitchTransactionHooks<TSnapshot, TSystemStatus> {
  operationId: string;
  fromEventId: string;
  toEventId: string;
  validateTargetEvent: () => void | Promise<void>;
  checkPendingUploads: () => void | Promise<void>;
  snapshotCurrentState: () => TSnapshot | Promise<TSnapshot>;
  prepareTargetDirectory: () => void | Promise<void>;
  updateIisPhysicalPath: (snapshot: TSnapshot) => TSystemStatus | Promise<TSystemStatus>;
  switchWatcher: (snapshot: TSnapshot) => void | Promise<void>;
  verifySwitchedState: (snapshot: TSnapshot, systemStatus: TSystemStatus) => void | Promise<void>;
  commitActiveEvent: (snapshot: TSnapshot) => void | Promise<void>;
  rollbackSystem: (snapshot: TSnapshot) => TSystemStatus | void | Promise<TSystemStatus | void>;
  rollbackWatcher: (snapshot: TSnapshot) => void | Promise<void>;
  rollbackActiveEvent: (snapshot: TSnapshot) => void | Promise<void>;
  verifyRollback: (snapshot: TSnapshot, systemStatus?: TSystemStatus) => void | Promise<void>;
  onStage?: (entry: { stage: string; status: "running" | "success" | "failed"; code?: string }) => void;
}

function switchFailureCode(stage: string, originalCode: string): string {
  if ([
    "FTP_EVENT_SWITCH_FAILED",
    "FTP_SITE_STOP_FAILED",
    "FTP_TARGET_ACL_UPDATE_FAILED",
    "FTP_PHYSICAL_PATH_UPDATE_FAILED",
    "FTP_WATCHER_SWITCH_FAILED",
    "FTP_SITE_RESTART_FAILED",
    "FTP_SWITCH_VERIFY_FAILED",
    "FTP_SWITCH_ROLLBACK_FAILED",
    "FTP_ACTIVE_EVENT_STATE_MISMATCH"
  ].includes(originalCode)) return originalCode;
  if (originalCode === "IIS_FTP_SITE_STOP_FAILED") return "FTP_SITE_STOP_FAILED";
  if (originalCode === "IIS_FTP_SITE_START_FAILED" || stage === "restart_ftp_site") return "FTP_SITE_RESTART_FAILED";
  if (stage === "update_target_acl" || stage === "configure_directory_acl") return "FTP_TARGET_ACL_UPDATE_FAILED";
  if (stage === "update_iis_physical_path" || stage === "configure_physical_path") return "FTP_PHYSICAL_PATH_UPDATE_FAILED";
  if (stage === "switch_watcher") return "FTP_WATCHER_SWITCH_FAILED";
  if (stage === "verify_switched_state" || originalCode === "CAMERA_FTP_CONFIG_MISMATCH") return "FTP_SWITCH_VERIFY_FAILED";
  if (stage === "commit_active_event") return "FTP_ACTIVE_EVENT_STATE_MISMATCH";
  return originalCode || "FTP_EVENT_SWITCH_FAILED";
}

export async function runCameraFtpEventSwitchTransaction<TSnapshot, TSystemStatus>(
  hooks: CameraFtpEventSwitchTransactionHooks<TSnapshot, TSystemStatus>
): Promise<{ operationId: string; systemStatus: TSystemStatus; completedStages: CameraFtpSwitchStage[] }> {
  let currentStage: CameraFtpSwitchStage = "validate_target_event";
  let snapshot: TSnapshot | undefined;
  let systemStatus: TSystemStatus | undefined;
  let systemChanged = false;
  let systemChangeAttempted = false;
  let watcherSwitchAttempted = false;
  let activeEventCommitAttempted = false;
  const completedStages: CameraFtpSwitchStage[] = [];

  const runStage = async <T>(stage: CameraFtpSwitchStage, operation: () => T | Promise<T>): Promise<T> => {
    currentStage = stage;
    hooks.onStage?.({ stage, status: "running" });
    try {
      const result = await operation();
      completedStages.push(stage);
      hooks.onStage?.({ stage, status: "success" });
      return result;
    } catch (error: any) {
      hooks.onStage?.({ stage, status: "failed", code: switchFailureCode(error?.diagnostics?.stage || stage, error?.code || "") });
      throw error;
    }
  };

  try {
    await runStage("validate_target_event", hooks.validateTargetEvent);
    await runStage("check_pending_uploads", hooks.checkPendingUploads);
    snapshot = await runStage("snapshot_current_state", hooks.snapshotCurrentState);
    await runStage("prepare_target_directory", hooks.prepareTargetDirectory);
    systemStatus = await runStage("update_iis_physical_path", async () => {
      systemChangeAttempted = true;
      const result = await hooks.updateIisPhysicalPath(snapshot as TSnapshot);
      systemChanged = true;
      return result;
    });
    await runStage("switch_watcher", async () => {
      watcherSwitchAttempted = true;
      await hooks.switchWatcher(snapshot as TSnapshot);
    });
    await runStage("verify_switched_state", () => hooks.verifySwitchedState(snapshot as TSnapshot, systemStatus as TSystemStatus));
    await runStage("commit_active_event", async () => {
      activeEventCommitAttempted = true;
      await hooks.commitActiveEvent(snapshot as TSnapshot);
    });
    return { operationId: hooks.operationId, systemStatus, completedStages };
  } catch (error: any) {
    const failedStage = error?.diagnostics?.stage || currentStage;
    const code = switchFailureCode(failedStage, error?.code || "");
    const originalDetails = error?.diagnostics?.details && typeof error.diagnostics.details === "object"
      ? error.diagnostics.details
      : {};
    const scriptRollbackSucceeded = error?.diagnostics?.rollbackSucceeded === true
      || error?.diagnostics?.data?.rollback?.succeeded === true;
    const shouldRestoreSystem = systemChanged
      || (systemChangeAttempted && error?.code !== "UAC_CANCELLED" && !scriptRollbackSucceeded);
    const rollback: CameraFtpSwitchRollbackItem[] = [];
    let rollbackSystemStatus: TSystemStatus | undefined;

    const rollbackStep = async (
      stage: CameraFtpSwitchRollbackItem["stage"],
      required: boolean,
      operation: () => void | TSystemStatus | Promise<void | TSystemStatus>
    ): Promise<void> => {
      if (!required) {
        rollback.push({ stage, status: "not_required", message: "本阶段尚未修改，无需恢复。" });
        return;
      }
      hooks.onStage?.({ stage, status: "running" });
      try {
        const result = await operation();
        if (result !== undefined) rollbackSystemStatus = result as TSystemStatus;
        rollback.push({ stage, status: "success", message: "已恢复并进入回滚验证。" });
        hooks.onStage?.({ stage, status: "success" });
      } catch (rollbackError: any) {
        rollback.push({
          stage,
          status: "failed",
          code: rollbackError?.code || "FTP_SWITCH_ROLLBACK_FAILED",
          message: rollbackError?.message || "回滚失败。"
        });
        hooks.onStage?.({ stage, status: "failed", code: rollbackError?.code || "FTP_SWITCH_ROLLBACK_FAILED" });
      }
    };

    if (snapshot !== undefined) {
      await rollbackStep("rollback_physical_path", shouldRestoreSystem, () => hooks.rollbackSystem(snapshot as TSnapshot));
      const physicalRollback = rollback[rollback.length - 1];
      rollback.push({
        stage: "rollback_site_state",
        status: physicalRollback.status,
        ...(physicalRollback.code ? { code: physicalRollback.code } : {}),
        message: shouldRestoreSystem ? "站点运行状态与 physicalPath 使用同一 IIS 快照恢复。" : "站点状态未修改，或管理员脚本已验证完成内部回滚。"
      });
      await rollbackStep("rollback_watcher", watcherSwitchAttempted, () => hooks.rollbackWatcher(snapshot as TSnapshot));
      await rollbackStep("rollback_active_event", activeEventCommitAttempted, () => hooks.rollbackActiveEvent(snapshot as TSnapshot));
      try {
        await hooks.verifyRollback(snapshot as TSnapshot, rollbackSystemStatus);
      } catch (rollbackError: any) {
        rollback.push({
          stage: "rollback_active_event",
          status: "failed",
          code: rollbackError?.code || "FTP_SWITCH_ROLLBACK_FAILED",
          message: rollbackError?.message || "回滚后的真实状态验证失败。"
        });
      }
    }

    const rollbackFailures = rollback.filter((item) => item.status === "failed");
    const rollbackSucceeded = rollbackFailures.length === 0;
    const diagnostics = {
      operationId: hooks.operationId,
      operation: "active-event",
      stage: failedStage,
      rollbackAttempted: snapshot !== undefined,
      rollbackSucceeded,
      details: {
        ...originalDetails,
        fromEventId: hooks.fromEventId,
        toEventId: hooks.toEventId,
        failedStage,
        failedCode: code,
        originalCode: error?.code || "",
        childOperationId: error?.diagnostics?.operationId,
        scriptRollback: error?.diagnostics?.data?.rollback,
        completedStages,
        rollback
      },
      data: {
        completedSteps: completedStages.map((stage) => ({ name: stage, status: "success" })),
        failedStep: { name: failedStage, status: "failed", code },
        rollback: {
          attempted: snapshot !== undefined,
          status: rollbackSucceeded ? "success" : "partial",
          succeeded: rollbackSucceeded,
          items: rollback
        }
      }
    };
    const message = rollbackSucceeded
      ? error?.message || "切换 FTP 接收活动失败，已完整恢复原状态。"
      : `${error?.message || "切换 FTP 接收活动失败"}；回滚未完全恢复：${rollbackFailures[0]?.message}`;
    throw Object.assign(new Error(message), {
      code: rollbackSucceeded ? code : "FTP_SWITCH_ROLLBACK_FAILED",
      cause: error,
      diagnostics
    });
  }
}

export function verifySwitchedSite(
  status: IisFtpSystemStatus,
  expected: { path: string; started: boolean; managedSiteId: number; eventId: string; watcher: CameraFtpWatcherStatus }
): void {
  const checks = [
    { id: "siteExists", code: "FTP_SWITCH_VERIFY_FAILED", passed: status.site.exists === true, expected: true, actual: status.site.exists },
    { id: "managedSiteId", code: "MANAGED_SITE_ID_MISMATCH", passed: status.site.id === expected.managedSiteId && status.site.managed === true, expected: expected.managedSiteId, actual: status.site.id },
    { id: "physicalPath", code: "PHYSICAL_PATH_MISMATCH", passed: sameWindowsPath(status.site.physicalPath, expected.path), expected: expected.path, actual: status.site.physicalPath },
    { id: "siteStarted", code: expected.started ? "FTP_SITE_RESTART_FAILED" : "FTP_SWITCH_VERIFY_FAILED", passed: status.site.started === expected.started, expected: expected.started, actual: status.site.started },
    { id: "binding", code: "SITE_BINDING_MISMATCH", passed: status.binding.correct === true, expected: true, actual: status.binding.correct },
    { id: "watcherRunning", code: "FTP_WATCHER_SWITCH_FAILED", passed: expected.watcher.running, expected: true, actual: expected.watcher.running },
    { id: "watcherEvent", code: "FTP_WATCHER_SWITCH_FAILED", passed: expected.watcher.eventId === expected.eventId, expected: expected.eventId, actual: expected.watcher.eventId },
    { id: "watcherPath", code: "FTP_WATCHER_SWITCH_FAILED", passed: sameWindowsPath(expected.watcher.directory, expected.path), expected: expected.path, actual: expected.watcher.directory }
  ];
  if (expected.started) {
    checks.push({ id: "listener", code: "CONTROL_PORT_NOT_LISTENING", passed: status.port.listening === true && status.port.ownedByMicrosoftFtp === true, expected: true, actual: status.port.listening });
  }
  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    throw Object.assign(new Error(`FTP 活动切换验证失败：${failed.map((check) => check.id).join(", ")}`), {
      code: failed.length === 1 ? failed[0].code : "FTP_SWITCH_VERIFY_FAILED",
      diagnostics: { stage: "verify_switched_state", details: { failedCodes: [...new Set(failed.map((check) => check.code))], verificationChecks: checks } }
    });
  }
}

export class CameraFtpOrchestrator {
  private readonly manager = getIisFtpManager();
  private readonly switchLock = new CameraFtpSwitchLock();
  private baseUrl = "";
  private lastKnownManagedSiteStarted: boolean | null = null;

  getSwitchLock(): CameraFtpSwitchLock {
    return this.switchLock;
  }

  setBaseUrl(baseUrl: string): void {
    if (baseUrl) {
      this.baseUrl = baseUrl;
      setCameraFtpWatcherBaseUrl(baseUrl);
    }
  }

  private async commitProvisioningNodeState(input: {
    previousConfig: CameraFtpConfig;
    nextConfig: CameraFtpConfig;
    event: EventRow;
    ftpPath: string;
    watcherSnapshot: CameraFtpWatcherSnapshot;
    rollbackReason: string;
  }): Promise<void> {
    await commitCameraFtpNodeState({
      startWatcher: async () => {
        await startCameraFtpWatcher(watcherContext(input.event, input.ftpPath, this.baseUrl));
      },
      saveConfig: () => {
        saveConfig({ cameraFtp: input.nextConfig });
      },
      verifyState: () => {
        const savedConfig = getConfig().cameraFtp;
        const watcher = getCameraFtpWatcherStatus();
        const checks = [
          {
            id: "activeEventId",
            code: "ACTIVE_EVENT_ID_MISMATCH",
            passed: savedConfig.activeEventId === input.event.id,
            expected: input.event.id,
            actual: savedConfig.activeEventId
          },
          {
            id: "managedSiteId",
            code: "MANAGED_SITE_ID_MISMATCH",
            passed: input.nextConfig.managedSiteId > 0 && savedConfig.managedSiteId === input.nextConfig.managedSiteId,
            expected: input.nextConfig.managedSiteId,
            actual: savedConfig.managedSiteId
          },
          {
            id: "savedControlPort",
            code: "CAMERA_FTP_CONFIG_SAVE_MISMATCH",
            passed: savedConfig.controlPort === input.nextConfig.controlPort,
            expected: input.nextConfig.controlPort,
            actual: savedConfig.controlPort
          },
          {
            id: "savedPassivePorts",
            code: "CAMERA_FTP_CONFIG_SAVE_MISMATCH",
            passed: savedConfig.passivePortStart === input.nextConfig.passivePortStart
              && savedConfig.passivePortEnd === input.nextConfig.passivePortEnd,
            expected: `${input.nextConfig.passivePortStart}-${input.nextConfig.passivePortEnd}`,
            actual: `${savedConfig.passivePortStart}-${savedConfig.passivePortEnd}`
          },
          {
            id: "watcherRunning",
            code: "CAMERA_FTP_WATCHER_NOT_RUNNING",
            passed: watcher.running,
            expected: true,
            actual: watcher.running
          },
          {
            id: "watcherEventId",
            code: "CAMERA_FTP_WATCHER_TARGET_MISMATCH",
            passed: watcher.eventId === input.event.id,
            expected: input.event.id,
            actual: watcher.eventId
          },
          {
            id: "watcherDirectory",
            code: "CAMERA_FTP_WATCHER_TARGET_MISMATCH",
            passed: sameWindowsPath(watcher.directory, input.ftpPath),
            expected: input.ftpPath,
            actual: watcher.directory
          }
        ];
        const failedChecks = checks.filter((check) => !check.passed);
        safeLog(failedChecks.length > 0 ? "error" : "info", {
          stage: "verify_node_state",
          eventId: input.event.id,
          managedSiteId: savedConfig.managedSiteId,
          controlPort: savedConfig.controlPort,
          watcher: {
            running: watcher.running,
            eventId: watcher.eventId,
            directory: watcher.directory
          },
          checks
        }, failedChecks.length > 0 ? "相机 FTP 本地状态最终验证失败" : "相机 FTP 本地状态最终验证通过");
        if (failedChecks.length > 0) {
          const failedCodes = [...new Set(failedChecks.map((check) => check.code))];
          throw Object.assign(new Error(`相机 FTP 本地状态验证失败：${failedCodes.join(", ")}`), {
            code: failedCodes.length === 1 ? failedCodes[0] : "CAMERA_FTP_NODE_STATE_MISMATCH",
            diagnostics: {
              stage: "verify_node_state",
              failedCodes,
              verificationChecks: checks
            }
          });
        }
      },
      restoreConfig: () => {
        saveConfig({ cameraFtp: input.previousConfig });
      },
      restoreWatcher: () => restoreCameraFtpWatcherSnapshot(input.watcherSnapshot, input.rollbackReason)
    });
  }

  async getStatus(options: { forceSystemRefresh?: boolean } = {}): Promise<CameraFtpStatus> {
    return this.buildStatus(getConfig().cameraFtp, options);
  }

  /**
   * Read-only phase of the provisioning transaction.  It deliberately does
   * not create the receive directory, start the watcher, save config, or ask
   * for UAC.  The elevated script repeats the safety checks immediately before
   * Apply so a stale ordinary-permission plan can never authorize mutation.
   */
  async prepareProvisioningPlan(input: CameraFtpProvisioningPlanRequest): Promise<CameraFtpProvisioningPlan> {
    validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
    const savedConfig = getConfig().cameraFtp;
    const eventId = (input.eventId || savedConfig.activeEventId).trim();
    const event = eventId ? getEventById(eventId) : undefined;
    const username = (input.username || savedConfig.username).trim();
    if (!username || username.length > 20 || /["\/\\[\]:;|=,+*?<>@]/.test(username) || /[.\s]$/.test(username)) {
      throw Object.assign(new Error("FTP 用户名无效，请使用 1-20 位普通字符且不要包含 Windows 用户名禁用符号。"), {
        code: "FTP_USERNAME_INVALID"
      });
    }
    const repositoryPath = getConfig().repository.path;
    const workspace = event && repositoryPath ? getEventWorkspacePaths(repositoryPath, event.slug) : null;
    const physicalPath = workspace?.cameraFtpReceiveDir || "";
    const probeConfig: CameraFtpConfig = {
      ...savedConfig,
      username,
      activeEventId: eventId,
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd
    };
    const [system, directoryExists, legacyDirectoryExists] = await Promise.all([
      this.manager.getStatus({ config: probeConfig, physicalPath }, { force: true }),
      physicalPath ? fs.pathExists(physicalPath) : Promise.resolve(false),
      workspace ? fs.pathExists(path.join(workspace.eventDir, "ftp")) : Promise.resolve(false)
    ]);
    const watcher = getCameraFtpWatcherStatus();
    const plan = buildCameraFtpProvisioningPlan({
      goal: input.goal,
      eventId,
      eventExists: Boolean(event),
      eventValid: Boolean(event && ["draft", "active", "reviewing"].includes(event.status)),
      eventStatus: event?.status || "not_found",
      username,
      physicalPath,
      directoryExists,
      legacyDirectoryExists,
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd,
      targetSiteName: input.targetSiteName,
      targetSiteId: input.targetSiteId,
      configMatches: savedConfig.activeEventId === eventId
        && savedConfig.username === username
        && savedConfig.controlPort === input.controlPort
        && savedConfig.passivePortStart === input.passivePortStart
        && savedConfig.passivePortEnd === input.passivePortEnd,
      watcher: {
        running: watcher.running && (!eventId || watcher.eventId === eventId),
        unstableCount: watcher.unstableCount,
        pendingCount: watcher.pendingCount + watcher.queuedCount,
        importingCount: watcher.importingCount
      },
      system
    });
    safeLog("info", {
      planId: plan.planId,
      goal: plan.target,
      eventId,
      controlPort: input.controlPort,
      itemCounts: plan.items.reduce<Record<string, number>>((counts, entry) => {
        counts[entry.status] = (counts[entry.status] || 0) + 1;
        return counts;
      }, {}),
      requiresAdmin: plan.requiresAdmin,
      canApply: plan.canApply
    }, "相机 FTP Preflight 与配置计划已生成");
    return plan;
  }

  private async buildStatus(
    config: CameraFtpConfig,
    options: { forceSystemRefresh?: boolean; systemStatus?: IisFtpSystemStatus } = {}
  ): Promise<CameraFtpStatus> {
    const activeEvent = config.activeEventId ? getEventById(config.activeEventId) : undefined;
    let ftpPath = "";
    if (activeEvent && getConfig().repository.path) {
      ftpPath = eventFtpPath(activeEvent);
    }
    const [system, networkAddresses] = await Promise.all([
      options.systemStatus
        ? Promise.resolve(options.systemStatus)
        : this.manager.getStatus({ config, physicalPath: ftpPath }, { force: options.forceSystemRefresh }),
      Promise.resolve(getWindowsNetworkAddresses())
    ]);
    if (system.site.started !== null) {
      this.lastKnownManagedSiteStarted = system.site.started;
    }
    const site = system.site.started === null && this.lastKnownManagedSiteStarted !== null
      ? {
          ...system.site,
          started: this.lastKnownManagedSiteStarted,
          status: this.lastKnownManagedSiteStarted ? "started" : "stopped"
        }
      : system.site;
    const inspection = getCameraFtpInspectionState(system);
    const watcher = getCameraFtpWatcherStatus();
    const warnings = Array.from(new Set([
      ...system.warnings.map(localizeCameraFtpWarning),
      ...networkAddresses.warnings,
      ...(config.activeEventId && !activeEvent ? ["保存的 FTP 接收活动已不存在，请重新选择。"] : []),
      ...(activeEvent && !["draft", "active", "reviewing"].includes(activeEvent.status)
        ? ["保存的 FTP 接收活动当前不可接收文件，请切换活动。"]
        : [])
    ]));
    const initialized = config.accountManaged && config.managedSiteId > 0;
    const passwordConfigured = config.accountManaged
      && !config.passwordResetRequired
      && system.account.exists !== false;
    return {
      provider: "iis",
      inspectionLevel: inspection.inspectionLevel,
      requiresAdminForFullInspection: inspection.requiresAdminForFullInspection,
      requiresAdminForSystemChanges: inspection.requiresAdminForSystemChanges,
      platform: system.platform,
      windowsFeatures: system.windowsFeatures,
      service: system.service,
      site,
      binding: system.binding,
      authentication: system.authentication,
      authorization: system.authorization,
      account: system.account,
      acl: system.acl,
      activeEvent: activeEventDto(activeEvent),
      ftpPath,
      watcher,
      controlPort: config.controlPort,
      passivePorts: system.passivePorts,
      firewall: system.firewall,
      port: system.port,
      networkAddresses,
      conflicts: system.conflicts,
      warnings,
      initialized,
      passwordConfigured,
      passwordResetRequired: config.passwordResetRequired,
      requiresAdmin: system.requiresAdmin,
      repairable: system.repairable,
      missingItems: system.missingItems,
      lastError: inspection.lastError || (watcher.lastError
        ? { code: "CAMERA_FTP_WATCHER_FAILED", message: watcher.lastError }
        : null)
    };
  }

  async restoreWatcher(input: { baseUrl: string }): Promise<CameraFtpWatcherStatus> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    if (!config.activeEventId) return getCameraFtpWatcherStatus();
    let event: EventRow;
    try {
      event = allowedEvent(config.activeEventId);
    } catch (error: any) {
      safeLog("warn", { code: error?.code, eventId: config.activeEventId }, "未恢复相机 FTP watcher");
      return getCameraFtpWatcherStatus();
    }
    ensureEventWorkingDirs(event.slug);
    const ftpPath = eventFtpPath(event);
    await fs.ensureDir(ftpPath);
    return startCameraFtpWatcher(watcherContext(event, ftpPath, this.baseUrl));
  }

  async setup(input: {
    baseUrl: string;
    eventId: string;
    username: string;
    password: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.setupUnlocked(input));
  }

  private async setupUnlocked(input: {
    baseUrl: string;
    eventId: string;
    username: string;
    password: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    validateCameraFtpCredentials(input.username, input.password);
    validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
    const event = allowedEvent(input.eventId || config.activeEventId);
    setPendingCameraFtpEventId(event.id);
    const watcherSnapshot = captureCameraFtpWatcherSnapshot();
    const oldWatcherContext = watcherSnapshot.context;
    let oldWatcherStopped = false;
    try {
      const ftpPath = await this.prepareEventDirectory(event);
      if (oldWatcherContext && oldWatcherContext.eventId !== event.id) {
        assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus());
        stopCameraFtpWatcher({ reason: "first_setup_event_change" });
        oldWatcherStopped = true;
      }
      const setupConfig: CameraFtpConfig = {
        ...config,
        username: input.username.trim(),
        activeEventId: event.id,
        controlPort: input.controlPort,
        passivePortStart: input.passivePortStart,
        passivePortEnd: input.passivePortEnd
      };
      const result = await this.manager.setup({
        config: setupConfig,
        physicalPath: ftpPath,
        password: input.password,
        allowLegacyFirewallRuleUpdate: input.allowLegacyFirewallRuleUpdate === true,
        allowAclTightening: input.allowAclTightening === true
      });
      const actualSiteName = result.systemStatus?.site.name || setupConfig.siteName;
      const nextConfig: CameraFtpConfig = {
        ...setupConfig,
        siteName: actualSiteName,
        managedSiteId: result.systemStatus?.site.id || config.managedSiteId,
        accountManaged: true,
        passwordResetRequired: false
      };
      await this.commitProvisioningNodeState({
        previousConfig: config,
        nextConfig,
        event,
        ftpPath,
        watcherSnapshot,
        rollbackReason: "setup_node_rollback"
      });
      this.lastKnownManagedSiteStarted = result.systemStatus?.site.started ?? true;
      writeOperationLog(event.id, "camera_ftp_iis_setup", {
        site_name: actualSiteName,
        username_changed: input.username.trim() !== config.username,
        control_port: setupConfig.controlPort,
        passive_port_start: setupConfig.passivePortStart,
        passive_port_end: setupConfig.passivePortEnd,
        passwordReset: true,
        success: true
      });
      return { operation: managerOperation(result, "setup"), status: await this.buildStatus(nextConfig, { systemStatus: result.systemStatus }) };
    } catch (error: any) {
      if (oldWatcherStopped) {
        try {
          await restoreCameraFtpWatcherSnapshot(watcherSnapshot, "setup_system_rollback");
        } catch (rollbackError: any) {
          safeLog("error", { rollbackError, eventId: oldWatcherContext?.eventId }, "首次配置失败后恢复旧 watcher 失败");
          throw Object.assign(new Error(`${error?.message || "首次配置失败"}；恢复旧 watcher 失败：${rollbackError?.message || "未知错误"}`), {
            code: error?.code || "CAMERA_FTP_NODE_COMMIT_FAILED",
            cause: error
          });
        }
      }
      throw error;
    } finally {
      clearPendingCameraFtpEventId(event.id);
    }
  }

  async repair(input: {
    baseUrl: string;
    password?: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.repairUnlocked(input));
  }

  private async repairUnlocked(input: {
    baseUrl: string;
    password?: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    assertCameraFtpInitialized(config);
    validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
    const event = allowedEvent(config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    const watcherSnapshot = captureCameraFtpWatcherSnapshot();
    if (input.password) validateCameraFtpCredentials(config.username, input.password);
    const repairConfig: CameraFtpConfig = {
      ...config,
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd
    };
    const result = await this.manager.repair({
      config: repairConfig,
      physicalPath: ftpPath,
      password: input.password,
      allowLegacyFirewallRuleUpdate: input.allowLegacyFirewallRuleUpdate === true,
      allowAclTightening: input.allowAclTightening === true
    });
    const nextConfig: CameraFtpConfig = {
      ...repairConfig,
      managedSiteId: result.systemStatus?.site.id || config.managedSiteId,
      accountManaged: Boolean(input.password) || result.systemStatus?.account.managed === true || config.accountManaged,
      passwordResetRequired: input.password ? false : config.passwordResetRequired
    };
    await this.commitProvisioningNodeState({
      previousConfig: config,
      nextConfig,
      event,
      ftpPath,
      watcherSnapshot,
      rollbackReason: "repair_node_rollback"
    });
    this.lastKnownManagedSiteStarted = result.systemStatus?.site.started ?? this.lastKnownManagedSiteStarted;
    writeOperationLog(event.id, "camera_ftp_iis_repair", {
      site_name: config.siteName,
      control_port: repairConfig.controlPort,
      passive_port_start: repairConfig.passivePortStart,
      passive_port_end: repairConfig.passivePortEnd,
      success: true
    });
    return { operation: managerOperation(result, "repair"), status: await this.buildStatus(nextConfig, { systemStatus: result.systemStatus }) };
  }

  async adoptSite(input: {
    siteName: string;
    eventId?: string;
    username?: string;
    baseUrl: string;
    password?: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.adoptSiteUnlocked(input));
  }

  async discoverSites(input: {
    baseUrl: string;
    eventId?: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
  }): Promise<CameraFtpSiteDiscoveryResponse> {
    this.setBaseUrl(input.baseUrl);
    return this.switchLock.runExclusive(async () => {
      const config = getConfig().cameraFtp;
      validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
      const probeConfig: CameraFtpConfig = {
        ...config,
        controlPort: input.controlPort,
        passivePortStart: input.passivePortStart,
        passivePortEnd: input.passivePortEnd
      };
      const event = allowedEvent(input.eventId || config.activeEventId);
      const ftpPath = eventFtpPath(event);
      const system = await this.manager.getStatusElevated({ config: probeConfig, physicalPath: ftpPath });
      const sites = system.conflicts.items
        .filter((item) => item.type === "site" && item.adoptable === true && Boolean(item.siteName))
        .filter((item, index, list) => list.findIndex((candidate) => candidate.siteName === item.siteName) === index);
      safeLog("info", {
        eventId: event.id,
        candidateCount: sites.length,
        siteNames: sites.map((site) => site.siteName)
      }, "管理员权限 IIS FTP 站点检测完成");
      return {
        sites,
        // Reusing the elevated snapshot prevents a successful administrator
        // inspection from immediately regressing to the ordinary partial view.
        status: await this.buildStatus(probeConfig, { systemStatus: system })
      };
    });
  }

  private async adoptSiteUnlocked(input: {
    siteName: string;
    eventId?: string;
    username?: string;
    baseUrl: string;
    password?: string;
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    allowLegacyFirewallRuleUpdate?: boolean;
    allowAclTightening?: boolean;
  }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    const event = allowedEvent(input.eventId || config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    const watcherSnapshot = captureCameraFtpWatcherSnapshot();
    const username = input.username?.trim() || config.username;
    if (input.password) validateCameraFtpCredentials(username, input.password);
    validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
    const adoptionConfig: CameraFtpConfig = {
      ...config,
      username,
      activeEventId: event.id,
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd
    };
    const result = await this.manager.adoptSite({
      config: adoptionConfig,
      physicalPath: ftpPath,
      targetSiteName: input.siteName,
      password: input.password,
      allowLegacyFirewallRuleUpdate: input.allowLegacyFirewallRuleUpdate === true,
      allowAclTightening: input.allowAclTightening === true
    });
    const actualSiteName = result.systemStatus?.site.name || input.siteName.trim();
    const nextConfig: CameraFtpConfig = {
      ...adoptionConfig,
      siteName: actualSiteName,
      managedSiteId: result.systemStatus?.site.id || 0,
      accountManaged: Boolean(input.password) || result.systemStatus?.account.managed === true || config.accountManaged,
      passwordResetRequired: input.password ? false : config.passwordResetRequired
    };
    await this.commitProvisioningNodeState({
      previousConfig: config,
      nextConfig,
      event,
      ftpPath,
      watcherSnapshot,
      rollbackReason: "adopt_site_node_rollback"
    });
    this.lastKnownManagedSiteStarted = result.systemStatus?.site.started ?? this.lastKnownManagedSiteStarted;
    writeOperationLog(event.id, "camera_ftp_iis_site_adopted", {
      site_name: actualSiteName,
      previous_site_name: config.siteName,
      username_changed: username !== config.username,
      control_port: adoptionConfig.controlPort,
      passive_port_start: adoptionConfig.passivePortStart,
      passive_port_end: adoptionConfig.passivePortEnd,
      ...(input.password ? { passwordReset: true } : {}),
      success: true
    });
    return { operation: managerOperation(result, "adopt-site"), status: await this.buildStatus(nextConfig, { systemStatus: result.systemStatus }) };
  }

  async checkPort(input: {
    controlPort: number;
    passivePortStart: number;
    passivePortEnd: number;
    fullInspection?: boolean;
  }): Promise<CameraFtpPortCheckResponse> {
    validateCameraFtpPorts(input.controlPort, input.passivePortStart, input.passivePortEnd);
    const savedConfig = getConfig().cameraFtp;
    const probeConfig: CameraFtpConfig = {
      ...savedConfig,
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd
    };
    const event = savedConfig.activeEventId ? getEventById(savedConfig.activeEventId) : undefined;
    const ftpPath = event && getConfig().repository.path ? eventFtpPath(event) : "";
    const managerInput = { config: probeConfig, physicalPath: ftpPath };
    const system = input.fullInspection
      ? await this.manager.getStatusElevated(managerInput)
      : await this.manager.getStatus(managerInput, { force: true });
    return {
      controlPort: input.controlPort,
      passivePortStart: input.passivePortStart,
      passivePortEnd: input.passivePortEnd,
      inspectionLevel: system.requiresAdmin ? "partial" : "full",
      requiresAdminForFullInspection: system.requiresAdmin,
      port: system.port,
      conflicts: system.conflicts
    };
  }

  async start(input: { baseUrl: string; allowAclTightening?: boolean }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.startUnlocked(input));
  }

  private async startUnlocked(input: { baseUrl: string; allowAclTightening?: boolean }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    assertCameraFtpInitialized(config, { requirePassword: true });
    const event = allowedEvent(config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    const watcherSnapshot = captureCameraFtpWatcherSnapshot();
    const previousLastKnownStarted = this.lastKnownManagedSiteStarted;
    try {
      // Manager start is a full provisioning reconcile, not a blind runtime
      // toggle. Keep the old watcher intact until IIS has passed verification.
      const result = await this.manager.start({ config, physicalPath: ftpPath, allowAclTightening: input.allowAclTightening === true });
      await startCameraFtpWatcher(watcherContext(event, ftpPath, this.baseUrl));
      this.lastKnownManagedSiteStarted = result.systemStatus?.site.started ?? true;
      writeOperationLog(event.id, "camera_ftp_iis_started", { site_name: config.siteName });
      return { operation: managerOperation(result, "start"), status: await this.buildStatus(config, { systemStatus: result.systemStatus }) };
    } catch (error: any) {
      this.lastKnownManagedSiteStarted = previousLastKnownStarted;
      try {
        await restoreCameraFtpWatcherSnapshot(watcherSnapshot, "start_reconcile_rollback");
      } catch (rollbackError: any) {
        throw Object.assign(new Error(`${error?.message || "启动 FTP 失败"}；恢复原 watcher 失败：${rollbackError?.message || "未知错误"}`), {
          code: error?.code || "CAMERA_FTP_NODE_COMMIT_FAILED",
          cause: error,
          diagnostics: {
            ...(error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : {}),
            watcherRollbackAttempted: true,
            watcherRollbackSucceeded: false,
            watcherRollbackError: rollbackError?.message || "恢复原 watcher 失败"
          }
        });
      }
      throw error;
    }
  }

  async stop(): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.stopUnlocked());
  }

  private async stopUnlocked(): Promise<CameraFtpOperationResponse> {
    const config = getConfig().cameraFtp;
    assertCameraFtpInitialized(config);
    const event = allowedEvent(config.activeEventId);
    const ftpPath = eventFtpPath(event);
    const result = await this.manager.stop({ config, physicalPath: ftpPath });
    this.lastKnownManagedSiteStarted = false;
    // The watcher intentionally remains active so already-landed files can
    // finish stability checks and import while IIS is stopped.
    writeOperationLog(event.id, "camera_ftp_iis_stopped", { site_name: config.siteName });
    return { operation: managerOperation(result, "stop"), status: await this.buildStatus(config, { systemStatus: result.systemStatus }) };
  }

  async restart(input: { baseUrl: string; allowAclTightening?: boolean }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.restartUnlocked(input));
  }

  private async restartUnlocked(input: { baseUrl: string; allowAclTightening?: boolean }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    const config = getConfig().cameraFtp;
    assertCameraFtpInitialized(config, { requirePassword: true });
    const event = allowedEvent(config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    const watcherSnapshot = captureCameraFtpWatcherSnapshot();
    const previousLastKnownStarted = this.lastKnownManagedSiteStarted;
    try {
      // Restart uses the same full reconcile transaction as setup/repair and
      // only hands off to the watcher after IIS has been verified healthy.
      const result = await this.manager.restart({ config, physicalPath: ftpPath, allowAclTightening: input.allowAclTightening === true });
      await startCameraFtpWatcher(watcherContext(event, ftpPath, this.baseUrl));
      this.lastKnownManagedSiteStarted = result.systemStatus?.site.started ?? true;
      writeOperationLog(event.id, "camera_ftp_iis_restarted", { site_name: config.siteName });
      return { operation: managerOperation(result, "restart"), status: await this.buildStatus(config, { systemStatus: result.systemStatus }) };
    } catch (error: any) {
      this.lastKnownManagedSiteStarted = previousLastKnownStarted;
      try {
        await restoreCameraFtpWatcherSnapshot(watcherSnapshot, "restart_reconcile_rollback");
      } catch (rollbackError: any) {
        throw Object.assign(new Error(`${error?.message || "重启 FTP 失败"}；恢复原 watcher 失败：${rollbackError?.message || "未知错误"}`), {
          code: error?.code || "CAMERA_FTP_NODE_COMMIT_FAILED",
          cause: error,
          diagnostics: {
            ...(error?.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : {}),
            watcherRollbackAttempted: true,
            watcherRollbackSucceeded: false,
            watcherRollbackError: rollbackError?.message || "恢复原 watcher 失败"
          }
        });
      }
      throw error;
    }
  }

  async updateCredentials(input: {
    username: string;
    password: string;
    baseUrl: string;
  }): Promise<CameraFtpOperationResponse> {
    return this.switchLock.runExclusive(() => this.updateCredentialsUnlocked(input));
  }

  private async updateCredentialsUnlocked(input: {
    username: string;
    password: string;
    baseUrl: string;
  }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    validateCameraFtpCredentials(input.username, input.password);
    const config = getConfig().cameraFtp;
    const event = allowedEvent(config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    const result = await this.manager.updateCredentials({
      config,
      physicalPath: ftpPath,
      username: input.username.trim(),
      password: input.password,
      previousUsername: config.username
    });
    saveConfig({
      cameraFtp: {
        ...config,
        username: input.username.trim(),
        accountManaged: true,
        passwordResetRequired: false
      }
    });
    writeOperationLog(event.id, "camera_ftp_credentials_updated", {
      username_changed: input.username.trim() !== config.username,
      passwordReset: true
    });
    return { operation: managerOperation(result, "credentials"), status: await this.getStatus() };
  }

  async switchActiveEvent(input: { eventId: string; baseUrl: string }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    return this.switchLock.runExclusive(() => this.switchActiveEventUnlocked(input));
  }

  private async switchActiveEventUnlocked(input: { eventId: string; baseUrl: string }): Promise<CameraFtpOperationResponse> {
    const operationId = randomUUID();
    const targetEvent = allowedEvent(input.eventId);
    setPendingCameraFtpEventId(targetEvent.id);
    try {
      const config = getConfig().cameraFtp;
      let targetPath = "";
      let nextConfig: CameraFtpConfig = { ...config, activeEventId: targetEvent.id };

      if (config.activeEventId === targetEvent.id) {
        targetPath = await this.prepareEventDirectory(targetEvent);
        assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus());
        await startCameraFtpWatcher(watcherContext(targetEvent, targetPath, this.baseUrl));
        return {
          operation: { ...simpleOperation("active-event", "当前活动已是 FTP 接收活动。"), operationId },
          status: await this.getStatus()
        };
      }

      interface SwitchSnapshot {
        config: CameraFtpConfig;
        watcher: CameraFtpWatcherSnapshot;
        system: IisFtpSystemStatus;
        oldPhysicalPath: string;
        oldSiteStarted: boolean;
      }

      const transaction = await runCameraFtpEventSwitchTransaction<SwitchSnapshot, IisFtpSystemStatus>({
        operationId,
        fromEventId: config.activeEventId,
        toEventId: targetEvent.id,
        validateTargetEvent: () => { allowedEvent(targetEvent.id); },
        checkPendingUploads: () => { assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus()); },
        snapshotCurrentState: async () => {
          const watcherSnapshot = captureCameraFtpWatcherSnapshot();
          const oldEvent = allowedEvent(config.activeEventId);
          const fallbackPath = watcherSnapshot.context?.directory || eventFtpPath(oldEvent);
          let system = await this.manager.getStatus({ config, physicalPath: fallbackPath }, { force: true });
          if (requiresElevatedCameraFtpSiteStateInspection(system)) {
            system = await this.manager.getStatusElevated({ config, physicalPath: fallbackPath });
          }
          if (system.site.exists !== true || system.site.managed !== true || system.site.id !== config.managedSiteId) {
            throw Object.assign(new Error("当前工作台托管 IIS FTP 站点身份无法确认，未执行活动切换。"), {
              code: "MANAGED_SITE_ID_MISMATCH",
              diagnostics: { stage: "snapshot_current_state", details: { expectedSiteId: config.managedSiteId, actualSite: system.site } }
            });
          }
          if (typeof system.site.started !== "boolean" || !system.site.physicalPath) {
            throw Object.assign(new Error("无法取得托管 IIS FTP 站点的准确运行状态或 physicalPath，未执行活动切换。"), {
              code: "FTP_EVENT_SWITCH_FAILED",
              diagnostics: { stage: "snapshot_current_state", details: { actualSite: system.site } }
            });
          }
          return {
            config,
            watcher: watcherSnapshot,
            system,
            oldPhysicalPath: system.site.physicalPath || fallbackPath,
            oldSiteStarted: system.site.started === true
          };
        },
        prepareTargetDirectory: async () => {
          targetPath = await this.prepareEventDirectory(targetEvent);
        },
        updateIisPhysicalPath: async (snapshot) => {
          assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus());
          if (sameWindowsPath(snapshot.oldPhysicalPath, targetPath)) return snapshot.system;
          let action: IisFtpActionResult;
          try {
            action = await this.manager.setPhysicalPath({ config, physicalPath: targetPath });
          } catch (error: any) {
            safeLog("error", {
              operationId,
              childOperationId: error?.diagnostics?.operationId,
              operation: "active-event",
              stage: error?.diagnostics?.stage || "update_iis_physical_path",
              code: error?.code || "FTP_PHYSICAL_PATH_UPDATE_FAILED"
            }, "相机 FTP 活动切换的 IIS 子事务失败");
            throw error;
          }
          safeLog("info", {
            operationId,
            childOperationId: action.operationId,
            operation: "active-event",
            stage: "update_iis_physical_path",
            steps: action.steps.map((step) => ({ name: step.name, status: step.status }))
          }, "相机 FTP 活动切换的 IIS 子事务完成");
          if (!action.systemStatus) {
            throw Object.assign(new Error("管理员脚本未返回切换后的完整 IIS 状态。"), {
              code: "FTP_SWITCH_VERIFY_FAILED",
              diagnostics: { stage: "verify_switched_state" }
            });
          }
          return action.systemStatus;
        },
        switchWatcher: async () => {
          assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus());
          if (getCameraFtpWatcherStatus().running || getCameraFtpWatcher().getContext()) {
            stopCameraFtpWatcher({ force: true, reason: "active_event_switch" });
          }
          await startCameraFtpWatcher({
            ...watcherContext(targetEvent, targetPath, this.baseUrl),
            scanExistingOnStart: false
          });
        },
        verifySwitchedState: (snapshot, system) => {
          allowedEvent(targetEvent.id);
          verifySwitchedSite(system, {
            path: targetPath,
            started: snapshot.oldSiteStarted,
            managedSiteId: config.managedSiteId,
            eventId: targetEvent.id,
            watcher: getCameraFtpWatcherStatus()
          });
        },
        commitActiveEvent: () => {
          allowedEvent(targetEvent.id);
          nextConfig = { ...config, activeEventId: targetEvent.id };
          saveConfig({ cameraFtp: nextConfig });
          const saved = getConfig().cameraFtp;
          if (saved.activeEventId !== targetEvent.id || saved.managedSiteId !== config.managedSiteId) {
            throw Object.assign(new Error("工作台未能提交新的 FTP 接收活动。"), {
              code: "FTP_ACTIVE_EVENT_STATE_MISMATCH",
              diagnostics: {
                stage: "commit_active_event",
                details: { expectedEventId: targetEvent.id, actualEventId: saved.activeEventId, expectedSiteId: config.managedSiteId, actualSiteId: saved.managedSiteId }
              }
            });
          }
        },
        rollbackSystem: async (snapshot) => {
          if (sameWindowsPath(targetPath, snapshot.oldPhysicalPath)) return snapshot.system;
          const action = await this.manager.setPhysicalPath({ config: snapshot.config, physicalPath: snapshot.oldPhysicalPath });
          safeLog("info", {
            operationId,
            childOperationId: action.operationId,
            operation: "active-event",
            stage: "rollback_physical_path",
            steps: action.steps.map((step) => ({ name: step.name, status: step.status }))
          }, "相机 FTP 活动切换的 IIS 回滚子事务完成");
          if (!action.systemStatus) throw Object.assign(new Error("恢复 IIS physicalPath 后未取得完整状态。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          if (!sameWindowsPath(action.systemStatus.site.physicalPath, snapshot.oldPhysicalPath)) {
            throw Object.assign(new Error("IIS physicalPath 未恢复到原活动。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
          if (action.systemStatus.site.started !== snapshot.oldSiteStarted) {
            throw Object.assign(new Error("IIS 站点运行状态未恢复。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
          return action.systemStatus;
        },
        rollbackWatcher: (snapshot) => restoreCameraFtpWatcherSnapshot(snapshot.watcher, "active_event_switch_rollback"),
        rollbackActiveEvent: (snapshot) => { saveConfig({ cameraFtp: snapshot.config }); },
        verifyRollback: (snapshot, rollbackSystem) => {
          const saved = getConfig().cameraFtp;
          if (saved.activeEventId !== snapshot.config.activeEventId) {
            throw Object.assign(new Error("activeEventId 未恢复到原活动。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
          const watcher = getCameraFtpWatcherStatus();
          if (snapshot.watcher.running
            && (!watcher.running
              || watcher.eventId !== snapshot.watcher.context?.eventId
              || !sameWindowsPath(watcher.directory, snapshot.watcher.context?.directory || ""))) {
            throw Object.assign(new Error("watcher 未恢复到原活动目录。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
          if (!snapshot.watcher.running && (watcher.running || getCameraFtpWatcher().getContext())) {
            throw Object.assign(new Error("原 watcher 为停止状态，但回滚后仍存在活动监听。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
          const system = rollbackSystem || snapshot.system;
          if (!sameWindowsPath(system.site.physicalPath, snapshot.oldPhysicalPath) || system.site.started !== snapshot.oldSiteStarted) {
            throw Object.assign(new Error("IIS 站点路径或运行状态未恢复。"), { code: "FTP_SWITCH_ROLLBACK_FAILED" });
          }
        },
        onStage: (entry) => {
          safeLog(entry.status === "failed" ? "error" : "info", {
            operationId,
            operation: "active-event",
            stage: entry.stage,
            status: entry.status,
            ...(entry.code ? { code: entry.code } : {}),
            fromEventId: config.activeEventId,
            toEventId: targetEvent.id
          }, `相机 FTP 活动切换阶段：${entry.stage}`);
        }
      });

      this.lastKnownManagedSiteStarted = transaction.systemStatus.site.started;
      const responseStatus = await this.buildStatus(nextConfig, { systemStatus: transaction.systemStatus });
      writeOperationLog(targetEvent.id, "camera_ftp_active_event_changed", {
        operation_id: operationId,
        from_event_id: config.activeEventId,
        to_event_id: targetEvent.id,
        ftp_path: targetPath,
        site_started: transaction.systemStatus.site.started
      });
      void scanCameraFtpWatcher().catch((scanError) => {
        safeLog("error", { error: scanError, operationId, eventId: targetEvent.id }, "切换活动后扫描相机 FTP 目录失败");
      });
      return {
        // The parent operation keeps Node and PowerShell stages under one ID.
        operation: {
          operationId,
          action: "active-event",
          status: "success",
          message: `已切换 FTP 接收活动为“${targetEvent.name}”。`,
          steps: transaction.completedStages.map((stage, index) => ({
            id: `active-event-${index + 1}`,
            label: ({
              validate_target_event: "校验目标活动",
              check_pending_uploads: "检查上传与导入任务",
              snapshot_current_state: "记录切换前状态",
              prepare_target_directory: "准备目标接收目录",
              update_iis_physical_path: "切换 IIS 接收目录",
              switch_watcher: "切换文件监听",
              verify_switched_state: "验证切换结果",
              commit_active_event: "提交 FTP 接收活动"
            } satisfies Record<CameraFtpSwitchStage, string>)[stage],
            status: "success"
          })),
          requiresAdmin: true
        },
        status: responseStatus
      };
    } catch (error: any) {
      safeLog("error", {
        operationId,
        operation: "active-event",
        code: error?.code || "FTP_EVENT_SWITCH_FAILED",
        stage: error?.diagnostics?.stage || "unknown",
        fromEventId: getConfig().cameraFtp.activeEventId,
        toEventId: targetEvent.id,
        rollback: error?.diagnostics?.data?.rollback
      }, "相机 FTP 活动切换失败");
      throw error;
    } finally {
      clearPendingCameraFtpEventId(targetEvent.id);
    }
  }

  async clearActiveEvent(input: { baseUrl: string }): Promise<CameraFtpOperationResponse> {
    this.setBaseUrl(input.baseUrl);
    return this.switchLock.runExclusive(async () => {
      const config = getConfig().cameraFtp;
      if (!config.activeEventId) {
        return {
          operation: simpleOperation("active-event", "当前没有关联 FTP 接收活动。"),
          status: await this.getStatus()
        };
      }

      const watcherStatus = getCameraFtpWatcherStatus();
      const oldEvent = getEventById(config.activeEventId);
      const oldWatcherContext = getCameraFtpWatcher().getContext();
      const physicalPath = oldWatcherContext?.directory
        || (oldEvent && getConfig().repository.path ? eventFtpPath(oldEvent) : "");
      let systemStatus = await this.manager.getStatus({ config, physicalPath }, { force: true });
      // lastKnownManagedSiteStarted is a display hint only. Destructive unlink
      // authorization must be based on a fresh raw IIS snapshot.
      if (requiresElevatedCameraFtpSiteStateInspection(systemStatus)) {
        systemStatus = await this.manager.getStatusElevated({ config, physicalPath });
      }
      assertCameraFtpUnlinkAllowed(watcherStatus, systemStatus.site);
      let watcherStopped = false;
      try {
        assertCameraFtpSwitchAllowed(getCameraFtpWatcherStatus());
        if (getCameraFtpWatcherStatus().running) {
          stopCameraFtpWatcher({ reason: "active_event_unlink" });
          watcherStopped = true;
        }

        const nextConfig: CameraFtpConfig = { ...config, activeEventId: "" };
        const responseStatus = await this.buildStatus(nextConfig, { forceSystemRefresh: true });
        saveConfig({ cameraFtp: nextConfig });
        if (oldEvent) {
          writeOperationLog(oldEvent.id, "camera_ftp_active_event_unlinked", {
            from_event_id: oldEvent.id,
            ftp_path: physicalPath,
            service_was_already_stopped: true
          });
        }
        return {
          operation: simpleOperation("active-event", "已解除 FTP 接收活动关联；FTP 站点保持停止，原目录和文件均已保留。"),
          status: responseStatus
        };
      } catch (error) {
        const rollbackErrors: string[] = [];
        if (watcherStopped && oldWatcherContext) {
          try {
            await startCameraFtpWatcher(oldWatcherContext);
          } catch (rollbackError: any) {
            rollbackErrors.push(rollbackError?.message || "恢复旧 watcher 失败");
          }
        }
        if (rollbackErrors.length > 0) {
          throw Object.assign(new Error(`${(error as any)?.message || "解除 FTP 活动关联失败"}；部分回滚失败：${rollbackErrors[0]}`), {
            code: (error as any)?.code || "IIS_CONFIG_FAILED"
          });
        }
        throw error;
      }
    });
  }

  async openFolder(): Promise<CameraFtpOperationResponse> {
    const config = getConfig().cameraFtp;
    const event = allowedEvent(config.activeEventId);
    const ftpPath = await this.prepareEventDirectory(event);
    if (process.platform !== "win32") {
      throw Object.assign(new Error("打开文件夹仅支持 Windows。"), { code: "UNSUPPORTED_PLATFORM" });
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn("explorer.exe", [ftpPath], { detached: true, windowsHide: true, stdio: "ignore" });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("error", (error) => reject(Object.assign(error, { code: "FTP_PATH_INVALID" })));
    });
    return {
      operation: simpleOperation("open-folder", "已打开当前活动的 FTP 接收目录。"),
      status: await this.getStatus(),
      path: ftpPath
    };
  }

  shutdown(): void {
    shutdownCameraFtpWatcher();
  }

  private async prepareEventDirectory(event: EventRow): Promise<string> {
    ensureEventWorkingDirs(event.slug);
    const ftpPath = eventFtpPath(event);
    try {
      await fs.ensureDir(ftpPath);
    } catch (error: any) {
      throw Object.assign(new Error(error?.message || "无法创建活动 FTP 接收目录。"), {
        code: "FTP_PATH_CREATE_FAILED"
      });
    }
    return ftpPath;
  }
}

const cameraFtpOrchestrator = new CameraFtpOrchestrator();

export function getCameraFtpOrchestrator(): CameraFtpOrchestrator {
  return cameraFtpOrchestrator;
}

export async function restoreCameraFtpWatcher(input: { baseUrl: string }): Promise<CameraFtpWatcherStatus> {
  return cameraFtpOrchestrator.restoreWatcher(input);
}

export function shutdownCameraFtpOrchestrator(): void {
  cameraFtpOrchestrator.shutdown();
}
