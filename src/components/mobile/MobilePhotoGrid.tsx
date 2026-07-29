import { memo } from "react";
import { AlertTriangle, ImageOff, Star } from "lucide-react";
import { EventImageData, imageStatusLabels } from "../../lib/api";
import { cn } from "../../lib/cn";
import { getImageWorkflowStatusSemantic } from "../../lib/statusSemantics";
import { useLongPress } from "../../hooks/useLongPress";
import { useResponsiveColumns } from "../../hooks/useResponsiveColumns";
import { RetryableImage } from "../gallery/RetryableImage";
import { EmptyState } from "../ui/States";

/**
 * Mobile photo wall grid. Touch-first replacement for the desktop PhotoGrid:
 *   - 1 / 2 / 3 columns by viewport width (very narrow / portrait / landscape)
 *   - natural per-image aspect ratio (no aggressive cropping)
 *   - thumbnails only, natively lazy-loaded as they approach the viewport
 *   - tap = fullscreen preview, long-press = quick-action sheet (no hover deps)
 *   - rating / status / edited badges are always visible (no hover reveal)
 */
export function MobilePhotoGrid({
  photos,
  onOpenPreview,
  onLongPress,
  emptyTitle = "暂无图片",
  emptyBody = "暂无图片，请先导入图片。"
}: {
  photos: EventImageData[];
  onOpenPreview: (photo: EventImageData) => void;
  onLongPress: (photo: EventImageData) => void;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const columns = useResponsiveColumns();

  if (photos.length === 0) {
    return <EmptyState body={emptyBody} icon={<ImageOff size={22} />} title={emptyTitle} />;
  }

  return (
    <div
      className="grid items-start"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
        padding: "8px 10px 16px"
      }}
    >
      {photos.map((photo) => (
        <MemoMobilePhotoCard
          key={photo.id}
          onLongPress={onLongPress}
          onOpenPreview={onOpenPreview}
          photo={photo}
        />
      ))}
    </div>
  );
}

function MobilePhotoCard({
  photo,
  onOpenPreview,
  onLongPress
}: {
  photo: EventImageData;
  onOpenPreview: (photo: EventImageData) => void;
  onLongPress: (photo: EventImageData) => void;
}) {
  const handlers = useLongPress({
    onTap: () => onOpenPreview(photo),
    onLongPress: () => onLongPress(photo)
  });
  const aspect = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 3 / 2;

  return (
    <div
      {...handlers}
      aria-label={photo.original_filename}
      className="mpw-touch relative isolate cursor-pointer overflow-hidden rounded-lg bg-slate-200 transition-opacity active:opacity-90"
      role="button"
      style={{ aspectRatio: String(aspect) }}
    >
      <RetryableImage
        alt={photo.original_filename}
        className="h-full w-full object-cover"
        draggable={false}
        loading="lazy"
        src={photo.thumb_url}
      />

      {/* Top badges */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 bg-gradient-to-b from-black/45 to-transparent p-1.5">
        {!photo.original_exists ? (
          <span className="flex items-center gap-1 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
            <AlertTriangle size={10} />
            缺失
          </span>
        ) : (
          <span />
        )}
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none", statusClass(photo.status))}>
          {imageStatusLabels[photo.status]}
        </span>
      </div>

      {/* Bottom: filename + rating + edited */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end bg-gradient-to-t from-black/65 via-black/20 to-transparent p-1.5">
        <span className="mb-0.5 truncate text-[10px] font-medium text-white/95">{photo.original_filename}</span>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5 text-yellow-400">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                className={index >= photo.rating ? "text-white/40" : ""}
                fill={index < photo.rating ? "currentColor" : "none"}
                key={index}
                size={9}
              />
            ))}
          </div>
          {photo.edited_available && (
            <span className="rounded bg-emerald-500/90 px-1 py-0.5 text-[9px] font-semibold leading-none text-white">已修</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoized so a single image update only re-renders that card, not the wall.
const MemoMobilePhotoCard = memo(
  MobilePhotoCard,
  (prev, next) =>
    prev.photo === next.photo &&
    prev.onOpenPreview === next.onOpenPreview &&
    prev.onLongPress === next.onLongPress
);

function statusClass(status: EventImageData["status"]) {
  return getImageWorkflowStatusSemantic(status).badgeClass;
}
