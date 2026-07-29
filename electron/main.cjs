const { app, BrowserWindow, shell, Menu, ipcMain, dialog, screen } = require("electron");
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
const DEFAULT_WINDOW_WIDTH = 1360;
const DEFAULT_WINDOW_HEIGHT = 860;
const MIN_WINDOW_WIDTH = 1200;
const MIN_WINDOW_HEIGHT = 760;
const BOUNDS_TOLERANCE = 4;

/** @type {Electron.Rectangle | null} */
let lastNormalBounds = null;
let manualMaximized = false;
let windowTransitioning = false;
/** Active title-bar drag session (custom pointer drag), or null when idle. */
/** @type {{ grabOffsetX: number, grabOffsetY: number, width: number, height: number } | null} */
let titlebarDragState = null;
/** @type {NodeJS.Timeout | null} */
let titlebarDragTimer = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rectanglesApproximatelyEqual(left, right, tolerance = BOUNDS_TOLERANCE) {
  return (
    Math.abs(left.x - right.x) <= tolerance
    && Math.abs(left.y - right.y) <= tolerance
    && Math.abs(left.width - right.width) <= tolerance
    && Math.abs(left.height - right.height) <= tolerance
  );
}

function getWindowWorkArea(win) {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

function windowCoversWorkArea(win) {
  return rectanglesApproximatelyEqual(win.getBounds(), getWindowWorkArea(win));
}

function boundsIntersect(left, right) {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function isUsableNormalBounds(bounds) {
  if (!bounds || bounds.width < MIN_WINDOW_WIDTH || bounds.height < MIN_WINDOW_HEIGHT) {
    return false;
  }
  return screen.getAllDisplays().some((display) => boundsIntersect(bounds, display.workArea));
}

function getSafeRestoreBounds(win) {
  if (isUsableNormalBounds(lastNormalBounds)) {
    return { ...lastNormalBounds };
  }

  const nativeNormalBounds = win.getNormalBounds();
  if (isUsableNormalBounds(nativeNormalBounds) && !rectanglesApproximatelyEqual(nativeNormalBounds, getWindowWorkArea(win))) {
    return nativeNormalBounds;
  }

  const workArea = getWindowWorkArea(win);
  const width = Math.min(DEFAULT_WINDOW_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  };
}

async function setBoundsPrecisely(win, targetBounds) {
  win.setBounds(targetBounds);
  await delay(60);

  const firstActual = win.getBounds();
  if (rectanglesApproximatelyEqual(firstActual, targetBounds, 0)) {
    return firstActual;
  }

  const corrected = {
    x: targetBounds.x + (targetBounds.x - firstActual.x),
    y: targetBounds.y + (targetBounds.y - firstActual.y),
    width: Math.max(MIN_WINDOW_WIDTH, targetBounds.width + (targetBounds.width - firstActual.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, targetBounds.height + (targetBounds.height - firstActual.height))
  };
  win.setBounds(corrected);
  await delay(60);
  return win.getBounds();
}

function rememberNormalBounds(win, source) {
  if (
    !win
    || win.isDestroyed()
    || windowTransitioning
    || manualMaximized
    || win.isMaximized()
    || win.isFullScreen()
    || windowCoversWorkArea(win)
  ) {
    return;
  }

  const bounds = win.getBounds();
  if (isUsableNormalBounds(bounds)) {
    lastNormalBounds = { ...bounds };
    writeStartupLog(startupLogsDir || resolveEarlyLogsDir(), `[window] saved normalBounds (${source}): ${JSON.stringify(lastNormalBounds)}`);
  }
}

function getWindowStatePayload(win) {
  return {
    maximized: manualMaximized || win.isMaximized(),
    fullscreen: win.isFullScreen(),
    bounds: win.getBounds(),
    mode: manualMaximized ? "manual" : "native"
  };
}

function broadcastWindowState(win, source) {
  if (!win || win.isDestroyed()) return;
  const state = getWindowStatePayload(win);
  writeStartupLog(startupLogsDir || resolveEarlyLogsDir(), `[window] broadcast (${source}): ${JSON.stringify(state)}`);
  win.webContents.send("window-state-changed", state);
}

function waitForWindowEvent(win, eventName, timeoutMs = 220) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (fired) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.removeListener(eventName, onEvent);
      resolve(fired);
    };
    const onEvent = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    win.once(eventName, onEvent);
  });
}

function readWindowState(win) {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    id: win.id,
    destroyed: win.isDestroyed(),
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
    fullscreen: win.isFullScreen(),
    normal: typeof win.isNormal === "function" ? win.isNormal() : null,
    snapped: typeof win.isSnapped === "function" ? win.isSnapped() : null,
    bounds,
    normalBounds: win.getNormalBounds(),
    workArea: display.workArea,
    manualMaximized,
    windowTransitioning,
    lastNormalBounds
  };
}

function logWindowState(win, source, channel = null) {
  if (!win || win.isDestroyed()) {
    writeStartupLog(startupLogsDir || resolveEarlyLogsDir(), `[window] ${source}: unavailable`);
    return;
  }
  writeStartupLog(
    startupLogsDir || resolveEarlyLogsDir(),
    `[window] ${source}: ${JSON.stringify({ channel, ...readWindowState(win) })}`
  );
}

async function toggleWindowMaximize(win, channel) {
  if (!win || win.isDestroyed()) {
    return null;
  }

  logWindowState(win, "ipc:before", channel);
  if (windowTransitioning) {
    writeStartupLog(startupLogsDir || resolveEarlyLogsDir(), `[window] ${channel}: transition already in progress`);
    return getWindowStatePayload(win);
  }

  const shouldRestore = manualMaximized || win.isMaximized() || windowCoversWorkArea(win);
  if (!shouldRestore) {
    rememberNormalBounds(win, "before-maximize");
  }

  let restoredWithFallback = false;
  windowTransitioning = true;
  try {
    if (win.isFullScreen()) {
      const leftFullScreen = waitForWindowEvent(win, "leave-full-screen");
      win.setFullScreen(false);
      await leftFullScreen;
      await delay(40);
    }

    if (shouldRestore) {
      const unmaximizeEvent = waitForWindowEvent(win, "unmaximize");
      win.unmaximize();
      const unmaximizeFired = await unmaximizeEvent;
      await delay(60);

      const nativeRestoreFailed = (
        !unmaximizeFired
        || win.isMaximized()
        || windowCoversWorkArea(win)
      );

      manualMaximized = false;
      if (nativeRestoreFailed) {
        const restoreBounds = getSafeRestoreBounds(win);
        restoredWithFallback = true;
        writeStartupLog(
          startupLogsDir || resolveEarlyLogsDir(),
          `[window] native restore fallback: ${JSON.stringify({ unmaximizeFired, restoreBounds })}`
        );
        const actualBounds = await setBoundsPrecisely(win, restoreBounds);
        writeStartupLog(
          startupLogsDir || resolveEarlyLogsDir(),
          `[window] restore bounds applied: ${JSON.stringify({ restoreBounds, actualBounds })}`
        );
      }

      win.focus();
    } else {
      const maximizeEvent = waitForWindowEvent(win, "maximize");
      win.maximize();
      const maximizeFired = await maximizeEvent;
      await delay(60);

      if (!win.isMaximized()) {
        if (!windowCoversWorkArea(win)) {
          const workArea = getWindowWorkArea(win);
          writeStartupLog(
            startupLogsDir || resolveEarlyLogsDir(),
            `[window] native maximize fallback: ${JSON.stringify({ maximizeFired, workArea })}`
          );
          win.setBounds(workArea);
          await delay(80);
        }
        manualMaximized = true;
      }
    }
  } finally {
    windowTransitioning = false;
  }

  if (!restoredWithFallback && !manualMaximized && !win.isMaximized() && !win.isFullScreen()) {
    rememberNormalBounds(win, "after-restore");
  }
  broadcastWindowState(win, channel);
  logWindowState(win, "ipc:after-async", channel);
  return getWindowStatePayload(win);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function stopTitlebarDragTimer() {
  if (titlebarDragTimer) {
    clearInterval(titlebarDragTimer);
    titlebarDragTimer = null;
  }
}

/**
 * Begin a custom title-bar drag. The title bar uses -webkit-app-region: no-drag
 * (drag regions swallow DOM dblclick on Windows, breaking double-click toggle),
 * so all dragging is done here by polling the cursor and moving the window.
 *
 * Maximized: restore to the configured DEFAULT window size (not the pre-maximize
 * size), positioned so the grabbed title-bar point (ratioX / offsetY) stays under
 * the cursor, then keep following for the rest of the gesture.
 * Windowed: keep the current size and grab offset, just follow the cursor.
 */
function beginTitlebarDrag(win, payload) {
  if (!win || win.isDestroyed()) {
    return null;
  }
  stopTitlebarDragTimer();

  const cursor = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursor).workArea;
  const maximizedNow = manualMaximized || win.isMaximized() || windowCoversWorkArea(win);

  let grabOffsetX;
  let grabOffsetY;
  let width;
  let height;
  if (maximizedNow) {
    const ratioX = clampNumber(Number(payload && payload.ratioX) || 0, 0, 1);
    const offsetY = Math.max(0, Number(payload && payload.offsetY) || 0);
    width = Math.min(DEFAULT_WINDOW_WIDTH, workArea.width);
    height = Math.min(DEFAULT_WINDOW_HEIGHT, workArea.height);
    grabOffsetX = Math.round(width * ratioX);
    grabOffsetY = Math.round(clampNumber(offsetY, 0, height));

    if (win.isFullScreen()) {
      win.setFullScreen(false);
    }
    manualMaximized = false;
    const x = clampNumber(cursor.x - grabOffsetX, workArea.x, workArea.x + workArea.width - width);
    const y = clampNumber(cursor.y - grabOffsetY, workArea.y, workArea.y + workArea.height - height);
    // setBounds also unmaximizes a natively maximized window in one step.
    win.setBounds({ x, y, width, height });
  } else {
    const bounds = win.getBounds();
    width = bounds.width;
    height = bounds.height;
    grabOffsetX = clampNumber(cursor.x - bounds.x, 0, width);
    grabOffsetY = clampNumber(cursor.y - bounds.y, 0, height);
  }

  titlebarDragState = { grabOffsetX, grabOffsetY, width, height };
  if (maximizedNow) {
    rememberNormalBounds(win, "titlebar-drag-restore");
  }
  broadcastWindowState(win, maximizedNow ? "titlebar-drag-restore" : "titlebar-drag-begin");

  // Follow the cursor until endTitlebarDrag. Polling here keeps motion smooth and
  // independent of renderer IPC rate. Use setBounds with the pinned width/height:
  // plain setPosition lets Windows/DWM recompute the size of this transparent
  // frameless window, which drifts (grows) on fractional-DPI displays.
  titlebarDragTimer = setInterval(() => {
    if (!titlebarDragState || !win || win.isDestroyed()) {
      stopTitlebarDragTimer();
      return;
    }
    const point = screen.getCursorScreenPoint();
    win.setBounds({
      x: point.x - titlebarDragState.grabOffsetX,
      y: point.y - titlebarDragState.grabOffsetY,
      width: titlebarDragState.width,
      height: titlebarDragState.height
    });
  }, 8);

  return getWindowStatePayload(win);
}

function endTitlebarDrag(win) {
  const wasDragging = Boolean(titlebarDragState);
  titlebarDragState = null;
  stopTitlebarDragTimer();
  if (!win || win.isDestroyed()) {
    return null;
  }
  if (wasDragging) {
    rememberNormalBounds(win, "titlebar-drag-end");
    broadcastWindowState(win, "titlebar-drag-end");
  }
  return getWindowStatePayload(win);
}

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
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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
  mainWindow.setHasShadow(false);
  manualMaximized = false;
  windowTransitioning = false;
  lastNormalBounds = { ...mainWindow.getBounds() };

  if (logsDir) {
    writeStartupLog(logsDir, `window mode: ${WINDOW_MODE}`);
    writeStartupLog(logsDir, `BrowserWindow created: frame=false, transparent=true, hasShadow=false`);
    writeStartupLog(logsDir, `[window] after-create hasShadow=${mainWindow.hasShadow()}`);
    logWindowState(mainWindow, "after-create");
  }

  const diagnosticEvents = ["maximize", "unmaximize", "restore", "minimize", "resized", "moved", "enter-full-screen", "leave-full-screen"];
  for (const eventName of diagnosticEvents) {
    mainWindow.on(eventName, () => logWindowState(mainWindow, `event:${eventName}`));
  }

  mainWindow.on("resize", () => rememberNormalBounds(mainWindow, "resize"));
  mainWindow.on("move", () => rememberNormalBounds(mainWindow, "move"));

  mainWindow.on("closed", () => {
    logWindowState(mainWindow, "event:closed");
    mainWindow = null;
    lastNormalBounds = null;
    manualMaximized = false;
    windowTransitioning = false;
    titlebarDragState = null;
    stopTitlebarDragTimer();
  });

  // Window state change events for frontend shell styling
  mainWindow.on("maximize", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      if (!mainWindow.isMaximized() && windowCoversWorkArea(mainWindow)) {
        manualMaximized = true;
      }
      broadcastWindowState(mainWindow, "event:maximize");
    }
  });
  mainWindow.on("unmaximize", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      manualMaximized = false;
      rememberNormalBounds(mainWindow, "unmaximize");
      broadcastWindowState(mainWindow, "event:unmaximize");
    }
  });
  mainWindow.on("restore", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      manualMaximized = false;
      rememberNormalBounds(mainWindow, "restore");
      broadcastWindowState(mainWindow, "event:restore");
    }
  });
  mainWindow.on("enter-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      broadcastWindowState(mainWindow, "event:enter-full-screen");
    }
  });
  mainWindow.on("leave-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      broadcastWindowState(mainWindow, "event:leave-full-screen");
    }
  });
  mainWindow.on("minimize", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !windowTransitioning) {
      broadcastWindowState(mainWindow, "event:minimize");
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setHasShadow(false);
      mainWindow.show();
      mainWindow.focus();
      if (logsDir) {
        writeStartupLog(logsDir, "BrowserWindow ready-to-show，窗口已显示");
        writeStartupLog(logsDir, `[window] ready-to-show hasShadow=${mainWindow.hasShadow()}`);
        logWindowState(mainWindow, "ready-to-show");
      }
    }
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const computedStyles = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const selectors = ["html", "body", "#root", ".window-root", ".window-shell"];
          return Object.fromEntries(selectors.map((selector) => {
            const element = document.querySelector(selector);
            if (!element) return [selector, null];
            const style = getComputedStyle(element);
            return [selector, {
              background: style.background,
              backgroundColor: style.backgroundColor,
              boxShadow: style.boxShadow,
              filter: style.filter,
              backdropFilter: style.backdropFilter,
              border: style.border,
              outline: style.outline,
              overflow: style.overflow,
              padding: style.padding,
              borderRadius: style.borderRadius,
              width: style.width,
              height: style.height
            }];
          }));
        })()
      `);
      writeStartupLog(logsDir, `[window] computed-styles=${JSON.stringify(computedStyles)}`);
    } catch (error) {
      writeStartupLog(logsDir, `[window] computed-styles failed: ${String(error)}`);
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

  ipcMain.handle("window:get-state", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    logWindowState(win, "ipc:before", "window:get-state");
    return win && !win.isDestroyed()
      ? getWindowStatePayload(win)
      : { maximized: false, fullscreen: false, bounds: null, mode: "native" };
  });

  // Window control commands (frame:false requires custom buttons)
  // Use BrowserWindow.fromWebContents(event.sender) to get the actual window,
  // avoiding stale closure references.
  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    logWindowState(win, "ipc:before", "window:minimize");
    if (win && !win.isDestroyed()) {
      win.minimize();
      logWindowState(win, "ipc:after", "window:minimize");
    }
  });
  ipcMain.handle("window:toggle-maximize", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return toggleWindowMaximize(win, "window:toggle-maximize");
  });
  // Custom title-bar drag (no-drag region; native drag regions swallow dblclick).
  ipcMain.handle("window:begin-titlebar-drag", (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return beginTitlebarDrag(win, payload);
  });
  ipcMain.handle("window:end-titlebar-drag", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return endTitlebarDrag(win);
  });
  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    logWindowState(win, "ipc:before", "window:close");
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
