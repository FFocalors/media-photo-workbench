import { useEffect, useState } from "react";
import { EventData, EventUploaderData, ImageStatus, imageStatusLabels, imageStatusOptions } from "../../lib/api";
import { cn } from "../../lib/cn";
import { BottomSheet } from "./BottomSheet";

export type RatingMode = "eq" | "gte";
export type RatingFilterValue = number | "all";

export interface MobileFilterDraft {
  eventId: string;
  search: string;
  ratingValue: RatingFilterValue;
  ratingMode: RatingMode;
  statusFilter: ImageStatus | "all";
  sourceType: string;
  uploadedByClientId: string;
}

export const EMPTY_FILTER: Omit<MobileFilterDraft, "eventId"> = {
  search: "",
  ratingValue: "all",
  ratingMode: "gte",
  statusFilter: "all",
  sourceType: "all",
  uploadedByClientId: "all"
};

/**
 * Mobile filter bottom sheet. Edits a local draft; nothing is applied until
 * "应用筛选" is tapped, so the wall behind never re-queries on each keystroke.
 * "重置" clears the draft (still requires 应用筛选 to take effect).
 */
export function MobileFilterSheet({
  open,
  onClose,
  events,
  uploaders,
  statusCounts,
  initial,
  onApply
}: {
  open: boolean;
  onClose: () => void;
  events: EventData[];
  uploaders: EventUploaderData[];
  statusCounts: Record<ImageStatus, number>;
  initial: MobileFilterDraft;
  onApply: (draft: MobileFilterDraft) => void;
}) {
  const [draft, setDraft] = useState<MobileFilterDraft>(initial);

  // Re-seed the draft each time the sheet opens so it reflects the applied state.
  useEffect(() => {
    if (open) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const clientUploaders = uploaders.filter((item) => item.clientId !== "host" && item.sourceType === "client_upload");
  const hasHostImports = uploaders.some((item) => item.clientId === "host" || item.sourceType === "host_import");
  const hasCameraFtpImports = uploaders.some((item) => item.sourceType === "camera_ftp");

  const uploadSourceValue =
    draft.uploadedByClientId !== "all"
      ? `client:${draft.uploadedByClientId}`
      : draft.sourceType !== "all"
        ? `source:${draft.sourceType}`
        : "all";

  const setRatingValue = (value: RatingFilterValue) => {
    setDraft((current) => ({
      ...current,
      ratingValue: value,
      ratingMode: value === 0 ? "eq" : current.ratingMode
    }));
  };

  const handleUploadSource = (value: string) => {
    setDraft((current) => {
      if (value === "all") return { ...current, sourceType: "all", uploadedByClientId: "all" };
      if (value === "client:host") return { ...current, sourceType: "host_import", uploadedByClientId: "host" };
      if (value.startsWith("client:")) {
        return { ...current, sourceType: "client_upload", uploadedByClientId: value.slice("client:".length) };
      }
      if (value.startsWith("source:")) {
        return { ...current, sourceType: value.slice("source:".length), uploadedByClientId: "all" };
      }
      return current;
    });
  };

  const ratingLabel = draft.ratingValue === "all"
    ? "全部星级"
    : draft.ratingMode === "eq"
      ? `${draft.ratingValue} 星`
      : `${draft.ratingValue} 星及以上`;

  return (
    <BottomSheet
      footer={(
        <div className="flex items-center gap-3">
          <button
            className="mpw-touch h-11 flex-1 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 active:bg-slate-50"
            onClick={() => setDraft((current) => ({ ...EMPTY_FILTER, eventId: current.eventId }))}
            type="button"
          >
            重置
          </button>
          <button
            className="mpw-touch h-11 flex-[2] rounded-xl bg-blue-600 text-sm font-semibold text-white active:bg-blue-700"
            onClick={() => onApply(draft)}
            type="button"
          >
            应用筛选
          </button>
        </div>
      )}
      maxHeightClass="mpw-max-h-92"
      onClose={onClose}
      open={open}
      title="筛选"
      subtitle={ratingLabel}
    >
      <div className="space-y-6 pb-4 pt-1">
        <Section title="活动">
          <select
            className="mpw-touch h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base text-slate-700"
            onChange={(event) => setDraft((current) => ({ ...current, eventId: event.target.value }))}
            value={draft.eventId}
          >
            {events.length === 0 && <option value="">暂无进行中活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </Section>

        <Section title="搜索">
          <input
            className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder="文件名 / 分类 / 备注 / 相机..."
            value={draft.search}
          />
        </Section>

        <Section title="星级">
          <div className="grid grid-cols-7 gap-1.5">
            {(["all", 0, 1, 2, 3, 4, 5] as const).map((value) => (
              <button
                className={cn(
                  "mpw-touch flex h-10 items-center justify-center rounded-lg border text-sm font-medium",
                  draft.ratingValue === value
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 active:bg-slate-50"
                )}
                key={String(value)}
                onClick={() => setRatingValue(value)}
                type="button"
              >
                {value === "all" ? "全部" : value}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              className={cn(
                "mpw-touch h-9 rounded-md text-sm font-medium",
                draft.ratingMode === "eq" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500",
                draft.ratingValue === "all" && "cursor-not-allowed opacity-50"
              )}
              disabled={draft.ratingValue === "all"}
              onClick={() => setDraft((current) => ({ ...current, ratingMode: "eq" }))}
              type="button"
            >
              等于
            </button>
            <button
              className={cn(
                "mpw-touch h-9 rounded-md text-sm font-medium",
                draft.ratingMode === "gte" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500",
                (draft.ratingValue === "all" || draft.ratingValue === 0) && "cursor-not-allowed opacity-50"
              )}
              disabled={draft.ratingValue === "all" || draft.ratingValue === 0}
              onClick={() => setDraft((current) => ({ ...current, ratingMode: "gte" }))}
              type="button"
            >
              及以上
            </button>
          </div>
        </Section>

        <Section title="状态">
          <div className="space-y-1">
            <StatusRow
              active={draft.statusFilter === "all"}
              count={total}
              label="全部"
              onClick={() => setDraft((current) => ({ ...current, statusFilter: "all" }))}
            />
            {imageStatusOptions.map((status) => (
              <StatusRow
                active={draft.statusFilter === status}
                count={statusCounts[status] ?? 0}
                key={status}
                label={imageStatusLabels[status]}
                onClick={() => setDraft((current) => ({ ...current, statusFilter: status }))}
              />
            ))}
          </div>
        </Section>

        <Section title="来源 / 上传者">
          <select
            className="mpw-touch h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base text-slate-700"
            onChange={(event) => handleUploadSource(event.target.value)}
            value={uploadSourceValue}
          >
            <option value="all">全部来源</option>
            <option value="client:host">主机导入{hasHostImports ? "" : "（暂无）"}</option>
            <option value="source:camera_ftp">相机 FTP{hasCameraFtpImports ? "" : "（暂无）"}</option>
            <option value="source:client_upload">全部客户端上传</option>
            {clientUploaders.map((item) => (
              <option key={`${item.clientId}-${item.clientName}`} value={`client:${item.clientId}`}>
                上传者：{item.clientName}（{item.count}）
              </option>
            ))}
            <option value="source:remote_import">远程导入</option>
            <option value="source:manual_import">手动导入</option>
          </select>
        </Section>
      </div>
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function StatusRow({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      className={cn(
        "mpw-touch flex h-11 w-full items-center justify-between rounded-lg px-3 text-sm",
        active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 active:bg-slate-50"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-2.5">
        <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", active ? "border-blue-600" : "border-slate-300")}>
          {active && <span className="h-2 w-2 rounded-full bg-blue-600" />}
        </span>
        {label}
      </span>
      <span className="text-xs text-slate-400">{count.toLocaleString()}</span>
    </button>
  );
}
