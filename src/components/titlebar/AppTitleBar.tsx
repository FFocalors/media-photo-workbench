import { BrandLogo } from "../common/BrandLogo";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";

interface AppTitleBarProps {
  /** Whether to show business info (mode, event, stats). Startup page hides these. */
  showBusinessInfo?: boolean;
  /** Display mode label. */
  modeLabel?: string;
  /** Event summary counts from API. */
  summary?: { total_images: number; edited_images: number } | null;
}

/**
 * Custom read-only title bar for the transparent window shell.
 * All business content is pointer-events: none (non-interactive).
 * Blank areas are draggable (-webkit-app-region: drag).
 * Native window control buttons are rendered by Electron's titleBarOverlay
 * on the right side; we leave padding for them.
 */
export function AppTitleBar({
  showBusinessInfo = false,
  modeLabel,
  summary
}: AppTitleBarProps) {
  const pageEvent = useCurrentPageEventStore((s) => s.event);

  return (
    <div
      className="titlebar"
      style={{
        display: "flex",
        alignItems: "center",
        height: 48,
        paddingLeft: 12,
        paddingRight: 160, // reserve space for native overlay buttons (~140-150px on Windows 11)
        gap: 10,
        // @ts-expect-error -webkit-app-region is not in CSSProperties type
        WebkitAppRegion: "drag",
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
    </div>
  );
}
