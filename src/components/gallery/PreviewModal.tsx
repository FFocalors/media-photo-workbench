import { Download, X } from "lucide-react";
import type { GalleryPhoto, GalleryStatus } from "../../data/figmaMock";
import { categoryOptions, statusOptions } from "../../data/figmaMock";
import { cn } from "../../lib/cn";
import { RatingStars } from "./RatingStars";

export function PreviewModal({
  photo,
  photos,
  onClose,
  onSelectPhoto,
  onNext,
  onPrevious,
  onRatingChange,
  onStatusChange,
  onCategoryChange
}: {
  photo: GalleryPhoto;
  photos: GalleryPhoto[];
  onClose: () => void;
  onSelectPhoto: (id: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRatingChange: (id: string, rating: number) => void;
  onStatusChange: (id: string, status: GalleryStatus) => void;
  onCategoryChange: (id: string, category: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/90 text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div>
            <p className="text-sm font-medium">{photo.name}</p>
            <p className="text-xs text-white/50">← / → 切换，Esc 关闭，1-5 打星，X/E/P 改状态</p>
          </div>
          <button className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <button className="mr-4 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10" onClick={onPrevious} type="button">上一张</button>
          <img alt={photo.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" src={photo.previewUrl} />
          <button className="ml-4 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10" onClick={onNext} type="button">下一张</button>
        </div>

        <div className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 px-4">
          {photos.map((item) => (
            <button
              className={cn("h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2", item.id === photo.id ? "border-blue-400" : "border-transparent opacity-60 hover:opacity-100")}
              key={item.id}
              onClick={() => onSelectPhoto(item.id)}
              type="button"
            >
              <img alt={item.name} className="h-full w-full object-cover" src={item.url} />
            </button>
          ))}
        </div>
      </div>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-slate-900 p-5">
        <h2 className="mb-5 text-base font-semibold">图片操作</h2>
        <div className="space-y-5">
          <InfoRow label="摄影师" value={photo.photographer} />
          <InfoRow label="拍摄时间" value={photo.shotAt} />
          <InfoRow label="相机" value={photo.camera} />
          <InfoRow label="镜头" value={photo.lens} />

          <div className="border-t border-white/10 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-white/70">星级</span>
              <RatingStars interactive rating={photo.stars} onChange={(rating) => onRatingChange(photo.id, rating)} />
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm text-white/70">状态</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                onChange={(event) => onStatusChange(photo.id, event.target.value as GalleryStatus)}
                value={photo.status}
              >
                {statusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm text-white/70">分类</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
                onChange={(event) => onCategoryChange(photo.id, event.target.value)}
                value={photo.category}
              >
                {categoryOptions.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>

            <div>
              <span className="mb-2 block text-sm text-white/70">标签</span>
              <div className="flex flex-wrap gap-2">
                {photo.tags.map((tag) => <span className="rounded bg-white/10 px-2 py-1 text-xs text-white/80" key={tag}>{tag}</span>)}
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-5">
            <button className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600" onClick={() => onStatusChange(photo.id, "待修图")} type="button">加入待修图</button>
            <button className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700" onClick={() => onStatusChange(photo.id, "可发布")} type="button">标记可发布</button>
            <button className="w-full rounded-lg bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600" onClick={() => onStatusChange(photo.id, "废片")} type="button">标记废片</button>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-sm font-medium text-white/80 hover:bg-white/10" type="button">
              <Download size={14} /> 下载原图
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/40">{label}</p>
      <p className="text-sm text-white/80">{value}</p>
    </div>
  );
}
