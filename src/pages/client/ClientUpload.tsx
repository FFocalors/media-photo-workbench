import { ImagePlus, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notice } from "../../components/ui/States";
import { ClientUploadData, EventData, fetchEvents, getClientApiBase, uploadClientImages } from "../../lib/api";
import { cn } from "../../lib/cn";

const visibleStatuses = new Set(["active", "reviewing", "draft"]);

export function ClientUploadPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [photographer, setPhotographer] = useState(localStorage.getItem("mediaPhotoWorkbench.clientUserName") || "");
  const [device, setDevice] = useState(localStorage.getItem("mediaPhotoWorkbench.clientDevice") || "");
  const [remark, setRemark] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ClientUploadData | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger" | "info"; title: string; body: string } | null>(null);

  const hostAddress = getClientApiBase();
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetchEvents("all");
      if (res.ok && res.data) {
        const available = res.data.filter((event) => visibleStatuses.has(event.status));
        setEvents(available);
        setSelectedEventId((current) => current || available[0]?.id || "");
        if (available.length === 0) {
          setMessage({ tone: "warning", title: "暂无可用活动", body: "主机当前没有可上传的活动。" });
        }
      } else {
        setMessage({ tone: "danger", title: "活动读取失败", body: res.error?.message || "无法读取主机活动。" });
      }
    } catch {
      setMessage({ tone: "danger", title: "主机未连接", body: "请先返回连接页完成连接测试。" });
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const handleUpload = async () => {
    if (!selectedEventId || files.length === 0) return;
    setUploading(true);
    setResult(null);
    setMessage(null);

    try {
      const res = await uploadClientImages(selectedEventId, {
        files,
        photographer,
        device,
        remark
      });
      if (res.ok && res.data) {
        setResult(res.data);
        setMessage({ tone: "success", title: "上传完成", body: `成功 ${res.data.success} 张，跳过 ${res.data.skipped} 张，失败 ${res.data.failed} 张。` });
      } else {
        setMessage({ tone: "danger", title: "上传失败", body: res.error?.message || "主机拒绝了本次上传。" });
      }
    } catch (err: any) {
      setMessage({ tone: "danger", title: "上传失败", body: err?.message || "请求失败，请检查主机连接。" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F8F9FA]">
      <div className="border-b border-slate-100 bg-white px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">客户端上传</h1>
            <p className="mt-1 text-sm text-slate-500">{hostAddress || "未连接主机"}</p>
          </div>
          <button
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => navigate("/client/photos")}
            type="button"
          >
            打开图片墙
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-5xl grid-cols-[1fr_320px] gap-6">
          <section className="space-y-6">
            {message && <Notice tone={message.tone} title={message.title}>{message.body}</Notice>}

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 font-semibold text-slate-900">上传信息</h2>
              <div className="grid grid-cols-2 gap-4">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">活动</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                    disabled={loadingEvents}
                    onChange={(event) => setSelectedEventId(event.target.value)}
                    value={selectedEventId}
                  >
                    {events.length === 0 && <option value="">暂无可用活动</option>}
                    {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                  </select>
                </label>
                <Field label="摄影师" onChange={setPhotographer} value={photographer} />
                <Field label="设备名" onChange={setDevice} value={device} />
                <Field label="备注" onChange={setRemark} value={remark} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">选择 JPG/JPEG 文件</h2>
                <span className="text-xs text-slate-400">{files.length} 个文件 / {formatBytes(totalSize)}</span>
              </div>
              <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center hover:border-blue-200 hover:bg-blue-50/30">
                <ImagePlus className="mb-4 text-slate-400" size={34} />
                <span className="text-sm font-medium text-slate-800">选择本机 JPG/JPEG 图片</span>
                <span className="mt-2 text-xs text-slate-400">支持多选，主机端会复制入库并生成缩略图和预览图</span>
                <input
                  accept=".jpg,.jpeg,image/jpeg"
                  className="hidden"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                  type="file"
                />
              </label>

              {files.length > 0 && (
                <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-100">
                  {files.map((file) => (
                    <div className="flex items-center justify-between border-b border-slate-50 px-4 py-2 text-sm last:border-b-0" key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <span className="truncate text-slate-700">{file.name}</span>
                      <span className="ml-4 shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                className={cn("mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white", selectedEventId && files.length > 0 && !uploading ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-slate-300")}
                disabled={!selectedEventId || files.length === 0 || uploading}
                onClick={handleUpload}
                type="button"
              >
                <UploadCloud size={17} />
                {uploading ? "上传中..." : "开始上传"}
              </button>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 font-semibold text-slate-900">上传结果</h2>
              {result ? (
                <div className="space-y-3 text-sm">
                  <ResultLine label="总数" value={result.total} />
                  <ResultLine label="成功" value={result.success} />
                  <ResultLine label="跳过" value={result.skipped} />
                  <ResultLine label="失败" value={result.failed} />
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-400">等待上传结果。</p>
              )}
            </div>

            {result?.errors.length ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-5">
                <h2 className="mb-3 font-semibold text-red-900">失败记录</h2>
                <div className="space-y-2">
                  {result.errors.map((error) => (
                    <div className="rounded-lg bg-white/70 px-3 py-2 text-xs text-red-800" key={`${error.filename}-${error.reason}`}>
                      <p className="font-medium">{error.filename}</p>
                      <p className="mt-1 opacity-80">{error.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
