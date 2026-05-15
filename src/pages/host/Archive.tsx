import { Archive as ArchiveIcon, CheckCircle2, ExternalLink, FileText, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Step } from "../../components/ui/FormControls";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Notice } from "../../components/ui/States";
import {
  ArchiveCleanupData,
  ArchivedEventData,
  ArchivedEventDetailData,
  ArchivePrepareData,
  ArchiveVerifyData,
  cleanupEventArchive,
  deleteArchivedEvent,
  EventData,
  fetchArchivedEventDetail,
  fetchArchivedEvents,
  fetchEventImages,
  fetchEvents,
  getApiBase,
  imageStatusLabels,
  prepareEventArchive,
  verifyEventArchive
} from "../../lib/api";
import { cn } from "../../lib/cn";

const visibleStatuses = new Set(["active", "reviewing", "draft", "archived"]);

export function ArchivePage() {
  const [activeMode, setActiveMode] = useState<"workflow" | "readonly">("workflow");
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [archivedEvents, setArchivedEvents] = useState<ArchivedEventData[]>([]);
  const [selectedArchivedId, setSelectedArchivedId] = useState("");
  const [archivedDetail, setArchivedDetail] = useState<ArchivedEventDetailData | null>(null);
  const [loadingArchivedEvents, setLoadingArchivedEvents] = useState(false);
  const [loadingArchivedDetail, setLoadingArchivedDetail] = useState(false);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState<ArchivedEventDetailData | null>(null);
  const [archiveDeleteConfirmName, setArchiveDeleteConfirmName] = useState("");
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
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

  const loadArchivedEvents = useCallback(async () => {
    setLoadingArchivedEvents(true);
    try {
      const res = await fetchArchivedEvents();
      if (res.ok && res.data) {
        setArchivedEvents(res.data);
        setSelectedArchivedId((current) => {
          if (current && res.data.some((event) => event.id === current)) return current;
          return res.data[0]?.id || "";
        });
      } else {
        setMessage({ tone: "danger", title: "归档列表读取失败", body: res.error?.message || "无法读取已归档活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请通过 pnpm dev 启动完整应用。" });
    } finally {
      setLoadingArchivedEvents(false);
    }
  }, []);

  const loadArchivedDetail = useCallback(async (archivedId: string) => {
    if (!archivedId) {
      setArchivedDetail(null);
      return;
    }

    setLoadingArchivedDetail(true);
    try {
      const res = await fetchArchivedEventDetail(archivedId);
      if (res.ok && res.data) {
        setArchivedDetail(res.data);
      } else {
        setArchivedDetail(null);
        setMessage({ tone: "danger", title: "归档详情读取失败", body: res.error?.message || "无法读取归档详情。" });
      }
    } catch {
      setArchivedDetail(null);
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请通过 pnpm dev 启动完整应用。" });
    } finally {
      setLoadingArchivedDetail(false);
    }
  }, []);

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
    if (activeMode === "readonly") {
      void loadArchivedEvents();
    }
  }, [activeMode, loadArchivedEvents]);

  useEffect(() => {
    if (activeMode === "readonly") {
      void loadArchivedDetail(selectedArchivedId);
    }
  }, [activeMode, loadArchivedDetail, selectedArchivedId]);

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
          body: `缩略图 ${res.data.thumbCopied} 个，metadata 已生成，缺失 ${res.data.missingFiles.length} 个。原图、已修图和导出文件只记录元数据，不复制进归档。`
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

    setRunning("cleanup");
    setMessage(null);
    try {
      const res = await cleanupEventArchive(selectedEventId, prepareResult.archivePath);
      if (res.ok && res.data) {
        setCleanupResult(res.data);
        setCleanupConfirmOpen(false);
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

  const handleOpenReadonlyArchive = async () => {
    if (!archivedDetail?.archivePath) return;
    const openResult = await window.mediaPhotoWorkbench?.openPath(archivedDetail.archivePath);
    if (openResult) {
      setMessage({ tone: "danger", title: "无法打开归档目录", body: openResult });
    }
  };

  const openDeleteReadonlyArchiveDialog = () => {
    if (!archivedDetail) return;
    setArchiveDeleteTarget(archivedDetail);
    setArchiveDeleteConfirmName("");
    setMessage(null);
  };

  const closeDeleteReadonlyArchiveDialog = () => {
    if (running === "cleanup") return;
    setArchiveDeleteTarget(null);
    setArchiveDeleteConfirmName("");
  };

  const handleDeleteReadonlyArchive = async () => {
    if (!archiveDeleteTarget) return;
    if (archiveDeleteConfirmName.trim() !== archiveDeleteTarget.event.name) {
      setMessage({ tone: "warning", title: "删除归档已取消", body: "输入的活动名称不一致，未执行删除。" });
      return;
    }

    setRunning("cleanup");
    setMessage(null);
    try {
      const res = await deleteArchivedEvent(archiveDeleteTarget.archivedEvent.id);
      if (res.ok && res.data) {
        setArchiveDeleteTarget(null);
        setArchiveDeleteConfirmName("");
        setArchivedDetail(null);
        setSelectedArchivedId("");
        await loadArchivedEvents();
        setMessage({
          tone: res.data.missingFiles.length > 0 ? "warning" : "success",
          title: "归档已删除",
          body: res.data.deletedArchive ? "归档目录和归档摘要已删除。" : "归档摘要已删除，归档目录原本不存在。"
        });
      } else {
        setMessage({ tone: "danger", title: "删除归档失败", body: res.error?.message || "无法删除归档。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "删除归档失败", body: "请求失败，请确认本地后端服务已启动。" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">活动归档</h1>
          <p className="mt-1 text-sm text-slate-500">生成归档、验证完整性，并只读查看历史归档活动。</p>
          <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-1">
            <button
              className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", activeMode === "workflow" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
              onClick={() => setActiveMode("workflow")}
              type="button"
            >
              归档流程
            </button>
            <button
              className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", activeMode === "readonly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
              onClick={() => setActiveMode("readonly")}
              type="button"
            >
              只读归档
            </button>
          </div>
        </div>
        {activeMode === "workflow" && (
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
        )}
      </div>

      {message && <Notice className="mb-6" tone={message.tone} title={message.title}>{message.body}</Notice>}

      {archiveDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-red-700">删除归档</h2>
              <p className="mt-1 text-sm text-slate-500">此操作会删除归档目录和归档摘要，不会删除原活动记录。</p>
            </div>

            <div className="space-y-3 rounded-xl bg-red-50 p-4 text-sm">
              <ArchiveDeleteLine label="归档活动" value={archiveDeleteTarget.event.name} />
              <ArchiveDeleteLine label="图片数量" value={`${archiveDeleteTarget.counts.total_images} 张`} />
              <ArchiveDeleteLine label="归档目录" value={archiveDeleteTarget.archivePath} />
            </div>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">输入活动名称确认</span>
              <input
                autoFocus
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                onChange={(event) => setArchiveDeleteConfirmName(event.target.value)}
                placeholder={archiveDeleteTarget.event.name}
                value={archiveDeleteConfirmName}
              />
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                disabled={running === "cleanup"}
                onClick={closeDeleteReadonlyArchiveDialog}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={running === "cleanup" || archiveDeleteConfirmName.trim() !== archiveDeleteTarget.event.name}
                onClick={handleDeleteReadonlyArchive}
                type="button"
              >
                {running === "cleanup" ? "删除中..." : "确认删除归档"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cleanupConfirmOpen && selectedEvent && prepareResult && (
        <ConfirmDialog
          confirmLabel="清理工作区"
          confirming={running === "cleanup"}
          description="只有归档验证通过后才能清理。清理会删除 working 下该活动文件夹，归档目录会保留。"
          details={[
            { label: "活动名称", value: selectedEvent.name },
            { label: "工作区", value: `working\\${selectedEvent.slug}` },
            { label: "归档目录", value: prepareResult.archivePath }
          ]}
          onCancel={() => running !== "cleanup" && setCleanupConfirmOpen(false)}
          onConfirm={handleCleanup}
          title="清理工作区"
          tone="danger"
        />
      )}

      {activeMode === "readonly" ? (
        <ReadonlyArchiveView
          archivedEvents={archivedEvents}
          detail={archivedDetail}
          loadingDetail={loadingArchivedDetail}
          loadingEvents={loadingArchivedEvents}
          onOpenArchive={handleOpenReadonlyArchive}
          onDeleteArchive={openDeleteReadonlyArchiveDialog}
          onSelectArchived={setSelectedArchivedId}
          selectedArchivedId={selectedArchivedId}
        />
      ) : (
        <>
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
            <Metric label="归档缩略图" loading={false} value={prepareResult?.thumbCopied ?? 0} />
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
                  复制缩略图并生成 `images.csv`、`operation_logs.csv`、`manifest.json` 和独立 `event.db`；原图、已修图和导出文件只保留历史路径记录。
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
                  ["缩略图复制", prepareResult.thumbCopied],
                  ["原图复制", prepareResult.originalCopied],
                  ["已修图复制", prepareResult.editedCopied],
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
                onClick={() => setCleanupConfirmOpen(true)}
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
        </>
      )}
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

function ArchiveDeleteLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="break-all font-medium text-slate-900">{value}</span>
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

function ReadonlyArchiveView({
  archivedEvents,
  detail,
  loadingDetail,
  loadingEvents,
  onDeleteArchive,
  onOpenArchive,
  onSelectArchived,
  selectedArchivedId
}: {
  archivedEvents: ArchivedEventData[];
  detail: ArchivedEventDetailData | null;
  loadingDetail: boolean;
  loadingEvents: boolean;
  onDeleteArchive: () => void;
  onOpenArchive: () => void;
  onSelectArchived: (id: string) => void;
  selectedArchivedId: string;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-6">
      <aside className="h-fit rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-slate-900">已归档活动</h3>
            <p className="mt-1 text-xs text-slate-400">来自 archived_events 摘要索引</p>
          </div>
          <FileText className="text-blue-500" size={18} />
        </div>

        <div className="mt-4 space-y-2">
          {loadingEvents && <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">读取中...</div>}
          {!loadingEvents && archivedEvents.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">暂无已归档活动</div>
          )}
          {archivedEvents.map((event) => (
            <button
              className={cn(
                "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                selectedArchivedId === event.id ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-white hover:bg-slate-50"
              )}
              key={event.id}
              onClick={() => onSelectArchived(event.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{event.event_name}</p>
                  <p className="mt-1 text-xs text-slate-400">{event.event_date || "未填写日期"}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{event.total_images} 张</span>
              </div>
              <p className="mt-2 truncate text-xs text-slate-400" title={event.archive_path}>{event.archive_path}</p>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 space-y-6">
        {loadingDetail && <div className="rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center text-sm text-slate-400 shadow-sm">读取归档详情中...</div>}

        {!loadingDetail && !detail && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center text-sm text-slate-400">
            选择一个已归档活动查看只读详情。
          </div>
        )}

        {!loadingDetail && detail && (
          <>
            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-white">只读</span>
                    <span className="text-xs text-slate-400">归档时间：{detail.archivedAt}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-slate-900">{detail.event.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">{detail.event.date || "未填写日期"} / {detail.event.slug}</p>
                  <p className="mt-3 break-all text-xs text-slate-400">{detail.archivePath}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    onClick={onOpenArchive}
                    type="button"
                  >
                    <ExternalLink size={16} />
                    打开归档目录
                  </button>
                  <button
                    className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
                    onClick={onDeleteArchive}
                    type="button"
                  >
                    <Trash2 size={16} />
                    删除归档
                  </button>
                </div>
              </div>

              <ResultPanel
                items={[
                  ["图片总数", detail.counts.total_images],
                  ["缩略图数量", detail.counts.thumb_files ?? 0],
                  ["原图保留", detail.counts.original_files],
                  ["已修图保留", detail.counts.edited_files],
                  ["缺失文件", detail.missingFiles.length]
                ]}
              />
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium text-slate-900">归档缩略图</h3>
                  <p className="mt-1 text-xs text-slate-400">轻量归档只保留缩略图和 metadata，用于活动历史回看。</p>
                </div>
                <span className="text-xs text-slate-400">{detail.images.filter((image) => image.has_thumb).length} 张</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                {detail.images.slice(0, 48).map((image) => (
                  <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50" key={`thumb-${image.image_id || image.stored_filename}`}>
                    {image.has_thumb && image.thumb_url ? (
                      <img
                        alt={image.original_filename || image.stored_filename}
                        className="aspect-[4/3] w-full object-cover"
                        src={`${getApiBase()}${image.thumb_url}`}
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center text-xs text-slate-400">无缩略图</div>
                    )}
                    <div className="truncate px-2 py-1.5 text-xs text-slate-600" title={image.original_filename || image.stored_filename}>
                      {image.original_filename || image.stored_filename || "-"}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="font-medium text-slate-900">metadata 文件状态</h3>
              <div className="mt-4 grid grid-cols-4 gap-3">
                {detail.metadataFiles.map((file) => (
                  <div className={cn("rounded-xl border p-4", file.exists ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50")} key={file.name}>
                    <p className="text-sm font-medium text-slate-900">{file.name}</p>
                    <p className={cn("mt-1 text-xs", file.exists ? "text-emerald-600" : "text-red-600")}>{file.exists ? `存在 / ${formatBytes(file.size)}` : "缺失"}</p>
                  </div>
                ))}
              </div>
            </section>

            {detail.missingFiles.length > 0 && (
              <section className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
                <h3 className="font-medium text-red-700">缺失文件</h3>
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto text-xs text-red-600">
                  {detail.missingFiles.map((file) => (
                    <div className="break-all rounded-lg bg-red-50 px-3 py-2" key={file}>{file}</div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium text-slate-900">归档图片元数据</h3>
                  <p className="mt-1 text-xs text-slate-400">只读展示，不提供打星、状态修改、上传、删除、导出入口；原图和已修图默认不保留。</p>
                </div>
                <span className="text-xs text-slate-400">{detail.images.length} 条</span>
              </div>

              <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-slate-100">
                <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">文件名</th>
                      <th className="px-4 py-3 font-medium">星级</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">分类</th>
                      <th className="px-4 py-3 font-medium">摄影师</th>
                      <th className="px-4 py-3 font-medium">缩略图</th>
                      <th className="px-4 py-3 font-medium">原文件</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.images.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>images.csv 中暂无图片记录</td>
                      </tr>
                    )}
                    {detail.images.map((image) => (
                      <tr className="text-slate-700" key={image.image_id || image.stored_filename}>
                        <td className="max-w-[260px] truncate px-4 py-3 font-medium text-slate-900" title={image.original_filename || image.stored_filename}>
                          {image.original_filename || image.stored_filename || "-"}
                        </td>
                        <td className="px-4 py-3">{image.rating || 0}</td>
                        <td className="px-4 py-3">{archiveStatusLabel(image.status)}</td>
                        <td className="px-4 py-3">{image.category || "-"}</td>
                        <td className="px-4 py-3">{image.photographer || "-"}</td>
                        <td className={cn("px-4 py-3", image.has_thumb ? "text-emerald-600" : "text-red-500")}>{image.has_thumb ? "有" : "缺失"}</td>
                        <td className="px-4 py-3 text-slate-400">{image.original_retained || image.edited_retained ? "部分保留" : "未保留"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function archiveStatusLabel(status: string): string {
  return imageStatusLabels[status as keyof typeof imageStatusLabels] ?? (status || "-");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
