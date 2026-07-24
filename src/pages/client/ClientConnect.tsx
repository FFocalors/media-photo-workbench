import { ArrowLeft, CheckCircle2, LinkIcon, PenTool, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeCard } from "../../components/common/QRCodeCard";
import { Notice, TransientNotice } from "../../components/ui/States";
import {
  fetchHealthFrom,
  getClientApiBase,
  getRecentClientHosts,
  HealthData,
  normalizeApiBaseUrl,
  setClientApiBase
} from "../../lib/api";
import { getClientName, setClientName } from "../../lib/clientIdentity";
import { cn } from "../../lib/cn";
import { registerClientPresence } from "../../lib/socket";
import { WindowShell } from "../../components/shell/WindowShell";

const roles = ["编辑", "修图", "访客"];
const CONNECTION_TIMEOUT_MS = 6000;

type ConnectionMessage = {
  tone: "success" | "warning" | "danger";
  title: string;
  body: ReactNode;
};

export function ClientConnectPage() {
  const navigate = useNavigate();
  const recentHosts = useMemo(() => getRecentClientHosts(), []);
  const [hostAddress, setHostAddress] = useState(recentHosts[0] || getClientApiBase() || "http://127.0.0.1:3030");
  const [userName, setUserName] = useState(localStorage.getItem("mediaPhotoWorkbench.clientUserName") || "外拍同学");
  const [role, setRole] = useState(localStorage.getItem("mediaPhotoWorkbench.clientRole") || "编辑");
  const [deviceName, setDeviceNameState] = useState(getClientName());
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [message, setMessage] = useState<ConnectionMessage | null>(null);

  const connected = Boolean(health);
  const normalizedDeviceName = deviceName.trim() || getClientName();
  const canConnect = hostAddress.trim().length > 0 && userName.trim().length > 0;
  const qrAddress = useMemo(() => {
    try {
      return normalizeApiBaseUrl(hostAddress);
    } catch {
      return "";
    }
  }, [hostAddress]);

  const handleConnect = async () => {
    if (!canConnect) return;
    setTesting(true);
    setHealth(null);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

    try {
      const normalized = normalizeApiBaseUrl(hostAddress);
      const result = await fetchHealthFrom(normalized, { signal: controller.signal });
      if (!result.ok || !result.data) {
        setMessage(buildConnectionFailureMessage("api", result.error?.message || "主机健康检查失败。"));
        return;
      }

      const savedBase = setClientApiBase(normalized);
      localStorage.setItem("mediaPhotoWorkbench.clientUserName", userName.trim());
      localStorage.setItem("mediaPhotoWorkbench.clientRole", role);
      const savedClientName = setClientName(normalizedDeviceName);
      setDeviceNameState(savedClientName);
      registerClientPresence();
      setHealth(result.data);
      setMessage({ tone: "success", title: "连接测试通过", body: `已连接到 ${savedBase}。` });
    } catch (err: any) {
      const elapsedMs = Date.now() - startedAt;
      setMessage(buildConnectionFailureMessage(classifyConnectionError(err, elapsedMs), err?.message));
    } finally {
      window.clearTimeout(timeoutId);
      setTesting(false);
    }
  };

  return (
    <WindowShell showBusinessInfo={false}>
    <main className="min-h-screen bg-[#F8F9FA] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 lg:px-8 lg:py-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" to="/">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">连接到主机</h1>
              <p className="mt-1 text-sm text-slate-500">上传、选片、下载图片并参与局域网协作</p>
            </div>
          </div>
          <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", connected ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>
            <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-slate-400")} />
            {connected ? "已连接" : "未连接"}
          </div>
        </header>

        <div className="grid flex-1 gap-6 xl:grid-cols-[1fr_360px]">
          <section className="flex flex-col gap-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">主机地址</h2>
                  <p className="mt-1 text-sm text-slate-500">输入主机概览页显示的本机、局域网或热点地址。</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Wifi size={22} />
                </div>
              </div>
              <div className="flex gap-3">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                  onChange={(event) => setHostAddress(event.target.value)}
                  value={hostAddress}
                />
                <button
                  className={cn("rounded-lg px-5 py-2 text-sm font-medium text-white", canConnect ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-slate-300")}
                  disabled={!canConnect || testing}
                  onClick={handleConnect}
                  type="button"
                >
                  {testing ? "连接中..." : "连接测试"}
                </button>
              </div>

              {recentHosts.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {recentHosts.map((host) => (
                    <button
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 hover:border-blue-200 hover:text-blue-600"
                      key={host}
                      onClick={() => setHostAddress(host)}
                      type="button"
                    >
                      {host}
                    </button>
                  ))}
                </div>
              )}

              {!canConnect && (
                <Notice className="mt-4" tone="warning" title="连接信息不完整">
                  请输入主机地址和姓名后再发起连接测试。主机地址需要使用完整格式，例如 http://192.168.137.1:3030。
                </Notice>
              )}
              <TransientNotice className="mt-4" message={message} onDismiss={() => setMessage(null)} />
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 font-semibold text-slate-900">协作身份</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="姓名" onChange={setUserName} value={userName} />
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">角色</span>
                  <select className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" onChange={(event) => setRole(event.target.value)} value={role}>
                    {roles.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <Field
                  helper="用于主机端识别你的上传和操作记录，例如：修图电脑A、摄影组1号。"
                  label="设备名称"
                  onChange={(value) => {
                    setDeviceNameState(value);
                    if (value.trim()) setClientName(value);
                  }}
                  onBlur={() => setDeviceNameState(setClientName(deviceName))}
                  value={deviceName}
                />
              </div>
            </div>

            {health && (
              <div className="grid gap-6 lg:grid-cols-3">
                <ClientActionCard
                  body="查看缩略图、预览图，完成打星、状态流转、分类、备注和单图下载。"
                  icon={<CheckCircle2 size={24} />}
                  onClick={() => navigate("/client/photos")}
                  title="进入图片墙"
                />
                <ClientActionCard
                  body="查看主机生成的待修包，下载修图素材，并回传已修图。"
                  icon={<PenTool size={24} />}
                  onClick={() => navigate("/client/retouch")}
                  title="修图任务"
                />
                <ClientActionCard
                  body="选择 JPG/JPEG/PNG 文件上传到当前活动，由主机生成缩略图并实时广播。"
                  icon={<Wifi size={24} />}
                  onClick={() => navigate("/client/upload")}
                  title="上传图片"
                />
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <QRCodeCard
              description="同一局域网可扫码访问；校园网不可用时建议使用 Windows 热点。"
              emptyText="请输入完整主机地址"
              label={connected ? "当前已连接地址" : "扫码连接地址"}
              size={128}
              value={qrAddress}
            />

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-amber-900">
                <LinkIcon size={16} />
                连接提示
              </h2>
              <p className="text-sm leading-6 text-amber-800">
                如果校园网无法连接，请让主机笔记本开启 Windows 热点，其他设备连接该热点后访问
                <span className="font-medium"> 192.168.137.1:3030</span>，并检查 Windows 防火墙。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">连接状态</h2>
              <div className="space-y-3">
                <StatusLine active={health?.server.status === "running"} label="主机服务" />
                <StatusLine active={health?.database.status === "connected"} label="数据库" />
                <StatusLine active={Boolean(health?.repository.exists && health.repository.readable && health.repository.writable)} label="图片仓库" />
              </div>
              {health && <p className="mt-4 truncate text-xs text-slate-400">{hostAddress}</p>}
            </div>
          </aside>
        </div>
      </div>
    </main>
    </WindowShell>
  );
}

function classifyConnectionError(error: any, elapsedMs: number): "invalid-url" | "network" | "refused" {
  const message = String(error?.message || error || "");
  if (/^主机地址必须以/i.test(message) || /Invalid URL/i.test(message)) {
    return "invalid-url";
  }
  if (error?.name === "AbortError") {
    return "network";
  }
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED|connection refused/i.test(message)) {
    return "refused";
  }
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
    return elapsedMs < 1500 ? "refused" : "network";
  }
  return "network";
}

function buildConnectionFailureMessage(kind: "invalid-url" | "network" | "refused" | "api", detail?: string): ConnectionMessage {
  if (kind === "invalid-url") {
    return {
      tone: "danger",
      title: "主机地址格式不正确",
      body: "请输入完整地址，例如 http://192.168.137.1:3030。"
    };
  }

  if (kind === "refused") {
    return {
      tone: "danger",
      title: "目标端口没有主机服务",
      body: (
        <TroubleshootingList
          intro="目标地址可能可达，但该端口没有响应主机 API。"
          items={[
            "确认主机端已经启动，并停留在主机模式。",
            "确认使用的是主机首页显示的真实端口，不要使用旧二维码或旧地址。",
            "刷新主机首页后重新复制地址，再回到客户端连接。",
            "如果主机端口自动从 3030 跳到 3031-3040，请以主机首页显示为准。"
          ]}
        />
      )
    };
  }

  if (kind === "api") {
    return {
      tone: "danger",
      title: "主机健康检查失败",
      body: (
        <TroubleshootingList
          intro={detail || "后端返回了失败状态。"}
          items={[
            "请在主机端进入“系统设置 / 故障排查”，复制诊断信息发给维护人员。",
            "确认数据库、仓库路径和后端服务状态均正常。",
            "如果浏览器打开的是前端页面而不是 API，请重新复制主机首页显示的 API 地址。"
          ]}
        />
      )
    };
  }

  return {
    tone: "danger",
    title: "主机无响应",
    body: (
      <TroubleshootingList
        intro={detail && !/Failed to fetch/i.test(detail) ? detail : "可能是网络不通、校园网设备隔离或 Windows 防火墙拦截。"}
        items={[
          "确认主机和客户端在同一 Wi-Fi 或同一个 Windows 热点下。",
          "优先使用主机首页显示的局域网地址或二维码。",
          "校园网无法连接时，建议开启主机 Windows 热点。",
          "Windows 热点常见主机地址为 192.168.137.1。",
          "检查 Windows 防火墙是否允许本应用访问专用网络。"
        ]}
      />
    )
  };
}

function TroubleshootingList({ intro, items }: { intro: string; items: string[] }) {
  return (
    <div>
      <p>{intro}</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  helper,
  onBlur
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  onBlur?: () => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {helper && <span className="mt-1.5 block text-xs leading-5 text-slate-400">{helper}</span>}
    </label>
  );
}

function ClientActionCard({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button className="rounded-2xl border border-slate-100 bg-white p-6 text-left shadow-sm transition-colors hover:border-blue-100 hover:bg-blue-50/30" onClick={onClick} type="button">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">{icon}</div>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-500">{body}</p>
    </button>
  );
}

function StatusLine({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={cn("flex items-center gap-1.5 font-medium", active ? "text-emerald-600" : "text-slate-400")}>
        <CheckCircle2 size={14} />
        {active ? "正常" : "未连接"}
      </span>
    </div>
  );
}
