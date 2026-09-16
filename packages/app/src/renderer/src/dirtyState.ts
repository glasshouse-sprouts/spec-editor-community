/**
 * Pure helpers for the dirty-state + save pipeline (Phase 6 Slice A).
 *
 * Kept DOM- and React-free so the logic can be unit-tested in isolation.
 * Consumers: App.tsx for whole-file dirty tracking and tab dirty flags;
 * conflict resolution dialog; the title-bar / tab dirty-dot rendering.
 */

/**
 * Which tabs currently hold unsaved changes. Key is the tab id (opaque
 * string from tabs.ts), value is always `true` — we use the map so we can
 * spread/merge it cheaply in React state.
 *
 * When a tab is saved (or its edits are discarded), the entry is removed
 * rather than set to `false`, which keeps size(dirtyMap) an accurate
 * count of dirty tabs.
 */
export type DirtyMap = Readonly<Record<string, true>>;

/** Flip a tab's dirty state. Returns a new object (immutable-safe). */
export function setTabDirty(
  map: DirtyMap,
  tabId: string,
  dirty: boolean,
): DirtyMap {
  if (dirty) {
    if (map[tabId]) return map;
    return { ...map, [tabId]: true };
  }
  if (!map[tabId]) return map;
  const next = { ...map };
  delete next[tabId];
  return next;
}

/** True if any tab in `map` is dirty. */
export function anyDirty(map: DirtyMap): boolean {
  return Object.keys(map).length > 0;
}

/** True if `tabId` has unsaved changes. */
export function isTabDirty(map: DirtyMap, tabId: string): boolean {
  return map[tabId] === true;
}

/**
 * Drop entries for tab ids that no longer exist. Called when a tab is
 * closed so the dirty map doesn't leak keys. Also called after a
 * successful save (pass `new Set()` to mark everything clean).
 */
export function pruneDirtyMap(
  map: DirtyMap,
  keepTabIds: ReadonlySet<string>,
): DirtyMap {
  let changed = false;
  const next: Record<string, true> = {};
  for (const k of Object.keys(map)) {
    if (keepTabIds.has(k)) {
      next[k] = true;
    } else {
      changed = true;
    }
  }
  return changed ? next : map;
}

// ---------------------------------------------------------------------------
// Disk-conflict detection
// ---------------------------------------------------------------------------

/**
 * Result of comparing the file's current on-disk mtime to the mtime we
 * observed when we loaded it (or last saved it).
 *
 *   - "clean"     current mtime matches stored mtime → safe to write
 *   - "conflict"  another program edited the file while we had it open
 *   - "missing"   the file no longer exists at the stored path
 */
export type ConflictState = "clean" | "conflict" | "missing";

/**
 * Classify the conflict state.
 *
 * mtimes are numbers in "milliseconds since the Unix epoch" as returned
 * by `fs.stat().mtimeMs`. We use strict equality — filesystem mtime
 * granularity is platform-dependent (often 1s on Windows, ns on modern
 * Linux) but identical within a single OS, so if nothing has written to
 * the file the two numbers will match exactly.
 *
 * A `null` currentMtime means `fs.stat` threw, which we treat as
 * "missing" — e.g. the user renamed or deleted the file externally.
 */
export function detectConflict(
  storedMtime: number,
  currentMtime: number | null,
): ConflictState {
  if (currentMtime === null) return "missing";
  if (currentMtime === storedMtime) return "clean";
  return "conflict";
}
