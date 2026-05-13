import { ChevronDown, LayoutGrid, List, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageStatus, imageStatusLabels } from "../../lib/api";

export function GalleryToolbar({
  selectedCount,
  filteredCount,
  onSelectAll,
  onClearSelection,
  onBatchStatus,
  search,
  onSearchChange
}: {
  selectedCount: number;
  filteredCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchStatus: (status: ImageStatus) => void | Promise<void>;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!batchMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!batchMenuRef.current?.contains(event.target as Node)) {
        setBatchMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [batchMenuOpen]);

  useEffect(() => {
    if (selectedCount === 0) {
      setBatchMenuOpen(false);
    }
  }, [selectedCount]);

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4">
      <div className="relative max-w-md flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-sm transition-shadow focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索文件名 / 分类 / 备注 / 相机..."
          type="text"
          value={search}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="text-xs text-slate-500">筛选结果 {filteredCount} 张</div>
        <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          <button className="rounded-md bg-white p-1.5 text-slate-700 shadow-sm" type="button"><LayoutGrid size={16} /></button>
          <button className="rounded-md p-1.5 text-slate-500 hover:text-slate-700" type="button"><List size={16} /></button>
        </div>
        <div className="mx-1 h-6 w-px bg-slate-200" />
        <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={onSelectAll} type="button">全选当前</button>
        <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={selectedCount === 0} onClick={onClearSelection} type="button">清除选择</button>
        <div className="relative" ref={batchMenuRef}>
          <button
            aria-expanded={batchMenuOpen}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedCount === 0}
            onClick={() => setBatchMenuOpen((open) => !open)}
            type="button"
          >
            批量操作 <ChevronDown size={14} />
          </button>
          {batchMenuOpen && selectedCount > 0 && (
            <div className="absolute right-0 top-full z-30 mt-2 w-40 rounded-xl border border-slate-100 bg-white p-1 shadow-lg">
              {(["edit", "publish", "edited", "rejected"] as ImageStatus[]).map((status) => (
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  key={status}
                  onClick={() => {
                    setBatchMenuOpen(false);
                    void onBatchStatus(status);
                  }}
                  type="button"
                >
                  标记为{imageStatusLabels[status]}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-400" disabled type="button">
          导出当前筛选 <ChevronDown size={14} />
        </button>
      </div>
    </div>
  );
}
