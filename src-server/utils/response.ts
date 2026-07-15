import { Response } from "express";

/**
 * 统一 API 响应格式工具函数。
 *
 * 成功：{ ok: true, data: T, error: null }
 * 失败：{ ok: false, data: null, error: { code, message } }
 */

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({
    ok: true,
    data,
    error: null
  });
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: Record<string, unknown>
): void {
  res.status(statusCode).json({
    ok: false,
    data: null,
    error: { code, message, ...(details ? { details } : {}) }
  });
}
