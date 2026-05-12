import type { GalleryStatus } from "../../data/figmaMock";
import { photographerOptions, statusOptions } from "../../data/figmaMock";

export function FilterSidebar({
  search,
  photographer,
  minRating,
  statusFilter,
  statusCounts,
  onSearchChange,
  onPhotographerChange,
  onMinRatingChange,
  onToggleStatus,
  onReset
}: {
  search: string;
  photographer: string;
  minRating: number;
  statusFilter: GalleryStatus[];
  statusCounts: Record<GalleryStatus, number>;
  onSearchChange: (value: string) => void;
  onPhotographerChange: (value: string) => void;
  onMinRatingChange: (value: number) => void;
  onToggleStatus: (status: GalleryStatus) => void;
  onReset: () => void;
}) {
  const allSelected = statusFilter.length === statusOptions.length;

  return (
    <div className="flex w-64 flex-col overflow-y-auto border-r border-slate-100 bg-white">
      <div className="flex items-center justify-between border-b border-slate-50 p-4">
        <h2 className="font-semibold text-slate-800">筛选</h2>
        <button className="text-xs text-blue-600 hover:text-blue-700" onClick={onReset} type="button">重置</button>
      </div>

      <div className="space-y-6 p-4">
        <FilterSection title="活动">
          <select className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
            <option>2026 春季运动会</option>
          </select>
        </FilterSection>

        <FilterSection title="搜索">
          <input
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="文件名 / 标签 / 分类"
            value={search}
          />
        </FilterSection>

        <FilterSection title="摄影师">
          <select
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => onPhotographerChange(event.target.value)}
            value={photographer}
          >
            {photographerOptions.map((option) => <option key={option}>{option}</option>)}
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
              <input checked={allSelected} className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" readOnly type="checkbox" />
              全部
              <span className="ml-auto text-xs text-slate-400">{Object.values(statusCounts).reduce((sum, count) => sum + count, 0).toLocaleString()}</span>
            </label>
            {statusOptions.map((status) => (
              <label className="flex items-center gap-2 text-sm text-slate-700" key={status}>
                <input
                  checked={statusFilter.includes(status)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  onChange={() => onToggleStatus(status)}
                  type="checkbox"
                />
                {status}
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
