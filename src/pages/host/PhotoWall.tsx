import { useEffect, useMemo, useState } from "react";
import { FilterSidebar } from "../../components/gallery/FilterSidebar";
import { GalleryToolbar } from "../../components/gallery/GalleryToolbar";
import { MetadataPanel } from "../../components/gallery/MetadataPanel";
import { PhotoGrid } from "../../components/gallery/PhotoGrid";
import { PreviewModal } from "../../components/gallery/PreviewModal";
import type { GalleryPhoto, GalleryStatus } from "../../data/figmaMock";
import { initialGalleryPhotos, statusOptions } from "../../data/figmaMock";

export function PhotoWallPage() {
  const [photos, setPhotos] = useState<GalleryPhoto[]>(initialGalleryPhotos);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialGalleryPhotos.slice(0, 2).map((photo) => photo.id));
  const [activePhotoId, setActivePhotoId] = useState<string | null>(initialGalleryPhotos[0]?.id ?? null);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [photographer, setPhotographer] = useState("全部");
  const [minRating, setMinRating] = useState(0);
  const [statusFilter, setStatusFilter] = useState<GalleryStatus[]>(statusOptions);

  const statusCounts = useMemo(() => {
    return photos.reduce<Record<GalleryStatus, number>>((acc, photo) => {
      acc[photo.status] = (acc[photo.status] ?? 0) + 1;
      return acc;
    }, {
      原图: 0,
      未处理: 0,
      待修图: 0,
      已修图: 0,
      可发布: 0,
      废片: 0
    });
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    const query = search.trim().toLowerCase();
    return photos.filter((photo) => {
      const matchesSearch =
        query.length === 0 ||
        photo.name.toLowerCase().includes(query) ||
        photo.category.toLowerCase().includes(query) ||
        photo.tags.some((tag) => tag.toLowerCase().includes(query));
      const matchesPhotographer = photographer === "全部" || photo.photographer === photographer;
      const matchesRating = photo.stars >= minRating;
      const matchesStatus = statusFilter.includes(photo.status);
      return matchesSearch && matchesPhotographer && matchesRating && matchesStatus;
    });
  }, [photos, photographer, minRating, search, statusFilter]);

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? filteredPhotos[0] ?? null;
  const previewPhoto = photos.find((photo) => photo.id === previewPhotoId) ?? null;

  const updatePhoto = (id: string, patch: Partial<GalleryPhoto>) => {
    setPhotos((current) => current.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)));
  };

  const updateActivePhoto = (patch: Partial<GalleryPhoto>) => {
    if (!activePhoto) return;
    updatePhoto(activePhoto.id, patch);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setActivePhotoId(id);
  };

  const selectAllFiltered = () => {
    setSelectedIds(filteredPhotos.map((photo) => photo.id));
  };

  const batchStatus = (status: GalleryStatus) => {
    if (selectedIds.length === 0) return;
    setPhotos((current) => current.map((photo) => selectedIds.includes(photo.id) ? { ...photo, status } : photo));
  };

  const resetFilters = () => {
    setSearch("");
    setPhotographer("全部");
    setMinRating(0);
    setStatusFilter(statusOptions);
  };

  const toggleStatusFilter = (status: GalleryStatus) => {
    setStatusFilter((current) => {
      if (current.includes(status)) {
        const next = current.filter((item) => item !== status);
        return next.length === 0 ? statusOptions : next;
      }
      return [...current, status];
    });
  };

  const movePreview = (direction: 1 | -1) => {
    const currentId = previewPhotoId ?? activePhotoId;
    const list = filteredPhotos.length > 0 ? filteredPhotos : photos;
    const index = list.findIndex((photo) => photo.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + list.length) % list.length;
    const next = list[nextIndex];
    if (next) {
      setActivePhotoId(next.id);
      setPreviewPhotoId(next.id);
    }
  };

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
        updatePhoto(previewPhoto.id, { stars: Number(event.key) });
      } else if (event.key === "0") {
        updatePhoto(previewPhoto.id, { stars: 0 });
      } else if (event.key.toLowerCase() === "x") {
        updatePhoto(previewPhoto.id, { status: "废片" });
      } else if (event.key.toLowerCase() === "e") {
        updatePhoto(previewPhoto.id, { status: "待修图" });
      } else if (event.key.toLowerCase() === "p") {
        updatePhoto(previewPhoto.id, { status: "可发布" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredPhotos, photos, previewPhoto, previewPhotoId]);

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-[#F8F9FA]">
      <FilterSidebar
        minRating={minRating}
        photographer={photographer}
        search={search}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        onMinRatingChange={setMinRating}
        onPhotographerChange={setPhotographer}
        onReset={resetFilters}
        onSearchChange={setSearch}
        onToggleStatus={toggleStatusFilter}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <GalleryToolbar
          filteredCount={filteredPhotos.length}
          search={search}
          selectedCount={selectedIds.length}
          onBatchStatus={batchStatus}
          onClearSelection={() => setSelectedIds([])}
          onSearchChange={setSearch}
          onSelectAll={selectAllFiltered}
        />

        <div className="flex-1 overflow-y-auto p-4">
          <PhotoGrid
            activeId={activePhotoId}
            photos={filteredPhotos}
            selectedIds={selectedIds}
            onActivate={setActivePhotoId}
            onOpenPreview={setPreviewPhotoId}
            onToggleSelected={toggleSelected}
          />
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-slate-100 bg-white px-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>已选择 {selectedIds.length} 张</span>
            <div className="flex gap-1">
              <span className="h-3 w-3 rounded-full bg-red-500" />
              <span className="h-3 w-3 rounded-full bg-blue-500" />
              <span className="h-3 w-3 rounded-full bg-emerald-500" />
            </div>
          </div>
          <span>共 {photos.length.toLocaleString()} 张</span>
        </div>
      </div>

      <MetadataPanel
        photo={activePhoto}
        selectedCount={selectedIds.length}
        onCategoryChange={(category) => updateActivePhoto({ category })}
        onClearActive={() => setActivePhotoId(null)}
        onOpenPreview={() => activePhoto && setPreviewPhotoId(activePhoto.id)}
        onRatingChange={(stars) => updateActivePhoto({ stars })}
        onStatusChange={(status) => updateActivePhoto({ status })}
      />

      {previewPhoto && (
        <PreviewModal
          photo={previewPhoto}
          photos={filteredPhotos.length > 0 ? filteredPhotos : photos}
          onCategoryChange={(id, category) => updatePhoto(id, { category })}
          onClose={() => setPreviewPhotoId(null)}
          onNext={() => movePreview(1)}
          onPrevious={() => movePreview(-1)}
          onRatingChange={(id, stars) => updatePhoto(id, { stars })}
          onSelectPhoto={(id) => {
            setActivePhotoId(id);
            setPreviewPhotoId(id);
          }}
          onStatusChange={(id, status) => updatePhoto(id, { status })}
        />
      )}
    </div>
  );
}
