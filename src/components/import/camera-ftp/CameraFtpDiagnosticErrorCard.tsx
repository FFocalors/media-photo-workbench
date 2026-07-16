import { AlertCircle, Info } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { CameraFtpErrorPresentation } from "../cameraFtpUiState";

export function CameraFtpDiagnosticErrorCard({ diagnostic, onAdopt, onCopy, onOpenLogs, onRetry, onSelectPort }: {
  diagnostic: CameraFtpErrorPresentation;
  onAdopt?: () => void;
  onCopy: () => void;
  onOpenLogs: () => void;
  onRetry?: () => void;
  onSelectPort?: (port: number) => void;
}) {
  const neutral = diagnostic.tone === "info";
  const warning = diagnostic.tone === "warning";
  const Icon = neutral ? Info : AlertCircle;
  const borderStyle = neutral
    ? "border-slate-200 bg-slate-50"
    : warning
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  const iconStyle = neutral ? "text-slate-500" : warning ? "text-amber-600" : "text-red-600";
  const titleStyle = neutral ? "text-slate-800" : warning ? "text-amber-900" : "text-red-900";
  const bodyStyle = neutral ? "text-slate-600" : warning ? "text-amber-800" : "text-red-800";
  return (
    <section className={cn(
      "rounded-2xl border p-5",
      borderStyle
    )}>
      <div className="flex items-start gap-3">
        <Icon className={iconStyle} size={20} />
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold", titleStyle)}>{diagnostic.title}</h3>
          <p className={cn("mt-1 text-sm leading-6", bodyStyle)}>{diagnostic.body}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">{neutral ? "相关阶段" : "失败阶段"}</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.stage}</dd></div>
            <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">建议</dt><dd className="mt-1 leading-5 text-slate-700">{diagnostic.advice}</dd></div>
            {diagnostic.operationId && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">请求操作 ID</dt><dd className="mt-1 break-all font-mono text-slate-700">{diagnostic.operationId}</dd></div>}
            {diagnostic.childOperationId && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">提权子操作 ID</dt><dd className="mt-1 break-all font-mono text-slate-700">{diagnostic.childOperationId}</dd></div>}
            {diagnostic.conflictPort !== undefined && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">冲突端口</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.conflictPort}</dd></div>}
            {diagnostic.conflictOwner && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">占用来源</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.conflictOwner}</dd></div>}
            {diagnostic.rollbackAttempted !== undefined && <div className="rounded-lg bg-white/70 px-3 py-2"><dt className="text-slate-400">自动回滚</dt><dd className="mt-1 font-medium text-slate-700">{diagnostic.rollbackSummary || (diagnostic.rollbackAttempted ? "已尝试，结果未知" : "未修改系统，无需回滚")}</dd></div>}
          </dl>
          <details className="mt-3 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700">
            <summary className="cursor-pointer font-medium text-slate-600">技术详情（已脱敏）</summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono leading-5">{diagnostic.technicalDetails}</pre>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            {diagnostic.retryable && onRetry && <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onRetry} type="button">重试</button>}
            {onSelectPort && diagnostic.availablePorts.slice(0, 3).map((port) => <button className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700" key={port} onClick={() => onSelectPort(port)} type="button">选择端口 {port}</button>)}
            {onAdopt && <button className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50" onClick={onAdopt} type="button">接管现有站点</button>}
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onCopy} type="button">复制技术详情</button>
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50" onClick={onOpenLogs} type="button">打开日志目录</button>
          </div>
        </div>
      </div>
    </section>
  );
}
