/**
 * Task 1 / M1, slice 3 - the migration hooked onto `openMoliospec`.
 *
 * Two things are being pinned here.
 *
 * The upgrade is opt-in. `openMoliospec(path)` must leave an old file
 * exactly as it is, because a caller that cannot warn the user or force
 * "Save as" - the MCP server, an export job - has no business converting
 * anything. Only `{ migrate: true }` does the conversion, and even then
 * only on the temp copy: the file on disk is never modified by opening.
 *
 * And the output wrapping. Molio's older samples are often plain
 * `.sqlite`. What we write after an upgrade is a new 01.00.04
 * `.moliospec`, and Molio ships those gzipped, so the caller can insist
 * on gzip regardless of how the source arrived.
 */

import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CURRENT_DB_VERSION,
  isGzipped,
  isSqlite,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();

function fixture(version: string): string {
  const needle = `synthetic-legacy-${version.replace(/\./g, "-")}`;
  const hit = samples.find((s) => s.label.includes(needle));
  if (!hit) {
    throw new Error(
      `Legacy fixture for ${version} not found. Run: ` +
        `python3 scripts/generate-test-fixtures.py legacy`,
    );
  }
  return hit.path;
}

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "open-migrate-"));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("openMoliospec without the migrate flag", () => {
  it("leaves an old file on its old schema", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      expect(h.migration).toBeNull();
      expect(readMoliospec(h).dbVersion).toBe("01.00.00");
      const tables = h.db
        .prepare("select name from sqlite_master where type='table'")
        .all() as { name: string }[];
      expect(tables.map((t) => t.name)).not.toContain("contracts");
    } finally {
      await h.close();
    }
  });
});

describe("openMoliospec with migrate: true", () => {
  it("upgrades an old file and reports what it did", async () => {
    const h = await openMoliospec(fixture("01.00.00"), { migrate: true });
    try {
      expect(h.migration?.migrated).toBe(true);
      expect(h.migration?.fromVersion).toBe("01.00.00");
      expect(h.migration?.losesControlPlanLinks).toBe(true);
      expect(readMoliospec(h).dbVersion).toBe(CURRENT_DB_VERSION);
    } finally {
      await h.close();
    }
  });

  it("reports 'nothing done' for a file that is already current", async () => {
    const h = await openMoliospec(fixture("01.00.03"), { migrate: true });
    try {
      expect(h.migration?.migrated).toBe(false);
      expect(readMoliospec(h).dbVersion).toBe("01.00.03");
    } finally {
      await h.close();
    }
  });

  it("does not touch the user's file on disk", async () => {
    // The whole safety story rests on this: opening reads into a temp
    // copy, so even a converting open leaves the original alone.
    const path = fixture("01.00.01");
    const before = await readFile(path);
    const h = await openMoliospec(path, { migrate: true });
    try {
      expect(h.migration?.migrated).toBe(true);
    } finally {
      await h.close();
    }
    expect(await readFile(path)).toEqual(before);
  });
});

describe("saveAs wrapping", () => {
  it("writes gzip when asked, even from a raw .sqlite source", async () => {
    // The 01.00.01 fixture is deliberately un-gzipped, like Molio's own.
    const source = fixture("01.00.01");
    expect(isSqlite((await readFile(source)).subarray(0, 16))).toBe(true);

    const target = join(workDir, "upgraded.moliospec");
    const h = await openMoliospec(source, { migrate: true });
    try {
      await h.saveAs(target, { gzip: true });
    } finally {
      await h.close();
    }

    expect(isGzipped((await readFile(target)).subarray(0, 2))).toBe(true);

    const reopened = await openMoliospec(target);
    try {
      expect(readMoliospec(reopened).dbVersion).toBe(CURRENT_DB_VERSION);
    } finally {
      await reopened.close();
    }
  });

  it("still mirrors the source wrapping when not asked", async () => {
    const source = fixture("01.00.01");
    const target = join(workDir, "unwrapped.sqlite");
    const h = await openMoliospec(source);
    try {
      await h.saveAs(target);
    } finally {
      await h.close();
    }
    expect(isSqlite((await readFile(target)).subarray(0, 16))).toBe(true);
  });
});
