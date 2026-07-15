import os from "os";
import type { Request, RequestHandler } from "express";
import { sendError } from "../utils/response";

function normalizeAddress(value: string | undefined): string {
  let address = (value || "").trim().toLowerCase().split("%")[0];
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  if (address.startsWith("::ffff:")) address = address.slice(7);
  return address;
}

function localHostAddresses(): Set<string> {
  const addresses = new Set(["127.0.0.1", "::1"]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) addresses.add(normalizeAddress(entry.address));
  }
  return addresses;
}

export function isHostRequest(req: Request): boolean {
  const localAddresses = localHostAddresses();
  if (!localAddresses.has(normalizeAddress(req.socket.remoteAddress))) return false;

  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return localAddresses.has(normalizeAddress(hostname)) || hostname.toLowerCase() === "localhost";
  } catch {
    return false;
  }
}

export const requireHostOnly: RequestHandler = (req, res, next) => {
  if (isHostRequest(req)) {
    next();
    return;
  }
  sendError(res, "HOST_ONLY_OPERATION", "该操作只能在主机工作台中执行。", 403);
};
