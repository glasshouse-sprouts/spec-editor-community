/**
 * Per-project dismissal memory for the "orphan PFBB masters" banner
 * (Slice 10H.6b).
 *
 * Why per-project?
 * ────────────────
 * The banner pops up on every file-open when orphans are detected. A
 * user who sees it for the first time on project A, says "not now",
 * shouldn't be nagged by it again every time they reopen that file.
 * But project B might still be orphan-free; dismissing A must not
 * silence B.
 *
 * Storage strategy
 * ────────────────
 * Keyed by the absolute project path. Value = "dismissed": true (the
 * user clicked "Not now" on this specific project). Any other value
 * (or missing) means the banner is eligible to show.
 *
 * Running "Move them now" clears the dismissal — same as migrating
 * would: once the project is clean there's nothing to show anyway,
 * and if it regresses later the user wants to hear about it.
 *
 * Like `sidebarPrefs.ts`, the store is injectable so tests can pass a
 * Map-backed stand-in without touching `window.localStorage`.
 */

const KEY_PREFIX = "molio2.pfbbMigration.dismissed:";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function keyFor(projectPath: string): string {
  return KEY_PREFIX + projectPath;
}

/**
 * Has the user dismissed the banner for this specific project?
 * Defaults to `false` (show banner) on any error or missing value.
 */
export function isPfbbMigrationDismissed(
  store: KeyValueStore,
  projectPath: string,
): boolean {
  try {
    return store.getItem(keyFor(projectPath)) === "true";
  } catch {
    return false;
  }
}

/**
 * Record that the user dismissed the banner for this project. Silently
 * swallows storage errors — not being able to remember the dismissal
 * is an inconvenience, not a crash.
 */
export function setPfbbMigrationDismissed(
  store: KeyValueStore,
  projectPath: string,
): void {
  try {
    store.setItem(keyFor(projectPath), "true");
  } catch {
    /* ignore */
  }
}

/**
 * Clear the dismissal for this project. Used after a successful
 * migration (the banner shouldn't be silenced forever just because the
 * user dismissed it once — if new orphans ever appear, nag again).
 */
export function clearPfbbMigrationDismissed(
  store: KeyValueStore,
  projectPath: string,
): void {
  try {
    store.removeItem(keyFor(projectPath));
  } catch {
    /* ignore */
  }
}
