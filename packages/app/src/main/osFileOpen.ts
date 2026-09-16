/**
 * "Open this file", handed to us by the operating system.
 *
 * What it does
 * ------------
 * The installers register `.moliospec` as ours (`fileAssociations` in
 * electron-builder.yml), so the file icon says the file belongs to
 * this app and a double-click starts it. Until this module existed the
 * app then sat on the welcome screen: the OS DID hand us the path, we
 * just never listened. The association meant "start this app", never
 * "open this file".
 *
 * The two platforms deliver the path differently:
 *
 *   - macOS sends an `open-file` EVENT, which can arrive before
 *     `ready` on a cold start, and arrives again on every later
 *     double-click while the app runs.
 *   - Windows puts the path in the command line. On a cold start it is
 *     in our own `process.argv`; while the app runs it arrives as the
 *     `second-instance` event's argv, because the single-instance lock
 *     turns the second launch into an event on this process.
 *
 * Both roads end in the same place: `deliverOpenPath()`.
 *
 * The single-instance lock
 * ------------------------
 * This module takes it, because this feature cannot work without it: a
 * double-click on a running app has to reach the copy the user already
 * has, not start a rival one. It is also a fix in its own right — two
 * copies of the app share one `active-session.json` in userData and
 * would overwrite each other's idea of which file is open.
 *
 * `requestSingleInstanceLock()` may only be called once per process,
 * so this module owns it. Anything else that needs to know about a
 * second launch adds its own `second-instance` listener; Electron
 * allows any number of them.
 *
 * Unsaved changes
 * ---------------
 * Opening a file replaces the one on screen — the editor holds one
 * `.moliospec` at a time. So when there are unsaved edits, the user
 * gets the same three-button dialog they already know from closing the
 * window with unsaved changes: Save, Discard changes, Cancel. Save
 * runs the renderer's normal save flow and only then opens the new
 * file; if the save hits a conflict or an old-format file, nothing is
 * opened and the renderer's own banner explains why.
 */

import { isAbsolute, resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain } from "electron";

import { Channels } from "../shared/ipc.js";

import { getDirty } from "./handlers/dirtyState.js";

/** The one extension our installers claim. */
const MOLIOSPEC_EXT = ".moliospec";

/**
 * Pick the file to open out of a command line.
 *
 * Deliberately narrow: an argument counts only if it ends in
 * `.moliospec` and does not start with a dash. Electron's own argv
 * carries the executable, the script path in dev, and a varying set of
 * Chromium switches, and on Windows a `second-instance` argv carries
 * whatever the shell passed. Matching on the extension is the one rule
 * that holds across all of those.
 *
 * The editor opens one file at a time, so the FIRST match wins;
 * dragging five files onto the app icon opens the first one rather
 * than flickering through all five.
 *
 * `cwd` resolves a relative path — a double-click always passes an
 * absolute one, but `bskriver ./demo.moliospec` from a terminal does
 * not, and Electron reports the second instance's working directory
 * precisely so we can do this.
 *
 * Exported for tests.
 */
export function moliospecPathFromArgv(
  argv: readonly string[],
  cwd?: string,
): string | null {
  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    if (arg.startsWith("-")) continue;
    if (!arg.toLowerCase().endsWith(MOLIOSPEC_EXT)) continue;
    if (isAbsolute(arg)) return arg;
    return cwd ? resolve(cwd, arg) : arg;
  }
  return null;
}

/**
 * Set when a path arrives before there is a renderer able to open it —
 * which on Windows is EVERY launch-by-double-click, because the path
 * is in our argv before a window exists at all.
 *
 * Handed over by `takePendingOpenPath()` below, on the renderer's
 * request, and cleared in the same breath so a reload does not reopen
 * the file behind the user's back.
 */
let pendingOpenPath: string | null = null;

/**
 * Give the renderer the file this launch was started to open, once.
 *
 * The first version of this module pushed the path at
 * `did-finish-load` instead. That looked right and worked on macOS,
 * where the path arrives as an event long after the window is up, so
 * the push took the direct route. On Windows every launch went through
 * the deferred route, `did-finish-load` fired before React had
 * subscribed to the channel, and the message was dropped in silence —
 * the app opened on the welcome screen with no error to show for it.
 *
 * Exported for tests.
 */
export function takePendingOpenPath(): string | null {
  const path = pendingOpenPath;
  pendingOpenPath = null;
  if (path)
    console.log("[main] handing the launch file to the renderer:", path);
  return path;
}

/** Bring the existing window to the front. Never creates one. */
function focusExistingWindow(): BrowserWindow | null {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

/**
 * Tell the renderer to open `path` through its normal `openPath()`
 * flow — the same one File → Open Recent uses. Deliberately the menu
 * channel rather than a new one: it exists in both editions and is
 * already wired all the way from main to `useFileState.openPath()`.
 */
function sendOpenRequest(win: BrowserWindow, path: string): void {
  win.webContents.send(Channels.menuAction, { kind: "openRecent", path });
}

/**
 * Deliver a path to the renderer, or remember it until there is a
 * window that has finished loading.
 *
 * With unsaved edits on screen we stop and ask first. `getDirty()` is
 * main's cached copy of the renderer's dirty flag — the same value the
 * window-close handler prompts on.
 */
function deliverOpenPath(path: string): void {
  const win = focusExistingWindow();
  if (!win || win.webContents.isLoading()) {
    pendingOpenPath = path;
    return;
  }
  pendingOpenPath = null;

  if (!getDirty()) {
    sendOpenRequest(win, path);
    return;
  }

  void (async () => {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Save", "Discard changes", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "You have unsaved changes.",
      detail:
        "Opening another file replaces the one you are working on. Choose Save to write your changes to disk first, Discard to lose them, or Cancel to stay where you are.",
    });
    if (result.response === 0) {
      // Save → the renderer saves and, on success, opens the file.
      win.webContents.send(Channels.triggerSaveAndOpen, path);
    } else if (result.response === 1) {
      // Discard → open straight away. `openPath()` resets the edit
      // buffer, which pushes a clean dirty flag back to main.
      sendOpenRequest(win, path);
    }
    // Cancel: nothing to do. The file stays closed, the edits stay put.
  })();
}

/**
 * Wire up file-open handling and take the single-instance lock.
 *
 * Must be called at module load in `main/index.ts` — BEFORE
 * `app.whenReady()`, because macOS can deliver `open-file` to a
 * cold-started app before the ready event.
 *
 * @returns `false` when another copy already holds the lock, in which
 * case this process is quitting and must not create a window.
 */
export function initOsFileOpen(): boolean {
  // macOS: the path arrives as an event, possibly before `ready`.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (typeof path !== "string" || path.trim() === "") return;
    deliverOpenPath(path);
  });

  // Windows / Linux: a second launch carries the path in its argv. The
  // lock is what turns that launch into an event on this process
  // instead of a rival copy of the app.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const path = moliospecPathFromArgv(argv, workingDirectory);
    if (path) deliverOpenPath(path);
    else focusExistingWindow();
  });

  // Cold start on Windows / Linux — the path is already in our argv.
  const initial = moliospecPathFromArgv(process.argv, process.cwd());
  if (initial) {
    console.log("[main] started to open a file:", initial);
    pendingOpenPath = initial;
  }

  // The renderer collects whatever is waiting, when it is ready to act
  // on it. See `takePendingOpenPath` above for why it asks us rather
  // than us telling it.
  ipcMain.handle(Channels.takePendingOpenPath, () => takePendingOpenPath());

  return true;
}
