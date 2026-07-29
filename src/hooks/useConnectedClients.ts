import { useEffect, useRef, useState } from "react";
import { fetchOnlineClients, type ClientPresenceData } from "../lib/api";
import { subscribeClientsUpdated, type ClientsUpdatedPayload } from "../lib/socket";

/**
 * Connection state for a single logical client as surfaced to the host UI.
 *
 * The Socket.IO presence registry (`clientsBySocketId`) only ever contains
 * sockets that are actually connected right now — disconnect removes the entry
 * immediately. This hook keeps a short client-side grace window so a brief
 * network blip / socket reconnect within ~10s does not make the client flicker
 * out of the "已连接客户端" list and back in. The grace window is purely a
 * host-display concern; it never touches the server registry or any actor log.
 */
export type ClientConnectionStatus = "online" | "reconnecting";

export interface ConnectedClientEntry extends ClientPresenceData {
  status: ClientConnectionStatus;
}

const RECONNECT_GRACE_MS = 10_000;

interface ReconcileResult {
  /** Entries to render this round (online clients plus those now in grace). */
  entries: Map<string, ConnectedClientEntry>;
  /** clientIds that just left the live snapshot and need a fresh grace timer. */
  newGrace: string[];
}

function reconcile(
  live: ClientPresenceData[],
  entries: Map<string, ConnectedClientEntry>,
  inGrace: Set<string>
): ReconcileResult {
  const next = new Map<string, ConnectedClientEntry>();
  const liveIds = new Set<string>();
  const newGrace: string[] = [];

  for (const client of live) {
    if (!client.clientId) continue;
    liveIds.add(client.clientId);
    next.set(client.clientId, { ...client, status: "online" });
  }

  for (const [clientId, entry] of entries) {
    if (liveIds.has(clientId)) continue; // still online, already handled above
    if (!inGrace.has(clientId)) newGrace.push(clientId);
    next.set(clientId, { ...entry, status: "reconnecting" });
  }

  return { entries: next, newGrace };
}

export function useConnectedClients(): {
  clients: ConnectedClientEntry[];
  onlineCount: number;
} {
  const [clients, setClients] = useState<ConnectedClientEntry[]>([]);
  const entriesRef = useRef(new Map<string, ConnectedClientEntry>());
  const graceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const apply = (live: ClientPresenceData[]) => {
      const inGrace = new Set(graceTimersRef.current.keys());
      const { entries, newGrace } = reconcile(live, entriesRef.current, inGrace);

      for (const clientId of newGrace) {
        const timer = setTimeout(() => {
          graceTimersRef.current.delete(clientId);
          const removed = new Map(entriesRef.current);
          removed.delete(clientId);
          entriesRef.current = removed;
          setClients(Array.from(removed.values()).sort((a, b) => a.connectedAt.localeCompare(b.connectedAt)));
        }, RECONNECT_GRACE_MS);
        graceTimersRef.current.set(clientId, timer);
      }

      entriesRef.current = entries;
      setClients(Array.from(entries.values()).sort((a, b) => a.connectedAt.localeCompare(b.connectedAt)));
    };

    fetchOnlineClients()
      .then((res) => {
        if (res.ok && res.data) apply(res.data.clients ?? []);
      })
      .catch(() => {
        // Socket.IO presence updates still arrive after connection.
      });

    const unsubscribe = subscribeClientsUpdated((payload: ClientsUpdatedPayload) => {
      apply(payload.clients ?? []);
    });

    return () => {
      unsubscribe();
      for (const timer of graceTimersRef.current.values()) clearTimeout(timer);
      graceTimersRef.current.clear();
    };
  }, []);

  return { clients, onlineCount: clients.length };
}