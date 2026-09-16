/**
 * Recent-projects list for the Welcome screen + the File → Open
 * Recent menu (UX1, 2026-04-27).
 *
 * "Welcome screen" is the big landing page the user sees when no file
 * is open (see App.tsx, `state.kind === "idle"`). It shows a big Open
 * button, a drop-zone, and — powered by this module — a short list of
 * recently-opened projects the user can click to re-open.
 *
 * Storage layer
 * -------------
 * The injected `KeyValueStore` is `prefStore()` in production, which
 * since the PREFS series writes JSON to `app.getPath('userData')/
 * preferences.json` via IPC. (Earlier versions used
 * `window.localStorage` directly; that turned out to be unreliable on
 * Electron dev mode — see prefs.ts comment.) Entries are keyed by
 * absolute file path; opening the same file twice moves its entry back
 * to the top instead of adding a duplicate.
 *
 * Main-process side reads the same JSON file directly to build the
 * File → Open Recent submenu — it doesn't go through this module
 * (no renderer code in main). When the renderer writes a new list,
 * preferences.ts fires `onPrefChange` and main rebuilds the menu.
 *
 * This module is pure: no React, no window globals, no IPC. The
 * storage layer is injected so tests can use a Map-backed stand-in.
 */

export const RECENT_FILES_KEY = "molio2.recentFiles";

/** How many entries we keep at most. Newest first; anything past this
 *  falls off the bottom. The Welcome screen only shows 5, but we keep
 *  the cap in a named constant so it's easy to tune later. */
export const RECENT_FILES_MAX = 5;

/** Minimal Storage-interface subset we need — matches other pref modules. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * One entry in the recent-projects list.
 *
 * - `path` is the absolute filesystem path. Used as the entry's
 *   identity — duplicates get deduped on insert.
 * - `projectName` is the label from the file's `project.name` column.
 *   Empty string when the file has no project row (older schema) — the
 *   UI falls back to the filename in that case.
 * - `openedAt` is a Unix-epoch millisecond timestamp. Currently only
 *   used for ordering, but keeping the raw number (instead of just
 *   relying on array position) means we can show "2 hours ago"-style
 *   labels later without migrating stored data.
 */
export interface RecentFileEntry {
  path: string;
  projectName: string;
  openedAt: number;
}

/**
 * Read the saved list. Missing storage, malformed JSON, or entries
 * that don't look like `RecentFileEntry` all fall back to an empty
 * list — we never want a corrupt localStorage key to crash the app.
 */
export function readRecentFiles(store: KeyValueStore): RecentFileEntry[] {
  try {
    const raw = store.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only entries that pass a shape check. We're defensive here
    // because this data crosses app versions — an old version might
    // have written a slightly different shape.
    return parsed.filter(isValidEntry);
  } catch {
    // JSON.parse threw, or storage refused to read (privacy modes, etc.)
    return [];
  }
}

/**
 * Write the list. Silently swallows storage errors — not being able
 * to remember recent files shouldn't prevent the user from opening one.
 */
export function writeRecentFiles(
  store: KeyValueStore,
  entries: RecentFileEntry[],
): void {
  try {
    store.setItem(RECENT_FILES_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

/**
 * Add a freshly-opened file to the top of the list. Pure — returns a
 * new array, doesn't mutate `current`.
 *
 * Rules:
 *   - If `path` already exists in the list (case-sensitive match on
 *     path), the old entry is removed first. The new entry then goes
 *     to the top with an updated timestamp. This means re-opening a
 *     file "refreshes" its position instead of creating a duplicate.
 *   - The list is capped at `RECENT_FILES_MAX`; oldest entries fall
 *     off the bottom.
 *   - Whitespace in `path` is preserved as-is (filesystem paths can
 *     legitimately contain leading/trailing spaces on some OSes).
 *
 * `openedAt` defaults to `Date.now()` so callers don't have to think
 * about timestamps; tests pass an explicit value for determinism.
 */
export function addRecentFile(
  current: RecentFileEntry[],
  entry: { path: string; projectName: string },
  openedAt: number = Date.now(),
): RecentFileEntry[] {
  const filtered = current.filter((e) => e.path !== entry.path);
  const next: RecentFileEntry[] = [
    { path: entry.path, projectName: entry.projectName, openedAt },
    ...filtered,
  ];
  return next.slice(0, RECENT_FILES_MAX);
}

/**
 * Drop one entry by path. Used by the Welcome screen's right-click
 * "Remove from list" action — typically when a file has moved or been
 * deleted and the user wants the stale entry out of the way.
 *
 * Pure — returns a new array.
 */
export function removeRecentFile(
  current: RecentFileEntry[],
  path: string,
): RecentFileEntry[] {
  return current.filter((e) => e.path !== path);
}

/** Shape check for one entry read out of storage. */
function isValidEntry(x: unknown): x is RecentFileEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.path === "string" &&
    e.path.length > 0 &&
    typeof e.projectName === "string" &&
    typeof e.openedAt === "number" &&
    Number.isFinite(e.openedAt)
  );
}
