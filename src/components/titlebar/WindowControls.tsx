import { useWindowShellStore } from "../../stores/windowStateStore";

/**
 * Custom window control buttons styled after Windows 11 / Mavis.
 * Positioned in the title bar right area with spacing from edges.
 * Each button has a capsule-shaped hover background.
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
        gap: 4,
        marginRight: 10,
        marginTop: 8,
        // @ts-expect-error -webkit-app-region is not in CSSProperties
        WebkitAppRegion: "no-drag",
        flexShrink: 0
      }}
    >
      {/* Minimize */}
      <WinButton ariaLabel="最小化" onClick={onMinimize}>
        <svg width="10" height="1.5" viewBox="0 0 10 1.5" fill="currentColor">
          <rect width="10" height="1.5" rx="0.75" />
        </svg>
      </WinButton>

      {/* Maximize / Restore */}
      <WinButton ariaLabel={maximized ? "还原" : "最大化"} onClick={onMaximize}>
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
            <path d="M4.5 1.5h5a1 1 0 0 1 1 1v5" />
            <path d="M3 4.5h5a1 1 0 0 1 1 1v5h-5a1 1 0 0 1-1-1z" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        )}
      </WinButton>

      {/* Close */}
      <WinButton ariaLabel="关闭" onClick={onClose} isClose>
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
        </svg>
      </WinButton>
    </div>
  );
}

/** Single window control button with capsule hover. */
function WinButton({
  ariaLabel,
  onClick,
  children,
  isClose = false
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  isClose?: boolean;
}) {
  const baseBg = "transparent";
  const hoverBg = isClose ? "#c42b1c" : "rgba(0,0,0,0.06)";
  const hoverColor = isClose ? "#fff" : "#333";

  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      type="button"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        border: "none",
        borderRadius: 10,
        background: baseBg,
        cursor: "pointer",
        color: "#555",
        transition: "background 0.1s, color 0.1s",
        padding: 0
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = baseBg;
        e.currentTarget.style.color = "#555";
      }}
    >
      {children}
    </button>
  );
}
