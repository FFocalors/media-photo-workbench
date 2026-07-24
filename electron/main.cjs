const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = !app.isPackaged;

/** @type {'frameless-transparent' | 'fallback-opaque-overlay'} */
const WINDOW_MODE = "frameless-transparent";

/** @type {import('../dist-server/index').ServerHandle | null} */
let serverHandle = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let runtimeInfo = {
  isPackaged: app.isPackaged,
  isDev,
  serverPort: 0,
  apiBaseUrl: "",
  clientBaseUrl: "",
  appVersion: app.getVersion(),
  appDataRoot: "",
  logsDir: ""
};
let startupLogsDir = null;

function resolveEarlyLogsDir() {
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, "media-photo-workbench", "logs");
  }
  return path.resolve(process.cwd(), "logs");
}

function writeEarlyStartupLog(message) {
  try {
    const logsDir = resolveEarlyLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, "startup.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (_) {
    // best effort before app.whenReady()
  }
}

writeEarlyStartupLog("=== Electron main loaded ===");
writeEarlyStartupLog(`argv: ${JSON.stringify(process.argv)}`);
writeEarlyStartupLog(`execPath: ${process.execPath}`);

process.on("uncaughtException", (err) => {
  const message = err && err.stack ? err.stack : String(err);
  writeEarlyStartupLog(`uncaughtException: ${message}`);
  if (String(err?.message || err).includes("the worker has exited")) {
    return;
  }
  console.error(err);
});

process.on("unhandledRejection", (reason) => {
  const message = reason && reason.stack ? reason.stack : String(reason);
  writeEarlyStartupLog(`unhandledRejection: ${message}`);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
writeEarlyStartupLog(`gotSingleInstanceLock: ${gotSingleInstanceLock}`);

if (!gotSingleInstanceLock) {
  writeEarlyStartupLog("单实例锁获取失败，应用退出");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * 获取应用数据根目录。
 * 开发环境：项目根目录（方便调试，数据文件与项目同目录）
 * 生产环境：app.getPath("userData")（可写的用户数据目录）
 */
function getAppDataRoot() {
  if (isDev) {
    return path.resolve(__dirname, "..");
  }
  return app.getPath("userData");
}

/**
 * Write startup diagnostic log to a file in userData.
 */
function writeStartupLog(logsDir, message) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, "startup.log");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (_) {
    // best effort
  }
}

function createWindow(serverPort, logsDir) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const windowOpts = {
    width: 1360,
    height: 860,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    title: "融媒体图片工作台 · Media Photo Workbench",
    icon: resolveWindowIcon(),
    // frame:false removes ALL native chrome (border, shadow, DWM corners).
    // Combined with transparent:true, the window shape is entirely CSS-controlled.
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  mainWindow = new BrowserWindow(windowOpts);

  if (logsDir) {
    writeStartupLog(logsDir, `window mode: ${WINDOW_MODE}`);
    writeStartupLog(logsDir, `BrowserWindow created: frame=false, transparent=true, hasShadow=false`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Window state change events for frontend shell styling
  mainWindow.on("maximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: true, fullscreen: false });
    }
  });
  mainWindow.on("unmaximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: false, fullscreen: false });
    }
  });
  mainWindow.on("restore", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: mainWindow.isMaximized(), fullscreen: false });
    }
  });
  mainWindow.on("enter-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: mainWindow.isMaximized(), fullscreen: true });
    }
  });
  mainWindow.on("leave-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: mainWindow.isMaximized(), fullscreen: false });
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      if (logsDir) {
        writeStartupLog(logsDir, "BrowserWindow ready-to-show，窗口已显示");
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  let loadURL = "";
  if (isDev) {
    loadURL = "http://127.0.0.1:5173";
  } else if (serverPort) {
    loadURL = `http://127.0.0.1:${serverPort}`;
  } else {
    loadURL = `data:text/html;charset=utf-8,${encodeURIComponent(renderErrorPage())}`;
  }
  if (logsDir) {
    writeStartupLog(logsDir, `final loadURL: ${loadURL.startsWith("data:") ? "data:error-page" : loadURL}`);
  }
  mainWindow.loadURL(loadURL);
  return mainWindow;
}

function resolveWindowIcon() {
  const candidates = [
    path.resolve(__dirname, "..", "build", "icon.png"),
    path.resolve(process.resourcesPath || "", "build", "icon.png")
  ];

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  });
}

function inspectDroppedPath(fullPath) {
  const result = {
    path: typeof fullPath === "string" ? fullPath : "",
    name: "",
    isFile: false,
    isDirectory: false,
    extension: "",
    supported: false,
    error: ""
  };

  if (!result.path) {
    result.error = "EMPTY_PATH";
    return result;
  }

  try {
    const stat = fs.statSync(result.path);
    result.name = path.basename(result.path);
    result.isFile = stat.isFile();
    result.isDirectory = stat.isDirectory();
    result.extension = result.isFile ? path.extname(result.path).toLowerCase() : "";
    result.supported = result.isFile && [".jpg", ".jpeg", ".png"].includes(result.extension);
  } catch (err) {
    result.name = path.basename(result.path);
    result.error = err?.message || "PATH_STAT_FAILED";
  }

  return result;
}

/**
 * Render a simple error page when backend fails to start.
 */
function renderErrorPage() {
  const logsDir = path.join(app.getPath("userData"), "logs");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>启动失败</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background: #fef2f2; color: #991b1b; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
  .card { background: #fff; border: 1px solid #fca5a5; border-radius: 12px; padding: 32px; max-width: 520px; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.6; margin: 8px 0; color: #7f1d1d; }
  code { background: #fee2e2; padding: 2px 6px; border-radius: 4px; font-family: "Cascadia Code", monospace; font-size: 13px; }
  .log-path { font-size: 12px; color: #9ca3af; margin-top: 16px; }
</style></head>
<body>
  <div class="card">
    <h1>⚠ 本地服务启动失败</h1>
    <p>融媒体图片工作台后端服务未能成功启动。</p>
    <p>请检查日志文件获取详细错误信息：</p>
    <p><code>${logsDir.replace(/\\/g, "\\\\")}\\\\startup.log</code></p>
    <p>常见原因：端口被占用、数据目录无写入权限、原生模块不兼容。</p>
    <p class="log-path">userData 目录：<code>${app.getPath("userData").replace(/\\/g, "\\\\")}</code></p>
  </div>
</body></html>`;
}

function setChineseMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    {
      label: "文件",
      submenu: [
        isMac ? { role: "close", label: "关闭" } : { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
              { role: "delete", label: "删除" },
              { role: "selectAll", label: "全选" },
              { type: "separator" },
              {
                label: "语音",
                submenu: [
                  { role: "startSpeaking", label: "开始朗读" },
                  { role: "stopSpeaking", label: "停止朗读" }
                ]
              }
            ]
          : [
              { role: "delete", label: "删除" },
              { type: "separator" },
              { role: "selectAll", label: "全选" }
            ])
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "切换开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front", label: "前置全部窗口" },
              { type: "separator" },
              { role: "window", label: "窗口" }
            ]
          : [{ role: "close", label: "关闭" }])
      ]
    },
    {
      role: "help",
      label: "帮助",
      submenu: [
        {
          label: "切换开发者工具",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.toggleDevTools();
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  const appDataRoot = getAppDataRoot();
  const logsDir = path.join(appDataRoot, "logs");
  startupLogsDir = logsDir;

  // Log startup diagnostics
  writeStartupLog(logsDir, "=== Media Photo Workbench 启动 ===");
  writeStartupLog(logsDir, `isPackaged: ${app.isPackaged}`);
  writeStartupLog(logsDir, `isDev: ${isDev}`);
  writeStartupLog(logsDir, `__dirname: ${__dirname}`);
  writeStartupLog(logsDir, `process.cwd(): ${process.cwd()}`);
  writeStartupLog(logsDir, `process.resourcesPath: ${process.resourcesPath}`);
  writeStartupLog(logsDir, `app.getAppPath(): ${app.getAppPath()}`);
  writeStartupLog(logsDir, `app.getPath("userData"): ${app.getPath("userData")}`);
  writeStartupLog(logsDir, `appDataRoot: ${appDataRoot}`);

  // 注册 IPC 处理程序
  ipcMain.handle("dialog:select-directory", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle("dialog:select-image-files", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png"] }
      ]
    });
    return canceled ? [] : filePaths;
  });

  ipcMain.handle("drag:inspect-paths", async (_event, paths) => {
    if (!Array.isArray(paths)) {
      return [];
    }

    return paths
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .slice(0, 5000)
      .map((item) => inspectDroppedPath(item));
  });

  ipcMain.handle("shell:open-path", async (_event, fullPath) => {
    return shell.openPath(fullPath);
  });

  ipcMain.on("runtime:get-info-sync", (event) => {
    event.returnValue = { ...runtimeInfo };
  });

  // Window state query (synchronous, safe for preload initial sync)
  ipcMain.on("window:get-state-sync", (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      event.returnValue = {
        maximized: mainWindow.isMaximized(),
        fullscreen: mainWindow.isFullScreen()
      };
    } else {
      event.returnValue = { maximized: false, fullscreen: false };
    }
  });

  // Window control commands (frame:false requires custom buttons)
  // Use BrowserWindow.fromWebContents(event.sender) to get the actual window,
  // avoiding stale closure references.
  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.handle("window:maximize-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { maximized: false };
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { maximized: win.isMaximized() };
  });
  ipcMain.on("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // 启动后端服务
  /** @type {string|null} */
  let startErrorStack = null;

  try {
    // Resolve dist-server entry path
    const distServerEntry = path.resolve(__dirname, "..", "dist-server", "index.js");
    writeStartupLog(logsDir, `distServerEntry: ${distServerEntry}`);
    writeStartupLog(logsDir, `distServerEntry exists: ${fs.existsSync(distServerEntry)}`);

    // Resolve frontend dist path
    const frontendDistPath = path.resolve(__dirname, "..", "dist");
    writeStartupLog(logsDir, `frontendDistPath: ${frontendDistPath}`);
    writeStartupLog(logsDir, `frontendDistPath/index.html exists: ${fs.existsSync(path.join(frontendDistPath, "index.html"))}`);

    writeStartupLog(logsDir, "正在加载后端模块...");
    const distServer = require(distServerEntry);
    const { startServer } = distServer;

    writeStartupLog(logsDir, "后端模块加载成功，正在 startServer...");
    serverHandle = await startServer(appDataRoot, {
      frontendDistPath,
      serveFrontend: true
    });
    runtimeInfo = {
      isPackaged: app.isPackaged,
      isDev,
      serverPort: serverHandle.port,
      apiBaseUrl: `http://localhost:${serverHandle.port}`,
      clientBaseUrl: `http://localhost:${serverHandle.port}`,
      appVersion: app.getVersion(),
      appDataRoot,
      logsDir
    };
    writeStartupLog(logsDir, `startServer 成功，端口: ${serverHandle.port}`);
    writeStartupLog(logsDir, `runtimeInfo: ${JSON.stringify(runtimeInfo)}`);
    console.log(`[main] 后端服务已启动，端口: ${serverHandle.port}`);
  } catch (err) {
    startErrorStack = err && err.stack ? err.stack : String(err);
    writeStartupLog(logsDir, `startServer 失败: ${startErrorStack}`);
    console.error("[main] 后端服务启动失败:", err);
  }

  // Hide the default application menu bar.
  // DevTools remain accessible via F12 / Ctrl+Shift+I keyboard shortcuts.
  Menu.setApplicationMenu(null);
  createWindow(serverHandle?.port, logsDir);

  // 将真实运行时信息发送给渲染进程
  if (serverHandle) {
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      const sendInfo = () => {
        win.webContents.send("set-runtime-info", runtimeInfo);
        win.webContents.send("set-api-port", serverHandle.port); // 兼容旧 preload
      };
      win.webContents.on("did-finish-load", sendInfo);
      // 如果页面已经加载完毕，立即发送
      if (!win.webContents.isLoading()) {
        sendInfo();
      }
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverHandle?.port, logsDir);
    }
  });
});

let shutdownInProgress = false;

app.on("before-quit", (event) => {
  if (startupLogsDir) {
    writeStartupLog(startupLogsDir, "应用即将退出，准备关闭后端服务");
  }
  if (serverHandle && !shutdownInProgress) {
    event.preventDefault();
    shutdownInProgress = true;
    const handle = serverHandle;
    serverHandle = null;
    void handle.close().finally(() => {
      if (startupLogsDir) {
        writeStartupLog(startupLogsDir, "后端服务已完成退出收尾");
      }
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
