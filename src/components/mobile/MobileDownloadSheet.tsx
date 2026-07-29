import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EventImageData } from "../../lib/api";
import { cn } from "../../lib/cn";
import { BottomSheet } from "./BottomSheet";
import { downloadOriginalWithProgress, getOriginalDownloadDirectUrl } from "./mobileDownload";

type Phase = "idle" | "downloading" | "success" | "error";

/**
 * Original-image download sheet. The original is only requested after an
 * explicit tap on 下载原图. Shows the filename + size up front, byte progress
 * (or an indeterminate state when the size is unknown), a retry on failure,
 * and a "在浏览器中打开" escape hatch for browsers that can't save blobs
 * directly (some iOS/Android cases).
 */
export function MobileDownloadSheet({
  open,
  onClose,
  photo
}: {
  open: boolean;
  onClose: () => void;
  photo: EventImageData | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Reset whenever the sheet is (re)opened for a photo.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setReceived(0);
      setTotal(0);
      setError("");
    }
  }, [open, photo?.id]);

  // Abort an in-flight download if the sheet closes mid-way.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!photo) return null;

  const startDownload = async () => {
    setError("");
    setReceived(0);
    setTotal(0);
    setPhase("downloading");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await downloadOriginalWithProgress(
        photo.id,
        photo.original_filename || "image",
        ({ received: r, total: t }) => {
          setReceived(r);
          setTotal(t);
        },
        controller.signal
      );
      setPhase("success");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setError(err?.message || "下载失败，请重试。");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  };

  const openInBrowser = () => {
    window.open(getOriginalDownloadDirectUrl(photo.id), "_blank", "noopener");
  };

  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;

  return (
    <BottomSheet maxHeightClass="mpw-max-h-60" onClose={onClose} open={open} title="下载原图">
      <div className="space-y-4 pb-4 pt-1">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="break-all text-sm font-medium text-slate-900">{photo.original_filename}</p>
          <p className="mt-1 text-xs text-slate-500">
            {photo.file_size ? `大小：${formatBytes(photo.file_size)}` : "大小未知"}
            {photo.width && photo.height ? ` · ${photo.width} × ${photo.height}` : ""}
          </p>
        </div>

        {!photo.original_exists && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
            原图文件缺失，无法下载。
          </p>
        )}

        {phase === "downloading" && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>正在下载...</span>
              <span>{percent !== null ? `${percent}%` : formatBytes(received)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full bg-blue-600 transition-[width]", percent === null && "animate-pulse")}
                style={percent !== null ? { width: `${percent}%` } : { width: "40%" }}
              />
            </div>
            <button
              className="mpw-touch mt-4 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 active:bg-slate-50"
              onClick={() => abortRef.current?.abort()}
              type="button"
            >
              取消下载
            </button>
          </div>
        )}

        {phase === "idle" && photo.original_exists && (
          <button
            className="mpw-touch flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-base font-semibold text-white active:bg-blue-700"
            onClick={startDownload}
            type="button"
          >
            <Download size={18} />
            下载原图
          </button>
        )}

        {phase === "success" && (
          <div className="space-y-3">
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              下载已开始。若未自动保存，可在浏览器下载记录或“文件”中查看。
            </p>
            <button
              className="mpw-touch w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white active:bg-blue-700"
              onClick={onClose}
              type="button"
            >
              完成
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            <div className="flex gap-3">
              <button
                className="mpw-touch flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-700"
                onClick={startDownload}
                type="button"
              >
                重试
              </button>
              <button
                className="mpw-touch flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-600 active:bg-slate-50"
                onClick={openInBrowser}
                type="button"
              >
                <ExternalLink size={15} />
                在浏览器中打开
              </button>
            </div>
          </div>
        )}

        {(phase === "idle" || phase === "downloading") && photo.original_exists && (
          <button
            className="mpw-touch mx-auto flex items-center justify-center gap-1.5 text-xs text-slate-400 active:text-slate-600"
            onClick={openInBrowser}
            type="button"
          >
            <ExternalLink size={13} />
            无法保存？在浏览器中打开
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
