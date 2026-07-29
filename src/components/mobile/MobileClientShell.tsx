import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { BrandLogo } from "../common/BrandLogo";
import { getClientApiBase } from "../../lib/api";
import { cn } from "../../lib/cn";
import { subscribeRealtimeConnection, registerClientPresence, unregisterClientPresence } from "../../lib/socket";
import type { RealtimeConnectionState } from "../../lib/socket";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";

/**
 * Minimal mobile shell for the client photo wall. Replaces the entire desktop
 * chrome: no WindowShell rounded frame, no custom title bar, no window
 * controls, no left sidebar, no task center. Just a slim sticky top bar with
 * the app identity, the current event, the live connection state, and a
 * disconnect button.
 */
export function MobileClientShell() {
  const navigate = useNavigate();
  const hostAddress = getClientApiBase();
  const pageEvent = useCurrentPageEventStore((s) => s.event);
  const [realtime, setRealtime] = useState<RealtimeConnectionState>("disconnected");

  useEffect(() => {
    if (!hostAddress) return undefined;
    registerClientPresence();
    return () => {
      unregisterClientPresence();
    };
  }, [hostAddress]);

  useEffect(() => subscribeRealtimeConnection(setRealtime), []);

  // Not connected -> back to the connect page (mobile never renders the
  // desktop "not connected" panel).
  if (!hostAddress) {
    return <Navigate to="/client" replace />;
  }

  const statusLabel = realtime === "connected" ? "已连接" : realtime === "reconnecting" ? "重连中" : "已断开";
  const statusDot = realtime === "connected" ? "bg-emerald-500" : realtime === "reconnecting" ? "bg-amber-500" : "bg-slate-400";

  return (
    <div className="mpw-min-h-screen flex min-h-0 flex-col bg-[#F8F9FA] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur mpw-pt-safe">
        <div className="flex h-14 items-center gap-2 px-3">
          <BrandLogo size="sm" className="h-8 w-8 rounded-md" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-slate-900">融媒体图片工作台</p>
            <p className="truncate text-[11px] text-slate-500">
              {pageEvent?.eventName ? `当前活动：${pageEvent.eventName}` : "未选择活动"}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
            <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
            {statusLabel}
          </span>
          <button
            aria-label="断开连接"
            className="mpw-touch flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 active:bg-slate-100"
            onClick={() => navigate("/client?stay=1")}
            type="button"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
