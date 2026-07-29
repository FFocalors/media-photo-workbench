import { AlertCircle, CheckCircle2, Loader2, Settings2 } from "lucide-react";
import type {
  CameraFtpAdminOperationData,
  CameraFtpProvisioningPlanData
} from "../../../lib/api";
import { cn } from "../../../lib/cn";
import {
  getOperationalStatusSemantic,
  PROVISIONING_STATUS_SEMANTICS,
  type StatusSemantic
} from "../../../lib/statusSemantics";
import { StatusPill } from "../../ui/States";
import {
  cameraFtpPlanCanApply,
  type CameraFtpProvisioningPhasePresentation
} from "../cameraFtpUiState";

type PlanItemStatus = CameraFtpProvisioningPlanData["items"][number]["status"];
type IssueLevel = CameraFtpProvisioningPlanData["issues"][number]["level"];

type IssueGroup = {
  level: IssueLevel;
  label: string;
  items: CameraFtpProvisioningPlanData["issues"];
};

const PLAN_ITEM_LABELS: Record<PlanItemStatus, string> = {
  already_ok: "已符合",
  create: "将创建",
  update: "将更新",
  repair: "将修复",
  user_confirmation_required: "需要确认",
  blocked: "无法继续"
};

const ISSUE_LEVEL_LABELS: Record<IssueLevel, string> = {
  info: "信息提示",
  auto_repair: "可自动修复",
  user_confirmation: "需要用户确认",
  blocked: "阻塞错误"
};

function planItemSemantic(status: PlanItemStatus): StatusSemantic {
  return { ...PROVISIONING_STATUS_SEMANTICS[status], label: PLAN_ITEM_LABELS[status] };
}

function issueLevelSemantic(level: IssueLevel): StatusSemantic {
  const semantic = level === "blocked"
    ? PROVISIONING_STATUS_SEMANTICS.blocked
    : level === "user_confirmation"
      ? PROVISIONING_STATUS_SEMANTICS.user_confirmation_required
      : level === "auto_repair"
        ? PROVISIONING_STATUS_SEMANTICS.repair
        : getOperationalStatusSemantic("unknown");
  return { ...semantic, label: ISSUE_LEVEL_LABELS[level] };
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function formatEstimate(operation: CameraFtpAdminOperationData | null): string {
  if (!operation || operation.estimateExceeded) return "暂时无法准确估计";
  const min = operation.estimatedRemainingMinMs;
  const max = operation.estimatedRemainingMaxMs;
  if (min === null || max === null) return "暂时无法准确估计";
  const minMinutes = Math.max(0, Math.ceil(min / 60_000));
  const maxMinutes = Math.max(minMinutes, Math.ceil(max / 60_000));
  if (maxMinutes === 0) return "预计不到 1 分钟";
  if (minMinutes === 0) return maxMinutes === 1 ? "预计不到 1 分钟" : `预计约不到 1–${maxMinutes} 分钟`;
  if (minMinutes === maxMinutes) return `预计约 ${maxMinutes} 分钟`;
  return `预计约 ${minMinutes}–${maxMinutes} 分钟`;
}

export function CameraFtpProvisioningProgress({
  phases,
  operation
}: {
  phases: CameraFtpProvisioningPhasePresentation[];
  operation: CameraFtpAdminOperationData | null;
}) {
  const current = phases.find((phase) => phase.status === "running") || phases[phases.length - 1];
  const waitingAfterTimeout = operation?.state === "timed_out_waiting";
  const progressPercent = Math.max(0, Math.min(100, operation?.progressPercent ?? 0));
  const title = waitingAfterTimeout ? "管理员操作仍可能在后台执行" : "正在执行完整 FTP 配置计划";
  return (
    <section className={cn(
      "rounded-2xl border p-5",
      waitingAfterTimeout ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50"
    )}>
      <div className="flex items-start gap-3">
        <Loader2 className={cn("mt-0.5 shrink-0 animate-spin", waitingAfterTimeout ? "text-amber-600" : "text-blue-600")} size={20} />
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", waitingAfterTimeout ? "text-amber-900" : "text-blue-900")}>{title}</h3>
          <p className={cn("mt-1 text-sm leading-6", waitingAfterTimeout ? "text-amber-800" : "text-blue-800")}>
            {current?.label}。{waitingAfterTimeout
              ? "工作台不会强制结束可能正在修改 Windows 的进程；确认进程结束前不能重复执行。"
              : "如出现 Windows 用户账户控制窗口，请确认本次工作台操作。"}
          </p>
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={waitingAfterTimeout ? "text-amber-800" : "text-blue-800"}>
                已等待 {formatElapsed(operation?.elapsedMs ?? 0)}
              </span>
              <span className={waitingAfterTimeout || operation?.estimateExceeded ? "font-medium text-amber-700" : "text-blue-700"}>
                {operation?.estimateExceeded && !waitingAfterTimeout ? "比通常耗时更长，Windows 仍在处理" : formatEstimate(operation)}
              </span>
            </div>
            <div
              aria-label={`${current?.label || "FTP 配置"}，${progressPercent}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={operation?.indeterminate ? undefined : progressPercent}
              className={cn("relative h-2.5 overflow-hidden rounded-full", waitingAfterTimeout ? "bg-amber-100" : "bg-blue-100")}
              role="progressbar"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  waitingAfterTimeout ? "bg-amber-500" : "bg-blue-600",
                  operation?.indeterminate && "animate-pulse"
                )}
                style={{ width: `${Math.max(progressPercent, operation?.indeterminate ? 8 : 0)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>{operation?.stage ? `当前阶段：${current?.label.replace(/^正在/, "") || "Windows 管理配置"}` : "正在等待管理员进程报告真实阶段"}</span>
              <span>{progressPercent}%</span>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {phases.map((phase, index) => (
              <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white/80 px-3 py-2 text-xs" key={phase.id}>
                {phase.status === "success" ? (
                  <CheckCircle2 className="shrink-0 text-emerald-600" size={15} />
                ) : phase.status === "running" ? (
                  <Loader2 className="shrink-0 animate-spin text-blue-600" size={15} />
                ) : (
                  <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px] text-slate-400">{index + 1}</span>
                )}
                <span className={phase.status === "pending" ? "text-slate-400" : "font-medium text-slate-700"}>{phase.label.replace(/^正在/, "")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CameraFtpProvisioningPlanSummary({ plan }: { plan: CameraFtpProvisioningPlanData }) {
  const blocked = !cameraFtpPlanCanApply(plan);
  const blockedMeta = planItemSemantic("blocked");
  const attentionItems = plan.items.filter((item) => item.status === "blocked" || item.status === "user_confirmation_required");
  const routineIssues = plan.issues.filter((issue) => issue.level === "info" || issue.level === "auto_repair");
  const attentionIssues = plan.issues.filter((issue) => issue.level === "blocked" || issue.level === "user_confirmation");
  const statusCounts = (Object.keys(PROVISIONING_STATUS_SEMANTICS) as PlanItemStatus[])
    .map((status) => ({ status, meta: planItemSemantic(status), count: plan.items.filter((item) => item.status === status).length }))
    .filter((entry) => entry.count > 0);
  return (
    <section className={cn("min-w-0 rounded-2xl border p-4 sm:p-5", blocked && blockedMeta.tone === "warning" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50")}>
      <div className="flex items-start gap-3">
        {blocked ? <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={20} /> : <Settings2 className="mt-0.5 shrink-0 text-blue-600" size={20} />}
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", blocked ? "text-amber-900" : "text-blue-900")}>{blocked ? "配置计划存在阻塞项" : "配置计划摘要"}</h3>
          <p className={cn("mt-1 text-sm leading-6", blocked ? "text-amber-800" : "text-blue-800")}>{plan.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {statusCounts.map(({ status, meta, count }) => <StatusPill key={status} tone={meta.tone}>{meta.label} {count}</StatusPill>)}
          </div>
          {attentionItems.length > 0 ? (
            <div className="mt-3 space-y-2">
              {attentionItems.map((item) => {
                const meta = planItemSemantic(item.status);
                return (
                  <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2" key={item.id}>
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-700">{item.label}</p><p className="mt-0.5 break-words text-xs leading-5 text-slate-500">{item.summary}</p></div>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  </div>
                );
              })}
            </div>
          ) : null}
          {attentionIssues.length > 0 ? (
            <div className="mt-3 space-y-2">
              {attentionIssues.map((issue) => {
                const meta = issueLevelSemantic(issue.level);
                return <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs" key={issue.id}><StatusPill tone={meta.tone}>{meta.label}</StatusPill><p className="min-w-0 break-words leading-5 text-slate-600"><span className="font-semibold text-slate-700">{issue.title}：</span>{issue.message}</p></div>;
              })}
            </div>
          ) : null}
          {plan.confirmations.length > 0 ? (
            <div className="mt-3 space-y-2">
              {plan.confirmations.map((confirmation) => <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" key={confirmation.key}><span className="font-semibold">{confirmation.title}：</span>{confirmation.message}</div>)}
            </div>
          ) : null}
          <details className="mt-3 rounded-lg border border-white/80 bg-white/60 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">查看全部配置项（{plan.items.length}）</summary>
            <div className="mt-2 max-h-[min(38vh,320px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {plan.items.map((item) => {
                const meta = planItemSemantic(item.status);
                return (
                  <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2" key={item.id}>
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-700">{item.label}</p><p className="mt-0.5 break-words text-xs leading-5 text-slate-500">{item.summary}</p></div>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  </div>
                );
              })}
            </div>
          </details>
          {routineIssues.length > 0 ? (
            <details className="mt-2 rounded-lg border border-white/80 bg-white/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">查看普通信息与自动修复项（{routineIssues.length}）</summary>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {routineIssues.map((issue) => {
                  const meta = issueLevelSemantic(issue.level);
                  return <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs" key={issue.id}><StatusPill tone={meta.tone}>{meta.label}</StatusPill><p className="min-w-0 break-words leading-5 text-slate-600"><span className="font-semibold text-slate-700">{issue.title}：</span>{issue.message}</p></div>;
                })}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function CameraFtpIssueCenter({ groups, onUseRecommendedPort }: { groups: IssueGroup[]; onUseRecommendedPort?: () => void }) {
  const priority = { blocked: 0, user_confirmation: 1, auto_repair: 2, info: 3 } as const;
  const sortedGroups = [...groups].sort((left, right) => priority[left.level] - priority[right.level]);
  return (
    <section className="space-y-2" aria-label="FTP 检测结果分类">
      {sortedGroups.map((group) => {
        const hasPortChoice = group.level === "user_confirmation" && group.items.some((item) => /PORT|端口/i.test(`${item.code}${item.title}`));
        const critical = group.level === "blocked" || group.level === "user_confirmation";
        const meta = issueLevelSemantic(group.level);
        return (
          <details className={cn("rounded-xl border bg-white px-4 py-3 shadow-sm", critical ? "border-amber-200" : "border-slate-100")} key={group.level} open={critical}>
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800"><span className="mr-2">{group.label}</span><StatusPill tone={meta.tone}>{group.items.length} 项</StatusPill>{!critical ? <span className="ml-2 text-xs font-normal text-slate-400">默认收起</span> : null}</summary>
            <div className="mt-3 max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {group.items.map((item) => <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 text-xs" key={item.id}><p className="font-semibold text-slate-700">{item.title}</p><p className="mt-0.5 break-words leading-5 text-slate-600">{item.message}</p></div>)}
              {hasPortChoice && onUseRecommendedPort ? <button className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50" onClick={onUseRecommendedPort} type="button">使用推荐端口</button> : null}
            </div>
          </details>
        );
      })}
    </section>
  );
}
