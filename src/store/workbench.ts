import { create } from "zustand";
import type { WorkbenchMode } from "../types";

interface WorkbenchState {
  mode: WorkbenchMode | null;
  userName: string;
  role: string;
  deviceName: string;
  setMode: (mode: WorkbenchMode) => void;
  setProfile: (profile: { userName: string; role: string; deviceName: string }) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  mode: null,
  userName: "值班编辑",
  role: "管理员",
  deviceName: "Host-PC",
  setMode: (mode) => set({ mode }),
  setProfile: (profile) => set(profile)
}));
