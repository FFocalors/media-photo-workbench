const { contextBridge, ipcRenderer, webUtils } = require("electron");

/**
 * Preload 脚本。
 * 通过 contextBridge 暴露安全的 API 给渲染进程。
 *
 * 生产模式下，页面由后端统一端口托管，renderer 直接使用 window.location.origin
 * 作为 API / Socket.IO 基址，不需要 preload 注入端口。
 *
 * 开发模式下，前端运行在 Vite 5173，需要 preload 告知真实后端端口。
 */

let _runtimeInfo = {
  isPackaged: false,
  isDev: true,
  serverPort: 0,
  apiBaseUrl: "",
  clientBaseUrl: "",
  appVersion: "",
  appDataRoot: "",
  logsDir: ""
};

function normalizeRuntimeInfo(info) {
  if (!info || typeof info !== "object") {
    return;
  }

  _runtimeInfo = {
    isPackaged: Boolean(info.isPackaged),
    isDev: Boolean(info.isDev),
    serverPort: Number(info.serverPort) || 0,
    apiBaseUrl: String(info.apiBaseUrl || ""),
    clientBaseUrl: String(info.clientBaseUrl || ""),
    appVersion: String(info.appVersion || ""),
    appDataRoot: String(info.appDataRoot || ""),
    logsDir: String(info.logsDir || "")
  };
}

try {
  normalizeRuntimeInfo(ipcRenderer.sendSync("runtime:get-info-sync"));
} catch (_) {
  // 主进程尚未准备好时保持空运行时信息，后续 IPC 会补齐。
}

// 监听主进程发来的真实运行时信息
ipcRenderer.on("set-runtime-info", (_event, info) => {
  normalizeRuntimeInfo(info);
});

// 兼容旧版 IPC（仅端口号）
ipcRenderer.on("set-api-port", (_event, port) => {
  const p = Number(port) || 0;
  if (p > 0) {
    _runtimeInfo.serverPort = p;
    _runtimeInfo.apiBaseUrl = `http://localhost:${p}`;
    _runtimeInfo.clientBaseUrl = `http://localhost:${p}`;
  }
});

contextBridge.exposeInMainWorld("mediaPhotoWorkbench", {
  platform: process.platform,

  /**
   * 获取完整的运行时信息（开发模式使用）。
   * 生产模式 renderer 应优先使用 window.location.origin。
   */
  getRuntimeInfo: () => ({ ..._runtimeInfo }),

  /**
   * 兼容旧代码：直接返回 apiBaseUrl。
   * 生产模式 renderer 不应依赖此值（会优先用同源地址）。
   */
  get apiBaseUrl() {
    return _runtimeInfo.apiBaseUrl;
  },

  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  selectImageFiles: () => ipcRenderer.invoke("dialog:select-image-files"),
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile?.(file) || file?.path || "";
    } catch (_) {
      return file?.path || "";
    }
  },
  inspectDroppedPaths: (paths) => ipcRenderer.invoke("drag:inspect-paths", paths),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),

  /** 获取主进程确认的当前窗口状态。 */
  getWindowState: () => ipcRenderer.invoke("window:get-state"),

  /**
   * 监听窗口状态变化（最大化 / 还原 / 全屏）。
   * 返回取消监听函数，组件卸载时应调用。
   * @param {(state: { maximized: boolean, fullscreen: boolean, bounds: object | null, mode: "native" | "manual" }) => void} callback
   * @returns {() => void} unsubscribe
   */
  onWindowStateChanged: (callback) => {
    const handler = (_event, state) => {
      try { callback(state); } catch (_) { /* swallow */ }
    };
    ipcRenderer.on("window-state-changed", handler);
    return () => { ipcRenderer.removeListener("window-state-changed", handler); };
  },

  // Window control commands (frame:false requires custom buttons)
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("window:toggle-maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  // Custom title-bar drag (title bar is no-drag so DOM dblclick works; the main
  // process moves/restores the window and follows the cursor during the gesture).
  beginTitlebarDrag: (payload) => ipcRenderer.invoke("window:begin-titlebar-drag", payload),
  endTitlebarDrag: () => ipcRenderer.invoke("window:end-titlebar-drag")
});
