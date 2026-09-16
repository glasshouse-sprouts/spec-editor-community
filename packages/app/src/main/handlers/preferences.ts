/**
 * IPC handlers for renderer prefs (PREFS series, 2026-04-27).
 *
 * Three channels:
 *   - `prefsGetAllSync`  invoked via `ipcRenderer.sendSync` from the
 *                        PRELOAD script at load time. Ships back the
 *                        whole prefs map so the renderer's hooks can
 *                        do synchronous lazy reads.
 *   - `prefsSet`         async set-one-key. Writes to disk on every
 *                        call (file is tiny).
 *   - `prefsDelete`      async delete-one-key. Same disk semantics.
 *
 * The synchronous channel uses `ipcMain.on(...)` + `event.returnValue`
 * because that's how Electron's sync IPC works — `ipcMain.handle` is
 * always async-only.
 */

import { ipcMain } from "electron";

import { Channels } from "../../shared/ipc.js";
import { deletePref, loadAllPrefs, setPref } from "../preferences.js";

ipcMain.on(Channels.prefsGetAllSync, (event) => {
  try {
    event.returnValue = loadAllPrefs();
  } catch (err) {
    // Never let the renderer hang waiting on a sendSync — return
    // an empty object so it can boot with defaults.
    console.warn(
      `[preferences] sync load failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    event.returnValue = {};
  }
});

ipcMain.handle(
  Channels.prefsSet,
  async (_e, req: { key: string; value: string }): Promise<void> => {
    if (typeof req?.key !== "string" || typeof req?.value !== "string") {
      // Defensive: bad shape from the renderer is treated as a no-op
      // rather than crashing the IPC handler.
      return;
    }
    setPref(req.key, req.value);
  },
);

ipcMain.handle(
  Channels.prefsDelete,
  async (_e, req: { key: string }): Promise<void> => {
    if (typeof req?.key !== "string") return;
    deletePref(req.key);
  },
);
