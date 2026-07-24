import { useEffect } from "react";
import { useWindowShellStore, initWindowStateListener } from "../../stores/windowStateStore";
import { AppTitleBar } from "../titlebar/AppTitleBar";

interface WindowShellProps {
  children: React.ReactNode;
  /** Whether to show business info in the title bar (mode, event, stats). */
  showBusinessInfo?: boolean;
  /** Display mode label for the title bar. */
  modeLabel?: string;
  /** Event summary data for the title bar. */
  summary?: { total_images: number; edited_images: number } | null;
}

/**
 * Window shell that wraps the entire app content inside the transparent Electron window.
 *
 * - Windowed: rounded corners (28px), CSS shadow follows the curve, 12px margin from edges.
 * - Maximized: fills entire screen, no rounded corners, no shadow, no margin.
 *   Sidebar keeps its own rounded corners and margin.
 *
 * The system DWM shadow (hasShadow) is disabled in BrowserWindow because it
 * always draws on the rectangular HWND and ignores CSS border-radius.
 * All shadow is handled here via CSS box-shadow on the rounded container.
 */
export function WindowShell({ children, showBusinessInfo, modeLabel, summary }: WindowShellProps) {
  const maximized = useWindowShellStore((s) => s.maximized);
  const fullscreen = useWindowShellStore((s) => s.fullscreen);
  const isMaximized = maximized || fullscreen;

  // Initialize window state listener once
  useEffect(() => {
    const unsub = initWindowStateListener();
    return unsub;
  }, []);

  return (
    <div
      className="window-root"
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "transparent",
        overflow: "hidden"
      }}
    >
      <div
        className={`window-shell${isMaximized ? " window-shell--maximized" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          width: isMaximized ? "100%" : "calc(100% - 24px)",
          height: isMaximized ? "100%" : "calc(100% - 24px)",
          borderRadius: isMaximized ? 0 : 28,
          overflow: "hidden",
          background: "#f6f8fb",
          boxShadow: isMaximized
            ? "none"
            : [
                "0 0 0 1px rgba(0,0,0,0.04)",
                "0 4px 16px rgba(0,0,0,0.08)",
                "0 12px 40px rgba(0,0,0,0.10)"
              ].join(", "),
          transition: "border-radius 0.15s ease, box-shadow 0.15s ease, width 0.01s, height 0.01s"
        }}
      >
        <AppTitleBar
          showBusinessInfo={showBusinessInfo}
          modeLabel={modeLabel}
          summary={summary}
        />
        <div
          className="window-body"
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
            minHeight: 0
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
