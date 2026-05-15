import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EventImageData, ImageStatus, imageStatusLabels, imageStatusOptions } from "../../lib/api";
import { cn } from "../../lib/cn";
import { RatingStars } from "./RatingStars";

export function MetadataPanel({
  photo,
  selectedCount,
  onRatingChange,
  onStatusChange,
  onCategoryChange,
  onRemarkChange,
  onOpenPreview,
  onClearActive,
  onClosePanel,
  className
}: {
  photo: EventImageData | null;
  selectedCount: number;
  onRatingChange: (rating: number) => void;
  onStatusChange: (status: ImageStatus) => void;
  onCategoryChange: (category: string) => void;
  onRemarkChange: (remark: string) => void;
  onOpenPreview: () => void;
  onClearActive: () => void;
  onClosePanel?: () => void;
  className?: string;
}) {
  const [categoryDraft, setCategoryDraft] = useState("");
  const [remarkDraft, setRemarkDraft] = useState("");

  useEffect(() => {
    setCategoryDraft(photo?.category ?? "");
    setRemarkDraft(photo?.remark ?? "");
  }, [photo?.id, photo?.category, photo?.remark]);

  return (
    <div className={cn("flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-100 bg-white", className)}>
      <div className="flex items-center justify-between border-b border-slate-50 p-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <Info size={16} /> 元数据
        </h2>
        <button className="text-slate-400 hover:text-slate-600" onClick={onClosePanel ?? onClearActive} type="button"><X size={16} /></button>
      </div>

      {!photo ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm leading-6 text-slate-400">
          选择一张图片查看元数据和操作项。
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <Meta label="文件名" value={photo.original_filename} strong />
          <Meta label="尺寸" value={photo.width && photo.height ? `${photo.width} x ${photo.height}` : "未知"} />
          <Meta label="文件大小" value={formatBytes(photo.file_size)} />
          <Meta label="拍摄时间" value={photo.shot_at || "未知"} />
          <Meta label="导入时间" value={photo.imported_at || "未知"} />
          <Meta label="摄影师" value={photo.photographer || "未填写"} />
          <Meta label="相机型号" value={photo.camera_model || "未知"} />
          <Meta label="镜头" value={photo.lens_model || "未知"} />
          <Meta label="原图文件" value={photo.original_exists ? "正常" : "缺失"} valueClassName={photo.original_exists ? "text-emerald-600" : "font-medium text-red-600"} />
          <Meta label="预览图文件" value={photo.preview_exists ? "正常" : "缺失"} valueClassName={photo.preview_exists ? "text-emerald-600" : "font-medium text-red-600"} />
          <Meta label="已选择" value={`${selectedCount} 张`} />

          <div className="border-t border-slate-100 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">星级</span>
              <RatingStars interactive rating={photo.rating} onChange={onRatingChange} />
            </div>
            <div className="mb-4">
              <span className="mb-2 block text-sm font-medium text-slate-700">状态</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                onChange={(event) => onStatusChange(event.target.value as ImageStatus)}
                value={photo.status}
              >
                {imageStatusOptions.map((status) => <option key={status} value={status}>{imageStatusLabels[status]}</option>)}
              </select>
            </div>
            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-medium text-slate-700">分类</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                onBlur={() => categoryDraft !== photo.category && onCategoryChange(categoryDraft)}
                onChange={(event) => setCategoryDraft(event.target.value)}
                placeholder="输入分类"
                value={categoryDraft}
              />
            </label>
            <label>
              <span className="mb-2 block text-sm font-medium text-slate-700">备注</span>
              <textarea
                className="min-h-20 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 focus:border-blue-500 focus:outline-none"
                onBlur={() => remarkDraft !== photo.remark && onRemarkChange(remarkDraft)}
                onChange={(event) => setRemarkDraft(event.target.value)}
                placeholder="暂无备注"
                value={remarkDraft}
              />
            </label>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-5">
            <button className="w-full rounded-lg bg-blue-50 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100" onClick={onOpenPreview} type="button">打开预览</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value, strong = false, valueClassName = "" }: { label: string; value: string; strong?: boolean; valueClassName?: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-slate-400">{label}</p>
      <p className={`break-all text-sm ${valueClassName || (strong ? "font-medium text-slate-900" : "text-slate-700")}`}>{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
