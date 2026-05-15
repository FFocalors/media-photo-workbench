import crypto from "crypto";
import { emitTaskUpdated } from "../realtime/socket";

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface TaskErrorItem {
  filename?: string;
  path?: string;
  imageId?: string;
  reason: string;
}

export interface TaskRecord {
  id: string;
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
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string;
}

export interface CreateTaskInput {
  type: string;
  eventId?: string;
  title: string;
  total?: number;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  total?: number;
  finished?: number;
  successCount?: number;
  failedCount?: number;
  skippedCount?: number;
  errors?: TaskErrorItem[];
  result?: Record<string, unknown> | null;
  finishedAt?: string;
}

const tasks = new Map<string, TaskRecord>();
const MAX_TASKS = 100;

function nowIso(): string {
  return new Date().toISOString();
}

function generateTaskId(): string {
  return `task_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    errors: task.errors.map((error) => ({ ...error })),
    result: task.result ? { ...task.result } : null
  };
}

function trimTasks(): void {
  if (tasks.size <= MAX_TASKS) return;
  const ordered = Array.from(tasks.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const task of ordered.slice(0, tasks.size - MAX_TASKS)) {
    if (task.status !== "running") {
      tasks.delete(task.id);
    }
  }
}

function broadcast(task: TaskRecord): void {
  emitTaskUpdated({
    ...cloneTask(task),
    taskId: task.id,
    action: "task_updated"
  });
}

export function createTask(input: CreateTaskInput): TaskRecord {
  const now = nowIso();
  const task: TaskRecord = {
    id: generateTaskId(),
    type: input.type,
    eventId: input.eventId ?? "",
    title: input.title,
    status: "pending",
    total: input.total ?? 0,
    finished: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: [],
    result: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: ""
  };
  tasks.set(task.id, task);
  trimTasks();
  broadcast(task);
  return cloneTask(task);
}

export function updateTask(taskId: string, input: UpdateTaskInput): TaskRecord {
  const existing = tasks.get(taskId);
  if (!existing) {
    throw { code: "TASK_NOT_FOUND", message: "任务不存在" };
  }

  const next: TaskRecord = {
    ...existing,
    ...input,
    errors: input.errors ?? existing.errors,
    result: input.result === undefined ? existing.result : input.result,
    updatedAt: nowIso()
  };
  tasks.set(taskId, next);
  broadcast(next);
  return cloneTask(next);
}

export function finishTask(taskId: string, result: Record<string, unknown> | null = null): TaskRecord {
  const existing = tasks.get(taskId);
  if (!existing) {
    throw { code: "TASK_NOT_FOUND", message: "任务不存在" };
  }
  return updateTask(taskId, {
    status: "success",
    finished: existing.total,
    result,
    finishedAt: nowIso()
  });
}

export function failTask(taskId: string, errors: TaskErrorItem[] = [], result: Record<string, unknown> | null = null): TaskRecord {
  const existing = tasks.get(taskId);
  if (!existing) {
    throw { code: "TASK_NOT_FOUND", message: "任务不存在" };
  }
  return updateTask(taskId, {
    status: "failed",
    finishedAt: nowIso(),
    failedCount: Math.max(existing.failedCount, errors.length),
    errors: errors.length > 0 ? errors : existing.errors,
    result
  });
}

export function getTask(taskId: string): TaskRecord {
  const task = tasks.get(taskId);
  if (!task) {
    throw { code: "TASK_NOT_FOUND", message: "任务不存在" };
  }
  return cloneTask(task);
}

export function listTasks(): TaskRecord[] {
  return Array.from(tasks.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(cloneTask);
}

export function cancelTask(_taskId: string): never {
  throw { code: "TASK_CANCEL_NOT_SUPPORTED", message: "当前版本暂不支持取消正在执行的任务" };
}
