import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ClipboardCopy, FolderOpen, RefreshCw, RotateCcw, Square, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  fetchCameraFtpDiagnostics,
  fetchCameraFtpStatus,
  fetchEvents,
  openCameraFtpFolder,
  restartCameraFtp,
  startCameraFtp,
  stopCameraFtp,
  updateCameraFtpActiveEvent,
  type CameraFtpStatusData,
  type EventData
} from "../../lib/api";
import { CameraFtpRecentFiles } from "./camera-ftp/CameraFtpRecentFiles";
import { TransientNotice, type TransientNoticeMessage } from "../ui/States";

const GUIDE_PATH = "/host/help/camera-ftp";

function describeError(error: { code: string; message: string; nextAction?: string } | null): string {
  if (!error) return "请求失败，请检查主机后端。";
  return `${error.message}${error.nextAction ? ` ${error.nextAction}` : ""}（${error.code}）`;
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-800" title={value}>{value}</div>
    </div>
  );
}

export function CameraFtpImportPanel() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CameraFtpStatusData | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<TransientNoticeMessage | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (admin = false, force = true) => {
    const response = await fetchCameraFtpStatus(force, admin);
    if (response.ok && response.data) {
      setStatus(response.data);
      setSelectedEventId((previous) => previous || response.data.activeEvent?.id || "");
    } else {
      setMessage({ tone: "danger", title: "状态检测失败", body: describeError(response.error) });
    }
    return response;
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchEvents("active"), fetchEvents("reviewing"), fetchEvents("draft"), fetchCameraFtpStatus()])
      .then(([active, reviewing, draft, current]) => {
        if (!mounted) return;
        const nextEvents = [active, reviewing, draft]
          .flatMap((response) => response.ok && response.data ? response.data : [])
          .filter((event, index, list) => list.findIndex((other) => other.id === event.id) === index);
        setEvents(nextEvents);
        if (current.ok && current.data) {
          setStatus(current.data);
          setSelectedEventId(current.data.activeEvent?.id || nextEvents[0]?.id || "");
        } else setMessage({ tone: "danger", title: "状态检测失败", body: describeError(current.error) });
      })
      .catch(() => { if (mounted) setMessage({ tone: "danger", title: "连接失败", body: "无法连接主机后端，请稍后重试。" }); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    // A normal background probe cannot read complete IIS settings on some
    // Windows profiles. Keep the explicit administrator inspection visible
    // until the user refreshes or a control operation returns a new snapshot.
    if (busy || status?.inspectionSource === "administrator") return;
    // Ordinary IIS inspection launches a PowerShell process and takes seconds
    // on this host. Avoid force-probing every 15 seconds while the user is
    // preparing an action; explicit refresh remains immediate.
    const timer = window.setInterval(() => { void refresh(false, false); }, 60000);
    return () => window.clearInterval(timer);
  }, [busy, refresh, status?.inspectionSource]);

  const runAction = async (action: string, operation: () => ReturnType<typeof startCameraFtp>) => {
    setBusy(action);
    setMessage(null);
    let shouldRefresh = true;
    try {
      const response = await operation();
      if (response.ok && response.data) {
        setStatus(response.data.status);
        setSelectedEventId(response.data.status.activeEvent?.id || selectedEventId);
        setMessage({ tone: "success", title: "操作完成", body: response.data.operation.message });
        shouldRefresh = false;
      } else setMessage({
        tone: "danger", title: "操作失败", body: <>
          {describeError(response.error)}
          {response.error?.details?.guideSection && <button type="button" className="ml-2 font-medium underline" onClick={() => navigate(`${GUIDE_PATH}#${response.error?.details?.guideSection}`)}>查看对应指导</button>}
        </>
      });
    } catch {
      setMessage({ tone: "danger", title: "操作未完成", body: "请检查主机后端和 IIS 状态。" });
    } finally {
      setBusy(null);
      if (shouldRefresh) void refresh();
    }
  };

  const copyDiagnostics = async () => {
    setBusy("diagnostics");
    try {
      const response = await fetchCameraFtpDiagnostics();
      if (!response.ok || !response.data) throw new Error(describeError(response.error));
      await navigator.clipboard.writeText(JSON.stringify(response.data, null, 2));
      setMessage({ tone: "success", title: "已复制", body: "脱敏诊断信息已复制。" });
    } catch (error) {
      setMessage({ tone: "danger", title: "复制失败", body: error instanceof Error ? error.message : "复制诊断信息失败。" });
    } finally {
      setBusy(null);
    }
  };

  const issueSection = status?.guideSection || "troubleshooting";
  const issueMessage = useMemo(() => {
    if (!status) return "正在读取 IIS FTP 状态。";
    if (status.issueCode === "IIS_STATUS_CHECK_TIMEOUT") return "只读状态检测超时；请刷新或使用管理员只读检测。";
    if (status.issueCode === "IIS_FTP_FEATURE_MISSING") return "IIS FTP 组件未完整启用。";
    if (status.issueCode === "FTP_SERVICE_NOT_RUNNING") return "Microsoft FTP Service 尚未运行。";
    if (status.issueCode === "FTP_DIRECTORY_PERMISSION_REQUIRED") return "接收目录缺少 FTP 账户的有效读写权限。";
    if (status.issueCode === "FTP_ACTIVE_EVENT_NOT_FOUND") return "原先关联的活动不在当前数据库中。请选择下方现有活动重新关联；不必先修改旧目录权限。";
    if (status.issueCode === "FTP_AUTHORIZATION_MISMATCH") return "FTP 授权规则不匹配。";
    return status.lastError?.message || status.warnings?.[0] || "请根据指导核对 IIS FTP 设置。";
  }, [status]);

  const siteStarted = status?.site?.started === true;
  const canSwitch = status?.canSwitchEvent === true && Boolean(selectedEventId) && selectedEventId !== status.activeEvent?.id;
  const address = status?.networkAddresses?.wlan?.[0]?.address || status?.networkAddresses?.hotspot?.address || status?.networkAddresses?.lan?.[0]?.address || "未检测到";

  return (
    <div className="space-y-6 pb-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">相机 FTP · Windows IIS</h2>
            <p className="mt-2 text-sm text-slate-500">手工配置 IIS 后，工作台负责检测站点、启停、切换接收活动和导入相机图片。</p>
          </div>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setBusy("refresh"); void refresh().finally(() => setBusy(null)); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} />刷新状态</button>
        </div>

        {status?.requiresAdminForFullInspection && (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-semibold">IIS 站点状态尚未确认，并非配置异常</p>
            <p className="mt-1">普通权限无法读取完整 IIS 配置。点击下面的按钮，在 Windows 弹窗中允许一次只读检测；工作台不会因此修改 IIS 设置。</p>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setBusy("admin-inspection"); void refresh(true).finally(() => setBusy(null)); }} className="mt-3 rounded-lg border border-blue-300 bg-white px-3 py-2 font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-40">以管理员权限检查站点</button>
          </div>
        )}

        <TransientNotice className="mt-5" message={message} onDismiss={() => setMessage(null)} />
        {status?.manualActionRequired && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">需要手工处理：{status.issueCode}</p>
            <p className="mt-1">{issueMessage}</p>
            <button type="button" onClick={() => navigate(`${GUIDE_PATH}#${issueSection}`)} className="mt-3 inline-flex items-center gap-2 font-medium text-blue-700 hover:underline"><BookOpen size={16} />打开对应指导</button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy) || status?.canStart !== true} onClick={() => void runAction("start", startCameraFtp)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"><Play size={16} />启动 FTP</button>
          <button type="button" disabled={Boolean(busy) || status?.canStop !== true} onClick={() => void runAction("stop", stopCameraFtp)} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Square size={16} />停止 FTP</button>
          <button type="button" disabled={Boolean(busy) || status?.canRestart !== true} onClick={() => void runAction("restart", restartCameraFtp)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={16} />重启 FTP</button>
          <button type="button" onClick={() => navigate(GUIDE_PATH)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><BookOpen size={16} />配置指导</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void copyDiagnostics()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ClipboardCopy size={16} />复制诊断信息</button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="站点状态" value={loading ? "正在检测" : siteStarted ? "运行中" : status?.site?.exists === null ? "尚未确认" : status?.site?.exists === true ? "已停止" : "未就绪"} />
          <InfoTile label="当前接收活动" value={status?.activeEvent?.name || "未选择"} />
          <InfoTile label="推荐地址" value={address} />
          <InfoTile label="控制端口" value={String(status?.controlPort ?? "—")} />
          <InfoTile label="FTP 用户名" value={status?.account?.username || "—"} />
          <InfoTile label="接收目录" value={status?.site?.physicalPath || status?.ftpPath || "未配置"} />
          <InfoTile label="文件监听" value={status?.watcher?.running ? "运行中" : "未运行"} />
          <InfoTile label="最近接收" value={status?.watcher?.lastReceivedAt ? new Date(status.watcher.lastReceivedAt).toLocaleString() : "暂无"} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">FTP 接收活动</h3>
        <p className="mt-1 text-sm text-slate-500">切换活动会更新 IIS 站点的 physicalPath；目标目录需要预先继承 FTP 账户的读写权限。</p>
        {status?.initialized && !status.activeEvent && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">当前没有有效的 FTP 接收活动。请先在下方选择活动并点击「切换接收活动」；站点配置不一定有问题。</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} className="min-w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="选择 FTP 接收活动">
            <option value="">选择活动</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
          <button type="button" disabled={Boolean(busy) || !canSwitch} onClick={() => void runAction("switch", () => updateCameraFtpActiveEvent(selectedEventId))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">切换接收活动</button>
          <button type="button" disabled={Boolean(busy) || !status?.activeEvent} onClick={() => void runAction("folder", openCameraFtpFolder)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><FolderOpen size={16} />打开接收目录</button>
        </div>
      </section>

      {status?.watcher && <CameraFtpRecentFiles watcher={status.watcher} />}
    </div>
  );
}
