import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useConnectedClients, type ConnectedClientEntry } from "../../hooks/useConnectedClients";

/**
 * Sidebar footer entry showing the number of LAN clients connected to the host,
 * with a lightweight Popover listing them by name. Only clients registered over
 * Socket.IO are counted — the host itself and FTP cameras are never included.
 */
export function ConnectedClientsPanel() {
  const { clients, onlineCount } = useConnectedClients();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setExpandedId(null);
      }
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  // Names that appear more than once get a device-name suffix to distinguish them.
  const duplicateDisplayNames = new Set<string>();
  const seen = new Map<string, number>();
  for (const client of clients) {
    const name = primaryName(client);
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) duplicateDisplayNames.add(name);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-slate-50"
        onClick={() => {
          setOpen((value) => !value);
          setExpandedId(null);
        }}
        type="button"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Users size={16} />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-slate-800">已连接客户端</span>
          <span className="truncate text-xs text-slate-400">
            {onlineCount > 0 ? `${onlineCount} 人在线` : "暂无客户端连接"}
          </span>
        </div>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[280px] rounded-xl border border-slate-100 bg-white p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">已连接客户端</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
              {onlineCount} 人在线
            </span>
          </div>

          {clients.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-400">暂无客户端连接</p>
          ) : (
            <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
              {clients.map((client) => {
                const name = primaryName(client);
                const display = duplicateDisplayNames.has(name) && client.clientName ? `${name} · ${client.clientName}` : name;
                const expanded = expandedId === client.clientId;
                return (
                  <div
                    className={cn(
                      "rounded-lg px-2.5 py-2",
                      expanded ? "bg-slate-50" : "hover:bg-slate-50"
                    )}
                    key={client.clientId}
                  >
                    <button
                      className="flex w-full items-center gap-2 text-left"
                      onClick={() => setExpandedId(expanded ? null : client.clientId)}
                      type="button"
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          client.status === "online" ? "bg-emerald-500" : "bg-amber-400"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800" title={display}>
                          {display}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {client.status === "reconnecting" ? "重连中…" : "在线"}
                        </span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="mt-2 space-y-1 pl-4 text-xs leading-5 text-slate-400">
                        <DetailLine label="设备名称" value={client.clientName} />
                        <DetailLine label="IP 地址" value={client.address} />
                        <DetailLine label="连接时间" value={formatTime(client.connectedAt)} />
                        <DetailLine label="最后活动" value={formatTime(client.lastSeenAt)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {clients.length > 0 && (
            <p className="mt-2 border-t border-slate-50 pt-2 text-[11px] leading-4 text-slate-400">
              仅展示当前在线客户端。客户端停止响应约 10 秒后将从列表移除。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function primaryName(client: ConnectedClientEntry): string {
  return client.displayName?.trim() || client.clientName || "未命名客户端";
}

function DetailLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p>
      <span className="text-slate-400">{label}：</span>
      <span className="text-slate-500">{value}</span>
    </p>
  );
}

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}