import { create } from "zustand";

export interface CurrentPageEvent {
  eventId: string;
  eventName: string;
}

interface CurrentPageEventState {
  event: CurrentPageEvent | null;
  owner: string | null;
  updatedAt: number;
  setCurrentPageEvent: (event: CurrentPageEvent, owner: string) => void;
  clearCurrentPageEvent: (owner: string) => void;
}

/**
 * Lightweight store for the title bar to display the currently active event.
 * Pages sync their selected event here; the title bar only reads it.
 *
 * `owner` prevents stale page cleanup from clearing a newer page's event:
 *  - Page A sets event with owner "photo-wall"
 *  - User navigates to Page B, which sets event with owner "import"
 *  - Page A's cleanup calls clearCurrentPageEvent("photo-wall")
 *    → owner mismatch ("import" != "photo-wall"), so state is preserved.
 */
export const useCurrentPageEventStore = create<CurrentPageEventState>((set) => ({
  event: null,
  owner: null,
  updatedAt: 0,
  setCurrentPageEvent: (event, owner) =>
    set({ event, owner, updatedAt: Date.now() }),
  clearCurrentPageEvent: (owner) =>
    set((state) => {
      if (state.owner === owner) {
        return { event: null, owner: null, updatedAt: Date.now() };
      }
      return state;
    })
}));
