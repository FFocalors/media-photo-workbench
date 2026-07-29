import { Download, FileArchive, PackageCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TransientNotice } from "../../components/ui/States";
import {
  downloadEditPackage,
  EditedUploadData,
  EditedUploadTaskData,
  EditPackageData,
  EventData,
  fetchEditPackages,
  fetchEvents,
  fetchTask,
  getClientApiBase,
  TaskData,
  uploadEditedImages
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";
import { formatTaskDuration, getTaskStats } from "../../lib/taskStats";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);
const supportedEditedExtensions = new Set([".jpg", ".jpeg"]);

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
  if (entry.isFile) return [await readFileEntry(entry)];
  if (!entry.isDirectory) return [];

  const children = await readDirectoryEntries(entry);
  const nested = await Promise.all(children.map(collectDroppedFiles));
  return nested.flat();
}

async function getDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.() as DroppedFileSystemEntry | null | undefined)
    .filter((entry): entry is DroppedFileSystemEntry => Boolean(entry));

  if (entries.length === 0) return Array.from(dataTransfer.files);

  const files = await Promise.all(entries.map(collectDroppedFiles));
  return files.flat();
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

export function ClientRetouchPage() {
  const hostAddress = getClientApiBase();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [packages, setPackages] = useState<EditPackageData[]>([]);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [editedFiles, setEditedFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<EditedUploadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [downloadingPackageId, setDownloadingPackageId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId), [events, selectedEventId]);
  const selectedEventName = selectedEvent?.name ?? null;
  const setCurrentPageEvent = useCurrentPageEventStore((s) => s.setCurrentPageEvent);
  const clearCurrentPageEvent = useCurrentPageEventStore((s) => s.clearCurrentPageEvent);

  useEffect(() => {
    if (selectedEventId && selectedEventName) {
      setCurrentPageEvent({ eventId: selectedEventId, eventName: selectedEventName }, "client-retouch");
    }
    return () => { clearCurrentPageEvent("client-retouch"); };
  }, [selectedEventId, selectedEventName, setCurrentPageEvent, clearCurrentPageEvent]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "主机当前没有可协作修图的活动。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取主机活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "主机未连接", body: "请先返回连接页完成连接测试。" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPackages = useCallback(async () => {
    if (!selectedEventId) {
      setPackages([]);
      return;
    }
    setLoadingPackages(true);
    try {
      const res = await fetchEditPackages(selectedEventId);
      if (res.ok && res.data) {
        setPackages(res.data);
      } else {
        setMessage({ tone: "danger", title: "待修包读取失败", body: res.error?.message || "无法读取待修包列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "待修包读取失败", body: "请求失败，请检查主机连接。" });
    } finally {
      setLoadingPackages(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const applyUploadTask = useCallback((task: TaskData) => {
    setActiveTask(task);
    if (task.status === "success") {
      const result = getEditedUploadResultFromTask(task);
      if (result) {
        setUploadResult(result);
        setMessage({ tone: "success", title: "已修图回传完成", body: `匹配 ${result.matched} 张，未匹配 ${result.unmatched} 张。` });
      }
      setActiveTaskId("");
      setUploading(false);
    } else if (task.status === "failed") {
      setMessage({ tone: "danger", title: "已修图回传失败", body: task.errors[0]?.reason || "回传任务失败。" });
      setActiveTaskId("");
      setUploading(false);
    } else if (task.status === "cancelled") {
      setMessage({ tone: "warning", title: "已修图回传已取消", body: "未处理的文件已停止回传，已处理成功的图片会保留。" });
      setActiveTaskId("");
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;
    fetchTask(activeTaskId)
      .then((res) => {
        if (!cancelled && res.ok && res.data) applyUploadTask(res.data);
      })
      .catch(() => {
        // Task center remains the source of truth; page-level state is updated by realtime events.
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
    setUploadResult(null);
  };

  const handleDropFiles = async (dataTransfer: DataTransfer) => {
    try {
      const files = await getDroppedFiles(dataTransfer);
      handleSelectFiles(files);
    } catch (err: any) {
      setMessage({ tone: "danger", title: "读取拖拽文件失败", body: err?.message || "无法读取拖入的文件夹或文件。" });
    }
  };

  const handleDownload = async (editPackage: EditPackageData) => {
    setDownloadingPackageId(editPackage.packageId);
    setMessage(null);
    try {
      await downloadEditPackage(editPackage.packageId);
      setMessage({ tone: "success", title: "下载已开始", body: `第 ${editPackage.packageIndex} / ${editPackage.packageTotal} 包已开始下载。` });
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包下载失败", body: err?.message || "下载失败。" });
    } finally {
      setDownloadingPackageId("");
    }
  };

  const handleUpload = async () => {
    if (!selectedEventId || editedFiles.length === 0) return;
    setUploading(true);
    setMessage(null);
    let taskStarted = false;
    try {
      const res = await uploadEditedImages(selectedEventId, {
        files: editedFiles,
        manifestFile
      });
      if (res.ok && res.data) {
        if (isEditedUploadTaskData(res.data)) {
          taskStarted = true;
          const now = new Date().toISOString();
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
            createdAt: now,
            startedAt: "",
            updatedAt: now,
            finishedAt: "",
            elapsedMs: 0,
            estimatedRemainingMs: null,
            currentFileName: ""
          });
          setMessage({ tone: "info", title: "已修图回传任务已创建", body: "处理进度会在任务中心和本页面同步显示。" });
        } else {
          setUploadResult(res.data);
          setMessage({ tone: "success", title: "已修图回传完成", body: `匹配 ${res.data.matched} 张，未匹配 ${res.data.unmatched} 张。` });
        }
      } else {
        setMessage({ tone: "danger", title: "已修图回传失败", body: res.error?.message || "上传失败。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "已修图回传失败", body: err?.message || "请求失败，请检查主机连接。" });
    } finally {
      if (!taskStarted) setUploading(false);
    }
  };
  const activeTaskStats = getTaskStats(activeTask);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F8F9FA]">
      <div className="border-b border-slate-100 bg-white px-4 py-5 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">修图任务</h1>
            <p className="mt-1 text-sm text-slate-500">{hostAddress || "未连接主机"}</p>
          </div>
          <label className="min-w-64 max-w-full sm:min-w-72">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
              disabled={loading}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
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
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[1fr_380px]">
          <section className="space-y-6">
            <TransientNotice message={message} onDismiss={() => setMessage(null)} />

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">待修包列表</h2>
                  <p className="mt-1 text-xs text-slate-500">{selectedEvent ? selectedEvent.name : "请选择活动"}，客户端只能下载待修包，不能生成或删除待修包。</p>
                </div>
                <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" onClick={() => void loadPackages()} type="button">
                  刷新
                </button>
              </div>

              {loadingPackages ? (
                <p className="rounded-xl bg-slate-50 p-6 text-sm text-slate-400">正在读取待修包...</p>
              ) : packages.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-100 bg-slate-50 p-8 text-center">
                  <PackageCheck className="mb-4 text-slate-300" size={34} />
                  <p className="text-sm font-medium text-slate-700">暂无待修包</p>
                  <p className="mt-2 text-xs text-slate-400">请由主机端在“修图流转”中生成待修包。</p>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {packages.map((item) => (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={item.packageId}>
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileArchive size={16} className="text-blue-600" />
                            {item.name || `第 ${item.packageIndex} / ${item.packageTotal} 包`}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            第 {item.packageIndex} / {item.packageTotal} 包 · {item.createdAt || "未知时间"}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">{item.status}</span>
                      </div>
                      <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
                        <Metric label="总数" value={item.total} />
                        <Metric label="成功" value={item.success} />
                        <Metric label="跳过" value={item.skipped} />
                      </div>
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
                        disabled={downloadingPackageId === item.packageId}
                        onClick={() => void handleDownload(item)}
                        type="button"
                      >
                        <Download size={16} />
                        {downloadingPackageId === item.packageId ? "下载中..." : "下载待修包"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">已修图回传</h2>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  onClick={() => inputRef.current?.click()}
                  type="button"
                >
                  选择文件
                </button>
              </div>
              <input
                accept=".jpg,.jpeg,image/jpeg,.json,application/json"
                className="hidden"
                multiple
                onChange={(event) => handleSelectFiles(event.target.files)}
                ref={inputRef}
                type="file"
              />
              <div
                className={cn(
                  "flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed p-5 text-center transition-colors",
                  dragActive ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"
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
                <UploadCloud className={cn("mb-3", dragActive ? "text-blue-500" : "text-slate-300")} size={32} />
                <p className="text-sm font-medium text-slate-700">拖入“已修图回传”文件夹</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">系统会读取其中的 JPG/JPEG 和 edit_manifest.json。</p>
              </div>

              {(manifestFile || editedFiles.length > 0) && (
                <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-slate-100">
                  {manifestFile && <FileRow label="manifest" name={manifestFile.name} />}
                  {editedFiles.map((file) => <FileRow key={`${file.name}-${file.size}-${file.lastModified}`} label="已修图" name={file.name} />)}
                </div>
              )}

              <button
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!selectedEventId || editedFiles.length === 0 || uploading}
                onClick={() => void handleUpload()}
                type="button"
              >
                <UploadCloud size={16} />
                {uploading ? "上传中..." : "上传已修图"}
              </button>

              {activeTask && (activeTask.status === "pending" || activeTask.status === "running") && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                  <div className="flex items-center justify-between text-xs font-medium text-blue-900">
                    <span>正在处理回传</span>
                    <span>{activeTaskStats.processed}/{activeTaskStats.total || 0}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${activeTaskStats.percent}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-blue-700">
                    成功 {activeTaskStats.success} · 失败 {activeTaskStats.failed} · 剩余 {formatTaskDuration(activeTaskStats.estimatedRemainingMs)}
                    {activeTaskStats.currentFileName ? ` · ${activeTaskStats.currentFileName}` : ""}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">回传结果</h2>
              {uploadResult ? (
                <div className="space-y-3 text-sm">
                  <ResultLine label="总数" value={uploadResult.total} />
                  <ResultLine label="匹配" value={uploadResult.matched} />
                  <ResultLine label="未匹配" value={uploadResult.unmatched} />
                </div>
              ) : (
                <p className="text-sm text-slate-400">等待上传。</p>
              )}
              {uploadResult?.errors.length ? (
                <div className="mt-4 space-y-2">
                  {uploadResult.errors.slice(0, 8).map((error) => (
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" key={`${error.filename}-${error.reason}`}>
                      <p className="truncate font-medium">{error.filename}</p>
                      <p className="mt-0.5">{error.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value.toLocaleString()}</p>
    </div>
  );
}

function FileRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 px-3 py-2 text-sm last:border-b-0">
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
