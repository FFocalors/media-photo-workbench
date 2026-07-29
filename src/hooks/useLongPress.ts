import { useRef } from "react";

const DEFAULT_DELAY_MS = 500;
const MOVE_TOLERANCE_PX = 12;

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/**
 * Long-press vs tap disambiguation for touch cards.
 *
 * A quick press fires `onTap`; holding for `delay` fires `onLongPress` exactly
 * once and suppresses the trailing click so the two never both run. Movement
 * beyond a small tolerance cancels the long-press (the user is scrolling).
 *
 * We also prevent the native context menu / iOS image callout on the target so
 * a long-press on a thumbnail opens our quick-action sheet instead of the
 * browser's "save image" menu.
 */
export function useLongPress({
  onTap,
  onLongPress,
  delay = DEFAULT_DELAY_MS
}: {
  onTap?: () => void;
  onLongPress?: () => void;
  delay?: number;
}): LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    longPressFiredRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress?.();
    }, delay);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearTimer();
    }
  };

  const onPointerUp = () => {
    clearTimer();
    startRef.current = null;
  };

  const onPointerCancel = () => {
    clearTimer();
    startRef.current = null;
  };

  const onClick = (event: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      // Swallow the click that follows a long-press.
      longPressFiredRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onTap?.();
  };

  const onContextMenu = (event: React.MouseEvent) => {
    // Suppress the browser's native long-press context menu on the card.
    event.preventDefault();
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick, onContextMenu };
}
