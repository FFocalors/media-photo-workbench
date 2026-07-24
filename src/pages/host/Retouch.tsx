import { AlertTriangle, CheckCircle2, Download, FileArchive, ImageOff, PackageCheck, Plus, Trash2, UploadCloud } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { TransientNotice } from "../../components/ui/States";
import {
  createEditPackage,
  deleteEditPackage,
  downloadEditPackage,
  EditedUploadData,
  EditedUploadTaskData,
  EditPackageData,
  EventData,
  EventImageData,
  fetchEditPackages,
  fetchEventImages,
  fetchEvents,
  fetchTask,
  TaskData,
  uploadEditedImages
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";
import { formatTaskDuration, getTaskStats } from "../../lib/taskStats";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);
const supportedEditedExtensions = new Set([".jpg", ".jpeg"]);

type PackageMode = "single" | "count" | "custom";

interface CustomPackageDraft {
  id: string;
  name: string;
  imageIds: string[];
}

function createCustomPackageDraft(index: number): CustomPackageDraft {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: `自定义包 ${index}`,
    imageIds: []
  };
}

function isEditedUploadTaskData(data: EditedUploadData | EditedUploadTaskData): data is EditedUploadTaskData {
  return typeof (data as EditedUploadTaskData).taskId === "string";
}

function getEditedUploadResultFromTask(task: TaskData): EditedUploadData | null {
  const result = task.result;
  if (!result) return null;
  const total = Number(result.total ?? task.total ?? 0);
  const matched = Number(result.matched ?? task.successCount ?? 0);
  const unmatched = Number(result.unmatched ?? task.failedCount ?? 0);
  return {
    total: Number.isFinite(total) ? total : 0,
    matched: Number.isFinite(matched) ? matched : 0,
    unmatched: Number.isFinite(unmatched) ? unmatched : 0,
    errors: Array.isArray(result.errors) ? result.errors as EditedUploadData["errors"] : task.errors.map((error) => ({
      filename: error.filename ?? "",
      reason: error.reason
    })),
    items: Array.isArray(result.items) ? result.items as EditedUploadData["items"] : []
  };
}

function getEditPackageLabel(editPackage: Pick<EditPackageData, "name" | "packageIndex" | "packageTotal">): string {
  return editPackage.name || `第 ${editPackage.packageIndex} / ${editPackage.packageTotal} 包`;
}

interface DroppedFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
}

function isSupportedEditedImage(file: File): boolean {
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";
  return supportedEditedExtensions.has(extension);
}

async function readFileEntry(entry: DroppedFileSystemEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("无法读取拖入的文件"));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(entry: DroppedFileSystemEntry): Promise<DroppedFileSystemEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];

  const entries: DroppedFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
}

async function collectDroppedFiles(entry: DroppedFileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [await readFileEntry(entry)];
  }
  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry);
  const nested = await Promise.all(children.map(collectDroppedFiles));
  return nested.flat();
}

async function getDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.() as DroppedFileSystemEntry | null | undefined)
    .filter((entry): entry is DroppedFileSystemEntry => Boolean(entry));

  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }

  const files = await Promise.all(entries.map(collectDroppedFiles));
  return files.flat();
}

export function RetouchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.includes("done") ? "done" : "todo";
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [editImages, setEditImages] = useState<EventImageData[]>([]);
  const [editTotal, setEditTotal] = useState(0);
  const [editedTotal, setEditedTotal] = useState(0);
  const [lastPackage, setLastPackage] = useState<EditPackageData | null>(null);
  const [editPackages, setEditPackages] = useState<EditPackageData[]>([]);
  const [packageMode, setPackageMode] = useState<PackageMode>("single");
  const [packageCount, setPackageCount] = useState(1);
  const [customPackages, setCustomPackages] = useState<CustomPackageDraft[]>(() => [createCustomPackageDraft(1)]);
  const [activeCustomPackageId, setActiveCustomPackageId] = useState("");
  const [uploadResult, setUploadResult] = useState<EditedUploadData | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [downloadingPackageId, setDownloadingPackageId] = useState("");
  const [uploadingEdited, setUploadingEdited] = useState(false);
  const [deletePackageTarget, setDeletePackageTarget] = useState<EditPackageData | null>(null);
  const [deletingPackageId, setDeletingPackageId] = useState("");

  const setCurrentPageEvent = useCurrentPageEventStore((s) => s.setCurrentPageEvent);
  const clearCurrentPageEvent = useCurrentPageEventStore((s) => s.clearCurrentPageEvent);

  const selectedEventName = events.find((e) => e.id === selectedEventId)?.name ?? null;

  useEffect(() => {
    if (selectedEventId && selectedEventName) {
      setCurrentPageEvent({ eventId: selectedEventId, eventName: selectedEventName }, "retouch");
    }
    return () => { clearCurrentPageEvent("retouch"); };
  }, [selectedEventId, selectedEventName, setCurrentPageEvent, clearCurrentPageEvent]);

  const originalMissingCount = useMemo(() => editImages.filter((image) => !image.original_exists).length, [editImages]);
  const activeCustomPackage = useMemo(
    () => customPackages.find((item) => item.id === activeCustomPackageId) ?? customPackages[0],
    [activeCustomPackageId, customPackages]
  );

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "请先创建活动并导入图片，再进入修图流转。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请通过 pnpm dev 启动完整应用。" });
    }
  }, []);

  const loadStats = useCallback(async () => {
    if (!selectedEventId) {
      setEditImages([]);
      setEditTotal(0);
      setEditedTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [editRes, editedRes] = await Promise.all([
        fetchEventImages(selectedEventId, { status: "edit", pageSize: 200 }),
        fetchEventImages(selectedEventId, { status: "edited", pageSize: 1 })
      ]);

      if (editRes.ok && editRes.data) {
        setEditImages(editRes.data.items);
        setEditTotal(editRes.data.total);
      } else {
        setMessage({ tone: "danger", title: "待修图读取失败", body: editRes.error?.message || "无法读取待修图。" });
      }

      if (editedRes.ok && editedRes.data) {
        setEditedTotal(editedRes.data.total);
      } else {
        setMessage({ tone: "danger", title: "已修图读取失败", body: editedRes.error?.message || "无法读取已修图。" });
      }

      const packageRes = await fetchEditPackages(selectedEventId);
      if (packageRes.ok && packageRes.data) {
        setEditPackages(packageRes.data);
        setLastPackage(packageRes.data[0] ?? null);
      }
    } catch {
      setMessage({ tone: "danger", title: "修图数据读取失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    setActiveCustomPackageId((current) => current || customPackages[0]?.id || "");
  }, [customPackages]);

  const handleCreatePackage = async () => {
    if (!selectedEventId) return;
    setCreatingPackage(true);
    setMessage(null);

    try {
      const input = packageMode === "custom"
        ? {
          splitMode: "custom" as const,
          packages: customPackages.map((item) => ({
            name: item.name.trim(),
            imageIds: item.imageIds
          }))
        }
        : {
          splitMode: "count" as const,
          packageCount: packageMode === "single" ? 1 : packageCount
        };
      const res = await createEditPackage(selectedEventId, input);
      if (res.ok && res.data) {
        setEditPackages(res.data.packages);
        setLastPackage(res.data.packages[0] ?? null);
        const warningText = res.data.warnings.length ? ` ${res.data.warnings[0].reason}。` : "";
        setMessage({ tone: "success", title: "待修包已生成", body: `生成 ${res.data.packageCount} 个包，成功打包 ${res.data.success} 张，跳过 ${res.data.skipped} 张。${warningText}` });
      } else {
        const tone = res.error?.code === "NO_EDIT_IMAGES" ? "warning" : "danger";
        setMessage({ tone, title: "待修包生成失败", body: res.error?.message || "生成待修包失败。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包生成失败", body: err?.message || "请求失败。" });
    } finally {
      setCreatingPackage(false);
    }
  };

  const handleDownloadPackage = async (editPackage: EditPackageData) => {
    setDownloadingPackageId(editPackage.packageId);
    try {
      await downloadEditPackage(editPackage.packageId);
      setMessage({ tone: "success", title: "下载已开始", body: "待修包 ZIP 已开始下载。" });
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包下载失败", body: err?.message || "下载失败。" });
    } finally {
      setDownloadingPackageId("");
    }
  };

  const handleDeletePackage = async () => {
    if (!deletePackageTarget) return;
    setDeletingPackageId(deletePackageTarget.packageId);
    try {
      const res = await deleteEditPackage(deletePackageTarget.packageId);
      if (res.ok && res.data) {
        const nextPackages = editPackages.filter((item) => item.packageId !== deletePackageTarget.packageId);
        setEditPackages(nextPackages);
        setLastPackage(nextPackages[0] ?? null);
        setDeletePackageTarget(null);
        const missingText = res.data.missingFiles.length > 0 ? ` 原 ZIP 文件已不存在，已清理记录。` : "";
        setMessage({ tone: "success", title: "待修包已删除", body: `已删除待修包记录和 ZIP 文件。${missingText}` });
      } else {
        setMessage({ tone: "danger", title: "待修包删除失败", body: res.error?.message || "删除待修包失败。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包删除失败", body: err?.message || "请求失败。" });
    } finally {
      setDeletingPackageId("");
    }
  };

  const handleUploadComplete = (result: EditedUploadData) => {
    setUploadResult(result);
    setMessage({ tone: "success", title: "已修图上传完成", body: `匹配 ${result.matched} 张，未匹配 ${result.unmatched} 张。` });
    void loadStats();
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-5 xl:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">修图流转</h1>
          <p className="mt-1 text-sm text-slate-500">生成待修包，回传已修图，并将图片状态同步为已修图。</p>
        </div>
        <label className="min-w-64 max-w-full sm:min-w-72">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => {
              setSelectedEventId(event.target.value);
              setLastPackage(null);
              setUploadResult(null);
              setMessage(null);
            }}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无可用活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard icon={<PackageCheck size={18} />} label="待修图" loading={loading} value={editTotal} />
        <MetricCard icon={<CheckCircle2 size={18} />} label="已修图" loading={loading} value={editedTotal} />
        <MetricCard icon={<ImageOff size={18} />} label="原图缺失" loading={loading} tone="danger" value={originalMissingCount} />
        <MetricCard icon={<FileArchive size={18} />} label="最近待修包" textValue={lastPackage ? `${lastPackage.success}/${lastPackage.total}` : "未生成"} />
      </div>

      <TransientNotice className="mb-6" message={message} onDismiss={() => setMessage(null)} />

      <div className="mb-6 flex border-b border-slate-200">
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "todo" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/retouch")}
          type="button"
        >
          待修包
        </button>
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "done" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/done")}
          type="button"
        >
          已修图回传
        </button>
      </div>

      {tab === "todo" ? (
        <RetouchTodo
          canCreate={Boolean(selectedEventId)}
          creatingPackage={creatingPackage}
          downloadingPackageId={downloadingPackageId}
          editImages={editImages}
          editPackages={editPackages}
          editTotal={editTotal}
          lastPackage={lastPackage}
          packageMode={packageMode}
          packageCount={packageCount}
          activeCustomPackageId={activeCustomPackage?.id || ""}
          customPackages={customPackages}
          onCreatePackage={handleCreatePackage}
          onCustomPackagesChange={setCustomPackages}
          onDeletePackage={setDeletePackageTarget}
          onDownloadPackage={handleDownloadPackage}
          onPackageModeChange={setPackageMode}
          onPackageCountChange={setPackageCount}
          onSelectCustomPackage={setActiveCustomPackageId}
        />
      ) : (
        <RetouchDone
          canUpload={Boolean(selectedEventId)}
          selectedEventId={selectedEventId}
          uploadResult={uploadResult}
          uploading={uploadingEdited}
          onResult={handleUploadComplete}
          onSetMessage={setMessage}
          onUploadingChange={setUploadingEdited}
        />
      )}

      {deletePackageTarget && (
        <ConfirmDialog
          confirmLabel="删除待修包"
          confirming={deletingPackageId === deletePackageTarget.packageId}
          description="此操作只删除已生成的待修包 ZIP 和待修包记录，不会删除待修图片、原图或已修图。"
          details={[
            { label: "待修包", value: getEditPackageLabel(deletePackageTarget) },
            { label: "图片数", value: `${deletePackageTarget.success}/${deletePackageTarget.total}` },
            { label: "路径", value: deletePackageTarget.packagePath || "未记录" }
          ]}
          onCancel={() => setDeletePackageTarget(null)}
          onConfirm={() => void handleDeletePackage()}
          title="删除待修包"
          tone="danger"
        />
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, textValue, loading = false, tone = "default" }: {
  icon: ReactNode;
  label: string;
  value?: number;
  textValue?: string;
  loading?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg", tone === "danger" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600")}>{icon}</div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{loading ? "..." : textValue ?? (value ?? 0).toLocaleString()}</p>
    </div>
  );
}

function RetouchTodo({
  canCreate,
  creatingPackage,
  downloadingPackageId,
  editImages,
  editPackages,
  editTotal,
  lastPackage,
  packageMode,
  packageCount,
  activeCustomPackageId,
  customPackages,
  onCreatePackage,
  onCustomPackagesChange,
  onDeletePackage,
  onDownloadPackage,
  onPackageModeChange,
  onPackageCountChange,
  onSelectCustomPackage
}: {
  canCreate: boolean;
  creatingPackage: boolean;
  downloadingPackageId: string;
  editImages: EventImageData[];
  editPackages: EditPackageData[];
  editTotal: number;
  lastPackage: EditPackageData | null;
  packageMode: PackageMode;
  packageCount: number;
  activeCustomPackageId: string;
  customPackages: CustomPackageDraft[];
  onCreatePackage: () => void;
  onCustomPackagesChange: (packages: CustomPackageDraft[]) => void;
  onDeletePackage: (editPackage: EditPackageData) => void;
  onDownloadPackage: (editPackage: EditPackageData) => void;
  onPackageModeChange: (mode: PackageMode) => void;
  onPackageCountChange: (value: number) => void;
  onSelectCustomPackage: (id: string) => void;
}) {
  const missing = editImages.filter((image) => !image.original_exists);
  const assignedImageIds = useMemo(() => new Set(customPackages.flatMap((item) => item.imageIds)), [customPackages]);
  const activePackage = customPackages.find((item) => item.id === activeCustomPackageId) ?? customPackages[0];
  const activeSelectedIds = new Set(activePackage?.imageIds ?? []);
  const unassignedCount = Math.max(editTotal - assignedImageIds.size, 0);

  const updateCustomPackage = (id: string, patch: Partial<CustomPackageDraft>) => {
    onCustomPackagesChange(customPackages.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const toggleImageInActivePackage = (imageId: string) => {
    if (!activePackage) return;
    const exists = activePackage.imageIds.includes(imageId);
    updateCustomPackage(activePackage.id, {
      imageIds: exists ? activePackage.imageIds.filter((id) => id !== imageId) : [...activePackage.imageIds, imageId]
    });
  };

  const removeCustomPackage = (id: string) => {
    if (customPackages.length <= 1) return;
    const next = customPackages.filter((item) => item.id !== id);
    onCustomPackagesChange(next);
    if (activeCustomPackageId === id) {
      onSelectCustomPackage(next[0]?.id || "");
    }
  };

  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm xl:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">待修包生成</h3>
          <p className="mt-1 text-xs text-slate-500">
            当前活动有 {editTotal.toLocaleString()} 张图片被标记为“待修图”。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap rounded-lg bg-slate-100 p-1">
            {[
              ["single", "一个包"],
              ["count", "平均拆包"],
              ["custom", "自定义分包"]
            ].map(([value, label]) => (
              <button
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  packageMode === value ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
                key={value}
                onClick={() => onPackageModeChange(value as PackageMode)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {packageMode === "count" && (
          <label className="w-32">
            <span className="mb-1 block text-[11px] font-medium text-slate-400">拆分包数</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
              max={20}
              min={1}
              onChange={(event) => onPackageCountChange(Math.min(Math.max(Number(event.target.value) || 1, 1), 20))}
              type="number"
              value={packageCount}
            />
          </label>
          )}
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canCreate || creatingPackage}
            onClick={onCreatePackage}
            type="button"
          >
            <FileArchive size={16} />
            {creatingPackage ? "生成中..." : "生成待修包"}
          </button>
        </div>
      </div>

      {editTotal === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-100 bg-slate-50 p-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
            <PackageCheck className="text-slate-400" size={28} />
          </div>
          <p className="text-sm font-medium text-slate-700">暂无待修图片，请先在图片墙将图片标记为“待修图”。</p>
        </div>
      ) : (
        <div className={cn("grid flex-1 gap-6 2xl:grid-cols-[1fr_320px]", packageMode === "custom" && "2xl:grid-cols-[1fr_380px]")}>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h4 className="text-sm font-medium text-slate-700">待修图片预览</h4>
              {packageMode === "custom" && <span className="text-xs text-slate-400">未分配 {unassignedCount} 张</span>}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {(packageMode === "custom" ? editImages : editImages.slice(0, 12)).map((image) => (
                <button
                  className={cn(
                    "overflow-hidden rounded-lg border bg-white text-left transition",
                    packageMode === "custom"
                      ? activeSelectedIds.has(image.id)
                        ? "border-blue-500 ring-2 ring-blue-100"
                        : assignedImageIds.has(image.id)
                          ? "border-emerald-200"
                          : "border-slate-100 hover:border-blue-200"
                      : "border-slate-100"
                  )}
                  disabled={packageMode !== "custom"}
                  key={image.id}
                  onClick={() => toggleImageInActivePackage(image.id)}
                  type="button"
                >
                  <img alt={image.original_filename} className="h-20 w-full object-cover" src={image.thumb_url} />
                  <div className="px-2 py-1">
                    <p className="truncate text-xs text-slate-500">{image.original_filename}</p>
                    {packageMode === "custom" && (
                      <p className={cn("mt-0.5 truncate text-[11px]", assignedImageIds.has(image.id) ? "text-emerald-600" : "text-slate-400")}>
                        {customPackages.filter((item) => item.imageIds.includes(image.id)).map((item) => item.name || "未命名").join(" / ") || "未分配"}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            {packageMode === "custom" && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-slate-700">自定义包</h4>
                  <button
                    className="flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-blue-600 shadow-sm hover:bg-blue-50"
                    onClick={() => {
                      const next = [...customPackages, createCustomPackageDraft(customPackages.length + 1)];
                      onCustomPackagesChange(next);
                      onSelectCustomPackage(next[next.length - 1].id);
                    }}
                    type="button"
                  >
                    <Plus size={13} />
                    新增包
                  </button>
                </div>
                <div className="space-y-2">
                  {customPackages.map((item) => (
                    <div className={cn("rounded-lg border bg-white p-3", activeCustomPackageId === item.id ? "border-blue-300" : "border-slate-100")} key={item.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          className="min-w-0 flex-1 text-left text-xs font-medium text-slate-500"
                          onClick={() => onSelectCustomPackage(item.id)}
                          type="button"
                        >
                          {activeCustomPackageId === item.id ? "当前编辑" : "选择编辑"} · {item.imageIds.length} 张
                        </button>
                        <button
                          className="text-slate-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={customPackages.length <= 1}
                          onClick={() => removeCustomPackage(item.id)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <input
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-400"
                        onChange={(event) => updateCustomPackage(item.id, { name: event.target.value })}
                        value={item.name}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-100 p-4">
              <h4 className="text-sm font-medium text-slate-700">已生成待修包</h4>
              {editPackages.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {editPackages.slice(0, 8).map((item) => (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3" key={item.packageId}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium text-slate-700">{getEditPackageLabel(item)}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
                            disabled={downloadingPackageId === item.packageId}
                            onClick={() => onDownloadPackage(item)}
                            type="button"
                          >
                            <Download size={13} />
                            {downloadingPackageId === item.packageId ? "下载中" : "下载"}
                          </button>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-red-100 bg-white text-red-500 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => onDeletePackage(item)}
                            title="删除待修包"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                        {item.name && <span className="col-span-3">第 {item.packageIndex} / {item.packageTotal} 包</span>}
                        <span>总数 {item.total}</span>
                        <span>成功 {item.success}</span>
                        <span>跳过 {item.skipped}</span>
                      </div>
                    </div>
                  ))}
                  {lastPackage && <p className="truncate text-xs text-slate-400" title={lastPackage.packagePath}>最近路径：{lastPackage.packagePath}</p>}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">尚未生成待修包。</p>
              )}
            </div>

            {missing.length > 0 && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <h4 className="flex items-center gap-2 text-sm font-medium text-red-800">
                  <AlertTriangle size={15} />
                  原图缺失
                </h4>
                <div className="mt-3 space-y-2">
                  {missing.slice(0, 5).map((image) => <p className="truncate text-xs text-red-700" key={image.id}>{image.original_filename}</p>)}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function RetouchDone({ canUpload, selectedEventId, uploadResult, uploading, onResult, onSetMessage, onUploadingChange }: {
  canUpload: boolean;
  selectedEventId: string;
  uploadResult: EditedUploadData | null;
  uploading: boolean;
  onResult: (result: EditedUploadData) => void;
  onSetMessage: (message: { tone: "success" | "warning" | "danger" | "info"; title: string; body: string }) => void;
  onUploadingChange: (value: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [editedFiles, setEditedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);

  const applyUploadTask = useCallback((task: TaskData) => {
    setActiveTask(task);
    if (task.status === "success") {
      const result = getEditedUploadResultFromTask(task);
      if (result) {
        onResult(result);
        onSetMessage({
          tone: "success",
          title: "已修图回传完成",
          body: `匹配 ${result.matched} 张，未匹配 ${result.unmatched} 张。`
        });
      }
      setActiveTaskId("");
      onUploadingChange(false);
    } else if (task.status === "failed") {
      onSetMessage({
        tone: "danger",
        title: "已修图回传失败",
        body: task.errors[0]?.reason || "回传任务失败。"
      });
      setActiveTaskId("");
      onUploadingChange(false);
    } else if (task.status === "cancelled") {
      onSetMessage({
        tone: "warning",
        title: "已修图回传已取消",
        body: "未处理的文件已停止回传，已处理成功的图片会保留。"
      });
      setActiveTaskId("");
      onUploadingChange(false);
    }
  }, [onResult, onSetMessage, onUploadingChange]);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;
    fetchTask(activeTaskId)
      .then((res) => {
        if (!cancelled && res.ok && res.data) applyUploadTask(res.data);
      })
      .catch(() => {
        // Task center remains the source of truth; page-level message is updated by realtime events.
      });

    const unsubscribe = subscribeRealtimeTaskEvent((payload) => {
      const task = { ...payload, id: payload.id || payload.taskId || "" } as TaskData;
      if (task.id === activeTaskId) applyUploadTask(task);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeTaskId, applyUploadTask]);

  const handleSelectFiles = (files: File[] | FileList | null) => {
    const selected = Array.from(files ?? []);
    const manifest = selected.find((file) => file.name.toLowerCase() === "edit_manifest.json") ?? null;
    setManifestFile(manifest);
    setEditedFiles(selected.filter((file) => file.name.toLowerCase() !== "edit_manifest.json" && isSupportedEditedImage(file)));
  };

  const handleDropFiles = async (dataTransfer: DataTransfer) => {
    try {
      const files = await getDroppedFiles(dataTransfer);
      handleSelectFiles(files);
    } catch (err: any) {
      onSetMessage({ tone: "danger", title: "读取拖拽文件失败", body: err?.message || "无法读取拖入的文件夹或文件。" });
    }
  };

  const handleUpload = async () => {
    if (!selectedEventId || editedFiles.length === 0) return;
    onUploadingChange(true);
    let taskStarted = false;
    try {
      const res = await uploadEditedImages(selectedEventId, {
        files: editedFiles,
        manifestFile
      });
      if (res.ok && res.data) {
        if (isEditedUploadTaskData(res.data)) {
          taskStarted = true;
          setActiveTaskId(res.data.taskId);
          setActiveTask({
            id: res.data.taskId,
            type: "edited_upload",
            eventId: selectedEventId,
            title: `回传已修图 ${res.data.total} 张`,
            status: "pending",
            total: res.data.total,
            finished: 0,
            successCount: 0,
            failedCount: 0,
            skippedCount: 0,
            errors: [],
            result: null,
            createdAt: new Date().toISOString(),
            startedAt: "",
            updatedAt: new Date().toISOString(),
            finishedAt: "",
            elapsedMs: 0,
            estimatedRemainingMs: null,
            currentFileName: ""
          });
          onSetMessage({ tone: "info", title: "已修图回传任务已创建", body: "处理进度会在任务中心和本页面同步显示。" });
        } else {
          onResult(res.data);
        }
      } else {
        onSetMessage({ tone: "danger", title: "已修图上传失败", body: res.error?.message || "上传失败。" });
      }
    } catch (err: any) {
      onSetMessage({ tone: "danger", title: "已修图上传失败", body: err?.message || "请求失败。" });
    } finally {
      if (!taskStarted) onUploadingChange(false);
    }
  };
  const activeTaskStats = getTaskStats(activeTask);

  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm xl:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">已修图回传</h3>
          <p className="mt-1 text-xs text-slate-500">可直接拖入待修包里的“已修图回传”文件夹；系统会读取其中的 edit_manifest.json 和 JPG/JPEG。</p>
        </div>
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            选择文件
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canUpload || editedFiles.length === 0 || uploading}
            onClick={handleUpload}
            type="button"
          >
            <UploadCloud size={16} />
            {uploading ? "上传中..." : "上传已修图"}
          </button>
        </div>
      </div>

      <input
        accept=".jpg,.jpeg,image/jpeg,.json,application/json"
        className="hidden"
        multiple
        onChange={(event) => handleSelectFiles(event.target.files)}
        ref={inputRef}
        type="file"
      />

      {activeTask && (activeTask.status === "pending" || activeTask.status === "running") && (
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-blue-900">正在处理已修图回传</span>
            <span className="text-blue-700">{activeTaskStats.processed}/{activeTaskStats.total || 0}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${activeTaskStats.percent}%` }} />
          </div>
          <div className="mt-2 text-xs text-blue-700">
            成功 {activeTaskStats.success} · 失败 {activeTaskStats.failed} · 剩余 {formatTaskDuration(activeTaskStats.estimatedRemainingMs)}
            {activeTaskStats.currentFileName ? ` · ${activeTaskStats.currentFileName}` : ""}
          </div>
        </div>
      )}

      <div className="grid flex-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div
          className={cn(
            "rounded-xl border border-dashed p-5 transition-colors",
            dragActive ? "border-blue-300 bg-blue-50/70" : "border-slate-100 bg-slate-50"
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void handleDropFiles(event.dataTransfer);
          }}
        >
          <h4 className="mb-4 text-sm font-medium text-slate-700">待上传文件</h4>
          {editedFiles.length === 0 && !manifestFile ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
              <UploadCloud className={cn("mb-4", dragActive ? "text-blue-500" : "text-slate-300")} size={34} />
              <p className="text-sm font-medium text-slate-600">拖入“已修图回传”文件夹，或选择已修图 JPG/JPEG</p>
              <p className="mt-2 text-xs text-slate-400">文件夹内已包含 edit_manifest.json；完全改名的图片仍建议保留 manifest。</p>
            </div>
          ) : (
            <div className="space-y-2">
              {manifestFile && <FileRow label="manifest" name={manifestFile.name} />}
              {editedFiles.map((file) => <FileRow key={`${file.name}-${file.size}-${file.lastModified}`} label="已修图" name={file.name} />)}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <h4 className="text-sm font-medium text-slate-700">匹配结果</h4>
            {uploadResult ? (
              <div className="mt-3 space-y-2 text-sm">
                <ResultLine label="总数" value={uploadResult.total} />
                <ResultLine label="成功匹配" value={uploadResult.matched} />
                <ResultLine label="未匹配" value={uploadResult.unmatched} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">等待上传。</p>
            )}
          </div>

          {uploadResult?.items.length ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <h4 className="text-sm font-medium text-emerald-800">成功记录</h4>
              <div className="mt-3 space-y-2">
                {uploadResult.items.slice(0, 6).map((item) => (
                  <p className="truncate text-xs text-emerald-700" key={`${item.imageId}-${item.uploadedFilename}`}>
                    {item.uploadedFilename} {"->"} {item.originalFilename}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {uploadResult?.errors.length ? (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <h4 className="text-sm font-medium text-red-800">失败记录</h4>
              <div className="mt-3 space-y-2">
                {uploadResult.errors.slice(0, 8).map((error) => (
                  <div className="text-xs text-red-700" key={`${error.filename}-${error.reason}`}>
                    <p className="truncate font-medium">{error.filename}</p>
                    <p className="mt-0.5 opacity-80">{error.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FileRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
      <span className="min-w-0 truncate text-slate-700">{name}</span>
      <span className="ml-3 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{label}</span>
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value.toLocaleString()}</span>
    </div>
  );
}
