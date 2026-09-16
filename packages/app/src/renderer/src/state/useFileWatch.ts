/**
 * useFileWatch (RELOAD-2).
 *
 * Keeps the main-process file watcher pointed at the currently-open
 * file, and exposes a `changedOnDisk` flag the App raises into a
 * banner when something else writes to the file under us (another
 * editor window, the MCP server, a Dropbox sync).
 *
 *  - `path` / `baselineMtimeMs` come from useFileState. When they
 *    change (open, save, reload) we re-arm the watch and clear any
 *    stale "changed" flag — the renderer now holds whatever is on
 *    disk.
 *  - `path` null (no file open) disarms the watch.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseFileWatchResult {
  /** True when the open file was modified on disk by something else. */
  changedOnDisk: boolean;
  /** Dismiss the banner without reloading. */
  dismiss: () => void;
}

export function useFileWatch(
  path: string | null,
  baselineMtimeMs: number,
): UseFileWatchResult {
  const [changedOnDisk, setChangedOnDisk] = useState(false);

  // Re-arm the watch + clear the stale flag whenever the open file or
  // its baseline mtime changes. An open / save / reload all land here:
  // after any of them the renderer's content matches disk again.
  useEffect(() => {
    window.molio.watchActiveFile(path, baselineMtimeMs);
    setChangedOnDisk(false);
  }, [path, baselineMtimeMs]);

  // Listen for "changed on disk" events from main. Only react to the
  // file we currently have open (defensive — main only ever watches
  // one file, but the event still carries its path).
  useEffect(() => {
    return window.molio.onFileChangedOnDisk((event) => {
      if (path && event.path === path) {
        setChangedOnDisk(true);
      }
    });
  }, [path]);

  // Stable identity — `dismiss` is consumed as a dependency by
  // useReloadFromDisk's `onBeforeReload`.
  const dismiss = useCallback(() => setChangedOnDisk(false), []);

  return { changedOnDisk, dismiss };
}
