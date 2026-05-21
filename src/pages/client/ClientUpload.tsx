import { ImagePlus, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notice } from "../../components/ui/States";
import { ClientUploadData, ClientUploadTaskData, EventData, fetchEvents, fetchTask, getClientApiBase, uploadClientImages, type TaskData } from "../../lib/api";
import { cn } from "../../lib/cn";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";
import { formatTaskDuration, getTaskStats, taskStatusLabel } from "../../lib/taskStats";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);

export function ClientUploadPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [photographer, setPhotographer] = useState(localStorage.getItem("mediaPhotoWorkbench.clientUserName") || "");
  const [device, setDevice] = useState(localStorage.getItem("mediaPhotoWorkbench.clientDevice") || "");
  const [remark, setRemark] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ClientUploadData | null>(null);
  const [startedTask, setStartedTask] = useState<ClientUploadTaskData | null>(null);
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);

  const hostAddress = getClientApiBase();
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const displayTask = activeTask ?? createInitialUploadTask(startedTask);
  const taskStats = getTaskStats(displayTask);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "主机当前没有可上传的活动。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取主机活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "主机未连接", body: "请先返回连接页完成连接测试。" });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!startedTask?.taskId) {
      setActiveTask(null);
      return;
    }

    let cancelled = false;
    const taskId = startedTask.taskId;

    fetchTask(taskId)
      .then((res) => {
        if (!cancelled && res.ok && res.data) {
          setActiveTask(res.data);
        }
      })
      .catch(() => {
        // Realtime task updates will still update the panel when this request fails.
      });

    const unsubscribe = subscribeRealtimeTaskEvent((payload) => {
      const payloadTaskId = payload.id || payload.taskId;
      if (payloadTaskId !== taskId) return;
      setActiveTask({
        ...payload,
        id: payloadTaskId
      } as TaskData);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [startedTask?.taskId]);

  const applySelectedFiles = (nextFiles: File[], source: "select" | "drag") => {
    setFiles(nextFiles);
    setResult(null);
    setStartedTask(null);
    setActiveTask(null);
    if (nextFiles.length > 0) {
      setMessage({
        tone: "info",
        title: source === "drag" ? "已接收拖拽图片" : "已选择图片",
        body: `已选择 ${nextFiles.length} 个 JPG/JPEG/PNG 文件，可点击开始上传。`
      });
    }
  };

  const handleUploadDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const handleUploadDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragActive) {
      setDragActive(true);
    }
  };

  const handleUploadDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setDragActive(false);
    }
  };

  const handleUploadDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    if (uploading) {
      setMessage({ tone: "warning", title: "上传任务进行中", body: "请等待当前上传结束后再拖入新的图片。" });
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    const supported = droppedFiles.filter(isSupportedUploadImage);
    const unsupported = droppedFiles.filter((file) => !isSupportedUploadImage(file));
    const hasDirectory = Array.from(event.dataTransfer.items ?? []).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      return Boolean(entry?.isDirectory);
    });

    if (supported.length === 0) {
      setMessage({
        tone: "warning",
        title: "未找到可上传图片",
        body: hasDirectory
          ? "客户端暂不支持拖拽文件夹，请拖入 JPG/JPEG/PNG 图片文件，或点击选择文件上传。"
          : "请拖入 JPG、JPEG、PNG 图片文件。"
      });
      return;
    }

    applySelectedFiles(supported, "drag");
    if (unsupported.length > 0 || hasDirectory) {
      setMessage({
        tone: "warning",
        title: "已接收拖拽图片",
        body: [
          `已选择 ${supported.length} 个 JPG/JPEG/PNG 文件。`,
          unsupported.length > 0 ? `已跳过不支持格式：${unsupported.slice(0, 5).map((file) => file.name || "未知项目").join("、")}${unsupported.length > 5 ? " 等" : ""}` : "",
          hasDirectory ? "客户端暂不支持拖拽文件夹，文件夹内容未处理。" : ""
        ].filter(Boolean).join(" ")
      });
    }
  };

  const handleUpload = async () => {
    if (!selectedEventId || files.length === 0) return;
    setUploading(true);
    setResult(null);
    setStartedTask(null);
    setActiveTask(null);
    setMessage(null);

    try {
      const res = await uploadClientImages(selectedEventId, {
        files,
        photographer,
        device,
        remark
      });
      if (res.ok && res.data) {
        if (isClientUploadTaskData(res.data)) {
          setStartedTask(res.data);
          setMessage({ tone: "success", title: "上传任务已创建", body: `已上传 ${res.data.total} 个文件，主机正在生成缩略图和预览图，可在任务中心查看进度。` });
        } else {
          setResult(res.data);
          setMessage({ tone: "success", title: "上传完成", body: `成功 ${res.data.success} 张，跳过 ${res.data.skipped} 张，失败 ${res.data.failed} 张。` });
        }
      } else {
        setMessage({ tone: "danger", title: "上传失败", body: res.error?.message || "主机拒绝了本次上传。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "上传失败", body: err?.message || "请求失败，请检查主机连接。" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F8F9FA]">
      <div className="border-b border-slate-100 bg-white px-4 py-5 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">客户端上传</h1>
            <p className="mt-1 text-sm text-slate-500">{hostAddress || "未连接主机"}</p>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => navigate("/client/photos")}
            type="button"
          >
            打开图片墙
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto grid max-w-5xl gap-6 xl:grid-cols-[1fr_320px]">
          <section className="space-y-6">
            {message && <Notice tone={message.tone} title={message.title}>{message.body}</Notice>}

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 font-semibold text-slate-900">上传信息</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                    disabled={loadingEvents}
                    onChange={(event) => setSelectedEventId(event.target.value)}
                    value={selectedEventId}
                  >
                    {events.length === 0 && <option value="">暂无可用活动</option>}
                    {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                  </select>
                </label>
                <Field label="摄影师" onChange={setPhotographer} value={photographer} />
                <Field label="设备名" onChange={setDevice} value={device} />
                <Field label="备注" onChange={setRemark} value={remark} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">选择 JPG/JPEG/PNG 文件</h2>
                <span className="text-xs text-slate-400">{files.length} 个文件 / {formatBytes(totalSize)}</span>
              </div>
              <label
                className={cn(
                  "flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition-colors",
                  dragActive ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50/30"
                )}
                onDragEnter={handleUploadDragEnter}
                onDragLeave={handleUploadDragLeave}
                onDragOver={handleUploadDragOver}
                onDrop={handleUploadDrop}
              >
                <ImagePlus className={cn("mb-4", dragActive ? "text-blue-600" : "text-slate-400")} size={34} />
                <span className="text-sm font-medium text-slate-800">点击选择或拖拽 JPG/JPEG/PNG 图片</span>
                <span className="mt-2 text-xs text-slate-400">支持单张或多张；客户端暂不支持拖拽文件夹</span>
                <input
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                  className="hidden"
                  multiple
                  onChange={(event) => applySelectedFiles(Array.from(event.target.files ?? []), "select")}
                  type="file"
                />
              </label>

              {files.length > 0 && (
                <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-100">
                  {files.map((file) => (
                    <div className="flex items-center justify-between border-b border-slate-50 px-4 py-2 text-sm last:border-b-0" key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <span className="truncate text-slate-700">{file.name}</span>
                      <span className="ml-4 shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                className={cn("mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white", selectedEventId && files.length > 0 && !uploading ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-slate-300")}
                disabled={!selectedEventId || files.length === 0 || uploading}
                onClick={handleUpload}
                type="button"
              >
                <UploadCloud size={17} />
                {uploading ? "上传中..." : "开始上传"}
              </button>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">上传结果</h2>
              {result ? (
                <div className="space-y-3 text-sm">
                  <ResultLine label="总数" value={result.total} />
                  <ResultLine label="成功" value={result.success} />
                  <ResultLine label="跳过" value={result.skipped} />
                  <ResultLine label="失败" value={result.failed} />
                </div>
              ) : startedTask ? (
                <div className="space-y-3 text-sm">
                  <ResultLine label="总数" value={taskStats.total} />
                  <ResultLine label="已处理" value={taskStats.processed} />
                  <ResultLine label="成功" value={taskStats.success} />
                  <ResultLine label="跳过" value={taskStats.skipped} />
                  <ResultLine label="失败" value={taskStats.failed} />
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full transition-all", displayTask?.status === "failed" ? "bg-red-500" : displayTask?.status === "success" ? "bg-emerald-500" : "bg-blue-600")}
                      style={{ width: `${Math.max(taskStats.percent, displayTask?.status === "pending" ? 4 : 8)}%` }}
                    />
                  </div>
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
                    {displayTask ? taskStatusLabel(displayTask.status) : "后台处理"} · 任务 {startedTask.taskId}
                    {displayTask && (displayTask.status === "running" || displayTask.status === "pending") ? ` · 已用 ${formatTaskDuration(taskStats.elapsedMs)} · 剩余 ${formatTaskDuration(taskStats.estimatedRemainingMs)}` : ""}
                  </p>
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-400">等待上传结果。</p>
              )}
            </div>

            {(result?.errors.length || (displayTask && taskStats.errors.length > 0)) ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-5">
                <h2 className="mb-3 font-semibold text-red-900">失败记录</h2>
                <div className="space-y-2">
                  {(displayTask ? taskStats.errors : result?.errors ?? []).map((error) => (
                    <div className="rounded-lg bg-white/70 px-3 py-2 text-xs text-red-800" key={`${getErrorName(error)}-${error.reason}`}>
                      <p className="font-medium">{getErrorName(error)}</p>
                      <p className="mt-1 opacity-80">{error.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
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

function getErrorName(error: { filename?: string; imageId?: string }): string {
  return error.filename || error.imageId || "未知文件";
}

function isClientUploadTaskData(data: ClientUploadData | ClientUploadTaskData): data is ClientUploadTaskData {
  return typeof (data as ClientUploadTaskData).taskId === "string";
}

function createInitialUploadTask(task: ClientUploadTaskData | null): TaskData | null {
  if (!task) return null;
  const now = new Date().toISOString();
  return {
    id: task.taskId,
    type: "client_upload_import",
    eventId: "",
    title: `上传处理 ${task.total} 张图片`,
    status: "pending",
    total: task.total,
    finished: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: [],
    result: null,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    finishedAt: "",
    elapsedMs: 0,
    estimatedRemainingMs: null,
    currentFileName: ""
  };
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function isSupportedUploadImage(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const validExtension = lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png");
  const validMime = !file.type || file.type === "image/jpeg" || file.type === "image/png";
  return validExtension && validMime;
}
