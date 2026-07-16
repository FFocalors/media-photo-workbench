import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

interface OperationContextValue {
  operationId: string;
}

const operationStorage = new AsyncLocalStorage<OperationContextValue>();
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function normalizeOperationId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return OPERATION_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Gives every API request a stable, non-secret correlation identifier. A
 * caller-supplied value is accepted only when it matches the deliberately
 * narrow public format; otherwise a fresh UUID is used.
 */
export function operationContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const operationId = normalizeOperationId(req.header("x-operation-id")) || randomUUID();
  res.setHeader("X-Operation-Id", operationId);
  operationStorage.run({ operationId }, next);
}

export function getCurrentOperationId(): string | undefined {
  return operationStorage.getStore()?.operationId;
}

/**
 * Reuses the API operation id inside orchestrator work. Non-HTTP startup and
 * recovery work receives its own id without needing a fake request context.
 */
export function getOrCreateOperationId(): string {
  return getCurrentOperationId() || randomUUID();
}

export function runWithOperationId<T>(operationId: string, operation: () => T): T {
  const normalized = normalizeOperationId(operationId);
  if (!normalized) {
    throw Object.assign(new Error("operationId 格式无效。"), { code: "INVALID_OPERATION_ID" });
  }
  return operationStorage.run({ operationId: normalized }, operation);
}
