import { Archive, CheckCircle2, Clipboard, Database, FolderKanban, HardDrive, ImagePlus, LayoutGrid, Network, QrCode, Settings, UploadCloud, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  checkRepository,
  EventData,
  eventStatusLabels,
  fetchEvents,
  fetchHealth,
  fetchSettings,
  getApiBase,
  HealthData,
  RepositoryCheckData,
  SettingsData
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { Notice, StatusPill } from "../../components/ui/States";

export function OverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [repository, setRepository] = useState<RepositoryCheckData | null>(null);
  const [currentEvent, setCurrentEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [copied, setCopied] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const [healthRes, settingsRes, repositoryRes] = await Promise.all([
        fetchHealth(),
        fetchSettings(),
        checkRepository()
      ]);

      if (!healthRes.ok || !healthRes.data) {
        setMessage({ tone: "danger", title: "系统状态读取失败", body: healthRes.error?.message || "无法读取 /api/health。" });
        return;
      }
      if (!settingsRes.ok || !settingsRes.data) {
        setMessage({ tone: "danger", title: "设置读取失败", body: settingsRes.error?.message || "无法读取 /api/settings。" });
        return;
      }
      if (!repositoryRes.ok || !repositoryRes.data) {
        setMessage({ tone: "danger", title: "仓库检查失败", body: repositoryRes.error?.message || "无法读取 /api/repository/check。" });
        return;
      }

      setHealth(healthRes.data);
      setSettings(settingsRes.data);
      setRepository(repositoryRes.data);

      const activeRes = await fetchEvents("active");
      if (activeRes.ok && activeRes.data && activeRes.data.length > 0) {
        setCurrentEvent(activeRes.data[0]);
      } else {
        const reviewingRes = await fetchEvents("reviewing");
        setCurrentEvent(reviewingRes.ok && reviewingRes.data && reviewingRes.data.length > 0 ? reviewingRes.data[0] : null);
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "后端服务未连接", body: err?.message || "无法连接本地后端，请确认通过 pnpm dev 启动完整应用。" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const serverPort = health?.server.port ?? parsePortFromApiBase() ?? settings?.server.port ?? 3030;
  const repositoryReady = Boolean(repository?.path && repository.exists && repository.readable && repository.writable);
  const databaseReady = health?.database.status === "connected";
  const serverReady = health?.server.status === "running";
  const overallStatus = serverReady && databaseReady && repositoryReady ? "系统运行正常" : "系统需要处理";
  const apiLocalAddress = `http://localhost:${serverPort}`;
  const lanAddresses = health?.network?.lanAddresses ?? [];
  const frontendPort = window.location.port || String(serverPort);
  const frontendProtocol = window.location.protocol || "http:";
  const frontendLanAddresses = lanAddresses.map((item) => ({
    ...item,
    url: `${frontendProtocol}//${item.address}:${frontendPort}`
  }));

  const quickActions = useMemo(() => {
    const hasEvent = Boolean(currentEvent);
    return [
      { icon: FolderKanban, label: "新建活动", to: "/host/events", state: "可用" },
      { icon: ImagePlus, label: "导入图片", to: "/host/import", state: repositoryReady && hasEvent ? "可用" : repositoryReady ? "需活动" : "需仓库" },
      { icon: LayoutGrid, label: "打开图片墙", to: "/host/photos", state: hasEvent ? "可用" : "需活动" },
      { icon: UploadCloud, label: "导出发布", to: "/host/export", state: hasEvent ? "可用" : "需活动" },
      { icon: Archive, label: "归档管理", to: "/host/archive", state: "可用" }
    ];
  }, [currentEvent, repositoryReady]);

  const copyAddress = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => current === label ? "" : current), 1800);
    } catch {
      setMessage({ tone: "warning", title: "复制失败", body: "系统剪贴板不可用，请手动复制地址。" });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 xl:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-2xl font-bold text-slate-900">系统概览</h1>
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <span className={cn("h-2 w-2 rounded-full", serverReady && databaseReady && repositoryReady ? "bg-emerald-500" : "bg-amber-500")} />
            {loading ? "正在读取真实状态..." : overallStatus}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            onClick={() => void loadOverview()}
            type="button"
          >
            刷新
          </button>
          <Link className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50" to="/host/settings">
            <Settings size={16} />
            系统设置
          </Link>
        </div>
      </div>

      {message && <Notice className="mb-6" tone={message.tone} title={message.title}>{message.body}</Notice>}

      {loading ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-100 bg-white text-sm text-slate-400 shadow-sm">
          正在读取主机真实状态...
        </div>
      ) : (
        <>
          {!repository?.path && (
            <Notice className="mb-6" tone="warning" title="请先配置仓库路径">
              当前未保存图片仓库路径。请进入系统设置选择仓库路径，否则无法导入、上传和归档图片。
            </Notice>
          )}

          <div className="mb-8 grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <InfoCard label="当前活动">
              {currentEvent ? (
                <>
                  <div className="mb-2 flex items-center gap-3">
                    <span className="truncate font-semibold text-slate-900" title={currentEvent.name}>{currentEvent.name}</span>
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                      {eventStatusLabels[currentEvent.status as keyof typeof eventStatusLabels] || currentEvent.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">日期：{currentEvent.date || "未填写"} / 图片 {currentEvent.total_images.toLocaleString()} 张</p>
                </>
              ) : (
                <EmptyInline icon={FolderKanban} title="暂无进行中活动" body="没有 active 或 reviewing 活动。" />
              )}
            </InfoCard>

            <InfoCard label="仓库路径">
              <p className="mb-3 truncate font-medium text-slate-900" title={settings?.repository.path || repository?.path || ""}>
                {settings?.repository.path || repository?.path || "未配置"}
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={repository?.exists ? "success" : "warning"}>{repository?.exists ? "存在" : "不存在"}</StatusPill>
                <StatusPill tone={repository?.readable ? "success" : "warning"}>{repository?.readable ? "可读" : "不可读"}</StatusPill>
                <StatusPill tone={repository?.writable ? "success" : "warning"}>{repository?.writable ? "可写" : "不可写"}</StatusPill>
              </div>
            </InfoCard>

            <InfoCard label="数据库状态">
              <div className="mb-2 flex items-center gap-2">
                <Database className={databaseReady ? "text-emerald-500" : "text-red-500"} size={18} />
                <span className={cn("font-medium", databaseReady ? "text-emerald-600" : "text-red-600")}>
                  {databaseReady ? "已连接" : health?.database.status || "未知"}
                </span>
              </div>
              <p className="truncate text-xs text-slate-400" title={settings?.database.path || ""}>{settings?.database.path || "数据库路径暂不可用"}</p>
            </InfoCard>

            <div className="flex items-center rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex-1">
                <h3 className="mb-2 text-sm font-medium text-slate-500">剩余空间</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">{formatBytes(repository?.freeSpace)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{repository?.freeSpace == null ? "当前后端暂未提供真实剩余空间" : "仓库所在磁盘可用空间"}</p>
              </div>
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <HardDrive size={28} strokeWidth={1.6} />
              </div>
            </div>

            <div className="col-span-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-5">
                <div>
                  <h3 className="text-sm font-medium text-slate-500">局域网访问地址</h3>
                  <p className="mt-1 text-xs text-slate-400">端口来自真实后端状态。二维码暂不生成，避免开发模式下生成不可访问地址。</p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                  <QrCode size={34} strokeWidth={1.5} />
                </div>
              </div>

              <div className="space-y-3">
                <AddressRow copied={copied === "local"} label="本机 API" onCopy={() => copyAddress(apiLocalAddress, "local")} value={apiLocalAddress} />
                {lanAddresses.length > 0 ? (
                  lanAddresses.map((item, index) => (
                    <AddressRow
                      copied={copied === `lan-${index}`}
                      key={`${item.name}-${item.address}`}
                      label={`局域网 API / ${item.name}`}
                      onCopy={() => copyAddress(`http://${item.address}:${serverPort}`, `lan-${index}`)}
                      value={`http://${item.address}:${serverPort}`}
                    />
                  ))
                ) : (
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <WifiOff size={15} />
                    暂未检测到可用局域网 IPv4 地址
                  </div>
                )}
                {frontendLanAddresses.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-medium text-slate-500">前端开发访问候选</p>
                    {frontendLanAddresses.map((item, index) => (
                      <AddressRow
                        copied={copied === `frontend-${index}`}
                        key={`frontend-${item.name}-${item.address}`}
                        label={item.name}
                        onCopy={() => copyAddress(item.url, `frontend-${index}`)}
                        value={item.url}
                      />
                    ))}
                    <p className="mt-2 text-[11px] leading-5 text-amber-600">开发模式前端地址需要 Vite 使用 --host 0.0.0.0；生产打包后以前端实际托管方式为准。</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-medium text-slate-900">快捷操作</h3>
            <div className="flex flex-wrap gap-4">
              {quickActions.map((action) => (
                <ActionItem icon={action.icon} key={action.label} label={action.label} state={action.state} to={action.to} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function parsePortFromApiBase(): number | null {
  try {
    const parsed = new URL(getApiBase());
    return parsed.port ? Number(parsed.port) : null;
  } catch {
    return null;
  }
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return "暂不可用";
  if (!Number.isFinite(value) || value < 0) return "暂不可用";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-slate-500">{label}</h3>
      {children}
    </div>
  );
}

function EmptyInline({ icon: Icon, title, body }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400">
        <Icon size={18} strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <p className="mt-1 text-xs text-slate-400">{body}</p>
      </div>
    </div>
  );
}

function AddressRow({ copied, label, onCopy, value }: { copied: boolean; label: string; onCopy: () => void; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-blue-600" title={value}>{value}</p>
      </div>
      <button
        className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
        onClick={onCopy}
        type="button"
      >
        <Clipboard size={13} />
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

function ActionItem({ icon: Icon, label, state, to }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; state: string; to: string }) {
  const available = state === "可用";
  return (
    <Link className="group flex h-28 w-28 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-sm transition-all hover:border-blue-100 hover:shadow-md" to={to}>
      <div className={cn("mb-2 flex h-12 w-12 items-center justify-center rounded-xl transition-colors", available ? "bg-slate-50 text-blue-600 group-hover:bg-blue-50" : "bg-amber-50 text-amber-600")}>
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600">{label}</span>
      <span className={cn("mt-1 text-[10px]", available ? "text-emerald-600" : "text-amber-600")}>{state}</span>
    </Link>
  );
}
