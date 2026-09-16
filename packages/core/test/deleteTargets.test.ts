/**
 * Tests for Slice 6J — delete work area / BDB.
 *
 * Strategy: open a real sample file, read the initial state, pick a
 * specific work area or BDB, optionally seed extra rows (attachments,
 * CP links) with direct SQL so the test has known fixtures, call the
 * delete function, then read back and verify:
 *
 *   - Target row is gone
 *   - Cascaded rows (sections, BDBs, their sections) are gone
 *   - Attachments are ORPHANED (work_spec_id → NULL), not deleted
 *   - Control plans are NOT deleted; they become unlinked (BDB row
 *     that pointed at them no longer exists)
 *   - Returned DeleteSummary counts match what actually happened
 *
 * Uses the Showoff example because it has BDBs with CP links and a
 * healthy mix of sections to exercise the cascade.
 */

import { describe, expect, it } from "vitest";

import {
  deleteBdb,
  deleteWorkArea,
  getDeleteImpact,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const showoff = samples.find((s) => s.label.toLowerCase().includes("showoff"));

describe("deleteWorkArea / deleteBdb (Slice 6J)", () => {
  it("deleteWorkArea removes the work area and its sections atomically", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Pick a work area that actually has sections so we exercise the
      // cascade. Fall back to the first one if none have sections.
      const ws =
        before.workSpecs.find((w) =>
          before.workSpecSections.some((s) => s.work_spec_id === w.id),
        ) ?? before.workSpecs[0];
      expect(ws).toBeDefined();

      const wsSectionsBefore = before.workSpecSections.filter(
        (s) => s.work_spec_id === ws.id,
      ).length;
      const bdbsBefore = before.constructionElementSpecs.filter(
        (b) => b.work_spec_id === ws.id,
      );
      const bdbSectionsBefore = before.constructionElementSpecSections.filter(
        (s) => bdbsBefore.some((b) => b.id === s.construction_element_spec_id),
      ).length;

      const summary = deleteWorkArea(h, { id: ws.id });
      expect(summary.bdbs).toBe(bdbsBefore.length);
      expect(summary.sections).toBe(wsSectionsBefore + bdbSectionsBefore);

      const after = readMoliospec(h);
      // Target work area is gone.
      expect(after.workSpecs.find((w) => w.id === ws.id)).toBeUndefined();
      // None of its sections are left.
      expect(
        after.workSpecSections.filter((s) => s.work_spec_id === ws.id),
      ).toEqual([]);
      // None of its BDBs are left.
      expect(
        after.constructionElementSpecs.filter((b) => b.work_spec_id === ws.id),
      ).toEqual([]);
      // No BDB-section rows point at any of the deleted BDBs.
      const deletedBdbIds = new Set(bdbsBefore.map((b) => b.id));
      expect(
        after.constructionElementSpecSections.filter((s) =>
          deletedBdbIds.has(s.construction_element_spec_id),
        ),
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("deleteWorkArea preserves control plans linked from its BDBs", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Find a work area whose BDBs have at least one CP link.
      const ws = before.workSpecs.find((w) => {
        const wsBdbs = before.constructionElementSpecs.filter(
          (b) => b.work_spec_id === w.id,
        );
        return wsBdbs.some(
          (b) =>
            (b.controlplan_design_id != null &&
              b.controlplan_design_id !== "") ||
            (b.controlplan_production_id != null &&
              b.controlplan_production_id !== ""),
        );
      });
      if (!ws) return; // sample happens to have no linked CPs; skip.

      const cpIdsBefore = new Set(before.controlPlans.map((cp) => cp.id));

      deleteWorkArea(h, { id: ws.id });

      const after = readMoliospec(h);
      // Every CP that existed before still exists — we don't cascade.
      for (const cp of before.controlPlans) {
        expect(after.controlPlans.find((x) => x.id === cp.id)).toBeDefined();
      }
      // No new CPs appeared either.
      for (const cp of after.controlPlans) {
        expect(cpIdsBefore.has(cp.id)).toBe(true);
      }
    } finally {
      await h.close();
    }
  });

  it("deleteWorkArea orphans attachments (work_spec_id → NULL, not deleted)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();

      // Seed an attachment pointing at this work area so the test has a
      // known row to observe. (The sample may not have one with the
      // right work_spec_id.)
      const attachmentInfo = h.db
        .prepare(
          "insert into attachment (mime_type, content, name, work_spec_id, attachment_type_id) " +
            "values (?, ?, ?, ?, ?)",
        )
        .run("application/pdf", Buffer.from("x"), "test.pdf", ws.id, 1);
      const attId = Number(attachmentInfo.lastInsertRowid);

      const summary = deleteWorkArea(h, { id: ws.id });
      expect(summary.attachmentsOrphaned).toBeGreaterThanOrEqual(1);

      const after = readMoliospec(h);
      // The attachment still exists in the file.
      const att = after.attachments.find((a) => a.id === attId);
      expect(att).toBeDefined();
      // But its work_spec_id is NULL now.
      expect(att?.work_spec_id).toBeNull();
    } finally {
      await h.close();
    }
  });

  it("deleteBdb removes the BDB and its sections only", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Pick a BDB that has sections and at least one CP link so we can
      // assert both cascade + CP-preservation in one test.
      const bdb =
        before.constructionElementSpecs.find((b) =>
          before.constructionElementSpecSections.some(
            (s) => s.construction_element_spec_id === b.id,
          ),
        ) ?? before.constructionElementSpecs[0];
      expect(bdb).toBeDefined();

      const sectionsBefore = before.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === bdb.id,
      ).length;

      const summary = deleteBdb(h, { id: bdb.id });
      expect(summary.sections).toBe(sectionsBefore);
      expect(summary.bdbs).toBe(0);

      const after = readMoliospec(h);
      // Target BDB is gone.
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id),
      ).toBeUndefined();
      // Its sections are gone.
      expect(
        after.constructionElementSpecSections.filter(
          (s) => s.construction_element_spec_id === bdb.id,
        ),
      ).toEqual([]);
      // Every CP that existed before still exists.
      for (const cp of before.controlPlans) {
        expect(after.controlPlans.find((x) => x.id === cp.id)).toBeDefined();
      }
    } finally {
      await h.close();
    }
  });

  it("deleteWorkArea throws on unknown id and leaves the DB untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsCountBefore = before.workSpecs.length;

      expect(() => deleteWorkArea(h, { id: 999_999 })).toThrow(
        /no such work area/i,
      );

      const after = readMoliospec(h);
      expect(after.workSpecs.length).toBe(wsCountBefore);
    } finally {
      await h.close();
    }
  });

  it("deleteBdb throws on unknown id and leaves the DB untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const bdbCountBefore = before.constructionElementSpecs.length;

      expect(() => deleteBdb(h, { id: 999_999 })).toThrow(/no such BDB/i);

      const after = readMoliospec(h);
      expect(after.constructionElementSpecs.length).toBe(bdbCountBefore);
    } finally {
      await h.close();
    }
  });

  it("getDeleteImpact mirrors the deleteWorkArea summary (dry run)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();

      const impact = getDeleteImpact(h, { kind: "workArea", id: ws.id });
      // getDeleteImpact itself must not mutate anything.
      const afterDryRun = readMoliospec(h);
      expect(afterDryRun.workSpecs.length).toBe(before.workSpecs.length);
      expect(afterDryRun.constructionElementSpecs.length).toBe(
        before.constructionElementSpecs.length,
      );

      const summary = deleteWorkArea(h, { id: ws.id });
      // Summary from the real delete matches the impact pre-flight.
      expect(summary.bdbs).toBe(impact.bdbs);
      expect(summary.sections).toBe(impact.sections);
      expect(summary.attachmentsOrphaned).toBe(impact.attachmentsOrphaned);
      expect(summary.controlPlansUnlinked).toBe(impact.controlPlansUnlinked);
    } finally {
      await h.close();
    }
  });

  it("getDeleteImpact flags an empty work area as isEmpty", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Create a bare work area with no sections, BDBs, or attachments.
      const info = h.db
        .prepare(
          "insert into work_spec (work_area_code, work_area_name, work_area_type) " +
            "values (?, ?, 0)",
        )
        .run("X99", "Empty test");
      const emptyId = Number(info.lastInsertRowid);

      const impact = getDeleteImpact(h, { kind: "workArea", id: emptyId });
      expect(impact.isEmpty).toBe(true);
      expect(impact.bdbs).toBe(0);
      expect(impact.sections).toBe(0);
      expect(impact.attachmentsOrphaned).toBe(0);
      expect(impact.controlPlansUnlinked).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("getDeleteImpact throws on unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        getDeleteImpact(h, { kind: "workArea", id: 999_999 }),
      ).toThrow(/no such work area/i);
      expect(() => getDeleteImpact(h, { kind: "bdb", id: 999_999 })).toThrow(
        /no such BDB/i,
      );
    } finally {
      await h.close();
    }
  });
});
