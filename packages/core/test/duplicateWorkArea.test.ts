/**
 * Tests for `duplicateWorkArea`.
 *
 * Opens a real synthetic sample, duplicates a work area, round-trips
 * through a temp copy, and asserts:
 *   - the work_spec row is copied with identity GUIDs cleared and the
 *     contract set from args (default null, NOT inherited);
 *   - work_spec_section rows are copied (count matches);
 *   - attachments are copied with sha1_hash NULLed (UNIQUE column);
 *   - includeBdbs clones the BDBs into the copy;
 *   - validation throws for unknown source / unknown contract.
 *
 * Leans on a real sample so the inserts double as a schema check.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  duplicateWorkArea,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const sample =
  samples.find((s) => s.label.toLowerCase().includes("showoff")) ??
  samples.find((s) => s.path.toLowerCase().endsWith(".moliospec"));

/** Pick a work area that has at least one BDB (so includeBdbs has work
 *  to do); prefer one that also has an attachment. */
function pickSource(file: ReturnType<typeof readMoliospec>): number {
  const bdbByWs = new Set(
    file.constructionElementSpecs.map((b) => b.work_spec_id),
  );
  const attWs = new Set(
    file.attachments.map((a) => a.work_spec_id).filter((x) => x != null),
  );
  const withBoth = file.workSpecs.find(
    (w) => bdbByWs.has(w.id) && attWs.has(w.id),
  );
  if (withBoth) return withBoth.id;
  const withBdb = file.workSpecs.find((w) => bdbByWs.has(w.id));
  if (withBdb) return withBdb.id;
  return file.workSpecs[0]!.id;
}

describe("duplicateWorkArea", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-dup-ws-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("copies sections + attachments, clears GUIDs, defaults to no contract", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const srcId = pickSource(before);
      const srcSectionCount = before.workSpecSections.filter(
        (s) => s.work_spec_id === srcId,
      ).length;
      const srcAttCount = before.attachments.filter(
        (a) => a.work_spec_id === srcId,
      ).length;
      const srcName = before.workSpecs.find((w) => w.id === srcId)!
        .work_area_name;

      const result = duplicateWorkArea(h, { workSpecId: srcId });
      expect(result.workSpecId).toBeGreaterThan(0);
      expect(result.newBdbIds).toHaveLength(0); // includeBdbs default off

      const outPath = join(workDir, "dup-ws-basic.moliospec");
      await h.saveAs(outPath);
      // sha1_hash is not exposed by readMoliospec — check it on the raw
      // db before closing the handle.
      const attHashes = h.db
        .prepare("select sha1_hash from attachment where work_spec_id = ?")
        .all(result.workSpecId) as { sha1_hash: Buffer | null }[];
      expect(attHashes).toHaveLength(srcAttCount);
      expect(attHashes.every((r) => r.sha1_hash === null)).toBe(true);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const after = readMoliospec(reopen);
        const copy = after.workSpecs.find((w) => w.id === result.workSpecId);
        expect(copy).toBeDefined();
        expect(copy!.work_area_name).toBe(`${srcName} (copy)`);
        expect(copy!.contract_id).toBeNull(); // not inherited
        expect(copy!.molio_spec_guid).toBeNull();
        expect(copy!.molio_spec_revision_guid).toBeNull();
        expect(copy!.molio_work_spec_paradigm_guid).toBeNull();

        const copySections = after.workSpecSections.filter(
          (s) => s.work_spec_id === result.workSpecId,
        );
        expect(copySections.length).toBe(srcSectionCount);

        const copyAtt = after.attachments.filter(
          (a) => a.work_spec_id === result.workSpecId,
        );
        expect(copyAtt.length).toBe(srcAttCount);

        // No BDBs copied when includeBdbs is off.
        const copyBdbs = after.constructionElementSpecs.filter(
          (b) => b.work_spec_id === result.workSpecId,
        );
        expect(copyBdbs.length).toBe(0);
      } finally {
        await reopen.close();
      }
    } catch (e) {
      try {
        await h.close();
      } catch {
        /* ignore */
      }
      throw e;
    }
  });

  it("clones the BDBs into the copy when includeBdbs is true", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const srcId = pickSource(before);
      const srcBdbCount = before.constructionElementSpecs.filter(
        (b) => b.work_spec_id === srcId,
      ).length;
      expect(srcBdbCount).toBeGreaterThan(0);

      const result = duplicateWorkArea(h, {
        workSpecId: srcId,
        includeBdbs: true,
      });
      expect(result.newBdbIds.length).toBe(srcBdbCount);

      const outPath = join(workDir, "dup-ws-bdbs.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const after = readMoliospec(reopen);
        const copyBdbs = after.constructionElementSpecs.filter(
          (b) => b.work_spec_id === result.workSpecId,
        );
        expect(copyBdbs.length).toBe(srcBdbCount);
        // Source work area still has its own BDBs (originals untouched).
        const srcBdbsAfter = after.constructionElementSpecs.filter(
          (b) => b.work_spec_id === srcId,
        );
        expect(srcBdbsAfter.length).toBe(srcBdbCount);
      } finally {
        await reopen.close();
      }
    } catch (e) {
      try {
        await h.close();
      } catch {
        /* ignore */
      }
      throw e;
    }
  });

  it("places the copy in a contract when contractId is given, and honours newName", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const srcId = pickSource(before);
      const contract = before.contracts[0];
      if (!contract) return; // sample has no contracts — skip
      const result = duplicateWorkArea(h, {
        workSpecId: srcId,
        contractId: contract.id,
        newName: "Custom duplicate name",
      });
      const after = readMoliospec(h);
      const copy = after.workSpecs.find((w) => w.id === result.workSpecId);
      expect(copy!.contract_id).toBe(contract.id);
      expect(copy!.work_area_name).toBe("Custom duplicate name");
    } finally {
      await h.close();
    }
  });

  it("throws on an unknown source work area", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      expect(() =>
        duplicateWorkArea(h, { workSpecId: 999_999_999 }),
      ).toThrow(/no such work area/);
    } finally {
      await h.close();
    }
  });

  it("throws on an unknown contract id", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const srcId = pickSource(before);
      expect(() =>
        duplicateWorkArea(h, {
          workSpecId: srcId,
          contractId: 999_999_999,
        }),
      ).toThrow(/no such contract/);
    } finally {
      await h.close();
    }
  });
});
