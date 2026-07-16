export type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";

export type StatusSemantic = {
  label: string;
  tone: StatusTone;
  badgeClass: string;
  textClass: string;
  progressClass: string;
};

export type OperationalStatus =
  | "success"
  | "running"
  | "receiving"
  | "processing"
  | "importing"
  | "pending"
  | "waiting"
  | "skipped"
  | "duplicate"
  | "warning"
  | "failed"
  | "unknown"
  | "admin_required"
  | "stopped"
  | "cancelled";

const SUCCESS: StatusSemantic = {
  label: "成功",
  tone: "success",
  badgeClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
  textClass: "text-emerald-600",
  progressClass: "bg-emerald-500"
};

const ACTIVE: StatusSemantic = {
  label: "处理中",
  tone: "info",
  badgeClass: "border-blue-100 bg-blue-50 text-blue-700",
  textClass: "text-blue-600",
  progressClass: "bg-blue-500"
};

const WARNING: StatusSemantic = {
  label: "警告",
  tone: "warning",
  badgeClass: "border-amber-100 bg-amber-50 text-amber-700",
  textClass: "text-amber-600",
  progressClass: "bg-amber-500"
};

const FAILURE: StatusSemantic = {
  label: "失败",
  tone: "danger",
  badgeClass: "border-red-100 bg-red-50 text-red-700",
  textClass: "text-red-600",
  progressClass: "bg-red-500"
};

const NEUTRAL: StatusSemantic = {
  label: "状态未知",
  tone: "neutral",
  badgeClass: "border-slate-200 bg-slate-100 text-slate-600",
  textClass: "text-slate-500",
  progressClass: "bg-slate-400"
};

const OPERATIONAL_STATUS_SEMANTICS: Record<OperationalStatus, StatusSemantic> = {
  success: { ...SUCCESS, label: "已完成" },
  running: { ...ACTIVE, label: "运行中" },
  receiving: { ...ACTIVE, label: "正在接收" },
  processing: { ...ACTIVE, label: "处理中" },
  importing: { ...ACTIVE, label: "正在导入" },
  pending: { ...ACTIVE, label: "等待中" },
  waiting: { ...ACTIVE, label: "等待稳定" },
  skipped: { ...WARNING, label: "已跳过" },
  duplicate: { ...WARNING, label: "重复跳过" },
  warning: WARNING,
  failed: FAILURE,
  unknown: NEUTRAL,
  admin_required: { ...NEUTRAL, label: "需管理员检测" },
  stopped: { ...NEUTRAL, label: "已停止" },
  cancelled: { ...NEUTRAL, label: "已取消" }
};

const OPERATIONAL_STATUS_ALIASES: Record<string, OperationalStatus> = {
  imported: "success",
  complete: "success",
  completed: "success",
  ok: "success",
  active: "running",
  started: "running",
  in_progress: "processing",
  queued: "pending",
  duplicate_skipped: "duplicate",
  error: "failed",
  failure: "failed",
  requires_admin: "admin_required",
  adminrequired: "admin_required",
  inactive: "stopped",
  stopped_state: "stopped",
  canceled: "cancelled"
};

export function normalizeOperationalStatus(value: unknown): OperationalStatus {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized in OPERATIONAL_STATUS_SEMANTICS) return normalized as OperationalStatus;
  return OPERATIONAL_STATUS_ALIASES[normalized] ?? "unknown";
}

export function getOperationalStatusSemantic(value: unknown): StatusSemantic {
  return OPERATIONAL_STATUS_SEMANTICS[normalizeOperationalStatus(value)];
}

export const IMAGE_WORKFLOW_STATUS_SEMANTICS = {
  unselected: { ...NEUTRAL, label: "未筛选" },
  rejected: { ...NEUTRAL, label: "废片" },
  archive: { ...NEUTRAL, label: "留档" },
  edit: { ...WARNING, label: "待修图" },
  edited: { ...SUCCESS, label: "已修图" },
  publish: { ...ACTIVE, label: "可发布" },
  published: { ...SUCCESS, label: "已发布" }
} as const satisfies Record<string, StatusSemantic>;

export type ImageWorkflowStatus = keyof typeof IMAGE_WORKFLOW_STATUS_SEMANTICS;

export function getImageWorkflowStatusSemantic(value: ImageWorkflowStatus): StatusSemantic {
  return IMAGE_WORKFLOW_STATUS_SEMANTICS[value];
}

export const PROVISIONING_STATUS_SEMANTICS = {
  already_ok: { ...SUCCESS, label: "已符合" },
  create: { ...ACTIVE, label: "将创建" },
  update: { ...ACTIVE, label: "将更新" },
  repair: { ...ACTIVE, label: "将修复" },
  user_confirmation_required: { ...WARNING, label: "需要确认" },
  blocked: { ...WARNING, label: "已阻塞" }
} as const satisfies Record<string, StatusSemantic>;
