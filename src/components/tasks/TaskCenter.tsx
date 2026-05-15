import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Download, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchTasks, getApiBase, type TaskData } from "../../lib/api";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";

function taskStatusLabel(status: TaskData["status"]): string {
  if (status === "pending") return "等待中";
  if (status === "running") return "执行中";
  if (status === "success") return "已完成";
  if (status === "failed") return "失败";
  return "已取消";
}

function taskStatusIcon(status: TaskData["status"]) {
  if (status === "running" || status === "pending") return <Loader2 className="animate-spin text-blue-500" size={15} />;
  if (status === "success") return <CheckCircle2 className="text-emerald-500" size={15} />;
  if (status === "failed") return <XCircle className="text-red-500" size={15} />;
  return <AlertCircle className="text-slate-400" size={15} />;
}

function progressPercent(task: TaskData): number {
  if (task.total <= 0) return task.status === "success" ? 100 : 0;
  return Math.min(100, Math.round((task.finished / task.total) * 100));
}

function taskDownloadHref(task: TaskData): string {
  const downloadUrl = task.result?.downloadUrl;
  if (typeof downloadUrl !== "string" || !downloadUrl) return "";
  return /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${getApiBase()}${downloadUrl}`;
}

export function TaskCenter({ placement = "sidebar" }: { placement?: "sidebar" | "floating" }) {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [open, setOpen] = useState(false);
  const [renderPanel, setRenderPanel] = useState(false);
  const [panelEntered, setPanelEntered] = useState(false);

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

  const runningCount = tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const visibleTasks = useMemo(() => tasks.slice(0, 8), [tasks]);
  const isSidebar = placement === "sidebar";

  return (
    <div className={isSidebar ? "relative" : "absolute right-5 top-4 z-40"}>
      <button
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
          {runningCount > 0 && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{runningCount}</span>}
          {failedCount > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{failedCount}</span>}
          <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} size={14} />
        </span>
      </button>

      {renderPanel && (
        <div className={isSidebar
          ? `absolute bottom-0 left-full z-50 ml-2 w-96 origin-bottom-left overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl transition-all duration-200 ease-out ${panelEntered ? "translate-x-0 scale-100 opacity-100" : "-translate-x-8 scale-90 opacity-0"}`
          : `mt-2 w-96 origin-top-right overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl transition-all duration-200 ease-out ${panelEntered ? "translate-y-0 scale-100 opacity-100" : "-translate-y-8 scale-90 opacity-0"}`}
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">任务中心</div>
            <div className="text-xs text-slate-400">显示进行中、最近完成和失败任务</div>
          </div>

          <div className="max-h-[520px] overflow-y-auto p-3">
            {visibleTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">暂无任务</div>
            ) : (
              <div className="space-y-2">
                {visibleTasks.map((task) => {
                  const href = taskDownloadHref(task);
                  return (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3" key={task.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {taskStatusIcon(task.status)}
                            <span className="truncate text-sm font-semibold text-slate-800">{task.title || task.type}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {taskStatusLabel(task.status)} · {task.finished}/{task.total || 0} · 成功 {task.successCount} · 失败 {task.failedCount} · 跳过 {task.skippedCount}
                          </div>
                        </div>
                        {href && task.status === "success" && (
                          <a
                            className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                            href={href}
                          >
                            <Download size={13} />
                            下载
                          </a>
                        )}
                      </div>

                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                        <div
                          className={`h-full rounded-full ${task.status === "failed" ? "bg-red-500" : task.status === "success" ? "bg-emerald-500" : "bg-blue-500"}`}
                          style={{ width: `${progressPercent(task)}%` }}
                        />
                      </div>

                      {task.errors.length > 0 && (
                        <div className="mt-2 rounded-lg bg-white px-2.5 py-2 text-xs text-red-600">
                          {task.errors.slice(0, 3).map((error, index) => (
                            <div className="truncate" key={`${task.id}-${index}`}>
                              {error.filename || error.imageId || "错误"}：{error.reason}
                            </div>
                          ))}
                          {task.errors.length > 3 && <div className="text-red-400">还有 {task.errors.length - 3} 条错误</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
