import { ArrowLeft, CheckCircle2, Download, LinkIcon, QrCode, UploadCloud, Wifi } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Notice } from "../../components/ui/States";
import { cn } from "../../lib/cn";

const roles = ["编辑", "修图", "访客"];

export function ClientConnectPage() {
  const [hostAddress, setHostAddress] = useState("http://192.168.137.1:3030");
  const [userName, setUserName] = useState("外拍同学");
  const [role, setRole] = useState("编辑");
  const [deviceName, setDeviceName] = useState("Client-A");
  const [connected, setConnected] = useState(false);
  const canConnect = hostAddress.trim().startsWith("http") && userName.trim().length > 0 && deviceName.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#F8F9FA] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-8 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" to="/">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">连接到主机</h1>
              <p className="mt-1 text-sm text-slate-500">上传、选片、下载待修包和回传已修图</p>
            </div>
          </div>
          <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", connected ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>
            <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-slate-400")} />
            {connected ? "已连接" : "未连接"}
          </div>
        </header>

        <div className="grid flex-1 grid-cols-[1fr_360px] gap-6">
          <section className="flex flex-col gap-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">主机地址</h2>
                  <p className="mt-1 text-sm text-slate-500">输入主机概览页显示的局域网地址或热点地址。</p>
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
                  disabled={!canConnect}
                  onClick={() => setConnected(true)}
                  type="button"
                >
                  连接测试
                </button>
              </div>
              {!canConnect && (
                <Notice className="mt-4" tone="warning" title="连接信息不完整">
                  主机地址需要以 http 开头，并填写姓名和设备名后才能发起连接测试。
                </Notice>
              )}
              {connected && (
                <Notice className="mt-4" tone="success" title="连接测试通过">
                  已使用 {role} 身份连接到主机。上传、下载和实时同步入口已打开。
                </Notice>
              )}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <InfoTile label="最近连接" value="http://192.168.1.108:3030" />
                <InfoTile label="热点模式" value="192.168.137.1:3030" />
                <InfoTile label="服务端口" value="3030" />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 font-semibold text-slate-900">协作身份</h2>
              <div className="grid grid-cols-3 gap-4">
                <Field label="姓名" onChange={setUserName} value={userName} />
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">角色</span>
                  <select className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500" onChange={(event) => setRole(event.target.value)} value={role}>
                    {roles.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <Field label="设备名" onChange={setDeviceName} value={deviceName} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <ClientActionCard
                body="选择当前活动、摄影师和 JPG/JPEG 文件，上传后由主机统一入库并生成缩略图。"
                disabled={!connected}
                icon={<UploadCloud size={24} />}
                meta={connected ? "当前活动：2026 春季运动会" : "连接主机后可用"}
                title="上传图片"
              />
              <ClientActionCard
                body="下载单张原图、当前筛选结果、待修包 ZIP 或发布包。批量下载由主机生成 ZIP。"
                disabled={!connected}
                icon={<Download size={24} />}
                meta={connected ? "待修图：1,256 张" : "连接主机后可用"}
                title="下载任务"
              />
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">扫码连接占位</h2>
              <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400">
                <QrCode size={128} strokeWidth={1.4} />
              </div>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-amber-900">
                <LinkIcon size={16} />
                连接提示
              </h2>
              <p className="text-sm leading-6 text-amber-800">
                如果校园网无法连接，请让主机笔记本开启 Windows 热点，其他设备连接该热点后访问
                <span className="font-medium"> 192.168.137.1:3030</span>。同时检查 Windows 防火墙是否允许访问。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">连接状态</h2>
              <div className="space-y-3">
                <StatusLine active={connected} label="主机服务" />
                <StatusLine active={connected} label="当前活动" />
                <StatusLine active={connected} label="实时同步" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ClientActionCard({ icon, title, body, meta, disabled = false }: { icon: React.ReactNode; title: string; body: string; meta: string; disabled?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-slate-100 bg-white p-6 shadow-sm", disabled && "opacity-60")}>
      <div className={cn("mb-5 flex h-12 w-12 items-center justify-center rounded-xl", disabled ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600")}>{icon}</div>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-500">{body}</p>
      <div className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">{meta}</div>
    </div>
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
