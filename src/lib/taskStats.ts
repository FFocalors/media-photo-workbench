import type { TaskData, TaskErrorItem } from "./api";

export type NormalizedTaskStats = {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  percent: number;
  estimatedRemainingMs: number | null;
  elapsedMs: number | null;
  currentFileName: string;
  errors: TaskErrorItem[];
};

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resultNumber(task: TaskData, keys: string[]): number {
  const result = task.result as Record<string, unknown> | null | undefined;
  if (!result) return 0;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function resultErrors(task: TaskData): TaskErrorItem[] {
  const result = task.result as Record<string, unknown> | null | undefined;
  if (!result || !Array.isArray(result.errors)) return [];
  return result.errors
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      imageId: typeof item.imageId === "string" ? item.imageId : undefined,
      filename: typeof item.filename === "string" ? item.filename : undefined,
      reason: typeof item.reason === "string" ? item.reason : "未知错误"
    }));
}

export function getTaskStats(task: TaskData | null | undefined): NormalizedTaskStats {
  if (!task) {
    return {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      percent: 0,
      estimatedRemainingMs: null,
      elapsedMs: null,
      currentFileName: "",
      errors: []
    };
  }

  const success = asNumber(task.successCount) || resultNumber(task, ["success", "successCount", "succeeded"]);
  const failed = asNumber(task.failedCount) || resultNumber(task, ["failed", "failedCount"]);
  const skipped = asNumber(task.skippedCount) || resultNumber(task, ["skipped", "skippedCount"]);
  const total = asNumber(task.total) || resultNumber(task, ["total"]);
  const processedFromResult = resultNumber(task, ["processed", "finished", "completed"]);
  const processed = Math.min(
    total || Number.MAX_SAFE_INTEGER,
    asNumber(task.finished) || processedFromResult || success + failed + skipped
  );
  const percent = total > 0
    ? Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
    : task.status === "success"
      ? 100
      : 0;

  return {
    total,
    processed,
    success,
    failed,
    skipped,
    percent,
    estimatedRemainingMs: typeof task.estimatedRemainingMs === "number" ? task.estimatedRemainingMs : null,
    elapsedMs: typeof task.elapsedMs === "number" ? task.elapsedMs : null,
    currentFileName: task.currentFileName || "",
    errors: (task.errors ?? []).length > 0 ? task.errors : resultErrors(task)
  };
}

export function taskStatusLabel(status: TaskData["status"]): string {
  if (status === "pending") return "等待中";
  if (status === "running") return "执行中";
  if (status === "success") return "已完成";
  if (status === "failed") return "失败";
  return "已取消";
}

export function formatTaskDuration(ms?: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "估算中";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes} 分 ${seconds} 秒`;
  return `${hours} 小时 ${remainingMinutes} 分`;
}
