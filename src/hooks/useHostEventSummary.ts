import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentPageEventStore } from "../stores/currentPageEventStore";
import { fetchEventSummary, type EventSummaryData } from "../lib/api";
import { subscribeRealtimeImageEvent } from "../lib/socket";

const DEBOUNCE_MS = 500;

/**
 * Hook for HostLayout to get the current page event's summary (total_images, edited_images).
 * Uses the currentPageEventStore for the event and Socket.IO for real-time refresh.
 */
export function useHostEventSummary(): EventSummaryData | null {
  const pageEvent = useCurrentPageEventStore((s) => s.event);
  const [summary, setSummary] = useState<EventSummaryData | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventIdRef = useRef<string | null>(null);

  const doFetch = useCallback(async (eventId: string) => {
    try {
      const res = await fetchEventSummary(eventId);
      // Only apply if the eventId hasn't changed since we started fetching
      if (eventIdRef.current === eventId && res.ok && res.data) {
        setSummary(res.data);
      }
    } catch {
      // silently ignore — title bar should not crash the app
    }
  }, []);

  // Fetch when event changes
  useEffect(() => {
    eventIdRef.current = pageEvent?.eventId ?? null;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!pageEvent?.eventId) {
      setSummary(null);
      return;
    }
    void doFetch(pageEvent.eventId);
  }, [pageEvent?.eventId, doFetch]);

  // Debounced refresh on Socket.IO image events
  useEffect(() => {
    if (!pageEvent?.eventId) return;
    const eventId = pageEvent.eventId;

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void doFetch(eventId);
      }, DEBOUNCE_MS);
    };

    // Subscribe to all image change events
    const unsubCreated = subscribeRealtimeImageEvent("image-created", (payload) => {
      if (payload.eventId === eventId) scheduleRefresh();
    });
    const unsubUpdated = subscribeRealtimeImageEvent("image-updated", (payload) => {
      if (payload.eventId === eventId) scheduleRefresh();
    });
    const unsubDeleted = subscribeRealtimeImageEvent("image-deleted-logical", (payload) => {
      if (payload.eventId === eventId) scheduleRefresh();
    });

    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [pageEvent?.eventId, doFetch]);

  return summary;
}
