import { AlertCircle, CheckCircle2, FolderOpen, Image, Loader2, Play, Search, UploadCloud, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Step } from "../../components/ui/FormControls";
import { Notice } from "../../components/ui/States";
import { EventData, fetchEvents, fetchTask, ImportScanData, ImportStartData, ImportTaskStartData, scanImportFolder, startImport, type TaskData } from "../../lib/api";
import { cn } from "../../lib/cn";
import { subscribeRealtimeTaskEvent } from "../../lib/socket";
import { formatTaskDuration, getTaskStats, taskStatusLabel } from "../../lib/taskStats";
import { CameraFtpImportPanel } from "../../components/import/CameraFtpImportPanel";

type MessageState = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  body: string;
};

type ImportSourceMode = "folder" | "files";
type ImportTab = "local" | "client" | "cameraFtp" | "remote";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

export function ImportPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [sourceMode, setSourceMode] = useState<ImportSourceMode>("folder");
  const [sourceFolder, setSourceFolder] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ImportTab>("local");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanResult, setScanResult] = useState<ImportScanData | null>(null);
  const [importResult, setImportResult] = useState<ImportStartData | null>(null);
  const [startedTask, setStartedTask] = useState<ImportTaskStartData | null>(null);
  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId), [events, selectedEventId]);
  const hasSelectedFiles = sourceMode === "files" && selectedFiles.length > 0;
  const canStartImport = sourceMode === "folder" ? Boolean(scanResult && scanResult.count > 0) : hasSelectedFiles;
  const displayTask = activeTask ?? createInitialImportTask(startedTask);
  const taskStats = getTaskStats(displayTask);
  const taskTerminal = Boolean(displayTask && (displayTask.status === "success" || displayTask.status === "failed" || displayTask.status === "cancelled"));
  const step = importing || (displayTask && !taskTerminal) ? 3 : importResult || taskTerminal ? 4 : scanResult || hasSelectedFiles ? 2 : 1;

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

  useEffect(() => {
    if (!startedTask?.taskId) {
      setActiveTask(null);
      return;
    }

    let cancelled = false;
    const taskId = startedTask.taskId;

    fetchTask(taskId)
      .then((res) => {
        if (!cancelled && res.ok && res.data) {
          setActiveTask(res.data);
        }
      })
      .catch(() => {
        // Socket updates will keep the panel moving when the initial fetch is unavailable.
      });

    const unsubscribe = subscribeRealtimeTaskEvent((payload) => {
      const payloadTaskId = payload.id || payload.taskId;
      if (payloadTaskId !== taskId) return;
      const task = {
        ...payload,
        id: payloadTaskId
      } as TaskData;
      setActiveTask(task);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [startedTask?.taskId]);

  const resetImportStateForNewSource = () => {
    setScanResult(null);
    setImportResult(null);
    setStartedTask(null);
    setActiveTask(null);
  };

  const applyDroppedFilesFallback = (paths: string[], unavailableReason?: string): boolean => {
    const supported = paths.filter((item) => SUPPORTED_IMAGE_EXTENSIONS.has(getExtension(item)));
    if (supported.length === 0) {
      setMessage({
        tone: "warning",
        title: "拖拽路径检查不可用",
        body: [
          "当前 Electron 主进程未加载拖拽路径检查能力，无法判断拖入内容是否为文件夹。",
          unavailableReason ? `原因：${unavailableReason}` : "",
          "请重启桌面应用后再拖拽文件夹，或使用“选择文件夹 / 选择图片文件”按钮。"
        ].filter(Boolean).join(" ")
      });
      return false;
    }

    setSourceMode("files");
    setSelectedFiles(supported);
    setSourceFolder("");
    resetImportStateForNewSource();
    setMessage({
      tone: unavailableReason ? "warning" : "info",
      title: unavailableReason ? "已使用兼容模式接收拖拽图片" : "已接收拖拽图片",
      body: [
        `已识别 ${supported.length} 个 JPG/JPEG/PNG 图片文件，可直接开始导入。`,
        unavailableReason ? "文件夹拖拽需要重启桌面应用以加载最新主进程能力。" : ""
      ].filter(Boolean).join(" ")
    });
    return true;
  };

  const handleDropPaths = async (paths: string[]) => {
    if (paths.length === 0) {
      setMessage({
        tone: "warning",
        title: "无法读取拖拽路径",
        body: "当前环境没有提供本机文件路径，请使用“选择文件夹”或“选择图片文件”按钮。"
      });
      return;
    }

    if (!window.mediaPhotoWorkbench?.inspectDroppedPaths) {
      applyDroppedFilesFallback(paths);
      return;
    }

    let inspected: DroppedPathInfo[] = [];
    try {
      inspected = await window.mediaPhotoWorkbench.inspectDroppedPaths(paths);
    } catch (err: any) {
      applyDroppedFilesFallback(paths, err?.message || "拖拽路径检查 IPC 未注册。");
      return;
    }
    const directories = inspected.filter((item) => item.isDirectory);
    const supportedFiles = inspected.filter((item) => item.isFile && item.supported).map((item) => item.path);
    const unsupported = inspected.filter((item) => item.isFile && !item.supported && !item.error);
    const failed = inspected.filter((item) => item.error);

    if (supportedFiles.length > 0) {
      setSourceMode("files");
      setSelectedFiles(supportedFiles);
      setSourceFolder("");
      resetImportStateForNewSource();

      const details = [
        `已接收 ${supportedFiles.length} 个 JPG/JPEG/PNG 图片文件，可直接开始导入。`,
        directories.length > 0 ? "检测到文件和文件夹混合拖入：本次优先导入拖入的图片文件，文件夹请单独拖入。" : "",
        unsupported.length > 0 ? `已跳过不支持格式：${unsupported.slice(0, 5).map((item) => item.name).join("、")}${unsupported.length > 5 ? " 等" : ""}` : "",
        failed.length > 0 ? `有 ${failed.length} 个路径无法读取。` : ""
      ].filter(Boolean).join(" ");

      setMessage({ tone: unsupported.length > 0 || directories.length > 0 || failed.length > 0 ? "warning" : "info", title: "已接收拖拽图片", body: details });
      return;
    }

    if (directories.length > 0) {
      const folder = directories[0];
      setSourceMode("folder");
      setSourceFolder(folder.path);
      setSelectedFiles([]);
      resetImportStateForNewSource();

      setMessage({
        tone: directories.length > 1 || unsupported.length > 0 || failed.length > 0 ? "warning" : "info",
        title: "已接收拖拽文件夹",
        body: [
          `已选择文件夹“${folder.name || folder.path}”，点击扫描后会统计第一层 JPG/JPEG/PNG 图片。`,
          directories.length > 1 ? `本次只使用第一个文件夹，另外 ${directories.length - 1} 个文件夹未处理。` : "",
          unsupported.length > 0 ? `已跳过不支持格式：${unsupported.slice(0, 5).map((item) => item.name).join("、")}${unsupported.length > 5 ? " 等" : ""}` : "",
          failed.length > 0 ? `有 ${failed.length} 个路径无法读取。` : ""
        ].filter(Boolean).join(" ")
      });
      return;
    }

    setMessage({
      tone: "warning",
      title: "未找到支持的图片",
      body: unsupported.length > 0
        ? `拖入内容中没有 JPG/JPEG/PNG 图片。已跳过：${unsupported.slice(0, 5).map((item) => item.name).join("、")}${unsupported.length > 5 ? " 等" : ""}`
        : "请拖入 JPG、JPEG、PNG 图片文件或包含这些图片的文件夹。"
    });
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragActive) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setDragActive(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    if (importing) {
      setMessage({ tone: "warning", title: "导入任务进行中", body: "请等待当前导入任务结束或取消后再拖入新的图片。" });
      return;
    }

    try {
      await handleDropPaths(getDroppedPathsFromEvent(event));
    } catch (err: any) {
      setMessage({ tone: "danger", title: "拖拽导入失败", body: err?.message || "无法处理拖入内容。" });
    }
  };

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
      setActiveTask(null);
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
      setActiveTask(null);
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
    setActiveTask(null);

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
    setActiveTask(null);

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
          <p className="mt-1 text-sm text-slate-500">集中管理主机本地、客户端上传和相机 FTP 等图片来源</p>
        </div>
      </div>

      <div className="mx-auto mb-6 w-full max-w-6xl">
        <ImportTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "local" && (
        <>
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
          <h3 className="mb-5 font-medium text-slate-900">导入设置</h3>

          <div className="flex-1 space-y-5 overflow-y-auto pr-2">
            {message && <Notice tone={message.tone} title={message.title}>{message.body}</Notice>}

            <div
              className={cn(
                "rounded-2xl border border-dashed p-5 transition-colors",
                dragActive ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50/70 hover:border-blue-200 hover:bg-blue-50/30"
              )}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:text-left">
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", dragActive ? "bg-blue-600 text-white" : "bg-white text-blue-600")}>
                  <UploadCloud size={22} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">拖拽图片文件或文件夹到这里导入</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    支持 JPG、JPEG、PNG；文件夹仅扫描第一层；暂不支持 RAW、HEIC、视频。
                  </p>
                </div>
              </div>
            </div>

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
              setActiveTask(null);
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
            <div className="mb-3 text-4xl font-bold text-slate-900">
              {importResult ? completionRate(importResult) : displayTask ? taskStats.percent : scanResult ? "0" : "--"}
              {(importResult || displayTask) && <span className="text-2xl">%</span>}
            </div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all", displayTask?.status === "failed" ? "bg-red-500" : displayTask?.status === "success" ? "bg-emerald-500" : "bg-blue-600")}
                style={{ width: `${importResult ? completionRate(importResult) : displayTask ? Math.max(taskStats.percent, displayTask.status === "pending" ? 4 : 8) : 0}%` }}
              />
            </div>
            <div className="space-y-1 text-sm text-slate-500">
              <p>
                {importResult
                  ? `已处理 ${importResult.total} 张`
                  : displayTask
                    ? `${taskStatusLabel(displayTask.status)} · 已处理 ${taskStats.processed}/${taskStats.total || 0} 张`
                    : scanResult
                      ? `待导入 ${scanResult.count} 张`
                      : hasSelectedFiles
                        ? `待导入 ${selectedFiles.length} 张`
                        : "等待选择导入来源"}
              </p>
              {displayTask && (displayTask.status === "running" || displayTask.status === "pending") && (
                <p className="text-xs text-slate-400">
                  已用 {formatTaskDuration(taskStats.elapsedMs)} · 剩余 {formatTaskDuration(taskStats.estimatedRemainingMs)}
                  {taskStats.currentFileName ? ` · ${taskStats.currentFileName}` : ""}
                </p>
              )}
            </div>
          </div>

          <div className="mb-8 space-y-4">
            <ProgressRow color="text-emerald-600" icon={<CheckCircle2 size={16} />} label="成功" value={(displayTask ? taskStats.success : importResult?.success ?? 0).toString()} />
            <ProgressRow color="text-red-500" icon={<XCircle size={16} />} label="失败" value={(displayTask ? taskStats.failed : importResult?.failed ?? 0).toString()} />
            <ProgressRow color="text-slate-400" icon={<AlertCircle size={16} />} label="跳过" value={(displayTask ? taskStats.skipped : importResult?.skipped ?? 0).toString()} />
          </div>

          {((displayTask && taskStats.errors.length > 0) || (importResult && importResult.errors.length > 0)) && (
            <Notice tone="warning" title="失败记录">
              {(displayTask ? taskStats.errors : importResult?.errors ?? []).slice(0, 3).map((error) => `${error.filename || "未知文件"}: ${error.reason}`).join("；")}
              {(displayTask ? taskStats.errors.length : importResult?.errors.length ?? 0) > 3 ? `；还有 ${(displayTask ? taskStats.errors.length : importResult?.errors.length ?? 0) - 3} 条失败记录` : ""}
            </Notice>
          )}

          <div className="mt-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-6 text-slate-500">
            <p>原图保存到：工作区 / 原图 / 主机导入</p>
            <p>缩略图保存到：工作区 / 缩略图</p>
            <p>预览图保存到：工作区 / 预览图</p>
          </div>
        </div>
      </div>
        </>
      )}

      {activeTab === "client" && (
        <ImportPlaceholder
          badge="client_upload"
          title="客户端上传"
          body="客户端上传仍由连接到主机的客户端页面发起。主机端在这里保留入口说明，不新增新的上传流程。"
          items={[
            "客户端连接主机后选择活动、摄影师和设备名。",
            "客户端上传 JPG / JPEG / PNG 后，主机入库并生成缩略图和预览图。",
            "图片墙、任务中心和最近动态继续显示客户端上传结果。"
          ]}
        />
      )}

      {activeTab === "cameraFtp" && (
        <div className="mx-auto w-full max-w-6xl">
          <CameraFtpImportPanel />
        </div>
      )}

      {activeTab === "remote" && (
        <ImportPlaceholder
          badge="remote_import"
          title="远程传输（预留）"
          body="远程传输仍是后续预留能力，本阶段不启用公网 FTP、SFTP、隧道或远程图片墙。"
          items={[
            "不会启动真实远程传输监听。",
            "不会内置 ngrok、云中继或公网服务。",
            "当前只保留远程导入目录和后续扩展说明。"
          ]}
        />
      )}
    </div>
  );
}

function ImportTabs({ activeTab, onChange }: { activeTab: ImportTab; onChange: (tab: ImportTab) => void }) {
  const tabs: Array<{ key: ImportTab; label: string }> = [
    { key: "local", label: "本地导入" },
    { key: "client", label: "客户端上传" },
    { key: "cameraFtp", label: "相机 FTP" },
    { key: "remote", label: "远程传输（预留）" }
  ];

  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          className={cn(
            "border-b-2 px-2 pb-3 text-sm font-medium transition-colors",
            activeTab === tab.key
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ImportPlaceholder({ badge, title, body, items }: { badge: string; title: string; body: string; items: string[] }) {
  return (
    <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{body}</p>
        </div>
        <span className="rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">{badge}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600" key={item}>{item}</div>
        ))}
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

function createInitialImportTask(task: ImportTaskStartData | null): TaskData | null {
  if (!task) return null;
  const now = new Date().toISOString();
  return {
    id: task.taskId,
    type: "host_import",
    eventId: "",
    title: `导入 ${task.total} 张图片`,
    status: "pending",
    total: task.total,
    finished: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: [],
    result: null,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    finishedAt: "",
    elapsedMs: 0,
    estimatedRemainingMs: null,
    currentFileName: ""
  };
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

function getExtension(filePath: string): string {
  const filename = getFilename(filePath);
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function getDroppedPathsFromEvent(event: React.DragEvent<HTMLElement>): string[] {
  const paths = Array.from(event.dataTransfer.files ?? [])
    .map((file) => {
      const directPath = (file as File & { path?: string }).path;
      if (directPath) {
        return directPath;
      }
      return window.mediaPhotoWorkbench?.getPathForFile?.(file) || "";
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(paths));
}
