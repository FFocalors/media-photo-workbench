import { useEffect } from "react";
import { useWindowShellStore, initWindowStateListener } from "../../stores/windowStateStore";
import { AppTitleBar } from "../titlebar/AppTitleBar";

interface WindowShellProps {
  children: React.ReactNode;
  showBusinessInfo?: boolean;
  modeLabel?: string;
  summary?: { total_images: number; edited_images: number } | null;
}

/**
 * Window shell for the transparent frameless Electron window.
 *
 * Structure:
 *   .window-root  (transparent, padding provides space for CSS shadow)
 *     .window-shell  (background, rounded corners, box-shadow)
 *       AppTitleBar
 *       .window-body  (page content)
 *
 * Windowed: 28px border-radius, CSS shadow follows the curve, 12px padding.
 * Maximized: fills entire screen, no radius/shadow/padding.
 */
export function WindowShell({ children, showBusinessInfo, modeLabel, summary }: WindowShellProps) {
  const maximized = useWindowShellStore((s) => s.maximized);
  const fullscreen = useWindowShellStore((s) => s.fullscreen);
  const isMaximized = maximized || fullscreen;

  useEffect(() => {
    const unsub = initWindowStateListener();
    return unsub;
  }, []);

  return (
    <div
      className="window-root"
      data-maximized={isMaximized ? "true" : "false"}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "transparent",
        overflow: "hidden",
        // Padding creates transparent space around .window-shell so the
        // CSS box-shadow is visible (not clipped by the BrowserWindow edge).
        padding: isMaximized ? 0 : 12
      }}
    >
      <div
        className="window-shell"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          borderRadius: isMaximized ? 0 : 28,
          overflow: "hidden",
          background: "#f6f8fb",
          boxShadow: isMaximized
            ? "none"
            : "0 10px 30px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.08)",
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
