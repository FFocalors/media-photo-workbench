import { Response } from "express";
import { getCurrentOperationId } from "./operationContext";

/**
 * 统一 API 响应格式工具函数。
 *
 * 成功：{ ok: true, data: T, error: null }
 * 失败：{ ok: false, data: null, error: { code, message } }
 */

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const operationId = getCurrentOperationId();
  res.status(statusCode).json({
    ok: true,
    data,
    error: null,
    ...(operationId ? { operationId } : {})
  });
}

export interface ApiErrorOptions {
  title?: string;
  impact?: string;
  nextAction?: string;
  rollbackStatus?: string;
  operationId?: string;
  retryable?: boolean;
  technicalDetails?: string;
}

export interface ApiErrorPayload extends ApiErrorOptions {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

/**
 * Builds the public error envelope without removing the legacy `details`
 * object. Explicit options win; otherwise common legacy detail aliases are
 * promoted to the top level for new clients.
 */
export function buildApiErrorPayload(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  options: ApiErrorOptions = {}
): ApiErrorPayload {
  const rollback = asRecord(details?.rollback);
  const rollbackAttempted = firstBoolean(details?.rollbackAttempted);
  const rollbackSucceeded = firstBoolean(details?.rollbackSucceeded);
  const rollbackStatus = firstString(
    options.rollbackStatus,
    details?.rollbackStatus,
    rollback?.status
  ) || (rollbackAttempted === false
    ? "not_required"
    : rollbackSucceeded === true
      ? "success"
      : rollbackSucceeded === false
        ? "failed"
        : undefined);

  const normalized: ApiErrorPayload = {
    code,
    message,
    ...(details ? { details } : {})
  };
  const title = firstString(options.title, details?.title);
  const impact = firstString(options.impact, details?.impact);
  const nextAction = firstString(options.nextAction, details?.nextAction, details?.advice);
  const operationId = firstString(options.operationId, details?.operationId, getCurrentOperationId());
  const retryable = firstBoolean(options.retryable, details?.retryable);
  const technicalDetails = firstString(
    options.technicalDetails,
    details?.technicalDetails,
    details?.technicalMessage
  );

  if (title) normalized.title = title;
  if (impact) normalized.impact = impact;
  if (nextAction) normalized.nextAction = nextAction;
  if (rollbackStatus) normalized.rollbackStatus = rollbackStatus;
  if (operationId) normalized.operationId = operationId;
  if (retryable !== undefined) normalized.retryable = retryable;
  if (technicalDetails) normalized.technicalDetails = technicalDetails;
  return normalized;
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: Record<string, unknown>,
  options: ApiErrorOptions = {}
): void {
  res.status(statusCode).json({
    ok: false,
    data: null,
    error: buildApiErrorPayload(code, message, details, options)
  });
}
