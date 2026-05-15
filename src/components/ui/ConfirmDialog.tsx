import { AlertCircle, CheckCircle2, Info, Trash2, X } from "lucide-react";
import { ReactNode, useState } from "react";
import { cn } from "../../lib/cn";

type ConfirmTone = "info" | "success" | "warning" | "danger";

const toneStyle: Record<ConfirmTone, { icon: string; iconBg: string; button: string }> = {
  info: {
    icon: "text-blue-600",
    iconBg: "bg-blue-50",
    button: "bg-blue-600 hover:bg-blue-700"
  },
  success: {
    icon: "text-emerald-600",
    iconBg: "bg-emerald-50",
    button: "bg-emerald-600 hover:bg-emerald-700"
  },
  warning: {
    icon: "text-amber-600",
    iconBg: "bg-amber-50",
    button: "bg-amber-600 hover:bg-amber-700"
  },
  danger: {
    icon: "text-red-600",
    iconBg: "bg-red-50",
    button: "bg-red-600 hover:bg-red-700"
  }
};

const toneIcon: Record<ConfirmTone, ReactNode> = {
  info: <Info size={20} />,
  success: <CheckCircle2 size={20} />,
  warning: <AlertCircle size={20} />,
  danger: <Trash2 size={20} />
};

export function ConfirmDialog({
  cancelLabel = "取消",
  children,
  confirmLabel = "确认",
  confirming = false,
  details,
  description,
  onCancel,
  onConfirm,
  requireText,
  requireTextLabel = "输入名称确认",
  title,
  tone = "danger"
}: {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel?: string;
  confirming?: boolean;
  details?: Array<{ label: string; value: string }>;
  description?: string;
  onCancel: () => void;
  onConfirm: () => void;
  requireText?: string;
  requireTextLabel?: string;
  title: string;
  tone?: ConfirmTone;
}) {
  const [typed, setTyped] = useState("");
  const matched = !requireText || typed.trim() === requireText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start gap-4">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneStyle[tone].iconBg, toneStyle[tone].icon)}>
            {toneIcon[tone]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              <button
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                disabled={confirming}
                onClick={onCancel}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
          </div>
        </div>

        {details && details.length > 0 && (
          <div className={cn("space-y-3 rounded-xl p-4 text-sm", tone === "danger" ? "bg-red-50" : "bg-slate-50")}>
            {details.map((item) => (
              <div className="grid grid-cols-[72px_1fr] gap-3" key={item.label}>
                <span className="text-slate-500">{item.label}</span>
                <span className="break-all font-medium text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {children && <div className="mt-4">{children}</div>}

        {requireText && (
          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">{requireTextLabel}</span>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              onChange={(event) => setTyped(event.target.value)}
              placeholder={requireText}
              value={typed}
            />
          </label>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            disabled={confirming}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={cn("rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300", toneStyle[tone].button)}
            disabled={confirming || !matched}
            onClick={onConfirm}
            type="button"
          >
            {confirming ? "处理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
