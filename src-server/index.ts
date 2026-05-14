import http from "http";
import { createApp } from "./app";
import { loadConfig, getConfig, saveConfig } from "./config/config";
import { initDatabase, closeDatabase } from "./db/database";
import { initRealtime, getRealtime } from "./realtime/socket";
import { initLogger, getLogger } from "./utils/logger";
import { ensureDataDirs, getDatabasePath, getConfigDir, getLogsDir } from "./utils/paths";
import { setAppDataRoot } from "./routes/settings";

export interface ServerHandle {
  port: number;
  close: () => void;
}

const MIN_PORT = 3030;
const MAX_PORT = 3040;

/**
 * 尝试在指定端口上启动 HTTP 服务。
 * 如果端口被占用，自动递增尝试（3030 -> 3031 -> ... -> 3040）。
 */
function tryListen(
  server: http.Server,
  port: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const logger = getLogger();

    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        const nextPort = port + 1;
        if (nextPort > MAX_PORT) {
          logger.error(
            { minPort: MIN_PORT, maxPort: MAX_PORT },
            `端口 ${MIN_PORT}-${MAX_PORT} 全部被占用，无法启动服务`
          );
          reject(new Error(`端口 ${MIN_PORT}-${MAX_PORT} 全部被占用`));
          return;
        }
        logger.warn({ port, nextPort }, `端口 ${port} 已被占用，尝试 ${nextPort}...`);
        server.removeListener("error", onError);
        resolve(tryListen(server, nextPort));
      } else {
        reject(err);
      }
    };

    server.once("error", onError);
    server.listen(port, () => {
      server.removeListener("error", onError);
      resolve(port);
    });
  });
}

/**
 * 启动后端服务。
 *
 * @param appDataRoot - 应用数据根目录
 *   开发环境：项目根目录
 *   生产环境：app.getPath("userData")
 */
export async function startServer(appDataRoot: string): Promise<ServerHandle> {
  // 1. 确保数据目录存在
  ensureDataDirs(appDataRoot);

  // 2. 初始化日志
  const logger = initLogger(getLogsDir(appDataRoot));
  logger.info({ appDataRoot }, "后端服务启动中...");

  // 3. 加载配置
  const config = loadConfig(getConfigDir(appDataRoot));
  const preferredPort = config.server.port;

  // 4. 给 settings 路由传递 appDataRoot
  setAppDataRoot(appDataRoot);

  // 5. 初始化数据库
  const dbPath = getDatabasePath(appDataRoot);
  initDatabase(dbPath);

  // 6. 创建 Express 应用
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);

  // 7. 带端口冲突处理的启动
  const actualPort = await tryListen(server, preferredPort);

  // 如果最终端口和配置里的不一样，更新配置
  if (actualPort !== preferredPort) {
    saveConfig({ server: { port: actualPort } });
    logger.info(
      { preferredPort, actualPort },
      `端口已自动切换：${preferredPort} -> ${actualPort}`
    );
  }

  logger.info({ port: actualPort }, `后端服务已启动：http://localhost:${actualPort}`);

  return {
    port: actualPort,
    close: () => {
      logger.info("正在关闭后端服务...");
      closeDatabase();
      getRealtime()?.close();
      server.close();
    }
  };
}
