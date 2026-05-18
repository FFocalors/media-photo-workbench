import { Clipboard, QrCode } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { appIconUrl } from "../../lib/brand";
import { RoundedQRCode } from "./RoundedQRCode";

function hasValidQrValue(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function QRCodeCard({
  value,
  label,
  description,
  size = 112,
  showText = true,
  copyable = true,
  emptyText = "暂无可扫码地址",
  logoSrc = appIconUrl,
  className
}: {
  value?: string | null;
  label?: string;
  description?: string;
  size?: number;
  showText?: boolean;
  copyable?: boolean;
  emptyText?: string;
  logoSrc?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const qrValue = value?.trim() ?? "";
  const valid = hasValidQrValue(qrValue);

  const handleCopy = async () => {
    if (!valid) return;
    try {
      await navigator.clipboard.writeText(qrValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn("rounded-2xl border border-slate-100 bg-white p-4 shadow-sm", className)}>
      {label && <h3 className="mb-3 text-sm font-semibold text-slate-900">{label}</h3>}
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          {valid ? (
            <RoundedQRCode logoSrc={logoSrc} size={size} value={qrValue} />
          ) : (
            <div
              className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-300"
              style={{ height: size, width: size }}
            >
              <QrCode size={Math.min(64, size * 0.55)} strokeWidth={1.4} />
            </div>
          )}
        </div>

        {showText && (
          <div className="w-full text-center">
            <p className={cn("mx-auto max-w-full break-all font-mono text-xs leading-5", valid ? "text-slate-700" : "text-slate-400")}>
              {valid ? qrValue : emptyText}
            </p>
            {description && <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
        )}

        {copyable && (
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              valid
                ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
            )}
            disabled={!valid}
            onClick={handleCopy}
            type="button"
          >
            <Clipboard size={13} />
            {copied ? "已复制" : "复制地址"}
          </button>
        )}
      </div>
    </div>
  );
}
