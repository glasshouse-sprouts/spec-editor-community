/**
 * Tests for the crash-safe file replacement helper (H1).
 *
 * The whole point of `atomicReplace` is what happens when a write goes
 * wrong, so most of these tests deliberately break the write and then
 * assert two things:
 *
 *   1. the original target file is byte-for-byte untouched, and
 *   2. no temp file is left behind in the folder.
 *
 * Because `atomicReplace` takes the write step as a callback, we can
 * inject a failure at any point without any mocking of production code.
 */

import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicReplace } from "../src/atomicReplace.js";

const ORIGINAL = Buffer.from("ORIGINAL CONTENT - must never be damaged\n");

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atomic-replace-"));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Create the target file with known contents. */
async function seedTarget(name = "doc.moliospec"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, ORIGINAL);
  return path;
}

/** Everything in the working directory, sorted. */
async function listDir(d = dir): Promise<string[]> {
  return (await readdir(d)).sort();
}

describe("atomicReplace - happy path", () => {
  it("replaces the target with the new contents", async () => {
    const target = await seedTarget();
    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "NEW CONTENT");
    });
    expect(await readFile(target, "utf8")).toBe("NEW CONTENT");
  });

  it("leaves no temp file behind on success", async () => {
    const target = await seedTarget();
    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "NEW CONTENT");
    });
    expect(await listDir()).toEqual(["doc.moliospec"]);
  });

  it("creates the file when the target does not exist yet (Save As)", async () => {
    const target = join(dir, "brand-new.moliospec");
    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "FRESH");
    });
    expect(await readFile(target, "utf8")).toBe("FRESH");
    expect(await listDir()).toEqual(["brand-new.moliospec"]);
  });

  it("creates missing parent directories", async () => {
    const target = join(dir, "nested", "deeper", "doc.moliospec");
    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "FRESH");
    });
    expect(await readFile(target, "utf8")).toBe("FRESH");
  });

  it("handles a large payload without truncation", async () => {
    const target = await seedTarget();
    const payload = randomBytes(3 * 1024 * 1024);
    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, payload);
    });
    expect(Buffer.compare(await readFile(target), payload)).toBe(0);
  });
});

describe("atomicReplace - the write fails", () => {
  it("leaves the original untouched when the writer throws immediately", async () => {
    const target = await seedTarget();
    await expect(
      atomicReplace(target, async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");

    expect(Buffer.compare(await readFile(target), ORIGINAL)).toBe(0);
    expect(await listDir()).toEqual(["doc.moliospec"]);
  });

  it("leaves the original untouched when the writer fails PART WAY through", async () => {
    // This is the real-world crash: half the new file is on disk when
    // the process dies. The target must still be the old file.
    const target = await seedTarget();
    await expect(
      atomicReplace(target, async (tmp) => {
        await writeFile(tmp, "HALF OF THE NEW FILE...");
        throw new Error("crashed mid-write");
      }),
    ).rejects.toThrow("crashed mid-write");

    expect(Buffer.compare(await readFile(target), ORIGINAL)).toBe(0);
    expect(await listDir()).toEqual(["doc.moliospec"]);
  });

  it("cleans up the temp file when the writer fails", async () => {
    const target = await seedTarget();
    let tempSeen = "";
    await expect(
      atomicReplace(target, async (tmp) => {
        tempSeen = tmp;
        await writeFile(tmp, "PARTIAL");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(tempSeen).not.toBe("");
    await expect(stat(tempSeen)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates no file at all when the target did not exist and the writer fails", async () => {
    const target = join(dir, "brand-new.moliospec");
    await expect(
      atomicReplace(target, async (tmp) => {
        await writeFile(tmp, "PARTIAL");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await listDir()).toEqual([]);
  });

  it("leaves the original untouched when the writer produces nothing", async () => {
    // No temp file was ever created: fsync must fail cleanly rather
    // than renaming a nonexistent file over the target.
    const target = await seedTarget();
    await expect(atomicReplace(target, async () => {})).rejects.toMatchObject({
      code: "ENOENT",
    });

    expect(Buffer.compare(await readFile(target), ORIGINAL)).toBe(0);
    expect(await listDir()).toEqual(["doc.moliospec"]);
  });

  it("leaves the original untouched when the rename fails", async () => {
    // Force a rename failure by making the target a directory: you
    // cannot rename a file over a non-empty directory.
    const target = join(dir, "as-a-dir");
    await mkdir(target);
    await writeFile(join(target, "child"), "x");

    await expect(
      atomicReplace(target, async (tmp) => {
        await writeFile(tmp, "NEW");
      }),
    ).rejects.toBeTruthy();

    // Directory and its contents survive; no temp file left.
    expect(await listDir()).toEqual(["as-a-dir"]);
    expect(await listDir(target)).toEqual(["child"]);
  });
});

describe("atomicReplace - preserved metadata", () => {
  it("keeps the target's permission bits", async () => {
    const target = await seedTarget();
    await chmod(target, 0o640);

    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "NEW CONTENT");
    });

    expect((await stat(target)).mode & 0o777).toBe(0o640);
  });

  it("writes through a symlink instead of replacing it", async () => {
    const real = join(dir, "real.moliospec");
    await writeFile(real, ORIGINAL);
    const link = join(dir, "link.moliospec");
    await symlink(real, link);

    await atomicReplace(link, async (tmp) => {
      await writeFile(tmp, "NEW CONTENT");
    });

    // The link is still a link, and the real file got the new bytes.
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toBe("NEW CONTENT");
    expect(await listDir()).toEqual(["link.moliospec", "real.moliospec"]);
  });
});

describe("atomicReplace - temp file naming", () => {
  it("puts the temp file in the same directory as the target, hidden", async () => {
    const target = await seedTarget();
    let tempSeen = "";
    await atomicReplace(target, async (tmp) => {
      tempSeen = tmp;
      await writeFile(tmp, "NEW");
    });

    // atomicReplace resolves the target's directory with realpath() so a
    // symlinked target still gets a sibling on the SAME filesystem. On
    // macOS that turns /var/... into /private/var/..., so compare against
    // the resolved directory rather than the raw mkdtemp one.
    const resolvedDir = await realpath(dir);
    expect(tempSeen.startsWith(join(resolvedDir, "."))).toBe(true);
    expect(tempSeen.endsWith(".tmp")).toBe(true);
  });

  it("keeps the temp filename within filesystem limits for very long names", async () => {
    const longName = `${"x".repeat(240)}.moliospec`;
    const target = join(dir, longName);
    await writeFile(target, ORIGINAL);

    await atomicReplace(target, async (tmp) => {
      await writeFile(tmp, "NEW CONTENT");
    });

    expect(await readFile(target, "utf8")).toBe("NEW CONTENT");
  });

  it("does not collide when two saves to the same target overlap", async () => {
    const target = await seedTarget();
    const seen: string[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        atomicReplace(target, async (tmp) => {
          seen.push(tmp);
          await writeFile(tmp, `NEW ${n}`);
        }),
      ),
    );

    expect(new Set(seen).size).toBe(5);
    expect(await listDir()).toEqual(["doc.moliospec"]);
    expect(await readFile(target, "utf8")).toMatch(/^NEW [1-5]$/);
  });
});
