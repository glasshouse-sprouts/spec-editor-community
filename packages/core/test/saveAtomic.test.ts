/**
 * Atomicity and failure tests for `MoliospecHandle.saveAs` (H1).
 *
 * `atomicReplace.test.ts` proves the temp-file-plus-rename mechanism in
 * isolation. This file proves that the real save path uses it: that both
 * the gzip and the raw-SQLite branch still work, and that a failure
 * inside the save leaves the user's existing file completely intact.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isGzipped, isSqlite, openMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

/**
 * One real gzipped `.moliospec` from the repo's sample folders. We pick
 * the smallest so the failure tests stay fast.
 */
const gzippedSamples = findAllSamples()
  .filter((s) => isGzipped(readFileSync(s.path).subarray(0, 2)))
  .sort((a, b) => readFileSync(a.path).length - readFileSync(b.path).length);
const SAMPLE = gzippedSamples[0]?.path ?? "";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "save-atomic-"));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Write a raw (un-gzipped) SQLite copy of the sample and return its path. */
async function makeRawSample(): Promise<string> {
  const raw = gunzipSync(await readFile(SAMPLE));
  const path = join(dir, "raw-source.sqlite");
  await writeFile(path, raw);
  return path;
}

describe("saveAs - happy path is unchanged", () => {
  it("finds a gzipped sample to test against", () => {
    expect(SAMPLE).not.toBe("");
  });

  it("writes a gzipped file that reopens with identical SQLite bytes", async () => {
    const handle = await openMoliospec(SAMPLE);
    const originalSha = await handle.sqliteSha256();

    const target = join(dir, "out.moliospec");
    await handle.saveAs(target);
    await handle.close();

    expect(isGzipped(await readFile(target))).toBe(true);

    const reopened = await openMoliospec(target);
    expect(await reopened.sqliteSha256()).toBe(originalSha);
    await reopened.close();
  });

  it("keeps a raw SQLite source raw", async () => {
    const source = await makeRawSample();
    const handle = await openMoliospec(source);
    const originalSha = await handle.sqliteSha256();

    const target = join(dir, "out.sqlite");
    await handle.saveAs(target);
    await handle.close();

    const bytes = await readFile(target);
    expect(isSqlite(bytes)).toBe(true);
    expect(isGzipped(bytes)).toBe(false);

    const reopened = await openMoliospec(target);
    expect(await reopened.sqliteSha256()).toBe(originalSha);
    await reopened.close();
  });

  it("leaves no temp files behind after a successful save", async () => {
    const handle = await openMoliospec(SAMPLE);
    const target = join(dir, "out.moliospec");
    await handle.saveAs(target);
    await handle.close();

    expect(await readdir(dir)).toEqual(["out.moliospec"]);
  });

  it("can save repeatedly over the same target", async () => {
    const handle = await openMoliospec(SAMPLE);
    const target = join(dir, "out.moliospec");
    await handle.saveAs(target);
    await handle.saveAs(target);
    await handle.saveAs(target);
    await handle.close();

    expect(await readdir(dir)).toEqual(["out.moliospec"]);
    const reopened = await openMoliospec(target);
    await reopened.close();
  });

  it("preserves the target's permission bits when overwriting", async () => {
    const handle = await openMoliospec(SAMPLE);
    const target = join(dir, "out.moliospec");
    await handle.saveAs(target);
    await chmod(target, 0o640);

    await handle.saveAs(target);
    await handle.close();

    expect((await stat(target)).mode & 0o777).toBe(0o640);
  });
});

describe("saveAs - a failed save never damages the existing file", () => {
  /**
   * Failure injection without mocks: we delete the temp SQLite image
   * that backs the handle. The next save then fails while reading it,
   * which is exactly the shape of a real mid-write I/O error.
   */
  async function brokenHandle() {
    const handle = await openMoliospec(SAMPLE);
    return handle;
  }

  it("leaves the previous version of the target intact (gzip branch)", async () => {
    const handle = await brokenHandle();
    const target = join(dir, "out.moliospec");

    // First save succeeds - this is "the user's existing file".
    await handle.saveAs(target);
    const before = await readFile(target);

    // Now break the source and save again.
    await rm(handle.sqlitePath, { force: true });
    await expect(handle.saveAs(target)).rejects.toBeTruthy();

    const after = await readFile(target);
    expect(sha256(after)).toBe(sha256(before));
    await handle.close();
  });

  it("leaves the previous version of the target intact (raw branch)", async () => {
    const source = await makeRawSample();
    const handle = await openMoliospec(source);
    const target = join(dir, "out.sqlite");

    await handle.saveAs(target);
    const before = await readFile(target);

    await rm(handle.sqlitePath, { force: true });
    await expect(handle.saveAs(target)).rejects.toBeTruthy();

    expect(sha256(await readFile(target))).toBe(sha256(before));
    await handle.close();
  });

  it("cleans up the temp file when the save fails", async () => {
    const handle = await brokenHandle();
    const target = join(dir, "out.moliospec");
    await handle.saveAs(target);

    await rm(handle.sqlitePath, { force: true });
    await expect(handle.saveAs(target)).rejects.toBeTruthy();

    expect(await readdir(dir)).toEqual(["out.moliospec"]);
    await handle.close();
  });

  it("creates nothing when a first-time save fails", async () => {
    const handle = await brokenHandle();
    await rm(handle.sqlitePath, { force: true });

    const target = join(dir, "never-created.moliospec");
    await expect(handle.saveAs(target)).rejects.toBeTruthy();

    expect(await readdir(dir)).toEqual([]);
    await handle.close();
  });
});

describe("saveAs - write-ahead log is flushed", () => {
  it("includes rows committed in WAL mode", async () => {
    // WAL mode keeps committed pages in a sidecar file. saveAs only
    // copies the main database file, so it must checkpoint first or the
    // newest edits would silently be missing from the saved file.
    const handle = await openMoliospec(SAMPLE);
    handle.db.pragma("journal_mode = WAL");
    handle.db.exec("CREATE TABLE h1_probe (id INTEGER PRIMARY KEY, v TEXT)");
    handle.db.exec("INSERT INTO h1_probe (v) VALUES ('written-in-wal')");

    const target = join(dir, "wal.moliospec");
    await handle.saveAs(target);
    await handle.close();

    const reopened = await openMoliospec(target);
    const row = reopened.db.prepare("SELECT v FROM h1_probe").get() as
      { v: string } | undefined;
    await reopened.close();

    expect(row?.v).toBe("written-in-wal");
  });
});
