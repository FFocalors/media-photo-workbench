import { create } from "zustand";

interface WindowShellState {
  maximized: boolean;
  fullscreen: boolean;
  setWindowState: (state: { maximized: boolean; fullscreen: boolean }) => void;
}

export const useWindowShellStore = create<WindowShellState>((set) => ({
  maximized: false,
  fullscreen: false,
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

  // Sync initial state
  const initial = bridge.getWindowState();
  useWindowShellStore.getState().setWindowState(initial);

  // Subscribe to changes
  return bridge.onWindowStateChanged((state) => {
    useWindowShellStore.getState().setWindowState(state);
  });
}
