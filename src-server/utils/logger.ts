import pino from "pino";
import path from "path";
import fs from "fs-extra";

let _logger: pino.Logger | null = null;
let shuttingDown = false;

export type SafeLogLevel = "debug" | "info" | "warn" | "error";

/**
 * 初始化全局 logger。
 * 开发环境输出到控制台（pino-pretty），同时写入日志文件。
 */
export function initLogger(logsDir: string): pino.Logger {
  fs.ensureDirSync(logsDir);
  shuttingDown = false;

  const logFilePath = path.join(logsDir, "server.log");

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
    if (message !== undefined) {
      log(objOrMessage, message);
    } else {
      log(objOrMessage as any);
    }
  } catch {
    // Logging must never crash long-running work, especially while Electron is closing.
  }
}
