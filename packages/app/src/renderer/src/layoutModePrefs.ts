/**
 * Persistence for the global "Layout mode" toggle.
 *
 * Layout mode is a user preference (not document state): whatever the
 * user chose last time should be in effect on the next launch. Mirrors
 * compactViewPrefs.ts — same KeyValueStore abstraction so unit tests
 * don't need a real localStorage, and the same defensive try/catch so
 * a sandboxed context where localStorage throws doesn't take the app
 * down.
 *
 *   "web"   (default) — editor fills the pane fluidly.
 *   "print" — editor content is constrained to A4 content width with
 *             a white "page" backdrop and grey gutter, so the writing
 *             experience roughly matches the printed PDF.
 */

export const LAYOUT_MODE_KEY = "molio2.layoutMode";

export type LayoutMode = "web" | "print";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the saved layout mode. Missing/invalid values default to
 * `"web"` — the fluid, familiar view is the safe default on first
 * launch.
 */
export function readLayoutMode(store: KeyValueStore): LayoutMode {
  try {
    const raw = store.getItem(LAYOUT_MODE_KEY);
    return raw === "print" ? "print" : "web";
  } catch {
    return "web";
  }
}

/**
 * Persist the layout mode. Silently swallows storage errors — losing
 * the preference isn't worth crashing over.
 */
export function writeLayoutMode(store: KeyValueStore, mode: LayoutMode): void {
  try {
    store.setItem(LAYOUT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}
