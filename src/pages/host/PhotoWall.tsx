import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterSidebar } from "../../components/gallery/FilterSidebar";
import { GalleryToolbar } from "../../components/gallery/GalleryToolbar";
import { MetadataPanel } from "../../components/gallery/MetadataPanel";
import { PhotoGrid } from "../../components/gallery/PhotoGrid";
import { PreviewModal } from "../../components/gallery/PreviewModal";
import { Notice } from "../../components/ui/States";
import {
  EventData,
  EventImageData,
  fetchEventImages,
  fetchEvents,
  ImageStatus,
  imageStatusOptions,
  updateImageCategory,
  updateImageRating,
  updateImageRemark,
  updateImageStatus
} from "../../lib/api";

export function PhotoWallPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [photos, setPhotos] = useState<EventImageData[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ImageStatus | "all">("all");
  const [sourceType, setSourceType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const previewPhoto = photos.find((photo) => photo.id === previewPhotoId) ?? null;

  const statusCounts = useMemo(() => {
    return photos.reduce<Record<ImageStatus, number>>((acc, photo) => {
      acc[photo.status] = (acc[photo.status] ?? 0) + 1;
      return acc;
    }, {
      unselected: 0,
      rejected: 0,
      archive: 0,
      edit: 0,
      edited: 0,
      publish: 0,
      published: 0
    });
  }, [photos]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetchEvents("active");
      if (res.ok && res.data) {
        setEvents(res.data);
        setSelectedEventId((current) => current || res.data[0]?.id || "");
        if (res.data.length === 0) {
          setMessage({ tone: "warning", title: "暂无进行中活动", body: "请先在活动管理中新建活动，再导入并查看图片。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "图片墙需要后端 API，请通过 pnpm dev 启动完整应用。" });
    }
  }, []);

  const loadImages = useCallback(async () => {
    if (!selectedEventId) {
      setPhotos([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchEventImages(selectedEventId, {
        page: 1,
        pageSize: 200,
        rating: minRating > 0 ? minRating : undefined,
        status: statusFilter,
        source_type: sourceType,
        keyword: search.trim() || undefined
      });
      if (res.ok && res.data) {
        setPhotos(res.data.items);
        setTotal(res.data.total);
        setSelectedIds((current) => current.filter((id) => res.data.items.some((photo) => photo.id === id)));
        setActivePhotoId((current) => current && res.data.items.some((photo) => photo.id === current) ? current : null);
        setMessage(null);
      } else {
        setMessage({ tone: "danger", title: "图片读取失败", body: res.error?.message || "无法读取图片列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "图片读取失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setLoading(false);
    }
  }, [minRating, search, selectedEventId, sourceType, statusFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const replacePhoto = (updated: EventImageData) => {
    setPhotos((current) => current.map((photo) => (photo.id === updated.id ? updated : photo)));
  };

  const runImageUpdate = async (operation: () => Promise<{ ok: boolean; data: EventImageData; error: { message: string } | null }>, successTitle: string) => {
    try {
      const res = await operation();
      if (res.ok && res.data) {
        replacePhoto(res.data);
        setMessage({ tone: "success", title: successTitle, body: "图片信息已更新。" });
      } else {
        setMessage({ tone: "danger", title: "更新失败", body: res.error?.message || "图片更新失败。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "更新失败", body: "请求失败，请确认后端服务已启动。" });
    }
  };

  const handleRatingChange = (id: string, rating: number) => {
    void runImageUpdate(() => updateImageRating(id, rating), "星级已更新");
  };

  const handleStatusChange = (id: string, status: ImageStatus) => {
    void runImageUpdate(() => updateImageStatus(id, status), "状态已更新");
  };

  const handleCategoryChange = (id: string, category: string) => {
    void runImageUpdate(() => updateImageCategory(id, category), "分类已更新");
  };

  const handleRemarkChange = (id: string, remark: string) => {
    void runImageUpdate(() => updateImageRemark(id, remark), "备注已更新");
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setActivePhotoId(id);
  };

  const selectAllFiltered = () => {
    setSelectedIds(photos.map((photo) => photo.id));
    setActivePhotoId((current) => current ?? photos[0]?.id ?? null);
  };

  const batchStatus = async (status: ImageStatus) => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    for (const id of ids) {
      await runImageUpdate(() => updateImageStatus(id, status), "批量状态已更新");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setMinRating(0);
    setStatusFilter("all");
    setSourceType("all");
  };

  const movePreview = useCallback((direction: 1 | -1) => {
    const currentId = previewPhotoId ?? activePhotoId;
    const index = photos.findIndex((photo) => photo.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + photos.length) % photos.length;
    const next = photos[nextIndex];
    if (next) {
      setActivePhotoId(next.id);
      setPreviewPhotoId(next.id);
    }
  }, [activePhotoId, photos, previewPhotoId]);

  useEffect(() => {
    if (!previewPhotoId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (editing && event.key !== "Escape") return;

      if (event.key === "Escape") {
        setPreviewPhotoId(null);
        return;
      }
      if (event.key === "ArrowRight") {
        movePreview(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        movePreview(-1);
        return;
      }
      if (!previewPhoto) return;
      if (/^[1-5]$/.test(event.key)) {
        handleRatingChange(previewPhoto.id, Number(event.key));
      } else if (event.key === "0") {
        handleRatingChange(previewPhoto.id, 0);
      } else if (event.key.toLowerCase() === "x") {
        handleStatusChange(previewPhoto.id, "rejected");
      } else if (event.key.toLowerCase() === "e") {
        handleStatusChange(previewPhoto.id, "edit");
      } else if (event.key.toLowerCase() === "p") {
        handleStatusChange(previewPhoto.id, "publish");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [movePreview, previewPhoto, previewPhotoId]);

  const emptyTitle = selectedEventId && total === 0 && !search && minRating === 0 && statusFilter === "all" ? "暂无图片" : "当前筛选没有图片";
  const emptyBody = selectedEventId && total === 0 && !search && minRating === 0 && statusFilter === "all"
    ? "暂无图片，请先导入图片。"
    : "当前筛选条件下没有可显示的图片。可以清空筛选、降低星级条件，或切换到全部状态。";

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-[#F8F9FA]">
      <FilterSidebar
        events={events}
        minRating={minRating}
        search={search}
        selectedEventId={selectedEventId}
        sourceType={sourceType}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        onEventChange={(eventId) => {
          setSelectedEventId(eventId);
          setSelectedIds([]);
          setActivePhotoId(null);
          setPreviewPhotoId(null);
        }}
        onMinRatingChange={setMinRating}
        onReset={resetFilters}
        onSearchChange={setSearch}
        onSourceTypeChange={setSourceType}
        onStatusChange={setStatusFilter}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <GalleryToolbar
          filteredCount={photos.length}
          search={search}
          selectedCount={selectedIds.length}
          onBatchStatus={batchStatus}
          onClearSelection={() => {
            setSelectedIds([]);
            setActivePhotoId(null);
          }}
          onSearchChange={setSearch}
          onSelectAll={selectAllFiltered}
        />

        {message && (
          <div className="shrink-0 px-4 pt-4">
            <Notice tone={message.tone} title={message.title}>{message.body}</Notice>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full min-h-[360px] items-center justify-center rounded-xl border border-slate-100 bg-white text-sm text-slate-400">正在读取图片...</div>
          ) : (
            <PhotoGrid
              activeId={activePhotoId}
              emptyBody={emptyBody}
              emptyTitle={emptyTitle}
              photos={photos}
              selectedIds={selectedIds}
              onActivate={setActivePhotoId}
              onOpenPreview={setPreviewPhotoId}
              onToggleSelected={toggleSelected}
            />
          )}
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-slate-100 bg-white px-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>已选择 {selectedIds.length} 张</span>
            <span>本页 {photos.length.toLocaleString()} 张</span>
          </div>
          <span>共 {total.toLocaleString()} 张</span>
        </div>
      </div>

      <MetadataPanel
        photo={activePhoto}
        selectedCount={selectedIds.length}
        onCategoryChange={(category) => activePhoto && handleCategoryChange(activePhoto.id, category)}
        onClearActive={() => setActivePhotoId(null)}
        onOpenPreview={() => activePhoto && setPreviewPhotoId(activePhoto.id)}
        onRatingChange={(rating) => activePhoto && handleRatingChange(activePhoto.id, rating)}
        onRemarkChange={(remark) => activePhoto && handleRemarkChange(activePhoto.id, remark)}
        onStatusChange={(status) => activePhoto && handleStatusChange(activePhoto.id, status)}
      />

      {previewPhoto && (
        <PreviewModal
          photo={previewPhoto}
          photos={photos}
          onCategoryChange={handleCategoryChange}
          onClose={() => setPreviewPhotoId(null)}
          onNext={() => movePreview(1)}
          onPrevious={() => movePreview(-1)}
          onRatingChange={handleRatingChange}
          onRemarkChange={handleRemarkChange}
          onSelectPhoto={(id) => {
            setActivePhotoId(id);
            setPreviewPhotoId(id);
          }}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
