/**
 * Tests for `createBdb` (Skive 2 — custom structures).
 *
 * Strategy mirrors createWorkSpec.test.ts / createPfbbChild.test.ts:
 * open a real synthetic sample, create a brand-new ordinary BDB under
 * an existing work area, round-trip through a temp copy, and assert the
 * row landed with the right defaults. Then exercise the validation
 * throws (empty name, missing work area, duplicate name).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBdb, openMoliospec, readMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const sample =
  samples.find((s) => s.label.toLowerCase().includes("showoff")) ??
  samples.find((s) => s.path.toLowerCase().endsWith(".moliospec"));

describe("createBdb", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-create-bdb-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("creates an empty ordinary BDB under a work area and round-trips", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const workArea = before.workSpecs[0];
      expect(workArea).toBeDefined();
      const countBefore = before.constructionElementSpecs.length;

      const result = createBdb(h, {
        workSpecId: workArea!.id,
        name: "Min egen bygningsdel",
      });
      expect(result.bdbId).toBeGreaterThan(0);

      const outPath = join(workDir, "create-bdb-happy.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const after = readMoliospec(reopen);
        expect(after.constructionElementSpecs.length).toBe(countBefore + 1);

        const bdb = after.constructionElementSpecs.find(
          (b) => b.id === result.bdbId,
        );
        expect(bdb).toBeDefined();
        expect(bdb!.name).toBe("Min egen bygningsdel");
        expect(bdb!.work_spec_id).toBe(workArea!.id);
        // Ordinary BDB — not a PFBB master or subscriber.
        expect(bdb!.is_pfbb).toBe(0);
        expect(bdb!.pfbb_id).toBeNull();
        // No Molio identity, no control plans.
        expect(bdb!.molio_spec_guid).toBeNull();
        expect(bdb!.molio_construction_element_spec_guid).toBeNull();
        expect(bdb!.controlplan_design_id).toBeNull();
        expect(bdb!.controlplan_production_id).toBeNull();

        // Brand-new BDB starts with zero sections.
        const sections = after.constructionElementSpecSections.filter(
          (s) => s.construction_element_spec_id === result.bdbId,
        );
        expect(sections.length).toBe(0);
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

  it("trims whitespace from the name before inserting", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const workArea = readMoliospec(h).workSpecs[0]!;
      const result = createBdb(h, {
        workSpecId: workArea.id,
        name: "   Polstret bygningsdel   ",
      });
      const bdb = readMoliospec(h).constructionElementSpecs.find(
        (b) => b.id === result.bdbId,
      );
      expect(bdb!.name).toBe("Polstret bygningsdel");
    } finally {
      await h.close();
    }
  });

  it("throws when the name is empty or whitespace-only", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const workArea = readMoliospec(h).workSpecs[0]!;
      expect(() =>
        createBdb(h, { workSpecId: workArea.id, name: "   " }),
      ).toThrow(/name is empty/);
    } finally {
      await h.close();
    }
  });

  it("throws when the target work area does not exist", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      expect(() =>
        createBdb(h, { workSpecId: 999_999_999, name: "X" }),
      ).toThrow(/no such work_spec/);
    } finally {
      await h.close();
    }
  });

  it("throws when a BDB with the same name already exists in the work area", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const workArea = readMoliospec(h).workSpecs[0]!;
      createBdb(h, { workSpecId: workArea.id, name: "Dublet" });
      expect(() =>
        createBdb(h, { workSpecId: workArea.id, name: "Dublet" }),
      ).toThrow(/already exists/);
    } finally {
      await h.close();
    }
  });
});
