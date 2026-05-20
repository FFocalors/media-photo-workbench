import { AlertCircle, CheckCircle2, FolderOpen, Image, Loader2, Play, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Step } from "../../components/ui/FormControls";
import { Notice } from "../../components/ui/States";
import { EventData, fetchEvents, ImportScanData, ImportStartData, ImportTaskStartData, scanImportFolder, startImport } from "../../lib/api";
import { cn } from "../../lib/cn";

type MessageState = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
};

type ImportSourceMode = "folder" | "files";

export function ImportPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [sourceMode, setSourceMode] = useState<ImportSourceMode>("folder");
  const [sourceFolder, setSourceFolder] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanResult, setScanResult] = useState<ImportScanData | null>(null);
  const [importResult, setImportResult] = useState<ImportStartData | null>(null);
  const [startedTask, setStartedTask] = useState<ImportTaskStartData | null>(null);
  const [message, setMessage] = useState<MessageState | null>(null);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId), [events, selectedEventId]);
  const hasSelectedFiles = sourceMode === "files" && selectedFiles.length > 0;
  const canStartImport = sourceMode === "folder" ? Boolean(scanResult && scanResult.count > 0) : hasSelectedFiles;
  const step = importing || startedTask ? 3 : importResult ? 4 : scanResult || hasSelectedFiles ? 2 : 1;

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setEventsLoading(true);
      try {
        const res = await fetchEvents("active");
        if (cancelled) return;
        if (res.ok && res.data) {
          setEvents(res.data);
          setSelectedEventId((current) => current || res.data[0]?.id || "");
          if (res.data.length === 0) {
            setMessage({ tone: "warning", title: "没有可导入的活动", body: "请先在活动管理中新建进行中的活动，再导入图片。" });
          }
        } else {
          setMessage({ tone: "danger", title: "活动列表读取失败", body: res.error?.message || "无法读取活动列表。" });
        }
      } catch {
        if (!cancelled) {
          setMessage({ tone: "danger", title: "后端服务未连接", body: "导入功能需要 Electron 后端服务，请通过 pnpm dev 启动完整应用。" });
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }

    loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBrowse = async () => {
    if (!window.mediaPhotoWorkbench?.selectDirectory) {
      setMessage({ tone: "danger", title: "无法选择文件夹", body: "当前环境没有 Electron 文件夹选择能力，请在桌面应用中使用导入功能。" });
      return;
    }

    const selected = await window.mediaPhotoWorkbench.selectDirectory();
    if (selected) {
      setSourceMode("folder");
      setSourceFolder(selected);
      setSelectedFiles([]);
      setScanResult(null);
      setImportResult(null);
      setStartedTask(null);
      setMessage({ tone: "info", title: "已选择源文件夹", body: "点击扫描后会统计当前文件夹第一层中的 JPG/JPEG/PNG 文件。" });
    }
  };

  const handleBrowseFiles = async () => {
    if (!window.mediaPhotoWorkbench?.selectImageFiles) {
      setMessage({ tone: "danger", title: "无法选择图片文件", body: "当前环境没有 Electron 图片文件选择能力，请在桌面应用中使用导入功能。" });
      return;
    }

    const selected = await window.mediaPhotoWorkbench.selectImageFiles();
    if (selected.length > 0) {
      setSourceMode("files");
      setSelectedFiles(selected);
      setScanResult(null);
      setImportResult(null);
      setStartedTask(null);
      setMessage({ tone: "info", title: "已选择图片文件", body: `已选择 ${selected.length} 个文件，可直接开始导入。` });
    }
  };

  const handleScan = async () => {
    if (sourceMode === "files") {
      setMessage({ tone: "info", title: "文件选择模式无需扫描", body: "已手动选择图片文件，可直接开始导入。" });
      return;
    }
    if (!selectedEventId) {
      setMessage({ tone: "warning", title: "请选择活动", body: "导入前需要选择一个进行中的活动。" });
      return;
    }
    if (!sourceFolder.trim()) {
      setMessage({ tone: "warning", title: "请选择源文件夹", body: "请选择包含 JPG/JPEG/PNG 图片的本地文件夹。" });
      return;
    }

    setScanning(true);
    setMessage(null);
    setImportResult(null);
    setStartedTask(null);

    try {
      const res = await scanImportFolder(selectedEventId, sourceFolder.trim());
      if (res.ok && res.data) {
        setScanResult(res.data);
        setMessage({
          tone: res.data.count > 0 ? "success" : "warning",
          title: res.data.count > 0 ? "扫描完成" : "未发现可导入图片",
          body: `扫描到 ${res.data.count} 张 JPG/JPEG/PNG，合计 ${formatBytes(res.data.totalSize)}。`
        });
      } else {
        setScanResult(null);
        setMessage({ tone: "danger", title: "扫描失败", body: res.error?.message || "扫描文件夹失败。" });
      }
    } catch {
      setScanResult(null);
      setMessage({ tone: "danger", title: "扫描失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setScanning(false);
    }
  };

  const handleStartImport = async () => {
    if (!selectedEventId) {
      setMessage({ tone: "warning", title: "请选择活动", body: "导入前需要选择一个进行中的活动。" });
      return;
    }
    if (sourceMode === "folder" && !scanResult) {
      setMessage({ tone: "warning", title: "请先扫描", body: "请先扫描源文件夹，再开始导入。" });
      return;
    }
    if (sourceMode === "folder" && scanResult?.count === 0) {
      setMessage({ tone: "warning", title: "没有可导入图片", body: "当前文件夹没有 JPG/JPEG/PNG 文件。" });
      return;
    }
    if (sourceMode === "files" && selectedFiles.length === 0) {
      setMessage({ tone: "warning", title: "请选择图片文件", body: "请选择一张或多张 JPG/JPEG/PNG 图片。" });
      return;
    }

      setImporting(true);
    setMessage(null);
    setStartedTask(null);

    try {
      const res = await startImport(
        selectedEventId,
        sourceMode === "files" ? { filePaths: selectedFiles } : sourceFolder.trim()
      );
      if (res.ok && res.data) {
        if (isImportTaskStartData(res.data)) {
          setImportResult(null);
          setStartedTask(res.data);
          setMessage({
            tone: "success",
            title: "导入任务已创建",
            body: `已提交 ${res.data.total} 张图片到后台处理，可在左侧任务中心查看进度、预计剩余时间并取消任务。`
          });
        } else {
          setImportResult(res.data);
          setMessage({
            tone: res.data.failed > 0 ? "warning" : "success",
            title: "导入完成",
            body: `成功 ${res.data.success} 张，跳过 ${res.data.skipped} 张，失败 ${res.data.failed} 张。`
          });
        }
      } else {
        setMessage({ tone: "danger", title: "导入失败", body: res.error?.message || "导入任务失败。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "导入失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-5 xl:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">图片导入</h1>
          <p className="mt-1 text-sm text-slate-500">主机本地 JPG/JPEG/PNG 文件夹或指定图片导入</p>
        </div>
      </div>

      <div className="mx-auto mb-10 flex w-full max-w-2xl items-center justify-center">
        <Step number={1} label="选择来源" active={step >= 1} completed={step > 1} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={2} label="扫描 / 确认" active={step >= 2} completed={step > 2} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={3} label="导入处理" active={step >= 3} completed={step > 3} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={4} label="完成" active={step >= 4} completed={step > 4} />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 xl:flex-row">
        <div className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex border-b border-slate-100">
            <button className="mr-6 border-b-2 border-blue-600 px-1 pb-3 text-sm font-medium text-blue-600" type="button">本地导入</button>
            <button className="mr-6 border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-slate-400" disabled type="button">客户端上传</button>
            <button className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-slate-400" disabled type="button">远程传输 (预留)</button>
          </div>

          <h3 className="mb-5 font-medium text-slate-900">导入设置</h3>

          <div className="flex-1 space-y-5 overflow-y-auto pr-2">
            {message && <Notice tone={message.tone} title={message.title}>{message.body}</Notice>}

            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">所属活动</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                disabled={eventsLoading || importing}
                onChange={(event) => {
                  setSelectedEventId(event.target.value);
                  setScanResult(null);
                  setImportResult(null);
                  setStartedTask(null);
                  setSelectedFiles([]);
                }}
                value={selectedEventId}
              >
                {events.length === 0 && <option value="">暂无进行中活动</option>}
                {events.map((event) => (
                  <option key={event.id} value={event.id}>{event.name}</option>
                ))}
              </select>
            </label>

            <div className="space-y-3">
              <div>
                <span className="mb-2 block text-xs font-medium text-slate-500">导入来源</span>
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <button
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      sourceMode === "folder" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                    disabled={importing}
                    onClick={() => {
                      setSourceMode("folder");
                      setSelectedFiles([]);
                      setScanResult(null);
                      setImportResult(null);
                      setStartedTask(null);
                      setMessage(null);
                    }}
                    type="button"
                  >
                    选择文件夹
                  </button>
                  <button
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      sourceMode === "files" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                    disabled={importing}
                    onClick={() => {
                      setSourceMode("files");
                      setSourceFolder("");
                      setScanResult(null);
                      setImportResult(null);
                      setStartedTask(null);
                      setMessage(null);
                    }}
                    type="button"
                  >
                    选择图片文件
                  </button>
                </div>
              </div>

              {sourceMode === "folder" ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">源文件夹</label>
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                      onChange={(event) => {
                        setSourceFolder(event.target.value);
                        setScanResult(null);
                        setImportResult(null);
                        setStartedTask(null);
                      }}
                      placeholder="选择包含 JPG/JPEG/PNG 的本地文件夹"
                      value={sourceFolder}
                    />
                    <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" disabled={importing} onClick={handleBrowse} type="button">
                      <FolderOpen size={16} />
                      浏览
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">文件夹模式只扫描当前文件夹第一层，不递归子文件夹。</p>
                </div>
              ) : (
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">已选择 {selectedFiles.length} 个图片文件</p>
                      <p className="mt-1 text-xs text-slate-500">文件模式只导入手动选择的图片，不扫描整个文件夹。</p>
                    </div>
                    <button className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50" disabled={importing} onClick={handleBrowseFiles} type="button">
                      <Image size={16} />
                      {selectedFiles.length > 0 ? "重新选择" : "浏览图片"}
                    </button>
                  </div>
                  {selectedFiles.length > 0 && (
                    <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                      {selectedFiles.slice(0, 10).map((filePath) => (
                        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700" key={filePath}>
                          <Image className="shrink-0 text-slate-400" size={15} />
                          <span className="truncate">{getFilename(filePath)}</span>
                        </div>
                      ))}
                      {selectedFiles.length > 10 && <p className="text-xs text-slate-400">还有 {selectedFiles.length - 10} 个文件未在列表中显示。</p>}
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-500">支持 JPG、JPEG、PNG；暂不支持 RAW、HEIC、视频。</p>
            </div>

            {selectedEvent && (
              <div className="grid grid-cols-3 gap-3">
                <InfoTile label="当前活动" value={selectedEvent.name} />
                <InfoTile label="活动状态" value={selectedEvent.status === "active" ? "进行中" : selectedEvent.status} />
                <InfoTile label="库内图片" value={`${selectedEvent.total_images} 张`} />
              </div>
            )}

            {scanResult && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">扫描结果</h4>
                  <span className="text-xs text-slate-500">{scanResult.count} 张 · {formatBytes(scanResult.totalSize)}</span>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {scanResult.files.slice(0, 12).map((file) => (
                    <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm" key={file.path}>
                      <span className="flex min-w-0 items-center gap-2 text-slate-700">
                        <Image className="shrink-0 text-slate-400" size={15} />
                        <span className="truncate">{file.filename}</span>
                      </span>
                      <span className="ml-3 shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                  {scanResult.files.length > 12 && <p className="text-xs text-slate-400">还有 {scanResult.files.length - 12} 张未在列表中显示。</p>}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-6">
            <button className="rounded-lg border border-slate-200 bg-white px-6 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50" disabled={scanning || importing} onClick={() => {
              setScanResult(null);
              setImportResult(null);
              setStartedTask(null);
              setSelectedFiles([]);
              setMessage(null);
            }} type="button">清空结果</button>
            {sourceMode === "folder" && (
              <button className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-6 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={scanning || importing || !selectedEventId || !sourceFolder} onClick={handleScan} type="button">
                {scanning ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                {scanning ? "扫描中" : "扫描文件夹"}
              </button>
            )}
            <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={importing || !canStartImport} onClick={handleStartImport} type="button">
              {importing ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
              {importing ? "导入中" : "开始导入"}
            </button>
          </div>
        </div>

        <div className="flex w-full flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm xl:w-[400px]">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="font-medium text-slate-900">处理结果</h3>
            <span className="rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">host_import</span>
          </div>

          <div className="mb-8">
            <div className="mb-3 text-4xl font-bold text-slate-900">{importResult ? completionRate(importResult) : startedTask ? "任务" : scanResult ? "0" : "--"}{importResult && <span className="text-2xl">%</span>}</div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${importResult ? completionRate(importResult) : importing || startedTask ? 12 : 0}%` }} />
            </div>
            <p className="text-sm text-slate-500">
              {importResult ? `已处理 ${importResult.total} 张` : startedTask ? `任务 ${startedTask.taskId} 已提交，共 ${startedTask.total} 张` : scanResult ? `待导入 ${scanResult.count} 张` : hasSelectedFiles ? `待导入 ${selectedFiles.length} 张` : "等待选择导入来源"}
            </p>
          </div>

          <div className="mb-8 space-y-4">
            <ProgressRow color="text-emerald-600" icon={<CheckCircle2 size={16} />} label="成功" value={(importResult?.success ?? 0).toString()} />
            <ProgressRow color="text-red-500" icon={<XCircle size={16} />} label="失败" value={(importResult?.failed ?? 0).toString()} />
            <ProgressRow color="text-slate-400" icon={<AlertCircle size={16} />} label="跳过" value={(importResult?.skipped ?? 0).toString()} />
          </div>

          {importResult && importResult.errors.length > 0 && (
            <Notice tone="warning" title="失败记录">
              {importResult.errors.slice(0, 3).map((error) => `${error.filename}: ${error.reason}`).join("；")}
              {importResult.errors.length > 3 ? `；还有 ${importResult.errors.length - 3} 条失败记录` : ""}
            </Notice>
          )}

          <div className="mt-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-6 text-slate-500">
            <p>原图保存到：工作区 / 原图 / 主机导入</p>
            <p>缩略图保存到：工作区 / 缩略图</p>
            <p>预览图保存到：工作区 / 预览图</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ProgressRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2">
      <div className={cn("flex items-center gap-2", color)}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function completionRate(result: ImportStartData): number {
  if (result.total === 0) return 100;
  return Math.round(((result.success + result.failed + result.skipped) / result.total) * 100);
}

function isImportTaskStartData(data: ImportStartData | ImportTaskStartData): data is ImportTaskStartData {
  return typeof (data as ImportTaskStartData).taskId === "string";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getFilename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
