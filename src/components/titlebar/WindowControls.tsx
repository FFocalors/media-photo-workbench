import { useWindowShellStore } from "../../stores/windowStateStore";

/**
 * Custom window control buttons (minimize / maximize-restore / close).
 * Replaces native titleBarOverlay buttons which require frame:true.
 * Rendered in the top-right corner of the title bar.
 */
export function WindowControls() {
  const maximized = useWindowShellStore((s) => s.maximized);
  const bridge = window.mediaPhotoWorkbench;

  const handleMinimize = () => bridge?.windowMinimize();
  const handleMaximizeRestore = () => bridge?.windowMaximizeRestore();
  const handleClose = () => bridge?.windowClose();

  return (
    <div
      className="titlebar-controls"
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        // @ts-expect-error -webkit-app-region is not in CSSProperties
        WebkitAppRegion: "no-drag",
        flexShrink: 0
      }}
    >
      {/* Minimize */}
      <button
        aria-label="最小化"
        onClick={handleMinimize}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 46,
          height: 32,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#697386"
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        type="button"
      >
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>

      {/* Maximize / Restore */}
      <button
        aria-label={maximized ? "还原" : "最大化"}
        onClick={handleMaximizeRestore}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 46,
          height: 32,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#697386"
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        type="button"
      >
        {maximized ? (
          // Restore icon (overlapping squares)
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="0" width="8" height="8" rx="1" />
            <rect x="0" y="2" width="8" height="8" rx="1" fill="#f6f8fb" />
            <rect x="0" y="2" width="8" height="8" rx="1" />
          </svg>
        ) : (
          // Maximize icon (single square)
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        aria-label="关闭"
        onClick={handleClose}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 46,
          height: 32,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "#697386"
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#c42b1c";
          (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "#697386";
        }}
        type="button"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="1" y1="1" x2="9" y2="9" />
          <line x1="9" y1="1" x2="1" y2="9" />
        </svg>
      </button>
    </div>
  );
}
