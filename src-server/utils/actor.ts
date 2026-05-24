import type { Request } from "express";

export type ActorType = "host" | "client" | "unknown";

export interface ActorInfo {
  type: ActorType;
  id: string;
  name: string;
}

export const HOST_ACTOR: ActorInfo = {
  type: "host",
  id: "host",
  name: "主机"
};

export const UNKNOWN_ACTOR: ActorInfo = {
  type: "unknown",
  id: "",
  name: "未知操作者"
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function decodeHeaderText(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeActor(input: unknown, fallback: ActorInfo = HOST_ACTOR): ActorInfo {
  const value = input as Partial<ActorInfo> | null | undefined;
  const requestedType = value?.type;
  const type: ActorType = requestedType === "client" || requestedType === "host" || requestedType === "unknown"
    ? requestedType
    : fallback.type;
  const id = cleanText(value?.id, 120) || (type === "host" ? "host" : fallback.id);
  const name = cleanText(value?.name, 80) || (type === "host" ? "主机" : type === "client" ? "客户端" : fallback.name);

  return { type, id, name };
}

export function actorFromRequest(req: Request, fallback: ActorInfo = HOST_ACTOR): ActorInfo {
  const bodyActor = normalizeActor(req.body?.actor, fallback);
  const headerType = cleanText(req.header("X-Actor-Type"), 20);
  const headerId = cleanText(req.header("X-Actor-Id") || req.header("X-Client-Id"), 120);
  const headerName = cleanText(decodeHeaderText(req.header("X-Actor-Name") || req.header("X-Client-Name") || ""), 80);

  if (!headerType && !headerId && !headerName) {
    return bodyActor;
  }

  return normalizeActor({
    type: headerType || bodyActor.type,
    id: headerId || bodyActor.id,
    name: headerName || bodyActor.name
  }, bodyActor);
}

export function actorToLogColumns(actor: ActorInfo): {
  operator: string;
  device: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
} {
  return {
    operator: actor.name,
    device: actor.type === "client" ? actor.name : actor.type === "host" ? "主机" : "",
    actor_type: actor.type,
    actor_id: actor.id,
    actor_name: actor.name
  };
}
