import { EventData, ImageStatus, imageStatusLabels, imageStatusOptions } from "../../lib/api";

export function FilterSidebar({
  events,
  selectedEventId,
  search,
  minRating,
  statusFilter,
  sourceType,
  statusCounts,
  onEventChange,
  onSearchChange,
  onMinRatingChange,
  onStatusChange,
  onSourceTypeChange,
  onReset
}: {
  events: EventData[];
  selectedEventId: string;
  search: string;
  minRating: number;
  statusFilter: ImageStatus | "all";
  sourceType: string;
  statusCounts: Record<ImageStatus, number>;
  onEventChange: (eventId: string) => void;
  onSearchChange: (value: string) => void;
  onMinRatingChange: (value: number) => void;
  onStatusChange: (status: ImageStatus | "all") => void;
  onSourceTypeChange: (value: string) => void;
  onReset: () => void;
}) {
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex w-64 flex-col overflow-y-auto border-r border-slate-100 bg-white">
      <div className="flex items-center justify-between border-b border-slate-50 p-4">
        <h2 className="font-semibold text-slate-800">筛选</h2>
        <button className="text-xs text-blue-600 hover:text-blue-700" onClick={onReset} type="button">重置</button>
      </div>

      <div className="space-y-6 p-4">
        <FilterSection title="活动">
          <select
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => onEventChange(event.target.value)}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无进行中活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </FilterSection>

        <FilterSection title="搜索">
          <input
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="文件名 / 分类 / 备注"
            value={search}
          />
        </FilterSection>

        <FilterSection title="来源">
          <select
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => onSourceTypeChange(event.target.value)}
            value={sourceType}
          >
            <option value="all">全部来源</option>
            <option value="host_import">主机导入</option>
            <option value="client_upload">客户端上传</option>
            <option value="remote_import">远程导入</option>
            <option value="manual_import">手动导入</option>
          </select>
        </FilterSection>

        <FilterSection title="星级">
          <select
            className="mb-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => onMinRatingChange(Number(event.target.value))}
            value={minRating}
          >
            <option value={0}>全部星级</option>
            <option value={1}>1 星及以上</option>
            <option value={2}>2 星及以上</option>
            <option value={3}>3 星及以上</option>
            <option value={4}>4 星及以上</option>
            <option value={5}>5 星</option>
          </select>
          <div className="flex justify-between px-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${minRating === star ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                key={star}
                onClick={() => onMinRatingChange(minRating === star ? 0 : star)}
                type="button"
              >
                {star}
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterSection title="状态">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                checked={statusFilter === "all"}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                onChange={() => onStatusChange("all")}
                type="radio"
              />
              全部
              <span className="ml-auto text-xs text-slate-400">{total.toLocaleString()}</span>
            </label>
            {imageStatusOptions.map((status) => (
              <label className="flex items-center gap-2 text-sm text-slate-700" key={status}>
                <input
                  checked={statusFilter === status}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  onChange={() => onStatusChange(status)}
                  type="radio"
                />
                {imageStatusLabels[status]}
                <span className="ml-auto text-xs text-slate-400">{statusCounts[status] ?? 0}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </div>
  );
}
