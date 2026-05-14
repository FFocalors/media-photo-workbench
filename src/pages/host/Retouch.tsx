import { AlertTriangle, CheckCircle2, Download, FileArchive, ImageOff, PackageCheck, UploadCloud } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Notice } from "../../components/ui/States";
import {
  createEditPackage,
  downloadEditPackage,
  EditedUploadData,
  EditPackageData,
  EventData,
  EventImageData,
  fetchEventImages,
  fetchEvents,
  uploadEditedImages
} from "../../lib/api";
import { cn } from "../../lib/cn";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);
const supportedEditedExtensions = new Set([".jpg", ".jpeg"]);

interface DroppedFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
}

function isSupportedEditedImage(file: File): boolean {
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";
  return supportedEditedExtensions.has(extension);
}

async function readFileEntry(entry: DroppedFileSystemEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("无法读取拖入的文件"));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(entry: DroppedFileSystemEntry): Promise<DroppedFileSystemEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];

  const entries: DroppedFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
}

async function collectDroppedFiles(entry: DroppedFileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [await readFileEntry(entry)];
  }
  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry);
  const nested = await Promise.all(children.map(collectDroppedFiles));
  return nested.flat();
}

async function getDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.() as DroppedFileSystemEntry | null | undefined)
    .filter((entry): entry is DroppedFileSystemEntry => Boolean(entry));

  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }

  const files = await Promise.all(entries.map(collectDroppedFiles));
  return files.flat();
}

export function RetouchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.includes("done") ? "done" : "todo";
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [editImages, setEditImages] = useState<EventImageData[]>([]);
  const [editTotal, setEditTotal] = useState(0);
  const [editedTotal, setEditedTotal] = useState(0);
  const [lastPackage, setLastPackage] = useState<EditPackageData | null>(null);
  const [uploadResult, setUploadResult] = useState<EditedUploadData | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [downloadingPackage, setDownloadingPackage] = useState(false);
  const [uploadingEdited, setUploadingEdited] = useState(false);

  const originalMissingCount = useMemo(() => editImages.filter((image) => !image.original_exists).length, [editImages]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "请先创建活动并导入图片，再进入修图流转。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取活动列表。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "后端服务未连接", body: "请通过 pnpm dev 启动完整应用。" });
    }
  }, []);

  const loadStats = useCallback(async () => {
    if (!selectedEventId) {
      setEditImages([]);
      setEditTotal(0);
      setEditedTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [editRes, editedRes] = await Promise.all([
        fetchEventImages(selectedEventId, { status: "edit", pageSize: 200 }),
        fetchEventImages(selectedEventId, { status: "edited", pageSize: 1 })
      ]);

      if (editRes.ok && editRes.data) {
        setEditImages(editRes.data.items);
        setEditTotal(editRes.data.total);
      } else {
        setMessage({ tone: "danger", title: "待修图读取失败", body: editRes.error?.message || "无法读取待修图。" });
      }

      if (editedRes.ok && editedRes.data) {
        setEditedTotal(editedRes.data.total);
      } else {
        setMessage({ tone: "danger", title: "已修图读取失败", body: editedRes.error?.message || "无法读取已修图。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "修图数据读取失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleCreatePackage = async () => {
    if (!selectedEventId) return;
    setCreatingPackage(true);
    setMessage(null);

    try {
      const res = await createEditPackage(selectedEventId);
      if (res.ok && res.data) {
        setLastPackage(res.data);
        setMessage({ tone: "success", title: "待修包已生成", body: `成功打包 ${res.data.success} 张，跳过 ${res.data.skipped} 张。` });
      } else {
        const tone = res.error?.code === "NO_EDIT_IMAGES" ? "warning" : "danger";
        setMessage({ tone, title: "待修包生成失败", body: res.error?.message || "生成待修包失败。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包生成失败", body: err?.message || "请求失败。" });
    } finally {
      setCreatingPackage(false);
    }
  };

  const handleDownloadPackage = async () => {
    if (!lastPackage) return;
    setDownloadingPackage(true);
    try {
      await downloadEditPackage(lastPackage.packageId);
      setMessage({ tone: "success", title: "下载已开始", body: "待修包 ZIP 已开始下载。" });
    } catch (err: any) {
      setMessage({ tone: "danger", title: "待修包下载失败", body: err?.message || "下载失败。" });
    } finally {
      setDownloadingPackage(false);
    }
  };

  const handleUploadComplete = (result: EditedUploadData) => {
    setUploadResult(result);
    setMessage({ tone: "success", title: "已修图上传完成", body: `匹配 ${result.matched} 张，未匹配 ${result.unmatched} 张。` });
    void loadStats();
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">修图流转</h1>
          <p className="mt-1 text-sm text-slate-500">生成待修包，回传已修图，并将图片状态同步为已修图。</p>
        </div>
        <label className="min-w-72">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            onChange={(event) => {
              setSelectedEventId(event.target.value);
              setLastPackage(null);
              setUploadResult(null);
              setMessage(null);
            }}
            value={selectedEventId}
          >
            {events.length === 0 && <option value="">暂无可用活动</option>}
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-4">
        <MetricCard icon={<PackageCheck size={18} />} label="待修图" loading={loading} value={editTotal} />
        <MetricCard icon={<CheckCircle2 size={18} />} label="已修图" loading={loading} value={editedTotal} />
        <MetricCard icon={<ImageOff size={18} />} label="原图缺失" loading={loading} tone="danger" value={originalMissingCount} />
        <MetricCard icon={<FileArchive size={18} />} label="最近待修包" textValue={lastPackage ? `${lastPackage.success}/${lastPackage.total}` : "未生成"} />
      </div>

      {message && <Notice className="mb-6" tone={message.tone} title={message.title}>{message.body}</Notice>}

      <div className="mb-6 flex border-b border-slate-200">
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "todo" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/retouch")}
          type="button"
        >
          待修包
        </button>
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "done" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/done")}
          type="button"
        >
          已修图回传
        </button>
      </div>

      {tab === "todo" ? (
        <RetouchTodo
          canCreate={Boolean(selectedEventId)}
          creatingPackage={creatingPackage}
          downloadingPackage={downloadingPackage}
          editImages={editImages}
          editTotal={editTotal}
          lastPackage={lastPackage}
          onCreatePackage={handleCreatePackage}
          onDownloadPackage={handleDownloadPackage}
        />
      ) : (
        <RetouchDone
          canUpload={Boolean(selectedEventId)}
          selectedEventId={selectedEventId}
          uploadResult={uploadResult}
          uploading={uploadingEdited}
          onResult={handleUploadComplete}
          onSetMessage={setMessage}
          onUploadingChange={setUploadingEdited}
        />
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, textValue, loading = false, tone = "default" }: {
  icon: ReactNode;
  label: string;
  value?: number;
  textValue?: string;
  loading?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg", tone === "danger" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600")}>{icon}</div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{loading ? "..." : textValue ?? (value ?? 0).toLocaleString()}</p>
    </div>
  );
}

function RetouchTodo({ canCreate, creatingPackage, downloadingPackage, editImages, editTotal, lastPackage, onCreatePackage, onDownloadPackage }: {
  canCreate: boolean;
  creatingPackage: boolean;
  downloadingPackage: boolean;
  editImages: EventImageData[];
  editTotal: number;
  lastPackage: EditPackageData | null;
  onCreatePackage: () => void;
  onDownloadPackage: () => void;
}) {
  const missing = editImages.filter((image) => !image.original_exists);

  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">待修包生成</h3>
          <p className="mt-1 text-xs text-slate-500">
            当前活动有 {editTotal.toLocaleString()} 张图片被标记为“待修图”。
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canCreate || creatingPackage}
            onClick={onCreatePackage}
            type="button"
          >
            <FileArchive size={16} />
            {creatingPackage ? "生成中..." : "生成待修包"}
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!lastPackage || downloadingPackage}
            onClick={onDownloadPackage}
            type="button"
          >
            <Download size={16} />
            {downloadingPackage ? "下载中..." : "下载待修包"}
          </button>
        </div>
      </div>

      {editTotal === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-100 bg-slate-50 p-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
            <PackageCheck className="text-slate-400" size={28} />
          </div>
          <p className="text-sm font-medium text-slate-700">暂无待修图片，请先在图片墙将图片标记为“待修图”。</p>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[1fr_320px] gap-6">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <h4 className="mb-3 text-sm font-medium text-slate-700">待修图片预览</h4>
            <div className="grid grid-cols-4 gap-3">
              {editImages.slice(0, 12).map((image) => (
                <div className="overflow-hidden rounded-lg border border-slate-100 bg-white" key={image.id}>
                  <img alt={image.original_filename} className="h-20 w-full object-cover" src={image.thumb_url} />
                  <p className="truncate px-2 py-1 text-xs text-slate-500">{image.original_filename}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-100 p-4">
              <h4 className="text-sm font-medium text-slate-700">最近生成</h4>
              {lastPackage ? (
                <div className="mt-3 text-xs leading-6 text-slate-500">
                  <p>总数：{lastPackage.total}</p>
                  <p>成功：{lastPackage.success}</p>
                  <p>跳过：{lastPackage.skipped}</p>
                  <p className="truncate" title={lastPackage.packagePath}>路径：{lastPackage.packagePath}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">尚未生成待修包。</p>
              )}
            </div>

            {missing.length > 0 && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                <h4 className="flex items-center gap-2 text-sm font-medium text-red-800">
                  <AlertTriangle size={15} />
                  原图缺失
                </h4>
                <div className="mt-3 space-y-2">
                  {missing.slice(0, 5).map((image) => <p className="truncate text-xs text-red-700" key={image.id}>{image.original_filename}</p>)}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function RetouchDone({ canUpload, selectedEventId, uploadResult, uploading, onResult, onSetMessage, onUploadingChange }: {
  canUpload: boolean;
  selectedEventId: string;
  uploadResult: EditedUploadData | null;
  uploading: boolean;
  onResult: (result: EditedUploadData) => void;
  onSetMessage: (message: { tone: "success" | "warning" | "danger" | "info"; title: string; body: string }) => void;
  onUploadingChange: (value: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [editedFiles, setEditedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const handleSelectFiles = (files: File[] | FileList | null) => {
    const selected = Array.from(files ?? []);
    const manifest = selected.find((file) => file.name.toLowerCase() === "edit_manifest.json") ?? null;
    setManifestFile(manifest);
    setEditedFiles(selected.filter((file) => file.name.toLowerCase() !== "edit_manifest.json" && isSupportedEditedImage(file)));
  };

  const handleDropFiles = async (dataTransfer: DataTransfer) => {
    try {
      const files = await getDroppedFiles(dataTransfer);
      handleSelectFiles(files);
    } catch (err: any) {
      onSetMessage({ tone: "danger", title: "读取拖拽文件失败", body: err?.message || "无法读取拖入的文件夹或文件。" });
    }
  };

  const handleUpload = async () => {
    if (!selectedEventId || editedFiles.length === 0) return;
    onUploadingChange(true);
    try {
      const res = await uploadEditedImages(selectedEventId, {
        files: editedFiles,
        manifestFile
      });
      if (res.ok && res.data) {
        onResult(res.data);
      } else {
        onSetMessage({ tone: "danger", title: "已修图上传失败", body: res.error?.message || "上传失败。" });
      }
    } catch (err: any) {
      onSetMessage({ tone: "danger", title: "已修图上传失败", body: err?.message || "请求失败。" });
    } finally {
      onUploadingChange(false);
    }
  };

  return (
    <div className="flex min-h-[520px] flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">已修图回传</h3>
          <p className="mt-1 text-xs text-slate-500">可直接拖入待修包里的“已修图回传”文件夹；系统会读取其中的 edit_manifest.json 和 JPG/JPEG。</p>
        </div>
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            选择文件
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canUpload || editedFiles.length === 0 || uploading}
            onClick={handleUpload}
            type="button"
          >
            <UploadCloud size={16} />
            {uploading ? "上传中..." : "上传已修图"}
          </button>
        </div>
      </div>

      <input
        accept=".jpg,.jpeg,image/jpeg,.json,application/json"
        className="hidden"
        multiple
        onChange={(event) => handleSelectFiles(event.target.files)}
        ref={inputRef}
        type="file"
      />

      <div className="grid flex-1 grid-cols-[1fr_340px] gap-6">
        <div
          className={cn(
            "rounded-xl border border-dashed p-5 transition-colors",
            dragActive ? "border-blue-300 bg-blue-50/70" : "border-slate-100 bg-slate-50"
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void handleDropFiles(event.dataTransfer);
          }}
        >
          <h4 className="mb-4 text-sm font-medium text-slate-700">待上传文件</h4>
          {editedFiles.length === 0 && !manifestFile ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
              <UploadCloud className={cn("mb-4", dragActive ? "text-blue-500" : "text-slate-300")} size={34} />
              <p className="text-sm font-medium text-slate-600">拖入“已修图回传”文件夹，或选择已修图 JPG/JPEG</p>
              <p className="mt-2 text-xs text-slate-400">文件夹内已包含 edit_manifest.json；完全改名的图片仍建议保留 manifest。</p>
            </div>
          ) : (
            <div className="space-y-2">
              {manifestFile && <FileRow label="manifest" name={manifestFile.name} />}
              {editedFiles.map((file) => <FileRow key={`${file.name}-${file.size}-${file.lastModified}`} label="已修图" name={file.name} />)}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <h4 className="text-sm font-medium text-slate-700">匹配结果</h4>
            {uploadResult ? (
              <div className="mt-3 space-y-2 text-sm">
                <ResultLine label="总数" value={uploadResult.total} />
                <ResultLine label="成功匹配" value={uploadResult.matched} />
                <ResultLine label="未匹配" value={uploadResult.unmatched} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">等待上传。</p>
            )}
          </div>

          {uploadResult?.items.length ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <h4 className="text-sm font-medium text-emerald-800">成功记录</h4>
              <div className="mt-3 space-y-2">
                {uploadResult.items.slice(0, 6).map((item) => (
                  <p className="truncate text-xs text-emerald-700" key={`${item.imageId}-${item.uploadedFilename}`}>
                    {item.uploadedFilename} {"->"} {item.originalFilename}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {uploadResult?.errors.length ? (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <h4 className="text-sm font-medium text-red-800">失败记录</h4>
              <div className="mt-3 space-y-2">
                {uploadResult.errors.slice(0, 8).map((error) => (
                  <div className="text-xs text-red-700" key={`${error.filename}-${error.reason}`}>
                    <p className="truncate font-medium">{error.filename}</p>
                    <p className="mt-0.5 opacity-80">{error.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FileRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
      <span className="min-w-0 truncate text-slate-700">{name}</span>
      <span className="ml-3 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{label}</span>
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value.toLocaleString()}</span>
    </div>
  );
}
