import fs from "fs-extra";
import path from "path";
import { getLogger } from "../utils/logger";

export interface AppConfig {
  server: {
    port: number;
  };
  repository: {
    path: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 3030
  },
  repository: {
    path: ""
  }
};

let _configDir = "";
let _config: AppConfig = { ...DEFAULT_CONFIG };

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
      _config = {
        server: {
          port: raw?.server?.port ?? DEFAULT_CONFIG.server.port
        },
        repository: {
          path: raw?.repository?.path ?? DEFAULT_CONFIG.repository.path
        }
      };
      logger.info({ configPath }, "配置文件已加载");
    } catch (err) {
      logger.warn({ err, configPath }, "配置文件读取失败，使用默认配置");
      _config = { ...DEFAULT_CONFIG };
    }
  } else {
    fs.ensureDirSync(configDir);
    fs.writeJsonSync(configPath, DEFAULT_CONFIG, { spaces: 2 });
    _config = { ...DEFAULT_CONFIG };
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

  if (patch.server) {
    _config.server = { ..._config.server, ...patch.server };
  }
  if (patch.repository) {
    _config.repository = { ..._config.repository, ...patch.repository };
  }

  try {
    fs.writeJsonSync(configPath, _config, { spaces: 2 });
    logger.info({ configPath }, "配置文件已保存");
  } catch (err) {
    logger.error({ err, configPath }, "配置文件保存失败");
    throw err;
  }

  return _config;
}
