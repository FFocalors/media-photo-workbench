import { io, type Socket } from "socket.io-client";
import { getApiBase, type EventImageData, type TaskData } from "./api";
import { getClientIdentity } from "./clientIdentity";

export type RealtimeConnectionState = "connected" | "reconnecting" | "disconnected";

export interface RealtimeImagePayload {
  eventId: string;
  imageId: string;
  image?: EventImageData;
  action: string;
  actor?: {
    type: "host" | "client" | "camera" | "unknown";
    id?: string;
    name: string;
  };
  updatedAt: string;
}

export type RealtimeImageEventName = "image-created" | "image-updated" | "image-deleted-logical";
export type RealtimeTaskPayload = TaskData & {
  taskId?: string;
  action?: string;
};
export interface ClientPresence {
  clientId: string;
  clientName: string;
  role: "client";
  connectedAt: string;
  lastSeenAt: string;
  userAgent?: string;
  address?: string;
}

export interface ClientsUpdatedPayload {
  clients: ClientPresence[];
}

let socket: Socket | null = null;
let socketBaseUrl = "";
let pendingClientRegistration: { clientId: string; clientName: string; role: "client" } | null = null;

function getSocket(): Socket {
  const apiBaseUrl = getApiBase();

  if (!socket || socketBaseUrl !== apiBaseUrl) {
    socket?.disconnect();
    socketBaseUrl = apiBaseUrl;
    socket = io(apiBaseUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      transports: ["websocket", "polling"]
    });
    socket.on("connect", () => {
      if (pendingClientRegistration) {
        socket?.emit("client-register", pendingClientRegistration);
      }
    });
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
}

export function registerClientPresence(): void {
  const identity = getClientIdentity();
  pendingClientRegistration = {
    clientId: identity.clientId,
    clientName: identity.clientName,
    role: "client"
  };
  const activeSocket = getSocket();
  activeSocket.emit("client-register", pendingClientRegistration);
}

export function unregisterClientPresence(): void {
  pendingClientRegistration = null;
  if (socket) {
    socket.emit("client-unregister");
  }
}

export function subscribeRealtimeConnection(
  listener: (state: RealtimeConnectionState) => void
): () => void {
  const activeSocket = getSocket();

  const handleConnect = () => listener("connected");
  const handleDisconnect = () => listener("disconnected");
  const handleReconnecting = () => listener("reconnecting");

  activeSocket.on("connect", handleConnect);
  activeSocket.on("disconnect", handleDisconnect);
  activeSocket.on("connect_error", handleReconnecting);
  activeSocket.io.on("reconnect_attempt", handleReconnecting);
  activeSocket.io.on("reconnect", handleConnect);

  listener(activeSocket.connected ? "connected" : "reconnecting");

  return () => {
    activeSocket.off("connect", handleConnect);
    activeSocket.off("disconnect", handleDisconnect);
    activeSocket.off("connect_error", handleReconnecting);
    activeSocket.io.off("reconnect_attempt", handleReconnecting);
    activeSocket.io.off("reconnect", handleConnect);
  };
}

export function subscribeRealtimeImageEvent(
  eventName: RealtimeImageEventName,
  listener: (payload: RealtimeImagePayload) => void
): () => void {
  const activeSocket = getSocket();
  activeSocket.on(eventName, listener);
  return () => activeSocket.off(eventName, listener);
}

export function subscribeRealtimeTaskEvent(
  listener: (payload: RealtimeTaskPayload) => void
): () => void {
  const activeSocket = getSocket();
  activeSocket.on("task-updated", listener);
  return () => activeSocket.off("task-updated", listener);
}

export function subscribeClientsUpdated(
  listener: (payload: ClientsUpdatedPayload) => void
): () => void {
  const activeSocket = getSocket();
  activeSocket.on("clients-updated", listener);
  return () => activeSocket.off("clients-updated", listener);
}
