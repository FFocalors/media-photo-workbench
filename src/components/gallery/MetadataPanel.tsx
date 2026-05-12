import { Download, Info, X } from "lucide-react";
import type { GalleryPhoto, GalleryStatus } from "../../data/figmaMock";
import { categoryOptions, statusOptions } from "../../data/figmaMock";
import { RatingStars } from "./RatingStars";

export function MetadataPanel({
  photo,
  selectedCount,
  onRatingChange,
  onStatusChange,
  onCategoryChange,
  onOpenPreview,
  onClearActive
}: {
  photo: GalleryPhoto | null;
  selectedCount: number;
  onRatingChange: (rating: number) => void;
  onStatusChange: (status: GalleryStatus) => void;
  onCategoryChange: (category: string) => void;
  onOpenPreview: () => void;
  onClearActive: () => void;
}) {
  return (
    <div className="flex w-72 flex-col overflow-y-auto border-l border-slate-100 bg-white">
      <div className="flex items-center justify-between border-b border-slate-50 p-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Info size={16} /> 元数据
        </h2>
        <button className="text-slate-400 hover:text-slate-600" onClick={onClearActive} type="button"><X size={16} /></button>
      </div>

      {!photo ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm leading-6 text-slate-400">
          选择一张图片查看元数据和操作项。
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <Meta label="文件名" value={photo.name} strong />
          <Meta label="拍摄时间" value={photo.shotAt} />
          <Meta label="摄影师" value={photo.photographer} />
          <Meta label="相机型号" value={photo.camera} />
          <Meta label="镜头" value={photo.lens} />
          <Meta label="已选择" value={`${selectedCount} 张`} />

          <div className="border-t border-slate-100 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">星级</span>
              <RatingStars interactive rating={photo.stars} onChange={onRatingChange} />
            </div>
            <div className="mb-4">
              <span className="mb-2 block text-sm font-medium text-slate-700">状态</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                onChange={(event) => onStatusChange(event.target.value as GalleryStatus)}
                value={photo.status}
              >
                {statusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <span className="mb-2 block text-sm font-medium text-slate-700">分类</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                onChange={(event) => onCategoryChange(event.target.value)}
                value={photo.category}
              >
                {categoryOptions.map((category) => <option key={category}>{category}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <span className="mb-2 block text-sm font-medium text-slate-700">标签</span>
              <div className="flex flex-wrap gap-2">
                {photo.tags.map((tag) => (
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600" key={tag}>{tag}</span>
                ))}
                <button className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-400 hover:text-slate-600" type="button">
                  + 添加
                </button>
              </div>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">备注</span>
              <p className="min-h-10 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">{photo.remark || "暂无备注"}</p>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-5">
            <button className="w-full rounded-lg bg-blue-50 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100" onClick={onOpenPreview} type="button">打开预览</button>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50" type="button">
              <Download size={14} /> 下载原图
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-slate-400">{label}</p>
      <p className={`break-all text-sm ${strong ? "font-medium text-slate-900" : "text-slate-700"}`}>{value}</p>
    </div>
  );
}
