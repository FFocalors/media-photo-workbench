import { Check, ImageOff, Star } from "lucide-react";
import { EmptyState } from "../ui/States";
import type { GalleryPhoto } from "../../data/figmaMock";
import { cn } from "../../lib/cn";

export function PhotoGrid({
  photos,
  activeId,
  selectedIds,
  onActivate,
  onToggleSelected,
  onOpenPreview
}: {
  photos: GalleryPhoto[];
  activeId: string | null;
  selectedIds: string[];
  onActivate: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onOpenPreview: (id: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <EmptyState
        body="当前筛选条件下没有可显示的图片。可以清空筛选、降低星级条件，或切换到全部状态。"
        icon={<ImageOff size={22} />}
        title="当前筛选没有图片"
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {photos.map((photo) => (
        <PhotoCard
          active={photo.id === activeId}
          key={photo.id}
          photo={photo}
          selected={selectedIds.includes(photo.id)}
          onActivate={onActivate}
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
  onToggleSelected,
  onOpenPreview
}: {
  photo: GalleryPhoto;
  selected: boolean;
  active: boolean;
  onActivate: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onOpenPreview: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group relative aspect-[3/2] cursor-pointer overflow-hidden rounded-xl border-2 text-left transition-all",
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
      <img alt={photo.name} className="h-full w-full object-cover" src={photo.url} />
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className={cn("flex h-5 w-5 items-center justify-center rounded border", selected ? "border-blue-500 bg-blue-500 text-white" : "border-white/70 text-transparent hover:border-white")}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected(photo.id);
          }}
          type="button"
        >
          <Check size={14} />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="truncate pr-2 text-xs font-medium text-white">{photo.name}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] shadow-sm", statusClass(photo.status))}>{photo.status}</span>
        </div>
        <div className="flex items-center gap-0.5 text-yellow-400">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star className={index >= photo.stars ? "text-white/30" : ""} fill={index < photo.stars ? "currentColor" : "none"} key={index} size={10} />
          ))}
        </div>
      </div>
    </div>
  );
}

function statusClass(status: GalleryPhoto["status"]) {
  if (status === "待修图") return "bg-amber-500 text-white";
  if (status === "已修图") return "bg-emerald-500 text-white";
  if (status === "可发布") return "bg-blue-500 text-white";
  if (status === "废片") return "bg-red-500 text-white";
  return "bg-slate-500/80 text-white";
}
