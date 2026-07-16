import { Activity, AlertCircle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { Notice, StatusPill } from "../../ui/States";
import type { CameraFtpRecentRecordData, CameraFtpWatcherData } from "../../../lib/api";
import { cn } from "../../../lib/cn";
import { getOperationalStatusSemantic } from "../../../lib/statusSemantics";
import { formatCameraFtpDateTime, formatCameraFtpFileSize } from "./formatters";
import { CameraFtpPanel } from "./CameraFtpPanel";

type RecentRecordStatus = CameraFtpRecentRecordData["status"];

const RECORD_STATUS_META: Record<RecentRecordStatus, { label: string }> = {
  receiving: { label: "正在接收" },
  waiting: { label: "等待稳定" },
  importing: { label: "正在导入" },
  imported: { label: "导入成功" },
  skipped: { label: "重复跳过" },
  failed: { label: "导入失败" }
};

export function CameraFtpRecentFiles({ watcher }: { watcher?: CameraFtpWatcherData }) {
  const counts = countRecentRecordStatuses(watcher?.recentRecords ?? []);
  return (
    <CameraFtpPanel icon={<Activity size={18} />} title="最近接收">
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
        {(watcher?.unstableCount ?? 0) > 0 ? <RecentStatChip label="正在接收" status="receiving" value={watcher?.unstableCount ?? 0} /> : null}
        {((watcher?.pendingCount ?? 0) + (watcher?.queuedCount ?? 0)) > 0 ? <RecentStatChip label="等待稳定" status="waiting" value={(watcher?.pendingCount ?? 0) + (watcher?.queuedCount ?? 0)} /> : null}
        {(watcher?.importingCount ?? 0) > 0 ? <RecentStatChip label="正在导入" status="importing" value={watcher?.importingCount ?? 0} /> : null}
        {counts.imported > 0 ? <RecentStatChip label="成功" status="imported" value={counts.imported} /> : null}
        {counts.skipped > 0 ? <RecentStatChip label="跳过" status="skipped" value={counts.skipped} /> : null}
        {counts.failed > 0 ? <RecentStatChip label="失败" status="failed" value={counts.failed} /> : null}
        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-slate-400">
          <Clock3 size={14} />
          <span className="truncate">最近接收 {formatCameraFtpDateTime(watcher?.lastReceivedAt)}</span>
        </div>
      </div>
      {watcher?.lastError ? <Notice className="mb-4" tone="warning" title="watcher 最近错误">{watcher.lastError}</Notice> : null}
      {(watcher?.recentRecords?.length ?? 0) > 0 ? (
        <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
          {watcher?.recentRecords.map((record) => <RecentRecordRow key={record.id} record={record} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-7 text-center text-sm text-slate-400">
          相机 FTP 上传到当前活动“原图/相机FTP”目录后，文件稳定检测和原地导入结果会显示在这里。
        </div>
      )}
    </CameraFtpPanel>
  );
}

function RecentStatChip({ label, value, status }: { label: string; value: number; status: RecentRecordStatus }) {
  const semantic = getOperationalStatusSemantic(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", semantic.badgeClass)}>
      <span>{label}</span>
      <strong className="font-semibold tabular-nums">{value}</strong>
    </span>
  );
}

function RecentRecordRow({ record }: { record: CameraFtpRecentRecordData }) {
  const semantic = getOperationalStatusSemantic(record.status);
  const meta = RECORD_STATUS_META[record.status];
  const detailMessage = record.status === "failed" ? record.error || record.reason : "";
  const statusIcon = record.status === "imported"
    ? <CheckCircle2 size={13} />
    : record.status === "failed"
      ? <AlertCircle size={13} />
      : ["receiving", "waiting", "importing"].includes(record.status)
        ? <Loader2 className="animate-spin" size={13} />
        : <Clock3 size={13} />;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800" title={record.filename}>{record.filename}</p>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-slate-400">
            <span>{formatCameraFtpFileSize(record.size)}</span>
            <span>接收 {formatCameraFtpDateTime(record.receivedAt || record.detectedAt)}</span>
            {record.importedAt ? <span>导入 {formatCameraFtpDateTime(record.importedAt)}</span> : null}
          </div>
        </div>
        <StatusPill tone={semantic.tone}><span className="flex items-center gap-1.5">{statusIcon}{meta.label}</span></StatusPill>
      </div>
      {detailMessage ? <p className="mt-2 break-words text-xs leading-5 text-red-600">{detailMessage}</p> : null}
    </div>
  );
}

function countRecentRecordStatuses(records: CameraFtpRecentRecordData[]): Record<RecentRecordStatus, number> {
  return records.reduce<Record<RecentRecordStatus, number>>((counts, record) => {
    counts[record.status] += 1;
    return counts;
  }, { receiving: 0, waiting: 0, importing: 0, imported: 0, skipped: 0, failed: 0 });
}
