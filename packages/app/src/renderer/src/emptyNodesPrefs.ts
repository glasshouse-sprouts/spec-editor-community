/**
 * Persistence for the sidebar "Skjul tomme" (hide empty nodes) toggle
 * (#255). Mirrors `refPanelPrefs.ts`: a tiny injectable KV layer so unit
 * tests can pass a Map-backed store instead of real localStorage / the
 * IPC-backed prefStore.
 *
 * One global flag shared by every sidebar instance (main rail + the
 * embedded project-overview tree). Defaults to false — empties are shown
 * on first launch.
 */

export const SIDEBAR_HIDE_EMPTY_KEY = "molio2.sidebar.hideEmpty";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the saved flag. Missing/invalid → false (empties shown). */
export function readHideEmpty(store: KeyValueStore): boolean {
  try {
    return store.getItem(SIDEBAR_HIDE_EMPTY_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist the flag. Storage errors are swallowed — not remembering the
 *  choice must never break the UI. */
export function writeHideEmpty(store: KeyValueStore, hide: boolean): void {
  try {
    store.setItem(SIDEBAR_HIDE_EMPTY_KEY, String(hide));
  } catch {
    /* ignore */
  }
}
