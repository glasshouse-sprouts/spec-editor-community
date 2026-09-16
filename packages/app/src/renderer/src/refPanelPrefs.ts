/**
 * Persistence for the default "reference panel collapsed" preference.
 *
 * Mirrors `sidebarPrefs.ts` and `compactViewPrefs.ts`: a tiny, injectable
 * KV layer so unit tests can swap in a Map-backed store without pulling in
 * jsdom or real `localStorage`.
 *
 * Scope: this module stores a *default* that newly opened tabs inherit. The
 * actual collapsed/expanded flag lives per tab in `TabUiState`, so each tab
 * can diverge during a session. The default is re-written every time the
 * user toggles the pane — so next time a tab opens (or the app restarts),
 * the most recent choice sticks.
 */

export const REF_PANEL_COLLAPSED_KEY = "molio2.refPanel.collapsed";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the saved collapsed flag. Missing/invalid values default to
 * `false` (reference panel starts expanded on first launch).
 */
export function readRefPanelCollapsed(store: KeyValueStore): boolean {
  try {
    const raw = store.getItem(REF_PANEL_COLLAPSED_KEY);
    return raw === "true";
  } catch {
    // localStorage can throw in sandboxed contexts — fall back to the
    // expanded default rather than crashing the whole app.
    return false;
  }
}

/**
 * Persist the collapsed flag. Silently swallows storage errors — not
 * being able to remember the preference shouldn't break the UI.
 */
export function writeRefPanelCollapsed(
  store: KeyValueStore,
  collapsed: boolean,
): void {
  try {
    store.setItem(REF_PANEL_COLLAPSED_KEY, String(collapsed));
  } catch {
    /* ignore */
  }
}
