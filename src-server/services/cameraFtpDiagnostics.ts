import os from "os";
import type { CameraFtpConfig } from "../config/config";
import type { CameraFtpStatus } from "./cameraFtpOrchestrator";

export interface CameraFtpOperationSummary {
  operationId: string;
  errorCode: string | null;
  completedAt: string;
}

export interface CameraFtpDiagnosticSnapshot {
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
    inspectionLevel: CameraFtpStatus["inspectionLevel"];
    inspectionOutcome: CameraFtpStatus["inspectionOutcome"];
    inspectionSource: CameraFtpStatus["inspectionSource"];
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

let lastCameraFtpOperation: CameraFtpOperationSummary | null = null;

export function recordCameraFtpOperation(operationId: string, errorCode: string | null): void {
  if (!operationId) return;
  lastCameraFtpOperation = {
    operationId,
    errorCode,
    completedAt: new Date().toISOString()
  };
}

export function getLastCameraFtpOperation(): CameraFtpOperationSummary | null {
  return lastCameraFtpOperation ? { ...lastCameraFtpOperation } : null;
}

/**
 * Builds an allow-listed snapshot. Deliberately absent are passwords, account
 * details, image/FTP paths, recent filenames, PowerShell temp files and
 * information about IIS sites not managed by this application.
 */
export function buildCameraFtpDiagnosticSnapshot(input: {
  config: CameraFtpConfig;
  status: CameraFtpStatus;
  requestOperationId: string;
  lastOperation?: CameraFtpOperationSummary | null;
  now?: Date;
  platform?: { os: string; arch: string; release: string; version: string };
}): CameraFtpDiagnosticSnapshot {
  const { config, status } = input;
  const lastOperation = input.lastOperation ?? null;
  return {
    generatedAt: (input.now || new Date()).toISOString(),
    operationId: lastOperation?.operationId || input.requestOperationId,
    diagnosticRequestOperationId: input.requestOperationId,
    platform: input.platform || {
      os: process.platform,
      arch: process.arch,
      release: os.release(),
      version: os.version()
    },
    ftp: {
      provider: "iis",
      siteName: config.siteName,
      managedSiteId: config.managedSiteId > 0 ? config.managedSiteId : null,
      accountManaged: config.accountManaged,
      controlPort: config.controlPort,
      passivePortStart: config.passivePortStart,
      passivePortEnd: config.passivePortEnd,
      activeEvent: status.activeEvent
        ? { id: status.activeEvent.id, name: status.activeEvent.name }
        : config.activeEventId
          ? { id: config.activeEventId, name: "活动记录不可用" }
          : null,
      inspectionLevel: status.inspectionLevel,
      inspectionOutcome: status.inspectionOutcome,
      inspectionSource: status.inspectionSource,
      initialized: status.initialized,
      requiresAdmin: status.requiresAdmin,
      watcher: {
        running: status.watcher.running,
        busy: status.watcher.busy,
        eventId: status.watcher.eventId,
        pendingCount: status.watcher.pendingCount,
        queuedCount: status.watcher.queuedCount,
        importingCount: status.watcher.importingCount,
        unstableCount: status.watcher.unstableCount,
        lastScanAt: status.watcher.lastScanAt
      },
      lastErrorCode: status.lastError?.code || lastOperation?.errorCode || null
    }
  };
}
