/**
 * Tests for `createPfbbChild` (Slice 10H.3).
 *
 * Strategy: open the official Molio PFBB sample database (which already
 * contains 2 masters + 2 subscribers), round-trip through a temp copy,
 * and exercise both the happy path and every validation throw.
 *
 * We lean on the real sample rather than hand-rolling a SQLite fixture
 * so the test doubles as "does our schema model match Molio's actual
 * files?" — if their column shape drifts, this test fails loudly.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPfbbChild, openMoliospec, readMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
// Prefer the v01.00.04 copy to match the rest of the app. Fall back to
// any PFBB sample if the folder layout changes.
const pfbbSample =
  samples.find(
    (s) =>
      s.label.includes("Version 01.00.04") &&
      s.label.toLowerCase().includes("projektf"),
  ) ?? samples.find((s) => s.label.toLowerCase().includes("projektf"));

describe("createPfbbChild", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-pfbb-child-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("inserts a subscriber BDB pointing at the master with 0 sections", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      // Find a master (is_pfbb === 1) and a target work_spec that is
      // NOT the master's own work_spec.
      const master = file.constructionElementSpecs.find((b) => b.is_pfbb === 1);
      expect(master).toBeDefined();
      const target = file.workSpecs.find((w) => w.id !== master!.work_spec_id);
      expect(target).toBeDefined();

      const result = createPfbbChild(h, {
        masterId: master!.id,
        targetWorkSpecId: target!.id,
        name: "Test child BDB",
      });
      expect(result.newBdbId).toBeGreaterThan(0);
      expect(result.newBdbId).not.toBe(master!.id);

      // Save + reopen to prove the insert round-trips.
      const outPath = join(workDir, "child-happy.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const child = reread.constructionElementSpecs.find(
          (b) => b.id === result.newBdbId,
        );
        expect(child).toBeDefined();
        expect(child!.name).toBe("Test child BDB");
        expect(child!.is_pfbb).toBe(0);
        expect(child!.pfbb_id).toBe(master!.id);
        expect(child!.work_spec_id).toBe(target!.id);
        // Inherited refs.
        expect(child!.molio_spec_guid).toBe(master!.molio_spec_guid);
        expect(child!.molio_spec_revision_guid).toBe(
          master!.molio_spec_revision_guid,
        );
        // Cleared fields — spot-check the most important ones.
        expect(child!.controlplan_design_id).toBeNull();
        expect(child!.controlplan_production_id).toBeNull();
        expect(child!.molio_construction_element_spec_guid).toBeNull();
        expect(child!.revision).toBeNull();
        expect(child!.created_by).toBeNull();

        // No sections copied — children only store deviations later.
        const childSections = reread.constructionElementSpecSections.filter(
          (s) => s.construction_element_spec_id === result.newBdbId,
        );
        expect(childSections.length).toBe(0);
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
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const master = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 1,
      )!;
      const target = file.workSpecs.find((w) => w.id !== master.work_spec_id)!;

      const result = createPfbbChild(h, {
        masterId: master.id,
        targetWorkSpecId: target.id,
        name: "   Padded name   ",
      });

      const reread = readMoliospec(h);
      const child = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      expect(child!.name).toBe("Padded name");
    } finally {
      await h.close();
    }
  });

  it("throws when the master id does not exist", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const target = file.workSpecs[0]!;
      expect(() =>
        createPfbbChild(h, {
          masterId: 999_999_999,
          targetWorkSpecId: target.id,
          name: "X",
        }),
      ).toThrow(/no such BDB/);
    } finally {
      await h.close();
    }
  });

  it("throws when the supposed master is not actually a PFBB master", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      // Pick a regular BDB (is_pfbb=0, pfbb_id=null).
      const regular = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 0 && b.pfbb_id == null,
      );
      // Fixture-agnostic: the synthetic samples may contain only PFBB BDBs.
      // Skip rather than fail when there is no regular BDB to use as the
      // (deliberately invalid) "master".
      if (!regular) return;
      const target = file.workSpecs.find(
        (w) => w.id !== regular!.work_spec_id,
      )!;
      expect(() =>
        createPfbbChild(h, {
          masterId: regular!.id,
          targetWorkSpecId: target.id,
          name: "X",
        }),
      ).toThrow(/is not a PFBB master/);
    } finally {
      await h.close();
    }
  });

  it("throws when the master is itself a subscriber (chain rejection)", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      // The sample has subscribers (is_pfbb=0, pfbb_id set). Even if we
      // imagine is_pfbb was flipped to 1, we'd still reject because
      // pfbb_id is not null — that's the chain guard.
      const subscriber = file.constructionElementSpecs.find(
        (b) => b.pfbb_id != null,
      );
      expect(subscriber).toBeDefined();
      // First: as-is, throws "not a PFBB master".
      expect(() =>
        createPfbbChild(h, {
          masterId: subscriber!.id,
          targetWorkSpecId: file.workSpecs[0]!.id,
          name: "X",
        }),
      ).toThrow(/not a PFBB master/);

      // Now promote it in memory to is_pfbb=1 via direct SQL so we can
      // exercise the chain guard specifically.
      h.db
        .prepare(
          "update construction_element_spec set is_pfbb = 1 where id = ?",
        )
        .run(subscriber!.id);
      expect(() =>
        createPfbbChild(h, {
          masterId: subscriber!.id,
          targetWorkSpecId: file.workSpecs[0]!.id,
          name: "X",
        }),
      ).toThrow(/PFBB chains are not allowed/);
    } finally {
      await h.close();
    }
  });

  it("throws when the target work_spec does not exist", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const master = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 1,
      )!;
      expect(() =>
        createPfbbChild(h, {
          masterId: master.id,
          targetWorkSpecId: 999_999_999,
          name: "X",
        }),
      ).toThrow(/no such work_spec/);
    } finally {
      await h.close();
    }
  });

  it("throws when the target work_spec is the master's own work_spec", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const master = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 1,
      )!;
      expect(master.work_spec_id).not.toBeNull();
      expect(() =>
        createPfbbChild(h, {
          masterId: master.id,
          targetWorkSpecId: master.work_spec_id!,
          name: "X",
        }),
      ).toThrow(/master's own work_spec/);
    } finally {
      await h.close();
    }
  });

  it("throws when the name is empty or whitespace-only", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const master = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 1,
      )!;
      const target = file.workSpecs.find((w) => w.id !== master.work_spec_id)!;

      expect(() =>
        createPfbbChild(h, {
          masterId: master.id,
          targetWorkSpecId: target.id,
          name: "",
        }),
      ).toThrow(/name is empty/);

      expect(() =>
        createPfbbChild(h, {
          masterId: master.id,
          targetWorkSpecId: target.id,
          name: "   ",
        }),
      ).toThrow(/name is empty/);
    } finally {
      await h.close();
    }
  });

  it("throws when a BDB with the same name already exists in the target work_spec", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const master = file.constructionElementSpecs.find(
        (b) => b.is_pfbb === 1,
      )!;
      const target = file.workSpecs.find((w) => w.id !== master.work_spec_id)!;

      // First create succeeds.
      createPfbbChild(h, {
        masterId: master.id,
        targetWorkSpecId: target.id,
        name: "Duplicate-probe",
      });

      // Second with the same name in the same work_spec must throw.
      expect(() =>
        createPfbbChild(h, {
          masterId: master.id,
          targetWorkSpecId: target.id,
          name: "Duplicate-probe",
        }),
      ).toThrow(/already exists/);

      // Same name in a DIFFERENT work_spec is fine — scope is per-work_spec.
      const otherTarget = file.workSpecs.find(
        (w) => w.id !== master.work_spec_id && w.id !== target.id,
      );
      if (otherTarget) {
        expect(() =>
          createPfbbChild(h, {
            masterId: master.id,
            targetWorkSpecId: otherTarget.id,
            name: "Duplicate-probe",
          }),
        ).not.toThrow();
      }
    } finally {
      await h.close();
    }
  });
});
