import { useEffect } from "react";
import { useWindowShellStore, initWindowStateListener } from "../../stores/windowStateStore";
import { AppTitleBar } from "../titlebar/AppTitleBar";
import { isElectronRuntime } from "../../lib/runtime";

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
  const isElectron = isElectronRuntime();

  useEffect(() => {
    const unsub = initWindowStateListener();
    return unsub;
  }, []);

  // Web-only: globals.css pins html/body/#root to height:100% / overflow:hidden
  // for the Electron frameless window. In a plain browser that sizing traps the
  // document at exactly 100vh — the page can't grow and inner overflow:hidden
  // containers silently clip anything below the fold. We release those globals
  // here (and only here) when running outside Electron, restoring normal
  // document scrolling. The Electron path is untouched.
  useEffect(() => {
    if (isElectron) return;
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    const prevRootOverflow = document.getElementById("root")?.style.overflow ?? "";

    html.style.overflow = "auto";
    html.style.height = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";
    const root = document.getElementById("root");
    if (root) root.style.overflow = "visible";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.height = prevHtmlHeight;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
      if (root) root.style.overflow = prevRootOverflow;
    };
  }, [isElectron]);

  return (
    <div
      className="window-root"
      data-runtime={isElectron ? "electron" : "web"}
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
