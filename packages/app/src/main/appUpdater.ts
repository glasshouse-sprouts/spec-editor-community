/**
 * Automatic updates.
 *
 * The app checks the release feed, downloads a new version in the
 * background, and installs it the next time the user quits. That last
 * part is the whole design: the app edits files, and a restart in the
 * middle of an unsaved change is the worst thing an update could do to
 * someone. So nothing here ever restarts the app on its own.
 *
 * There is exactly one way to restart early - the user asking for it -
 * and even that is refused while there are unsaved edits.
 *
 * What runs when
 * --------------
 * A check on startup, delayed a little so it does not compete with
 * opening a file, and then once every few hours for the sort of
 * session that stays open all week. Downloading is automatic;
 * installing is not.
 *
 * Where the feed comes from
 * -------------------------
 * `app-update.yml`, written into the app at build time from the
 * `publish` block in electron-builder.yml. Nothing here names a URL,
 * which is deliberate: an app should not be able to disagree with the
 * build it came from about where its updates live.
 *
 * A build with no publish block has no `app-update.yml`, and
 * electron-updater throws when it looks for one. That is not a
 * failure - it is a build without an update channel - so it becomes
 * the `unsupported` state and the UI can say so plainly instead of
 * showing an error nobody can act on.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";
// electron-updater ships CommonJS. A named import fails at runtime in
// an ESM main process ("does not provide an export named"), so take
// the default export and destructure it here.
import electronUpdater from "electron-updater";

import {
  Channels,
  type InstallUpdateResult,
  type UpdateState,
} from "../shared/ipc.js";

import { getDirty } from "./handlers/dirtyState.js";

const { autoUpdater } = electronUpdater;

/** Wait this long after startup before the first check. Long enough
 *  that opening a file, restoring a session and starting the local
 *  listener are all done first. */
const FIRST_CHECK_DELAY_MS = 20_000;

/** And then this often, for sessions that stay open for days. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = { kind: "idle" };

/** Tell every open window where we are. Cheap, and it means a panel
 *  opened halfway through a download shows the truth. */
function setState(next: UpdateState): void {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.updateStateChanged, next);
  }
}

export function getUpdateState(): UpdateState {
  return state;
}

/**
 * Turn whatever electron-updater threw into something a person can
 * read, and recognise the one "error" that is not an error.
 *
 * Exported for tests.
 */
export function describeUpdateError(err: unknown): UpdateState {
  const message = err instanceof Error ? err.message : String(err);
  // No app-update.yml: this build has no update channel. Not a fault,
  // and not something the user can fix.
  if (/app-update\.yml|ENOENT.*app-update/i.test(message)) {
    return { kind: "unsupported", reason: "noChannel" };
  }
  // Offline, DNS down, the bucket unreachable. Expected on a laptop in
  // a train; says nothing about the app being broken.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::/i.test(message)) {
    return {
      kind: "error",
      message: "Could not reach the update server. Check your connection.",
    };
  }
  return { kind: "error", message };
}

/** Run a check, mapping every outcome onto the state machine. */
async function check(): Promise<UpdateState> {
  if (state.kind === "checking" || state.kind === "downloading") return state;
  // Nothing to install onto: in dev the app is not packaged, and
  // electron-updater refuses anyway. Reported as its own reason, not
  // as "this edition does not update itself" - that would be a plain
  // untruth about the released app, told to the one audience that
  // knows better.
  if (!app.isPackaged) {
    setState({ kind: "unsupported", reason: "dev" });
    return state;
  }
  setState({ kind: "checking" });
  try {
    const result = await autoUpdater.checkForUpdates();
    // `updateInfo` always comes back; whether it is NEWER is what
    // `downloadPromise` tells us - electron-updater only starts a
    // download when there is something to download.
    if (!result || !result.downloadPromise) {
      setState({ kind: "upToDate", checkedAt: Date.now() });
    }
    // The `update-available` / `download-progress` / `update-downloaded`
    // events below carry it from here.
  } catch (err) {
    setState(describeUpdateError(err));
  }
  return state;
}

/**
 * Restart into the downloaded version, if that is safe.
 *
 * Refused while the editor holds unsaved edits. The update is already
 * on disk and installs on the next ordinary quit, so refusing costs
 * the user nothing and protects the one thing that cannot be undone.
 */
function installNow(): InstallUpdateResult {
  if (state.kind !== "ready") return { kind: "notReady" };
  if (getDirty()) return { kind: "unsaved" };
  // `isSilent: false` on Windows shows the installer's progress rather
  // than a frozen desktop; `isForceRunAfter: true` brings the app back
  // up, which is what "restart" promises.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { kind: "restarting" };
}

/**
 * Does this build have an update feed at all?
 *
 * electron-builder writes `app-update.yml` next to the app when a
 * `publish` block is configured, and electron-updater reads it at
 * runtime. No file, no channel - and that is knowable the instant the
 * app starts, without touching the network.
 *
 * Exported for tests.
 */
export function hasUpdateChannel(): boolean {
  const dir = process.resourcesPath;
  // Undefined outside a packaged app. Answering "no channel" is the
  // safe direction: it never claims an update path that is not there.
  if (!dir) return false;
  return existsSync(join(dir, "app-update.yml"));
}

/**
 * Wire up automatic updates. Call once, after `app.whenReady()`.
 */
export function initAppUpdater(): void {
  // Download without asking - it is background traffic and costs the
  // user nothing but bandwidth. INSTALLING without asking is what we
  // refuse to do.
  autoUpdater.autoDownload = true;
  // The quiet heart of the feature: the new version is put in place
  // when the app closes, so an update never interrupts anything.
  autoUpdater.autoInstallOnAppQuit = true;

  // The event payloads are annotated with just the fields we read
  // rather than electron-updater's own types. Narrower, and it keeps
  // this file compiling across their type churn - we care about a
  // version string and a percentage, and nothing else.
  autoUpdater.on("update-available", (info: { version: string }) => {
    setState({ kind: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    setState({ kind: "upToDate", checkedAt: Date.now() });
  });
  autoUpdater.on("download-progress", (p: { percent: number }) => {
    const version =
      state.kind === "available" || state.kind === "downloading"
        ? state.version
        : "";
    setState({
      kind: "downloading",
      version,
      percent: Math.round(p.percent),
    });
  });
  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    console.log(
      "[main] update downloaded, will install on quit:",
      info.version,
    );
    setState({ kind: "ready", version: info.version });
  });
  autoUpdater.on("error", (err: unknown) => {
    setState(describeUpdateError(err));
  });

  ipcMain.handle(Channels.getUpdateState, () => getUpdateState());
  ipcMain.handle(Channels.checkForUpdates, () => check());
  ipcMain.handle(Channels.installUpdateNow, () => installNow());

  // Say what this build IS before the first check, not 20 seconds
  // into the session (Task 128). Both unsupported reasons are known at
  // startup without any network: a development run is not packaged,
  // and a build with no channel has no app-update.yml beside it.
  //
  // Leaving the state on "idle" until a check failed meant the About
  // panel spent FIRST_CHECK_DELAY_MS explaining automatic updating to
  // a build that has none - and the About panel is the one place that
  // exists to tell the truth about updating.
  //
  // This adds a starting point; it does not change how the state
  // machine moves. check() keeps its own guards for the same two
  // cases, so a manual check still answers correctly on its own.
  if (!app.isPackaged) {
    setState({ kind: "unsupported", reason: "dev" });
    return;
  }
  if (!hasUpdateChannel()) {
    setState({ kind: "unsupported", reason: "noChannel" });
    return;
  }

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}
