import { create } from "zustand";

interface WindowShellState {
  maximized: boolean;
  fullscreen: boolean;
  bounds: WindowState["bounds"];
  mode: WindowState["mode"];
  setWindowState: (state: WindowState) => void;
}

export const useWindowShellStore = create<WindowShellState>((set) => ({
  maximized: false,
  fullscreen: false,
  bounds: null,
  mode: "native",
  setWindowState: (state) => set(state)
}));

/**
 * Initialize window state from Electron preload and subscribe to changes.
 * Safe to call in non-Electron environments (no-op).
 * Returns an unsubscribe function.
 */
export function initWindowStateListener(): () => void {
  const bridge = window.mediaPhotoWorkbench;
  if (!bridge?.getWindowState || !bridge?.onWindowStateChanged) {
    return () => {};
  }

  let disposed = false;
  const unsubscribe = bridge.onWindowStateChanged((state) => {
    if (disposed) return;
    useWindowShellStore.getState().setWindowState(state);
  });

  void bridge.getWindowState().then((state) => {
    if (!disposed) {
      useWindowShellStore.getState().setWindowState(state);
    }
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}

/** Toggle through the main-process state machine and apply only its confirmed result. */
export async function toggleWindowMaximize(): Promise<WindowState | null> {
  const state = await window.mediaPhotoWorkbench?.windowMaximizeToggle();
  if (state) {
    useWindowShellStore.getState().setWindowState(state);
  }
  return state ?? null;
}
