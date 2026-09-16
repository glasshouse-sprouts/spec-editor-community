/**
 * Active-session lockfile — a small JSON file the editor maintains
 * while running, used by the MCP server (a separate process) to
 * detect when the user has the editor open with a particular file.
 *
 * Why this exists
 * ---------------
 * The MCP server can write to a `.moliospec` on disk independently
 * of the editor. If the user happens to have the same file open in
 * the editor with unsaved edits, the MCP server's save would stomp
 * those edits — last writer wins. The editor never re-reads the
 * file after open, so it would also keep showing the stale view.
 *
 * To minimise the risk we leave breadcrumbs the MCP server can
 * read: a JSON file at Electron's `app.getPath('userData')` that
 * the editor updates whenever the user opens / saves / quits, plus
 * a dirty-bit refresh whenever the renderer reports its dirty
 * state.
 *
 * Design choices
 * --------------
 *   - **Location:** `<userData>/active-session.json`. The MCP
 *     server resolves the same path manually (it can't import
 *     Electron's `app`).
 *   - **Schema (v1):** `{ pid, lastOpenedFile, anyDirty, updatedAt }`.
 *     Single path — multi-tab tracking is left for a future
 *     refinement; the typical user has one file open at a time.
 *   - **Liveness:** the PID lets the MCP server detect a stale
 *     lockfile from a crashed editor (process is gone but the file
 *     wasn't cleaned up). `existsSync(/proc/<pid>)` on Linux,
 *     `process.kill(pid, 0)` cross-platform.
 *   - **Crash recovery:** if the editor crashes the lockfile stays
 *     behind; the MCP server's PID-liveness check ignores it. Next
 *     editor launch will overwrite it on the first file open.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { app } from "electron";

import { canonicalPath } from "@molio2-editor/core";

const FILENAME = "active-session.json";

interface SessionState {
  /** Editor's process id — used by the MCP server to check liveness. */
  pid: number;
  /** Most recently opened `.moliospec` path. `null` if no file is open. */
  lastOpenedFile: string | null;
  /** True if the renderer reports any unsaved edits anywhere. */
  anyDirty: boolean;
  /**
   * Localhost HTTP port the editor's MCP-proxy listener bound to,
   * or null if the listener didn't come up. The MCP server reads
   * this to talk to the editor (see editorHttpServer.ts).
   */
  httpPort: number | null;
  /**
   * Shared-secret token the MCP server must send on every request
   * to the editor's HTTP listener (Authorization: Bearer <token>).
   * Regenerated each editor launch. Null if the listener isn't up.
   *
   * Tokens are not secrets in the cryptographic sense — they live
   * in a user-protected directory and only protect against other
   * processes on the same machine poking at the editor. The MCP
   * server reads them as plain text; we don't log them anywhere.
   */
  httpToken: string | null;
  /** ISO-8601 timestamp of the last write. Mostly diagnostic. */
  updatedAt: string;
}

/** In-memory copy of the last written state. We re-write on every
 *  field change so the file always matches reality, but we want to
 *  combine partial updates (e.g. "dirty bit changed") with the
 *  existing path/pid without re-querying. */
let cached: SessionState = {
  pid: process.pid,
  lastOpenedFile: null,
  anyDirty: false,
  httpPort: null,
  httpToken: null,
  updatedAt: new Date().toISOString(),
};

function lockfilePath(): string {
  return `${app.getPath("userData")}/${FILENAME}`;
}

function ensureDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    /* swallow — best-effort */
  }
}

function flush(): void {
  cached.updatedAt = new Date().toISOString();
  const filePath = lockfilePath();
  ensureDir(filePath);
  try {
    writeFileSync(filePath, JSON.stringify(cached, null, 2) + "\n", "utf8");
  } catch (err) {
    // Don't crash the editor if we can't write the lockfile —
    // the worst that happens is the MCP server doesn't see the
    // breadcrumb. Log to stderr for diagnostics.
    process.stderr.write(
      `[main] sessionLockfile: failed to write ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

/**
 * The path of the file the editor currently has open, or null when
 * none is open. Read straight from the in-memory lockfile cache —
 * used by the "Point AI at This File" menu item.
 */
export function getCurrentFilePath(): string | null {
  return cached.lastOpenedFile;
}

/**
 * Called when the user opens a file (Channels.openFile).
 *
 * M4 — the path is canonicalised before it is written down.
 * `canonicalPath` follows symlinks and reports the capitalisation
 * the filesystem actually uses; it does not lowercase, so what ends
 * up in the file is still a path a person can read and another
 * program can open. The MCP server compares with `samePath`, which
 * canonicalises its side too, so a difference in spelling can no
 * longer make one file look like two.
 */
export function recordFileOpened(path: string): void {
  cached = {
    ...cached,
    pid: process.pid,
    lastOpenedFile: canonicalPath(path),
  };
  flush();
}

/** Called when the file is saved. The path may change on Save As,
 *  so we accept the (possibly new) path here. After a successful
 *  save the dirty bit is implicitly cleared by the renderer's
 *  setDirty(false) call. Canonicalised for the same reason as
 *  `recordFileOpened`. */
export function recordFileSaved(path: string): void {
  cached = {
    ...cached,
    pid: process.pid,
    lastOpenedFile: canonicalPath(path),
  };
  flush();
}

/** Called when the renderer reports its dirty state (Channels.setDirty). */
export function recordDirtyChanged(dirty: boolean): void {
  cached = {
    ...cached,
    anyDirty: dirty,
  };
  flush();
}

/** Called once at boot when the HTTP listener finishes binding. */
export function recordHttpListenerStarted(args: {
  port: number;
  token: string;
}): void {
  cached = {
    ...cached,
    httpPort: args.port,
    httpToken: args.token,
  };
  flush();
}

/** Called from `will-quit` (alongside clearSessionLockfile). Not
 *  strictly necessary because the whole file gets deleted, but
 *  kept symmetric with `recordHttpListenerStarted` for clarity in
 *  the wiring. */
export function recordHttpListenerStopped(): void {
  cached = {
    ...cached,
    httpPort: null,
    httpToken: null,
  };
  flush();
}

/** Called from the app's `will-quit` handler. Removes the file
 *  cleanly so a future editor / MCP read doesn't see a stale
 *  lockfile from this run. */
export function clearSessionLockfile(): void {
  const filePath = lockfilePath();
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    /* swallow — quitting anyway */
  }
}
