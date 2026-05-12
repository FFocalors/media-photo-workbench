import { MoreHorizontal, Plus, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "../../lib/cn";
import { fetchEvents, createEvent, EventData } from "../../lib/api";

const statusLabelMap: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  reviewing: "选片中",
  archived: "已归档",
  deleted: "已删除"
};

export function EventsPage() {
  const [activeTab, setActiveTab] = useState("全部");
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = async (tab: string) => {
    setLoading(true);
    let statusFilter = "";
    if (tab === "进行中") statusFilter = "active";
    if (tab === "已归档") statusFilter = "archived";

    const res = await fetchEvents(statusFilter);
    if (res && res.ok && res.data) {
      setEvents(res.data);
    } else {
      alert(res?.error?.message || "获取活动列表失败");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEvents(activeTab);
  }, [activeTab]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", date: new Date().toISOString().split("T")[0], location: "", description: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert("活动名称不能为空");
      return;
    }

    setIsSubmitting(true);
    const res = await createEvent({
      name: formData.name.trim(),
      date: formData.date || new Date().toISOString().split("T")[0],
      location: formData.location.trim()
    });

    if (res && res.ok && res.data) {
      if (!res.data.workingDir.created) {
        alert("请先在系统设置中配置仓库路径\n(活动记录已创建，但缺乏物理工作区，无法导入图片)");
      }
      setIsModalOpen(false);
      setFormData({ name: "", date: new Date().toISOString().split("T")[0], location: "", description: "" });
      loadEvents(activeTab);
    } else {
      alert(res?.error?.message || "创建活动失败，请检查设置。");
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-slate-900">活动管理</h1>
          <p className="text-sm text-slate-500">共 {events.length} 个活动</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex rounded-lg bg-slate-100 p-1">
            {["全部", "进行中", "已归档"].map((tab) => (
              <button
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  activeTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            type="button"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            新建活动
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">新建活动</h2>
              <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">活动名称 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="例如：2026春季运动会"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">活动日期</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">活动地点</label>
                <input
                  type="text"
                  placeholder="选填"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">活动描述</label>
                <textarea
                  placeholder="选填，记录活动备注信息..."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() => setIsModalOpen(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? "创建中..." : "确认创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400">加载中...</div>
      ) : events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
          <div className="mb-4 rounded-full bg-slate-100 p-4 text-slate-300">
            <Plus size={32} />
          </div>
          <p className="text-lg font-medium text-slate-600">暂无活动，请新建活动</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {events.map((event) => (
            <div className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-md" key={event.id}>
              <div className="relative h-40 overflow-hidden bg-slate-100 flex items-center justify-center">
                {/* 第一版暂无真实的活动封面图，使用纯色占位 */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-slate-100" />
                <span className="relative z-10 text-4xl text-slate-300 font-bold opacity-50">
                  {event.name.slice(0, 1)}
                </span>
                <div className="absolute right-3 top-3">
                  <span
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur-md",
                      event.status === "active" ? "bg-blue-500/90 text-white" : "bg-white/90 text-slate-600"
                    )}
                  >
                    {statusLabelMap[event.status] || event.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-1 flex items-start justify-between">
                  <h3 className="truncate pr-4 font-semibold text-slate-900" title={event.name}>
                    {event.name}
                  </h3>
                  <button className="rounded-md p-0.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" type="button">
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <p className="mb-5 text-xs text-slate-500">{event.date} {event.location ? `· ${event.location}` : ""}</p>

                <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-50 pt-4">
                  <Stat label="图片总数" value={event.total_images.toString()} />
                  <Stat color="text-amber-600" label="选入/待修" value={event.selected_images.toString()} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = "text-slate-900" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] text-slate-400">{label}</p>
      <p className={cn("text-sm font-medium", color)}>{value}</p>
    </div>
  );
}
