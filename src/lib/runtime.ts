/**
 * Runtime environment helper.
 *
 * The app runs in two hosts:
 *  - Electron desktop (frameless BrowserWindow + preload bridge at
 *    `window.mediaPhotoWorkbench`).
 *  - Plain browser (Vite dev server at 5173, or the backend-served production
 *    page at the LAN IP/host).
 *
 * The Electron preload bridge is the only reliable signal — `navigator.userAgent`
 * can be spoofed, so we never fall back to it. Pure read of a window-scope
 * property; it does not touch the Electron API or window state store.
 */

/** True when running inside the Electron shell. */
export function isElectronRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.mediaPhotoWorkbench);
}
