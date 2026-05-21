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
