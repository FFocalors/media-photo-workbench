import { Router } from "express";
import { getConfig } from "../config/config";
import { sendSuccess } from "../utils/response";
import { checkRepository } from "../services/repository";

const router = Router();

/**
 * GET /api/health
 * 健康检查接口，返回 server、database、repository、config 状态。
 */
router.get("/", (_req, res) => {
  const config = getConfig();
  const repoCheck = config.repository.path
    ? checkRepository(config.repository.path)
    : { exists: false, readable: false, writable: false, freeSpace: null, path: "" };

  sendSuccess(res, {
    service: "media-photo-workbench",
    server: {
      port: config.server.port,
      status: "running"
    },
    database: {
      status: "connected"
    },
    repository: {
      configured: !!config.repository.path,
      ...repoCheck
    },
    config: {
      loaded: true,
      server: config.server,
      repository: config.repository
    }
  });
});

export default router;
