import { ArrowRight, Clock, Monitor, Server, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function Startup() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <div className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-hidden">
        <div className="absolute -left-[10%] -top-[20%] h-[60%] w-[60%] rounded-full bg-blue-100/50 opacity-70 blur-3xl" />
        <div className="absolute right-[10%] top-[20%] h-[40%] w-[40%] rounded-full bg-blue-50/50 opacity-60 blur-3xl" />
      </div>

      <div className="z-10 flex flex-1 flex-col items-center justify-center px-6">
        <div className="mb-10 flex flex-col items-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
            <span className="text-3xl font-bold italic">M</span>
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-800">Media Photo Workbench</h1>
          <p className="font-medium text-slate-500">融媒体图片工作台</p>
        </div>

        <div className="flex w-full max-w-4xl justify-center gap-6">
          <ModeCard
            body="创建活动、管理图片仓库、启动局域网协作服务。适合在性能较好的主力机上运行。"
            icon={<Server size={32} strokeWidth={1.5} />}
            onClick={() => navigate("/host")}
            title="启动为主机"
          />
          <ModeCard
            body="连接已有主机，上传/下载图片并参与协作。适合外出摄影师的笔记本使用。"
            icon={<Monitor size={32} strokeWidth={1.5} />}
            onClick={() => navigate("/client")}
            title="连接到主机"
          />
        </div>
      </div>

      <div className="absolute bottom-8 left-8 z-10 flex gap-6">
        <button className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800" type="button">
          <Clock size={16} />
          <span>最近使用</span>
        </button>
        <button className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800" type="button">
          <Settings size={16} />
          <span>设置</span>
        </button>
      </div>
    </div>
  );
}

function ModeCard({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      className="group flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-8 text-left shadow-sm transition-all hover:border-blue-100 hover:shadow-md"
      onClick={onClick}
      type="button"
    >
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
        {icon}
      </div>
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <p className="mb-8 flex-1 text-sm leading-relaxed text-slate-500">{body}</p>
      <div className="flex justify-end text-slate-300 transition-colors group-hover:text-blue-600">
        <ArrowRight size={20} />
      </div>
    </button>
  );
}
