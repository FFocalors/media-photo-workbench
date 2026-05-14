import { io, type Socket } from "socket.io-client";
import { getApiBase, type EventImageData } from "./api";

export type RealtimeConnectionState = "connected" | "reconnecting" | "disconnected";

export interface RealtimeImagePayload {
  eventId: string;
  imageId: string;
  image?: EventImageData;
  action: string;
  updatedAt: string;
}

export type RealtimeImageEventName = "image-created" | "image-updated" | "image-deleted-logical";

let socket: Socket | null = null;
let socketBaseUrl = "";

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
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
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
