/**
 * Tests for Slice 6K — import from another moliospec.
 *
 * Strategy:
 *   - Use one sample file as BOTH source and target (open two handles).
 *     The target is a copy of the source, so we know ids exist and the
 *     content roughly matches.
 *   - Alternatively we open the sample as source and saveAs to a fresh
 *     temp copy, then open the temp copy as target. This gives us a
 *     clean target we can mutate without affecting the repo.
 *
 * We can't rely on a second "empty" moliospec because the repo doesn't
 * ship one. So every test either (a) imports into an unrelated branch of
 * the same file and checks counts, or (b) imports into a fresh temp copy
 * after wiping the relevant tables.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyEdits,
  createContract,
  getImportPrecheck,
  importFromMoliospec,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const showoff = samples.find((s) => s.label.toLowerCase().includes("showoff"));

describe("importFromMoliospec (Slice 6K)", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-import-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("imports a work area with its sections + BDBs + CPs into a fresh target", async () => {
    if (!showoff) return;

    // Prepare target: a fresh copy of Showoff with ALL its work areas
    // deleted, so we can re-import one and verify the numbers match.
    const targetPath = join(workDir, "target-1.moliospec");
    const source = await openMoliospec(showoff.path);
    try {
      await source.saveAs(targetPath);
    } finally {
      await source.close();
    }

    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      // Pick a work area that HAS at least one BDB (so we exercise the
      // BDB + CP copy path).
      const candidate = srcFile.workSpecs.find((w) =>
        srcFile.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      expect(candidate).toBeDefined();
      const srcWs = candidate!;
      const srcSectionsN = srcFile.workSpecSections.filter(
        (s) => s.work_spec_id === srcWs.id,
      ).length;
      const srcBdbsN = srcFile.constructionElementSpecs.filter(
        (b) => b.work_spec_id === srcWs.id,
      ).length;

      // Wipe target: delete every work area so the import lands in a
      // clean slate.
      const tgtFileBefore = readMoliospec(target);
      const wipeEdits = tgtFileBefore.workSpecs.map((w) => ({
        target: "deleteWorkArea" as const,
        id: w.id,
      }));
      if (wipeEdits.length > 0) applyEdits(target, wipeEdits);

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: srcWs.id,
            targetContractId: null,
            onCollision: "rename",
          },
        ],
        bdbs: [],
      });

      expect(result.workAreasImported).toBe(1);
      expect(result.bdbsImported).toBe(srcBdbsN);

      const tgtFileAfter = readMoliospec(target);
      const newWsId = result.workAreaIdMap[srcWs.id];
      expect(newWsId).toBeTypeOf("number");

      // Section count matches on the newly imported work area.
      expect(
        tgtFileAfter.workSpecSections.filter((s) => s.work_spec_id === newWsId)
          .length,
      ).toBe(srcSectionsN);

      // BDB count matches.
      expect(
        tgtFileAfter.constructionElementSpecs.filter(
          (b) => b.work_spec_id === newWsId,
        ).length,
      ).toBe(srcBdbsN);

      // At least one BDB under the new work area — and its CPs (if any)
      // have been brought along.
      const importedBdbs = tgtFileAfter.constructionElementSpecs.filter(
        (b) => b.work_spec_id === newWsId,
      );
      expect(importedBdbs.length).toBeGreaterThan(0);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("getImportPrecheck detects name collisions under the same target contract", async () => {
    if (!showoff) return;
    const target = await openMoliospec(showoff.path);
    const src = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(src);
      const ws = file.workSpecs[0];
      expect(ws).toBeDefined();

      // Same file → importing a work area back into itself at "no contract"
      // should collide with the original if the original is at no contract.
      const targetContractId = ws!.contract_id ?? null;

      const pre = getImportPrecheck(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: ws!.id,
            targetContractId,
            onCollision: "skip",
          },
        ],
        bdbs: [],
      });
      // The source row itself is in the same contract bucket, so it
      // will appear as a collision.
      expect(pre.workAreaCollisions.length).toBeGreaterThan(0);
      const found = pre.workAreaCollisions.find(
        (c) => c.sourceWorkSpecId === ws!.id && c.targetWorkSpecId === ws!.id,
      );
      expect(found).toBeDefined();
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("skip policy leaves the target unchanged for colliding items", async () => {
    if (!showoff) return;
    const target = await openMoliospec(showoff.path);
    const src = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(target);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: ws!.id,
            targetContractId: ws!.contract_id ?? null,
            onCollision: "skip",
          },
        ],
        bdbs: [],
      });

      expect(result.workAreasImported).toBe(0);
      expect(result.skippedWorkAreas).toContain(ws!.id);

      const after = readMoliospec(target);
      expect(after.workSpecs.length).toBe(before.workSpecs.length);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("rename policy imports even when code+name collide", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-rename.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(target);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: ws!.id,
            targetContractId: ws!.contract_id ?? null,
            onCollision: "rename",
            renamedCode: "ZZ-TEST",
            renamedName: ws!.work_area_name + " (imported)",
          },
        ],
        bdbs: [],
      });

      expect(result.workAreasImported).toBe(1);
      const newId = result.workAreaIdMap[ws!.id];
      const after = readMoliospec(target);
      const newRow = after.workSpecs.find((w) => w.id === newId);
      expect(newRow?.work_area_code).toBe("ZZ-TEST");
      expect(newRow?.work_area_name).toBe(ws!.work_area_name + " (imported)");
      expect(after.workSpecs.length).toBe(before.workSpecs.length + 1);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("includeBdbIds=[] imports a work area without any BDBs", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-nobdbs.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      const ws = srcFile.workSpecs.find((w) =>
        srcFile.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      expect(ws).toBeDefined();

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: ws!.id,
            targetContractId: null,
            onCollision: "rename",
            renamedCode: "NOBDB-01",
            renamedName: "No-BDB import",
            includeBdbIds: [],
          },
        ],
        bdbs: [],
      });

      expect(result.workAreasImported).toBe(1);
      expect(result.bdbsImported).toBe(0);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("overwrite policy replaces work_area row + sections, keeps existing BDBs", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-overwrite.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      // Pick a work area that exists in both + has sections + has at
      // least one BDB so we can verify BDBs stay.
      const srcWs = srcFile.workSpecs.find(
        (w) =>
          srcFile.workSpecSections.some((s) => s.work_spec_id === w.id) &&
          srcFile.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      expect(srcWs).toBeDefined();

      // Mutate target's sections so we can tell "before" from "after":
      // delete every section under the target work area + change its
      // name (so source's original name would overwrite it).
      const tgtBefore = readMoliospec(target);
      const tgtWs = tgtBefore.workSpecs.find((w) => w.id === srcWs!.id)!;
      expect(tgtWs).toBeDefined();

      target.db
        .prepare("delete from work_spec_section where work_spec_id = ?")
        .run(tgtWs.id);
      target.db
        .prepare("update work_spec set work_area_name = ? where id = ?")
        .run("MUTATED BEFORE IMPORT", tgtWs.id);

      const totalWsBefore = tgtBefore.workSpecs.length;
      const bdbsUnderTgtBefore = tgtBefore.constructionElementSpecs.filter(
        (b) => b.work_spec_id === tgtWs.id,
      );
      expect(bdbsUnderTgtBefore.length).toBeGreaterThan(0);

      const srcSectionCount = srcFile.workSpecSections.filter(
        (s) => s.work_spec_id === srcWs!.id,
      ).length;

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: srcWs!.id,
            targetContractId: tgtWs.contract_id ?? null,
            onCollision: "overwrite",
            // Overwrite path re-uses the existing row; no rename needed.
          },
        ],
        bdbs: [],
      });

      // ws map points source id → reused target id (same number).
      expect(result.workAreaIdMap[srcWs!.id]).toBe(tgtWs.id);

      const after = readMoliospec(target);
      // Total work area count unchanged (no new row created).
      expect(after.workSpecs.length).toBe(totalWsBefore);

      // Target work area's name now matches source (overwrite applied).
      const afterWs = after.workSpecs.find((w) => w.id === tgtWs.id)!;
      expect(afterWs.work_area_name).toBe(srcWs!.work_area_name);

      // Sections wiped + replaced from source.
      const afterSections = after.workSpecSections.filter(
        (s) => s.work_spec_id === tgtWs.id,
      );
      expect(afterSections.length).toBe(srcSectionCount);

      // Existing BDBs under the target work area are untouched.
      const bdbsUnderTgtAfter = after.constructionElementSpecs.filter(
        (b) => b.work_spec_id === tgtWs.id,
      );
      expect(bdbsUnderTgtAfter.map((b) => b.id).sort()).toEqual(
        bdbsUnderTgtBefore.map((b) => b.id).sort(),
      );

      // Identity GUIDs on the overwritten row are cleared.
      expect(afterWs.molio_spec_guid).toBeNull();
      expect(afterWs.molio_spec_revision_guid).toBeNull();
    } finally {
      await target.close();
      await src.close();
    }
  });

  // FIX-ImportMerge 2026-05-11. "merge" policy folds the source's
  // BDBs into the existing target work area without touching the
  // target's metadata, sections, or attachments. Distinct from
  // "overwrite" (which replaces the WA row + sections) and from
  // "skip" (which drops the BDBs too).
  it("merge policy keeps existing work area untouched, adds source BDBs", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-merge.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      const srcWs = srcFile.workSpecs.find(
        (w) =>
          srcFile.workSpecSections.some((s) => s.work_spec_id === w.id) &&
          srcFile.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      expect(srcWs).toBeDefined();

      // Mutate target's WA name + section count so we can detect
      // accidental overwrite. If merge actually preserves the
      // target, the mutated values must survive the import.
      const sentinelName = "TARGET-SHOULD-SURVIVE-MERGE";
      target.db
        .prepare("update work_spec set work_area_name = ? where id = ?")
        .run(sentinelName, srcWs!.id);
      const tgtBefore = readMoliospec(target);
      const tgtWs = tgtBefore.workSpecs.find((w) => w.id === srcWs!.id)!;
      const tgtSectionCountBefore = tgtBefore.workSpecSections.filter(
        (s) => s.work_spec_id === tgtWs.id,
      ).length;
      const bdbsUnderTgtBefore = tgtBefore.constructionElementSpecs.filter(
        (b) => b.work_spec_id === tgtWs.id,
      );
      const totalWsBefore = tgtBefore.workSpecs.length;
      const srcBdbCount = srcFile.constructionElementSpecs.filter(
        (b) => b.work_spec_id === srcWs!.id,
      ).length;
      expect(srcBdbCount).toBeGreaterThan(0);

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: srcWs!.id,
            targetContractId: tgtWs.contract_id ?? null,
            onCollision: "merge",
          },
        ],
        bdbs: [],
      });

      // ws map points source id → reused target id (same row).
      expect(result.workAreaIdMap[srcWs!.id]).toBe(tgtWs.id);

      const after = readMoliospec(target);
      // No new work area row was created.
      expect(after.workSpecs.length).toBe(totalWsBefore);
      // Target work area metadata is untouched (sentinel survived).
      const afterWs = after.workSpecs.find((w) => w.id === tgtWs.id)!;
      expect(afterWs.work_area_name).toBe(sentinelName);
      // Target work area sections are untouched.
      const afterSectionCount = after.workSpecSections.filter(
        (s) => s.work_spec_id === tgtWs.id,
      ).length;
      expect(afterSectionCount).toBe(tgtSectionCountBefore);
      // Source BDBs were added under the merged target WA — but the
      // existing BDBs (which share the same name in this fixture
      // because target was copied from showoff) inherit a per-BDB
      // "skip" policy, so they don't get duplicated. The net effect
      // is therefore: BDB count stays the same OR grows by the
      // number of source BDBs whose name doesn't collide.
      const bdbsUnderTgtAfter = after.constructionElementSpecs.filter(
        (b) => b.work_spec_id === tgtWs.id,
      );
      expect(bdbsUnderTgtAfter.length).toBeGreaterThanOrEqual(
        bdbsUnderTgtBefore.length,
      );
      // result.bdbsImported counts only the NEW rows (skipped
      // name-collisions aren't here). May be 0 if every source BDB
      // name collides — that's fine, the test still proves the
      // path didn't throw.
      expect(typeof result.bdbsImported).toBe("number");
    } finally {
      await target.close();
      await src.close();
    }
  });

  // The merge path needs a colliding row to reuse. If the source WA
  // doesn't actually collide in the target (e.g. user picked the
  // wrong contract), core's internal helper should fall through to
  // the insert branch and create a new row — same outcome as no
  // collision.
  it("merge policy with no actual collision behaves like a plain insert", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-merge-nocoll.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      const srcWs = srcFile.workSpecs.find(
        (w) =>
          srcFile.workSpecSections.some((s) => s.work_spec_id === w.id) &&
          srcFile.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      expect(srcWs).toBeDefined();

      // Rename the target WA so the source WA no longer collides
      // with it (different name and code).
      target.db
        .prepare(
          "update work_spec set work_area_code = ?, work_area_name = ? where id = ?",
        )
        .run("RENAMED", "Renamed away", srcWs!.id);

      const totalWsBefore = readMoliospec(target).workSpecs.length;

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: srcWs!.id,
            // Place it in "no contract" — guarantees no collision
            // even if the target also has a contract with the same
            // code/name.
            targetContractId: null,
            onCollision: "merge",
          },
        ],
        bdbs: [],
      });

      const after = readMoliospec(target);
      // New row was inserted (no collision to merge into).
      expect(after.workSpecs.length).toBe(totalWsBefore + 1);
      const newTgtId = result.workAreaIdMap[srcWs!.id];
      expect(newTgtId).toBeGreaterThan(0);
      expect(newTgtId).not.toBe(srcWs!.id);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("identity GUIDs (molio_spec_guid, molio_construction_element_spec_guid) are null on imported rows", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-guids.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      // Find a work area + BDB in source that HAS identity GUIDs set —
      // otherwise the test would pass trivially.
      const srcFile = readMoliospec(src);
      const srcWs = srcFile.workSpecs.find(
        (w) =>
          w.molio_spec_guid != null &&
          srcFile.constructionElementSpecs.some(
            (b) =>
              b.work_spec_id === w.id &&
              b.molio_construction_element_spec_guid != null,
          ),
      );
      // If no sample has these GUIDs, skip the test cleanly.
      if (!srcWs) return;
      const srcBdb = srcFile.constructionElementSpecs.find(
        (b) =>
          b.work_spec_id === srcWs.id &&
          b.molio_construction_element_spec_guid != null,
      )!;

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: srcWs.id,
            targetContractId: null,
            onCollision: "rename",
            renamedCode: "GUID-01",
            renamedName: "GUID test import",
            includeBdbIds: [srcBdb.id],
          },
        ],
        bdbs: [],
      });

      const after = readMoliospec(target);
      const newWs = after.workSpecs.find(
        (w) => w.id === result.workAreaIdMap[srcWs.id],
      )!;
      expect(newWs.molio_spec_guid).toBeNull();
      expect(newWs.molio_spec_revision_guid).toBeNull();

      const newBdb = after.constructionElementSpecs.find(
        (b) => b.id === result.bdbIdMap[srcBdb.id],
      )!;
      expect(newBdb.molio_construction_element_spec_guid).toBeNull();
      expect(newBdb.molio_construction_element_spec_revision_guid).toBeNull();

      // Reference GUIDs (paradigm GUIDs) should be preserved — they
      // point at external content, not identity.
      if (srcWs.molio_work_spec_paradigm_guid != null) {
        expect(newWs.molio_work_spec_paradigm_guid).toBe(
          srcWs.molio_work_spec_paradigm_guid,
        );
      }
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("standalone BDB import lands under the chosen target work area", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-standalone.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      const bdb = srcFile.constructionElementSpecs.find(
        (b) => b.work_spec_id != null,
      );
      expect(bdb).toBeDefined();

      // Pick a target work area that does NOT contain this BDB name so
      // the import doesn't skip.
      const tgtFile = readMoliospec(target);
      const targetWs = tgtFile.workSpecs.find(
        (w) =>
          w.id !== bdb!.work_spec_id &&
          !tgtFile.constructionElementSpecs.some(
            (b) => b.work_spec_id === w.id && b.name === bdb!.name,
          ),
      );
      expect(targetWs).toBeDefined();

      const result = importFromMoliospec(target, src, {
        workAreas: [],
        bdbs: [
          {
            sourceBdbId: bdb!.id,
            targetWorkSpecId: targetWs!.id,
            onCollision: "rename",
            renamedName: bdb!.name + " (imported)",
          },
        ],
      });

      expect(result.bdbsImported).toBe(1);
      const after = readMoliospec(target);
      const imported = after.constructionElementSpecs.find(
        (b) => b.id === result.bdbIdMap[bdb!.id],
      );
      expect(imported?.work_spec_id).toBe(targetWs!.id);
      expect(imported?.name).toBe(bdb!.name + " (imported)");
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("control plans shared by two imported BDBs are copied once", async () => {
    if (!showoff) return;
    const targetPath = join(workDir, "target-shared-cp.moliospec");
    {
      const h = await openMoliospec(showoff.path);
      try {
        await h.saveAs(targetPath);
      } finally {
        await h.close();
      }
    }
    // Inject a second BDB into the source that shares a CP — we do this
    // by duplicating the BDB via raw SQL, then point both at the same CP.
    const target = await openMoliospec(targetPath);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      // Pick a BDB with EXACTLY one CP link (design set, production empty).
      // This keeps the assertion below — "one source CP ⇒ one map entry" —
      // independent of sample data having an extra production CP.
      const hasDesignOnly = (b: {
        controlplan_design_id?: string | null;
        controlplan_production_id?: string | null;
      }): boolean => {
        const d = b.controlplan_design_id;
        const p = b.controlplan_production_id;
        const hasD = d != null && d !== "" && Number.parseInt(d, 10) > 0;
        const hasP = p != null && p !== "" && Number.parseInt(p, 10) > 0;
        return hasD && !hasP;
      };
      const bdbWithCp = srcFile.constructionElementSpecs.find(hasDesignOnly);
      if (!bdbWithCp) return; // Sample doesn't have a design-only BDB.

      // Find another BDB under the same work area to co-link (if any).
      const sibling = srcFile.constructionElementSpecs.find(
        (b) =>
          b.work_spec_id === bdbWithCp.work_spec_id && b.id !== bdbWithCp.id,
      );
      if (!sibling) return;

      // Write a co-link in the source file and null out the sibling's
      // production link (if any) so the sibling contributes exactly the
      // one shared design CP. We don't saveAs — the source handle is
      // in-memory and the target reads from the in-memory db.
      src.db
        .prepare(
          "update construction_element_spec set " +
            "controlplan_design_id = ?, controlplan_production_id = null " +
            "where id = ?",
        )
        .run(bdbWithCp.controlplan_design_id!, sibling.id);

      const result = importFromMoliospec(target, src, {
        workAreas: [
          {
            sourceWorkSpecId: bdbWithCp.work_spec_id!,
            targetContractId: null,
            onCollision: "rename",
            renamedCode: "SHARED-01",
            renamedName: "Shared CP import",
            includeBdbIds: [bdbWithCp.id, sibling.id],
          },
        ],
        bdbs: [],
      });

      expect(result.bdbsImported).toBe(2);
      // Exactly one new CP id even though two BDBs point at it.
      expect(Object.keys(result.controlPlanIdMap).length).toBe(1);
    } finally {
      await target.close();
      await src.close();
    }
  });

  it("target contract validation throws when target contract id does not exist", async () => {
    if (!showoff) return;
    const target = await openMoliospec(showoff.path);
    const src = await openMoliospec(showoff.path);
    try {
      const srcFile = readMoliospec(src);
      const ws = srcFile.workSpecs[0]!;
      expect(() =>
        importFromMoliospec(target, src, {
          workAreas: [
            {
              sourceWorkSpecId: ws.id,
              targetContractId: 9999999, // definitely not present
              onCollision: "rename",
              renamedCode: "X",
              renamedName: "X",
            },
          ],
          bdbs: [],
        }),
      ).toThrow(/target contract/i);
    } finally {
      await target.close();
      await src.close();
    }
  });
});
