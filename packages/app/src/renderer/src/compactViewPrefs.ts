/**
 * Persistence for the global "Compact view" toggle.
 *
 * Compact view is a user preference (not document state): whatever the
 * user chose last time should be in effect on the next launch. Mirrors
 * sidebarPrefs.ts — same KeyValueStore abstraction so unit tests don't
 * need a real localStorage, and the same defensive try/catch so a
 * sandboxed context where localStorage throws doesn't take the app down.
 */

export const COMPACT_VIEW_KEY = "molio2.compactView";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the saved compact-view flag. Missing/invalid values default to
 * `false` (compact view starts OFF on first launch — the full spec is
 * the "safe default" most users expect).
 */
export function readCompactView(store: KeyValueStore): boolean {
  try {
    const raw = store.getItem(COMPACT_VIEW_KEY);
    return raw === "true";
  } catch {
    return false;
  }
}

/**
 * Persist the compact-view flag. Silently swallows storage errors —
 * losing the preference isn't worth crashing over.
 */
export function writeCompactView(store: KeyValueStore, compact: boolean): void {
  try {
    store.setItem(COMPACT_VIEW_KEY, String(compact));
  } catch {
    /* ignore */
  }
}
