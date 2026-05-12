const { contextBridge, ipcRenderer } = require("electron");

/**
 * Preload 脚本。
 * 通过 contextBridge 暴露安全的 API 给渲染进程。
 * apiBaseUrl 由主进程通过 IPC 在启动后设置（因为端口可能因冲突而变化）。
 */

let _apiBaseUrl = "http://localhost:3030"; // 默认值

// 监听主进程发来的真实端口
ipcRenderer.on("set-api-port", (_event, port) => {
  _apiBaseUrl = `http://localhost:${port}`;
});

contextBridge.exposeInMainWorld("mediaPhotoWorkbench", {
  platform: process.platform,
  get apiBaseUrl() {
    return _apiBaseUrl;
  },
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path)
});
