import { ArrowLeft, LayoutGrid, LinkIcon, PenTool, UploadCloud } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { TaskCenter } from "../components/tasks/TaskCenter";
import { BrandLogo } from "../components/common/BrandLogo";
import { Notice } from "../components/ui/States";
import { getClientApiBase } from "../lib/api";
import { getClientName } from "../lib/clientIdentity";
import { cn } from "../lib/cn";
import { registerClientPresence, unregisterClientPresence } from "../lib/socket";
import { WindowShell } from "../components/shell/WindowShell";
import { useEffect, useState } from "react";

const navItems = [
  { icon: UploadCloud, label: "上传图片", to: "/client/upload" },
  { icon: LayoutGrid, label: "图片墙", to: "/client/photos" },
  { icon: PenTool, label: "修图任务", to: "/client/retouch" }
];

export function ClientLayout() {
  const navigate = useNavigate();
  const hostAddress = getClientApiBase();
  const [clientName] = useState(() => getClientName());

  useEffect(() => {
    if (hostAddress) {
      registerClientPresence();
    }
    return () => {
      unregisterClientPresence();
    };
  }, [hostAddress]);

  if (!hostAddress) {
    return (
      <WindowShell showBusinessInfo={false}>
        <div className="flex flex-1 items-center justify-center p-8 text-slate-800">
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
      </WindowShell>
    );
  }

  return (
    <WindowShell showBusinessInfo modeLabel="客户端模式">
      <div className="flex flex-1 overflow-hidden font-sans text-slate-800">
        {/* Sidebar — independent rounded container */}
        <div className="z-10 m-3 flex w-56 shrink-0 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
          <button className="flex items-center gap-3 border-b border-slate-50 p-5 text-left" onClick={() => navigate("/client")} type="button">
            <BrandLogo size="sm" />
            <span className="truncate text-sm font-semibold">客户端协作</span>
          </button>

          <div className="border-b border-slate-50 px-4 py-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <LinkIcon size={13} />
              当前主机
            </p>
            <p className="truncate text-xs text-slate-600">{hostAddress || "未连接"}</p>
            <p className="mt-2 truncate text-xs font-medium text-slate-700">设备：{clientName}</p>
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

        {/* Main content area */}
        <div className="relative m-3 ml-0 flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </WindowShell>
  );
}
