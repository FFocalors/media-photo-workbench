import fs from "fs-extra";
import crypto from "crypto";
import path from "path";
import { getLogger } from "../utils/logger";

export interface AppConfig {
  server: {
    port: number;
  };
  repository: {
    path: string;
  };
  database: {
    path: string;
    autoBackupEnabled: boolean;
    lastAutoBackupAt: string;
    autoBackupRetention: number;
  };
  gallery: {
    batchSelectionBehavior: BatchSelectionBehavior;
  };
  cameraFtp: CameraFtpConfig;
}

export type BatchSelectionBehavior = "clear" | "keep";

export interface CameraFtpConfig {
  provider: "iis";
  siteName: string;
  managedSiteId: number;
  username: string;
  accountManaged: boolean;
  activeEventId: string;
  controlPort: number;
  passivePortStart: number;
  passivePortEnd: number;
  firewallControlRuleName: string;
  firewallPassiveRuleName: string;
  passwordResetRequired: boolean;
}

export const DEFAULT_CAMERA_FTP_PROVIDER = "iis" as const;
export const DEFAULT_CAMERA_FTP_SITE_NAME = "MediaPhotoWorkbenchFTP";
export const DEFAULT_CAMERA_FTP_USERNAME = "camera";
export const DEFAULT_CAMERA_FTP_PORT = 21 as const;
export const DEFAULT_CAMERA_FTP_PASV_MIN = 50000 as const;
export const DEFAULT_CAMERA_FTP_PASV_MAX = 50100 as const;
export const DEFAULT_CAMERA_FTP_CONTROL_FIREWALL_RULE = "Media Photo Workbench - FTP Control";
export const DEFAULT_CAMERA_FTP_PASSIVE_FIREWALL_RULE = "Media Photo Workbench - FTP Passive";

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 3030
  },
  repository: {
    path: ""
  },
  database: {
    path: "",
    autoBackupEnabled: true,
    lastAutoBackupAt: "",
    autoBackupRetention: 10
  },
  gallery: {
    batchSelectionBehavior: "clear"
  },
  cameraFtp: {
    provider: DEFAULT_CAMERA_FTP_PROVIDER,
    siteName: DEFAULT_CAMERA_FTP_SITE_NAME,
    managedSiteId: 0,
    username: DEFAULT_CAMERA_FTP_USERNAME,
    accountManaged: false,
    activeEventId: "",
    controlPort: DEFAULT_CAMERA_FTP_PORT,
    passivePortStart: DEFAULT_CAMERA_FTP_PASV_MIN,
    passivePortEnd: DEFAULT_CAMERA_FTP_PASV_MAX,
    firewallControlRuleName: DEFAULT_CAMERA_FTP_CONTROL_FIREWALL_RULE,
    firewallPassiveRuleName: DEFAULT_CAMERA_FTP_PASSIVE_FIREWALL_RULE,
    passwordResetRequired: false
  }
};

let _configDir = "";
let _config: AppConfig = createDefaultConfig();

function writeConfigAtomic(configPath: string, value: AppConfig): void {
  const tempPath = `${configPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.ensureDirSync(path.dirname(configPath));
    fs.writeJsonSync(tempPath, value, { spaces: 2 });
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    try {
      fs.removeSync(tempPath);
    } catch {
      // Preserve the original config if the atomic replacement cannot finish.
    }
    throw error;
  }
}

function createDefaultConfig(): AppConfig {
  return {
    server: { ...DEFAULT_CONFIG.server },
    repository: { ...DEFAULT_CONFIG.repository },
    database: { ...DEFAULT_CONFIG.database },
    gallery: {
      batchSelectionBehavior: DEFAULT_CONFIG.gallery.batchSelectionBehavior
    },
    cameraFtp: normalizeCameraFtpConfig(DEFAULT_CONFIG.cameraFtp)
  };
}

function normalizePreferredPort(port: unknown): number {
  const parsedPort = Number(port);
  if (parsedPort === DEFAULT_CONFIG.server.port) {
    return DEFAULT_CONFIG.server.port;
  }

  // v0.13 之前曾把端口冲突后的实际端口写回 config.json。
  // 当前第一版没有真实的端口设置保存入口，因此配置中的首选端口固定回 3030；
  // 启动时如被占用仍会临时顺延到 3031-3040，但不会再污染配置。
  return DEFAULT_CONFIG.server.port;
}

function normalizeAutoBackupRetention(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.database.autoBackupRetention;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function normalizeBatchSelectionBehavior(value: unknown): BatchSelectionBehavior {
  return value === "keep" ? "keep" : "clear";
}

export function normalizeCameraFtpConfig(raw: any): CameraFtpConfig {
  const legacyPasswordDetected = typeof raw?.password === "string" && raw.password.length > 0;
  const rawControlPort = Number(raw?.controlPort);
  const rawPassiveStart = Number(raw?.passivePortStart);
  const rawPassiveEnd = Number(raw?.passivePortEnd);
  const validPort = (value: number) => Number.isInteger(value) && value >= 1 && value <= 65535;
  let controlPort = validPort(rawControlPort) ? rawControlPort : DEFAULT_CAMERA_FTP_PORT;
  let passivePortStart = validPort(rawPassiveStart) ? rawPassiveStart : DEFAULT_CAMERA_FTP_PASV_MIN;
  let passivePortEnd = validPort(rawPassiveEnd) ? rawPassiveEnd : DEFAULT_CAMERA_FTP_PASV_MAX;
  if (passivePortStart > passivePortEnd) {
    passivePortStart = DEFAULT_CAMERA_FTP_PASV_MIN;
    passivePortEnd = DEFAULT_CAMERA_FTP_PASV_MAX;
  }
  if (controlPort >= passivePortStart && controlPort <= passivePortEnd) {
    // A valid custom control port is user-owned configuration and must never
    // be silently migrated back to 21. API writes reject overlaps before they
    // reach disk; this fallback only repairs a legacy or manually damaged
    // passive range while preserving the chosen control port.
    passivePortStart = DEFAULT_CAMERA_FTP_PASV_MIN;
    passivePortEnd = DEFAULT_CAMERA_FTP_PASV_MAX;
    if (controlPort >= passivePortStart && controlPort <= passivePortEnd) {
      const passiveRangeSize = DEFAULT_CAMERA_FTP_PASV_MAX - DEFAULT_CAMERA_FTP_PASV_MIN;
      passivePortStart = DEFAULT_CAMERA_FTP_PASV_MAX + 1;
      passivePortEnd = passivePortStart + passiveRangeSize;
    }
  }
  return {
    provider: DEFAULT_CAMERA_FTP_PROVIDER,
    siteName: typeof raw?.siteName === "string" && raw.siteName.trim()
      ? raw.siteName.trim().slice(0, 120)
      : DEFAULT_CONFIG.cameraFtp.siteName,
    managedSiteId: Number.isInteger(Number(raw?.managedSiteId)) && Number(raw?.managedSiteId) > 0
      ? Number(raw.managedSiteId)
      : 0,
    username: typeof raw?.username === "string" && raw.username.trim()
      ? raw.username.trim().slice(0, 80)
      : DEFAULT_CONFIG.cameraFtp.username,
    accountManaged: raw?.accountManaged === true,
    activeEventId: typeof raw?.activeEventId === "string"
      ? raw.activeEventId.trim()
      : (typeof raw?.eventId === "string" ? raw.eventId.trim() : ""),
    controlPort,
    passivePortStart,
    passivePortEnd,
    firewallControlRuleName: typeof raw?.firewallControlRuleName === "string" && raw.firewallControlRuleName.trim()
      ? raw.firewallControlRuleName.trim().slice(0, 160)
      : DEFAULT_CONFIG.cameraFtp.firewallControlRuleName,
    firewallPassiveRuleName: typeof raw?.firewallPassiveRuleName === "string" && raw.firewallPassiveRuleName.trim()
      ? raw.firewallPassiveRuleName.trim().slice(0, 160)
      : DEFAULT_CONFIG.cameraFtp.firewallPassiveRuleName,
    passwordResetRequired: legacyPasswordDetected || raw?.passwordResetRequired === true
  };
}

function normalizeConfig(raw: any): AppConfig {
  return {
    server: {
      port: normalizePreferredPort(raw?.server?.port)
    },
    repository: {
      path: raw?.repository?.path ?? DEFAULT_CONFIG.repository.path
    },
    database: {
      path: typeof raw?.database?.path === "string" ? raw.database.path : DEFAULT_CONFIG.database.path,
      autoBackupEnabled: typeof raw?.database?.autoBackupEnabled === "boolean"
        ? raw.database.autoBackupEnabled
        : DEFAULT_CONFIG.database.autoBackupEnabled,
      lastAutoBackupAt: typeof raw?.database?.lastAutoBackupAt === "string"
        ? raw.database.lastAutoBackupAt
        : DEFAULT_CONFIG.database.lastAutoBackupAt,
      autoBackupRetention: normalizeAutoBackupRetention(raw?.database?.autoBackupRetention)
    },
    gallery: {
      batchSelectionBehavior: normalizeBatchSelectionBehavior(raw?.gallery?.batchSelectionBehavior)
    },
    cameraFtp: normalizeCameraFtpConfig(raw?.cameraFtp)
  };
}

/**
 * 加载配置文件。如果不存在则创建默认配置。
 */
export function loadConfig(configDir: string): AppConfig {
  _configDir = configDir;
  const configPath = path.join(configDir, "config.json");
  const logger = getLogger();

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readJsonSync(configPath);
      const normalized = normalizeConfig(raw);
      const normalizedNeedsWrite = JSON.stringify(raw) !== JSON.stringify(normalized);
      if (normalizedNeedsWrite) {
        writeConfigAtomic(configPath, normalized);
        logger.info({
          configPath,
          preferredPort: normalized.server.port,
          cameraFtpProvider: normalized.cameraFtp.provider,
          legacySecretRemoved: typeof raw?.cameraFtp?.password === "string"
        }, "配置已安全迁移");
      }
      _config = normalized;
      logger.info({ configPath }, "配置文件已加载");
    } catch (err) {
      logger.warn({ err, configPath }, "配置文件读取失败，使用默认配置");
      _config = createDefaultConfig();
    }
  } else {
    const initialConfig = createDefaultConfig();
    writeConfigAtomic(configPath, initialConfig);
    _config = initialConfig;
    logger.info({ configPath }, "配置文件不存在，已创建默认配置");
  }

  return _config;
}

/**
 * 获取当前配置。
 */
export function getConfig(): AppConfig {
  return _config;
}

/**
 * 更新配置并写入文件。
 * 接收一个 partial 对象，与当前配置合并后保存。
 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const logger = getLogger();
  const configPath = path.join(_configDir, "config.json");
  const nextConfig: AppConfig = {
    server: patch.server ? { ..._config.server, ...patch.server } : { ..._config.server },
    repository: patch.repository ? { ..._config.repository, ...patch.repository } : { ..._config.repository },
    database: patch.database
      ? {
        ..._config.database,
        ...patch.database,
        autoBackupRetention: normalizeAutoBackupRetention(
          patch.database.autoBackupRetention ?? _config.database.autoBackupRetention
        )
      }
      : { ..._config.database },
    gallery: patch.gallery
      ? {
        batchSelectionBehavior: normalizeBatchSelectionBehavior(
          patch.gallery.batchSelectionBehavior ?? _config.gallery.batchSelectionBehavior
        )
      }
      : { ..._config.gallery },
    cameraFtp: patch.cameraFtp
      ? normalizeCameraFtpConfig({ ..._config.cameraFtp, ...patch.cameraFtp })
      : normalizeCameraFtpConfig(_config.cameraFtp)
  };
  try {
    writeConfigAtomic(configPath, nextConfig);
    _config = nextConfig;
    logger.info({ configPath }, "配置文件已保存");
  } catch (err) {
    logger.error({ err, configPath }, "配置文件保存失败");
    throw err;
  }

  return _config;
}
