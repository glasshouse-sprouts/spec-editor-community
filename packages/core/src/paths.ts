/**
 * Path canonicalisation — one way of asking "are these two paths the
 * same file?".
 *
 * Why this lives in core
 * ----------------------
 * Two processes need the answer and they are in different packages:
 * the editor (`packages/app`) records which file it has open, and the
 * MCP server (`packages/mcp-server`) checks that record before it
 * writes to a file. `core` is the only package both depend on — and
 * the only one that survives the Community export, which deletes
 * `packages/mcp-server` wholesale.
 *
 * What went wrong without it (M4 in
 * `docs/CODE_REVIEW_2026-09-04.md`)
 * --------------------------------------------------------------
 * The two ends compared paths as raw strings. Three ordinary
 * situations make the same file look like two different strings:
 *
 *   - macOS is normally case-insensitive (APFS). `/Projekter/Fil`
 *     and `/projekter/fil` are one file to the OS and two strings
 *     to `===`.
 *   - `/var` is a symlink to `/private/var` on macOS.
 *   - Dropbox and iCloud put symlinks in the middle of paths.
 *
 * The consequence was not an error message but silent data loss: the
 * dirty-guard concluded the editor did NOT have the file open, the
 * MCP server wrote, and the user's later save was refused by the
 * editor's own mtime check. Unsaved work stranded, in a file they
 * thought they were working in.
 *
 * Two functions, on purpose
 * -------------------------
 * `canonicalPath` resolves symlinks but does NOT change case, so
 * what it returns is still a path you can show a person or hand to
 * another program. `samePath` is the comparison, and only it folds
 * case. Keeping the fold out of the stored value matters: the
 * editor's "Point AI at This File" menu item hands `lastOpenedFile`
 * straight to the AI, and a lowercased path would be wrong on a
 * case-sensitive volume.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Platforms whose filesystems are case-insensitive by default.
 *  Case is compared literally everywhere else, because on Linux
 *  `Fil` and `fil` really are two files. */
function foldsCase(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Resolve a path to its one true form: absolute, with every symlink
 * followed and (on macOS and Windows) with the capitalisation the
 * filesystem actually uses.
 *
 * Case is NOT altered here — `realpathSync.native` reports the real
 * spelling on disk, which is a better answer than lowercasing.
 *
 * A path that does not exist cannot be resolved by the OS, and that
 * is a normal case rather than an error: a file about to be created
 * has a real directory but no entry yet. We then canonicalise the
 * directory and put the name back on, which still resolves the
 * symlinks that matter (a Dropbox folder, `/var`). If even the
 * directory is unresolvable, the plain absolute path is returned.
 * The function never throws.
 */
export function canonicalPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    /* falls through to the directory attempt below */
  }
  try {
    return join(realpathSync.native(dirname(abs)), basename(abs));
  } catch {
    return abs;
  }
}

/**
 * Do these two paths point at the same file?
 *
 * Both sides are canonicalised, then compared case-insensitively on
 * the platforms whose filesystems are. Either side may be `null` or
 * `undefined` — that is "no file", and no file is the same as
 * nothing, so the answer is `false`.
 *
 * Use this instead of `===` for any path comparison that crosses a
 * process boundary. Inside one process the strings usually come from
 * the same source and agree; across two they do not.
 */
export function samePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a === "" || b === "") return false;
  const ca = canonicalPath(a);
  const cb = canonicalPath(b);
  return foldsCase() ? ca.toLowerCase() === cb.toLowerCase() : ca === cb;
}
