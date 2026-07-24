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
 * - Windowed: rounded corners (24px), subtle shadow, slight margin from window edges.
 * - Maximized: fills entire screen, no rounded corners, no shadow, no margin.
 *   Sidebar keeps its own rounded corners and margin.
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
          width: isMaximized ? "100%" : "calc(100% - 16px)",
          height: isMaximized ? "100%" : "calc(100% - 16px)",
          borderRadius: isMaximized ? 0 : 24,
          overflow: "hidden",
          background: "#f6f8fb",
          boxShadow: isMaximized
            ? "none"
            : "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
          transition: "border-radius 0.15s ease, box-shadow 0.15s ease"
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
