import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";

/**
 * Reusable mobile bottom sheet.
 *
 * - Fixed backdrop blocks all interaction with the page behind it (no
 *   accidental taps on the photo wall) and closes the sheet when tapped.
 * - Panel is anchored to the bottom, never exceeds the given max height
 *   (default 92dvh, always < 100dvh), and pads for the home-indicator safe
 *   area. Its content scrolls internally with touch momentum.
 * - Background scroll is locked while open and restored (position preserved)
 *   on close via useLockBodyScroll.
 *
 * Rendered through a portal so it is never clipped by an ancestor's overflow.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeightClass = "mpw-max-h-92",
  closeOnBackdrop = true,
  showClose = true
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxHeightClass?: string;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
}) {
  useLockBodyScroll(open);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      {/* Backdrop — blocks background interaction; tap to dismiss. */}
      <button
        aria-label="关闭"
        className="mpw-anim-fade absolute inset-0 h-full w-full cursor-default bg-slate-950/50"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
        tabIndex={-1}
        type="button"
      />

      {/* Panel */}
      <div
        className={cn(
          "mpw-anim-sheet absolute inset-x-0 bottom-0 flex w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl",
          maxHeightClass
        )}
      >
        {/* Drag handle + header */}
        <div className="shrink-0">
          <div className="flex justify-center pt-2">
            <span className="h-1.5 w-10 rounded-full bg-slate-200" />
          </div>
          {(title || showClose) && (
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-2">
              <div className="min-w-0">
                {title && <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>}
                {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
              </div>
              {showClose && (
                <button
                  aria-label="关闭"
                  className="mpw-touch flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
                  onClick={onClose}
                  type="button"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>

        {/* Footer (e.g. reset / apply) — sits above the home indicator. */}
        {footer && (
          <div className="shrink-0 border-t border-slate-100 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body
  );
}
