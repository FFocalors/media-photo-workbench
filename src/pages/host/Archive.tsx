import { Archive as ArchiveIcon, CheckCircle2, ExternalLink, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Step } from "../../components/ui/FormControls";
import { Notice } from "../../components/ui/States";
import {
  ArchiveCleanupData,
  ArchivePrepareData,
  ArchiveVerifyData,
  cleanupEventArchive,
  EventData,
  fetchEventImages,
  fetchEvents,
  prepareEventArchive,
  verifyEventArchive
} from "../../lib/api";
import { cn } from "../../lib/cn";

const visibleStatuses = new Set(["active", "reviewing", "draft", "archived"]);

export function ArchivePage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [running, setRunning] = useState<"prepare" | "verify" | "cleanup" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [prepareResult, setPrepareResult] = useState<ArchivePrepareData | null>(null);
  const [verifyResult, setVerifyResult] = useState<ArchiveVerifyData | null>(null);
  const [cleanupResult, setCleanupResult] = useState<ArchiveCleanupData | null>(null);
  const [summary, setSummary] = useState({
    total: 0,
    edited: 0,
    publish: 0
  });

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId]
  );

  const step = cleanupResult ? 4 : verifyResult?.verified ? 3 : prepareResult ? 2 : 1;

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请通过 pnpm dev 启动完整应用。" });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!selectedEventId) {
      setSummary({ total: 0, edited: 0, publish: 0 });
      return;
    }

    setLoadingSummary(true);
    try {
      const [totalRes, editedRes, publishRes, publishedRes] = await Promise.all([
        fetchEventImages(selectedEventId, { pageSize: 1 }),
        fetchEventImages(selectedEventId, { status: "edited", pageSize: 1 }),
        fetchEventImages(selectedEventId, { status: "publish", pageSize: 1 }),
        fetchEventImages(selectedEventId, { status: "published", pageSize: 1 })
      ]);
      setSummary({
        total: totalRes.ok && totalRes.data ? totalRes.data.total : 0,
        edited: editedRes.ok && editedRes.data ? editedRes.data.total : 0,
        publish: (publishRes.ok && publishRes.data ? publishRes.data.total : 0)
          + (publishedRes.ok && publishedRes.data ? publishedRes.data.total : 0)
      });
    } catch {
      setMessage({ tone: "warning", title: "摘要读取失败", body: "无法读取活动图片统计，但仍可尝试归档。" });
    } finally {
      setLoadingSummary(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setPrepareResult(null);
    setVerifyResult(null);
    setCleanupResult(null);
    setMessage(null);
    void loadSummary();
  }, [loadSummary]);

  const handlePrepare = async () => {
    if (!selectedEventId) return;
    setRunning("prepare");
    setMessage(null);
    setPrepareResult(null);
    setVerifyResult(null);
    setCleanupResult(null);
    try {
      const res = await prepareEventArchive(selectedEventId);
      if (res.ok && res.data) {
        setPrepareResult(res.data);
        setMessage({
          tone: res.data.missingFiles.length > 0 ? "warning" : "success",
          title: "归档已生成",
          body: `原图 ${res.data.originalCopied} 个，已修图 ${res.data.editedCopied} 个，导出文件 ${res.data.exportCopied} 个，缺失 ${res.data.missingFiles.length} 个。`
        });
      } else {
        setMessage({ tone: "danger", title: "生成归档失败", body: res.error?.message || "无法生成归档。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "生成归档失败", body: err?.message || "请求失败。" });
    } finally {
      setRunning(null);
    }
  };

  const handleVerify = async () => {
    if (!selectedEventId || !prepareResult?.archivePath) return;
    setRunning("verify");
    setMessage(null);
    try {
      const res = await verifyEventArchive(selectedEventId, prepareResult.archivePath);
      if (res.ok && res.data) {
        setVerifyResult(res.data);
        setMessage({
          tone: res.data.verified ? "success" : "danger",
          title: res.data.verified ? "归档验证通过" : "归档验证未通过",
          body: `缺失 ${res.data.missingFiles.length} 个，hash 不一致 ${res.data.mismatchedFiles.length} 个。`
        });
      } else {
        setMessage({ tone: "danger", title: "归档验证失败", body: res.error?.message || "无法验证归档。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "归档验证失败", body: err?.message || "请求失败。" });
    } finally {
      setRunning(null);
    }
  };

  const handleCleanup = async () => {
    if (!selectedEventId || !prepareResult?.archivePath || !verifyResult?.verified) return;
    const confirmed = window.confirm("确认清理该活动的 working 工作区？归档目录会保留，但 working 下的活动文件夹会被删除。");
    if (!confirmed) return;

    setRunning("cleanup");
    setMessage(null);
    try {
      const res = await cleanupEventArchive(selectedEventId, prepareResult.archivePath);
      if (res.ok && res.data) {
        setCleanupResult(res.data);
        setMessage({ tone: "success", title: "工作区已清理", body: "活动状态已更新为已归档，归档目录已保留。" });
        void loadEvents();
      } else {
        setMessage({ tone: "danger", title: "清理工作区失败", body: res.error?.message || "无法清理工作区。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "清理工作区失败", body: err?.message || "请求失败。" });
    } finally {
      setRunning(null);
    }
  };

  const handleOpenArchive = async () => {
    const archivePath = cleanupResult?.archivePath || prepareResult?.archivePath;
    if (!archivePath) return;
    const openResult = await window.mediaPhotoWorkbench?.openPath(archivePath);
    if (openResult) {
      setMessage({ tone: "danger", title: "无法打开归档目录", body: openResult });
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">活动归档</h1>
          <p className="mt-1 text-sm text-slate-500">生成归档、验证完整性，并在确认后清理工作区。</p>
        </div>
        <label className="min-w-72">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            disabled={loadingEvents}
            onChange={(event) => setSelectedEventId(event.target.value)}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无可归档活动</option>}
            {events.map((event) => (
              <option key={event.id} value={event.id}>{event.name} / {event.status}</option>
            ))}
          </select>
        </label>
      </div>

      {message && <Notice className="mb-6" tone={message.tone} title={message.title}>{message.body}</Notice>}

      <div className="mb-8 flex w-full items-center justify-center">
        <Step number={1} label="生成归档" active={step >= 1} completed={step > 1} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={2} label="验证归档" active={step >= 2} completed={step > 2} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={3} label="清理工作区" active={step >= 3} completed={step > 3} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={4} label="完成" active={step >= 4} completed={step > 4} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-6">
        <aside className="h-fit rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">活动摘要</h3>
          <p className="mt-1 text-xs text-slate-400">{selectedEvent?.name || "未选择活动"}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric label="图片总数" loading={loadingSummary} value={summary.total} />
            <Metric label="已修图" loading={loadingSummary} value={summary.edited} />
            <Metric label="可发布/已发布" loading={loadingSummary} value={summary.publish} />
            <Metric label="导出文件" loading={false} value={prepareResult?.exportCopied ?? 0} />
          </div>

          <div className="mt-6 border-t border-slate-100 pt-5">
            <ArchiveItem label="归档路径" value={prepareResult?.archivePath || "生成归档后显示"} />
            <ArchiveItem label="manifest.json" value={prepareResult?.manifestPath || "未生成"} />
            <ArchiveItem label="event.db" value={prepareResult?.eventDbPath || "未生成"} />
          </div>

          <button
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!prepareResult?.archivePath}
            onClick={handleOpenArchive}
            type="button"
          >
            <ExternalLink size={16} />
            打开归档目录
          </button>
        </aside>

        <main className="space-y-6">
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h3 className="font-medium text-slate-900">1. 生成归档</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  复制原图、已修图、发布图和压缩包，生成 `images.csv`、`operation_logs.csv`、`manifest.json` 和独立 `event.db`。
                </p>
              </div>
              <button
                className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!selectedEventId || running !== null || selectedEvent?.status === "archived"}
                onClick={handlePrepare}
                type="button"
              >
                <ArchiveIcon size={16} />
                {running === "prepare" ? "生成中..." : "生成归档"}
              </button>
            </div>

            {prepareResult && (
              <ResultPanel
                items={[
                  ["图片总数", prepareResult.totalImages],
                  ["原图复制", prepareResult.originalCopied],
                  ["已修图复制", prepareResult.editedCopied],
                  ["导出文件复制", prepareResult.exportCopied],
                  ["缺失文件", prepareResult.missingFiles.length]
                ]}
              />
            )}
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h3 className="font-medium text-slate-900">2. 验证归档</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">读取 manifest 并检查已归档文件是否存在；原图带 hash 时会校验 hash。</p>
              </div>
              <button
                className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!prepareResult || running !== null}
                onClick={handleVerify}
                type="button"
              >
                <ShieldCheck size={16} />
                {running === "verify" ? "验证中..." : "验证归档"}
              </button>
            </div>

            {verifyResult && (
              <div className="mt-5">
                <Notice tone={verifyResult.verified ? "success" : "danger"} title={verifyResult.verified ? "验证通过" : "验证未通过"}>
                  缺失 {verifyResult.missingFiles.length} 个，hash 不一致 {verifyResult.mismatchedFiles.length} 个。
                </Notice>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h3 className="font-medium text-slate-900">3. 清理工作区</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  只有归档验证通过后才能清理 `working/{selectedEvent?.slug || "event_slug"}`。第一版保留主库图片详细记录，活动状态改为已归档。
                </p>
              </div>
              <button
                className="flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!verifyResult?.verified || running !== null || Boolean(cleanupResult)}
                onClick={handleCleanup}
                type="button"
              >
                <Trash2 size={16} />
                {running === "cleanup" ? "清理中..." : "清理工作区"}
              </button>
            </div>

            {cleanupResult && (
              <div className="mt-5">
                <Notice tone="success" title="归档完成">
                  工作区已清理，归档目录保留在 {cleanupResult.archivePath}。
                </Notice>
              </div>
            )}
          </section>

          {(prepareResult?.missingFiles.length || verifyResult?.missingFiles.length || verifyResult?.mismatchedFiles.length) ? (
            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="font-medium text-slate-900">问题记录</h3>
              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto text-xs text-slate-600">
                {prepareResult?.missingFiles.map((item) => (
                  <IssueRow key={`${item.type}-${item.sourcePath}`} title={`${item.type} / ${item.imageId ?? "-"}`} body={`${item.reason}：${item.sourcePath || "空路径"}`} />
                ))}
                {verifyResult?.missingFiles.map((item) => (
                  <IssueRow key={`missing-${item}`} title="验证缺失" body={item} />
                ))}
                {verifyResult?.mismatchedFiles.map((item) => (
                  <IssueRow key={`hash-${item.path}`} title="hash 不一致" body={item.path} />
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{loading ? "-" : value.toLocaleString()}</p>
    </div>
  );
}

function ArchiveItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 text-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 truncate font-medium text-slate-800" title={value}>{value}</p>
    </div>
  );
}

function ResultPanel({ items }: { items: Array<[string, number]> }) {
  return (
    <div className="mt-5 grid grid-cols-5 gap-3">
      {items.map(([label, value]) => (
        <div className={cn("rounded-xl border p-4", label.includes("缺失") && value > 0 ? "border-amber-100 bg-amber-50" : "border-slate-100 bg-slate-50")} key={label}>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

function IssueRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2 font-medium text-slate-800">
        <CheckCircle2 className="text-slate-400" size={14} />
        {title}
      </div>
      <p className="mt-1 break-all text-slate-500">{body}</p>
    </div>
  );
}
