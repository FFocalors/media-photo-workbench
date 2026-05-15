import { ArrowLeft, LayoutGrid, LinkIcon, UploadCloud } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { TaskCenter } from "../components/tasks/TaskCenter";
import { Notice } from "../components/ui/States";
import { getClientApiBase } from "../lib/api";
import { cn } from "../lib/cn";

const navItems = [
  { icon: LayoutGrid, label: "图片墙", to: "/client/photos" },
  { icon: UploadCloud, label: "上传图片", to: "/client/upload" }
];

export function ClientLayout() {
  const navigate = useNavigate();
  const hostAddress = getClientApiBase();

  if (!hostAddress) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-8 text-slate-800">
        <div className="w-full max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <Notice tone="warning" title="尚未连接主机">
            客户端图片墙和上传功能必须先通过连接测试，之后才会使用对应主机地址访问活动、图片和实时同步。
          </Notice>
          <button
            className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => navigate("/client")}
            type="button"
          >
            返回连接页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F9FA] font-sans text-slate-800">
      <div className="z-10 flex w-56 flex-col border-r border-slate-100 bg-white shadow-[2px_0_8px_rgba(0,0,0,0.02)]">
        <button className="flex items-center gap-3 border-b border-slate-50 p-5 text-left" onClick={() => navigate("/client")} type="button">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <span className="text-sm font-bold italic">M</span>
          </div>
          <span className="truncate text-sm font-semibold">客户端协作</span>
        </button>

        <div className="border-b border-slate-50 px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <LinkIcon size={13} />
            当前主机
          </p>
          <p className="truncate text-xs text-slate-600">{hostAddress || "未连接"}</p>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )
              }
              key={item.to}
              to={item.to}
            >
              <item.icon size={18} strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="border-t border-slate-50 px-3 py-3">
          <TaskCenter />
        </div>

        <div className="border-t border-slate-50 p-4">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => navigate("/client")}
            type="button"
          >
            <ArrowLeft size={16} />
            更换主机
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
