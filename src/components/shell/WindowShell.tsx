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
 * Windowed: 28px border-radius, CSS shadow follows the curve, 24px padding.
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
    >
      <div className="window-shell">
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
