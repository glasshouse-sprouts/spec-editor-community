/**
 * Crash-safe file replacement (security review H1).
 *
 * Writing a user's project file in place is the one bug a specification
 * tool must never have: if the app, the OS or the power dies halfway
 * through, the user is left with a half-written `.moliospec` and no
 * second copy. This module is the single place in the codebase that
 * knows how to avoid that.
 *
 * The pattern, in one line: write the new bytes to a temp file next to
 * the target, force them to disk, then `rename()` the temp file over
 * the target. `rename()` within one directory is atomic at the OS
 * level, so at every instant a reader sees either the complete old
 * file or the complete new file. There is never a partial file.
 *
 * Details that matter, and why:
 *
 *  - **Same directory.** `rename()` is only atomic within one
 *    filesystem. A temp file in the system temp folder may live on a
 *    different volume, where the "rename" degrades to a copy (not
 *    atomic, and fails with EXDEV). So the temp file is a sibling of
 *    the target.
 *  - **Symlinks resolved first.** If the target is a symlink, writing
 *    through it used to update the file it points at. Renaming over it
 *    would instead replace the link itself. We resolve the real path
 *    up front so the behaviour is unchanged.
 *  - **fsync before rename.** A successful `write()` only reaches the
 *    OS cache. Without an explicit sync, a power cut can leave a
 *    correctly renamed but empty file. We sync the temp file (and,
 *    best effort, its directory) before the rename.
 *  - **Permissions preserved.** `rename()` replaces the target inode,
 *    so the new file would otherwise get default permissions. On a
 *    shared or network folder that silently changes who can read the
 *    file, so we copy the target's mode onto the temp file first.
 *  - **Rename retry.** On Windows an antivirus scanner or another
 *    process holding the file open can make the rename fail for a
 *    moment. We retry a few times with a short backoff before giving
 *    up.
 *  - **Cleanup on failure.** Any failure removes the temp file and
 *    leaves the target completely untouched.
 */

import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Error codes that mean "the file is busy right now, try again". */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Backoff between rename attempts, in milliseconds. ~620 ms in total. */
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320];

/**
 * Longest temp filename we will build. 255 bytes is the limit on ext4,
 * APFS and NTFS; we stay a little under it and truncate the middle of
 * the target's name if needed.
 */
const MAX_TEMP_NAME_BYTES = 200;

export interface AtomicReplaceOptions {
  /**
   * Force the temp file to physical disk before renaming. Defaults to
   * true. Tests that write hundreds of small files may turn it off;
   * production code should not.
   */
  fsync?: boolean;
  /** Override the rename backoff (tests). */
  renameRetryDelaysMs?: number[];
}

/**
 * Replace `targetPath` with whatever `write` produces, atomically.
 *
 * `write` is handed the path of a temp file and must write the
 * complete new contents there. If it throws, or anything after it
 * fails, the temp file is removed and `targetPath` is left exactly as
 * it was.
 */
export async function atomicReplace(
  targetPath: string,
  write: (tempPath: string) => Promise<void>,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  const useFsync = options.fsync ?? true;
  const delays = options.renameRetryDelaysMs ?? RENAME_RETRY_DELAYS_MS;

  const finalPath = await resolveTargetPath(targetPath);
  const dir = dirname(finalPath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, tempFileName(basename(finalPath)));

  try {
    await write(tempPath);
    if (useFsync) await fsyncFile(tempPath);
    await copyModeIfPossible(finalPath, tempPath);
    await renameWithRetry(tempPath, finalPath, delays);
  } catch (err) {
    // Best-effort cleanup: never let a cleanup failure mask the real
    // error the caller needs to see.
    try {
      await rm(tempPath, { force: true });
    } catch {
      /* swallow */
    }
    throw err;
  }

  // The rename is durable only once the directory entry itself is on
  // disk. Not supported everywhere (Windows in particular), so this is
  // best effort and never fails the save.
  if (useFsync) await fsyncDirBestEffort(dir);
}

// --- helpers ---------------------------------------------------------------

/**
 * Resolve symlinks so we rename over the real file, not over a link to
 * it. If the target does not exist yet (Save As to a new name) we
 * resolve its directory instead and keep the requested filename.
 */
async function resolveTargetPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    // Target missing: resolve the parent directory if we can.
    const dir = dirname(targetPath);
    try {
      return join(await realpath(dir), basename(targetPath));
    } catch {
      // Parent missing too (we will mkdir it). Use the path as given.
      return targetPath;
    }
  }
}

/**
 * Build a hidden, unique sibling filename: `.<target>.<pid>-<rand>.tmp`.
 * Hidden (leading dot) so a cloud-sync client or a file dialog does not
 * show it during the split second it exists.
 */
function tempFileName(targetName: string): string {
  const suffix = `.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  const budget = MAX_TEMP_NAME_BYTES - suffix.length - 1;
  const stem =
    Buffer.byteLength(targetName) > budget
      ? Buffer.from(targetName).subarray(0, budget).toString("utf8")
      : targetName;
  return `.${stem}${suffix}`;
}

/** Force a file's bytes out of the OS cache and onto the disk. */
async function fsyncFile(path: string): Promise<void> {
  const fh = await open(path, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Force the directory entry to disk. Not supported on all platforms. */
async function fsyncDirBestEffort(dir: string): Promise<void> {
  try {
    const fh = await open(dir, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* swallow: unsupported on Windows and some network filesystems */
  }
}

/**
 * Copy the existing target's permission bits onto the temp file, so the
 * replacement keeps them. Best effort: filesystems without permission
 * bits (FAT, some network mounts) simply skip this.
 */
async function copyModeIfPossible(
  targetPath: string,
  tempPath: string,
): Promise<void> {
  try {
    const s = await stat(targetPath);
    await chmod(tempPath, s.mode & 0o7777);
  } catch {
    /* target does not exist yet, or chmod unsupported */
  }
}

/**
 * `rename()` with a short backoff on "file is busy" errors, which
 * happen on Windows when a virus scanner or another process briefly
 * holds the target open. Any other error fails immediately.
 */
async function renameWithRetry(
  from: string,
  to: string,
  delays: number[],
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (attempt >= delays.length || !RETRYABLE_RENAME_CODES.has(code)) {
        throw err;
      }
      await sleep(delays[attempt]!);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
