import { useEffect } from "react";

let lockCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

/**
 * Lock background page scrolling while an overlay (bottom sheet / fullscreen
 * preview) is open. Setting `overflow: hidden` preserves the current scroll
 * position (it does not reset scrollTop), so when the overlay closes the photo
 * wall is exactly where the user left it. Reference-counted so nested overlays
 * don't unlock each other prematurely.
 */
export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    lockCount += 1;
    if (lockCount === 1) {
      previousBodyOverflow = document.body.style.overflow;
      previousHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
      }
    };
  }, [active]);
}
