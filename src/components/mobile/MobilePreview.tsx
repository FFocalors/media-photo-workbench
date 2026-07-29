import { ChevronLeft, ChevronRight, Download, Info, MessageSquare, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EventImageData, ImageStatus } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";
import { RetryableImage } from "../gallery/RetryableImage";
import { MobileDownloadSheet } from "./MobileDownloadSheet";
import { MobileMetadataSheet } from "./MobileMetadataSheet";
import { MobileRatingStars } from "./MobileRatingStars";
import { MobileRemarkSheet } from "./MobileRemarkSheet";
import { MobileStatusSheet } from "./MobileStatusSheet";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_MOVE_THRESHOLD = 12;
const SWIPE_THRESHOLD = 64;

type SaveFeedback = { kind: "saving" | "saved" | "error"; text: string } | null;

/**
 * Fullscreen mobile image preview (replaces the desktop right-metadata-panel
 * PreviewModal). Gestures on the image surface:
 *   - swipe left/right      -> previous / next photo (when not zoomed)
 *   - pinch                 -> zoom (1x..4x) around the pinch midpoint
 *   - double tap            -> toggle 1x / 2.5x zoom at the tap point
 *   - single tap            -> show / hide the toolbars
 * Loads the preview rendition, never the original. Rating / status / remark /
 * metadata / download live in the bottom toolbar.
 */
export function MobilePreview({
  photo,
  photos,
  onClose,
  onNavigate,
  onRatingChange,
  onStatusChange,
  onRemarkChange
}: {
  photo: EventImageData;
  photos: EventImageData[];
  onClose: () => void;
  onNavigate: (direction: 1 | -1) => void;
  onRatingChange: (id: string, rating: number) => Promise<void>;
  onStatusChange: (id: string, status: ImageStatus) => Promise<void>;
  onRemarkChange: (id: string, remark: string) => Promise<void>;
}) {
  useLockBodyScroll(true);

  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [feedback, setFeedback] = useState<SaveFeedback>(null);
  const [sheet, setSheet] = useState<"status" | "remark" | "metadata" | "download" | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef(transform);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; scale: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number } | null>(null);
  const swipeRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const setLive = (next: { scale: number; x: number; y: number }) => {
    liveRef.current = next;
    setTransform(next);
  };

  // Reset the transform whenever the displayed photo changes.
  useEffect(() => {
    setLive({ scale: 1, x: 0, y: 0 });
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    lastTapRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  useEffect(() => () => {
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const clampPan = (x: number, y: number, scale: number) => {
    const el = stageRef.current;
    if (!el) return { x, y };
    const rect = el.getBoundingClientRect();
    const maxX = (rect.width * (scale - 1)) / 2 + 48;
    const maxY = (rect.height * (scale - 1)) / 2 + 48;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y))
    };
  };

  const showFeedback = (kind: "saving" | "saved" | "error", text: string) => {
    setFeedback({ kind, text });
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    if (kind !== "saving") {
      feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), kind === "error" ? 3000 : 1500);
    }
  };

  const runInstantAction = async (action: () => Promise<void>) => {
    showFeedback("saving", "保存中...");
    try {
      await action();
      showFeedback("saved", "已保存");
    } catch {
      showFeedback("error", "保存失败，请重试");
    }
  };

  const handleRating = (rating: number) => {
    void runInstantAction(() => onRatingChange(photo.id, rating));
  };

  const handleStatus = (status: ImageStatus) => {
    void runInstantAction(() => onStatusChange(photo.id, status));
  };

  const handleSaveRemark = async (remark: string) => {
    await onRemarkChange(photo.id, remark);
    showFeedback("saved", "备注已保存");
  };

  // ---- gesture handlers ----

  const toggleZoom = (clientX: number, clientY: number) => {
    const current = liveRef.current;
    if (current.scale > 1.01) {
      setLive({ scale: 1, x: 0, y: 0 });
      return;
    }
    const el = stageRef.current;
    let nx = 0;
    let ny = 0;
    if (el) {
      const rect = el.getBoundingClientRect();
      const cx = clientX - (rect.left + rect.width / 2);
      const cy = clientY - (rect.top + rect.height / 2);
      nx = -cx * (DOUBLE_TAP_SCALE - 1);
      ny = -cy * (DOUBLE_TAP_SCALE - 1);
    }
    const clamped = clampPan(nx, ny, DOUBLE_TAP_SCALE);
    setLive({ scale: DOUBLE_TAP_SCALE, x: clamped.x, y: clamped.y });
  };

  const handleTap = (clientX: number, clientY: number) => {
    const now = performance.now();
    const last = lastTapRef.current;
    if (last && now - last.time < 320 && Math.hypot(clientX - last.x, clientY - last.y) < 32) {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = null;
      toggleZoom(clientX, clientY);
      return;
    }
    lastTapRef.current = { time: now, x: clientX, y: clientY };
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => {
      lastTapRef.current = null;
      setToolbarVisible((visible) => !visible);
    }, 320);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    try { stageRef.current?.setPointerCapture(event.pointerId); } catch { /* noop */ }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setGesturing(true);

    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: distance(pts[0], pts[1]),
        scale: liveRef.current.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        tx: liveRef.current.x,
        ty: liveRef.current.y
      };
      panRef.current = null;
      swipeRef.current = null;
    } else if (pointersRef.current.size === 1) {
      pinchRef.current = null;
      panRef.current = { startX: event.clientX, startY: event.clientY, baseTx: liveRef.current.x, baseTy: liveRef.current.y };
      swipeRef.current = { startX: event.clientX, startY: event.clientY, startTime: performance.now() };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const pinch = pinchRef.current;
      const newDist = distance(pts[0], pts[1]);
      const newScale = Math.min(MAX_SCALE, Math.max(1, pinch.scale * (newDist / (pinch.dist || 1))));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const clamped = clampPan(pinch.tx + (midX - pinch.cx), pinch.ty + (midY - pinch.cy), newScale);
      setLive({ scale: newScale, x: clamped.x, y: clamped.y });
      return;
    }

    if (pointersRef.current.size === 1 && panRef.current) {
      const pan = panRef.current;
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (liveRef.current.scale > 1) {
        const clamped = clampPan(pan.baseTx + dx, pan.baseTy + dy, liveRef.current.scale);
        setLive({ scale: liveRef.current.scale, x: clamped.x, y: clamped.y });
      } else if (Math.abs(dx) > Math.abs(dy)) {
        // horizontal drag feedback while deciding on a swipe
        setLive({ scale: 1, x: dx * 0.55, y: 0 });
      }
    }
  };

  const onPointerEnd = (event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    if (pointersRef.current.size === 0) {
      setGesturing(false);
      const swipe = swipeRef.current;
      panRef.current = null;
      swipeRef.current = null;

      if (swipe) {
        const dx = event.clientX - swipe.startX;
        const dy = event.clientY - swipe.startY;
        const dt = performance.now() - swipe.startTime;
        const isTap = Math.abs(dx) < TAP_MOVE_THRESHOLD && Math.abs(dy) < TAP_MOVE_THRESHOLD && dt < 400;

        // Tap (single toggles toolbar, double toggles zoom): no settle afterwards,
        // so a double-tap zoom is not immediately undone.
        if (isTap) {
          handleTap(event.clientX, event.clientY);
          return;
        }

        const current = liveRef.current;
        if (current.scale <= 1.01 && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) {
          if (tapTimerRef.current !== null) {
            window.clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
          }
          lastTapRef.current = null;
          setLive({ scale: 1, x: 0, y: 0 });
          onNavigate(dx < 0 ? 1 : -1);
          return;
        }
      }

      // Settle after a pan gesture.
      const current = liveRef.current;
      if (current.scale <= 1.01) {
        setLive({ scale: 1, x: 0, y: 0 });
      } else {
        const clamped = clampPan(current.x, current.y, current.scale);
        setLive({ scale: current.scale, x: clamped.x, y: clamped.y });
      }
    } else if (pointersRef.current.size === 1) {
      // pinch -> single finger: re-base the pan so the image doesn't jump
      const pt = [...pointersRef.current.values()][0];
      panRef.current = { startX: pt.x, startY: pt.y, baseTx: liveRef.current.x, baseTy: liveRef.current.y };
      swipeRef.current = null;
    }
  };

  const index = photos.findIndex((item) => item.id === photo.id);
  const total = photos.length;

  return (
    <div className="mpw-h-screen fixed inset-0 z-[70] flex flex-col bg-black text-white">
      {/* Gesture stage */}
      <div
        className="mpw-gesture relative min-h-0 flex-1 overflow-hidden"
        onPointerCancel={onPointerEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        ref={stageRef}
      >
        <div
          className="flex h-full w-full items-center justify-center will-change-transform"
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transition: gesturing ? "none" : "transform 0.18s ease-out"
          }}
        >
          <RetryableImage
            alt={photo.original_filename}
            className="max-h-full max-w-full select-none object-contain"
            draggable={false}
            src={photo.preview_url}
          />
        </div>
      </div>

      {/* Prev / next affordances — siblings of the gesture stage, so tapping them
          does not also register as a stage tap. */}
      {toolbarVisible && total > 1 && transform.scale <= 1.01 && (
        <>
          <button
            aria-label="上一张"
            className="mpw-touch absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 active:bg-black/55"
            onClick={() => onNavigate(-1)}
            type="button"
          >
            <ChevronLeft size={26} />
          </button>
          <button
            aria-label="下一张"
            className="mpw-touch absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 active:bg-black/55"
            onClick={() => onNavigate(1)}
            type="button"
          >
            <ChevronRight size={26} />
          </button>
        </>
      )}

      {/* Top bar */}
      {toolbarVisible && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent mpw-pt-safe">
          <div className="flex h-14 items-center gap-2 px-2">
            <button
              aria-label="关闭预览"
              className="mpw-touch pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full text-white/90 active:bg-white/10"
              onClick={onClose}
              type="button"
            >
              <X size={22} />
            </button>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{photo.original_filename}</p>
              <p className="text-[11px] text-white/50">{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "尺寸未知"}</p>
            </div>
            <span className="shrink-0 rounded-full bg-black/35 px-2.5 py-1 text-[11px] text-white/80">
              {index >= 0 ? index + 1 : "-"} / {total}
            </span>
          </div>
        </div>
      )}

      {/* Save feedback pill */}
      {feedback && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
          style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
        >
          <span className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium shadow-lg",
            feedback.kind === "error" ? "bg-red-500/90 text-white" : feedback.kind === "saving" ? "bg-black/60 text-white/85" : "bg-emerald-500/90 text-white"
          )}>
            {feedback.text}
          </span>
        </div>
      )}

      {/* Bottom toolbar */}
      {toolbarVisible && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/60 to-transparent mpw-pb-safe">
          <div className="px-4 pb-2 pt-6">
            <div className="pointer-events-auto flex items-center justify-center">
              <MobileRatingStars onChange={handleRating} rating={photo.rating} size={28} tone="dark" />
            </div>

            <div className="mt-1 grid grid-cols-4 gap-2">
              <ToolbarButton icon={<Tag size={20} />} label="状态" onClick={() => setSheet("status")} />
              <ToolbarButton icon={<MessageSquare size={20} />} label="备注" onClick={() => setSheet("remark")} />
              <ToolbarButton icon={<Info size={20} />} label="元数据" onClick={() => setSheet("metadata")} />
              <ToolbarButton icon={<Download size={20} />} label="下载" onClick={() => setSheet("download")} />
            </div>
          </div>
        </div>
      )}

      {/* Sheets */}
      <MobileStatusSheet
        current={photo.status}
        onClose={() => setSheet(null)}
        onSelect={(status) => handleStatus(status)}
        open={sheet === "status"}
      />
      <MobileRemarkSheet
        initialRemark={photo.remark}
        onClose={() => setSheet(null)}
        onSave={handleSaveRemark}
        open={sheet === "remark"}
        photoName={photo.original_filename}
      />
      <MobileMetadataSheet onClose={() => setSheet(null)} open={sheet === "metadata"} photo={photo} />
      <MobileDownloadSheet onClose={() => setSheet(null)} open={sheet === "download"} photo={photo} />
    </div>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="mpw-touch pointer-events-auto flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-2 text-white/85 active:bg-white/10"
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
