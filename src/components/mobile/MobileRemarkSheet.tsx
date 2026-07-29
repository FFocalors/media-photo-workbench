import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { BottomSheet } from "./BottomSheet";

/**
 * Mobile remark editor — a bottom sheet with a large text field.
 *
 * - Font is 16px+ so iOS does not auto-zoom on focus.
 * - Cancel / close while the text is dirty asks for confirmation first, so a
 *   mistap never silently discards typed content.
 * - The sheet is bottom-anchored and the page viewport uses
 *   interactive-widget=resizes-content, so the field stays visible above the
 *   software keyboard; we also scroll it into view on focus as a fallback.
 * - Save reports its own busy/error state; a failed save can be retried
 *   without losing the draft.
 */
export function MobileRemarkSheet({
  open,
  onClose,
  initialRemark,
  photoName,
  onSave
}: {
  open: boolean;
  onClose: () => void;
  initialRemark: string;
  photoName: string;
  onSave: (remark: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialRemark);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-seed the draft each time the sheet opens.
  useEffect(() => {
    if (open) {
      setDraft(initialRemark);
      setError("");
      setConfirmDiscard(false);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = draft !== initialRemark;

  const requestClose = () => {
    if (saving) return;
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    onClose();
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setConfirmDiscard(false);
      onClose();
    } catch (err: any) {
      setError(err?.message || "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      closeOnBackdrop={false}
      footer={(
        confirmDiscard ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-amber-600">有未保存的修改，确定要放弃吗？</p>
            <div className="flex gap-3">
              <button
                className="mpw-touch h-11 flex-1 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 active:bg-slate-50"
                onClick={() => setConfirmDiscard(false)}
                type="button"
              >
                继续编辑
              </button>
              <button
                className="mpw-touch h-11 flex-1 rounded-xl bg-red-500 text-sm font-semibold text-white active:bg-red-600"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                type="button"
              >
                放弃修改
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              className="mpw-touch h-11 flex-1 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 active:bg-slate-50 disabled:opacity-50"
              disabled={saving}
              onClick={requestClose}
              type="button"
            >
              取消
            </button>
            <button
              className={cn(
                "mpw-touch h-11 flex-[2] rounded-xl text-sm font-semibold text-white",
                dirty && !saving ? "bg-blue-600 active:bg-blue-700" : "bg-slate-300"
              )}
              disabled={!dirty || saving}
              onClick={handleSave}
              type="button"
            >
              {saving ? "保存中..." : "保存备注"}
            </button>
          </div>
        )
      )}
      maxHeightClass="mpw-max-h-80"
      onClose={requestClose}
      open={open}
      title="备注"
      subtitle={photoName}
    >
      <div className="pb-4 pt-1">
        <textarea
          autoFocus
          className="max-h-72 min-h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-800 outline-none focus:border-blue-500"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            // Keep the field above the software keyboard even without
            // interactive-widget support.
            window.setTimeout(() => {
              textareaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }, 300);
          }}
          placeholder="填写这张图片的备注..."
          ref={textareaRef}
          value={draft}
        />
        {error && (
          <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <p className="mt-2 text-xs text-slate-400">保存后会实时同步到主机和其他设备。</p>
      </div>
    </BottomSheet>
  );
}
