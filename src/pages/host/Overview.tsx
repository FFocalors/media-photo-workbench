import { Activity, Archive, Clipboard, Database, FolderKanban, HardDrive, ImagePlus, LayoutGrid, Settings, UploadCloud, Users, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeCard } from "../../components/common/QRCodeCard";
import {
  checkRepository,
  ClientPresenceData,
  EventData,
  eventStatusLabels,
  fetchEvents,
  fetchHealth,
  fetchOnlineClients,
  fetchSettings,
  getApiBase,
  HealthData,
  imageStatusLabels,
  RepositoryCheckData,
  SettingsData
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { Notice, StatusPill, TransientNotice } from "../../components/ui/States";
import { subscribeClientsUpdated, subscribeRealtimeImageEvent, subscribeRealtimeTaskEvent, type RealtimeImagePayload } from "../../lib/socket";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";

type LiveActivity = {
  id: string;
  text: string;
  at: string;
  tone: "upload" | "update" | "delete" | "task";
};

export function OverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [repository, setRepository] = useState<RepositoryCheckData | null>(null);
  const [currentEvent, setCurrentEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [onlineClients, setOnlineClients] = useState<ClientPresenceData[]>([]);
  const [activities, setActivities] = useState<LiveActivity[]>([]);

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

  // Sync current event to global title bar context
  const setCurrentPageEvent = useCurrentPageEventStore((s) => s.setCurrentPageEvent);
  const clearCurrentPageEvent = useCurrentPageEventStore((s) => s.clearCurrentPageEvent);
  useEffect(() => {
    if (currentEvent) {
      setCurrentPageEvent({ eventId: currentEvent.id, eventName: currentEvent.name }, "overview");
    }
    return () => { clearCurrentPageEvent("overview"); };
  }, [currentEvent, setCurrentPageEvent, clearCurrentPageEvent]);

  useEffect(() => {
    const pushActivity = (activity: LiveActivity) => {
      setActivities((current) => [activity, ...current].slice(0, 20));
    };

    fetchOnlineClients()
      .then((res) => {
        if (res.ok && res.data) setOnlineClients(res.data.clients);
      })
      .catch(() => {
        // Socket.IO presence updates will still arrive after connection.
      });

    const unsubscribeClients = subscribeClientsUpdated((payload) => {
      setOnlineClients(payload.clients);
    });
    const unsubscribeCreated = subscribeRealtimeImageEvent("image-created", (payload) => {
      pushActivity(buildImageActivity("created", payload));
    });
    const unsubscribeUpdated = subscribeRealtimeImageEvent("image-updated", (payload) => {
      pushActivity(buildImageActivity("updated", payload));
    });
    const unsubscribeDeleted = subscribeRealtimeImageEvent("image-deleted-logical", (payload) => {
      pushActivity(buildImageActivity("deleted", payload));
    });
    const unsubscribeTask = subscribeRealtimeTaskEvent((payload) => {
      if (payload.status !== "success") return;
      pushActivity({
        id: `task-${payload.id || payload.taskId}-${payload.updatedAt || Date.now()}`,
        text: `${payload.title || payload.type || "任务"} 已完成`,
        at: payload.updatedAt || new Date().toISOString(),
        tone: "task"
      });
    });

    return () => {
      unsubscribeClients();
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeTask();
    };
  }, []);

  const runtimeInfo = (window as any).mediaPhotoWorkbench?.getRuntimeInfo?.();
  const serverPort = health?.server.port ?? runtimeInfo?.serverPort ?? parsePortFromApiBase() ?? settings?.server.port ?? 3030;
  const repositoryReady = Boolean(repository?.path && repository.exists && repository.readable && repository.writable);
  const databaseReady = health?.database.status === "connected";
  const serverReady = health?.server.status === "running";
  const overallStatus = serverReady && databaseReady && repositoryReady ? "系统运行正常" : "系统需要处理";
  const apiLocalAddress = `http://localhost:${serverPort}`;
  const lanAddresses = health?.network?.lanAddresses ?? [];
  const isDevelopmentFrontend = window.location.port === "5173";

  // 二维码内容：开发模式指向前端 5173 地址，生产模式指向后端统一端口
  const qrCodeUrl = useMemo(() => {
    if (!serverReady) return null;
    if (isDevelopmentFrontend && lanAddresses.length > 0) {
      return `${window.location.protocol}//${lanAddresses[0].address}:5173`;
    }
    if (!isDevelopmentFrontend && lanAddresses.length > 0) {
      return `http://${lanAddresses[0].address}:${serverPort}`;
    }
    // 没有局域网 IP 时不生成二维码
    return null;
  }, [isDevelopmentFrontend, lanAddresses, serverPort, serverReady]);

  // 生产模式下的客户端访问地址列表
  const clientLanAddresses = isDevelopmentFrontend
    ? []
    : lanAddresses.map((item) => ({
        ...item,
        url: `http://${item.address}:${serverPort}`
      }));

  // 开发模式下的前端访问地址列表
  const frontendLanAddresses = isDevelopmentFrontend
    ? lanAddresses.map((item) => ({
        ...item,
        url: `${window.location.protocol}//${item.address}:5173`
      }))
    : [];

  // 开发模式下的 API 地址列表
  const apiLanAddresses = isDevelopmentFrontend
    ? lanAddresses.map((item) => ({
        ...item,
        url: `http://${item.address}:${serverPort}`
      }))
    : [];

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

      <TransientNotice className="mb-6" message={message} onDismiss={() => setMessage(null)} />

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
                <h3 className="mb-2 text-sm font-medium text-slate-500">存储空间</h3>
                {repository?.freeSpace != null && repository.totalSpace != null ? (
                  <>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-slate-900">{repository.freeSpaceText || formatBytes(repository.freeSpace)}</span>
                      <span className="text-xs text-slate-400">可用</span>
                    </div>
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, ((repository.totalSpace - repository.freeSpace) / repository.totalSpace) * 100))}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400">共 {repository.totalSpaceText || formatBytes(repository.totalSpace)}</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-slate-900">{formatBytes(repository?.freeSpace)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {repository?.path
                        ? (repository.capacityError || "无法读取磁盘空间信息")
                        : "请先在设置中配置仓库路径"}
                    </p>
                  </>
                )}
              </div>
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <HardDrive size={28} strokeWidth={1.6} />
              </div>
            </div>

            <div className="col-span-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-500">局域网访问地址</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {isDevelopmentFrontend
                      ? "开发模式：前端 Vite 5173，后端 API 独立端口；二维码指向前端地址，客户端浏览器需先打开前端页面。"
                      : "生产模式：客户端浏览器直接访问后端端口，前端页面、API 和 Socket.IO 使用同一地址。"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">推荐连接顺序：</span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1">1. WLAN / 以太网地址</span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1">2. 校园网不通时使用 Windows 热点</span>
                    <Link className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-600 hover:bg-blue-100" to="/host/settings">
                      3. 复制诊断信息排查
                    </Link>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,760px)_minmax(260px,1fr)] xl:items-start">
                <div className="space-y-3">
                  {qrCodeUrl && (
                    <AddressRow
                      copied={copied === "qr"}
                      label={isDevelopmentFrontend ? "扫码访问 / 前端页面" : "扫码访问 / 客户端页面"}
                      onCopy={() => copyAddress(qrCodeUrl, "qr")}
                      value={qrCodeUrl}
                    />
                  )}
                  <AddressRow
                    copied={copied === "local"}
                    label={isDevelopmentFrontend ? "本机 API" : "本机客户端访问"}
                    onCopy={() => copyAddress(apiLocalAddress, "local")}
                    value={apiLocalAddress}
                  />
                  {!isDevelopmentFrontend && (
                    <AddressRow
                      copied={copied === "local-health"}
                      label="本机 API 健康检查"
                      onCopy={() => copyAddress(`${apiLocalAddress}/api/health`, "local-health")}
                      value={`${apiLocalAddress}/api/health`}
                    />
                  )}
                  {lanAddresses.length > 0 ? (
                    <>
                      {isDevelopmentFrontend ? (
                        <>
                          <p className="text-[11px] font-medium text-slate-400">前端开发地址</p>
                          {frontendLanAddresses.map((item, index) => (
                            <AddressRow
                              copied={copied === `frontend-${index}`}
                              key={`frontend-${item.name}-${item.address}`}
                              label={item.name}
                              onCopy={() => copyAddress(item.url, `frontend-${index}`)}
                              value={item.url}
                            />
                          ))}
                          <p className="text-[11px] font-medium text-slate-400">后端 API 地址</p>
                          {apiLanAddresses.map((item, index) => (
                            <AddressRow
                              copied={copied === `api-${index}`}
                              key={`api-${item.name}-${item.address}`}
                              label={item.name}
                              onCopy={() => copyAddress(item.url, `api-${index}`)}
                              value={item.url}
                            />
                          ))}
                        </>
                      ) : (
                        <>
                          <p className="text-[11px] font-medium text-slate-400">客户端访问地址</p>
                          {clientLanAddresses.map((item, index) => (
                            <AddressRow
                              copied={copied === `client-${index}`}
                              key={`client-${item.name}-${item.address}`}
                              label={item.name}
                              onCopy={() => copyAddress(item.url, `client-${index}`)}
                              value={item.url}
                            />
                          ))}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      <WifiOff size={15} />
                      暂未检测到可用局域网 IPv4 地址
                    </div>
                  )}
                </div>

                <div className="xl:justify-self-center">
                  <QRCodeCard
                    copyable
                    emptyText={serverReady ? "暂无可用局域网地址" : "请先启动主机服务"}
                    label="扫码访问"
                    showText={false}
                    size={104}
                    value={qrCodeUrl}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mb-8 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <InfoCard label="在线客户端">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Users size={22} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{onlineClients.length}</p>
                    <p className="text-xs text-slate-400">主机自身不计入</p>
                  </div>
                </div>
              </div>
              {onlineClients.length > 0 ? (
                <div className="space-y-2">
                  {onlineClients.map((client) => {
                    const name = client.displayName?.trim() || client.clientName || "未命名客户端";
                    return (
                      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2" key={client.clientId}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800" title={name}>{name}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-400" title={client.clientName}>
                            {client.clientName || client.address || "局域网客户端"}
                          </p>
                        </div>
                        <span className="ml-3 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-400">暂无客户端在线。</p>
              )}
            </InfoCard>

            <InfoCard label="现场动态">
              {activities.length > 0 ? (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {activities.map((activity) => (
                    <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2" key={activity.id}>
                      <div className={cn("mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", activityToneClass(activity.tone))}>
                        <Activity size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="break-words text-sm text-slate-700">{activity.text}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatActivityTime(activity.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-400">等待客户端上传、选片或任务完成后显示最近动态。</p>
              )}
            </InfoCard>
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

function buildImageActivity(kind: "created" | "updated" | "deleted", payload: RealtimeImagePayload): LiveActivity {
  const photo = payload.image;
  const filename = photo?.original_filename || payload.imageId;
  const actorName = payload.actor?.name || "未知操作者";
  const uploaderName = photo?.uploaded_by_name || (photo?.source_type === "host_import" ? "主机" : photo?.source_type === "camera_ftp" ? "相机 FTP" : "客户端");
  const at = payload.updatedAt || new Date().toISOString();

  if (kind === "created") {
    return {
      id: `created-${payload.imageId}-${at}`,
      text: photo?.source_type === "host_import"
        ? `主机导入了 ${filename}`
        : photo?.source_type === "camera_ftp"
          ? `${uploaderName} 传入了 ${filename}`
          : `${uploaderName} 上传了 ${filename}`,
      at,
      tone: "upload"
    };
  }

  if (kind === "deleted") {
    return {
      id: `deleted-${payload.imageId}-${at}`,
      text: `${actorName} 删除了 ${filename}`,
      at,
      tone: "delete"
    };
  }

  return {
    id: `updated-${payload.action}-${payload.imageId}-${at}`,
    text: describeImageUpdate(payload.action, filename, actorName, photo),
    at,
    tone: "update"
  };
}

function describeImageUpdate(
  action: string,
  filename: string,
  actorName: string,
  photo?: RealtimeImagePayload["image"]
): string {
  if (action === "rating_changed") {
    return `${actorName} 将 ${filename} 评为 ${photo?.rating ?? 0} 星`;
  }
  if (action === "status_changed") {
    const label = photo?.status ? imageStatusLabels[photo.status] : "新状态";
    return `${actorName} 将 ${filename} 标记为 ${label}`;
  }
  if (action === "category_changed") {
    return `${actorName} 修改了 ${filename} 的分类`;
  }
  if (action === "remark_changed") {
    return `${actorName} 修改了 ${filename} 的备注`;
  }
  if (action === "image_restored") {
    return `${actorName} 恢复了 ${filename}`;
  }
  return `${actorName} 修改了 ${filename}`;
}

function formatActivityTime(value: string): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function activityToneClass(tone: LiveActivity["tone"]): string {
  if (tone === "upload") return "bg-blue-50 text-blue-600";
  if (tone === "delete") return "bg-red-50 text-red-600";
  if (tone === "task") return "bg-emerald-50 text-emerald-600";
  return "bg-slate-100 text-slate-600";
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
