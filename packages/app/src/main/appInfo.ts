/**
 * "What am I?" — the facts the About panel shows.
 *
 * Everything here is read from the running app rather than written
 * down a second time in the renderer. The version in particular:
 * a hard-coded version on an About screen is wrong the first time
 * somebody forgets to change it, and then it is wrong for months
 * because nothing checks it.
 *
 * The per-edition part - the edition's name and its links - lives in
 * `edition.ts`, which the Community export replaces wholesale.
 */

import { app, ipcMain } from "electron";

import { Channels, type AppInfo } from "../shared/ipc.js";

import { EDITION } from "./edition.js";

export function getAppInfo(): AppInfo {
  return {
    // `app.getName()` is what main/index.ts set at startup, which is
    // also what the menu bar and the window title use - so the About
    // panel cannot disagree with the rest of the app about the app's
    // own name.
    productName: app.getName(),
    version: app.getVersion(),
    edition: EDITION.edition,
    links: EDITION.links,
  };
}

export function initAppInfo(): void {
  ipcMain.handle(Channels.getAppInfo, () => getAppInfo());
}
