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
