/**
 * Dirty-state cache shared between the `setDirty` IPC handler and the
 * BrowserWindow close handler. The renderer sends `setDirty(true|false)`
 * whenever its dirty state changes; the close handler reads the cached
 * flag synchronously to decide whether to prompt the user.
 *
 * Extracted from `main/index.ts` in slice #233-followup so the close
 * handler (in index.ts) and the IPC handler (in handlers/file.ts) can
 * share one source of truth without circular imports.
 */

let rendererHasUnsavedChanges = false;

/** Read the cached dirty flag. Synchronous — used inside the
 *  BrowserWindow `close` handler. */
export function getDirty(): boolean {
  return rendererHasUnsavedChanges;
}

/** Update the cached dirty flag. Called from the IPC handler when the
 *  renderer reports a state change, and from the close handler after
 *  the user picks Discard. */
export function setDirty(value: boolean): void {
  rendererHasUnsavedChanges = Boolean(value);
}
