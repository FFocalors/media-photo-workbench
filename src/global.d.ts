/// <reference types="vite/client" />

/**
 * 全局类型声明。
 * 为 Electron preload 暴露的 window.mediaPhotoWorkbench 提供类型。
 */

interface MediaPhotoWorkbenchBridge {
  platform: string;
  apiBaseUrl: string;
  getRuntimeInfo: () => {
    isPackaged: boolean;
    isDev: boolean;
    serverPort: number;
    apiBaseUrl: string;
    clientBaseUrl: string;
    appVersion: string;
    appDataRoot: string;
    logsDir: string;
  };
  selectDirectory: () => Promise<string | null>;
  selectImageFiles: () => Promise<string[]>;
  getPathForFile?: (file: File) => string;
  inspectDroppedPaths?: (paths: string[]) => Promise<DroppedPathInfo[]>;
  openPath: (path: string) => Promise<string>;
  /** 获取主进程确认的当前窗口状态 */
  getWindowState: () => Promise<WindowState>;
  /** 监听窗口状态变化，返回取消监听函数 */
  onWindowStateChanged: (callback: (state: WindowState) => void) => () => void;
  /** 最小化窗口 */
  windowMinimize: () => Promise<void>;
  /** 最大化或还原窗口 */
  windowMaximizeToggle: () => Promise<WindowState>;
  /** 关闭窗口 */
  windowClose: () => Promise<void>;
  /** 开始标题栏自定义拖拽：最大化时先还原为默认尺寸并定位到鼠标下（ratioX 为标题栏横向比例，offsetY 为标题栏内纵向偏移），窗口化时按当前位置跟随 */
  beginTitlebarDrag: (payload: { ratioX: number; offsetY: number }) => Promise<WindowState | null>;
  /** 结束标题栏拖拽 */
  endTitlebarDrag: () => Promise<WindowState | null>;
}

interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  mode: "native" | "manual";
}

interface Window {
  mediaPhotoWorkbench?: MediaPhotoWorkbenchBridge;
}

interface DroppedPathInfo {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  extension: string;
  supported: boolean;
  error?: string;
}
