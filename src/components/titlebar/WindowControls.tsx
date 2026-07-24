import { useWindowShellStore } from "../../stores/windowStateStore";

const BTN_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 46,
  height: 32,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#555",
  transition: "background 0.1s, color 0.1s"
};

/**
 * Custom window control buttons (minimize / maximize-restore / close).
 * Used with frame:false transparent window where native titleBarOverlay is unavailable.
 */
export function WindowControls() {
  const maximized = useWindowShellStore((s) => s.maximized);
  const bridge = window.mediaPhotoWorkbench;

  const onMinimize = () => { void bridge?.windowMinimize(); };
  const onMaximize = () => { void bridge?.windowMaximizeToggle(); };
  const onClose = () => { bridge?.windowClose(); };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        // @ts-expect-error -webkit-app-region is not in CSSProperties
        WebkitAppRegion: "no-drag",
        flexShrink: 0
      }}
    >
      {/* Minimize — horizontal line */}
      <button
        aria-label="最小化"
        onClick={onMinimize}
        style={BTN_STYLE}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        type="button"
      >
        <svg width="10" height="1.5" viewBox="0 0 10 1.5" fill="currentColor">
          <rect width="10" height="1.5" rx="0.5" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        aria-label={maximized ? "还原" : "最大化"}
        onClick={onMaximize}
        style={BTN_STYLE}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        type="button"
      >
        {maximized ? (
          // Restore: two overlapping rectangles
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
            <path d="M4.5 1.5h5a1 1 0 0 1 1 1v5" />
            <path d="M3 4.5h5a1 1 0 0 1 1 1v5h-5a1 1 0 0 1-1-1z" />
          </svg>
        ) : (
          // Maximize: single rectangle
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        )}
      </button>

      {/* Close — X */}
      <button
        aria-label="关闭"
        onClick={onClose}
        style={BTN_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#c42b1c";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#555";
        }}
        type="button"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
        </svg>
      </button>
    </div>
  );
}
