import fs from "fs-extra";
import crypto from "crypto";
import path from "path";
import { getLogger } from "../utils/logger";

export const CONFIG_SCHEMA_VERSION = 1 as const;

export interface AppConfig {
  schemaVersion: number;
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

export type ConfigFileErrorCode =
  | "CONFIG_NOT_LOADED"
  | "CONFIG_READ_FAILED"
  | "CONFIG_PARSE_FAILED"
  | "CONFIG_SCHEMA_INVALID"
  | "CONFIG_SCHEMA_UNSUPPORTED"
  | "CONFIG_MIGRATION_FAILED"
  | "CONFIG_MIGRATION_WRITE_FAILED"
  | "CONFIG_CREATE_FAILED"
  | "CONFIG_WRITE_FAILED";

export class ConfigFileError extends Error {
  readonly code: ConfigFileErrorCode;
  readonly cause?: unknown;

  constructor(code: ConfigFileErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigFileError";
    this.code = code;
    this.cause = cause;
  }
}

const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
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
let _config: AppConfig | null = null;

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
    schemaVersion: CONFIG_SCHEMA_VERSION,
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

type JsonObject = Record<string, unknown>;

const FTP_SECRET_FIELD_PATTERN = /^(?:password|newPassword|confirmPassword|oldPassword|currentPassword|secret)$/i;
const EXPLICIT_FTP_SECRET_FIELD_PATTERN = /^(?:ftpPassword|cameraFtpPassword)$/i;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scrubLegacyFtpPlaintextSecrets(value: unknown, ftpContext = false): { value: unknown; removed: boolean } {
  if (Array.isArray(value)) {
    let removed = false;
    const next = value.map((item) => {
      const scrubbed = scrubLegacyFtpPlaintextSecrets(item, ftpContext);
      removed = removed || scrubbed.removed;
      return scrubbed.value;
    });
    return { value: next, removed };
  }
  if (!isJsonObject(value)) return { value, removed: false };

  let removed = false;
  const next: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const nestedFtpContext = ftpContext || /ftp/i.test(key);
    if ((nestedFtpContext && FTP_SECRET_FIELD_PATTERN.test(key)) || EXPLICIT_FTP_SECRET_FIELD_PATTERN.test(key)) {
      removed = true;
      continue;
    }
    const scrubbed = scrubLegacyFtpPlaintextSecrets(item, nestedFtpContext);
    next[key] = scrubbed.value;
    removed = removed || scrubbed.removed;
  }
  return { value: next, removed };
}

function configSchemaVersion(raw: JsonObject): number {
  if (raw.schemaVersion === undefined) return 0;
  if (!Number.isSafeInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 0) {
    throw new ConfigFileError("CONFIG_SCHEMA_INVALID", "config.json 的 schemaVersion 无效。");
  }
  const version = Number(raw.schemaVersion);
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new ConfigFileError("CONFIG_SCHEMA_UNSUPPORTED", "config.json 来自更高版本，当前程序不能安全读取。");
  }
  return version;
}

function invalidCurrentConfig(field: string): never {
  throw new ConfigFileError(
    "CONFIG_SCHEMA_INVALID",
    `config.json 字段 ${field} 无效，原文件已保留。`
  );
}

function assertCurrentConfigShape(raw: JsonObject): void {
  const server = isJsonObject(raw.server) ? raw.server : invalidCurrentConfig("server");
  const repository = isJsonObject(raw.repository) ? raw.repository : invalidCurrentConfig("repository");
  const database = isJsonObject(raw.database) ? raw.database : invalidCurrentConfig("database");
  const gallery = isJsonObject(raw.gallery) ? raw.gallery : invalidCurrentConfig("gallery");
  const cameraFtp = isJsonObject(raw.cameraFtp) ? raw.cameraFtp : invalidCurrentConfig("cameraFtp");
  const validPort = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;

  if (!validPort(server.port)) invalidCurrentConfig("server.port");
  if (typeof repository.path !== "string") invalidCurrentConfig("repository.path");
  if (typeof database.path !== "string") invalidCurrentConfig("database.path");
  if (typeof database.autoBackupEnabled !== "boolean") invalidCurrentConfig("database.autoBackupEnabled");
  if (typeof database.lastAutoBackupAt !== "string") invalidCurrentConfig("database.lastAutoBackupAt");
  if (!Number.isInteger(database.autoBackupRetention)
    || Number(database.autoBackupRetention) < 1
    || Number(database.autoBackupRetention) > 100) {
    invalidCurrentConfig("database.autoBackupRetention");
  }
  if (gallery.batchSelectionBehavior !== "clear" && gallery.batchSelectionBehavior !== "keep") {
    invalidCurrentConfig("gallery.batchSelectionBehavior");
  }

  if (cameraFtp.provider !== DEFAULT_CAMERA_FTP_PROVIDER) invalidCurrentConfig("cameraFtp.provider");
  if (typeof cameraFtp.siteName !== "string" || !cameraFtp.siteName.trim()) invalidCurrentConfig("cameraFtp.siteName");
  if (!Number.isSafeInteger(cameraFtp.managedSiteId) || Number(cameraFtp.managedSiteId) < 0) {
    invalidCurrentConfig("cameraFtp.managedSiteId");
  }
  if (typeof cameraFtp.username !== "string" || !cameraFtp.username.trim()) invalidCurrentConfig("cameraFtp.username");
  if (typeof cameraFtp.accountManaged !== "boolean") invalidCurrentConfig("cameraFtp.accountManaged");
  if (typeof cameraFtp.activeEventId !== "string") invalidCurrentConfig("cameraFtp.activeEventId");
  if (!validPort(cameraFtp.controlPort)) invalidCurrentConfig("cameraFtp.controlPort");
  if (!validPort(cameraFtp.passivePortStart)) invalidCurrentConfig("cameraFtp.passivePortStart");
  if (!validPort(cameraFtp.passivePortEnd)) invalidCurrentConfig("cameraFtp.passivePortEnd");
  if (Number(cameraFtp.passivePortStart) > Number(cameraFtp.passivePortEnd)) {
    invalidCurrentConfig("cameraFtp.passivePortStart/passivePortEnd");
  }
  if (Number(cameraFtp.controlPort) >= Number(cameraFtp.passivePortStart)
    && Number(cameraFtp.controlPort) <= Number(cameraFtp.passivePortEnd)) {
    invalidCurrentConfig("cameraFtp.controlPort");
  }
  if (typeof cameraFtp.firewallControlRuleName !== "string" || !cameraFtp.firewallControlRuleName.trim()) {
    invalidCurrentConfig("cameraFtp.firewallControlRuleName");
  }
  if (typeof cameraFtp.firewallPassiveRuleName !== "string" || !cameraFtp.firewallPassiveRuleName.trim()) {
    invalidCurrentConfig("cameraFtp.firewallPassiveRuleName");
  }
  if (typeof cameraFtp.passwordResetRequired !== "boolean") {
    invalidCurrentConfig("cameraFtp.passwordResetRequired");
  }
}

function assertLegacyConfigFieldTypes(raw: JsonObject): void {
  const optionalObject = (key: string): JsonObject | undefined => {
    if (raw[key] === undefined) return undefined;
    return isJsonObject(raw[key]) ? raw[key] : invalidCurrentConfig(key);
  };
  const assertOptionalType = (
    object: JsonObject | undefined,
    key: string,
    predicate: (value: unknown) => boolean,
    fieldPrefix: string
  ) => {
    if (object && object[key] !== undefined && !predicate(object[key])) {
      invalidCurrentConfig(`${fieldPrefix}.${key}`);
    }
  };
  const validPort = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;

  const server = optionalObject("server");
  const repository = optionalObject("repository");
  const database = optionalObject("database");
  const gallery = optionalObject("gallery");
  const cameraFtp = optionalObject("cameraFtp");

  assertOptionalType(server, "port", validPort, "server");
  assertOptionalType(repository, "path", (value) => typeof value === "string", "repository");
  assertOptionalType(database, "path", (value) => typeof value === "string", "database");
  assertOptionalType(database, "autoBackupEnabled", (value) => typeof value === "boolean", "database");
  assertOptionalType(database, "lastAutoBackupAt", (value) => typeof value === "string", "database");
  assertOptionalType(database, "autoBackupRetention", (value) => Number.isInteger(value), "database");
  assertOptionalType(gallery, "batchSelectionBehavior", (value) => value === "clear" || value === "keep", "gallery");
  assertOptionalType(cameraFtp, "provider", (value) => value === DEFAULT_CAMERA_FTP_PROVIDER, "cameraFtp");
  for (const key of ["siteName", "username", "activeEventId", "eventId", "firewallControlRuleName", "firewallPassiveRuleName"]) {
    assertOptionalType(cameraFtp, key, (value) => typeof value === "string", "cameraFtp");
  }
  assertOptionalType(cameraFtp, "managedSiteId", (value) => Number.isSafeInteger(value) && Number(value) >= 0, "cameraFtp");
  assertOptionalType(cameraFtp, "accountManaged", (value) => typeof value === "boolean", "cameraFtp");
  assertOptionalType(cameraFtp, "passwordResetRequired", (value) => typeof value === "boolean", "cameraFtp");
  for (const key of ["controlPort", "passivePortStart", "passivePortEnd"]) {
    assertOptionalType(cameraFtp, key, validPort, "cameraFtp");
  }
}

const CONFIG_MIGRATIONS: Record<number, (raw: JsonObject) => JsonObject> = {
  0: (raw) => ({ ...raw, schemaVersion: CONFIG_SCHEMA_VERSION })
};

export interface ConfigMigrationResult {
  config: AppConfig;
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  legacySecretRemoved: boolean;
}

/**
 * Pure, idempotent config migration. Unknown and retired fields are removed by
 * normalization; FTP plaintext credential fields are scrubbed before the
 * normalized document can be returned or persisted.
 */
export function migrateConfigDocument(raw: unknown): ConfigMigrationResult {
  if (!isJsonObject(raw)) {
    throw new ConfigFileError("CONFIG_SCHEMA_INVALID", "config.json 顶层必须是 JSON 对象。");
  }

  const fromVersion = configSchemaVersion(raw);
  if (fromVersion === 0) {
    assertLegacyConfigFieldTypes(raw);
  }
  const scrubbed = scrubLegacyFtpPlaintextSecrets(raw);
  let working = scrubbed.value as JsonObject;
  let version = fromVersion;

  while (version < CONFIG_SCHEMA_VERSION) {
    const migration = CONFIG_MIGRATIONS[version];
    if (!migration) {
      throw new ConfigFileError("CONFIG_MIGRATION_FAILED", `缺少 config.json v${version} 的迁移步骤。`);
    }
    try {
      working = migration(working);
    } catch (error) {
      if (error instanceof ConfigFileError) throw error;
      throw new ConfigFileError("CONFIG_MIGRATION_FAILED", `config.json v${version} 迁移失败。`, error);
    }
    version += 1;
  }

  if (scrubbed.removed) {
    const cameraFtp = isJsonObject(working.cameraFtp) ? working.cameraFtp : {};
    working = {
      ...working,
      cameraFtp: { ...cameraFtp, passwordResetRequired: true }
    };
  }

  // Files already marked with the current schema must be complete and
  // type-correct. Only legacy documents are allowed through the lenient
  // normalizer so an externally damaged current config can never be silently
  // replaced with defaults.
  if (fromVersion === CONFIG_SCHEMA_VERSION) {
    assertCurrentConfigShape(working);
  }

  const config = normalizeConfig(working);
  return {
    config,
    fromVersion,
    toVersion: CONFIG_SCHEMA_VERSION,
    changed: JSON.stringify(raw) !== JSON.stringify(config),
    legacySecretRemoved: scrubbed.removed
  };
}

export function normalizeCameraFtpConfig(raw: any): CameraFtpConfig {
  const scrubbed = scrubLegacyFtpPlaintextSecrets(raw, true);
  const source: any = scrubbed.value;
  const legacyPasswordDetected = scrubbed.removed;
  const rawControlPort = Number(source?.controlPort);
  const rawPassiveStart = Number(source?.passivePortStart);
  const rawPassiveEnd = Number(source?.passivePortEnd);
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
    siteName: typeof source?.siteName === "string" && source.siteName.trim()
      ? source.siteName.trim().slice(0, 120)
      : DEFAULT_CONFIG.cameraFtp.siteName,
    managedSiteId: Number.isInteger(Number(source?.managedSiteId)) && Number(source?.managedSiteId) > 0
      ? Number(source.managedSiteId)
      : 0,
    username: typeof source?.username === "string" && source.username.trim()
      ? source.username.trim().slice(0, 80)
      : DEFAULT_CONFIG.cameraFtp.username,
    accountManaged: source?.accountManaged === true,
    activeEventId: typeof source?.activeEventId === "string"
      ? source.activeEventId.trim()
      : (typeof source?.eventId === "string" ? source.eventId.trim() : ""),
    controlPort,
    passivePortStart,
    passivePortEnd,
    firewallControlRuleName: typeof source?.firewallControlRuleName === "string" && source.firewallControlRuleName.trim()
      ? source.firewallControlRuleName.trim().slice(0, 160)
      : DEFAULT_CONFIG.cameraFtp.firewallControlRuleName,
    firewallPassiveRuleName: typeof source?.firewallPassiveRuleName === "string" && source.firewallPassiveRuleName.trim()
      ? source.firewallPassiveRuleName.trim().slice(0, 160)
      : DEFAULT_CONFIG.cameraFtp.firewallPassiveRuleName,
    passwordResetRequired: legacyPasswordDetected || source?.passwordResetRequired === true
  };
}

function normalizeConfig(raw: any): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    server: {
      port: normalizePreferredPort(raw?.server?.port)
    },
    repository: {
      path: typeof raw?.repository?.path === "string" ? raw.repository.path : DEFAULT_CONFIG.repository.path
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
  _config = null;
  const configPath = path.join(configDir, "config.json");
  const logger = getLogger();

  if (fs.existsSync(configPath)) {
    let raw: unknown;
    try {
      raw = fs.readJsonSync(configPath);
    } catch (error) {
      const code: ConfigFileErrorCode = error instanceof SyntaxError ? "CONFIG_PARSE_FAILED" : "CONFIG_READ_FAILED";
      logger.error({ configPath, errorCode: code }, "配置文件读取失败，启动已安全停止");
      throw new ConfigFileError(
        code,
        code === "CONFIG_PARSE_FAILED" ? "config.json 不是有效的 JSON，原文件已保留。" : "config.json 无法读取，原文件已保留。",
        error
      );
    }

    let migration: ConfigMigrationResult;
    try {
      migration = migrateConfigDocument(raw);
    } catch (error) {
      const configError = error instanceof ConfigFileError
        ? error
        : new ConfigFileError("CONFIG_MIGRATION_FAILED", "config.json 迁移失败，原文件已保留。", error);
      logger.error({ configPath, errorCode: configError.code }, "配置文件校验或迁移失败，启动已安全停止");
      throw configError;
    }

    if (migration.changed) {
      try {
        writeConfigAtomic(configPath, migration.config);
      } catch (error) {
        const configError = new ConfigFileError(
          "CONFIG_MIGRATION_WRITE_FAILED",
          "config.json 迁移结果无法安全写入，原配置已保留。",
          error
        );
        logger.error({ configPath, errorCode: configError.code }, "配置迁移写入失败，启动已安全停止");
        throw configError;
      }
      logger.info({
        configPath,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        preferredPort: migration.config.server.port,
        cameraFtpProvider: migration.config.cameraFtp.provider,
        legacySecretRemoved: migration.legacySecretRemoved
      }, "配置已安全迁移");
    }

    _config = migration.config;
    logger.info({ configPath, schemaVersion: migration.config.schemaVersion }, "配置文件已加载");
    return migration.config;
  }

  const initialConfig = createDefaultConfig();
  try {
    writeConfigAtomic(configPath, initialConfig);
  } catch (error) {
    const configError = new ConfigFileError("CONFIG_CREATE_FAILED", "默认 config.json 无法安全创建。", error);
    logger.error({ configPath, errorCode: configError.code }, "配置文件创建失败，启动已安全停止");
    throw configError;
  }
  _config = initialConfig;
  logger.info({ configPath, schemaVersion: initialConfig.schemaVersion }, "配置文件不存在，已创建默认配置");
  return initialConfig;
}

/**
 * 获取当前配置。
 */
export function getConfig(): AppConfig {
  if (!_config) {
    throw new ConfigFileError("CONFIG_NOT_LOADED", "配置尚未成功加载。");
  }
  return _config;
}

/**
 * 更新配置并写入文件。
 * 接收一个 partial 对象，与当前配置合并后保存。
 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const logger = getLogger();
  const currentConfig = getConfig();
  if (!_configDir) {
    throw new ConfigFileError("CONFIG_NOT_LOADED", "配置目录尚未初始化。");
  }
  const configPath = path.join(_configDir, "config.json");
  const nextConfig = normalizeConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    server: patch.server ? { ...currentConfig.server, ...patch.server } : { ...currentConfig.server },
    repository: patch.repository ? { ...currentConfig.repository, ...patch.repository } : { ...currentConfig.repository },
    database: patch.database
      ? {
        ...currentConfig.database,
        ...patch.database,
        autoBackupRetention: normalizeAutoBackupRetention(
          patch.database.autoBackupRetention ?? currentConfig.database.autoBackupRetention
        )
      }
      : { ...currentConfig.database },
    gallery: patch.gallery
      ? {
        batchSelectionBehavior: normalizeBatchSelectionBehavior(
          patch.gallery.batchSelectionBehavior ?? currentConfig.gallery.batchSelectionBehavior
        )
      }
      : { ...currentConfig.gallery },
    cameraFtp: patch.cameraFtp
      ? { ...currentConfig.cameraFtp, ...patch.cameraFtp }
      : { ...currentConfig.cameraFtp }
  });
  try {
    writeConfigAtomic(configPath, nextConfig);
    _config = nextConfig;
    logger.info({ configPath, schemaVersion: nextConfig.schemaVersion }, "配置文件已保存");
  } catch (error) {
    const configError = new ConfigFileError("CONFIG_WRITE_FAILED", "config.json 无法安全写入，已有配置未改变。", error);
    logger.error({ configPath, errorCode: configError.code }, "配置文件保存失败，已有配置未改变");
    throw configError;
  }

  return nextConfig;
}
