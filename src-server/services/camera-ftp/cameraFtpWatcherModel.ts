import path from "path";
import type { CameraFtpReceiptStore } from "../cameraFtpReceipts";
import type { importImageFiles } from "../imageImport";

export type CameraFtpWatcherRecordStatus =
  | "receiving"
  | "waiting"
  | "importing"
  | "imported"
  | "skipped"
  | "failed";

export interface CameraFtpWatcherRecord {
  id: string;
  filename: string;
  path: string;
  eventId: string;
  eventName: string;
  status: CameraFtpWatcherRecordStatus;
  size: number;
  detectedAt: string;
  receivedAt: string;
  updatedAt: string;
  importedAt: string;
  finishedAt: string;
  taskId: string;
  reason: string;
  error: string;
}

export interface CameraFtpWatcherStatus {
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
  lastScanAt: string;
  lastError: string;
  recentRecords: CameraFtpWatcherRecord[];
}

export interface CameraFtpWatcherContext {
  eventId: string;
  eventName: string;
  eventSlug: string;
  directory: string;
  cameraName: string;
  photographer: string;
  baseUrl: string;
}

export interface CameraFtpWatcherTestingOptions {
  stabilityIntervalMs?: number;
  stabilityChecks?: number;
  importBatchDelayMs?: number;
  maxWaitMs?: number;
  importer?: typeof importImageFiles;
  receiptStore?: CameraFtpReceiptStore;
}

export interface StartCameraFtpWatcherInput extends CameraFtpWatcherContext {
  testing?: CameraFtpWatcherTestingOptions;
  scanExistingOnStart?: boolean;
  createDirectory?: boolean;
}

export interface CameraFtpWatcherPendingFileState {
  generation: number;
  path: string;
  filename: string;
  recordId: string;
  firstSeenAtMs: number;
  lastSize: number;
  lastMtimeMs: number;
  stableChecks: number;
  timer: NodeJS.Timeout | null;
}

export interface CameraFtpWatcherStableFileState {
  path: string;
  filename: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  recordId: string;
}

export interface CameraFtpWatcherRuntimeOptions {
  stabilityIntervalMs: number;
  stabilityChecks: number;
  importBatchDelayMs: number;
  maxWaitMs: number;
  importer: typeof importImageFiles;
  receiptStore: CameraFtpReceiptStore;
}

export interface CameraFtpCandidateClassification {
  accepted: boolean;
  reason: string;
}

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const TEMPORARY_EXTENSIONS = new Set([".tmp", ".part", ".crdownload", ".download"]);

export function normalizeCameraFtpWatcherPath(filePath: string): string {
  return path.resolve(filePath);
}

export function createCameraFtpFileFingerprint(size: number, mtimeMs: number): string {
  return `${size}:${Math.trunc(mtimeMs)}`;
}

export function isSameCameraFtpWatcherContext(
  left: CameraFtpWatcherContext | null,
  right: CameraFtpWatcherContext
): boolean {
  return Boolean(left)
    && left!.eventId === right.eventId
    && normalizeCameraFtpWatcherPath(left!.directory) === normalizeCameraFtpWatcherPath(right.directory);
}

export function isTerminalCameraFtpWatcherRecordStatus(status: CameraFtpWatcherRecordStatus): boolean {
  return status === "imported" || status === "skipped" || status === "failed";
}

function cameraFtpWatcherRecordTimestamp(record: CameraFtpWatcherRecord): number {
  const value = new Date(record.updatedAt || record.finishedAt || record.receivedAt || record.detectedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function coalesceCameraFtpWatcherRecords(records: CameraFtpWatcherRecord[]): CameraFtpWatcherRecord[] {
  const latestByPath = new Map<string, CameraFtpWatcherRecord>();
  for (const record of records) {
    const key = `${record.eventId}\u0000${normalizeCameraFtpWatcherPath(record.path || record.filename).toLowerCase()}`;
    const current = latestByPath.get(key);
    if (!current) {
      latestByPath.set(key, record);
      continue;
    }
    const nextTimestamp = cameraFtpWatcherRecordTimestamp(record);
    const currentTimestamp = cameraFtpWatcherRecordTimestamp(current);
    if (nextTimestamp > currentTimestamp
      || (nextTimestamp === currentTimestamp
        && isTerminalCameraFtpWatcherRecordStatus(record.status)
        && !isTerminalCameraFtpWatcherRecordStatus(current.status))) {
      latestByPath.set(key, record);
    }
  }
  return Array.from(latestByPath.values())
    .sort((left, right) => cameraFtpWatcherRecordTimestamp(right) - cameraFtpWatcherRecordTimestamp(left));
}

export function classifyCameraFtpCandidate(filePath: string): CameraFtpCandidateClassification {
  const filename = path.basename(filePath);
  if (!filename || filename.startsWith(".") || filename.startsWith("~")) {
    return { accepted: false, reason: "隐藏文件" };
  }
  const extension = path.extname(filename).toLowerCase();
  if (TEMPORARY_EXTENSIONS.has(extension)) {
    return { accepted: false, reason: "临时文件" };
  }
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return { accepted: false, reason: "相机 FTP 自动导入仅支持 JPG/JPEG" };
  }
  return { accepted: true, reason: "" };
}
