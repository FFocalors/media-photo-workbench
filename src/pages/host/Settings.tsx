import { Bug, Clipboard, FolderOpen, Github, Info, Keyboard, Mail, Network, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "../../components/common/BrandLogo";
import { Notice, StatusPill, TransientNotice } from "../../components/ui/States";
import { cn } from "../../lib/cn";
import {
  backupDatabaseNow,
  checkRepository,
  eventStatusLabels,
  fetchEvents,
  fetchDatabaseBackups,
  fetchCameraFtpDiagnostics,
  fetchHealth,
  fetchSettings,
  getApiBase,
  migrateDatabaseLocation,
  updateGallerySettings,
  type DatabaseBackupData,
  type DatabaseBackupListItem,
  type EventData,
  type HealthData,
  type BatchSelectionBehavior,
  type CameraFtpDiagnosticData,
  type RepositoryCheckData,
  type SettingsData
} from "../../lib/api";
import { updateRepositoryPath } from "../../lib/api";

type SettingsTab = "general" | "repository" | "network" | "diagnostics" | "import" | "export" | "shortcuts" | "about";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "常规设置" },
  { id: "repository", label: "仓库设置" },
  { id: "network", label: "局域网设置" },
  { id: "diagnostics", label: "故障排查" },
  { id: "import", label: "导入设置" },
  { id: "export", label: "导出设置" },
  { id: "shortcuts", label: "快捷键" },
  { id: "about", label: "关于" }
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("repository");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [savedRepositoryPath, setSavedRepositoryPath] = useState("");
  const [databasePath, setDatabasePath] = useState("./data/app.db");
  const [databaseLastAutoBackupAt, setDatabaseLastAutoBackupAt] = useState("");
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackupListItem[]>([]);
  const [databaseBackupResult, setDatabaseBackupResult] = useState<DatabaseBackupData | null>(null);
  const [databaseBackupLoading, setDatabaseBackupLoading] = useState(false);
  const [databaseMigrationLoading, setDatabaseMigrationLoading] = useState(false);
  const [databaseMessage, setDatabaseMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; body: string } | null>(null);
  const [port, setPort] = useState("3030");
  const [jpegQuality, setJpegQuality] = useState(90);
  const [keepDuplicates, setKeepDuplicates] = useState(false);
  const [checkResult, setCheckResult] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [repoCheck, setRepoCheck] = useState<RepositoryCheckData | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [repositoryMessage, setRepositoryMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; body: string } | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; body: string } | null>(null);
  const [diagnosticPreview, setDiagnosticPreview] = useState<string>("");
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false);
  const [batchSelectionBehavior, setBatchSelectionBehavior] = useState<BatchSelectionBehavior>("clear");
  const [gallerySettingsSaving, setGallerySettingsSaving] = useState(false);
  const [generalMessage, setGeneralMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; body: string } | null>(null);

  const title = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label ?? "系统设置", [activeTab]);
  const trimmedRepositoryPath = repositoryPath.trim();
  const hasUnsavedRepositoryPath = trimmedRepositoryPath !== savedRepositoryPath.trim();
  const runtimeInfo = window.mediaPhotoWorkbench?.getRuntimeInfo?.();

  // 页面加载时从后端获取真实配置；失败时明确显示错误，不伪装成 mock 成功。
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const res = await fetchSettings();
        if (cancelled) return;
        if (res.ok && res.data) {
          const path = res.data.repository.path || "";
          setApiAvailable(true);
          setRepositoryPath(path);
          setSavedRepositoryPath(path);
          setPort(String(res.data.server.port));
          setDatabasePath(res.data.database.path);
          setDatabaseLastAutoBackupAt(res.data.database.lastAutoBackupAt || "");
          setBatchSelectionBehavior(res.data.gallery?.batchSelectionBehavior || "clear");
          setRepositoryMessage(null);
          void refreshDatabaseBackups();
        } else {
          setApiAvailable(false);
          setRepositoryMessage({ tone: "danger", title: "设置读取失败", body: res.error?.message || "无法读取后端配置。" });
        }
      } catch {
        if (!cancelled) {
          setApiAvailable(false);
          setRepositoryMessage({ tone: "danger", title: "后端服务未连接", body: "无法连接后端 API，请确认 Electron 后端服务已启动。" });
        }
      }
    }

    loadSettings();
    return () => { cancelled = true; };
  }, []);

  const refreshDatabaseBackups = async () => {
    try {
      const res = await fetchDatabaseBackups();
      if (res.ok && res.data) {
        setDatabaseBackups(res.data);
      }
    } catch {
      // 备份列表仅作为辅助信息，读取失败不影响设置页主流程。
    }
  };

  const handleCheckRepository = async () => {
    if (!savedRepositoryPath.trim()) {
      setCheckResult("error");
      setRepoCheck(null);
      setRepositoryMessage({ tone: "warning", title: "请先设置仓库路径", body: "当前没有已保存的仓库路径。请选择文件夹并点击保存后再检查。" });
      return;
    }

    setCheckResult("loading");
    setRepositoryMessage(null);
    try {
      const res = await checkRepository();
      if (res.ok && res.data) {
        setRepoCheck(res.data);
        const ok = res.data.exists && res.data.readable && res.data.writable;
        setCheckResult(ok ? "ok" : "error");
        if (!ok) {
          setRepositoryMessage({ tone: "warning", title: "仓库检查异常", body: buildRepositoryCheckMessage(res.data) });
        }
      } else {
        setCheckResult("error");
        setRepoCheck(null);
        setRepositoryMessage({ tone: "danger", title: "仓库检查失败", body: res.error?.message || "请求失败，请确保后端服务正常运行。" });
      }
    } catch {
      setCheckResult("error");
      setRepoCheck(null);
      setRepositoryMessage({ tone: "danger", title: "仓库检查失败", body: "请求失败，请确保后端服务正常运行。" });
    }
  };

  const handleSaveRepository = async () => {
    if (!trimmedRepositoryPath) {
      setCheckResult("error");
      setRepositoryMessage({ tone: "warning", title: "请先设置仓库路径", body: "仓库路径不能为空。请选择一个本地文件夹后再保存。" });
      return;
    }

    setSaving(true);
    setRepositoryMessage(null);
    try {
      const res = await updateRepositoryPath(trimmedRepositoryPath);
      if (res.ok && res.data) {
        setApiAvailable(true);
        setSavedRepositoryPath(res.data.path);
        setRepositoryPath(res.data.path);
        setRepoCheck(res.data);
        const ok = res.data.exists && res.data.readable && res.data.writable;
        setCheckResult(ok ? "ok" : "error");
        setRepositoryMessage({
          tone: ok ? "success" : "warning",
          title: ok ? "仓库路径已保存" : "仓库路径已保存，但检查异常",
          body: ok ? `已写入配置文件：${res.data.path}` : buildRepositoryCheckMessage(res.data)
        });
      } else {
        setCheckResult("error");
        setRepositoryMessage({ tone: "danger", title: "保存失败", body: res.error?.message || "保存配置失败。" });
      }
    } catch {
      setCheckResult("error");
      setRepositoryMessage({ tone: "danger", title: "保存失败", body: "请求失败，请确保后端服务正常运行。" });
    } finally {
      setSaving(false);
    }
  };

  const handleBrowse = async () => {
    const path = await window.mediaPhotoWorkbench?.selectDirectory();
    if (path) {
      setRepositoryPath(path);
      setRepositoryMessage({ tone: "warning", title: "路径尚未保存", body: "已选择新的仓库路径。点击右上角保存后，切换页面和重启软件才会保留。" });
    }
  };

  const handleOpenFolder = async () => {
    if (!trimmedRepositoryPath) {
      setRepositoryMessage({ tone: "warning", title: "无法打开文件夹", body: "请先设置仓库路径。" });
      return;
    }
    const result = await window.mediaPhotoWorkbench?.openPath(trimmedRepositoryPath);
    if (result) {
      setRepositoryMessage({ tone: "danger", title: "无法打开文件夹", body: result });
    }
  };

  const handleBackupDatabase = async () => {
    setDatabaseBackupLoading(true);
    setDatabaseMessage(null);
    setDatabaseBackupResult(null);
    try {
      const res = await backupDatabaseNow();
      if (res.ok && res.data) {
        setDatabaseBackupResult(res.data);
        setDatabaseMessage({
          tone: "success",
          title: "数据库备份完成",
          body: `备份已保存到：${res.data.backupPath}`
        });
        await refreshDatabaseBackups();
      } else {
        setDatabaseMessage({
          tone: "danger",
          title: "数据库备份失败",
          body: res.error?.message || "备份失败，请检查仓库路径和写入权限。"
        });
      }
    } catch (err: any) {
      setDatabaseMessage({
        tone: "danger",
        title: "数据库备份失败",
        body: err?.message || "备份失败，请检查仓库路径和后端服务。"
      });
    } finally {
      setDatabaseBackupLoading(false);
    }
  };

  const handleMigrateDatabase = async () => {
    if (!window.mediaPhotoWorkbench?.selectDirectory) {
      setDatabaseMessage({ tone: "warning", title: "无法选择目标目录", body: "当前运行环境没有提供目录选择能力，请在 Electron 桌面端中使用此功能。" });
      return;
    }

    const targetDirectory = await window.mediaPhotoWorkbench.selectDirectory();
    if (!targetDirectory) return;

    setDatabaseMigrationLoading(true);
    setDatabaseMessage(null);
    try {
      const res = await migrateDatabaseLocation({ targetDirectory });
      if (res.ok && res.data) {
        setDatabasePath(res.data.newPath);
        setDatabaseMessage({
          tone: "success",
          title: "数据库位置已迁移",
          body: `新数据库：${res.data.newPath}。迁移前备份：${res.data.backupPath}。请重启应用后生效。`
        });
        await refreshDatabaseBackups();
      } else {
        setDatabaseMessage({
          tone: "danger",
          title: "数据库迁移失败",
          body: `${res.error?.message || "迁移失败。"} 配置未修改，当前数据库仍可继续使用。`
        });
      }
    } catch (err: any) {
      setDatabaseMessage({
        tone: "danger",
        title: "数据库迁移失败",
        body: `${err?.message || "迁移失败。"} 配置未修改，当前数据库仍可继续使用。`
      });
    } finally {
      setDatabaseMigrationLoading(false);
    }
  };

  const handleOpenLogsDir = async () => {
    const logsDir = window.mediaPhotoWorkbench?.getRuntimeInfo?.().logsDir;
    if (!logsDir) {
      setDiagnosticMessage({ tone: "warning", title: "无法打开日志目录", body: "当前运行环境没有提供日志目录路径。请在 Electron 桌面端中使用此功能。" });
      return;
    }

    const result = await window.mediaPhotoWorkbench?.openPath(logsDir);
    if (result) {
      setDiagnosticMessage({ tone: "danger", title: "无法打开日志目录", body: result });
      return;
    }

    setDiagnosticMessage({ tone: "success", title: "日志目录已打开", body: logsDir });
  };

  const handleCopyDiagnostics = async () => {
    setCopyingDiagnostics(true);
    setDiagnosticMessage(null);

    try {
      const [healthRes, settingsRes, repositoryRes, activeEventsRes, reviewingEventsRes, cameraFtpDiagnosticsRes] = await Promise.all([
        fetchHealth(),
        fetchSettings(),
        checkRepository(),
        fetchEvents("active"),
        fetchEvents("reviewing"),
        fetchCameraFtpDiagnostics()
      ]);

      if (!healthRes.ok || !healthRes.data) {
        throw new Error(healthRes.error?.message || "无法读取 /api/health。");
      }
      if (!settingsRes.ok || !settingsRes.data) {
        throw new Error(settingsRes.error?.message || "无法读取 /api/settings。");
      }
      if (!repositoryRes.ok || !repositoryRes.data) {
        throw new Error(repositoryRes.error?.message || "无法读取 /api/repository/check。");
      }

      const currentEvent = activeEventsRes.data?.[0] ?? reviewingEventsRes.data?.[0] ?? null;
      const text = buildDiagnosticsText({
        health: healthRes.data,
        repository: repositoryRes.data,
        settings: settingsRes.data,
        currentEvent,
        cameraFtp: cameraFtpDiagnosticsRes.ok ? cameraFtpDiagnosticsRes.data : null,
        cameraFtpError: cameraFtpDiagnosticsRes.error
          ? {
              code: cameraFtpDiagnosticsRes.error.code,
              operationId: cameraFtpDiagnosticsRes.error.operationId
            }
          : null,
        runtimeInfo: window.mediaPhotoWorkbench?.getRuntimeInfo?.()
      });

      await navigator.clipboard.writeText(text);
      setDiagnosticPreview(text);
      setDiagnosticMessage({ tone: "success", title: "诊断信息已复制", body: "可以直接粘贴给开发者排查局域网、仓库、数据库或启动问题。" });
    } catch (err: any) {
      setDiagnosticMessage({ tone: "danger", title: "复制诊断信息失败", body: err?.message || "无法收集诊断信息。" });
    } finally {
      setCopyingDiagnostics(false);
    }
  };

  const handleBatchSelectionBehaviorChange = async (behavior: BatchSelectionBehavior) => {
    setGallerySettingsSaving(true);
    setGeneralMessage(null);
    try {
      const res = await updateGallerySettings({ batchSelectionBehavior: behavior });
      if (res.ok && res.data) {
        setBatchSelectionBehavior(res.data.batchSelectionBehavior);
        setGeneralMessage({
          tone: "success",
          title: "图片墙偏好已保存",
          body: res.data.batchSelectionBehavior === "keep" ? "批量操作完成后会保留当前选择。" : "批量操作完成后会清空选择；部分失败时保留失败项。"
        });
      } else {
        setGeneralMessage({ tone: "danger", title: "保存失败", body: res.error?.message || "无法保存图片墙偏好。" });
      }
    } catch {
      setGeneralMessage({ tone: "danger", title: "保存失败", body: "请求失败，请确认后端服务已启动。" });
    } finally {
      setGallerySettingsSaving(false);
    }
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
            {activeTab !== "about" && activeTab !== "repository" && activeTab !== "diagnostics" && activeTab !== "general" && (
              <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700" type="button">
                <Save size={16} />
                保存 mock
              </button>
            )}
          </div>

          {activeTab === "general" && (
            <div className="space-y-6">
              <TransientNotice message={generalMessage} onDismiss={() => setGeneralMessage(null)} />
              <SettingSwitch checked label="启动后显示最近使用" note="保留主机/客户端入口和最近连接记录。" />
              <SettingSwitch checked label="浅色界面" note="第一版固定浅色界面，后续可扩展深色模式。" />
              <SettingSwitch label="启动后自动进入上次模式" note="当前保持手动选择主机或客户端。" />
              <Divider />
              <div>
                <h4 className="mb-3 text-sm font-medium text-slate-900">图片墙批量操作</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      batchSelectionBehavior === "clear" ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:bg-white"
                    )}
                    disabled={gallerySettingsSaving}
                    onClick={() => handleBatchSelectionBehaviorChange("clear")}
                    type="button"
                  >
                    <span className="block text-sm font-medium text-slate-800">批量操作后清空选择</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">默认行为；部分失败时保留失败项，便于重试。</span>
                  </button>
                  <button
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      batchSelectionBehavior === "keep" ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:bg-white"
                    )}
                    disabled={gallerySettingsSaving}
                    onClick={() => handleBatchSelectionBehaviorChange("keep")}
                    type="button"
                  >
                    <span className="block text-sm font-medium text-slate-800">批量操作后保留选择</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">适合连续批量修改状态、星级或分类。</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "repository" && (
            <div className="space-y-8">
              {apiAvailable === false && (
                <Notice tone="danger" title="后端服务未连接">
                  无法连接后端 API。仓库路径保存、检查和打开文件夹都需要 Electron 后端服务。
                </Notice>
              )}

              <TransientNotice message={repositoryMessage} onDismiss={() => setRepositoryMessage(null)} />

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
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span>已保存路径：{savedRepositoryPath || "未设置"}</span>
                  {hasUnsavedRepositoryPath && <StatusPill tone="warning">有未保存更改</StatusPill>}
                </div>
              </div>

              <Divider />

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">数据库位置</label>
                <p className="mb-3 break-all rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">{databasePath}</p>

                <TransientNotice className="mb-3" message={databaseMessage} onDismiss={() => setDatabaseMessage(null)} />

                <div className="mb-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium text-slate-400">启动自动备份</p>
                    <p className="mt-1 font-medium text-slate-700">已启用，每 24 小时最多一次</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium text-slate-400">最近自动备份</p>
                    <p className="mt-1 font-medium text-slate-700">{databaseLastAutoBackupAt ? formatDateTime(databaseLastAutoBackupAt) : "暂无记录"}</p>
                  </div>
                </div>

                {databaseBackupResult && (
                  <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <p>备份大小：{formatBytes(databaseBackupResult.size)}</p>
                    <p className="mt-1 break-all">备份路径：{databaseBackupResult.backupPath}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={databaseBackupLoading || databaseMigrationLoading}
                    onClick={handleBackupDatabase}
                    type="button"
                  >
                    {databaseBackupLoading ? "备份中..." : "立即备份"}
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={databaseBackupLoading || databaseMigrationLoading}
                    onClick={handleMigrateDatabase}
                    type="button"
                  >
                    {databaseMigrationLoading ? "迁移中..." : "迁移数据库位置"}
                  </button>
                </div>

                <p className="mt-3 text-xs leading-5 text-slate-500">
                  数据库路径和图片仓库路径是两个不同概念。迁移前会自动备份，旧数据库不会删除，新路径重启后生效。
                </p>

                {databaseBackups.length > 0 && (
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <h4 className="mb-3 text-sm font-medium text-slate-900">最近数据库备份</h4>
                    <div className="space-y-2">
                      {databaseBackups.slice(0, 5).map((item) => (
                        <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600" key={item.path}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium text-slate-700">{item.name}</span>
                            <span className="shrink-0 text-slate-400">{formatBytes(item.size)}</span>
                          </div>
                          <p className="mt-1 truncate text-slate-400" title={item.path}>{item.path}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                    {buildRepositoryCheckMessage(repoCheck)}
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

          {activeTab === "diagnostics" && (
            <div className="space-y-6">
              <TransientNotice message={diagnosticMessage} onDismiss={() => setDiagnosticMessage(null)} />

              <InfoCard icon={<Bug size={18} />} title="诊断信息">
                <p>用于现场排查后端端口、仓库路径、局域网地址、剩余空间和当前活动状态。</p>
                <p>复制内容不包含图片文件，也不会修改数据库或仓库。</p>
              </InfoCard>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  onClick={handleOpenLogsDir}
                  type="button"
                >
                  <FolderOpen size={16} />
                  打开日志目录
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  disabled={copyingDiagnostics}
                  onClick={handleCopyDiagnostics}
                  type="button"
                >
                  <Clipboard size={16} />
                  {copyingDiagnostics ? "正在复制..." : "复制诊断信息"}
                </button>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <h4 className="mb-3 text-sm font-medium text-slate-900">当前运行信息</h4>
                <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  <DiagnosticLine label="应用版本" value={runtimeInfo?.appVersion || "未知"} />
                  <DiagnosticLine label="运行模式" value={runtimeInfo?.isPackaged ? "打包" : "开发"} />
                  <DiagnosticLine label="后端端口" value={runtimeInfo?.serverPort ? String(runtimeInfo.serverPort) : port} />
                  <DiagnosticLine label="API 地址" value={runtimeInfo?.apiBaseUrl || getApiBase()} />
                  <DiagnosticLine label="日志目录" value={runtimeInfo?.logsDir || "当前环境不可用"} wide />
                  <DiagnosticLine label="仓库路径" value={savedRepositoryPath || "未配置"} wide />
                </div>
              </div>

              <Notice tone="warning" title="连接排查提示">
                <ul className="list-disc space-y-1 pl-4">
                  <li>校园网可能存在设备隔离，同一 Wi-Fi 下客户端也可能无法访问主机。</li>
                  <li>同一 Wi-Fi 无法连接时，建议使用主机 Windows 热点，常见主机地址为 192.168.137.1。</li>
                  <li>检查 Windows 防火墙是否允许应用访问专用网络。</li>
                  <li>客户端应访问主机首页显示的真实地址和端口，不要填写客户端自己的 localhost。</li>
                </ul>
              </Notice>

              {diagnosticPreview && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-slate-900">最近复制内容预览</h4>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-slate-100 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {diagnosticPreview}
                  </pre>
                </div>
              )}
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
              <InfoCard icon={<BrandLogo size="sm" />} title="融媒体图片工作台">
                <p>Media Photo Workbench · v{runtimeInfo?.appVersion || "2.1.0"}</p>
                <p>桌面端：Electron + React + Vite + TypeScript + Tailwind</p>
                <p>后端：Express + SQLite + better-sqlite3 + pino</p>
              </InfoCard>
              <InfoCard icon={<FolderOpen size={18} />} title="当前约束">
                <p>当前导入与客户端上传支持 JPG/JPEG/PNG；后端主机服务默认端口为 3030。</p>
              </InfoCard>
              <InfoCard icon={<Mail size={18} />} title="联系开发者">
                <p>
                  <a className="font-medium text-blue-600 hover:text-blue-700" href="mailto:zhy20041122@gmail.com">
                    zhy20041122@Gmail.com
                  </a>
                </p>
              </InfoCard>
              <InfoCard icon={<Github size={18} />} title="开源仓库">
                <p>
                  <a className="font-medium text-blue-600 hover:text-blue-700" href="https://github.com/FFocalors/media-photo-workbench" rel="noreferrer" target="_blank">
                    github.com/FFocalors/media-photo-workbench
                  </a>
                </p>
              </InfoCard>
              <InfoCard icon={<Info size={18} />} title="免责声明">
                <p>本软件用于校园融媒体活动图片的本地与局域网协作管理，不提供云端备份或外部存储服务。</p>
                <p>请在导入、清理、归档和永久删除前自行确认重要图片已有可靠备份；因误操作、设备故障、网络环境或第三方系统限制导致的数据损失，需由使用方自行承担。</p>
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

function DiagnosticLine({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-white px-3 py-2", wide && "sm:col-span-2")}>
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-700">{value || "未提供"}</p>
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

function buildRepositoryCheckMessage(result: RepositoryCheckData): string {
  if (!result.path) return "当前没有已保存的仓库路径。";
  if (!result.exists) return `路径不存在：${result.path}`;
  if (!result.readable) return `路径不可读：${result.path}`;
  if (!result.writable) return `路径不可写：${result.path}`;
  return `仓库路径可读写：${result.path}`;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "暂不可用";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function redactDiagnosticCopyText(value: string): string {
  return value
    .replace(/([A-Za-z]:\\Users\\)[^\\\r\n]+/gi, "$1[用户]")
    .replace(/(\/Users\/)[^/\r\n]+/gi, "$1[用户]")
    .replace(/("?(?:password|newPassword|confirmPassword|oldPassword|currentPassword|secret|token)"?\s*[=:：]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[已隐藏]")
    .replace(/(SecureString\s*[=:：]\s*)[^\s,;}\"]+/gi, "$1[已隐藏]");
}

function buildDiagnosticsText(input: {
  health: HealthData;
  repository: RepositoryCheckData;
  settings: SettingsData;
  currentEvent: EventData | null;
  cameraFtp: CameraFtpDiagnosticData | null;
  cameraFtpError: { code: string; operationId?: string } | null;
  runtimeInfo?: ReturnType<NonNullable<MediaPhotoWorkbenchBridge["getRuntimeInfo"]>>;
}): string {
  const runtime = input.runtimeInfo;
  const serverPort = input.health.server.port || runtime?.serverPort || input.settings.server.port;
  const apiBase = runtime?.apiBaseUrl || getApiBase();
  const lanAddresses = input.health.network?.lanAddresses ?? [];
  const currentEvent = input.currentEvent;
  const eventStatus = currentEvent
    ? eventStatusLabels[currentEvent.status as keyof typeof eventStatusLabels] || currentEvent.status
    : "";
  const cameraFtp = input.cameraFtp?.ftp;
  const cameraFtpPlatform = input.cameraFtp?.platform;
  const cameraFtpWatcher = cameraFtp?.watcher;

  return redactDiagnosticCopyText([
    "Media Photo Workbench / 融媒体图片工作台 诊断信息",
    `生成时间：${new Date().toLocaleString()}`,
    "",
    "[应用]",
    `应用版本：${runtime?.appVersion || "未知"}`,
    `运行模式：${runtime?.isPackaged ? "打包" : "开发"}`,
    `后端真实端口：${serverPort}`,
    `API 地址：${apiBase}`,
    `应用数据目录：${runtime?.appDataRoot || "当前环境不可用"}`,
    `日志目录：${runtime?.logsDir || "当前环境不可用"}`,
    "",
    "[数据库]",
    `数据库路径：${input.settings.database.path || "未知"}`,
    `数据库状态：${input.health.database.status}`,
    "",
    "[仓库]",
    `仓库路径：${input.settings.repository.path || input.repository.path || "未配置"}`,
    `仓库已配置：${input.health.repository.configured ? "是" : "否"}`,
    `仓库存在：${input.repository.exists ? "是" : "否"}`,
    `仓库可读：${input.repository.readable ? "是" : "否"}`,
    `仓库可写：${input.repository.writable ? "是" : "否"}`,
    `剩余空间：${input.repository.freeSpaceText || formatBytes(input.repository.freeSpace)}`,
    `总空间：${input.repository.totalSpaceText || formatBytes(input.repository.totalSpace)}`,
    `容量读取错误：${input.repository.capacityError || "无"}`,
    "",
    "[网络]",
    `本机 API：http://localhost:${serverPort}`,
    `局域网地址列表：${lanAddresses.length > 0 ? "" : "未检测到可用 Wi-Fi / 以太网 IPv4 地址"}`,
    ...lanAddresses.map((item) => `- ${item.name}: http://${item.address}:${serverPort}`),
    `Windows 热点候选地址：http://${input.health.network?.hotspotAddress || "192.168.137.1"}:${serverPort}`,
    "",
    "[当前活动]",
    currentEvent
      ? `活动名称：${currentEvent.name}\n活动状态：${eventStatus}\n活动日期：${currentEvent.date || "未填写"}\n图片数量：${currentEvent.total_images}`
      : "暂无 active / reviewing 活动",
    "",
    "[相机 FTP / 已脱敏]",
    cameraFtpPlatform
      ? `平台：${cameraFtpPlatform.os} ${cameraFtpPlatform.arch} / ${cameraFtpPlatform.release}`
      : "平台：暂不可用",
    `Provider：${cameraFtp?.provider || "iis"}`,
    `托管站点：${cameraFtp?.siteName || "暂不可用"}`,
    `Site ID：${cameraFtp?.managedSiteId ?? "未建立"}`,
    `控制端口：${cameraFtp?.controlPort ?? "暂不可用"}`,
    `PASV 端口：${cameraFtp ? `${cameraFtp.passivePortStart}-${cameraFtp.passivePortEnd}` : "暂不可用"}`,
    `FTP 当前活动：${cameraFtp?.activeEvent ? `${cameraFtp.activeEvent.id} / ${cameraFtp.activeEvent.name}` : "未关联"}`,
    `检测级别：${cameraFtp?.inspectionLevel || "暂不可用"} / ${cameraFtp?.inspectionOutcome || "unknown"}`,
    `Watcher：${cameraFtpWatcher ? `${cameraFtpWatcher.running ? "运行中" : "已停止"} / ${cameraFtpWatcher.busy ? "处理中" : "空闲"}` : "暂不可用"}`,
    `Watcher 队列：pending=${cameraFtpWatcher?.pendingCount ?? 0}, queued=${cameraFtpWatcher?.queuedCount ?? 0}, importing=${cameraFtpWatcher?.importingCount ?? 0}, unstable=${cameraFtpWatcher?.unstableCount ?? 0}`,
    `最近错误码：${cameraFtp?.lastErrorCode || input.cameraFtpError?.code || "无"}`,
    `operationId：${input.cameraFtp?.operationId || input.cameraFtpError?.operationId || "暂不可用"}`,
    "说明：此段未收集 FTP 密码、账户详情、图片路径、图片内容、提权临时文件或其他 IIS 站点配置。",
    "",
    "[连接排查提示]",
    "- 校园网可能存在设备隔离，同一 Wi-Fi 下客户端也可能无法访问主机。",
    "- 同一 Wi-Fi 无法连接时，建议使用主机 Windows 热点。",
    "- 检查 Windows 防火墙是否允许应用访问专用网络。",
    "- 客户端应访问主机首页显示的真实地址和端口，不要填写客户端自己的 localhost。"
  ].join("\n"));
}
