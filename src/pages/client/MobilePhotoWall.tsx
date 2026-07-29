import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileFilterSheet, EMPTY_FILTER, type MobileFilterDraft, type RatingFilterValue, type RatingMode } from "../../components/mobile/MobileFilterSheet";
import { MobileDownloadSheet } from "../../components/mobile/MobileDownloadSheet";
import { MobileMetadataSheet } from "../../components/mobile/MobileMetadataSheet";
import { MobilePhotoGrid } from "../../components/mobile/MobilePhotoGrid";
import { MobilePreview } from "../../components/mobile/MobilePreview";
import { MobileRatingStars } from "../../components/mobile/MobileRatingStars";
import { BottomSheet } from "../../components/mobile/BottomSheet";
import { TransientNotice } from "../../components/ui/States";
import { useCurrentPageEventStore } from "../../stores/currentPageEventStore";
import {
  EventData,
  EventImageData,
  EventUploaderData,
  ImageStatus,
  imageStatusLabels,
  fetchEventImages,
  fetchEvents,
  fetchEventUploaders,
  imageStatusOptions,
  updateImageRating,
  updateImageRemark,
  updateImageStatus
} from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  subscribeRealtimeConnection,
  subscribeRealtimeImageEvent
} from "../../lib/socket";
import type { RealtimeConnectionState, RealtimeImagePayload } from "../../lib/socket";
import { getImageWorkflowStatusSemantic } from "../../lib/statusSemantics";

const PAGE_SIZE = 60;

type QueryFilters = {
  search: string;
  ratingValue: RatingFilterValue;
  ratingMode: RatingMode;
  statusFilter: ImageStatus | "all";
  sourceType: string;
  uploadedByClientId: string;
};

type WallMessage = { tone: "success" | "warning" | "danger" | "info"; title: string; body: string };

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

/** Pure client-side filter match, used only to reconcile realtime events. */
function matchesFilters(photo: EventImageData, f: QueryFilters): boolean {
  if (f.ratingValue !== "all") {
    if (f.ratingMode === "eq" && photo.rating !== f.ratingValue) return false;
    if (f.ratingMode === "gte" && photo.rating < f.ratingValue) return false;
  }
  if (f.statusFilter !== "all" && photo.status !== f.statusFilter) return false;
  if (f.sourceType !== "all" && photo.source_type !== f.sourceType) return false;
  if (f.uploadedByClientId !== "all") {
    if (f.uploadedByClientId === "host" && photo.source_type !== "host_import") return false;
    if (f.uploadedByClientId === "camera_ftp" && photo.source_type !== "camera_ftp") return false;
    if (f.uploadedByClientId !== "host" && photo.uploaded_by_client_id !== f.uploadedByClientId) return false;
  }
  const keyword = f.search.trim().toLowerCase();
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
}

export function MobilePhotoWallPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [photos, setPhotos] = useState<EventImageData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploaders, setUploaders] = useState<EventUploaderData[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<ImageStatus, number>>({
    unselected: 0, rejected: 0, archive: 0, edit: 0, edited: 0, publish: 0, published: 0
  });
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionState>("disconnected");
  const [message, setMessage] = useState<WallMessage | null>(null);

  // Applied filters (drive the server query) + the immediate toolbar search text.
  const [filters, setFilters] = useState<QueryFilters>({ ...EMPTY_FILTER });
  const [searchInput, setSearchInput] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Preview + long-press quick actions + standalone sheets.
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<EventImageData[]>([]);
  const [quickPhotoId, setQuickPhotoId] = useState<string | null>(null);
  const [standalone, setStandalone] = useState<{ id: string; kind: "metadata" | "download" } | null>(null);

  const setCurrentPageEvent = useCurrentPageEventStore((s) => s.setCurrentPageEvent);
  const clearCurrentPageEvent = useCurrentPageEventStore((s) => s.clearCurrentPageEvent);

  const selectedEventName = events.find((e) => e.id === selectedEventId)?.name ?? null;

  useEffect(() => {
    if (selectedEventId && selectedEventName) {
      setCurrentPageEvent({ eventId: selectedEventId, eventName: selectedEventName }, "photo-wall");
    }
    return () => { clearCurrentPageEvent("photo-wall"); };
  }, [selectedEventId, selectedEventName, setCurrentPageEvent, clearCurrentPageEvent]);

  // Refs mirror the latest values needed inside realtime/timeout callbacks.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const queryRef = useRef({ selectedEventId, filters });
  queryRef.current = { selectedEventId, filters };

  // ---------- data loading ----------

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => ["active", "reviewing", "draft"].includes(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "主机当前没有可协作的活动。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请先在客户端连接页完成连接测试。" });
    }
  }, []);

  const buildParams = useCallback((targetPage: number, status?: ImageStatus | "all", pageSize = PAGE_SIZE) => ({
    page: targetPage,
    pageSize,
    rating: filters.ratingValue === "all" ? undefined : filters.ratingValue,
    ratingMode: filters.ratingValue === "all" ? undefined : filters.ratingMode,
    status: status ?? filters.statusFilter,
    source_type: filters.sourceType,
    uploadedByClientId: filters.uploadedByClientId,
    keyword: filters.search.trim() || undefined
  }), [filters]);

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
      const res = await fetchEventImages(selectedEventId, buildParams(1));
      if (res.ok && res.data) {
        setPhotos(res.data.items);
        setTotal(res.data.total);
        setPage(1);
        setMessage(null);
        window.scrollTo({ top: 0 });
      } else {
        setMessage({ tone: "danger", title: "图片读取失败", body: res.error?.message || "无法读取图片列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "图片读取失败", body: "请求失败，请确认主机服务已启动。" });
    } finally {
      setLoading(false);
    }
  }, [buildParams, selectedEventId]);

  const loadStatusCounts = useCallback(async () => {
    if (!selectedEventId) {
      setStatusCounts({ unselected: 0, rejected: 0, archive: 0, edit: 0, edited: 0, publish: 0, published: 0 });
      return;
    }
    try {
      const entries = await Promise.all(imageStatusOptions.map(async (status) => {
        const res = await fetchEventImages(selectedEventId, buildParams(1, status, 1));
        return [status, res.ok && res.data ? res.data.total : 0] as const;
      }));
      setStatusCounts(Object.fromEntries(entries) as Record<ImageStatus, number>);
    } catch {
      // Counts can fail independently of the wall.
    }
  }, [buildParams, selectedEventId]);

  const loadUploaders = useCallback(async () => {
    if (!selectedEventId) {
      setUploaders([]);
      return;
    }
    try {
      const res = await fetchEventUploaders(selectedEventId);
      if (res.ok && res.data) setUploaders(res.data);
    } catch {
      setUploaders([]);
    }
  }, [selectedEventId]);

  const loadMoreImages = useCallback(async () => {
    if (!selectedEventId || loading || loadingMore) return;
    if (photosRef.current.length >= total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchEventImages(selectedEventId, buildParams(nextPage));
      if (res.ok && res.data) {
        setPhotos((current) => {
          const existing = new Set(current.map((p) => p.id));
          const fresh = res.data.items.filter((p) => !existing.has(p.id));
          return [...current, ...fresh];
        });
        setTotal(res.data.total);
        setPage(nextPage);
      } else {
        setMessage({ tone: "danger", title: "加载更多失败", body: res.error?.message || "无法读取下一页图片。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "加载更多失败", body: "请求失败，请确认主机服务已启动。" });
    } finally {
      setLoadingMore(false);
    }
  }, [buildParams, loading, loadingMore, page, selectedEventId, total]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { loadImages(); }, [loadImages]);
  useEffect(() => { loadStatusCounts(); }, [loadStatusCounts]);
  useEffect(() => { void loadUploaders(); }, [loadUploaders]);

  // Debounce the toolbar search into the applied filters (avoids reload-per-keystroke).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchInput ? current : { ...current, search: searchInput }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // ---------- realtime sync (batched / throttled) ----------

  const pendingRef = useRef({
    created: new Map<string, EventImageData>(),
    updated: new Map<string, EventImageData>(),
    deleted: new Set<string>()
  });
  const flushTimerRef = useRef<number | null>(null);

  const flushRealtime = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.created.size === 0 && pending.updated.size === 0 && pending.deleted.size === 0) return;
    const { selectedEventId: eventId, filters: f } = queryRef.current;
    const current = photosRef.current;

    const created = [...pending.created.values()];
    const updated = [...pending.updated.values()];
    const deleted = new Set(pending.deleted);
    pending.created.clear();
    pending.updated.clear();
    pending.deleted.clear();

    const byId = new Map(current.map((p) => [p.id, p]));
    let delta = 0;

    for (const id of deleted) {
      if (byId.delete(id)) delta -= 1;
    }
    for (const image of updated) {
      if (image.event_id !== eventId) continue;
      const wasPresent = byId.has(image.id);
      if (matchesFilters(image, f)) {
        byId.set(image.id, image);
        if (!wasPresent) delta += 1;
      } else if (wasPresent) {
        byId.delete(image.id);
        delta -= 1;
      }
    }
    const fresh: EventImageData[] = [];
    for (const image of created) {
      if (image.event_id !== eventId) continue;
      if (!matchesFilters(image, f)) continue;
      if (!byId.has(image.id)) {
        byId.set(image.id, image);
        fresh.push(image);
        delta += 1;
      }
    }

    const freshIds = new Set(fresh.map((p) => p.id));
    const rebuilt = current
      .filter((p) => byId.has(p.id) && !freshIds.has(p.id))
      .map((p) => byId.get(p.id)!);
    setPhotos([...fresh, ...rebuilt]);
    if (delta !== 0) setTotal((value) => Math.max(0, value + delta));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushRealtime();
    }, 250);
  }, [flushRealtime]);

  useEffect(() => {
    const onCreated = (payload: RealtimeImagePayload) => {
      if (!payload.image) return;
      const image = withImageCacheKey(payload.image, payload.updatedAt || String(Date.now()));
      pendingRef.current.created.set(image.id, image);
      pendingRef.current.deleted.delete(image.id);
      scheduleFlush();
    };
    const onUpdated = (payload: RealtimeImagePayload) => {
      if (!payload.image) return;
      const image = withImageCacheKey(payload.image, payload.updatedAt || String(Date.now()));
      pendingRef.current.updated.set(image.id, image);
      scheduleFlush();
    };
    const onDeleted = (payload: RealtimeImagePayload) => {
      pendingRef.current.deleted.add(payload.imageId);
      pendingRef.current.created.delete(payload.imageId);
      pendingRef.current.updated.delete(payload.imageId);
      scheduleFlush();
    };

    const unsubConnection = subscribeRealtimeConnection(setRealtimeStatus);
    const unsubCreated = subscribeRealtimeImageEvent("image-created", onCreated);
    const unsubUpdated = subscribeRealtimeImageEvent("image-updated", onUpdated);
    const unsubDeleted = subscribeRealtimeImageEvent("image-deleted-logical", onDeleted);
    return () => {
      unsubConnection();
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [scheduleFlush]);

  // ---------- single-image mutations (last write wins) ----------

  const seqRef = useRef(new Map<string, number>());

  const applyUpdatedPhoto = useCallback((image: EventImageData) => {
    setPhotos((current) => current.map((p) => (p.id === image.id ? image : p)));
    setPreviewSnapshot((current) => current.map((p) => (p.id === image.id ? image : p)));
  }, []);

  const runMutation = useCallback(async (
    id: string,
    field: string,
    operation: () => Promise<{ ok: boolean; data: EventImageData; error: { message: string } | null }>
  ) => {
    const key = `${id}:${field}`;
    const seq = (seqRef.current.get(key) ?? 0) + 1;
    seqRef.current.set(key, seq);
    const res = await operation();
    if (!res.ok || !res.data) {
      throw new Error(res.error?.message || "更新失败");
    }
    // Guard against an older, slower response overwriting a newer one.
    if (seqRef.current.get(key) === seq) {
      applyUpdatedPhoto(withImageCacheKey(res.data, String(Date.now())));
    }
  }, [applyUpdatedPhoto]);

  const handleRatingChange = useCallback(
    (id: string, rating: number) => runMutation(id, "rating", () => updateImageRating(id, rating)),
    [runMutation]
  );
  const handleStatusChange = useCallback(
    (id: string, status: ImageStatus) => runMutation(id, "status", () => updateImageStatus(id, status)),
    [runMutation]
  );
  const handleRemarkChange = useCallback(
    (id: string, remark: string) => runMutation(id, "remark", () => updateImageRemark(id, remark)),
    [runMutation]
  );

  // ---------- preview ----------

  const previewPhotos = useMemo(() => {
    if (!previewPhotoId) return [];
    return previewSnapshot.map((snap) => photos.find((p) => p.id === snap.id) ?? snap);
  }, [photos, previewPhotoId, previewSnapshot]);

  const previewPhoto = previewPhotoId
    ? previewPhotos.find((p) => p.id === previewPhotoId)
      ?? photos.find((p) => p.id === previewPhotoId)
      ?? previewSnapshot.find((p) => p.id === previewPhotoId)
      ?? null
    : null;

  const openPreview = useCallback((photo: EventImageData) => {
    setPreviewSnapshot(photosRef.current);
    setPreviewPhotoId(photo.id);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewPhotoId(null);
    setPreviewSnapshot([]);
    // No reload here: realtime + optimistic updates keep the wall fresh and the
    // scroll position is preserved.
  }, []);

  const movePreview = useCallback((direction: 1 | -1) => {
    const source = previewPhotos.length > 0 ? previewPhotos : photosRef.current;
    if (source.length === 0) return;
    const currentId = previewPhotoId ?? source[0].id;
    const index = source.findIndex((p) => p.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + source.length) % source.length;
    const next = source[nextIndex];
    if (next) setPreviewPhotoId(next.id);
  }, [previewPhotoId, previewPhotos]);

  // ---------- quick actions ----------

  const quickPhoto = quickPhotoId ? photos.find((p) => p.id === quickPhotoId) ?? null : null;
  const standalonePhoto = standalone ? photos.find((p) => p.id === standalone.id) ?? null : null;

  // ---------- infinite scroll sentinel ----------

  const hasMore = photos.length < total;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMoreImages);
  loadMoreRef.current = loadMoreImages;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreRef.current();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  // ---------- filter sheet ----------

  const appliedDraft: MobileFilterDraft = { eventId: selectedEventId, ...filters };
  const hasActiveFilters =
    filters.search.trim() !== "" ||
    filters.ratingValue !== "all" ||
    filters.statusFilter !== "all" ||
    filters.sourceType !== "all" ||
    filters.uploadedByClientId !== "all";

  const applyFilterDraft = (draft: MobileFilterDraft) => {
    setFilterOpen(false);
    setSearchInput(draft.search);
    setSelectedEventId(draft.eventId);
    setFilters({
      search: draft.search,
      ratingValue: draft.ratingValue,
      ratingMode: draft.ratingMode,
      statusFilter: draft.statusFilter,
      sourceType: draft.sourceType,
      uploadedByClientId: draft.uploadedByClientId
    });
  };

  const emptyTitle = selectedEventId && total === 0 && !hasActiveFilters ? "暂无图片" : "当前筛选没有图片";
  const emptyBody = selectedEventId && total === 0 && !hasActiveFilters
    ? "暂无图片，主机导入或上传后会实时出现在这里。"
    : "当前筛选条件下没有可显示的图片。可以清空筛选、降低星级条件，或切换到全部状态。";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search + filter toolbar (sticky under the shell header) */}
      <div
        className="sticky z-30 border-b border-slate-100 bg-white/95 backdrop-blur"
        style={{ top: "calc(3.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-base outline-none focus:border-blue-500"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索文件名 / 分类 / 备注 / 相机..."
              value={searchInput}
            />
          </div>
          <button
            aria-label="筛选"
            className={cn(
              "mpw-touch relative flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
              filterOpen || hasActiveFilters
                ? "border-blue-100 bg-blue-50 text-blue-600"
                : "border-slate-200 text-slate-700 active:bg-slate-50"
            )}
            onClick={() => setFilterOpen(true)}
            type="button"
          >
            <SlidersHorizontal size={16} />
            筛选
            {hasActiveFilters && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-600" />}
          </button>
        </div>
      </div>

      {/* Floating message toast (no layout impact) */}
      <div className="pointer-events-none fixed inset-x-0 z-50 px-3" style={{ top: "calc(7rem + env(safe-area-inset-top, 0px))" }}>
        <TransientNotice className="pointer-events-auto shadow-lg" message={message} onDismiss={() => setMessage(null)} />
      </div>

      {/* Photo wall */}
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">正在读取图片...</div>
        ) : (
          <MobilePhotoGrid
            emptyBody={emptyBody}
            emptyTitle={emptyTitle}
            onLongPress={(photo) => setQuickPhotoId(photo.id)}
            onOpenPreview={openPreview}
            photos={photos}
          />
        )}

        {/* Infinite scroll sentinel + footer */}
        <div className="px-4 pb-8">
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <p className="py-4 text-center text-xs text-slate-400">正在加载更多...</p>
          )}
          {!loading && !hasMore && photos.length > 0 && (
            <p className="py-4 text-center text-xs text-slate-300">已加载全部 {total.toLocaleString()} 张</p>
          )}
          {!loading && hasMore && !loadingMore && (
            <button
              className="mpw-touch mx-auto mt-2 block rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
              onClick={() => void loadMoreImages()}
              type="button"
            >
              加载更多（{photos.length.toLocaleString()} / {total.toLocaleString()}）
            </button>
          )}
        </div>
      </div>

      {/* Filter bottom sheet */}
      <MobileFilterSheet
        events={events}
        initial={appliedDraft}
        onApply={applyFilterDraft}
        onClose={() => setFilterOpen(false)}
        open={filterOpen}
        statusCounts={statusCounts}
        uploaders={uploaders}
      />

      {/* Long-press quick action sheet */}
      <BottomSheet
        maxHeightClass="mpw-max-h-80"
        onClose={() => setQuickPhotoId(null)}
        open={quickPhoto !== null}
        title={quickPhoto?.original_filename ?? "快捷操作"}
        subtitle={quickPhoto ? imageStatusLabels[quickPhoto.status] : undefined}
      >
        {quickPhoto && (
          <div className="space-y-5 pb-4 pt-1">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
              <span className="text-sm font-medium text-slate-700">星级</span>
              <MobileRatingStars
                onChange={(rating) => void handleRatingChange(quickPhoto.id, rating)}
                rating={quickPhoto.rating}
                size={24}
                tone="light"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">快速标记</p>
              <div className="grid grid-cols-3 gap-2">
                {(["edit", "publish", "rejected"] as ImageStatus[]).map((status) => (
                  <button
                    className={cn(
                      "mpw-touch flex h-11 items-center justify-center rounded-xl border text-sm font-medium",
                      quickPhoto.status === status
                        ? getImageWorkflowStatusSemantic(status).badgeClass
                        : "border-slate-200 text-slate-600 active:bg-slate-50"
                    )}
                    key={status}
                    onClick={() => void handleStatusChange(quickPhoto.id, status)}
                    type="button"
                  >
                    {imageStatusLabels[status]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
              <QuickAction label="查看大图" onClick={() => { const p = quickPhoto; setQuickPhotoId(null); openPreview(p); }} />
              <QuickAction label="元数据" onClick={() => { setStandalone({ id: quickPhoto.id, kind: "metadata" }); setQuickPhotoId(null); }} />
              <QuickAction label="下载原图" onClick={() => { setStandalone({ id: quickPhoto.id, kind: "download" }); setQuickPhotoId(null); }} />
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Standalone metadata / download sheets (from quick actions) */}
      <MobileMetadataSheet
        onClose={() => setStandalone(null)}
        open={standalone?.kind === "metadata" && standalonePhoto !== null}
        photo={standalonePhoto}
      />
      <MobileDownloadSheet
        onClose={() => setStandalone(null)}
        open={standalone?.kind === "download" && standalonePhoto !== null}
        photo={standalonePhoto}
      />

      {/* Fullscreen preview */}
      {previewPhoto && (
        <MobilePreview
          onClose={closePreview}
          onNavigate={movePreview}
          onRatingChange={handleRatingChange}
          onRemarkChange={handleRemarkChange}
          onStatusChange={handleStatusChange}
          photo={previewPhoto}
          photos={previewPhotos}
        />
      )}
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="mpw-touch flex h-11 items-center justify-center rounded-xl border border-slate-200 text-sm font-medium text-slate-700 active:bg-slate-50"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
