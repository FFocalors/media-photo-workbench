/**
 * 前端 API 客户端。
 * 所有接口统一使用 { ok, data, error } 响应格式。
 * API 不可用时抛出错误，由调用方处理。
 */

// 声明全局类型已在 src/global.d.ts 中定义
const CLIENT_API_BASE_KEY = "mediaPhotoWorkbench.clientApiBaseUrl";
const CLIENT_RECENT_HOSTS_KEY = "mediaPhotoWorkbench.clientRecentHosts";

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("主机地址必须以 http:// 或 https:// 开头");
  }
  return trimmed;
}

export function setClientApiBase(baseUrl: string): string {
  const normalized = normalizeApiBaseUrl(baseUrl);
  localStorage.setItem(CLIENT_API_BASE_KEY, normalized);
  saveRecentClientHost(normalized);
  return normalized;
}

export function getClientApiBase(): string {
  return localStorage.getItem(CLIENT_API_BASE_KEY) ?? "";
}

export function clearClientApiBase(): void {
  localStorage.removeItem(CLIENT_API_BASE_KEY);
}

export function getRecentClientHosts(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLIENT_RECENT_HOSTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentClientHost(baseUrl: string): void {
  const hosts = [baseUrl, ...getRecentClientHosts().filter((item) => item !== baseUrl)].slice(0, 6);
  localStorage.setItem(CLIENT_RECENT_HOSTS_KEY, JSON.stringify(hosts));
}

export function getApiBase(): string {
  if (window.location.pathname.startsWith("/client")) {
    const clientBase = getClientApiBase();
    if (clientBase) return clientBase;
  }
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
  return parseApiResponse<T>(res);
}

async function requestFromBase<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${normalizeApiBaseUrl(baseUrl)}${path}`, options);
  return parseApiResponse<T>(res);
}

async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return await res.json() as ApiResponse<T>;
  }

  const text = await res.text();
  const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
  return {
    ok: false,
    data: null as T,
    error: {
      code: `HTTP_${res.status || "NON_JSON_RESPONSE"}`,
      message: looksLikeHtml
        ? "接口返回了前端页面而不是 JSON。请重启完整应用，确认本地后端已加载最新接口。"
        : (text.trim() || `接口返回非 JSON 响应，HTTP ${res.status}`)
    }
  };
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
  network?: {
    localhost: string;
    lanAddresses: Array<{ name: string; address: string; family: string; internal: boolean }>;
    hotspotAddress: string;
  };
}

export async function fetchHealth(): Promise<ApiResponse<HealthData>> {
  return request<HealthData>("/api/health");
}

export async function fetchHealthFrom(baseUrl: string): Promise<ApiResponse<HealthData>> {
  return requestFromBase<HealthData>(baseUrl, "/api/health");
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

export async function fetchEventTrash(): Promise<ApiResponse<EventData[]>> {
  return request<EventData[]>("/api/events/trash");
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

export async function restoreEvent(id: string, status: "active" | "draft" = "active"): Promise<ApiResponse<EventData>> {
  return request<EventData>(`/api/events/${id}/restore`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export interface EventPurgeData {
  eventId: string;
  eventName: string;
  workingPath: string;
  archivePath: string;
  includeArchive: boolean;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: {
    events: number;
    images: number;
    imageTags: number;
    downloadLogs: number;
    exportJobs: number;
    operationLogs: number;
    archivedEvents: number;
  };
}

export async function purgeEvent(id: string, includeArchive = true): Promise<ApiResponse<EventPurgeData>> {
  return request<EventPurgeData>(`/api/events/${id}/purge`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ includeArchive })
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
  sourceType: "host_import" | "client_upload";
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

export interface ClientUploadData extends ImportStartData {
  photographer: string;
  device: string;
  remark: string;
}

export async function uploadClientImages(
  eventId: string,
  input: {
    files: File[];
    photographer?: string;
    device?: string;
    remark?: string;
  }
): Promise<ApiResponse<ClientUploadData>> {
  const formData = new FormData();
  for (const file of input.files) {
    formData.append("files", file);
  }
  formData.append("photographer", input.photographer ?? "");
  formData.append("device", input.device ?? "");
  formData.append("remark", input.remark ?? "");

  return request<ClientUploadData>(`/api/events/${eventId}/upload`, {
    method: "POST",
    body: formData
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
  original_path?: string;
  thumb_path?: string;
  preview_path?: string;
  edited_path?: string;
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

export async function fetchEventTrashedImages(eventId: string, params: EventImagesParams = {}): Promise<ApiResponse<EventImagesData>> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const response = await request<EventImagesData>(`/api/events/${eventId}/images/trash${query ? `?${query}` : ""}`);
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

export async function restoreImage(id: string): Promise<ApiResponse<EventImageData>> {
  const response = await request<EventImageData>(`/api/images/${id}/restore`, {
    method: "PATCH"
  });
  return normalizeImageResponse(response);
}

export interface ImagePurgeData {
  imageId: string;
  eventId: string;
  deletedFiles: string[];
  missingFiles: string[];
  errors: string[];
  deletedRecords: number;
}

export async function purgeImage(id: string): Promise<ApiResponse<ImagePurgeData>> {
  return request<ImagePurgeData>(`/api/images/${id}/purge`, {
    method: "DELETE"
  });
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

// ---------- Tasks ----------

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface TaskErrorItem {
  filename?: string;
  path?: string;
  imageId?: string;
  reason: string;
}

export interface TaskData {
  id: string;
  taskId?: string;
  type: string;
  eventId: string;
  title: string;
  status: TaskStatus;
  total: number;
  finished: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: TaskErrorItem[];
  result: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string;
}

export async function fetchTasks(): Promise<ApiResponse<TaskData[]>> {
  return request<TaskData[]>("/api/tasks");
}

export async function fetchTask(taskId: string): Promise<ApiResponse<TaskData>> {
  return request<TaskData>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function cancelTask(taskId: string): Promise<ApiResponse<never>> {
  return request<never>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST"
  });
}

// ---------- Batch ZIP Download ----------

export type DownloadZipType = "original" | "preview" | "edited" | "best";
export type DownloadZipFilenameMode = "original" | "sequence";

export interface CreateDownloadZipTaskData {
  taskId: string;
}

export async function createDownloadZipTask(
  eventId: string,
  input: {
    imageIds: string[];
    type?: DownloadZipType;
    filenameMode?: DownloadZipFilenameMode;
  }
): Promise<ApiResponse<CreateDownloadZipTaskData>> {
  return request<CreateDownloadZipTaskData>(`/api/events/${eventId}/download/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getDownloadPackageUrl(packageId: string): string {
  return `${getApiBase()}/api/download-packages/${encodeURIComponent(packageId)}/download`;
}

// ---------- Edit Workflow ----------

export interface EditPackageError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface EditPackageData {
  packageId: string;
  name: string;
  packageIndex: number;
  packageTotal: number;
  packagePath: string;
  downloadUrl: string;
  total: number;
  success: number;
  skipped: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  errors: EditPackageError[];
}

export interface DeleteEditPackageData {
  packageId: string;
  eventId: string;
  deletedFiles: string[];
  missingFiles: string[];
  deletedRecords: {
    exportJobs: number;
  };
}

export interface EditPackageWarning {
  type: "duplicatedImageIds";
  imageIds: string[];
  reason: string;
}

export interface EditPackagesData {
  eventId: string;
  splitMode: "count" | "custom";
  packageCount: number;
  packages: EditPackageData[];
  total: number;
  success: number;
  skipped: number;
  errors: EditPackageError[];
  warnings: EditPackageWarning[];
}

export async function createEditPackage(
  eventId: string,
  input: {
    splitMode?: "count" | "custom";
    packageCount?: number;
    packages?: Array<{ name: string; imageIds: string[] }>;
  } = {}
): Promise<ApiResponse<EditPackagesData>> {
  return request<EditPackagesData>(`/api/events/${eventId}/edit-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function fetchEditPackages(eventId: string): Promise<ApiResponse<EditPackageData[]>> {
  return request<EditPackageData[]>(`/api/events/${eventId}/edit-packages`);
}

export async function deleteEditPackage(packageId: string): Promise<ApiResponse<DeleteEditPackageData>> {
  return request<DeleteEditPackageData>(`/api/edit-packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE"
  });
}

export function getEditPackageDownloadUrl(packageId: string): string {
  return `${getApiBase()}/api/edit-packages/${encodeURIComponent(packageId)}/download`;
}

export async function downloadEditPackage(packageId: string, fallbackFilename = "待修包.zip"): Promise<void> {
  const res = await fetch(getEditPackageDownloadUrl(packageId));

  if (!res.ok) {
    let message = "待修包下载失败";
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

export interface EditedUploadError {
  filename: string;
  reason: string;
}

export interface EditedUploadItem {
  imageId: string;
  originalFilename: string;
  uploadedFilename: string;
  editedPath: string;
  matchedBy: "manifest" | "filename";
  status: "edited";
}

export interface EditedUploadData {
  total: number;
  matched: number;
  unmatched: number;
  errors: EditedUploadError[];
  items: EditedUploadItem[];
}

export async function uploadEditedImages(
  eventId: string,
  input: {
    files: File[];
    manifestFile?: File | null;
  }
): Promise<ApiResponse<EditedUploadData>> {
  const formData = new FormData();
  if (input.manifestFile) {
    formData.append("manifest", input.manifestFile);
  }
  for (const file of input.files) {
    formData.append("files", file);
  }

  return request<EditedUploadData>(`/api/events/${eventId}/edited/upload`, {
    method: "POST",
    body: formData
  });
}

// ---------- Publish Export ----------

export type PublishExportMode = "selected" | "publish" | "edited" | "rating";
export type PublishExportSize = "original" | "3000px" | "1920px";
export type PublishExportFilenameMode = "original" | "event_original" | "sequence";

export interface PublishExportError {
  imageId?: string;
  filename: string;
  reason: string;
}

export interface PublishExportData {
  jobId: string;
  eventId: string;
  mode: PublishExportMode;
  size: PublishExportSize;
  quality: number;
  filenameMode: PublishExportFilenameMode;
  limitFileSize10Mb: boolean;
  status: "success" | "failed";
  total: number;
  success: number;
  failed: number;
  outputDir: string;
  zipPath: string;
  downloadUrl: string;
  errors: PublishExportError[];
  createdAt: string;
  updatedAt: string;
}

export async function createPublishExport(
  eventId: string,
  input: {
    mode: PublishExportMode;
    imageIds?: string[];
    ratingMin?: number;
    size: PublishExportSize;
    quality: number;
    filenameMode?: PublishExportFilenameMode;
    limitFileSize10Mb?: boolean;
  }
): Promise<ApiResponse<PublishExportData>> {
  return request<PublishExportData>(`/api/events/${eventId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function fetchPublishExport(jobId: string): Promise<ApiResponse<PublishExportData>> {
  return request<PublishExportData>(`/api/exports/${encodeURIComponent(jobId)}`);
}

export function getPublishExportDownloadUrl(jobId: string): string {
  return `${getApiBase()}/api/exports/${encodeURIComponent(jobId)}/download`;
}

export async function downloadPublishExport(jobId: string, fallbackFilename = "publish.zip"): Promise<void> {
  const res = await fetch(getPublishExportDownloadUrl(jobId));

  if (!res.ok) {
    let message = "发布包下载失败";
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

// ---------- Archive ----------

export interface ArchiveMissingFile {
  imageId?: string;
  type: "original" | "edited" | "export";
  sourcePath: string;
  reason: string;
}

export interface ArchivePrepareData {
  archivePath: string;
  totalImages: number;
  thumbCopied: number;
  originalCopied: number;
  editedCopied: number;
  exportCopied: number;
  missingFiles: ArchiveMissingFile[];
  manifestPath: string;
  eventDbPath: string;
}

export interface ArchiveVerifyData {
  archivePath: string;
  verified: boolean;
  missingFiles: string[];
  mismatchedFiles: Array<{ path: string; expectedHash: string; actualHash: string }>;
  checkedAt: string;
}

export interface ArchivedEventData {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_date: string;
  total_images: number;
  edited_images: number;
  published_images: number;
  archive_path: string;
  archived_at: string;
}

export interface ArchiveMetadataFileStatus {
  name: string;
  path: string;
  exists: boolean;
  size: number;
}

export interface ArchivedImageSummary {
  image_id: string;
  original_filename: string;
  stored_filename: string;
  rating: number;
  status: string;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  shot_at: string;
  original_path: string;
  edited_path: string;
  file_hash: string;
  thumb_url: string;
  thumb_archive_path: string;
  has_thumb: boolean;
  has_original: boolean;
  has_edited: boolean;
  original_retained: boolean;
  edited_retained: boolean;
}

export interface ArchivedEventDetailData {
  archivedEvent: ArchivedEventData;
  event: {
    id: string;
    name: string;
    slug: string;
    date: string;
    status: "archived";
  };
  archivePath: string;
  archivedAt: string;
  counts: {
    total_images: number;
    thumb_files: number;
    original_files: number;
    edited_files: number;
    export_files: number;
    missing_files: number;
  };
  files: Array<{
    image_id: string;
    type: "thumb" | "original" | "edited" | "export";
    source_path: string;
    archive_path: string;
    exists: boolean;
    file_hash: string;
    size: number;
  }>;
  images: ArchivedImageSummary[];
  missingFiles: string[];
  metadataFiles: ArchiveMetadataFileStatus[];
}

export interface ArchivedEventDeleteData {
  id: string;
  eventId: string;
  archivePath: string;
  deletedArchive: boolean;
  missingFiles: string[];
  deletedRecords: {
    archivedEvents: number;
  };
}

export interface ArchiveCleanupData {
  eventId: string;
  status: "archived";
  workingDir: string;
  archivePath: string;
  cleaned: boolean;
  archivedEvent: ArchivedEventData;
}

export async function prepareEventArchive(eventId: string): Promise<ApiResponse<ArchivePrepareData>> {
  return request<ArchivePrepareData>(`/api/events/${eventId}/archive/prepare`, {
    method: "POST"
  });
}

export async function verifyEventArchive(eventId: string, archivePath?: string): Promise<ApiResponse<ArchiveVerifyData>> {
  return request<ArchiveVerifyData>(`/api/events/${eventId}/archive/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archivePath })
  });
}

export async function cleanupEventArchive(eventId: string, archivePath: string): Promise<ApiResponse<ArchiveCleanupData>> {
  return request<ArchiveCleanupData>(`/api/events/${eventId}/archive/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, archivePath })
  });
}

export async function fetchArchivedEvents(): Promise<ApiResponse<ArchivedEventData[]>> {
  return request<ArchivedEventData[]>("/api/archived-events");
}

export async function fetchArchivedEventDetail(id: string): Promise<ApiResponse<ArchivedEventDetailData>> {
  return request<ArchivedEventDetailData>(`/api/archived-events/${encodeURIComponent(id)}`);
}

export async function deleteArchivedEvent(id: string): Promise<ApiResponse<ArchivedEventDeleteData>> {
  return request<ArchivedEventDeleteData>(`/api/archived-events/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
