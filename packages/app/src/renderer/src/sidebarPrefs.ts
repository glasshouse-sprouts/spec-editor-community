/**
 * Persistence for the project-sidebar collapsed/expanded state.
 *
 * Kept in a tiny module so the behaviour is easy to unit test without
 * spinning up React or jsdom for the whole App. The storage layer is
 * injectable (see the functions below) — tests can pass a Map-backed
 * stand-in; the default uses `window.localStorage`.
 */

export const SIDEBAR_COLLAPSED_KEY = "molio2.sidebar.collapsed";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the saved collapsed flag. Missing/invalid values default to
 * `false` (sidebar starts expanded on first launch).
 */
export function readSidebarCollapsed(store: KeyValueStore): boolean {
  try {
    const raw = store.getItem(SIDEBAR_COLLAPSED_KEY);
    return raw === "true";
  } catch {
    // localStorage can throw in some sandboxed contexts — fall back to
    // the "expanded" default rather than crashing the whole app.
    return false;
  }
}

/**
 * Persist the collapsed flag. Silently swallows storage errors — not
 * being able to remember the preference shouldn't break the UI.
 */
export function writeSidebarCollapsed(
  store: KeyValueStore,
  collapsed: boolean,
): void {
  try {
    store.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    /* ignore */
  }
}
