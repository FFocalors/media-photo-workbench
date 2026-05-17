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
          port: normalizePreferredPort(raw?.server?.port)
        },
        repository: {
          path: raw?.repository?.path ?? DEFAULT_CONFIG.repository.path
        }
      };
      if (raw?.server?.port !== _config.server.port) {
        fs.writeJsonSync(configPath, _config, { spaces: 2 });
        logger.info({ configPath, preferredPort: _config.server.port }, "已重置主机服务默认端口配置");
      }
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
