/**
 * Tests for `createWorkSpec` (Skive 1 — custom structures).
 *
 * Strategy mirrors `createPfbbChild.test.ts`: open a real synthetic
 * sample, create a brand-new work area, round-trip through a temp copy,
 * and assert the row landed with the right defaults. Then exercise the
 * validation throws.
 *
 * We lean on a real sample rather than a hand-rolled SQLite fixture so
 * the test doubles as "does our insert match Molio's actual schema?" —
 * if the column shape drifts (or a new NOT NULL column appears), the
 * insert fails loudly here.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createWorkSpec,
  openMoliospec,
  readMoliospec,
  WorkAreaType,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
// Any normal project sample works — we only need a valid file to insert
// into. Prefer the showoff synthetic; fall back to the first .moliospec.
const sample =
  samples.find((s) => s.label.toLowerCase().includes("showoff")) ??
  samples.find((s) => s.path.toLowerCase().endsWith(".moliospec"));

describe("createWorkSpec", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-create-ws-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("creates an empty work area with name only and round-trips", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const before = readMoliospec(h);
      const countBefore = before.workSpecs.length;

      const result = createWorkSpec(h, { workAreaName: "Min egen struktur" });
      expect(result.workSpecId).toBeGreaterThan(0);

      // Save + reopen to prove the insert persists.
      const outPath = join(workDir, "create-ws-happy.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const after = readMoliospec(reopen);
        expect(after.workSpecs.length).toBe(countBefore + 1);

        const ws = after.workSpecs.find((w) => w.id === result.workSpecId);
        expect(ws).toBeDefined();
        expect(ws!.work_area_name).toBe("Min egen struktur");
        // Default type = Arbejdsbeskrivelse (0).
        expect(ws!.work_area_type).toBe(WorkAreaType.Arbejdsbeskrivelse);
        // From-scratch content carries no Molio identity and no contract.
        expect(ws!.work_area_code).toBeNull();
        expect(ws!.contract_id).toBeNull();
        expect(ws!.molio_spec_guid).toBeNull();
        expect(ws!.molio_spec_revision_guid).toBeNull();
        expect(ws!.molio_work_spec_paradigm_guid).toBeNull();

        // Brand-new area starts with zero sections.
        const sections = after.workSpecSections.filter(
          (s) => s.work_spec_id === result.workSpecId,
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
      const result = createWorkSpec(h, {
        workAreaName: "   Polstret navn   ",
      });
      const after = readMoliospec(h);
      const ws = after.workSpecs.find((w) => w.id === result.workSpecId);
      expect(ws!.work_area_name).toBe("Polstret navn");
    } finally {
      await h.close();
    }
  });

  it("honours an explicit type and code", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      const result = createWorkSpec(h, {
        workAreaName: "Paradigme",
        workAreaType: WorkAreaType.ParadigmeForArbejdsbeskrivelse,
        workAreaCode: "S215",
      });
      const after = readMoliospec(h);
      const ws = after.workSpecs.find((w) => w.id === result.workSpecId);
      expect(ws!.work_area_type).toBe(
        WorkAreaType.ParadigmeForArbejdsbeskrivelse,
      );
      expect(ws!.work_area_code).toBe("S215");
    } finally {
      await h.close();
    }
  });

  it("throws when the name is empty or whitespace-only", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      expect(() => createWorkSpec(h, { workAreaName: "" })).toThrow(
        /work_area_name is empty/,
      );
      expect(() => createWorkSpec(h, { workAreaName: "    " })).toThrow(
        /work_area_name is empty/,
      );
    } finally {
      await h.close();
    }
  });

  it("throws when the work_area_type is out of range", async () => {
    if (!sample) return;
    const h = await openMoliospec(sample.path);
    try {
      expect(() =>
        createWorkSpec(h, {
          workAreaName: "Ugyldig type",
          // 7 is not a valid work_area_type (only 0/1/2 exist).
          workAreaType: 7 as WorkAreaType,
        }),
      ).toThrow(/invalid work_area_type/);
    } finally {
      await h.close();
    }
  });
});
