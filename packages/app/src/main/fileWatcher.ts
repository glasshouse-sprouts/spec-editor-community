/**
 * File watcher (RELOAD-2).
 *
 * Watches the currently-open .moliospec for out-of-band changes — i.e.
 * another program (a second editor window, the MCP server, a Dropbox
 * sync) writing to the file while the user has it open. When that
 * happens we tell the renderer, which raises a "changed on disk"
 * banner so the user can choose to reload.
 *
 * Why polling and not `fs.watch`:
 *   `fs.watch` is unreliable on network / cloud-synced folders, and
 *   the user's projects live in a Dropbox folder. Polling the file's
 *   mtime every few seconds is boring but works everywhere.
 *
 * Only ONE file is watched at a time — the active editor file. The
 * renderer re-arms the watch (via the `watchActiveFile` IPC) every
 * time the open file or its baseline mtime changes (open, save,
 * reload). `path: null` disarms it (Welcome screen / no file).
 *
 * Our own saves must not trigger the banner. The save handlers wrap
 * their work in `beginSelfWrite()` / `endSelfWrite()`: while a
 * self-write is in progress the poll is skipped, and `noteSelfWrite`
 * advances the baseline to the freshly-written mtime so the next poll
 * sees "no change".
 */

import { BrowserWindow } from "electron";

import { Channels } from "../shared/ipc.js";
import { safeMtimeMs } from "./mtime.js";

/** How often we stat the watched file. 2.5s is responsive enough for
 *  a "heads up" banner without hammering the disk. */
const POLL_INTERVAL_MS = 2500;

interface WatchState {
  path: string;
  /** The mtime we treat as "current". Anything different on disk
   *  means the file changed under us. */
  baselineMtimeMs: number;
}

let watch: WatchState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Depth counter for "the editor is writing the file right now". A
 * counter (not a boolean) so overlapping writes can't clear the flag
 * early. The poll is skipped whenever this is > 0.
 */
let selfWriteDepth = 0;

/**
 * Bumped every time a self-write finishes. A poll that started before
 * a self-write and finished after it can spot the change and skip the
 * tick, even though the depth counter is back to 0.
 */
let selfWriteGeneration = 0;

/** Start (or re-point) the watch at `path`, treating `baselineMtimeMs`
 *  as the known-current version. */
export function armFileWatch(path: string, baselineMtimeMs: number): void {
  watch = { path, baselineMtimeMs };
  if (!timer) {
    timer = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
    // Don't let the poll timer keep the process alive on its own.
    timer.unref?.();
  }
}

/** Stop watching (no file open). */
export function disarmFileWatch(): void {
  watch = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Mark the start of an editor-initiated write. Pairs with
 *  `endSelfWrite`. Safe to nest. */
export function beginSelfWrite(): void {
  selfWriteDepth += 1;
}

/** Mark the end of an editor-initiated write. Always call this — even
 *  when the write failed — to keep the depth counter balanced. */
export function endSelfWrite(): void {
  if (selfWriteDepth > 0) selfWriteDepth -= 1;
  selfWriteGeneration += 1;
}

/**
 * Record the result of a successful self-write. If we're watching
 * `path`, advance the baseline to `newMtimeMs` so the post-write poll
 * doesn't mistake our own save for an external change.
 */
export function noteSelfWrite(path: string, newMtimeMs: number): void {
  if (watch && watch.path === path) {
    watch.baselineMtimeMs = newMtimeMs;
  }
}

/**
 * Save an open handle back to `path` as an editor-initiated write, and
 * return the resulting mtime.
 *
 * This is the one-liner every write handler should use instead of
 * calling `handle.saveAs(path)` directly. It does the full self-write
 * protocol: pause the watcher, save (crash-safely — core's `saveAs` is
 * atomic), re-stat, then advance the watcher's baseline so our own save
 * never shows up as "this file was changed by another program".
 *
 * Handlers that need the bracket to cover more than the save itself
 * (`saveFile` / `saveFileAs`, which also apply edits inside it) keep
 * calling `beginSelfWrite` / `endSelfWrite` by hand.
 */
export async function saveAsSelfWrite(
  handle: { saveAs(path: string): Promise<void> },
  path: string,
): Promise<number> {
  beginSelfWrite();
  try {
    await handle.saveAs(path);
    const mtimeMs = (await safeMtimeMs(path)) ?? Date.now();
    noteSelfWrite(path, mtimeMs);
    return mtimeMs;
  } finally {
    endSelfWrite();
  }
}

/** One poll tick: stat the watched file, fire if its mtime moved. */
async function pollOnce(): Promise<void> {
  if (!watch) return;
  // Skip while the editor itself is mid-write — that's not an
  // "external" change.
  if (selfWriteDepth > 0) return;

  const genBefore = selfWriteGeneration;
  const path = watch.path;
  const baseline = watch.baselineMtimeMs;
  const current = await safeMtimeMs(path);

  // File missing / transient stat failure: stay quiet. A deletion is
  // a different (rare) case than an edit, and the save flow already
  // surfaces "file missing". We don't want to flap a banner here.
  if (current === null) return;
  // The watch may have been disarmed / re-pointed while we awaited.
  if (!watch || watch.path !== path) return;
  // A self-write started or finished during the stat — ignore this
  // tick; the baseline it left behind is authoritative.
  if (selfWriteDepth > 0 || selfWriteGeneration !== genBefore) return;
  if (current === baseline) return;

  // Re-baseline so we report each distinct change once, not on every
  // tick until the user reacts.
  watch.baselineMtimeMs = current;
  notifyRenderer(path, current);
}

/** Push a `fileChangedOnDisk` event to the renderer. */
function notifyRenderer(path: string, currentMtimeMs: number): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Channels.fileChangedOnDisk, { path, currentMtimeMs });
}

/**
 * Test-only: reset all module state so unit tests start clean.
 */
export function __resetForTests(): void {
  disarmFileWatch();
  selfWriteDepth = 0;
  selfWriteGeneration = 0;
}
