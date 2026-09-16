/**
 * Tests for PFBB id remapping on import (code-review punkt 4).
 *
 * `pfbb_id` (subscriber → master BDB) and `pfbb_section_id` (child
 * supplement section → master section) are row-ids from the SOURCE
 * database. Copied verbatim they're dead links — or worse, collide with
 * an unrelated target row that happens to share the id and silently show
 * the wrong master's content. The import must remap them to the new
 * target ids, and NULL them out when the master isn't part of the import.
 *
 * Strategy mirrors import.test.ts: copy the PFBB sample to a temp file,
 * wipe its work areas, then import selected work areas back and inspect
 * the resulting pfbb links.
 *
 * Fixture-agnostic: the PFBB shape (masters, subscribers, the supplement
 * section and their work_specs) is DISCOVERED from the sample rather than
 * hard-coded to specific row-ids, so the test survives fixture changes.
 * It only assumes the sample contains at least one PFBB master, at least
 * one subscriber (pfbb_id set) in a DIFFERENT work_spec than the masters,
 * and one subscriber supplement section (pfbb_section_id set).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyEdits,
  importFromMoliospec,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const pfbbSample =
  samples.find(
    (s) =>
      s.label.includes("Version 01.00.04") &&
      s.label.toLowerCase().includes("projektf"),
  ) ?? samples.find((s) => s.label.toLowerCase().includes("projektf"));

/** Discover the PFBB shape from the sample (no hard-coded row-ids). */
function derivePfbbShape(file: ReturnType<typeof readMoliospec>) {
  const masters = file.constructionElementSpecs.filter((b) => b.is_pfbb === 1);
  const subscribers = file.constructionElementSpecs.filter(
    (b) => b.pfbb_id != null,
  );
  // A subscriber section that supplements a master section.
  const supplementSection = file.constructionElementSpecSections.find(
    (s) => s.pfbb_section_id != null,
  );
  const supplementSub = subscribers.find(
    (b) => b.id === supplementSection?.construction_element_spec_id,
  );
  const masterSection = file.constructionElementSpecSections.find(
    (s) => s.id === supplementSection?.pfbb_section_id,
  );
  const masterOfSupplement = masters.find(
    (m) => m.id === supplementSub?.pfbb_id,
  );
  return {
    masters,
    subscribers,
    supplementSection,
    supplementSub,
    masterSection,
    masterOfSupplement,
    wsMasters: masters[0]?.work_spec_id,
    wsSubscribers: subscribers[0]?.work_spec_id,
  };
}

/** Copy the sample to a temp .moliospec and delete every work area. */
async function freshWipedTarget(workDir: string, name: string) {
  const targetPath = join(workDir, name);
  const seed = await openMoliospec(pfbbSample!.path);
  try {
    await seed.saveAs(targetPath);
  } finally {
    await seed.close();
  }
  const target = await openMoliospec(targetPath);
  const before = readMoliospec(target);
  const wipe = before.workSpecs.map((w) => ({
    target: "deleteWorkArea" as const,
    id: w.id,
  }));
  if (wipe.length > 0) applyEdits(target, wipe);
  return target;
}

describe("importFromMoliospec — PFBB id remapping", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-pfbb-remap-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("remaps pfbb_id and pfbb_section_id when the master IS imported (order-independent)", async () => {
    if (!pfbbSample) return;
    const target = await freshWipedTarget(workDir, "with-master.moliospec");
    const src = await openMoliospec(pfbbSample.path);
    try {
      const shape = derivePfbbShape(readMoliospec(src));
      expect(shape.masters.length).toBeGreaterThan(0);
      expect(shape.subscribers.length).toBeGreaterThan(0);
      expect(shape.supplementSub).toBeDefined();
      expect(shape.masterOfSupplement).toBeDefined();
      expect(shape.wsMasters).not.toBe(shape.wsSubscribers);

      // Subscribers' work area listed BEFORE the masters' — proves the
      // post-pass resolves links regardless of copy order.
      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: shape.wsSubscribers!,
            targetContractId: null,
            onCollision: "rename",
          },
          {
            sourceWorkSpecId: shape.wsMasters!,
            targetContractId: null,
            onCollision: "rename",
          },
        ],
        bdbs: [],
      });

      const after = readMoliospec(target);
      const bdbById = (id: number) =>
        after.constructionElementSpecs.find((b) => b.id === id)!;

      // Every subscriber's pfbb_id points at the NEW master id, not the
      // stale source id.
      for (const sub of shape.subscribers) {
        const newSub = result.bdbIdMap[sub.id];
        const newMaster = result.bdbIdMap[sub.pfbb_id!];
        expect(newSub).toBeTypeOf("number");
        expect(newMaster).toBeTypeOf("number");
        expect(bdbById(newSub!).pfbb_id).toBe(newMaster);
      }

      // The supplement section points at the NEW master section (matched
      // by section_no within the remapped master / subscriber).
      const newMaster = result.bdbIdMap[shape.masterOfSupplement!.id]!;
      const newSub = result.bdbIdMap[shape.supplementSub!.id]!;
      const newMasterSection = after.constructionElementSpecSections.find(
        (s) =>
          s.construction_element_spec_id === newMaster &&
          s.section_no === shape.masterSection!.section_no,
      );
      expect(newMasterSection).toBeDefined();
      const newSupplementSection = after.constructionElementSpecSections.find(
        (s) =>
          s.construction_element_spec_id === newSub &&
          s.section_no === shape.supplementSection!.section_no,
      );
      expect(newSupplementSection).toBeDefined();
      expect(newSupplementSection!.pfbb_section_id).toBe(newMasterSection!.id);
    } finally {
      await src.close();
      await target.close();
    }
  });

  it("NULLs pfbb_id and pfbb_section_id when the master is NOT imported", async () => {
    if (!pfbbSample) return;
    const target = await freshWipedTarget(workDir, "no-master.moliospec");
    const src = await openMoliospec(pfbbSample.path);
    try {
      const shape = derivePfbbShape(readMoliospec(src));
      expect(shape.subscribers.length).toBeGreaterThan(0);
      expect(shape.supplementSub).toBeDefined();

      // Import ONLY the subscribers' work area; masters left behind.
      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: shape.wsSubscribers!,
            targetContractId: null,
            onCollision: "rename",
          },
        ],
        bdbs: [],
      });

      // Masters were not imported, so they have no entry in the id map.
      for (const m of shape.masters) {
        expect(result.bdbIdMap[m.id]).toBeUndefined();
      }

      const after = readMoliospec(target);
      const bdbById = (id: number) =>
        after.constructionElementSpecs.find((b) => b.id === id)!;

      // Collision guard: a dead link (null) is correct; pointing at a
      // same-id stranger would be the bug.
      for (const sub of shape.subscribers) {
        const newSub = result.bdbIdMap[sub.id];
        expect(newSub).toBeTypeOf("number");
        expect(bdbById(newSub!).pfbb_id).toBeNull();
      }

      const newSub = result.bdbIdMap[shape.supplementSub!.id]!;
      const newSupplementSection = after.constructionElementSpecSections.find(
        (s) =>
          s.construction_element_spec_id === newSub &&
          s.section_no === shape.supplementSection!.section_no,
      );
      expect(newSupplementSection).toBeDefined();
      expect(newSupplementSection!.pfbb_section_id).toBeNull();
    } finally {
      await src.close();
      await target.close();
    }
  });
});
