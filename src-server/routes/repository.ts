import { Router } from "express";
import { getConfig } from "../config/config";
import { checkRepository } from "../services/repository";
import { sendSuccess } from "../utils/response";

const router = Router();

/**
 * GET /api/repository/check
 * 检查当前仓库路径状态。
 */
router.get("/check", (_req, res) => {
  const config = getConfig();
  const result = checkRepository(config.repository.path);
  sendSuccess(res, result);
});

export default router;
