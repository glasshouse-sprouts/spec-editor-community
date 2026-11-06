/**
 * Main does not trust paths from the renderer (Task 106, M2 + M3 in
 * docs/CODE_REVIEW_2026-09-04.md).
 *
 * The renderer is sandboxed, but it shows HTML from files we did not
 * write, so "the renderer is trusted" is an assumption, not a
 * guarantee. The IPC types say a field is a path; nothing checked it
 * at run time. Every IPC handler that takes a path now calls one of
 * these first, before any file is opened, read or written. A refused
 * path throws `PathRejectedError`, so the call fails without touching
 * the disk.
 *
 * The same goes for the MCP export's output folder, which an AI client
 * names (card 3's comments, 2026-09-24): `assertExportDirectory`.
 */

import { realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { isSafeFileBase } from "../shared/fileNames.js";

/** A path or file name from outside main that main refuses to use. */
export class PathRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathRejectedError";
  }
}

/** Extensions the editor opens. Same list as the Open dialog's filter. */
export const MOLIO_FILE_EXTENSIONS: readonly string[] = [
  ".moliospec",
  ".mspec",
  ".mspectpl",
  ".sqlite",
];

/** Custom cover templates (bskriver only). */
export const COVER_TEMPLATE_EXTENSION = ".speccustom";

/** Common checks: a non-empty absolute string, no NUL, no ".." part. */
function assertAbsolutePath(p: unknown, what: string): string {
  if (typeof p !== "string" || p.trim() === "") {
    throw new PathRejectedError(`${what}: no path given.`);
  }
  if (p.includes("\0")) {
    throw new PathRejectedError(`${what}: the path contains a NUL byte.`);
  }
  if (!isAbsolute(p)) {
    throw new PathRejectedError(`${what}: not an absolute path: ${p}`);
  }
  if (p.split(/[\\/]/).includes("..")) {
    throw new PathRejectedError(`${what}: the path contains "..": ${p}`);
  }
  return p;
}

/**
 * A Molio file the editor may open or write: absolute, no NUL, no
 * "..", and one of `MOLIO_FILE_EXTENSIONS`. Returns the path.
 */
export function assertMoliospecPath(p: unknown, what = "path"): string {
  const path = assertAbsolutePath(p, what);
  const ext = extname(path).toLowerCase();
  if (!MOLIO_FILE_EXTENSIONS.includes(ext)) {
    throw new PathRejectedError(
      `${what}: not a Molio file (${ext || "no extension"}): ${path}`,
    );
  }
  return path;
}

/** A `.speccustom` cover template, with the same path rules. */
export function assertCoverTemplatePath(p: unknown, what = "path"): string {
  const path = assertAbsolutePath(p, what);
  if (extname(path).toLowerCase() !== COVER_TEMPLATE_EXTENSION) {
    throw new PathRejectedError(
      `${what}: not a ${COVER_TEMPLATE_EXTENSION} file: ${path}`,
    );
  }
  return path;
}

/** A file name (no extension) to join onto a folder main chose. */
export function assertSafeFileBase(base: unknown): string {
  if (!isSafeFileBase(base)) {
    throw new PathRejectedError(
      `Unsafe file name: ${JSON.stringify(base)}. A file name may not be ` +
        `empty, "." or "..", or contain / \\ : * ? " < > | or control characters.`,
    );
  }
  return base;
}

/**
 * Folders an export may never write into, for this platform: the
 * operating system, installed programs, and the per-user folders where
 * programs keep settings and start-up items (macOS ~/Library, Windows
 * %APPDATA% with its Startup folder, Linux ~/.config). Exceptions that
 * lie inside them are in `allowedExportRoots`.
 */
export function protectedExportRoots(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  if (platform === "win32") {
    return [
      env["SystemRoot"] ?? "C:\\Windows",
      env["ProgramFiles"] ?? "C:\\Program Files",
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      env["ProgramData"] ?? "C:\\ProgramData",
      env["APPDATA"] ?? join(home, "AppData", "Roaming"),
      env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"),
    ];
  }
  if (platform === "darwin") {
    return [
      "/System",
      "/Library",
      "/Applications",
      "/bin",
      "/sbin",
      "/usr",
      "/private/etc",
      "/private/var/db",
      join(home, "Library"),
    ];
  }
  return [
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib32",
    "/lib64",
    "/proc",
    "/root",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
    join(home, ".config"),
    join(home, ".local"),
  ];
}

/**
 * Folders inside a protected root that an export may still use: the
 * system temp folder (inside %LOCALAPPDATA% on Windows), and on macOS
 * the cloud-drive folders that live in ~/Library (iCloud Drive, and
 * Dropbox / OneDrive / Google Drive under CloudStorage).
 */
export function allowedExportRoots(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  const roots = [tmpdir()];
  if (platform === "darwin") {
    roots.push(
      join(home, "Library", "CloudStorage"),
      join(home, "Library", "Mobile Documents"),
    );
  }
  return roots;
}

/** `p` with symlinks resolved, or `p` itself if it does not exist. */
async function realOrSelf(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/** Is `child` the folder `root` or inside it? */
function isInside(child: string, root: string, caseless: boolean): boolean {
  const a = caseless ? child.toLowerCase() : child;
  const b = caseless ? resolve(root).toLowerCase() : resolve(root);
  const rel = relative(b, a);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The folder an MCP export may write into: absolute, no NUL, no "..",
 * an existing directory (after following symlinks), and not inside
 * `protectedExportRoots()` unless inside `allowedExportRoots()`.
 * Returns the resolved real path, which is what the caller should
 * write into.
 */
export async function assertExportDirectory(dir: unknown): Promise<string> {
  const given = assertAbsolutePath(dir, "outputDirectory");
  let real: string;
  try {
    real = await realpath(given);
  } catch {
    throw new PathRejectedError(
      `outputDirectory: the folder does not exist: ${given}`,
    );
  }
  const s = await stat(real);
  if (!s.isDirectory()) {
    throw new PathRejectedError(`outputDirectory: not a folder: ${given}`);
  }
  const caseless =
    process.platform === "win32" || process.platform === "darwin";
  for (const root of allowedExportRoots()) {
    if (isInside(real, await realOrSelf(root), caseless)) return real;
  }
  for (const root of protectedExportRoots()) {
    if (isInside(real, await realOrSelf(root), caseless)) {
      throw new PathRejectedError(
        `outputDirectory: exports may not be written into ${root}: ${given}`,
      );
    }
  }
  return real;
}
