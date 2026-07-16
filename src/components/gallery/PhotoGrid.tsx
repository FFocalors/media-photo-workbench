import { AlertTriangle, Check, Download, ImageOff, Star } from "lucide-react";
import { EmptyState } from "../ui/States";
import { EventImageData, imageStatusLabels } from "../../lib/api";
import { cn } from "../../lib/cn";
import { getImageWorkflowStatusSemantic } from "../../lib/statusSemantics";
import { RetryableImage } from "./RetryableImage";

export function PhotoGrid({
  photos,
  activeId,
  selectedIds,
  emptyTitle = "暂无图片",
  emptyBody = "暂无图片，请先导入图片。",
  onActivate,
  onDownloadOriginal,
  onToggleSelected,
  onOpenPreview
}: {
  photos: EventImageData[];
  activeId: string | null;
  selectedIds: string[];
  emptyTitle?: string;
  emptyBody?: string;
  onActivate: (id: string) => void;
  onDownloadOriginal: (id: string) => void | Promise<void>;
  onToggleSelected: (id: string) => void;
  onOpenPreview: (id: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <EmptyState
        body={emptyBody}
        icon={<ImageOff size={22} />}
        title={emptyTitle}
      />
    );
  }

  return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {photos.map((photo) => (
        <PhotoCard
          active={photo.id === activeId}
          key={photo.id}
          photo={photo}
          selected={selectedIds.includes(photo.id)}
          onActivate={onActivate}
          onDownloadOriginal={onDownloadOriginal}
          onOpenPreview={onOpenPreview}
          onToggleSelected={onToggleSelected}
        />
      ))}
    </div>
  );
}

function PhotoCard({
  photo,
  selected,
  active,
  onActivate,
  onDownloadOriginal,
  onToggleSelected,
  onOpenPreview
}: {
  photo: EventImageData;
  selected: boolean;
  active: boolean;
  onActivate: (id: string) => void;
  onDownloadOriginal: (id: string) => void | Promise<void>;
  onToggleSelected: (id: string) => void;
  onOpenPreview: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group relative isolate aspect-[3/2] cursor-pointer overflow-hidden rounded-xl border-2 text-left transition-all",
        selected ? "border-blue-500 shadow-md" : active ? "border-blue-200 shadow-sm" : "border-transparent hover:border-blue-200"
      )}
      onClick={() => {
        onActivate(photo.id);
        onOpenPreview(photo.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onActivate(photo.id);
          onOpenPreview(photo.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <RetryableImage alt={photo.original_filename} className="h-full w-full object-cover" src={photo.thumb_url} />
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent p-2">
        <div className="flex items-center gap-1">
          <button
            aria-pressed={selected}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border shadow-sm transition-colors",
              selected
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-white/80 bg-black/20 text-transparent hover:bg-white/20 hover:text-white"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(photo.id);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            title={selected ? "取消选择" : "选择图片"}
            type="button"
          >
            <Check size={16} />
          </button>
          <button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/80 bg-black/20 text-white shadow-sm transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!photo.original_exists}
            onClick={(event) => {
              event.stopPropagation();
              if (!photo.original_exists) return;
              void onDownloadOriginal(photo.id);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            title={photo.original_exists ? "下载原图" : "原图缺失"}
            type="button"
          >
            <Download size={15} />
          </button>
        </div>
        <div className="flex min-w-0 shrink items-center gap-1">
          {!photo.original_exists && (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium leading-none text-white shadow-sm">
              <AlertTriangle size={12} />
              原图缺失
            </span>
          )}
          <span className={cn("max-w-20 shrink truncate whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium leading-none shadow-sm", statusClass(photo.status))}>
            {imageStatusLabels[photo.status]}
          </span>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2">
        <span className="mb-1 truncate pr-2 text-xs font-medium text-white">{photo.original_filename}</span>
        <div className="flex items-center gap-0.5 text-yellow-400">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star className={index >= photo.rating ? "text-white/30" : ""} fill={index < photo.rating ? "currentColor" : "none"} key={index} size={10} />
          ))}
        </div>
      </div>
    </div>
  );
}

function statusClass(status: EventImageData["status"]) {
  return getImageWorkflowStatusSemantic(status).badgeClass;
}
