/**
 * Renderer preferences storage — main process side.
 *
 * Why this exists
 * ---------------
 * The renderer used to keep all UI prefs (recent files list,
 * sidebar collapsed state, locale, etc.) in `window.localStorage`.
 * That storage turned out to be unreliable on Tore's Mac:
 * Electron's dev-mode renderer was wiping localStorage between
 * `npm run dev` runs (root cause not nailed down — possibly tied
 * to the `productName` change moving the userData path, possibly
 * an Electron quirk in dev mode). Diagnostic: setting a sentinel
 * value, quitting, restarting → value is gone.
 *
 * Migration: move the storage to a plain JSON file under
 * `app.getPath('userData')`, owned by main, accessed by the
 * renderer over IPC. Same pattern `molioApiConfig.ts` already
 * uses for the API keys, so we know it survives every restart.
 *
 * Shape
 * -----
 * The renderer's existing `KeyValueStore` interface is
 * intentionally string→string (each pref module
 * JSON-stringifies/parses its own value). We mirror that here:
 *   { [key: string]: string }
 *
 * On disk, the file looks like:
 *
 *   {
 *     "molio2.recentFiles": "[{\"path\":...}]",
 *     "molio2.sidebar.collapsed": "false",
 *     "molio.locale": "en",
 *     ...
 *   }
 *
 * Reads are O(1) from an in-memory cache; writes update the cache
 * AND write the whole file (it's tiny, no need for an append log).
 *
 * Robustness
 * ----------
 *  - Missing file → empty store, file is created on first write.
 *  - Corrupt JSON → empty store, log a warning. We don't lose
 *    the user's setup because there's nothing to lose at that
 *    point; the alternative (refusing to start) is worse.
 *  - Disk write errors → swallowed; the prefs still update in
 *    memory so the current session works, and we log an error.
 *    Not crashing the app over a flaky pref save matches the
 *    spirit of the old localStorage layer ("storage best-effort").
 */

import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE_NAME = "preferences.json";

let cache: Record<string, string> | null = null;

/** UX1 — registered listeners notified after every set/delete.
 *  Lets main/index react when the recent-files key changes (rebuild
 *  the File → Open Recent submenu) without renderer-driven IPC. */
type PrefChangeListener = (key: string) => void;
const listeners = new Set<PrefChangeListener>();

/**
 * Subscribe to pref changes. The callback is invoked AFTER the
 * write has settled (in-memory + on disk). Returns a disposer.
 *
 * Used by main/index to rebuild the application menu when the
 * recent-files entry under `molio2.recentFiles` is updated by
 * the renderer.
 */
export function onPrefChange(fn: PrefChangeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(key: string): void {
  for (const fn of listeners) {
    try {
      fn(key);
    } catch (err) {
      console.warn(
        `[preferences] listener for "${key}" threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function configPath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

/**
 * Synchronous read into the module cache. Called once on boot,
 * then again on demand if anything ever clears `cache`.
 *
 * Sync (not async) because the preload script needs to fetch the
 * full snapshot via `ipcRenderer.sendSync` BEFORE the renderer
 * starts loading any modules — there's no way to await before
 * `useState`'s lazy initializer runs in renderer hooks. Sync I/O
 * here costs <1 ms in practice and only runs once per app launch.
 */
function loadFromDisk(): Record<string, string> {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Coerce all values to strings — the file COULD have been
      // hand-edited or left over from an older version with a
      // different shape. We don't trust unknown shapes blindly.
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch (err) {
    // ENOENT (file missing) is the normal first-run case.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `[preferences] failed to read ${configPath()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {};
  }
}

function saveToDisk(): void {
  if (!cache) return;
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.warn(
      `[preferences] failed to write ${configPath()}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Public: get the full snapshot. Always returns a fresh shallow
 * copy so the caller can't mutate the cache by accident.
 */
export function loadAllPrefs(): Record<string, string> {
  if (cache == null) cache = loadFromDisk();
  return { ...cache };
}

/**
 * Public: set one key. Persists to disk after every write — the
 * file is tiny so there's no batching benefit to deferring it.
 */
export function setPref(key: string, value: string): void {
  if (cache == null) cache = loadFromDisk();
  cache[key] = value;
  saveToDisk();
  notify(key);
}

/**
 * Public: delete one key. Same persistence semantics as setPref.
 */
export function deletePref(key: string): void {
  if (cache == null) cache = loadFromDisk();
  if (key in cache) {
    delete cache[key];
    saveToDisk();
    notify(key);
  }
}
