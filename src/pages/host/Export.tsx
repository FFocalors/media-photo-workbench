import { Download, ExternalLink, Info, PackageCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Notice } from "../../components/ui/States";
import {
  createPublishExport,
  downloadPublishExport,
  EventData,
  fetchEventImages,
  fetchEvents,
  PublishExportData,
  PublishExportFilenameMode,
  PublishExportMode,
  PublishExportSize
} from "../../lib/api";
import { cn } from "../../lib/cn";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);

const modeOptions: Array<{
  value: PublishExportMode;
  title: string;
  body: string;
}> = [
  { value: "selected", title: "当前选中图片", body: "来自图片墙传入的手动选择结果" },
  { value: "publish", title: "可发布", body: "所有状态为“可发布”的图片" },
  { value: "edited", title: "已修图", body: "所有状态为“已修图”的图片" },
  { value: "rating", title: "4 星及以上", body: "所有星级大于等于 4 的图片" }
];

const sizeOptions: Array<{ value: PublishExportSize; label: string; note: string }> = [
  { value: "3000px", label: "长边 3000px", note: "推荐用于新闻稿与网络发布" },
  { value: "1920px", label: "长边 1920px", note: "适合网页轻量发布" },
  { value: "original", label: "原尺寸", note: "不缩放，文件体积较大" }
];

const filenameOptions: Array<{ value: PublishExportFilenameMode; label: string }> = [
  { value: "sequence", label: "序列号_原文件名" },
  { value: "original", label: "保持原文件名" },
  { value: "event_original", label: "活动名_原文件名" }
];

export function ExportPage() {
  const location = useLocation();
  const selectedImageIds = useMemo(() => {
    const state = location.state as { imageIds?: string[] } | null;
    return Array.isArray(state?.imageIds) ? state.imageIds.filter(Boolean) : [];
  }, [location.state]);

  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [mode, setMode] = useState<PublishExportMode>(selectedImageIds.length > 0 ? "selected" : "publish");
  const [size, setSize] = useState<PublishExportSize>("3000px");
  const [quality, setQuality] = useState(90);
  const [limitFileSize10Mb, setLimitFileSize10Mb] = useState(false);
  const [filenameMode, setFilenameMode] = useState<PublishExportFilenameMode>("sequence");
  const [counts, setCounts] = useState<Record<PublishExportMode, number>>({
    selected: selectedImageIds.length,
    publish: 0,
    edited: 0,
    rating: 0
  });
  const [result, setResult] = useState<PublishExportData | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);

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

  const loadCounts = useCallback(async () => {
    if (!selectedEventId) {
      setCounts({ selected: selectedImageIds.length, publish: 0, edited: 0, rating: 0 });
      return;
    }

    setLoadingCounts(true);
    try {
      const [publishRes, editedRes, ratingRes] = await Promise.all([
        fetchEventImages(selectedEventId, { status: "publish", pageSize: 1 }),
        fetchEventImages(selectedEventId, { status: "edited", pageSize: 1 }),
        fetchEventImages(selectedEventId, { rating: 4, pageSize: 1 })
      ]);
      setCounts({
        selected: selectedImageIds.length,
        publish: publishRes.ok && publishRes.data ? publishRes.data.total : 0,
        edited: editedRes.ok && editedRes.data ? editedRes.data.total : 0,
        rating: ratingRes.ok && ratingRes.data ? ratingRes.data.total : 0
      });
    } catch {
      setMessage({ tone: "warning", title: "预估数量读取失败", body: "无法读取导出来源数量，但仍可尝试导出。" });
    } finally {
      setLoadingCounts(false);
    }
  }, [selectedEventId, selectedImageIds.length]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const canExport = Boolean(selectedEventId) && quality >= 1 && quality <= 100 && (mode !== "selected" || selectedImageIds.length > 0);

  const handleExport = async () => {
    if (!canExport) {
      setMessage({ tone: "warning", title: "无法开始导出", body: "请先选择活动和有效导出来源，JPEG 质量必须在 1-100 之间。" });
      return;
    }

    setExporting(true);
    setResult(null);
    setMessage(null);
    try {
      const res = await createPublishExport(selectedEventId, {
        mode,
        imageIds: mode === "selected" ? selectedImageIds : undefined,
        ratingMin: mode === "rating" ? 4 : undefined,
        size,
        quality,
        filenameMode,
        limitFileSize10Mb
      });
      if (res.ok && res.data) {
        setResult(res.data);
        setMessage({
          tone: res.data.status === "failed" ? "danger" : res.data.failed > 0 ? "warning" : "success",
          title: res.data.status === "failed" ? "导出未生成文件" : "导出完成",
          body: `成功 ${res.data.success} 张，失败 ${res.data.failed} 张。`
        });
        void loadCounts();
      } else {
        setMessage({ tone: "danger", title: "导出失败", body: res.error?.message || "发布导出失败。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "导出失败", body: err?.message || "请求失败。" });
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    setDownloading(true);
    try {
      await downloadPublishExport(result.jobId);
      setMessage({ tone: "success", title: "下载已开始", body: "发布 ZIP 已开始下载。" });
    } catch (err: any) {
      setMessage({ tone: "danger", title: "下载失败", body: err?.message || "发布 ZIP 下载失败。" });
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenOutputDir = async () => {
    if (!result?.outputDir) return;
    const openResult = await window.mediaPhotoWorkbench?.openPath(result.outputDir);
    if (openResult) {
      setMessage({ tone: "danger", title: "无法打开导出目录", body: openResult });
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-5 xl:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">导出发布</h1>
          <p className="mt-1 text-sm text-slate-500">按条件生成正式发布图和 ZIP 发布包。</p>
        </div>
        <label className="min-w-64 max-w-full sm:min-w-72">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            disabled={loadingEvents}
            onChange={(event) => {
              setSelectedEventId(event.target.value);
              setResult(null);
              setMessage(null);
            }}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无可用活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
      </div>

      {message && <Notice className="mb-6" tone={message.tone} title={message.title}>{message.body}</Notice>}

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[1fr_360px]">
        <main className="space-y-6">
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-medium text-slate-900">导出来源</h3>
              <span className="text-xs text-slate-400">{loadingCounts ? "正在读取数量..." : "数量为当前活动实时统计"}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {modeOptions.map((option) => (
                <ExportSource
                  active={mode === option.value}
                  body={option.body}
                  count={counts[option.value]}
                  disabled={option.value === "selected" && selectedImageIds.length === 0}
                  key={option.value}
                  onSelect={() => setMode(option.value)}
                  title={option.title}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="mb-5 font-medium text-slate-900">导出设置</h3>
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-xs font-medium text-slate-500">导出规格</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {sizeOptions.map((option) => (
                    <button
                      className={cn(
                        "rounded-xl border p-4 text-left transition-colors",
                        size === option.value ? "border-blue-500 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
                      )}
                      key={option.value}
                      onClick={() => setSize(option.value)}
                      type="button"
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-1 block text-xs opacity-70">{option.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">JPEG 质量</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                    max={100}
                    min={1}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    type="number"
                    value={quality}
                  />
                  <p className="mt-1 text-xs text-slate-400">仅控制 JPEG 编码质量，不再自动关联 10MB 限制。</p>
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">文件命名规则</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                    onChange={(event) => setFilenameMode(event.target.value as PublishExportFilenameMode)}
                    value={filenameMode}
                  >
                    {filenameOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <label className={cn(
                "flex items-start gap-3 rounded-xl border p-4 transition-colors",
                limitFileSize10Mb ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
              )}>
                <input
                  checked={limitFileSize10Mb}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  onChange={(event) => setLimitFileSize10Mb(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-900">限制单张图片不超过 10MB</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    关闭时按原导出质量处理；开启后，超过 10MB 的导出图才会继续压缩，已小于等于 10MB 的原尺寸文件不做更改。
                  </span>
                </span>
              </label>
            </div>
          </section>

          {result && (
            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="mb-5 font-medium text-slate-900">导出结果</h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ResultMetric label="总数" value={result.total} />
                <ResultMetric label="成功" tone="success" value={result.success} />
                <ResultMetric label="失败" tone={result.failed > 0 ? "danger" : "default"} value={result.failed} />
                <ResultMetric label="质量" value={result.quality} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                10MB 限制：{result.limitFileSize10Mb ? "已开启" : "未开启"}
              </p>
              <div className="mt-5 space-y-2 text-sm">
                <PathRow label="输出目录" value={result.outputDir} />
                <PathRow label="ZIP 文件" value={result.zipPath} />
              </div>
              {result.errors.length > 0 && (
                <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <h4 className="text-sm font-medium text-amber-900">跳过 / 失败记录</h4>
                  <div className="mt-3 space-y-2">
                    {result.errors.slice(0, 8).map((error) => (
                      <div className="text-xs text-amber-800" key={`${error.imageId ?? error.filename}-${error.reason}`}>
                        <p className="font-medium">{error.filename}</p>
                        <p className="mt-0.5 opacity-80">{error.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="h-fit rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <PackageCheck size={20} />
          </div>
          <h3 className="font-medium text-slate-900">发布包</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            导出会优先使用已修图；没有已修图时使用原图。原图和已修图都不存在的图片会跳过并记录错误。
          </p>
          <div className="my-6 flex gap-3 rounded-xl bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">
            <Info className="shrink-0 text-blue-600" size={16} />
            <p>导出文件会写入活动工作区的 `导出/发布图`，ZIP 会写入 `导出/压缩包`。10MB 限制是独立选项，开启后仅对超过限制的导出图继续压缩。</p>
          </div>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canExport || exporting}
            onClick={handleExport}
            type="button"
          >
            <UploadCloud size={18} />
            {exporting ? "导出中..." : "开始导出"}
          </button>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!result?.zipPath || downloading}
              onClick={handleDownload}
              type="button"
            >
              <Download size={16} />
              下载 ZIP
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!result?.outputDir}
              onClick={handleOpenOutputDir}
              type="button"
            >
              <ExternalLink size={16} />
              打开目录
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ExportSource({ title, body, count, active, disabled, onSelect }: {
  title: string;
  body: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        active ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300",
        disabled && "cursor-not-allowed opacity-50"
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className={cn("mt-1 h-3.5 w-3.5 rounded-full border", active ? "border-blue-600 bg-blue-600 shadow-[inset_0_0_0_3px_white]" : "border-slate-300")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", active ? "text-blue-900" : "text-slate-900")}>{title}</span>
        <span className={cn("mt-1 block text-xs", active ? "text-blue-700" : "text-slate-500")}>{body}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-slate-900">{count.toLocaleString()}</span>
    </button>
  );
}

function ResultMetric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "danger" }) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      tone === "success" ? "border-emerald-100 bg-emerald-50" : tone === "danger" ? "border-red-100 bg-red-50" : "border-slate-100 bg-slate-50"
    )}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value.toLocaleString()}</p>
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-800" title={value}>{value}</span>
    </div>
  );
}
