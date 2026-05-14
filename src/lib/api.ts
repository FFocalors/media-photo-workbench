/**
 * 前端 API 客户端。
 * 所有接口统一使用 { ok, data, error } 响应格式。
 * API 不可用时抛出错误，由调用方处理。
 */

// 声明全局类型已在 src/global.d.ts 中定义
export function getApiBase(): string {
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

export const eventStatusLabels = {
  draft: "草稿",
  active: "进行中",
  reviewing: "选片中",
  archived: "已归档",
  deleted: "已删除"
} as const;

export type EventStatus = keyof typeof eventStatusLabels;

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
  status: EventStatus
): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export async function deleteEvent(id: string): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}`, {
    method: "DELETE"
  });
}

// ---------- Import ----------

export interface ImportScanFile {
  filename: string;
  path: string;
  size: number;
  extension: string;
}

export interface ImportScanData {
  eventId: string;
  folderPath: string;
  count: number;
  totalSize: number;
  files: ImportScanFile[];
}

export interface ImportErrorItem {
  filename: string;
  path: string;
  reason: string;
}

export interface ImportedImageSummary {
  id: string;
  originalFilename: string;
  storedFilename: string;
  originalPath: string;
  thumbPath: string;
  previewPath: string;
}

export interface ImportStartData {
  eventId: string;
  folderPath: string;
  sourceType: "host_import";
  total: number;
  success: number;
  failed: number;
  skipped: number;
  imported: ImportedImageSummary[];
  errors: ImportErrorItem[];
}

export async function scanImportFolder(eventId: string, folderPath: string): Promise<ApiResponse<ImportScanData>> {
  return request<ImportScanData>(`/api/events/${eventId}/import/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath })
  });
}

export async function startImport(eventId: string, folderPath: string): Promise<ApiResponse<ImportStartData>> {
  return request<ImportStartData>(`/api/events/${eventId}/import/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath })
  });
}

// ---------- Images ----------

export const imageStatusLabels = {
  unselected: "未筛选",
  rejected: "废片",
  archive: "留档",
  edit: "待修图",
  edited: "已修图",
  publish: "可发布",
  published: "已发布"
} as const;

export type ImageStatus = keyof typeof imageStatusLabels;

export const imageStatusOptions = Object.keys(imageStatusLabels) as ImageStatus[];

export interface EventImageData {
  id: string;
  event_id: string;
  original_filename: string;
  stored_filename: string;
  thumb_url: string;
  preview_url: string;
  file_size: number;
  width: number;
  height: number;
  shot_at: string;
  imported_at: string;
  rating: number;
  status: ImageStatus;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  source_type: string;
  edited_available: boolean;
  original_exists: boolean;
  thumb_exists: boolean;
  preview_exists: boolean;
  edited_exists: boolean;
  is_deleted: boolean;
  deleted_at: string;
}

export interface EventImagesParams {
  page?: number;
  pageSize?: number;
  rating?: number;
  status?: ImageStatus | "all";
  source_type?: string;
  keyword?: string;
}

export interface EventImagesData {
  items: EventImageData[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizeImageData(image: EventImageData): EventImageData {
  const originalExists = typeof image.original_exists === "boolean" ? image.original_exists : true;
  const thumbExists = typeof image.thumb_exists === "boolean" ? image.thumb_exists : true;
  const previewExists = typeof image.preview_exists === "boolean" ? image.preview_exists : true;
  const editedExists = typeof image.edited_exists === "boolean" ? image.edited_exists : Boolean(image.edited_available);

  return {
    ...image,
    edited_available: typeof image.edited_available === "boolean" ? image.edited_available : editedExists,
    original_exists: originalExists,
    thumb_exists: thumbExists,
    preview_exists: previewExists,
    edited_exists: editedExists,
    is_deleted: typeof image.is_deleted === "boolean" ? image.is_deleted : false,
    deleted_at: image.deleted_at ?? ""
  };
}

function normalizeImageResponse(response: ApiResponse<EventImageData>): ApiResponse<EventImageData> {
  if (!response.ok || !response.data) {
    return response;
  }

  return {
    ...response,
    data: normalizeImageData(response.data)
  };
}

export async function fetchEventImages(eventId: string, params: EventImagesParams = {}): Promise<ApiResponse<EventImagesData>> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const response = await request<EventImagesData>(`/api/events/${eventId}/images${query ? `?${query}` : ""}`);
  if (!response.ok || !response.data) {
    return response;
  }

  return {
    ...response,
    data: {
      ...response.data,
      items: response.data.items.map(normalizeImageData)
    }
  };
}

export async function updateImageRating(id: string, rating: number): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/rating`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating })
  });
  return normalizeImageResponse(response);
}

export async function updateImageStatus(id: string, status: ImageStatus): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  return normalizeImageResponse(response);
}

export async function updateImageCategory(id: string, category: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category })
  });
  return normalizeImageResponse(response);
}

export async function updateImageRemark(id: string, remark: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/remark`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remark })
  });
  return normalizeImageResponse(response);
}

export async function deleteImage(id: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}`, {
    method: "DELETE"
  });
  return normalizeImageResponse(response);
}

export type ImageDownloadType = "original" | "preview" | "edited";

export function getImageDownloadUrl(id: string, type: ImageDownloadType): string {
  return `${getApiBase()}/api/images/${encodeURIComponent(id)}/download/${type}`;
}

function getFilenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

export async function downloadImageFile(id: string, type: ImageDownloadType, fallbackFilename = "image"): Promise<void> {
  const res = await fetch(getImageDownloadUrl(id, type));

  if (!res.ok) {
    let message = "下载失败";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
