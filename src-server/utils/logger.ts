import pino from "pino";
import path from "path";
import fs from "fs-extra";
import { getCurrentOperationId } from "./operationContext";

let _logger: pino.Logger | null = null;
let activeLogFilePath: string | null = null;
let shuttingDown = false;

export type SafeLogLevel = "debug" | "info" | "warn" | "error";

export const DEFAULT_SERVER_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SERVER_LOG_RETENTION = 10;

const ACTIVE_LOG_FILE_NAME = "server.log";
const MANAGED_HISTORICAL_LOG_PATTERN = /^server\.(\d{8}T\d{6}\.\d{3}Z)(?:-(\d+))?\.log$/;

export interface ServerLogRotationOptions {
  maxBytes?: number;
  retention?: number;
  now?: () => Date;
}

export interface ServerLogRotationWarning {
  code: "ACTIVE_LOG_STAT_FAILED" | "ACTIVE_LOG_ROTATION_FAILED" | "HISTORICAL_LOG_LIST_FAILED" | "HISTORICAL_LOG_PRUNE_FAILED";
  fileName: string;
}

export interface ServerLogRotationResult {
  activeLogPath: string;
  rotated: boolean;
  rotatedLogPath?: string;
  prunedLogPaths: string[];
  skippedReason?: "active_log_open" | "missing" | "below_threshold" | "not_regular_file" | "rotation_failed";
  warnings: ServerLogRotationWarning[];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function rotationTimestamp(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return safeDate.toISOString()
    .replace(/-/g, "")
    .replace(/:/g, "");
}

function nextHistoricalLogPath(logsDir: string, timestamp: string): string {
  let suffix = 0;
  while (true) {
    const fileName = `server.${timestamp}${suffix === 0 ? "" : `-${suffix}`}.log`;
    const candidate = path.join(logsDir, fileName);
    if (!fs.existsSync(candidate)) return candidate;
    suffix += 1;
  }
}

function managedHistoricalLogs(logsDir: string, warnings: ServerLogRotationWarning[]): string[] {
  try {
    return fs.readdirSync(logsDir, { withFileTypes: true })
      .map((entry) => ({ entry, match: MANAGED_HISTORICAL_LOG_PATTERN.exec(entry.name) }))
      .filter((item): item is { entry: fs.Dirent; match: RegExpExecArray } => item.entry.isFile() && Boolean(item.match))
      .sort((left, right) => {
        const timestampOrder = right.match[1].localeCompare(left.match[1]);
        return timestampOrder || Number(right.match[2] || 0) - Number(left.match[2] || 0);
      })
      .map(({ entry }) => path.join(logsDir, entry.name));
  } catch {
    warnings.push({ code: "HISTORICAL_LOG_LIST_FAILED", fileName: "" });
    return [];
  }
}

/**
 * Rotates an oversized server.log before pino opens it, then keeps only the
 * newest managed historical logs. It never reads log contents and never
 * includes arbitrary filesystem errors in its result.
 */
export function rotateServerLogsBeforeOpen(
  logsDir: string,
  options: ServerLogRotationOptions = {}
): ServerLogRotationResult {
  fs.ensureDirSync(logsDir);
  const activePath = path.resolve(logsDir, ACTIVE_LOG_FILE_NAME);
  const warnings: ServerLogRotationWarning[] = [];
  const result: ServerLogRotationResult = {
    activeLogPath: activePath,
    rotated: false,
    prunedLogPaths: [],
    warnings
  };

  // initLogger may only be called once per process. If a caller invokes the
  // helper afterwards, never rename or delete the file currently held by pino.
  if (activeLogFilePath && path.resolve(activeLogFilePath) === activePath) {
    result.skippedReason = "active_log_open";
    return result;
  }

  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_SERVER_LOG_MAX_BYTES);
  const retention = nonNegativeInteger(options.retention, DEFAULT_SERVER_LOG_RETENTION);
  let activeStat: fs.Stats | null = null;
  try {
    activeStat = fs.lstatSync(activePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      warnings.push({ code: "ACTIVE_LOG_STAT_FAILED", fileName: ACTIVE_LOG_FILE_NAME });
    }
  }

  if (!activeStat) {
    result.skippedReason = "missing";
  } else if (!activeStat.isFile() || activeStat.isSymbolicLink()) {
    result.skippedReason = "not_regular_file";
  } else if (activeStat.size < maxBytes) {
    result.skippedReason = "below_threshold";
  } else {
    const rotatedPath = nextHistoricalLogPath(logsDir, rotationTimestamp((options.now || (() => new Date()))()));
    try {
      fs.renameSync(activePath, rotatedPath);
      result.rotated = true;
      result.rotatedLogPath = rotatedPath;
    } catch {
      warnings.push({ code: "ACTIVE_LOG_ROTATION_FAILED", fileName: ACTIVE_LOG_FILE_NAME });
      result.skippedReason = "rotation_failed";
    }
  }

  const historical = managedHistoricalLogs(logsDir, warnings);
  for (const historicalPath of historical.slice(retention)) {
    try {
      fs.unlinkSync(historicalPath);
      result.prunedLogPaths.push(historicalPath);
    } catch {
      warnings.push({ code: "HISTORICAL_LOG_PRUNE_FAILED", fileName: path.basename(historicalPath) });
    }
  }
  return result;
}

/**
 * 初始化全局 logger。
 * 开发环境输出到控制台（pino-pretty），同时写入日志文件。
 */
export function initLogger(logsDir: string): pino.Logger {
  fs.ensureDirSync(logsDir);
  shuttingDown = false;

  if (_logger && activeLogFilePath) return _logger;

  const { activeLogPath: logFilePath } = rotateServerLogsBeforeOpen(logsDir);

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:yyyy-mm-dd HH:MM:ss" },
      level: "debug"
    },
    {
      target: "pino/file",
      options: { destination: logFilePath, mkdir: true },
      level: "info"
    }
  ];

  _logger = pino({
    level: "debug",
    transport: { targets }
  });
  activeLogFilePath = logFilePath;

  return _logger;
}

/**
 * 获取已初始化的 logger 实例。
 * 若未初始化则返回一个默认的控制台 logger。
 */
export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({ level: "debug" });
  }
  return _logger;
}

export function setLoggerShuttingDown(value = true): void {
  shuttingDown = value;
}

export function isLoggerShuttingDown(): boolean {
  return shuttingDown;
}

export function safeLog(level: SafeLogLevel, objOrMessage?: unknown, message?: string): void {
  if (shuttingDown) return;
  try {
    const logger = getLogger();
    const log = logger[level].bind(logger);
    const requestOperationId = getCurrentOperationId();
    let contextualValue = objOrMessage;
    if (requestOperationId && objOrMessage instanceof Error) {
      contextualValue = { operationId: requestOperationId, error: objOrMessage };
    } else if (requestOperationId && objOrMessage && typeof objOrMessage === "object" && !Array.isArray(objOrMessage)) {
      const record = objOrMessage as Record<string, unknown>;
      contextualValue = typeof record.operationId === "string" && record.operationId !== requestOperationId
        ? { ...record, parentOperationId: record.parentOperationId || requestOperationId }
        : { ...record, operationId: requestOperationId };
    }
    if (message !== undefined) {
      log(requestOperationId && (contextualValue === undefined || contextualValue === null)
        ? { operationId: requestOperationId }
        : contextualValue, message);
    } else if (requestOperationId && typeof contextualValue === "string") {
      log({ operationId: requestOperationId }, contextualValue);
    } else {
      log(contextualValue as any);
    }
  } catch {
    // Logging must never crash long-running work, especially while Electron is closing.
  }
}
