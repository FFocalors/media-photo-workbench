import { X } from "lucide-react";
import { EventData, EventUploaderData, ImageStatus, imageStatusLabels, imageStatusOptions } from "../../lib/api";
import { cn } from "../../lib/cn";

export function FilterSidebar({
  events,
  selectedEventId,
  search,
  ratingValue,
  ratingMode,
  statusFilter,
  sourceType,
  uploadedByClientId,
  uploaders,
  statusCounts,
  onEventChange,
  onSearchChange,
  onRatingValueChange,
  onRatingModeChange,
  onStatusChange,
  onUploadSourceChange,
  onReset,
  className,
  showClose = false,
  onClose
}: {
  events: EventData[];
  selectedEventId: string;
  search: string;
  ratingValue: number | "all";
  ratingMode: "eq" | "gte";
  statusFilter: ImageStatus | "all";
  sourceType: string;
  uploadedByClientId: string;
  uploaders: EventUploaderData[];
  statusCounts: Record<ImageStatus, number>;
  onEventChange: (eventId: string) => void;
  onSearchChange: (value: string) => void;
  onRatingValueChange: (value: number | "all") => void;
  onRatingModeChange: (value: "eq" | "gte") => void;
  onStatusChange: (status: ImageStatus | "all") => void;
  onUploadSourceChange: (sourceType: string, uploadedByClientId: string) => void;
  onReset: () => void;
  className?: string;
  showClose?: boolean;
  onClose?: () => void;
}) {
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const uploadSourceValue = uploadedByClientId !== "all"
    ? `client:${uploadedByClientId}`
    : sourceType !== "all"
      ? `source:${sourceType}`
      : "all";
  const clientUploaders = uploaders.filter((item) => item.clientId !== "host" && item.sourceType === "client_upload");
  const hasHostImports = uploaders.some((item) => item.clientId === "host" || item.sourceType === "host_import");

  return (
    <div className={cn("flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-100 bg-white", className)}>
      <div className="flex items-center justify-between border-b border-slate-50 p-4">
        <h2 className="font-semibold text-slate-800">筛选</h2>
        <div className="flex items-center gap-3">
          <button className="text-xs text-blue-600 hover:text-blue-700" onClick={onReset} type="button">重置</button>
          {showClose && (
            <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} type="button">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6 p-4">
        <FilterSection title="活动">
          <select
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => onEventChange(event.target.value)}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无进行中活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </FilterSection>

        <FilterSection title="搜索">
          <input
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="文件名 / 分类 / 备注"
            value={search}
          />
        </FilterSection>

        <FilterSection title="上传来源 / 上传者">
          <select
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all") {
                onUploadSourceChange("all", "all");
                return;
              }
              if (value === "client:host") {
                onUploadSourceChange("host_import", "host");
                return;
              }
              if (value.startsWith("client:")) {
                onUploadSourceChange("client_upload", value.slice("client:".length));
                return;
              }
              if (value.startsWith("source:")) {
                onUploadSourceChange(value.slice("source:".length), "all");
              }
            }}
            value={uploadSourceValue}
          >
            <option value="all">全部来源</option>
            <option value="client:host">主机导入{hasHostImports ? "" : "（暂无）"}</option>
            <option value="source:client_upload">全部客户端上传</option>
            {clientUploaders.map((item) => (
              <option key={`${item.clientId}-${item.clientName}`} value={`client:${item.clientId}`}>
                上传者：{item.clientName}（{item.count}）
              </option>
            ))}
            <option value="source:remote_import">远程导入</option>
            <option value="source:manual_import">手动导入</option>
          </select>
          {uploadedByClientId !== "all" && (
            <p className="mt-2 text-xs leading-5 text-blue-600">
              {uploadedByClientId === "host"
                ? "上传来源：主机导入"
                : `上传者：${clientUploaders.find((item) => item.clientId === uploadedByClientId)?.clientName || uploadedByClientId}`}
            </p>
          )}
        </FilterSection>

        <FilterSection title="星级">
          <select
            className="mb-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
            onChange={(event) => {
              const value = event.target.value;
              onRatingValueChange(value === "all" ? "all" : Number(value));
            }}
            value={ratingValue}
          >
            <option value="all">全部星级</option>
            <option value={0}>0 星</option>
            <option value={1}>1 星</option>
            <option value={2}>2 星</option>
            <option value={3}>3 星</option>
            <option value={4}>4 星</option>
            <option value={5}>5 星</option>
          </select>
          <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                ratingMode === "eq" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                ratingValue === "all" && "cursor-not-allowed opacity-50"
              )}
              disabled={ratingValue === "all"}
              onClick={() => onRatingModeChange("eq")}
              type="button"
            >
              等于
            </button>
            <button
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                ratingMode === "gte" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                (ratingValue === "all" || ratingValue === 0) && "cursor-not-allowed opacity-50"
              )}
              disabled={ratingValue === "all" || ratingValue === 0}
              onClick={() => onRatingModeChange("gte")}
              type="button"
            >
              及以上
            </button>
          </div>
          <div className="flex justify-between px-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${ratingValue === star ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                key={star}
                onClick={() => onRatingValueChange(ratingValue === star ? "all" : star)}
                type="button"
              >
                {star}
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterSection title="状态">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                checked={statusFilter === "all"}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                onChange={() => onStatusChange("all")}
                type="radio"
              />
              全部
              <span className="ml-auto text-xs text-slate-400">{total.toLocaleString()}</span>
            </label>
            {imageStatusOptions.map((status) => (
              <label className="flex items-center gap-2 text-sm text-slate-700" key={status}>
                <input
                  checked={statusFilter === status}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  onChange={() => onStatusChange(status)}
                  type="radio"
                />
                {imageStatusLabels[status]}
                <span className="ml-auto text-xs text-slate-400">{statusCounts[status] ?? 0}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </div>
  );
}
