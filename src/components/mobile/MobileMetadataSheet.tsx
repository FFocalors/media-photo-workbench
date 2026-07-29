import { Star } from "lucide-react";
import { EventImageData, imageStatusLabels } from "../../lib/api";
import { cn } from "../../lib/cn";
import { getImageWorkflowStatusSemantic } from "../../lib/statusSemantics";
import { BottomSheet } from "./BottomSheet";

/**
 * Mobile metadata viewer — a bottom drawer (the desktop right-hand metadata
 * panel is not used on mobile). Read-only; rating/status edits happen in the
 * preview toolbar. Scrolls internally when the content is long.
 */
export function MobileMetadataSheet({
  open,
  onClose,
  photo
}: {
  open: boolean;
  onClose: () => void;
  photo: EventImageData | null;
}) {
  return (
    <BottomSheet maxHeightClass="mpw-max-h-85" onClose={onClose} open={open} title="元数据" subtitle={photo?.original_filename}>
      {photo ? (
        <dl className="space-y-4 pb-4 pt-1">
          <Field label="文件名" value={photo.original_filename} strong />
          <Field label="当前状态">
            <span className={cn("inline-block rounded-md border px-2 py-0.5 text-xs font-medium", getImageWorkflowStatusSemantic(photo.status).badgeClass)}>
              {imageStatusLabels[photo.status]}
            </span>
          </Field>
          <Field label="星级">
            <span className="flex items-center gap-0.5 text-yellow-400">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star
                  className={index >= photo.rating ? "text-slate-200" : ""}
                  fill={index < photo.rating ? "currentColor" : "none"}
                  key={index}
                  size={14}
                />
              ))}
              <span className="ml-1 text-xs text-slate-500">{photo.rating} 星</span>
            </span>
          </Field>
          <Field label="图片尺寸" value={photo.width && photo.height ? `${photo.width} × ${photo.height}` : "未知"} />
          <Field label="文件大小" value={formatBytes(photo.file_size)} />
          <Field label="拍摄时间" value={photo.shot_at || "未知"} />
          <Field label="相机型号" value={photo.camera_model || "未知"} />
          <Field label="镜头" value={photo.lens_model || "未知"} />
          <Field label="摄影师" value={photo.photographer || "未填写"} />
          <Field label="上传来源" value={formatSource(photo)} />
          <Field label="上传者" value={formatUploader(photo)} />
          <Field label="上传时间" value={photo.uploaded_at || photo.imported_at || "未知"} />
          <Field label="分类" value={photo.category || "未分类"} />
          <Field label="备注" value={photo.remark || "暂无备注"} />
          <Field label="原图文件" value={photo.original_exists ? "正常" : "缺失"} valueClassName={photo.original_exists ? "text-emerald-600" : "font-medium text-red-600"} />
        </dl>
      ) : (
        <p className="py-8 text-center text-sm text-slate-400">未选择图片</p>
      )}
    </BottomSheet>
  );
}

function Field({
  label,
  value,
  strong = false,
  valueClassName,
  children
}: {
  label: string;
  value?: string;
  strong?: boolean;
  valueClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 pt-px text-xs text-slate-400">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-all text-right text-sm", valueClassName || (strong ? "font-medium text-slate-900" : "text-slate-700"))}>
        {children ?? value}
      </dd>
    </div>
  );
}

function formatSource(photo: EventImageData): string {
  if (photo.source_type === "host_import") return "主机导入";
  if (photo.source_type === "client_upload") return "客户端上传";
  if (photo.source_type === "camera_ftp") return "相机 FTP 传输";
  if (photo.source_type === "remote_import") return "远程导入";
  if (photo.source_type === "manual_import") return "手动导入";
  return "未知";
}

function formatUploader(photo: EventImageData): string {
  if (photo.uploaded_by_name) return photo.uploaded_by_name;
  if (photo.source_type === "host_import") return "主机";
  if (photo.source_type === "client_upload") return "客户端上传";
  if (photo.source_type === "camera_ftp") return "相机 FTP";
  return "未知来源";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
