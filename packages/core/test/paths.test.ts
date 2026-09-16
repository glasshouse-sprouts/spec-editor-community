/**
 * M4 — path canonicalisation.
 *
 * These are the cases that made the editor and the MCP server
 * disagree about whether they were looking at the same file. Every
 * one of them is an ordinary place to keep a project, not an
 * adversarial input: a symlinked cloud folder, a path typed with
 * different capitalisation, a relative path.
 *
 * The symlink tests build a real symlink in a temp directory rather
 * than mocking, because the whole point is what the filesystem does
 * with it. Windows refuses to create symlinks without elevation, so
 * those tests skip themselves there.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalPath, samePath } from "../src/paths.js";

const CASE_INSENSITIVE_FS =
  process.platform === "darwin" || process.platform === "win32";

let root: string;
/** <root>/real/doc.moliospec */
let realFile: string;
/** <root>/link -> <root>/real, so <root>/link/doc.moliospec is the
 *  same file by another name. The Dropbox / iCloud case. */
let linkedFile: string;
let symlinksWork = true;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "molio-paths-"));
  mkdirSync(join(root, "real"));
  realFile = join(root, "real", "doc.moliospec");
  writeFileSync(realFile, "x", "utf8");
  try {
    symlinkSync(join(root, "real"), join(root, "link"), "dir");
    linkedFile = join(root, "link", "doc.moliospec");
  } catch {
    // Windows without developer mode, or a filesystem that has no
    // symlinks. The rest of the file still runs.
    symlinksWork = false;
    linkedFile = realFile;
  }
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("canonicalPath", () => {
  it("makes a relative path absolute", () => {
    const out = canonicalPath("some/where/doc.moliospec");
    expect(out.startsWith("/") || /^[A-Za-z]:/.test(out)).toBe(true);
  });

  it("resolves a symlinked directory in the middle of the path", () => {
    if (!symlinksWork) return;
    expect(canonicalPath(linkedFile)).toBe(canonicalPath(realFile));
  });

  it("does not lowercase what it returns", () => {
    // The editor hands this value to "Point AI at This File", so it
    // has to stay a path a person can read and a program can open.
    const mixed = join(root, "real", "doc.moliospec");
    expect(canonicalPath(mixed)).toContain("doc.moliospec");
  });

  it("returns something usable for a file that does not exist yet", () => {
    // realpath fails on a missing entry. The directory still exists,
    // so the symlinks that matter are still resolved and the name is
    // put back on.
    const missing = join(root, "real", "not-created-yet.moliospec");
    const out = canonicalPath(missing);
    expect(out.endsWith("not-created-yet.moliospec")).toBe(true);
    if (symlinksWork) {
      expect(
        canonicalPath(join(root, "link", "not-created-yet.moliospec")),
      ).toBe(out);
    }
  });

  it("does not throw when nothing in the path exists", () => {
    const nowhere = join(root, "no", "such", "dir", "doc.moliospec");
    expect(() => canonicalPath(nowhere)).not.toThrow();
  });
});

describe("samePath", () => {
  it("matches a file with itself", () => {
    expect(samePath(realFile, realFile)).toBe(true);
  });

  it("matches the symlinked path against the real one", () => {
    if (!symlinksWork) return;
    // This is the Dropbox case, and the one that stranded unsaved
    // work: `===` says false here.
    expect(realFile === linkedFile).toBe(false);
    expect(samePath(realFile, linkedFile)).toBe(true);
  });

  it("ignores capitalisation on macOS and Windows, and only there", () => {
    const shouted = realFile.toUpperCase();
    expect(samePath(realFile, shouted)).toBe(CASE_INSENSITIVE_FS);
  });

  it("does not match two different files", () => {
    const other = join(root, "real", "other.moliospec");
    writeFileSync(other, "y", "utf8");
    expect(samePath(realFile, other)).toBe(false);
  });

  it("treats null, undefined and empty as no file", () => {
    expect(samePath(null, realFile)).toBe(false);
    expect(samePath(realFile, null)).toBe(false);
    expect(samePath(undefined, undefined)).toBe(false);
    expect(samePath("", "")).toBe(false);
  });
});
