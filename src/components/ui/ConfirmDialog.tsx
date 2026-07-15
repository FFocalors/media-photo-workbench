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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/40 p-3 backdrop-blur-sm sm:p-6" role="presentation">
      <div
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-h-[min(92dvh,760px)]"
        role="dialog"
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneStyle[tone].iconBg, toneStyle[tone].icon)}>
            {toneIcon[tone]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <h2 className="break-words text-lg font-bold text-slate-900" id="confirm-dialog-title">{title}</h2>
              <button
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                disabled={confirming}
                onClick={onCancel}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            {description && <p className="mt-1 break-words text-sm leading-6 text-slate-500">{description}</p>}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {details && details.length > 0 && (
            <div className={cn("space-y-3 rounded-xl p-4 text-sm", tone === "danger" ? "bg-red-50" : "bg-slate-50")}>
              {details.map((item) => (
                <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3" key={item.label}>
                  <span className="text-slate-500">{item.label}</span>
                  <span className="break-words font-medium text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          )}

          {children && <div className="mt-4 min-w-0">{children}</div>}

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
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
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
