import { Archive, CheckCircle2, FolderKanban, ImagePlus, LayoutGrid, QrCode, Settings, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";

export function OverviewPage() {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold text-slate-900">系统概览</h1>
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            一切正常运行中
          </span>
        </div>
        <Link className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50" to="/host/settings">
          <Settings size={16} />
          系统设置
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-6">
        <InfoCard label="当前活动">
          <div className="mb-2 flex items-center gap-3">
            <span className="font-semibold text-slate-900">2026 春季运动会</span>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">进行中</span>
          </div>
          <p className="text-xs text-slate-400">开始时间：2026-05-10 07:30</p>
        </InfoCard>
        <InfoCard label="仓库路径">
          <p className="mb-2 truncate font-medium text-slate-900" title="D:\MediaPhoto\Repository">D:\MediaPhoto\Repository</p>
          <p className="text-xs text-slate-400">共 3.25 TB</p>
        </InfoCard>
        <InfoCard label="数据库状态">
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className="text-emerald-500" size={18} />
            <span className="font-medium text-emerald-600">正常</span>
          </div>
          <p className="text-xs text-slate-400">服务运行良好</p>
        </InfoCard>
        <div className="flex items-center rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex-1">
            <h3 className="mb-2 text-sm font-medium text-slate-500">剩余空间</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">2.18 TB</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">可用 / 共 4.00 TB</p>
          </div>
          <div className="relative h-16 w-16 shrink-0">
            <svg className="h-full w-full text-blue-100" viewBox="0 0 36 36">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#2563eb" strokeDasharray="55, 100" strokeWidth="4" />
            </svg>
          </div>
        </div>
        <div className="col-span-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div>
            <h3 className="mb-4 text-sm font-medium text-slate-500">局域网访问地址</h3>
            <a className="font-medium text-blue-600 hover:underline" href="#top">http://192.168.1.108:3030</a>
            <p className="mt-2 text-xs text-slate-400">同局域网设备可通过此地址访问</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 p-1">
              <QrCode className="text-slate-800" size={48} strokeWidth={1.5} />
            </div>
            <span className="text-[10px] text-slate-400">扫码局域网访问</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-medium text-slate-900">快捷操作</h3>
        <div className="flex flex-wrap gap-4">
          <ActionItem icon={FolderKanban} label="新建活动" to="/host/events" />
          <ActionItem icon={ImagePlus} label="导入图片" to="/host/import" />
          <ActionItem icon={LayoutGrid} label="打开图片墙" to="/host/photos" />
          <ActionItem icon={UploadCloud} label="导出发布" to="/host/export" />
          <ActionItem icon={Archive} label="归档管理" to="/host/archive" />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-slate-500">{label}</h3>
      {children}
    </div>
  );
}

function ActionItem({ icon: Icon, label, to }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; to: string }) {
  return (
    <Link className="group flex h-28 w-28 flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-sm transition-all hover:border-blue-100 hover:shadow-md" to={to}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-blue-600 transition-colors group-hover:bg-blue-50">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600">{label}</span>
    </Link>
  );
}
