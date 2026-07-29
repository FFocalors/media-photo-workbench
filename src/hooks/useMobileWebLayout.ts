import { useEffect, useState } from "react";
import { isElectronRuntime } from "../lib/runtime";

/**
 * Mobile web layout detection.
 *
 * The app has three runtime surfaces that must never regress:
 *   - Electron desktop (frameless window, custom title bar, min-width 1120px)
 *   - Desktop browser (mouse + hover, roomy viewport)
 *   - Mobile browser (touch-first phone, small viewport)  <- this hook
 *
 * We deliberately do NOT sniff the user agent. Instead we combine:
 *   1. Not running inside the Electron shell (`window.mediaPhotoWorkbench`).
 *   2. The primary input is touch: `pointer: coarse` + `hover: none`.
 *   3. A small viewport width.
 *
 * Width gate: the classic 767px phone-portrait breakpoint is NOT enough on its
 * own, because a landscape phone is wider than it is tall (e.g. 844x390, or
 * 932x430 on a Pro Max). The spec explicitly requires landscape phones to use
 * the mobile layout, so the gate is 1024px. That also lets small tablets use
 * the touch-optimized layout, while mouse-driven desktops (pointer: fine,
 * hover: hover) are excluded regardless of window width.
 */
export const MOBILE_WEB_MEDIA_QUERY =
  "(max-width: 1024px) and (hover: none) and (pointer: coarse)";

/** Attribute set on <html> while the mobile web layout is active. CSS is gated on it. */
export const MOBILE_WEB_ATTRIBUTE = "data-mobile-web";

function computeIsMobileWeb(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  if (isElectronRuntime()) {
    return false;
  }
  try {
    return window.matchMedia(MOBILE_WEB_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/** Synchronous read (non-reactive). Useful outside React render. */
export function isMobileWebLayout(): boolean {
  return computeIsMobileWeb();
}

/**
 * Keep `<html data-mobile-web="true">` in sync with the current environment.
 * Called once from `main.tsx` before the first render so the CSS overrides are
 * present on the very first paint (avoids a flash of the desktop min-width).
 * The matchMedia listener keeps it correct across rotation / resize.
 */
export function initMobileWebAttribute(): void {
  if (typeof document === "undefined") return;

  const apply = () => {
    if (computeIsMobileWeb()) {
      document.documentElement.setAttribute(MOBILE_WEB_ATTRIBUTE, "true");
    } else {
      document.documentElement.removeAttribute(MOBILE_WEB_ATTRIBUTE);
    }
  };

  apply();

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mql = window.matchMedia(MOBILE_WEB_MEDIA_QUERY);
    const listener = () => apply();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", listener);
    } else if (typeof (mql as any).addListener === "function") {
      // Safari < 14
      (mql as any).addListener(listener);
    }
  }
}

/**
 * Reactive hook: true when the current environment should use the mobile web
 * layout. Initialized synchronously so the first render is already correct.
 */
export function useMobileWebLayout(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(computeIsMobileWeb);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(MOBILE_WEB_MEDIA_QUERY);
    const update = () => setIsMobile(computeIsMobileWeb());
    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    if (typeof (mql as any).addListener === "function") {
      (mql as any).addListener(update);
      return () => (mql as any).removeListener(update);
    }
    return undefined;
  }, []);

  return isMobile;
}
