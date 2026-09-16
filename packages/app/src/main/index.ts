/**
 * Electron main process — app shell.
 *
 * Responsibilities:
 *   - App lifecycle (create window, quit when all closed).
 *   - Window setup (BrowserWindow, preload, link routing,
 *     unsaved-changes close handshake).
 *   - Application menu.
 *   - Crash instrumentation.
 *
 * IPC handler registration lives under `./handlers/` — one file per
 * IPC channel group. The barrel import below registers them all on
 * startup (each handler module calls `ipcMain.handle(...)` at
 * top-level, so the side-effect of importing is registration).
 *
 * Strategy throughout the app: open-read-close. We never hold a file
 * handle across IPC calls — the renderer is sandboxed and gets a
 * full payload via `openFile`, then we close. The renderer's edit
 * buffer + Save flow handles round-trips.
 */

import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";

import {
  clearSessionLockfile,
  getCurrentFilePath,
  recordHttpListenerStopped,
} from "./sessionLockfile.js";
// Community edition: the MCP server + Molio API HTTP plumbing are removed.

// Name shown in `app.getName()` and used as the `{appName}` token
// Electron substitutes into role-based menu items (e.g. "Quit
// {appName}"). Must be set before `app.whenReady()`. In packaged
// builds the macOS menu bar also reads `productName` from
// package.json; in dev the running bundle is still Electron.app so
// the very top-left label may remain "Electron" — but every sub-item
// ("Quit Spec Editor Community", "Hide Spec Editor Community", etc.) picks the
// new name up.
app.setName("Spec Editor Community");

// Directory Electron stores app data in (userData) — session
// lockfile, license cache, preferences, saved Glasshouse session.
// Deliberately NOT derived from the display name above (Task 70,
// 2026-09-01): Electron's default ties userData to the app name, so
// a future rename would silently move — or, worse, share — a user's
// data. Must be set before `app.whenReady()`, same as `setName()`.
//
// This string is duplicated by hand in two other places and must be
// changed together with them:
//   - `packages/mcp-server/src/editorSession.ts`, which reads the
//     session file from this same directory.
//   - `scripts/export-community.sh`, whose rename step must map this
//     exact string to Community's own "SpecEditor".
const USER_DATA_DIR = "SpecEditor";
app.setPath("userData", join(app.getPath("appData"), USER_DATA_DIR));

import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Channels, type MenuAction } from "../shared/ipc.js";

import { initOsFileOpen } from "./osFileOpen.js";
import { initAppUpdater } from "./appUpdater.js";
import { initAppInfo } from "./appInfo.js";
import { getDirty, setDirty } from "./handlers/dirtyState.js";
// Side-effect import: registers every `ipcMain.handle(...)` channel.
// See `./handlers/index.ts` for the per-domain breakdown.
import "./handlers/index.js";
import { loadAllPrefs, onPrefChange } from "./preferences.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Task 83 — listen for the file the OS hands us when someone
// double-clicks a `.moliospec`, and take the single-instance lock.
// Runs here, at module load, because macOS can hand a cold-started app
// its `open-file` event before `ready` fires. Returns false when
// another copy already holds the lock; this process is then on its way
// out and must not build a window.
const isPrimaryInstance = initOsFileOpen();

/** True when we're in `electron-vite dev`. Set by electron-vite via
 *  this env var. */
const isDev = !!process.env["ELECTRON_RENDERER_URL"];

// -----------------------------------------------------------------------------
// Crash instrumentation
// -----------------------------------------------------------------------------
// We had a silent crash opening the Showoff demo file: window
// closed, zero terminal output. These handlers surface the real
// error so we can fix it. Remove/trim once the app is stable.

process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

// -----------------------------------------------------------------------------
// Windows title bar (Task 64)
// -----------------------------------------------------------------------------
//
// On Windows the app used to show three stacked rows above the
// content: the OS title bar, the native menu row, and the app's own
// header. macOS only shows two, because the menu lives in the system
// menu bar and costs no window space.
//
// The fix mirrors what Claude Desktop does: `titleBarStyle: "hidden"`
// plus `titleBarOverlay` hands us the title strip while WINDOWS still
// draws minimise / maximise / close on the right. We only fill the
// left and the middle. See `WindowTitleBar.tsx` in the renderer.
//
// The colours are static on purpose: the app is light-only, and
// Task 98 pins that with `nativeTheme.themeSource = "light"` in
// `app.whenReady()`. There is therefore no theme-change event to
// react to with `win.setTitleBarOverlay()`. If a dark theme is ever
// added, that call is where it belongs.
const WIN_TITLEBAR = {
  /** Matches `--c-bg-elev` in styles.css — the header cream. */
  color: "#f0eee6",
  /** Matches `--c-text` — the glyphs Windows draws in the buttons. */
  symbolColor: "#141413",
  /**
   * 40 px, so the strip lines up with the app header below it
   * (8 px padding + ~24 px content). Windows' own default is 32 px;
   * the extra 8 px buys a readable centred title without making the
   * two rows taller than the three they replace.
   */
  height: 40,
} as const;

function createWindow(): BrowserWindow {
  const isWindows = process.platform === "win32";

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: "Spec Editor Community",
    // Task 98 — the colour Electron paints the empty window with
    // until the renderer has drawn. Without it the window starts out
    // in the OS background colour, which is a black flash when macOS
    // is in dark mode. Same cream as the header (`--c-bg-elev`).
    backgroundColor: WIN_TITLEBAR.color,
    // Windows only. macOS keeps the stock title bar — it already
    // looks right and the launch build must not change.
    ...(isWindows
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { ...WIN_TITLEBAR },
        }
      : {}),
    webPreferences: {
      // Preload is emitted as CJS with .cjs extension — see
      // electron.vite.config.ts.
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 5c — OS-level renderer sandbox ON. The preload only uses
      // contextBridge / ipcRenderer / webUtils, all of which work in a
      // sandboxed preload, so no Node APIs are lost. Cheap hardening
      // before open source.
      sandbox: true,
    },
  });

  // Task 64 — Windows only: collapse the native menu row. The menu is
  // still INSTALLED, it just isn't drawn; Alt reveals it, and the
  // hamburger in the title strip pops it open.
  //
  // Do NOT "simplify" this to `Menu.setApplicationMenu(null)`. Every
  // keyboard shortcut in the app (Ctrl+S, Ctrl+O, Ctrl+E, Ctrl+I,
  // Ctrl+W, Ctrl+Shift+S, Ctrl+Shift+O, Ctrl+,) is an `accelerator`
  // on a menu item. Remove the menu and the shortcuts die with it.
  if (isWindows) {
    win.autoHideMenuBar = true;
  }

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    // DevTools opt-in: set MOLIO_DEVTOOLS=1 when you want them to
    // auto-open. You can also open them manually with Cmd+Opt+I once
    // the window is up.
    if (process.env["MOLIO_DEVTOOLS"] === "1") {
      win.webContents.openDevTools({ mode: "right" });
    }
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Route <a href> clicks and window.open() calls out to the user's
  // default browser instead of letting them navigate inside the app
  // window.
  //
  // Electron's default for a click on an anchor is to navigate the
  // current BrowserWindow — which replaces our React app with
  // whatever URL the anchor pointed to.
  //
  // We only ever allow http/https/mailto to leave the sandbox — the
  // same whitelist DOMPurify enforces when we sanitize pasted HTML,
  // so a malicious file:// / javascript: / custom-protocol href
  // cannot slip through this boundary either.
  const isExternalHref = (url: string): boolean =>
    /^(?:https?|mailto):/i.test(url);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHref(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    // The initial load (file:// index.html or the dev-server URL)
    // also triggers will-navigate. Skip the URL we're already on so
    // we don't break the app boot.
    const current = win.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    if (isExternalHref(url)) {
      void shell.openExternal(url);
    }
  });

  // Catch renderer process crashes (previously invisible — window
  // just closed).
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] render-process-gone:", details);
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[main] did-fail-load:", { code, desc, url });
  });
  win.on("unresponsive", () => {
    console.error("[main] window unresponsive");
  });

  // Close interception: if the renderer has unsaved edits, block
  // the close until the user picks Save / Discard / Cancel.
  //
  //   - Discard: we set `closingConfirmed` and call win.close()
  //     again; the handler short-circuits and the window actually
  //     closes.
  //   - Save:    we signal the renderer to run its save flow. If
  //     the save succeeds the renderer calls `closeWindow` which
  //     triggers the actual close; if the save fails or hits a
  //     conflict, the renderer surfaces the appropriate
  //     modal/banner and the window stays open so the user can
  //     resolve.
  //   - Cancel:  we've already called preventDefault; window stays
  //     open.
  let closingConfirmed = false;
  win.on("close", async (e) => {
    if (closingConfirmed) return;
    if (!getDirty()) return;
    e.preventDefault();
    // `showMessageBox` (async) lets us coordinate with the renderer
    // for the save-then-close flow without blocking the main event
    // loop.
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Save", "Discard changes", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "You have unsaved changes.",
      detail:
        "Choose Save to write them to disk before closing, Discard to lose them, or Cancel to stay.",
    });
    if (result.response === 0) {
      // Save → ask the renderer to run save and, on success, request
      // close.
      win.webContents.send(Channels.triggerSaveAndClose);
    } else if (result.response === 1) {
      // Discard
      closingConfirmed = true;
      setDirty(false);
      win.close();
    }
    // Cancel: nothing further to do, window already stayed open.
  });

  // Renderer → main: "save finished, please close now". Matches the
  // handshake triggered from the close dialog above. We still honor
  // the dirty flag — if the renderer lied about being clean, the
  // close handler above will just pop the dialog again on the next
  // attempt.
  const closeWindowListener = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== win.webContents) return;
    closingConfirmed = true;
    setDirty(false);
    win.close();
  };
  ipcMain.on(Channels.closeWindow, closeWindowListener);

  // Task 64 — the hamburger in the Windows title strip asks main to
  // pop the application menu at the button's bottom-left corner.
  //
  // We deliberately use `Menu.getApplicationMenu()` rather than
  // calling `buildAppMenu()` again: the installed menu is rebuilt
  // whenever the recent-files list changes (see `onPrefChange`
  // below), so reading the installed one keeps File → Open Recent
  // in sync. Building a fresh menu here would silently drift.
  const popupAppMenuListener = (
    event: Electron.IpcMainEvent,
    position?: { x: number; y: number },
  ): void => {
    if (event.sender !== win.webContents) return;
    const menu = Menu.getApplicationMenu();
    if (!menu) return;
    if (position) {
      menu.popup({
        window: win,
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    } else {
      menu.popup({ window: win });
    }
  };
  ipcMain.on(Channels.popupAppMenu, popupAppMenuListener);

  win.on("closed", () => {
    ipcMain.removeListener(Channels.closeWindow, closeWindowListener);
    ipcMain.removeListener(Channels.popupAppMenu, popupAppMenuListener);
  });

  return win;
}

// -----------------------------------------------------------------------------
// Application menu
// -----------------------------------------------------------------------------
//
// Without an explicit menu, Electron builds a default one whose
// every label says "Electron" — Quit Electron, About Electron, etc.
// We provide our own template here so all those labels become
// "Spec Editor Community" via the `{appName}` substitution Electron does
// on role-based items. Note macOS-only quirk: the very top-left app
// label is decided by the running bundle's CFBundleName, which in
// dev is still Electron.app. Packaged builds (via electron-builder
// + `productName`) show the correct name everywhere.
//
// Standard items are kept minimal — this isn't trying to be a fancy
// menu. Future work: hook File → Open / Save / Save As to send IPC
// messages to the renderer instead of duplicating the in-app
// buttons.

/**
 * Send a typed `MenuAction` to whichever renderer is currently
 * focused. Used by every menu item that maps to an in-app action.
 *
 * Slice #41. Note we deliberately use the focused window rather than
 * a captured-in-closure reference so that re-opening the window after
 * the original closed (macOS dock-icon click) still routes correctly.
 */
function sendMenuAction(action: MenuAction): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.send(Channels.menuAction, action);
}

// Community edition: the "Point AI at This File" (MCP) menu action is removed.

/** Storage key used by the renderer's `recentFiles.ts`. Duplicated
 *  here so main can read the list straight off disk on boot, without
 *  having to import a renderer module. */
const RECENT_FILES_PREF_KEY = "molio2.recentFiles";

/** Mirrors the renderer's `RecentFileEntry` shape (recentFiles.ts).
 *  Loose typing here on purpose — we read whatever the renderer
 *  wrote and tolerate older shapes. */
interface RecentFileEntryLite {
  path: string;
  projectName: string;
}

/**
 * UX1 — Read the renderer's recent-files list straight from
 * `userData/preferences.json`. The renderer is the source of truth;
 * we just dip into the same JSON file to populate the menu.
 *
 * Returns an empty list on any error (missing file, malformed JSON,
 * shape mismatch) — the menu falls back gracefully to "no recents".
 */
function readRecentFilesFromPrefs(): RecentFileEntryLite[] {
  try {
    const raw = loadAllPrefs()[RECENT_FILES_PREF_KEY];
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentFileEntryLite =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentFileEntryLite).path === "string" &&
        typeof (e as RecentFileEntryLite).projectName === "string",
    );
  } catch {
    return [];
  }
}

/**
 * UX1 — Build the File → Open Recent submenu. Each entry sends the
 * `openRecent` MenuAction with its absolute path; the renderer
 * routes it through the existing `openPath()` flow.
 *
 * If the list is empty, the submenu shows a single disabled "No
 * recent projects" item — better than an empty menu that looks
 * broken.
 */
function buildOpenRecentSubmenu(): Electron.MenuItemConstructorOptions {
  const entries = readRecentFilesFromPrefs();

  const submenu: Electron.MenuItemConstructorOptions[] = entries.length
    ? entries.map((e) => ({
        // Prefer the project name; fall back to the path's filename
        // if the entry is from an older shape that didn't carry one.
        label: e.projectName?.trim() || e.path.split(/[\\/]/).pop() || e.path,
        click: () => sendMenuAction({ kind: "openRecent", path: e.path }),
      }))
    : [{ label: "No recent projects", enabled: false }];

  if (entries.length > 0) {
    submenu.push(
      { type: "separator" },
      {
        label: "Clear Menu",
        click: () => sendMenuAction({ kind: "clearRecent" }),
      },
    );
  }

  return { label: "Open Recent", submenu };
}

function buildAppMenu(): Electron.Menu {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (top-left, next to the Apple). Ignored on
    // win/linux — those platforms don't have an "app menu" concept.
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              // Our own panel, not `{ role: "about" }`. Electron's
              // built-in one shows the Electron version and a
              // copyright line nobody wrote, and it cannot show what
              // the user actually comes here for: which edition this
              // is, and whether an update is waiting.
              {
                label: `About ${app.name}`,
                click: () => sendMenuAction({ kind: "about" }),
              },
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => sendMenuAction({ kind: "settings" }),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        // New — create a brand-new blank .moliospec (start from
        // scratch), the same flow as the Welcome screen. No accelerator
        // by request. createEmptyProject shows a Save dialog, so the
        // label carries an ellipsis like the other dialog actions.
        {
          label: "New…",
          click: () => sendMenuAction({ kind: "newFile" }),
        },
        { type: "separator" },
        {
          label: "Open File…",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuAction({ kind: "open" }),
        },
        buildOpenRecentSubmenu(),
        // Community edition: "Load Version Reference" (Compare versions) removed.
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => sendMenuAction({ kind: "save" }),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendMenuAction({ kind: "saveAs" }),
        },
        // RELOAD-3 — re-read the open file from disk. No accelerator:
        // ⌘R is already the View menu's renderer-reload role.
        {
          label: "Reload from Disk",
          click: () => sendMenuAction({ kind: "reloadFromDisk" }),
        },
        { type: "separator" },
        {
          label: "Import…",
          accelerator: "CmdOrCtrl+I",
          click: () => sendMenuAction({ kind: "import" }),
        },
        {
          label: "Export…",
          accelerator: "CmdOrCtrl+E",
          click: () => sendMenuAction({ kind: "export" }),
        },
        { type: "separator" },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => sendMenuAction({ kind: "closeTab" }),
        },
        // On Windows/Linux, give the user a Settings entry on the File
        // menu (no app menu on those platforms). On macOS, settings
        // already lives in the app menu above.
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => sendMenuAction({ kind: "settings" }),
              },
              { type: "separator" },
              { role: "quit" },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          // Standard convention: ⌘? on macOS, F1 on Windows/Linux.
          // The menu accepts a single accelerator, so we pick ⌘?
          // (Shift+/ on US layouts) which is what users expect from
          // most macOS apps.
          accelerator: "CmdOrCtrl+/",
          click: () => sendMenuAction({ kind: "shortcuts" }),
        },
        // Windows and Linux have no app menu, so About lives here for
        // them. On macOS it is in the app menu above, where people
        // look for it, and repeating it in Help would be wrong.
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              {
                label: `About ${app.name}`,
                click: () => sendMenuAction({ kind: "about" }),
              },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// -----------------------------------------------------------------------------
// App lifecycle
// -----------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Task 83 — a second launch handed its arguments to the copy that
  // already runs. Nothing to set up here; we are quitting.
  if (!isPrimaryInstance) return;

  // Task 98 — tell the OS the app is light. The app has no dark
  // theme: every colour in styles.css is a light one. On macOS we
  // keep the native title bar, and without this it follows the
  // SYSTEM appearance, so a black strip sits above a cream app.
  // Pinning the source keeps the two in agreement, and it also keeps
  // `prefers-color-scheme` light inside the renderer.
  //
  // This is not a dark mode. It makes the app honestly light-only.
  // A real dark mode is separate work (a dark counterpart for every
  // colour variable) and belongs post-v1.
  nativeTheme.themeSource = "light";

  Menu.setApplicationMenu(buildAppMenu());
  // UX1 — rebuild the menu whenever the recent-files list changes
  // so the File → Open Recent submenu stays current. Other pref
  // changes don't affect the menu, so we filter on the key.
  onPrefChange((key) => {
    if (key === RECENT_FILES_PREF_KEY) {
      Menu.setApplicationMenu(buildAppMenu());
    }
  });

  // Community edition: no MCP server, so no editor HTTP listener is started.

  createWindow();

  // Automatic updates. Starts a timer rather than doing anything now;
  // the first check is deliberately delayed so it does not compete
  // with opening a file. Never restarts the app on its own — the new
  // version is put in place when the user quits.
  initAppUpdater();
  initAppInfo();

  app.on("activate", () => {
    // macOS: re-create a window when the dock icon is clicked and
    // no windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // macOS apps typically stay running until Cmd+Q, but for the MVP
  // we quit.
  if (process.platform !== "darwin") app.quit();
  else app.quit();
});

// Clean up the active-session lockfile on quit so the MCP server
// doesn't see a stale entry next time it runs. `will-quit` runs
// after every BrowserWindow closes but before the process exits.
app.on("will-quit", () => {
  // Stop the HTTP listener — fire-and-forget. The OS reclaims the
  // socket when the process exits anyway; we just signal "no longer
  // accepting requests" promptly. Don't block app shutdown on it.
  recordHttpListenerStopped();
  clearSessionLockfile();
});
