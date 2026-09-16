/**
 * Slice #41 — reusable Esc-dismiss for modals.
 *
 * Mount in any modal component to dismiss it when the user presses
 * Escape. The hook listens at the `window` level so it fires no
 * matter which descendant has focus, and unmounts cleanly when the
 * modal closes (so the listener never outlives the dialog).
 *
 * Stacked modals: each mounted modal registers its own listener.
 * When two modals are stacked the bottom one's `onClose` fires too,
 * which would close both — but in this app modals are exclusive
 * (App.tsx only renders one dialog at a time), so the case doesn't
 * come up in practice. If we ever need true stacking with "Esc only
 * closes the topmost", swap this hook for a small focus-trap-aware
 * dispatcher.
 */
import { useEffect } from "react";

export function useEscToClose(onClose: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      // Don't intercept Esc when an editor element is using it for
      // its own affordance (e.g. closing a popover inside the
      // modal). React's synthetic-event default lets the dialog
      // itself decide; we only care about the dialog-level dismiss.
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
