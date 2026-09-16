/**
 * useReloadFromDisk (RELOAD-3).
 *
 * One shared "reload the open file from disk" action, used by both the
 * File → Reload from Disk menu item and the "changed on disk" banner
 * (RELOAD-2).
 *
 * Behaviour:
 *   - Clean editor (no unsaved edits) → reload immediately.
 *   - Unsaved edits → open a confirm dialog first; reloading discards
 *     those edits.
 *
 * The reload itself is `reloadFromDisk` from useFileState — an
 * in-place content refresh that keeps the editor's UI state (open
 * tabs, active tab, scroll). It does NOT use `openPath`, which would
 * reset all of that.
 */

import { useCallback, useState } from "react";

export interface UseReloadFromDiskArgs {
  /** Whether a file is currently open (and so reloadable). */
  canReload: boolean;
  /** Whether the editor currently holds unsaved edits. */
  dirty: boolean;
  /** Re-read the open file in place (refresh content, keep UI state). */
  reload: () => void;
  /**
   * Called right before a reload actually runs — lets the caller clear
   * transient UI, e.g. the RELOAD-2 "changed on disk" banner.
   */
  onBeforeReload?: () => void;
}

export interface UseReloadFromDiskResult {
  /** True while the discard-confirm dialog should be shown. */
  confirmOpen: boolean;
  /**
   * Trigger a reload. Reloads immediately when the editor is clean;
   * opens the discard-confirm dialog when there are unsaved edits.
   */
  requestReload: () => void;
  /** Confirm "discard my edits and reload" from the dialog. */
  confirmReload: () => void;
  /** Dismiss the discard-confirm dialog without reloading. */
  cancelReload: () => void;
}

export function useReloadFromDisk({
  canReload,
  dirty,
  reload,
  onBeforeReload,
}: UseReloadFromDiskArgs): UseReloadFromDiskResult {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doReload = useCallback((): void => {
    if (!canReload) return;
    onBeforeReload?.();
    reload();
  }, [canReload, reload, onBeforeReload]);

  const requestReload = useCallback((): void => {
    if (!canReload) return;
    if (dirty) {
      setConfirmOpen(true);
      return;
    }
    doReload();
  }, [canReload, dirty, doReload]);

  const confirmReload = useCallback((): void => {
    setConfirmOpen(false);
    doReload();
  }, [doReload]);

  const cancelReload = useCallback((): void => {
    setConfirmOpen(false);
  }, []);

  return { confirmOpen, requestReload, confirmReload, cancelReload };
}
