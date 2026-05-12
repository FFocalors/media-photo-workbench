import { CheckCircle2, FolderOpen, HardDrive, Info, Keyboard, Network, RotateCcw, Save, AlertTriangle, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Notice, StatusPill } from "../../components/ui/States";
import { cn } from "../../lib/cn";
import { fetchSettings, updateRepositoryPath, checkRepository, type RepositoryCheckResponse } from "../../lib/api";

type SettingsTab = "general" | "repository" | "network" | "import" | "export" | "shortcuts" | "about";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "常规设置" },
  { id: "repository", label: "仓库设置" },
  { id: "network", label: "局域网设置" },
  { id: "import", label: "导入设置" },
  { id: "export", label: "导出设置" },
  { id: "shortcuts", label: "快捷键" },
  { id: "about", label: "关于" }
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("repository");
  const [repositoryPath, setRepositoryPath] = useState("D:\\MediaPhoto\\Repository");
  const [databasePath, setDatabasePath] = useState("./data/app.db");
  const [port, setPort] = useState("3030");
  const [jpegQuality, setJpegQuality] = useState(90);
  const [keepDuplicates, setKeepDuplicates] = useState(false);
  const [checkResult, setCheckResult] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [repoCheck, setRepoCheck] = useState<RepositoryCheckResponse | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const title = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label ?? "系统设置", [activeTab]);

  // 页面加载时尝试从后端获取真实配置
  useEffect(() => {
    let cancelled = false;
    fetchSettings().then((res) => {
      if (cancelled) return;
      if (res && res.ok && res.data) {
        setApiAvailable(true);
        setRepositoryPath(res.data.repository.path || "");
        setPort(String(res.data.server.port));
        setDatabasePath(res.data.database.path);
      } else {
        setApiAvailable(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleCheckRepository = async () => {
    setCheckResult("loading");
    const res = await checkRepository();
    if (res && res.ok && res.data) {
      setRepoCheck(res.data);
      setCheckResult(res.data.exists && res.data.readable && res.data.writable ? "ok" : "error");
    } else {
      setCheckResult("error");
      setRepoCheck(null);
      alert(res?.error?.message || "请求失败，请确保后端服务正常运行");
    }
  };

  const handleSaveRepository = async () => {
    setSaving(true);
    const res = await updateRepositoryPath(repositoryPath);
    if (res && res.ok && res.data) {
      setRepoCheck(res.data);
      setCheckResult(res.data.exists && res.data.readable && res.data.writable ? "ok" : "error");
      alert("保存成功");
    } else {
      setCheckResult("error");
      alert(res?.error?.message || "保存失败");
    }
    setSaving(false);
  };

  const handleBrowse = async () => {
    const path = await window.mediaPhotoWorkbench?.selectDirectory();
    if (path) {
      setRepositoryPath(path);
    }
  };

  const handleOpenFolder = async () => {
    if (!repositoryPath) {
      alert("请先设置仓库路径");
      return;
    }
    await window.mediaPhotoWorkbench?.openPath(repositoryPath);
  };

  return (
    <div className="flex flex-1 gap-8 overflow-y-auto bg-[#F8F9FA] p-8">
      <aside className="w-48 shrink-0">
        <h2 className="mb-6 text-xl font-bold text-slate-900">系统设置</h2>
        <div className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                activeTab === tab.id ? "border border-slate-100 bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:bg-slate-100"
              )}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="max-w-3xl flex-1">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {activeTab === "repository" && (
              <button
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={saving}
                onClick={handleSaveRepository}
                type="button"
              >
                <Save size={16} />
                {saving ? "保存中..." : "保存"}
              </button>
            )}
            {activeTab !== "about" && activeTab !== "repository" && (
              <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700" type="button">
                <Save size={16} />
                保存 mock
              </button>
            )}
          </div>

          {activeTab === "general" && (
            <div className="space-y-6">
              <SettingSwitch checked label="启动后显示最近使用" note="保留主机/客户端入口和最近连接记录。" />
              <SettingSwitch checked label="浅色界面" note="第一版固定浅色界面，后续可扩展深色模式。" />
              <SettingSwitch label="启动后自动进入上次模式" note="当前保持手动选择主机或客户端。" />
            </div>
          )}

          {activeTab === "repository" && (
            <div className="space-y-8">
              {apiAvailable === false && (
                <Notice tone="warning" title="后端服务未连接">
                  无法连接后端 API，当前显示为本地状态。启动 Electron 后端口 3030 可用时将自动加载真实数据。
                </Notice>
              )}

              <Notice tone="info" title="仓库路径可更改">
                图片仓库可以放在移动 SSD 或本机磁盘；数据库仍保存在软件数据目录，不跟随仓库移动。
              </Notice>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">当前仓库路径</label>
                <div className="flex gap-3">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600"
                    onChange={(event) => setRepositoryPath(event.target.value)}
                    value={repositoryPath}
                  />
                  <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" onClick={handleBrowse}>
                    浏览...
                  </button>
                  <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" onClick={handleOpenFolder}>打开文件夹</button>
                </div>
              </div>

              <Divider />

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">数据库位置</label>
                <p className="mb-3 text-sm text-slate-600">{databasePath}</p>
                <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button">立即备份</button>
              </div>

              <Divider />

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">读写权限</label>
                <p className="mb-3 text-sm text-slate-600">定期检查仓库目录的读写权限，确保文件正常保存。</p>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={checkResult === "loading"}
                  onClick={handleCheckRepository}
                  type="button"
                >
                  {checkResult === "loading" ? "检查中..." : "检查可读写"}
                </button>

                {checkResult === "ok" && (
                  <Notice className="mt-3" tone="success" title="仓库检查通过">
                    {repoCheck
                      ? `仓库路径可读写：${repoCheck.path}`
                      : "仓库路径可读写，剩余空间满足当前活动导入和导出流程。"}
                  </Notice>
                )}

                {checkResult === "error" && repoCheck && (
                  <Notice className="mt-3" tone="warning" title="仓库检查异常">
                    {!repoCheck.exists && "路径不存在。"}
                    {repoCheck.exists && !repoCheck.readable && "路径不可读。"}
                    {repoCheck.exists && !repoCheck.writable && "路径不可写。"}
                    {` 路径：${repoCheck.path}`}
                  </Notice>
                )}
              </div>
            </div>
          )}

          {activeTab === "network" && (
            <div className="space-y-6">
              <SettingField label="主机服务端口" onChange={setPort} value={port} />
              <InfoCard icon={<Network size={18} />} title="访问地址">
                <p>本机访问：http://localhost:{port}</p>
                <p>局域网访问：http://192.168.1.108:{port}</p>
                <p>热点模式：http://192.168.137.1:{port}</p>
              </InfoCard>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">后端服务端口</span>
                <StatusPill tone={port === "3030" ? "success" : "warning"}>{port === "3030" ? "3030 已配置" : "非默认端口"}</StatusPill>
              </div>
              {apiAvailable !== null && (
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">后端服务状态</span>
                  <StatusPill tone={apiAvailable ? "success" : "warning"}>{apiAvailable ? "已连接" : "未连接"}</StatusPill>
                </div>
              )}
              <InfoCard icon={<Info size={18} />} title="校园网提示">
                <p>如果校园网设备隔离导致无法连接，请使用 Windows 热点模式，并确认防火墙允许访问。</p>
              </InfoCard>
            </div>
          )}

          {activeTab === "import" && (
            <div className="space-y-6">
              <SettingSwitch checked label="导入时生成缩略图" note="thumb 长边 400px，WebP。" />
              <SettingSwitch checked label="导入时生成预览图" note="preview 长边 1600px，WebP。" />
              <SettingSwitch checked={!keepDuplicates} label="重复图片默认跳过" note="按文件名、大小、EXIF 和 hash 判断。" onClick={() => setKeepDuplicates((value) => !value)} />
              <SettingSwitch label="远程传输自动监听" note="第一版仅保留入口，不启动真实 SFTP/FTP 监听。" />
            </div>
          )}

          {activeTab === "export" && (
            <div className="space-y-6">
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">JPEG 质量</span>
                <input
                  className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
                  max={100}
                  min={1}
                  onChange={(event) => setJpegQuality(Number(event.target.value))}
                  type="number"
                  value={jpegQuality}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <SpecCard label="原尺寸" />
                <SpecCard label="长边 3000px" active />
                <SpecCard label="长边 1920px" />
              </div>
              <SettingSwitch checked label="导出后记录 export_jobs" note="下载日志与导出任务分开记录。" />
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="grid grid-cols-2 gap-3">
              {[
                ["1-5", "打星"],
                ["0", "清除星级"],
                ["X", "废片"],
                ["E", "待修图"],
                ["P", "可发布"],
                ["← / →", "上一张 / 下一张"],
                ["Esc", "关闭预览"]
              ].map(([keyName, value]) => (
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3" key={keyName}>
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Keyboard size={15} />
                    {value}
                  </span>
                  <kbd className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">{keyName}</kbd>
                </div>
              ))}
            </div>
          )}

          {activeTab === "about" && (
            <div className="space-y-5">
              <InfoCard icon={<HardDrive size={18} />} title="Media Photo Workbench">
                <p>融媒体图片工作台 · 后端第一阶段</p>
                <p>桌面端：Electron + React + Vite + TypeScript + Tailwind</p>
                <p>后端：Express + SQLite + better-sqlite3 + pino</p>
              </InfoCard>
              <InfoCard icon={<FolderOpen size={18} />} title="当前约束">
                <p>第一版仅支持 JPG/JPEG；后端主机服务默认端口为 3030。</p>
              </InfoCard>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">后端 API</span>
                <StatusPill tone={apiAvailable ? "success" : "warning"}>{apiAvailable ? "已连接" : "未连接"}</StatusPill>
              </div>
              <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button">
                <RotateCcw size={16} />
                检查更新
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-100" />;
}

function SettingField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SettingSwitch({ label, note, checked = false, onClick }: { label: string; note: string; checked?: boolean; onClick?: () => void }) {
  return (
    <button className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left" onClick={onClick} type="button">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-1 block text-xs text-slate-500">{note}</span>
      </span>
      <span className={cn("relative h-6 w-11 rounded-full transition-colors", checked ? "bg-blue-600" : "bg-slate-300")}>
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="mt-0.5 text-blue-600">{icon}</div>
      <div>
        <h4 className="mb-2 text-sm font-medium text-slate-900">{title}</h4>
        <div className="space-y-1 text-sm leading-6 text-slate-600">{children}</div>
      </div>
    </div>
  );
}

function SpecCard({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm font-medium", active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-100 bg-slate-50 text-slate-600")}>
      {label}
    </div>
  );
}
