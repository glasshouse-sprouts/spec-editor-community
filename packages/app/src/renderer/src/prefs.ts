/**
 * Renderer-side preferences store (PREFS series, 2026-04-27).
 *
 * Drop-in replacement for `window.localStorage` for every pref
 * module that already takes a `KeyValueStore` interface
 * (sidebarPrefs, refPanelPrefs, layoutModePrefs, compactViewPrefs,
 * recentFiles, pfbbMigrationPrefs). Same shape, different backend:
 *
 *   - reads come from a snapshot the preload fetched synchronously
 *     at boot via `ipcRenderer.sendSync` (see preload/index.ts).
 *   - writes update the local cache immediately AND fire-and-forget
 *     an async IPC to main, which writes the JSON file under
 *     `app.getPath('userData')/preferences.json`.
 *
 * The cache lets hooks keep their synchronous `useState` lazy
 * initializers — a write returns synchronously and the very next
 * read sees the new value, even before the IPC promise settles.
 *
 * Why we moved off `window.localStorage`
 * --------------------------------------
 * In Electron dev mode on Tore's Mac, localStorage was being wiped
 * between `npm run dev` runs (root cause not pinned down — possibly
 * tied to the productName change moving the userData path). A plain
 * JSON file in userData has the same backing store as the rest of
 * our app config (molioApiConfig.ts) and survives every restart.
 *
 * Tests
 * -----
 * Tests pass a `Map`-backed stand-in store directly to the pref
 * modules — they don't go through this file. So this module is
 * deliberately only useful in a renderer context; it throws on
 * construction outside one.
 */

/** Match the existing `KeyValueStore` shape. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * The bridge object exposed by the preload script. Typed loosely
 * here because the full type lives in shared/ipc.ts and importing
 * it would create a cycle for unit tests.
 */
interface MolioPrefsBridge {
  initial: Record<string, string>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

let _store: KeyValueStore | null = null;

/**
 * Get the renderer-wide pref store. Three modes, picked at first
 * call:
 *
 *   1. Electron renderer with the bridge wired (the real app) →
 *      `IpcKeyValueStore`. Reads from the preload snapshot, writes
 *      go to main and persist to userData/preferences.json.
 *   2. jsdom test environment (no bridge but window.localStorage
 *      is shimmed) → `window.localStorage`. Lets existing tests
 *      that seed values via `localStorage.setItem(...)` keep
 *      working without per-test plumbing changes.
 *   3. Pure SSR / unknown env → Map-backed in-memory stand-in.
 */
export function prefStore(): KeyValueStore {
  if (_store) return _store;
  if (typeof window === "undefined") {
    return makeInMemoryStore();
  }
  if (window.molio?.prefs) {
    _store = makeIpcStore(window.molio.prefs);
    return _store;
  }
  if (typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return makeInMemoryStore();
}

/* ------------------------------------------------------------------ */
/*  Implementations                                                   */
/* ------------------------------------------------------------------ */

function makeIpcStore(bridge: MolioPrefsBridge): KeyValueStore {
  // Local cache seeded from the preload snapshot. Mutated on every
  // setItem so subsequent reads see the new value immediately.
  const cache: Record<string, string> = { ...bridge.initial };

  return {
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(cache, key)
        ? cache[key]!
        : null;
    },
    setItem(key: string, value: string): void {
      cache[key] = value;
      // Fire and forget. We don't await — the cache is the source
      // of truth for this session, and the disk write is a
      // best-effort persistence step. Errors are logged on the
      // main side; the renderer doesn't need to react.
      void bridge.set(key, value);
    },
    removeItem(key: string): void {
      delete cache[key];
      void bridge.delete(key);
    },
  };
}

/** Minimal in-memory store used outside the renderer (tests / SSR). */
function makeInMemoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}
