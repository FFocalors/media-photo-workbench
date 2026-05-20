import http from "http";
import { Server as SocketServer } from "socket.io";
import { getLogger } from "../utils/logger";

export interface RealtimeImagePayload {
  eventId: string;
  imageId: string;
  image?: unknown;
  action: string;
  updatedAt: string;
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

let realtime: SocketServer | null = null;

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
      connectedAt: new Date().toISOString()
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "实时同步客户端已断开");
    });
  });

  logger.info("Socket.IO 实时同步服务已初始化");
  return realtime;
}

export function getRealtime(): SocketServer | null {
  return realtime;
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
