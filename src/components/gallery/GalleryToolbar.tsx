import {
  ChevronDown,
  Download,
  Info,
  Keyboard,
  LayoutGrid,
  List,
  MoreHorizontal,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageStatus, imageStatusLabels } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { RealtimeConnectionState } from "../../lib/socket";

export function GalleryToolbar({
  selectedCount,
  filteredCount,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onBatchStatus,
  onOpenBatchCategory,
  search,
  onSearchChange,
  realtimeStatus,
  allowDelete = true,
  trashMode = false,
  onToggleTrashMode,
  onRestoreSelected,
  onPurgeSelected,
  onDownloadSelectedZip,
  onToggleFilters,
  filtersOpen = true,
  onToggleMetadata,
  metadataOpen = true,
  hasMetadata = false,
  onOpenShortcuts,
  batchBusy = false,
  onlineClientCount
}: {
  selectedCount: number;
  filteredCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onBatchStatus: (status: ImageStatus) => void | Promise<void>;
  onOpenBatchCategory?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  realtimeStatus: RealtimeConnectionState;
  allowDelete?: boolean;
  trashMode?: boolean;
  onToggleTrashMode?: () => void;
  onRestoreSelected?: () => void;
  onPurgeSelected?: () => void;
  onDownloadSelectedZip?: () => void;
  onToggleFilters?: () => void;
  filtersOpen?: boolean;
  onToggleMetadata?: () => void;
  metadataOpen?: boolean;
  hasMetadata?: boolean;
  onOpenShortcuts?: () => void;
  batchBusy?: boolean;
  onlineClientCount?: number;
}) {
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setActionMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [actionMenuOpen]);

  const runAction = (action?: () => void) => {
    if (!action) return;
    setActionMenuOpen(false);
    action();
  };

  const runStatusAction = (status: ImageStatus) => {
    if (batchBusy) return;
    setActionMenuOpen(false);
    void onBatchStatus(status);
  };

  return (
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 bg-white px-4 py-2">
      <div className="flex min-w-[260px] flex-1 items-center gap-2">
        {onToggleFilters && (
          <button
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium xl:hidden",
              filtersOpen ? "border-blue-100 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-700 hover:bg-slate-50"
            )}
            onClick={onToggleFilters}
            type="button"
          >
            <SlidersHorizontal size={15} />
            筛选
          </button>
        )}
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-sm transition-shadow focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索文件名 / 分类 / 备注 / 相机..."
            type="text"
            value={search}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <div className="whitespace-nowrap text-xs text-slate-500">筛选结果 {filteredCount} 张</div>
        {typeof onlineClientCount === "number" && (
          <div className="whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
            在线客户端 {onlineClientCount}
          </div>
        )}
        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${realtimeStatusClass(realtimeStatus)}`} />
          {realtimeStatusLabel(realtimeStatus)}
        </div>
        {onOpenShortcuts && (
          <button
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onOpenShortcuts}
            type="button"
          >
            <Keyboard size={15} />
            快捷键
          </button>
        )}
        <div className="flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          <button className="rounded-md bg-white p-1.5 text-slate-700 shadow-sm" title="网格视图" type="button"><LayoutGrid size={16} /></button>
          <button className="rounded-md p-1.5 text-slate-500 hover:text-slate-700" title="列表视图" type="button"><List size={16} /></button>
        </div>
        {onToggleMetadata && (
          <button
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium 2xl:hidden",
              metadataOpen ? "border-blue-100 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-700 hover:bg-slate-50",
              !hasMetadata && "cursor-not-allowed opacity-50"
            )}
            disabled={!hasMetadata}
            onClick={onToggleMetadata}
            type="button"
          >
            <Info size={15} />
            元数据
          </button>
        )}

        <div className="relative" ref={actionMenuRef}>
          <button
            aria-expanded={actionMenuOpen}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setActionMenuOpen((open) => !open)}
            type="button"
          >
            <MoreHorizontal size={16} />
            更多操作
            <ChevronDown size={14} />
          </button>
          {actionMenuOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-slate-100 bg-white p-1.5 shadow-xl">
              <ActionMenuButton onClick={() => runAction(onSelectAll)}>全选当前</ActionMenuButton>
              <ActionMenuButton disabled={selectedCount === 0} onClick={() => runAction(onClearSelection)}>
                清除选择
              </ActionMenuButton>
              {onToggleTrashMode && (
                <ActionMenuButton onClick={() => runAction(onToggleTrashMode)}>
                  {trashMode ? "返回图片墙" : "图片回收站"}
                </ActionMenuButton>
              )}

              <div className="my-1 h-px bg-slate-100" />

              {trashMode ? (
                <>
                  <ActionMenuButton disabled={selectedCount === 0} icon={<RotateCcw size={15} />} onClick={() => runAction(onRestoreSelected)}>
                    恢复所选
                  </ActionMenuButton>
                  <ActionMenuButton danger disabled={selectedCount === 0} icon={<Trash2 size={15} />} onClick={() => runAction(onPurgeSelected)}>
                    永久删除
                  </ActionMenuButton>
                </>
              ) : (
                <>
                  {allowDelete && (
                    <ActionMenuButton danger disabled={selectedCount === 0} icon={<Trash2 size={15} />} onClick={() => runAction(onDeleteSelected)}>
                      删除所选
                    </ActionMenuButton>
                  )}
                  {onDownloadSelectedZip && (
                    <ActionMenuButton disabled={selectedCount === 0} icon={<Download size={15} />} onClick={() => runAction(onDownloadSelectedZip)}>
                      下载所选 ZIP
                    </ActionMenuButton>
                  )}
                  <ActionMenuButton disabled>导出当前筛选</ActionMenuButton>
                </>
              )}

              {!trashMode && (
                <>
                  <div className="my-1 h-px bg-slate-100" />
                  <p className="px-3 py-1 text-xs text-slate-400">批量标记</p>
                  {(["edit", "publish", "edited", "rejected"] as ImageStatus[]).map((status) => (
                    <ActionMenuButton disabled={selectedCount === 0 || batchBusy} key={status} onClick={() => runStatusAction(status)}>
                      标记为{imageStatusLabels[status]}
                    </ActionMenuButton>
                  ))}
                  {onOpenBatchCategory && (
                    <ActionMenuButton disabled={selectedCount === 0 || batchBusy} onClick={() => runAction(onOpenBatchCategory)}>
                      设置分类...
                    </ActionMenuButton>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionMenuButton({
  children,
  disabled = false,
  danger = false,
  icon,
  onClick
}: {
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
        disabled && "cursor-not-allowed text-slate-300 hover:bg-transparent"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

function realtimeStatusLabel(status: RealtimeConnectionState): string {
  if (status === "connected") return "实时已连接";
  if (status === "reconnecting") return "重连中";
  return "实时已断开";
}

function realtimeStatusClass(status: RealtimeConnectionState): string {
  if (status === "connected") return "bg-emerald-500";
  if (status === "reconnecting") return "bg-amber-500";
  return "bg-slate-300";
}
