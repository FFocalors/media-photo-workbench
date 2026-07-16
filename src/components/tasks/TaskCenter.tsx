import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock3, Download, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cancelTask, fetchTasks, getApiBase, type TaskData } from "../../lib/api";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";
import { getOperationalStatusSemantic } from "../../lib/statusSemantics";
import { formatTaskDuration, getTaskStats, taskStatusLabel } from "../../lib/taskStats";

function taskStatusIcon(status: TaskData["status"]) {
  const semantic = getOperationalStatusSemantic(status);
  if (status === "running" || status === "pending") return <Loader2 className={`animate-spin ${semantic.textClass}`} size={15} />;
  if (status === "success") return <CheckCircle2 className={semantic.textClass} size={15} />;
  if (status === "failed") return <XCircle className={semantic.textClass} size={15} />;
  return <AlertCircle className={semantic.textClass} size={15} />;
}

function taskDownloadHref(task: TaskData): string {
  const downloadUrl = task.result?.downloadUrl;
  if (typeof downloadUrl !== "string" || !downloadUrl) return "";
  return /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${getApiBase()}${downloadUrl}`;
}

function canCancelTask(task: TaskData): boolean {
  return task.type === "host_import" || task.type === "client_upload_import" || task.type === "edited_upload";
}

function taskTypeLabel(task: TaskData): string {
  if (task.title) return task.title;
  const labels: Record<string, string> = {
    host_import: "导入图片",
    client_upload_import: "客户端上传处理",
    camera_ftp_import: "相机 FTP 导入",
    download_zip: "批量 ZIP 下载",
    publish_export: "导出发布",
    edit_package: "生成待修包",
    edited_upload: "回传已修图",
    archive_prepare: "生成归档",
    archive_cleanup: "清理工作区"
  };
  return labels[task.type] ?? task.type;
}

function TaskPanel({
  cancellingTaskId,
  entered,
  id,
  isSidebar,
  onCancelTask,
  panelRef,
  style,
  tasks
}: {
  cancellingTaskId: string;
  entered: boolean;
  id: string;
  isSidebar: boolean;
  onCancelTask: (taskId: string) => void | Promise<void>;
  panelRef: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
  tasks: TaskData[];
}) {
  return (
    <div
      aria-label="任务中心"
      className={isSidebar
        ? `fixed z-[55] flex origin-bottom-left flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl transition-all duration-200 ease-out ${entered ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none -translate-x-8 scale-90 opacity-0"}`
        : `absolute right-0 top-full z-50 mt-2 flex max-h-[min(600px,calc(100vh-6rem))] w-96 origin-top-right flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl transition-all duration-200 ease-out ${entered ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-8 scale-90 opacity-0"}`}
      id={id}
      ref={panelRef}
      role="region"
      style={style}
    >
      <div className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">任务中心</div>
        <div className="text-xs text-slate-400">显示进行中、最近完成和失败任务</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">暂无任务</div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const stats = getTaskStats(task);
              const statusSemantic = getOperationalStatusSemantic(task.status);
              const href = taskDownloadHref(task);
              const canCancel = canCancelTask(task);
              const isActive = task.status === "running" || task.status === "pending";
              return (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3" key={task.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {taskStatusIcon(task.status)}
                        <span className="truncate text-sm font-semibold text-slate-800">{taskTypeLabel(task)}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {taskStatusLabel(task.status)} · {stats.processed}/{stats.total || 0} · 成功 {stats.success} · 失败 {stats.failed} · 跳过 {stats.skipped}
                      </div>
                      {isActive ? (
                        <div className="mt-1 text-xs text-slate-400">
                          已用 {formatTaskDuration(stats.elapsedMs)} · 剩余 {formatTaskDuration(stats.estimatedRemainingMs)}
                          {stats.currentFileName ? ` · ${stats.currentFileName}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canCancel && isActive ? (
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                          disabled={cancellingTaskId === task.id}
                          onClick={() => void onCancelTask(task.id)}
                          type="button"
                        >
                          {cancellingTaskId === task.id ? "取消中" : "取消"}
                        </button>
                      ) : null}
                      {href && task.status === "success" ? (
                        <a
                          className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                          href={href}
                        >
                          <Download size={13} />
                          下载
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full rounded-full ${statusSemantic.progressClass}`}
                      style={{ width: `${stats.percent}%` }}
                    />
                  </div>

                  {stats.errors.length > 0 ? (
                    <div className="mt-2 rounded-lg bg-white px-2.5 py-2 text-xs text-red-600">
                      {stats.errors.slice(0, 3).map((error, index) => (
                        <div className="truncate" key={`${task.id}-${index}`}>
                          {error.filename || error.imageId || "错误"}：{error.reason}
                        </div>
                      ))}
                      {stats.errors.length > 3 ? <div className="text-red-400">还有 {stats.errors.length - 3} 条错误</div> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskCenter({ placement = "sidebar" }: { placement?: "sidebar" | "floating" }) {
  const isSidebar = placement === "sidebar";
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [open, setOpen] = useState(false);
  const [renderPanel, setRenderPanel] = useState(false);
  const [panelEntered, setPanelEntered] = useState(false);
  const [sidebarPanelPosition, setSidebarPanelPosition] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchTasks()
      .then((res) => {
        if (!cancelled && res.ok && res.data) {
          setTasks(res.data);
        }
      })
      .catch(() => {
        // Task center is observational; page-level API errors remain local to pages.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeRealtimeTaskEvent((payload) => {
      const task = {
        ...payload,
        id: payload.id || payload.taskId || ""
      } as TaskData;
      if (!task.id) return;
      setTasks((current) => {
        const next = [task, ...current.filter((item) => item.id !== task.id)];
        return next
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 20);
      });
    });
  }, []);

  useEffect(() => {
    if (open) {
      setRenderPanel(true);
      let cancelled = false;
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!cancelled) setPanelEntered(true);
        });
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    setPanelEntered(false);
    const timer = window.setTimeout(() => setRenderPanel(false), 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const updateSidebarPanelPosition = useCallback(() => {
    const triggerRect = rootRef.current?.getBoundingClientRect();
    if (!triggerRect) return;
    const viewportPadding = 12;
    const panelGap = 8;
    const width = Math.min(384, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(triggerRect.right + panelGap, window.innerWidth - width - viewportPadding)
    );
    const bottom = Math.max(viewportPadding, window.innerHeight - triggerRect.bottom);
    const maxHeight = Math.max(240, Math.min(600, window.innerHeight - bottom - viewportPadding));
    setSidebarPanelPosition({ left, bottom, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open || !isSidebar) return;
    updateSidebarPanelPosition();
    window.addEventListener("resize", updateSidebarPanelPosition);
    document.addEventListener("scroll", updateSidebarPanelPosition, true);
    return () => {
      window.removeEventListener("resize", updateSidebarPanelPosition);
      document.removeEventListener("scroll", updateSidebarPanelPosition, true);
    };
  }, [isSidebar, open, updateSidebarPanelPosition]);

  const runningCount = tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const visibleTasks = useMemo(() => tasks.slice(0, 8), [tasks]);

  const handleCancelTask = async (taskId: string) => {
    setCancellingTaskId(taskId);
    try {
      const res = await cancelTask(taskId);
      if (res.ok) {
        setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status: "cancelled" } : task));
      }
    } finally {
      setCancellingTaskId("");
    }
  };

  const ToggleChevron = isSidebar ? ChevronRight : ChevronDown;
  const panelNode = renderPanel && (!isSidebar || sidebarPanelPosition) ? (
    <TaskPanel
      cancellingTaskId={cancellingTaskId}
      entered={panelEntered}
      id={panelId}
      isSidebar={isSidebar}
      onCancelTask={handleCancelTask}
      panelRef={panelRef}
      style={isSidebar && sidebarPanelPosition ? sidebarPanelPosition : undefined}
      tasks={visibleTasks}
    />
  ) : null;

  return (
    <div className={isSidebar ? "relative" : "absolute right-5 top-4 z-40"} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={isSidebar
          ? "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          : "flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Clock3 size={18} strokeWidth={2} />
          <span className="truncate">任务中心</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {runningCount > 0 ? <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{runningCount}</span> : null}
          {failedCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{failedCount}</span> : null}
          <ToggleChevron className={open ? "rotate-180 transition-transform" : "transition-transform"} size={14} />
        </span>
      </button>

      {isSidebar && panelNode && typeof document !== "undefined"
        ? createPortal(panelNode, document.body)
        : panelNode}
    </div>
  );
}
