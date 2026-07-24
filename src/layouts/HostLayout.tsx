import {
  Archive,
  CheckCircle,
  FolderKanban,
  Home,
  ImagePlus,
  LayoutGrid,
  PenTool,
  Settings,
  UploadCloud
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cn } from "../lib/cn";
import { TaskCenter } from "../components/tasks/TaskCenter";
import { BrandLogo } from "../components/common/BrandLogo";
import { WindowShell } from "../components/shell/WindowShell";
import { useHostEventSummary } from "../hooks/useHostEventSummary";

const navItems = [
  { icon: Home, label: "首页", to: "/host/overview" },
  { icon: FolderKanban, label: "活动管理", to: "/host/events" },
  { icon: ImagePlus, label: "导入图片", to: "/host/import" },
  { icon: LayoutGrid, label: "图片墙", to: "/host/photos" },
  { icon: PenTool, label: "待修图", to: "/host/retouch" },
  { icon: CheckCircle, label: "已修图", to: "/host/done" },
  { icon: UploadCloud, label: "导出发布", to: "/host/export" },
  { icon: Archive, label: "归档管理", to: "/host/archive" },
  { icon: Settings, label: "系统设置", to: "/host/settings" }
];

export function HostLayout() {
  const navigate = useNavigate();
  const summary = useHostEventSummary();

  return (
    <WindowShell showBusinessInfo modeLabel="主机模式" summary={summary}>
      <div className="flex flex-1 overflow-hidden font-sans text-slate-800">
        {/* Sidebar — independent rounded container, not touching window edges */}
        <div className="z-10 m-3 flex w-56 shrink-0 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
          <button className="flex items-center gap-3 border-b border-slate-50 p-5 text-left" onClick={() => navigate("/")} type="button">
            <BrandLogo size="sm" />
            <span className="truncate text-sm font-semibold">融媒体图片工作台</span>
          </button>

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

          {/* TaskCenter and admin area — kept intact for parallel branch compatibility */}
          <div className="border-t border-slate-50 px-3 py-3">
            <TaskCenter />
          </div>

          <div className="flex items-center gap-3 border-t border-slate-50 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-slate-500">
              <img
                alt="Avatar"
                className="h-full w-full object-cover"
                src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?ixlib=rb-4.0.3&auto=format&fit=crop&w=100&q=80"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">管理员</span>
              <span className="text-xs text-slate-400">在线</span>
            </div>
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
