/**
 * 前端 API 客户端。
 * 所有接口统一使用 { ok, data, error } 响应格式。
 * API 不可用时抛出错误，由调用方处理。
 */

// 声明全局类型已在 src/global.d.ts 中定义
function getApiBase(): string {
  return (window as any).mediaPhotoWorkbench?.apiBaseUrl ?? "http://localhost:3030";
}

// ---------- 统一响应类型 ----------

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error: { code: string; message: string } | null;
}

/**
 * 通用请求封装。
 * 自动解析 JSON 并检查 ok 字段。
 */
async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${getApiBase()}${path}`, options);
  const json = await res.json();
  return json as ApiResponse<T>;
}

// ---------- Health ----------

export interface HealthData {
  service: string;
  server: { port: number; status: string };
  database: { status: string };
  repository: {
    configured: boolean;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    freeSpace: number | null;
    path: string;
  };
  config: {
    loaded: boolean;
    server: { port: number };
    repository: { path: string };
  };
}

export async function fetchHealth(): Promise<ApiResponse<HealthData>> {
  return request<HealthData>("/api/health");
}

// ---------- Settings ----------

export interface SettingsData {
  server: { port: number };
  repository: { path: string };
  database: { path: string };
}

export async function fetchSettings(): Promise<ApiResponse<SettingsData>> {
  return request<SettingsData>("/api/settings");
}

// ---------- Repository ----------

export interface RepositoryCheckData {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  freeSpace: number | null;
  path: string;
}

export async function checkRepository(): Promise<ApiResponse<RepositoryCheckData>> {
  return request<RepositoryCheckData>("/api/repository/check");
}

export interface UpdateRepositoryData extends RepositoryCheckData {
  saved: boolean;
}

export async function updateRepositoryPath(
  repoPath: string
): Promise<ApiResponse<UpdateRepositoryData>> {
  return request<UpdateRepositoryData>("/api/settings/repository", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath })
  });
}

// ---------- Events ----------

export interface EventData {
  id: string;
  name: string;
  slug: string;
  date: string;
  location: string;
  status: string;
  total_images: number;
  selected_images: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEventData {
  event: EventData;
  workingDir: { created: boolean; path: string };
}

export async function fetchEvents(status?: string): Promise<ApiResponse<EventData[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<EventData[]>(`/api/events${query}`);
}

export async function fetchEventById(id: string): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`);
}

export async function createEvent(input: {
  name: string;
  slug?: string;
  date: string;
  location?: string;
}): Promise<ApiResponse<CreateEventData>> {
  return request<CreateEventData>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateEvent(
  id: string,
  input: { name?: string; date?: string; location?: string }
): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateEventStatus(
  id: string,
  status: string
): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}
