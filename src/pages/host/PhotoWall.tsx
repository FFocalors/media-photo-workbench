import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterSidebar } from "../../components/gallery/FilterSidebar";
import { GalleryToolbar } from "../../components/gallery/GalleryToolbar";
import { MetadataPanel } from "../../components/gallery/MetadataPanel";
import { PhotoGrid } from "../../components/gallery/PhotoGrid";
import { PreviewModal } from "../../components/gallery/PreviewModal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { TransientNotice } from "../../components/ui/States";
import {
  EventData,
  EventImageData,
  EventUploaderData,
  ClientPresenceData,
  BatchSelectionBehavior,
  createDownloadZipTask,
  deleteImage,
  downloadImageFile,
  fetchEventImages,
  fetchEvents,
  fetchEventUploaders,
  fetchOnlineClients,
  fetchSettings,
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
  subscribeClientsUpdated,
  subscribeRealtimeConnection,
  subscribeRealtimeImageEvent
} from "../../lib/socket";
import type { RealtimeConnectionState, RealtimeImagePayload } from "../../lib/socket";

const GALLERY_PAGE_SIZE = 200;
type RatingFilterValue = number | "all";
type RatingMode = "eq" | "gte";
type PhotoWallMessage = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
};

function withCacheKey(url: string, key: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set("v", key);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(key)}`;
  }
}

function withImageCacheKey(image: EventImageData, key: string): EventImageData {
  return {
    ...image,
    thumb_url: withCacheKey(image.thumb_url, key),
    preview_url: withCacheKey(image.preview_url, key)
  };
}

export function PhotoWallPage({ mode = "host" }: { mode?: "host" | "client" }) {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [photos, setPhotos] = useState<EventImageData[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<EventImageData[]>([]);
  const [search, setSearch] = useState("");
  const [ratingValue, setRatingValue] = useState<RatingFilterValue>("all");
  const [ratingMode, setRatingMode] = useState<RatingMode>("gte");
  const [statusFilter, setStatusFilter] = useState<ImageStatus | "all">("all");
  const [sourceType, setSourceType] = useState("all");
  const [uploadedByClientId, setUploadedByClientId] = useState("all");
  const [uploaders, setUploaders] = useState<EventUploaderData[]>([]);
  const [batchSelectionBehavior, setBatchSelectionBehavior] = useState<BatchSelectionBehavior>("clear");
  const [onlineClients, setOnlineClients] = useState<ClientPresenceData[]>([]);
  const [trashMode, setTrashMode] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false);
  const [batchCategoryDraft, setBatchCategoryDraft] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionState>("disconnected");
  const [statusCounts, setStatusCounts] = useState<Record<ImageStatus, number>>({
    unselected: 0,
    rejected: 0,
    archive: 0,
    edit: 0,
    edited: 0,
    publish: 0,
    published: 0
  });
  const [confirmAction, setConfirmAction] = useState<"delete" | "restore" | "purge" | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [message, setMessage] = useState<PhotoWallMessage | null>(null);

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const previewPhotos = useMemo(() => {
    if (!previewPhotoId) return [];
    return previewSnapshot.map((snapshotPhoto) => photos.find((photo) => photo.id === snapshotPhoto.id) ?? snapshotPhoto);
  }, [photos, previewPhotoId, previewSnapshot]);
  const previewPhoto = previewPhotoId
    ? previewPhotos.find((photo) => photo.id === previewPhotoId) ?? photos.find((photo) => photo.id === previewPhotoId) ?? previewSnapshot.find((photo) => photo.id === previewPhotoId) ?? null
    : null;
  const hasMorePhotos = photos.length < total;

  const matchesCurrentFilters = useCallback((photo: EventImageData) => {
    if (ratingValue !== "all") {
      if (ratingMode === "eq" && photo.rating !== ratingValue) return false;
      if (ratingMode === "gte" && photo.rating < ratingValue) return false;
    }
    if (statusFilter !== "all" && photo.status !== statusFilter) return false;
    if (sourceType !== "all" && photo.source_type !== sourceType) return false;
    if (uploadedByClientId !== "all") {
      if (uploadedByClientId === "host" && photo.source_type !== "host_import") return false;
      if (uploadedByClientId === "camera_ftp" && photo.source_type !== "camera_ftp") return false;
      if (uploadedByClientId !== "host" && photo.uploaded_by_client_id !== uploadedByClientId) return false;
    }

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
  }, [ratingMode, ratingValue, search, sourceType, statusFilter, uploadedByClientId]);

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

  const buildImageQueryParams = useCallback((targetPage: number, status?: ImageStatus | "all", pageSize = GALLERY_PAGE_SIZE) => ({
    page: targetPage,
    pageSize,
    rating: ratingValue === "all" ? undefined : ratingValue,
    ratingMode: ratingValue === "all" ? undefined : ratingMode,
    status: status ?? statusFilter,
    source_type: sourceType,
    uploadedByClientId,
    keyword: search.trim() || undefined
  }), [ratingMode, ratingValue, search, sourceType, statusFilter, uploadedByClientId]);

  const fetchImagesForPage = useCallback((targetPage: number, status?: ImageStatus | "all", pageSize?: number) => {
    const params = buildImageQueryParams(targetPage, status, pageSize);
    return trashMode
      ? fetchEventTrashedImages(selectedEventId, params)
      : fetchEventImages(selectedEventId, params);
  }, [buildImageQueryParams, selectedEventId, trashMode]);

  const loadImages = useCallback(async () => {
    if (!selectedEventId) {
      setPhotos([]);
      setTotal(0);
      setPage(1);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchImagesForPage(1);
      if (res.ok && res.data) {
        setPhotos(res.data.items);
        setTotal(res.data.total);
        setPage(1);
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
  }, [fetchImagesForPage, selectedEventId]);

  const loadStatusCounts = useCallback(async () => {
    if (!selectedEventId) {
      setStatusCounts({
        unselected: 0,
        rejected: 0,
        archive: 0,
        edit: 0,
        edited: 0,
        publish: 0,
        published: 0
      });
      return;
    }

    try {
      const entries = await Promise.all(imageStatusOptions.map(async (status) => {
        const res = await fetchImagesForPage(1, status, 1);
        return [status, res.ok && res.data ? res.data.total : 0] as const;
      }));
      setStatusCounts(Object.fromEntries(entries) as Record<ImageStatus, number>);
    } catch {
      // The gallery list itself owns the visible error state; counts can fail independently.
    }
  }, [fetchImagesForPage, selectedEventId]);

  const loadUploaders = useCallback(async () => {
    if (!selectedEventId) {
      setUploaders([]);
      return;
    }

    try {
      const res = await fetchEventUploaders(selectedEventId);
      if (res.ok && res.data) {
        setUploaders(res.data);
      }
    } catch {
      setUploaders([]);
    }
  }, [selectedEventId]);

  const loadMoreImages = useCallback(async () => {
    if (!selectedEventId || loading || loadingMore || !hasMorePhotos) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchImagesForPage(nextPage);
      if (res.ok && res.data) {
        setPhotos((current) => {
          const existingIds = new Set(current.map((photo) => photo.id));
          const nextItems = res.data.items.filter((photo) => !existingIds.has(photo.id));
          return [...current, ...nextItems];
        });
        setTotal(res.data.total);
        setPage(nextPage);
      } else {
        setMessage({ tone: "danger", title: "加载更多失败", body: res.error?.message || "无法读取下一页图片。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "加载更多失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setLoadingMore(false);
    }
  }, [fetchImagesForPage, hasMorePhotos, loading, loadingMore, page, selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    let cancelled = false;

    async function loadGallerySettings() {
      try {
        const settingsRes = await fetchSettings();
        if (cancelled) return;
        if (settingsRes.ok && settingsRes.data?.gallery) {
          setBatchSelectionBehavior(settingsRes.data.gallery.batchSelectionBehavior || "clear");
        }
      } catch {
        if (!cancelled) {
          setBatchSelectionBehavior("clear");
        }
      }
    }

    void loadGallerySettings();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    loadStatusCounts();
  }, [loadStatusCounts]);

  useEffect(() => {
    void loadUploaders();
  }, [loadUploaders]);

  useEffect(() => {
    if (!activePhotoId) {
      setMetadataPanelOpen(false);
    }
  }, [activePhotoId]);

  const replacePhoto = (updated: EventImageData) => {
    setPhotos((current) => current.map((photo) => (photo.id === updated.id ? updated : photo)));
    setPreviewSnapshot((current) => current.map((photo) => (photo.id === updated.id ? updated : photo)));
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
    setPreviewSnapshot((current) => current.filter((photo) => photo.id !== imageId));
  }, []);

  const openPreview = useCallback((imageId: string) => {
    setActivePhotoId(imageId);
    setPreviewSnapshot(photos);
    setPreviewPhotoId(imageId);
  }, [photos]);

  const closePreview = useCallback(() => {
    setPreviewPhotoId(null);
    setPreviewSnapshot([]);
    void loadImages();
  }, [loadImages]);

  const handleRealtimeCreated = useCallback((payload: RealtimeImagePayload) => {
    if (payload.eventId !== selectedEventId || !payload.image) return;
    const image = withImageCacheKey(payload.image, payload.updatedAt || String(Date.now()));

    if (!matchesCurrentFilters(image)) {
      setMessage({ tone: "info", title: "收到新图片", body: "当前筛选条件未显示这张新图片，可清空筛选后查看。" });
      return;
    }

    setPhotos((current) => {
      if (current.some((photo) => photo.id === image.id)) {
        return current.map((photo) => photo.id === image.id ? image : photo);
      }
      setTotal((value) => value + 1);
      return [image, ...current];
    });
    void loadUploaders();
    setMessage({ tone: "info", title: "收到新图片", body: "实时同步已将新图片加入当前图片墙。" });
  }, [loadUploaders, matchesCurrentFilters, selectedEventId]);

  const handleRealtimeUpdated = useCallback((payload: RealtimeImagePayload) => {
    if (payload.eventId !== selectedEventId || !payload.image) return;
    const image = withImageCacheKey(payload.image, payload.updatedAt || String(Date.now()));

    setPreviewSnapshot((current) => current.map((photo) => (photo.id === image.id ? image : photo)));

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
    const unsubscribeClients = subscribeClientsUpdated((payload) => {
      setOnlineClients(payload.clients);
    });

    fetchOnlineClients()
      .then((res) => {
        if (res.ok && res.data) setOnlineClients(res.data.clients);
      })
      .catch(() => {
        // Socket.IO updates will keep this fresh when the request is unavailable.
      });

    return () => {
      unsubscribeConnection();
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeClients();
    };
  }, [handleRealtimeCreated, handleRealtimeDeleted, handleRealtimeUpdated]);

  const runImageUpdate = async (operation: () => Promise<{ ok: boolean; data: EventImageData; error: { message: string } | null }>, successTitle: string) => {
    try {
      const res = await operation();
      if (res.ok && res.data) {
        replacePhoto(withImageCacheKey(res.data, String(Date.now())));
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

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    setConfirmAction("delete");
  };

  const getSelectionAfterBatch = useCallback((ids: string[], failedIds: string[]) => {
    return batchSelectionBehavior === "keep" ? ids : failedIds;
  }, [batchSelectionBehavior]);

  const executeDeleteSelected = async () => {
    const ids = [...selectedIds];
    let success = 0;
    const failedMessages: string[] = [];
    const failedIds: string[] = [];

    for (const id of ids) {
      try {
        const res = await deleteImage(id);
        if (res.ok) {
          success += 1;
        } else {
          failedIds.push(id);
          failedMessages.push(res.error?.message || id);
        }
      } catch (err: any) {
        failedIds.push(id);
        failedMessages.push(err?.message || id);
      }
    }

    setSelectedIds(getSelectionAfterBatch(ids, failedIds));
    setActivePhotoId((current) => current && ids.includes(current) ? null : current);
    setPreviewPhotoId((current) => current && ids.includes(current) ? null : current);
    setPreviewSnapshot((current) => current.filter((photo) => !ids.includes(photo.id)));
    await loadImages();

    if (failedMessages.length > 0) {
      setMessage({ tone: "danger", title: "部分图片删除失败", body: `已删除 ${success} 张，失败 ${failedMessages.length} 张。${failedMessages[0] || ""}` });
    } else {
      setMessage({ tone: "success", title: "图片已删除", body: `已从图片墙移除 ${success} 张图片，仓库文件未被删除。` });
    }
    setConfirmAction(null);
  };

  const handleRestoreSelected = () => {
    if (selectedIds.length === 0) return;
    setConfirmAction("restore");
  };

  const executeRestoreSelected = async () => {
    const ids = [...selectedIds];
    let success = 0;
    const failedMessages: string[] = [];
    const failedIds: string[] = [];
    for (const id of ids) {
      try {
        const res = await restoreImage(id);
        if (res.ok) {
          success += 1;
        } else {
          failedIds.push(id);
          failedMessages.push(res.error?.message || id);
        }
      } catch (err: any) {
        failedIds.push(id);
        failedMessages.push(err?.message || id);
      }
    }

    setSelectedIds(getSelectionAfterBatch(ids, failedIds));
    setActivePhotoId(null);
    setPreviewPhotoId(null);
    setPreviewSnapshot([]);
    await loadImages();
    setMessage(failedMessages.length > 0
      ? { tone: "warning", title: "部分图片恢复失败", body: `已恢复 ${success} 张，失败 ${failedMessages.length} 张。${failedMessages[0] || ""}` }
      : { tone: "success", title: "图片已恢复", body: `已恢复 ${success} 张图片，返回图片墙后可查看。` });
    setConfirmAction(null);
  };

  const handlePurgeSelected = () => {
    if (selectedIds.length === 0) return;
    setConfirmAction("purge");
  };

  const executePurgeSelected = async () => {
    const ids = [...selectedIds];
    let success = 0;
    const failedMessages: string[] = [];
    const failedIds: string[] = [];
    for (const id of ids) {
      try {
        const res = await purgeImage(id);
        if (res.ok) {
          success += 1;
          if (res.data?.errors?.length) {
            failedIds.push(id);
            failedMessages.push(res.data.errors[0]);
          }
        } else {
          failedIds.push(id);
          failedMessages.push(res.error?.message || id);
        }
      } catch (err: any) {
        failedIds.push(id);
        failedMessages.push(err?.message || id);
      }
    }

    setSelectedIds(getSelectionAfterBatch(ids, failedIds));
    setActivePhotoId(null);
    setPreviewPhotoId(null);
    setPreviewSnapshot([]);
    await loadImages();
    setMessage(failedMessages.length > 0
      ? { tone: "danger", title: "部分图片永久删除失败", body: `已删除 ${success} 张，失败 ${failedMessages.length} 张。${failedMessages[0] || ""}` }
      : { tone: "success", title: "图片已永久删除", body: `已永久删除 ${success} 张图片。` });
    setConfirmAction(null);
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
    if (selectedIds.length === 0 || batchUpdating) return;
    const ids = [...selectedIds];
    setBatchUpdating(true);
    try {
      const results = await Promise.allSettled(ids.map(async (id) => {
        const res = await updateImageStatus(id, status);
        if (!res.ok || !res.data) {
          throw new Error(`${id}|${res.error?.message || "更新失败"}`);
        }
        return res.data;
      }));

      const successImages = results
        .filter((result): result is PromiseFulfilledResult<EventImageData> => result.status === "fulfilled")
        .map((result) => result.value);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason?.message || "图片更新失败");
      const failedIds = failures
        .map((message) => message.split("|")[0])
        .filter((id) => ids.includes(id));
      const failureMessages = failures.map((message) => message.includes("|") ? message.split("|").slice(1).join("|") : message);

      successImages.forEach((image) => replacePhoto(withImageCacheKey(image, String(Date.now()))));
      setSelectedIds(getSelectionAfterBatch(ids, failedIds));
      await loadImages();
      await loadStatusCounts();

      setMessage(failureMessages.length > 0
        ? { tone: "warning", title: "批量状态部分完成", body: `成功 ${successImages.length} 张，失败 ${failureMessages.length} 张。${failureMessages[0] || ""}` }
        : { tone: "success", title: "批量状态已更新", body: `已更新 ${successImages.length} 张图片。` });
    } finally {
      setBatchUpdating(false);
    }
  };

  const openBatchCategoryDialog = () => {
    if (selectedIds.length === 0 || batchUpdating) return;
    setBatchCategoryDraft(activePhoto?.category || "");
    setBatchCategoryOpen(true);
  };

  const batchCategory = async () => {
    if (selectedIds.length === 0 || batchUpdating) return;
    const ids = [...selectedIds];
    const category = batchCategoryDraft.trim();
    setBatchUpdating(true);
    try {
      const results = await Promise.allSettled(ids.map(async (id) => {
        const res = await updateImageCategory(id, category);
        if (!res.ok || !res.data) {
          throw new Error(`${id}|${res.error?.message || "更新失败"}`);
        }
        return res.data;
      }));

      const successImages = results
        .filter((result): result is PromiseFulfilledResult<EventImageData> => result.status === "fulfilled")
        .map((result) => result.value);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason?.message || "图片分类更新失败");
      const failedIds = failures
        .map((message) => message.split("|")[0])
        .filter((id) => ids.includes(id));
      const failureMessages = failures.map((message) => message.includes("|") ? message.split("|").slice(1).join("|") : message);

      successImages.forEach((image) => replacePhoto(withImageCacheKey(image, String(Date.now()))));
      setSelectedIds(getSelectionAfterBatch(ids, failedIds));
      await loadImages();
      setBatchCategoryOpen(false);

      setMessage(failureMessages.length > 0
        ? { tone: "warning", title: "批量分类部分完成", body: `成功 ${successImages.length} 张，失败 ${failureMessages.length} 张。${failureMessages[0] || ""}` }
        : { tone: "success", title: "批量分类已更新", body: category ? `已将 ${successImages.length} 张图片分类为“${category}”。` : `已清空 ${successImages.length} 张图片的分类。` });
    } finally {
      setBatchUpdating(false);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setRatingValue("all");
    setRatingMode("gte");
    setStatusFilter("all");
    setSourceType("all");
    setUploadedByClientId("all");
  };

  const movePreview = useCallback((direction: 1 | -1) => {
    const currentId = previewPhotoId ?? activePhotoId;
    const source = previewPhotos.length > 0 ? previewPhotos : photos;
    const index = source.findIndex((photo) => photo.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + source.length) % source.length;
    const next = source[nextIndex];
    if (next) {
      setActivePhotoId(next.id);
      setPreviewPhotoId(next.id);
    }
  }, [activePhotoId, photos, previewPhotoId, previewPhotos]);

  useEffect(() => {
    if (!previewPhotoId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (editing && event.key !== "Escape") return;

      if (event.key === "Escape") {
        closePreview();
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
  }, [closePreview, movePreview, previewPhoto, previewPhotoId]);

  const noActiveFilters = !search && ratingValue === "all" && statusFilter === "all" && sourceType === "all" && uploadedByClientId === "all";
  const emptyTitle = selectedEventId && total === 0 && noActiveFilters ? "暂无图片" : "当前筛选没有图片";
  const emptyBody = trashMode
    ? "图片回收站为空。逻辑删除后的图片会显示在这里。"
    : selectedEventId && total === 0 && noActiveFilters
    ? "暂无图片，请先导入图片。"
    : "当前筛选条件下没有可显示的图片。可以清空筛选、降低星级条件，或切换到全部状态。";
  const selectedPhotos = photos.filter((photo) => selectedIds.includes(photo.id));
  const purgePathLines = selectedPhotos.flatMap((photo) => [
    photo.original_path,
    photo.thumb_path,
    photo.preview_path,
    photo.edited_path
  ].filter(Boolean).map((filePath) => `${photo.original_filename}: ${filePath}`));

  const filterSidebarProps = {
    events,
    ratingMode,
    ratingValue,
    search,
    selectedEventId,
    sourceType,
    statusCounts,
    statusFilter,
    uploadedByClientId,
    uploaders,
    onEventChange: (eventId: string) => {
      setSelectedEventId(eventId);
      setSelectedIds([]);
      setActivePhotoId(null);
      setPreviewPhotoId(null);
      setPreviewSnapshot([]);
      setFilterPanelOpen(false);
    },
    onRatingModeChange: setRatingMode,
    onRatingValueChange: (value: RatingFilterValue) => {
      setRatingValue(value);
      if (value === 0) setRatingMode("eq");
    },
    onReset: resetFilters,
    onSearchChange: setSearch,
    onUploadSourceChange: (nextSourceType: string, nextUploadedByClientId: string) => {
      setSourceType(nextSourceType);
      setUploadedByClientId(nextUploadedByClientId);
    },
    onStatusChange: setStatusFilter
  };

  const metadataPanelProps = {
    photo: activePhoto,
    selectedCount: selectedIds.length,
    onCategoryChange: (category: string) => {
      if (activePhoto) handleCategoryChange(activePhoto.id, category);
    },
    onClearActive: () => setActivePhotoId(null),
    onOpenPreview: () => {
      if (activePhoto) openPreview(activePhoto.id);
    },
    onRatingChange: (rating: number) => {
      if (activePhoto) handleRatingChange(activePhoto.id, rating);
    },
    onRemarkChange: (remark: string) => {
      if (activePhoto) handleRemarkChange(activePhoto.id, remark);
    },
    onStatusChange: (status: ImageStatus) => {
      if (activePhoto) handleStatusChange(activePhoto.id, status);
    }
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden bg-[#F8F9FA]">
      <FilterSidebar {...filterSidebarProps} className="hidden xl:flex" />
      {filterPanelOpen && (
        <>
          <button
            aria-label="关闭筛选"
            className="absolute inset-0 z-30 bg-slate-900/20 xl:hidden"
            onClick={() => setFilterPanelOpen(false)}
            type="button"
          />
          <FilterSidebar
            {...filterSidebarProps}
            className="absolute inset-y-0 left-0 z-40 flex w-72 shadow-xl xl:hidden"
            showClose
            onClose={() => setFilterPanelOpen(false)}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <GalleryToolbar
          filteredCount={photos.length}
          search={search}
          selectedCount={selectedIds.length}
          onBatchStatus={batchStatus}
          onOpenBatchCategory={openBatchCategoryDialog}
          batchBusy={batchUpdating}
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
          filtersOpen={filterPanelOpen}
          hasMetadata={Boolean(activePhoto)}
          metadataOpen={metadataPanelOpen}
          onToggleFilters={() => setFilterPanelOpen((open) => !open)}
          onToggleMetadata={() => setMetadataPanelOpen((open) => !open)}
          onOpenShortcuts={() => setShortcutHelpOpen(true)}
          onToggleTrashMode={mode === "host" ? () => {
            setTrashMode((value) => !value);
            setSelectedIds([]);
            setActivePhotoId(null);
            setPreviewPhotoId(null);
            setPreviewSnapshot([]);
          } : undefined}
          onlineClientCount={mode === "host" ? onlineClients.length : undefined}
        />

        <TransientNotice
          className="shrink-0 px-4 pt-4"
          message={message}
          onDismiss={() => setMessage(null)}
        />

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
              onOpenPreview={openPreview}
              onToggleSelected={toggleSelected}
            />
          )}
          {!loading && hasMorePhotos && (
            <div className="flex justify-center py-5">
              <button
                className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loadingMore}
                onClick={loadMoreImages}
                type="button"
              >
                {loadingMore ? "正在加载..." : `加载更多（已加载 ${photos.length.toLocaleString()} / ${total.toLocaleString()} 张）`}
              </button>
            </div>
          )}
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-slate-100 bg-white px-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>已选择 {selectedIds.length} 张</span>
            <span>已加载 {photos.length.toLocaleString()} 张</span>
          </div>
          <div className="flex items-center gap-3">
            {hasMorePhotos && (
              <button
                className="font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-300"
                disabled={loadingMore}
                onClick={loadMoreImages}
                type="button"
              >
                {loadingMore ? "加载中..." : "加载更多"}
              </button>
            )}
            <span>共 {total.toLocaleString()} 张</span>
          </div>
        </div>
      </div>

      <MetadataPanel {...metadataPanelProps} className="hidden 2xl:flex" />
      {metadataPanelOpen && (
        <>
          <button
            aria-label="关闭元数据"
            className="absolute inset-0 z-30 bg-slate-900/20 2xl:hidden"
            onClick={() => setMetadataPanelOpen(false)}
            type="button"
          />
          <MetadataPanel
            {...metadataPanelProps}
            className="absolute inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] shadow-xl 2xl:hidden"
            onClosePanel={() => setMetadataPanelOpen(false)}
          />
        </>
      )}

      {previewPhoto && (
        <PreviewModal
          photo={previewPhoto}
          photos={previewPhotos}
          onCategoryChange={handleCategoryChange}
          onClose={closePreview}
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
          onOpenShortcuts={() => setShortcutHelpOpen(true)}
        />
      )}

      {shortcutHelpOpen && (
        <ShortcutHelpDialog onClose={() => setShortcutHelpOpen(false)} />
      )}

      {batchCategoryOpen && (
        <ConfirmDialog
          confirmLabel="应用分类"
          confirming={batchUpdating}
          description="将同一个分类写入当前选中的所有图片。留空可以清空所选图片分类。"
          details={[{ label: "图片数量", value: `${selectedIds.length} 张` }]}
          onCancel={() => {
            if (!batchUpdating) setBatchCategoryOpen(false);
          }}
          onConfirm={() => { void batchCategory(); }}
          title="批量设置分类"
          tone="info"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">分类名称</span>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              maxLength={80}
              onChange={(event) => setBatchCategoryDraft(event.target.value)}
              placeholder="例如：领导特写 / 舞台 / 合影"
              value={batchCategoryDraft}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">分类为空时会清空所选图片的分类字段。</p>
          </label>
        </ConfirmDialog>
      )}

      {confirmAction === "delete" && (
        <ConfirmDialog
          confirmLabel="删除图片"
          description="这只会把图片标记为已删除，不会删除仓库里的原图、缩略图或预览图。"
          details={[{ label: "图片数量", value: `${selectedIds.length} 张` }]}
          onCancel={() => setConfirmAction(null)}
          onConfirm={executeDeleteSelected}
          title="删除所选图片"
          tone="warning"
        />
      )}

      {confirmAction === "restore" && (
        <ConfirmDialog
          confirmLabel="恢复图片"
          description="恢复后图片会重新出现在当前活动的图片墙中。"
          details={[{ label: "图片数量", value: `${selectedIds.length} 张` }]}
          onCancel={() => setConfirmAction(null)}
          onConfirm={executeRestoreSelected}
          title="恢复所选图片"
          tone="success"
        />
      )}

      {confirmAction === "purge" && (
        <ConfirmDialog
          confirmLabel="永久删除"
          description="此操作会删除图片数据库记录，并尝试删除下方关联文件，不能撤销。"
          details={[{ label: "图片数量", value: `${selectedPhotos.length} 张` }]}
          onCancel={() => setConfirmAction(null)}
          onConfirm={executePurgeSelected}
          title="永久删除所选图片"
          tone="danger"
        >
          <div className="max-h-44 overflow-y-auto rounded-xl border border-red-100 bg-red-50 p-3 text-xs leading-5 text-red-700">
            {purgePathLines.length === 0 ? (
              <p>无文件路径</p>
            ) : (
              purgePathLines.slice(0, 24).map((line, index) => (
                <p className="break-all" key={`${line}-${index}`}>{line}</p>
              ))
            )}
            {purgePathLines.length > 24 && <p className="mt-2 text-red-500">还有 {purgePathLines.length - 24} 个路径未显示。</p>}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ShortcutHelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const shortcuts = [
    ["1-5", "预览弹窗中设置当前图片星级"],
    ["0", "预览弹窗中清除当前图片星级"],
    ["X", "预览弹窗中标记当前图片为废片"],
    ["E", "预览弹窗中标记当前图片为待修图"],
    ["P", "预览弹窗中标记当前图片为可发布"],
    ["← / →", "预览弹窗中切换上一张 / 下一张"],
    ["Esc", "关闭预览或关闭快捷键提示"]
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">图片墙快捷键</h2>
            <p className="mt-1 text-xs text-slate-500">以下快捷键在预览弹窗打开时生效。</p>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>
        <div className="grid gap-2">
          {shortcuts.map(([keyName, description]) => (
            <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3" key={keyName}>
              <span className="text-sm text-slate-700">{description}</span>
              <kbd className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">{keyName}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
