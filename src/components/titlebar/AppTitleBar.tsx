import { useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { BrandLogo } from "../common/BrandLogo";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";
import { toggleWindowMaximize } from "../../stores/windowStateStore";
import { WindowControls } from "./WindowControls";
import { isElectronRuntime } from "../../lib/runtime";

interface AppTitleBarProps {
  /** Whether to show business info (mode, event, stats). Startup page hides these. */
  showBusinessInfo?: boolean;
  /** Display mode label. */
  modeLabel?: string;
  /** Event summary counts from API. */
  summary?: { total_images: number; edited_images: number } | null;
}

/** Movement (px) past which a title-bar press becomes a drag instead of a click/double-click. */
const DRAG_THRESHOLD = 3;

/**
 * Custom read-only title bar for the transparent frameless window.
 * All business content is pointer-events: none (non-interactive).
 * Window control buttons (minimize/maximize/close) are custom-rendered on the right.
 *
 * The whole bar uses -webkit-app-region: no-drag. Native drag regions swallow the
 * DOM dblclick event on Windows (and the OS caption double-click does not reach our
 * manual, bounds-based maximize), so a native draggable title bar cannot support
 * double-click-to-maximize here. Instead a single custom pointer drag handles both
 * windowed movement and drag-from-maximized restore, while dblclick toggles maximize.
 */
export function AppTitleBar({
  showBusinessInfo = false,
  modeLabel,
  summary
}: AppTitleBarProps) {
  const pageEvent = useCurrentPageEventStore((s) => s.event);
  const titlebarRef = useRef<HTMLDivElement | null>(null);
  const isElectron = isElectronRuntime();
  const dragRef = useRef<{
    pointerId: number;
    ratioX: number;
    offsetY: number;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, .titlebar-no-drag")) return;
    event.preventDefault();
    void toggleWindowMaximize();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, .titlebar-no-drag")) return;
    if (!window.mediaPhotoWorkbench?.beginTitlebarDrag) return;

    const rect = titlebarRef.current?.getBoundingClientRect();
    const barWidth = rect?.width || 1;
    dragRef.current = {
      pointerId: event.pointerId,
      ratioX: (event.clientX - (rect?.left ?? 0)) / barWidth,
      offsetY: event.clientY - (rect?.top ?? 0),
      startX: event.screenX,
      startY: event.screenY,
      started: false
    };
    try { titlebarRef.current?.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || drag.started) return;
    // Ignore sub-threshold jitter so a plain click / double-click still toggles.
    const moved = Math.abs(event.screenX - drag.startX) + Math.abs(event.screenY - drag.startY);
    if (moved < DRAG_THRESHOLD) return;
    const bridge = window.mediaPhotoWorkbench;
    if (!bridge?.beginTitlebarDrag) {
      dragRef.current = null;
      return;
    }
    // First real movement: hand off to the main process, which restores (if
    // maximized) and then follows the cursor for the rest of the gesture.
    drag.started = true;
    void bridge.beginTitlebarDrag({ ratioX: drag.ratioX, offsetY: drag.offsetY });
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasStarted = drag.started;
    dragRef.current = null;
    try { titlebarRef.current?.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    if (wasStarted) {
      void window.mediaPhotoWorkbench?.endTitlebarDrag?.();
    }
  };

  return (
    <div
      ref={titlebarRef}
      className="titlebar"
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{
        display: "flex",
        alignItems: "center",
        height: 48,
        paddingLeft: 14,
        gap: 10,
        // @ts-expect-error -webkit-app-region is not in CSSProperties type
        WebkitAppRegion: "no-drag",
        userSelect: "none",
        flexShrink: 0,
        background: "transparent"
      }}
    >
      {/* App icon and name — always shown */}
      <BrandLogo size="sm" className="titlebar-no-drag" imageClassName="titlebar-no-drag" />
      <span
        className="titlebar-no-drag"
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: "#172033",
          whiteSpace: "nowrap",
          letterSpacing: "0.01em"
        }}
      >
        融媒体图片工作台
      </span>

      {showBusinessInfo && (
        <>
          {/* Mode badge */}
          {modeLabel && (
            <span
              className="titlebar-no-drag"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#3a7ca5",
                background: "#eef6ff",
                borderRadius: 4,
                padding: "2px 8px",
                whiteSpace: "nowrap"
              }}
            >
              {modeLabel}
            </span>
          )}

          {/* Separator */}
          <span style={{ width: 1, height: 20, background: "#d9e2ec", flexShrink: 0 }} />

          {/* Current event name */}
          <span
            className="titlebar-no-drag"
            style={{
              fontSize: 12,
              color: "#697386",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 240
            }}
          >
            当前活动：{pageEvent?.eventName || "未选择"}
          </span>

          {/* Stats — only shown when an event is selected and data is loaded */}
          {pageEvent && summary && (
            <>
              <span style={{ width: 1, height: 20, background: "#d9e2ec", flexShrink: 0 }} />
              <span
                className="titlebar-no-drag"
                style={{ fontSize: 12, color: "#697386", whiteSpace: "nowrap" }}
              >
                已导入{" "}
                <span style={{ fontWeight: 600, color: "#172033" }}>
                  {summary.total_images.toLocaleString()}
                </span>
                {" · "}已修{" "}
                <span style={{ fontWeight: 600, color: "#172033" }}>
                  {summary.edited_images.toLocaleString()}
                </span>
              </span>
            </>
          )}
        </>
      )}

      {/* Spacer pushes window controls to the right. In web mode the controls
          don't render, so the spacer (and the empty area it would reserve) is
          omitted to keep the page header compact. */}
      {isElectron && <div style={{ flex: 1 }} />}

      {/* Custom window control buttons (minimize / maximize / close).
          Electron only — web mode never binds any window-control IPC. */}
      {isElectron && <WindowControls />}
    </div>
  );
}
