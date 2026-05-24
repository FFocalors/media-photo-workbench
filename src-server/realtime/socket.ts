import http from "http";
import { Server as SocketServer, type Socket } from "socket.io";
import { getLogger } from "../utils/logger";

export interface RealtimeImagePayload {
  eventId: string;
  imageId: string;
  image?: unknown;
  action: string;
  actor?: RealtimeActor;
  updatedAt: string;
}

export interface RealtimeActor {
  type: "host" | "client" | "unknown";
  id?: string;
  name: string;
}

export interface RealtimeTaskPayload {
  id?: string;
  taskId?: string;
  type: string;
  eventId: string;
  title?: string;
  status: string;
  action?: string;
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: unknown[];
  result: unknown;
  startedAt?: string;
  elapsedMs?: number;
  estimatedRemainingMs?: number | null;
  currentFileName?: string;
  updatedAt: string;
}

export interface RealtimeExportPayload {
  eventId: string;
  jobId: string;
  status: string;
  action: string;
  updatedAt: string;
  exportJob?: unknown;
}

export interface RealtimeArchivePayload {
  eventId: string;
  archivePath: string;
  status: string;
  action: string;
  updatedAt: string;
  archivedEvent?: unknown;
}

export interface ClientPresence {
  clientId: string;
  clientName: string;
  role: "client";
  connectedAt: string;
  lastSeenAt: string;
  userAgent?: string;
  address?: string;
}

let realtime: SocketServer | null = null;
const clientsBySocketId = new Map<string, ClientPresence>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeClientPayload(payload: any, socket: Socket): ClientPresence | null {
  const clientId = typeof payload?.clientId === "string" && payload.clientId.trim()
    ? payload.clientId.trim().slice(0, 120)
    : "";
  if (!clientId) return null;

  const suffix = clientId.replace(/[^a-zA-Z0-9]/g, "").slice(-4) || "0000";
  const clientName = typeof payload?.clientName === "string" && payload.clientName.trim()
    ? payload.clientName.trim().slice(0, 80)
    : `客户端-${suffix}`;
  const existing = clientsBySocketId.get(socket.id);
  const timestamp = nowIso();

  return {
    clientId,
    clientName,
    role: "client",
    connectedAt: existing?.connectedAt || timestamp,
    lastSeenAt: timestamp,
    userAgent: typeof socket.handshake.headers["user-agent"] === "string" ? socket.handshake.headers["user-agent"] : "",
    address: socket.handshake.address
  };
}

function getAggregatedClients(): ClientPresence[] {
  const byClientId = new Map<string, ClientPresence>();
  for (const client of clientsBySocketId.values()) {
    const existing = byClientId.get(client.clientId);
    if (!existing || client.lastSeenAt > existing.lastSeenAt) {
      byClientId.set(client.clientId, client);
    }
  }

  return Array.from(byClientId.values()).sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

function emitClientsUpdated(): void {
  realtime?.emit("clients-updated", {
    clients: getAggregatedClients()
  });
}

export function initRealtime(server: http.Server): SocketServer {
  const logger = getLogger();

  realtime = new SocketServer(server, {
    cors: {
      origin: true,
      methods: ["GET", "POST", "PATCH", "DELETE"]
    }
  });

  realtime.on("connection", (socket) => {
    logger.info({ socketId: socket.id, address: socket.handshake.address }, "实时同步客户端已连接");
    socket.emit("realtime-status", {
      ok: true,
      socketId: socket.id,
      connected: true,
      connectedAt: nowIso()
    });
    socket.emit("clients-updated", {
      clients: getAggregatedClients()
    });

    const registerClient = (payload: unknown) => {
      const presence = normalizeClientPayload(payload, socket);
      if (!presence) {
        logger.warn({ socketId: socket.id, payload }, "客户端在线信息上报无效");
        return;
      }
      clientsBySocketId.set(socket.id, presence);
      logger.info({ socketId: socket.id, clientId: presence.clientId, clientName: presence.clientName }, "客户端在线信息已登记");
      emitClientsUpdated();
    };

    socket.on("client-register", registerClient);
    socket.on("client-hello", registerClient);
    socket.on("client-unregister", () => {
      const removed = clientsBySocketId.delete(socket.id);
      if (removed) emitClientsUpdated();
    });

    socket.on("disconnect", (reason) => {
      const removed = clientsBySocketId.delete(socket.id);
      logger.info({ socketId: socket.id, reason }, "实时同步客户端已断开");
      if (removed) emitClientsUpdated();
    });
  });

  logger.info("Socket.IO 实时同步服务已初始化");
  return realtime;
}

export function getRealtime(): SocketServer | null {
  return realtime;
}

export function getOnlineClients(): ClientPresence[] {
  return getAggregatedClients();
}

function emit(eventName: string, payload: unknown): void {
  const io = getRealtime();
  if (!io) {
    getLogger().warn({ eventName, payload }, "实时同步服务尚未初始化，事件未广播");
    return;
  }

  io.emit(eventName, payload);
}

export function emitImageCreated(payload: RealtimeImagePayload): void {
  emit("image-created", payload);
}

export function emitImageUpdated(payload: RealtimeImagePayload): void {
  emit("image-updated", payload);
}

export function emitImageDeletedLogical(payload: RealtimeImagePayload): void {
  emit("image-deleted-logical", payload);
}

export function emitTaskUpdated(payload: RealtimeTaskPayload): void {
  emit("task-updated", payload);
}

export function emitExportCreated(payload: RealtimeExportPayload): void {
  emit("export-created", payload);
}

export function emitArchiveUpdated(payload: RealtimeArchivePayload): void {
  emit("archive-updated", payload);
}
