/**
 * Phase 8 round 2 — Reader mode (Læsetilstand).
 *
 * Per-user toggle that locks the editor into a read-only state.
 * When ON, every edit affordance is either visually disabled or
 * silently no-ops (defence in depth — see ReaderModeContext below).
 *
 * Why per-user, not per-document
 * ------------------------------
 * Smaller scope, no schema change, addresses the "I'm reviewing
 * today, don't let me edit by accident" use case. A per-document
 * "marked as final" flag stored in the .moliospec is parked in
 * the Icebox; if a real contractor-handoff workflow surfaces, we
 * can layer it on top of this without breaking the per-user setting.
 *
 * Storage: same `KeyValueStore` shape every other pref module uses,
 * so the prefStore() ipc-backed store from `prefs.ts` plugs in.
 *
 * UI plumbing: see `./ReaderModeContext.tsx` for the React context
 * the rest of the app reads via `useReaderMode()`.
 */

export const READER_MODE_KEY = "molio2.readerMode";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the saved reader-mode flag. Missing or malformed values
 * default to `false` (the editor starts editable, like every other
 * launch did before this slice).
 */
export function readReaderMode(store: KeyValueStore): boolean {
  try {
    return store.getItem(READER_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist the reader-mode flag. Silently swallows storage errors —
 * losing the preference isn't worth crashing over.
 */
export function writeReaderMode(store: KeyValueStore, on: boolean): void {
  try {
    store.setItem(READER_MODE_KEY, String(on));
  } catch {
    /* ignore */
  }
}
