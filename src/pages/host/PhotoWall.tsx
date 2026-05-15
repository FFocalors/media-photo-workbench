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
  createDownloadZipTask,
  deleteImage,
  downloadImageFile,
  fetchEventImages,
  fetchEvents,
  ImageDownloadType,
  ImageStatus,
  imageStatusOptions,
  fetchEventTrashedImages,
  purgeImage,
  restoreImage,
  updateImageCategory,
  updateImageRating,
  updateImageRemark,
  updateImageStatus
} from "../../lib/api";
import {
  subscribeRealtimeConnection,
  subscribeRealtimeImageEvent
} from "../../lib/socket";
import type { RealtimeConnectionState, RealtimeImagePayload } from "../../lib/socket";

export function PhotoWallPage({ mode = "host" }: { mode?: "host" | "client" }) {
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
  const [trashMode, setTrashMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionState>("disconnected");
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

  const matchesCurrentFilters = useCallback((photo: EventImageData) => {
    if (minRating > 0 && photo.rating < minRating) return false;
    if (statusFilter !== "all" && photo.status !== statusFilter) return false;
    if (sourceType !== "all" && photo.source_type !== sourceType) return false;

    const keyword = search.trim().toLowerCase();
    if (!keyword) return true;

    return [
      photo.original_filename,
      photo.stored_filename,
      photo.category,
      photo.remark,
      photo.photographer,
      photo.camera_model,
      photo.lens_model
    ].some((value) => value.toLowerCase().includes(keyword));
  }, [minRating, search, sourceType, statusFilter]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetchEvents(mode === "client" ? "all" : "active");
      if (res.ok && res.data) {
        const available = mode === "client"
          ? res.data.filter((event) => ["active", "reviewing", "draft"].includes(event.status))
          : res.data;
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: mode === "client" ? "主机当前没有可协作的活动。" : "请先在活动管理中新建活动，再导入并查看图片。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: mode === "client" ? "请先在客户端连接页完成连接测试。" : "图片墙需要后端 API，请通过 pnpm dev 启动完整应用。" });
    }
  }, [mode]);

  const loadImages = useCallback(async () => {
    if (!selectedEventId) {
      setPhotos([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = {
        page: 1,
        pageSize: 200,
        rating: minRating > 0 ? minRating : undefined,
        status: statusFilter,
        source_type: sourceType,
        keyword: search.trim() || undefined
      };
      const res = trashMode
        ? await fetchEventTrashedImages(selectedEventId, params)
        : await fetchEventImages(selectedEventId, params);
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
  }, [minRating, search, selectedEventId, sourceType, statusFilter, trashMode]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const replacePhoto = (updated: EventImageData) => {
    setPhotos((current) => current.map((photo) => (photo.id === updated.id ? updated : photo)));
  };

  const removePhotoFromView = useCallback((imageId: string) => {
    setPhotos((current) => {
      if (!current.some((photo) => photo.id === imageId)) return current;
      setTotal((value) => Math.max(0, value - 1));
      return current.filter((photo) => photo.id !== imageId);
    });
    setSelectedIds((current) => current.filter((id) => id !== imageId));
    setActivePhotoId((current) => current === imageId ? null : current);
    setPreviewPhotoId((current) => current === imageId ? null : current);
  }, []);

  const handleRealtimeCreated = useCallback((payload: RealtimeImagePayload) => {
    if (payload.eventId !== selectedEventId || !payload.image) return;
    const image = payload.image;

    if (!matchesCurrentFilters(image)) {
      setMessage({ tone: "info", title: "收到新图片", body: "当前筛选条件未显示这张新图片，可清空筛选后查看。" });
      return;
    }

    setPhotos((current) => {
      if (current.some((photo) => photo.id === image.id)) {
        return current.map((photo) => photo.id === image.id ? image : photo);
      }
      setTotal((value) => value + 1);
      return [image, ...current].slice(0, 200);
    });
    setMessage({ tone: "info", title: "收到新图片", body: "实时同步已将新图片加入当前图片墙。" });
  }, [matchesCurrentFilters, selectedEventId]);

  const handleRealtimeUpdated = useCallback((payload: RealtimeImagePayload) => {
    if (payload.eventId !== selectedEventId || !payload.image) return;
    const image = payload.image;

    if (trashMode && !image.is_deleted) {
      removePhotoFromView(image.id);
      return;
    }

    setPhotos((current) => {
      const exists = current.some((photo) => photo.id === image.id);
      if (!exists) return current;

      if (!matchesCurrentFilters(image)) {
        setTotal((value) => Math.max(0, value - 1));
        setSelectedIds((ids) => ids.filter((id) => id !== image.id));
        setActivePhotoId((id) => id === image.id ? null : id);
        setPreviewPhotoId((id) => id === image.id ? null : id);
        return current.filter((photo) => photo.id !== image.id);
      }

      return current.map((photo) => photo.id === image.id ? image : photo);
    });
  }, [matchesCurrentFilters, removePhotoFromView, selectedEventId, trashMode]);

  const handleRealtimeDeleted = useCallback((payload: RealtimeImagePayload) => {
    if (payload.eventId !== selectedEventId) return;
    if (trashMode) {
      void loadImages();
      return;
    }
    removePhotoFromView(payload.imageId);
  }, [loadImages, removePhotoFromView, selectedEventId, trashMode]);

  useEffect(() => {
    const unsubscribeConnection = subscribeRealtimeConnection(setRealtimeStatus);
    const unsubscribeCreated = subscribeRealtimeImageEvent("image-created", handleRealtimeCreated);
    const unsubscribeUpdated = subscribeRealtimeImageEvent("image-updated", handleRealtimeUpdated);
    const unsubscribeDeleted = subscribeRealtimeImageEvent("image-deleted-logical", handleRealtimeDeleted);

    return () => {
      unsubscribeConnection();
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
    };
  }, [handleRealtimeCreated, handleRealtimeDeleted, handleRealtimeUpdated]);

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

  const handleDownloadImage = async (id: string, type: ImageDownloadType) => {
    const photo = photos.find((item) => item.id === id);
    const fallbackFilename = photo?.original_filename || "image";

    try {
      await downloadImageFile(id, type, fallbackFilename);
      setMessage({ tone: "success", title: "下载已开始", body: "图片文件已开始下载。" });
    } catch (err: any) {
      const message = err?.message || "图片下载失败。";
      setMessage({ tone: "danger", title: "下载失败", body: message });
      throw err;
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`确定从图片墙删除选中的 ${selectedIds.length} 张图片？\n\n这只会把图片标记为已删除，不会删除仓库里的原图、缩略图或预览图。`);
    if (!confirmed) return;

    const ids = [...selectedIds];
    let success = 0;
    const failed: string[] = [];

    for (const id of ids) {
      try {
        const res = await deleteImage(id);
        if (res.ok) {
          success += 1;
        } else {
          failed.push(res.error?.message || id);
        }
      } catch (err: any) {
        failed.push(err?.message || id);
      }
    }

    setSelectedIds([]);
    setActivePhotoId((current) => current && ids.includes(current) ? null : current);
    setPreviewPhotoId((current) => current && ids.includes(current) ? null : current);
    await loadImages();

    if (failed.length > 0) {
      setMessage({ tone: "danger", title: "部分图片删除失败", body: `已删除 ${success} 张，失败 ${failed.length} 张。${failed[0] || ""}` });
    } else {
      setMessage({ tone: "success", title: "图片已删除", body: `已从图片墙移除 ${success} 张图片，仓库文件未被删除。` });
    }
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`确定恢复选中的 ${selectedIds.length} 张图片？`);
    if (!confirmed) return;

    const ids = [...selectedIds];
    let success = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const res = await restoreImage(id);
        if (res.ok) {
          success += 1;
        } else {
          failed.push(res.error?.message || id);
        }
      } catch (err: any) {
        failed.push(err?.message || id);
      }
    }

    setSelectedIds([]);
    setActivePhotoId(null);
    setPreviewPhotoId(null);
    await loadImages();
    setMessage(failed.length > 0
      ? { tone: "warning", title: "部分图片恢复失败", body: `已恢复 ${success} 张，失败 ${failed.length} 张。${failed[0] || ""}` }
      : { tone: "success", title: "图片已恢复", body: `已恢复 ${success} 张图片，返回图片墙后可查看。` });
  };

  const handlePurgeSelected = async () => {
    if (selectedIds.length === 0) return;
    const targets = photos.filter((photo) => selectedIds.includes(photo.id));
    const pathLines = targets.flatMap((photo) => [
      photo.original_path,
      photo.thumb_path,
      photo.preview_path,
      photo.edited_path
    ].filter(Boolean).map((filePath) => `${photo.original_filename}: ${filePath}`));
    const preview = pathLines.slice(0, 12).join("\n");
    const more = pathLines.length > 12 ? `\n... 还有 ${pathLines.length - 12} 个路径` : "";
    const confirmed = window.confirm(
      `永久删除选中的 ${targets.length} 张图片？\n\n将尝试删除以下文件：\n${preview || "无文件路径"}${more}\n\n此操作会删除图片数据库记录，不能撤销。`
    );
    if (!confirmed) return;

    const ids = [...selectedIds];
    let success = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const res = await purgeImage(id);
        if (res.ok) {
          success += 1;
          if (res.data?.errors?.length) {
            failed.push(res.data.errors[0]);
          }
        } else {
          failed.push(res.error?.message || id);
        }
      } catch (err: any) {
        failed.push(err?.message || id);
      }
    }

    setSelectedIds([]);
    setActivePhotoId(null);
    setPreviewPhotoId(null);
    await loadImages();
    setMessage(failed.length > 0
      ? { tone: "danger", title: "部分图片永久删除失败", body: `已删除 ${success} 张，失败 ${failed.length} 张。${failed[0] || ""}` }
      : { tone: "success", title: "图片已永久删除", body: `已永久删除 ${success} 张图片。` });
  };

  const handleDownloadSelectedZip = async () => {
    if (!selectedEventId || selectedIds.length === 0) return;
    try {
      const res = await createDownloadZipTask(selectedEventId, {
        imageIds: selectedIds,
        type: "best",
        filenameMode: "sequence"
      });
      if (!res.ok) {
        setMessage({ tone: "danger", title: "批量下载任务创建失败", body: res.error?.message || "无法创建批量下载任务。" });
        return;
      }
      setMessage({
        tone: "info",
        title: "批量下载任务已创建",
        body: "ZIP 正在生成，完成后可在右上角任务中心下载。"
      });
    } catch (err: any) {
      setMessage({ tone: "danger", title: "批量下载任务创建失败", body: err?.message || "请求失败。" });
    }
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
  const emptyBody = trashMode
    ? "图片回收站为空。逻辑删除后的图片会显示在这里。"
    : selectedEventId && total === 0 && !search && minRating === 0 && statusFilter === "all"
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
          allowDelete={mode === "host"}
          onDeleteSelected={handleDeleteSelected}
          onPurgeSelected={handlePurgeSelected}
          onDownloadSelectedZip={handleDownloadSelectedZip}
          onRestoreSelected={handleRestoreSelected}
          onSearchChange={setSearch}
          onSelectAll={selectAllFiltered}
          realtimeStatus={realtimeStatus}
          trashMode={trashMode}
          onToggleTrashMode={mode === "host" ? () => {
            setTrashMode((value) => !value);
            setSelectedIds([]);
            setActivePhotoId(null);
            setPreviewPhotoId(null);
          } : undefined}
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
              onDownloadOriginal={(id) => handleDownloadImage(id, "original")}
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
          onDownload={handleDownloadImage}
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
