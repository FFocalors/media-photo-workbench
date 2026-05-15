const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const path = require("node:path");

const isDev = !app.isPackaged;

/** @type {import('../dist-server/index').ServerHandle | null} */
let serverHandle = null;

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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f6f8fb",
    title: "Media Photo Workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
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
  const appDataRoot = getAppDataRoot();

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

  ipcMain.handle("shell:open-path", async (_event, fullPath) => {
    return shell.openPath(fullPath);
  });

  // 启动后端服务
  try {
    const { startServer } = require("../dist-server/index");
    serverHandle = await startServer(appDataRoot);
    console.log(`[main] 后端服务已启动，端口: ${serverHandle.port}`);
  } catch (err) {
    console.error("[main] 后端服务启动失败:", err);
    // 后端启动失败不阻塞窗口打开，前端会回退到 mock 数据
  }

  setChineseMenu();
  createWindow();

  // 将真实端口发送给渲染进程
  if (serverHandle) {
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      win.webContents.on("did-finish-load", () => {
        win.webContents.send("set-api-port", serverHandle.port);
      });
      // 如果页面已经加载完毕，立即发送
      if (!win.webContents.isLoading()) {
        win.webContents.send("set-api-port", serverHandle.port);
      }
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (serverHandle) {
    serverHandle.close();
    serverHandle = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
