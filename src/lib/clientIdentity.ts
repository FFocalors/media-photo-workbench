export type ActorType = "host" | "client";

export interface ActorInfo {
  type: ActorType;
  id?: string;
  name: string;
}

export interface ClientIdentity {
  clientId: string;
  clientName: string;
}

export const CLIENT_ID_KEY = "mediaPhotoWorkbench.clientId";
export const CLIENT_NAME_KEY = "mediaPhotoWorkbench.clientDevice";
export const CLIENT_USER_NAME_KEY = "mediaPhotoWorkbench.clientUserName";
export const CLIENT_ROLE_KEY = "mediaPhotoWorkbench.clientRole";

function generateRandomSuffix(): string {
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return random;
}

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${generateRandomSuffix()}`;
}

function defaultClientName(clientId?: string): string {
  const suffix = (clientId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-4) || generateRandomSuffix();
  const platform = navigator.platform?.toLowerCase().includes("win") ? "Windows 客户端" : "客户端";
  return `${platform}-${suffix}`;
}

export function getOrCreateClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY)?.trim();
  if (existing) return existing;

  const clientId = createClientId();
  localStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

export function getClientName(): string {
  const clientId = getOrCreateClientId();
  const existing = localStorage.getItem(CLIENT_NAME_KEY)?.trim();
  if (existing) return existing;

  const name = defaultClientName(clientId);
  localStorage.setItem(CLIENT_NAME_KEY, name);
  return name;
}

const DEFAULT_USER_NAME = "外拍同学";

export function getClientUserName(): string {
  return localStorage.getItem(CLIENT_USER_NAME_KEY)?.trim() || DEFAULT_USER_NAME;
}

export function setClientUserName(value: string): string {
  const normalized = value.trim();
  if (normalized) {
    localStorage.setItem(CLIENT_USER_NAME_KEY, normalized);
    return normalized;
  }
  // Empty display name is never meaningful; fall back to the device name so the
  // host-side list still has a human-readable label to show.
  localStorage.removeItem(CLIENT_USER_NAME_KEY);
  return getClientName();
}

export function setClientName(value: string): string {
  const normalized = value.trim() || defaultClientName(getOrCreateClientId());
  localStorage.setItem(CLIENT_NAME_KEY, normalized);
  return normalized;
}

export function getClientIdentity(): ClientIdentity {
  return {
    clientId: getOrCreateClientId(),
    clientName: getClientName()
  };
}

export function getCurrentActor(): ActorInfo {
  if (window.location.pathname.startsWith("/client")) {
    const identity = getClientIdentity();
    return {
      type: "client",
      id: identity.clientId,
      name: identity.clientName || "客户端"
    };
  }

  return {
    type: "host",
    id: "host",
    name: "主机"
  };
}

export function getActorHeaders(): Record<string, string> {
  const actor = getCurrentActor();
  return {
    "X-Actor-Type": actor.type,
    "X-Actor-Id": actor.id ?? "",
    "X-Actor-Name": encodeURIComponent(actor.name)
  };
}
