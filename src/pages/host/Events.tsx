import { Archive, FileText, MoreHorizontal, PlayCircle, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "../../lib/cn";
import {
  createEvent,
  deleteEvent,
  EventData,
  EventStatus,
  eventStatusLabels,
  fetchEvents,
  fetchEventTrash,
  fetchSettings,
  purgeEvent,
  restoreEvent,
  updateEventStatus
} from "../../lib/api";
import { Notice } from "../../components/ui/States";

const statusActions: Array<{ status: EventStatus; label: string; icon: typeof PlayCircle }> = [
  { status: "active", label: "设为进行中", icon: PlayCircle },
  { status: "reviewing", label: "设为选片中", icon: FileText },
  { status: "draft", label: "设为草稿", icon: FileText },
  { status: "archived", label: "标记已归档", icon: Archive }
];

export function EventsPage() {
  const [activeTab, setActiveTab] = useState("全部");
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [repositoryPath, setRepositoryPath] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);

  const loadEvents = async (tab: string) => {
    setLoading(true);
    let statusFilter = "";
    if (tab === "进行中") statusFilter = "active";
    if (tab === "已归档") statusFilter = "archived";

    try {
      const res = tab === "回收站" ? await fetchEventTrash() : await fetchEvents(statusFilter);
      if (res && res.ok && res.data) {
        setEvents(res.data);
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res?.error?.message || "获取活动列表失败" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "无法读取活动列表，请确认本地后端服务已启动。" });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEvents(activeTab);
  }, [activeTab]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetchSettings();
        if (res.ok && res.data) {
          setRepositoryPath(res.data.repository.path);
        }
      } catch {
        // The page can still work without showing full physical paths.
      }
    };
    void loadSettings();
  }, []);

  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

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
      setMessage({ tone: "success", title: "活动已创建", body: "活动记录和工作目录已创建。" });
    } else {
      setMessage({ tone: "danger", title: "创建活动失败", body: res?.error?.message || "创建活动失败，请检查设置。" });
    }
    setIsSubmitting(false);
  };

  const handleChangeStatus = async (event: EventData, status: EventStatus) => {
    if (event.status === status) {
      setOpenMenuId(null);
      return;
    }

    setIsMutating(true);
    setOpenMenuId(null);
    try {
      const res = await updateEventStatus(event.id, status);
      if (res.ok && res.data) {
        await loadEvents(activeTab);
        setMessage({ tone: "success", title: "活动状态已更新", body: `${event.name} 已更新为${eventStatusLabels[status]}。` });
      } else {
        setMessage({ tone: "danger", title: "状态更新失败", body: res.error?.message || "无法更新活动状态。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "状态更新失败", body: "请求失败，请确认本地后端服务已启动。" });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteEvent = async (event: EventData) => {
    const confirmed = window.confirm(`确定删除活动“${event.name}”？\n\n这只会把活动标记为已删除，不会删除仓库中的图片文件。`);
    if (!confirmed) return;

    setIsMutating(true);
    setOpenMenuId(null);
    try {
      const res = await deleteEvent(event.id);
      if (res.ok && res.data) {
        await loadEvents(activeTab);
        setMessage({ tone: "success", title: "活动已删除", body: `${event.name} 已标记为已删除，图片文件未被删除。` });
      } else {
        setMessage({ tone: "danger", title: "删除失败", body: res.error?.message || "无法删除活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "删除失败", body: "请求失败，请确认本地后端服务已启动。" });
    } finally {
      setIsMutating(false);
    }
  };

  const handleRestoreEvent = async (event: EventData) => {
    const confirmed = window.confirm(`恢复活动“${event.name}”？\n\n恢复后活动会回到进行中状态，工作区文件不会移动。`);
    if (!confirmed) return;

    setIsMutating(true);
    setOpenMenuId(null);
    try {
      const res = await restoreEvent(event.id, "active");
      if (res.ok && res.data) {
        await loadEvents(activeTab);
        setMessage({ tone: "success", title: "活动已恢复", body: `${event.name} 已恢复为进行中。` });
      } else {
        setMessage({ tone: "danger", title: "恢复失败", body: res.error?.message || "无法恢复活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "恢复失败", body: "请求失败，请确认本地后端服务已启动。" });
    } finally {
      setIsMutating(false);
    }
  };

  const handlePurgeEvent = async (event: EventData) => {
    const workingPath = repositoryPath ? `${repositoryPath}\\working\\${event.slug}` : `working\\${event.slug}`;
    const archivePath = repositoryPath ? `${repositoryPath}\\archive\\${event.slug}` : `archive\\${event.slug}`;
    const typed = window.prompt(
      `永久删除活动“${event.name}”？\n\n活动名称：${event.name}\n图片数量：${event.total_images}\n工作区：${workingPath}\n归档目录默认保留：${archivePath}\n\n此操作会删除活动记录和图片记录，不能撤销。\n请输入活动名称确认：`
    );
    if (typed !== event.name) {
      setMessage({ tone: "warning", title: "永久删除已取消", body: "输入的活动名称不一致，未执行删除。" });
      return;
    }

    setIsMutating(true);
    setOpenMenuId(null);
    try {
      const res = await purgeEvent(event.id, false);
      if (res.ok && res.data) {
        await loadEvents(activeTab);
        setMessage({
          tone: res.data.errors.length > 0 ? "warning" : "success",
          title: "活动已永久删除",
          body: `删除活动记录 ${res.data.deletedRecords.events} 条，图片记录 ${res.data.deletedRecords.images} 条。归档目录默认保留。`
        });
      } else {
        setMessage({ tone: "danger", title: "永久删除失败", body: res.error?.message || "无法永久删除活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "永久删除失败", body: "请求失败，请确认本地后端服务已启动。" });
    } finally {
      setIsMutating(false);
    }
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
            {["全部", "进行中", "已归档", "回收站"].map((tab) => (
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

      {message && (
        <Notice className="mb-5" tone={message.tone} title={message.title}>
          {message.body}
        </Notice>
      )}

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
          <p className="text-lg font-medium text-slate-600">{activeTab === "回收站" ? "活动回收站为空" : "暂无活动，请新建活动"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {events.map((event) => (
            <div className="group flex flex-col rounded-2xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-md" key={event.id}>
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
                      statusBadgeClass(event.status)
                    )}
                  >
                    {eventStatusLabels[event.status as EventStatus] || event.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-1 flex items-start justify-between">
                  <h3 className="truncate pr-4 font-semibold text-slate-900" title={event.name}>
                    {event.name}
                  </h3>
                  <div className="relative">
                    <button
                      className="rounded-md p-0.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isMutating}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setOpenMenuId((current) => current === event.id ? null : event.id);
                      }}
                      type="button"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {openMenuId === event.id && (
                      <div className="absolute right-0 top-7 z-20 w-40 rounded-xl border border-slate-100 bg-white p-1 shadow-lg" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        {activeTab !== "回收站" && statusActions
                          .filter((action) => action.status !== event.status)
                          .map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                key={action.status}
                                onClick={() => handleChangeStatus(event, action.status)}
                                type="button"
                              >
                                <Icon size={15} />
                                {action.label}
                              </button>
                            );
                          })}
                        <div className="my-1 h-px bg-slate-100" />
                        {activeTab === "回收站" ? (
                          <>
                            <button
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-emerald-600 hover:bg-emerald-50"
                              onClick={() => handleRestoreEvent(event)}
                              type="button"
                            >
                              <RotateCcw size={15} />
                              恢复活动
                            </button>
                            <button
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={() => handlePurgeEvent(event)}
                              type="button"
                            >
                              <Trash2 size={15} />
                              永久删除
                            </button>
                          </>
                        ) : (
                          <button
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            onClick={() => handleDeleteEvent(event)}
                            type="button"
                          >
                            <Trash2 size={15} />
                            删除活动
                          </button>
                        )}
                      </div>
                    )}
                  </div>
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

function statusBadgeClass(status: string): string {
  if (status === "active") return "bg-blue-500/90 text-white";
  if (status === "reviewing") return "bg-amber-500/90 text-white";
  if (status === "archived") return "bg-slate-700/90 text-white";
  if (status === "deleted") return "bg-red-500/90 text-white";
  if (status === "draft") return "bg-white/90 text-slate-600";
  return "bg-white/90 text-slate-500";
}
