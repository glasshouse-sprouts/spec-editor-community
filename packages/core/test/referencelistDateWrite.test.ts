/**
 * Task 155 phase C, self-check C3 - the two new date columns survive
 * a save, a close and a reopen.
 *
 * Why a round-trip and not just an assert on the return value: the
 * columns are new write slots, and the thing that would actually go
 * wrong is a column name that does not exist, or a write that lands
 * in the in-memory db and never reaches the file. Both only show up
 * after reopening from disk.
 *
 * The values are read back TWICE: once through `readMoliospec` (what
 * the app sees) and once with raw SQL against the reopened file (what
 * is really in there). The raw query is printed, because "the field
 * saved" is worth nothing without the row to show for it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyEdits, openMoliospec, readMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const sample =
  samples.find((s) => s.label.toLowerCase().includes("showoff")) ??
  samples.find((s) => s.path.toLowerCase().endsWith(".moliospec"));

const WS_DATE = "2025-01-01";
const BDB_DATE = "2026-05-20";

const RAW_QUERY = `
  select 'work_spec' as tbl, id, molio_referencelist_area_date as date
    from work_spec
   where id = ?
  union all
  select 'construction_element_spec' as tbl, id,
         molio_referencelist_area_date as date
    from construction_element_spec
   where id = ?
`;

describe("molio_referencelist_area_date round-trips", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-t155-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("writes the work-area and BDB dates, and reads them back after reopen", async () => {
    if (!sample) return;
    const outPath = join(workDir, "t155-dates.moliospec");
    // The ids come back out of the first handle, so the write block
    // yields them rather than filling pre-declared variables.
    const { wsId, bdbId } = await (async (): Promise<{
      wsId: number;
      bdbId: number;
    }> => {
      const h = await openMoliospec(sample.path);
      try {
        const before = readMoliospec(h);
        const ws = before.workSpecs[0];
        const bdb = before.constructionElementSpecs[0];
        expect(ws).toBeDefined();
        expect(bdb).toBeDefined();

        // Both columns start empty - that is the measured state of
        // every real file (2026-10-02: NULL in all 240).
        expect(ws!.molio_referencelist_area_date ?? null).toBeNull();
        expect(bdb!.molio_referencelist_area_date ?? null).toBeNull();

        const result = applyEdits(h, [
          {
            target: "workSpecMetadata",
            id: ws!.id,
            referencelistAreaDate: WS_DATE,
          },
          {
            target: "bdbMetadata",
            id: bdb!.id,
            referencelistAreaDate: BDB_DATE,
          },
        ]);
        // One UPDATE per touched column, both rows found.
        expect(result.updated).toBe(2);

        await h.saveAs(outPath);
        return { wsId: ws!.id, bdbId: bdb!.id };
      } finally {
        await h.close();
      }
    })();

    const reopen = await openMoliospec(outPath);
    try {
      const after = readMoliospec(reopen);
      expect(
        after.workSpecs.find((w) => w.id === wsId)
          ?.molio_referencelist_area_date,
      ).toBe(WS_DATE);
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdbId)
          ?.molio_referencelist_area_date,
      ).toBe(BDB_DATE);

      // Raw SQL against the reopened file, printed so the run itself
      // is the evidence.
      const rows = reopen.db.prepare(RAW_QUERY).all(wsId, bdbId);
      console.log("C3 query:", RAW_QUERY.trim());
      console.log("C3 result:", JSON.stringify(rows));
      expect(rows).toEqual([
        { tbl: "work_spec", id: wsId, date: WS_DATE },
        { tbl: "construction_element_spec", id: bdbId, date: BDB_DATE },
      ]);
    } finally {
      await reopen.close();
    }
  });

  it("clears a date back to NULL, which is what 'inherit' is stored as", async () => {
    if (!sample) return;
    const outPath = join(workDir, "t155-cleared.moliospec");
    const bdbId = await (async (): Promise<number> => {
      const h = await openMoliospec(sample.path);
      try {
        const id = readMoliospec(h).constructionElementSpecs[0]!.id;
        applyEdits(h, [
          { target: "bdbMetadata", id, referencelistAreaDate: BDB_DATE },
        ]);
        applyEdits(h, [
          { target: "bdbMetadata", id, referencelistAreaDate: null },
        ]);
        await h.saveAs(outPath);
        return id;
      } finally {
        await h.close();
      }
    })();
    const reopen = await openMoliospec(outPath);
    try {
      const row = reopen.db
        .prepare(
          "select molio_referencelist_area_date as date from construction_element_spec where id = ?",
        )
        .get(bdbId);
      console.log("C3 cleared result:", JSON.stringify(row));
      expect(row).toEqual({ date: null });
    } finally {
      await reopen.close();
    }
  });

  it("leaves the GUID column alone", async () => {
    // The sibling column `molio_referencelist_area` is the base
    // revision's own id and has no write slot at all. If a future
    // edit shape ever grows one by accident, this fails.
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const bdb = before.constructionElementSpecs[0]!;
      const guidBefore = bdb.molio_referencelist_area ?? null;
      applyEdits(h, [
        {
          target: "bdbMetadata",
          id: bdb.id,
          referencelistAreaDate: BDB_DATE,
        },
      ]);
      const after = readMoliospec(h);
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id)
          ?.molio_referencelist_area ?? null,
      ).toBe(guidBefore);
    } finally {
      await h.close();
    }
  });
});
