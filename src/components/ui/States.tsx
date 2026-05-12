import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const toneStyle: Record<Tone, { box: string; icon: string }> = {
  info: { box: "border-blue-100 bg-blue-50 text-blue-900", icon: "text-blue-600" },
  success: { box: "border-emerald-100 bg-emerald-50 text-emerald-900", icon: "text-emerald-600" },
  warning: { box: "border-amber-100 bg-amber-50 text-amber-900", icon: "text-amber-600" },
  danger: { box: "border-red-100 bg-red-50 text-red-900", icon: "text-red-600" },
  neutral: { box: "border-slate-100 bg-slate-50 text-slate-700", icon: "text-slate-500" }
};

const toneIcon: Record<Tone, ReactNode> = {
  info: <Info size={17} />,
  success: <CheckCircle2 size={17} />,
  warning: <AlertCircle size={17} />,
  danger: <XCircle size={17} />,
  neutral: <Info size={17} />
};

export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", toneStyle[tone].box, className)}>
      <div className={cn("mt-0.5 shrink-0", toneStyle[tone].icon)}>{toneIcon[tone]}</div>
      <div>
        <h4 className="mb-1 text-sm font-semibold">{title}</h4>
        <div className="text-xs leading-6 opacity-80">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", toneStyle[tone].box)}>{children}</span>;
}
