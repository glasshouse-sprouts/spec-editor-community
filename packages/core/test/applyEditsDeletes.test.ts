/**
 * Tests for Slice 6M — buffered container deletes routed through
 * `applyEdits`.
 *
 * The renderer used to call `deleteContract` / `deleteWorkArea` /
 * `deleteBdb` directly at click-time. In 6M those ops get buffered in
 * the edit map alongside normal section/row edits, and they fire on
 * Save — i.e. inside `applyEdits`. This file exercises the merged
 * path.
 *
 * Strategy: open a real sample, craft a mixed edit list, call
 * `applyEdits`, then read the state back and verify:
 *   - deletes happened atomically
 *   - updates on rows that then got cascade-deleted are silently
 *     lost (we care about the absence of the row, not the row's
 *     body)
 *   - reassigning a work area then deleting its previous contract
 *     works in one call
 *   - overlapping pending deletes (BDB + its parent workArea) don't
 *     error
 *   - errors mid-transaction leave the DB unchanged
 */

import { describe, expect, it } from "vitest";

import {
  applyEdits,
  createContract,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const showoff = samples.find((s) => s.label.toLowerCase().includes("showoff"));

describe("applyEdits — buffered container deletes (Slice 6M)", () => {
  it("deleteBdb removes the BDB and cascades its sections", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
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

      const result = applyEdits(h, [{ target: "deleteBdb", id: bdb.id }]);
      // We delete N section rows + 1 BDB row.
      expect(result.updated).toBe(sectionsBefore + 1);

      const after = readMoliospec(h);
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id),
      ).toBeUndefined();
      expect(
        after.constructionElementSpecSections.filter(
          (s) => s.construction_element_spec_id === bdb.id,
        ),
      ).toEqual([]);
      // CPs are preserved.
      for (const cp of before.controlPlans) {
        expect(after.controlPlans.find((x) => x.id === cp.id)).toBeDefined();
      }
    } finally {
      await h.close();
    }
  });

  // FIX-DelCpStrike 2026-05-11 — buffered control-plan delete. The
  // renderer routes CP deletes through `applyEdits` now (same as BDB
  // / WA / contract) so the sidebar can show strikethrough + Restore.
  it("deleteControlPlan via applyEdits cascades rows + headers + CP + NULLs BDB slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Find any BDB with at least one attached CP so we can target it.
      const bdb = before.constructionElementSpecs.find(
        (b) =>
          (b.controlplan_design_id != null && b.controlplan_design_id !== "") ||
          (b.controlplan_production_id != null &&
            b.controlplan_production_id !== ""),
      );
      if (!bdb) return;
      const cpIdStr =
        bdb.controlplan_design_id ?? bdb.controlplan_production_id;
      const cpId = Number.parseInt(cpIdStr!, 10);
      expect(Number.isFinite(cpId)).toBe(true);

      applyEdits(h, [{ target: "deleteControlPlan", id: cpId }]);

      const after = readMoliospec(h);
      // CP gone.
      expect(after.controlPlans.find((c) => c.id === cpId)).toBeUndefined();
      // Headers + rows gone.
      expect(
        after.controlPlanSectionHeaders.filter(
          (x) => x.control_plan_id === cpId,
        ),
      ).toEqual([]);
      expect(
        after.controlPlanSections.filter((x) => x.control_plan_id === cpId),
      ).toEqual([]);
      // Owner BDB's slot column is NULL now.
      const owner = after.constructionElementSpecs.find((b) => b.id === bdb.id);
      expect(owner).toBeDefined();
      if (owner!.controlplan_design_id != null) {
        expect(owner!.controlplan_design_id).not.toBe(String(cpId));
      }
      if (owner!.controlplan_production_id != null) {
        expect(owner!.controlplan_production_id).not.toBe(String(cpId));
      }
    } finally {
      await h.close();
    }
  });

  it("deleteControlPlan via applyEdits is a silent no-op for unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Unlike deleteBdb/deleteWorkArea/deleteContract, the buffered
      // CP delete tolerates missing ids — the renderer might race with
      // another path that already removed the row (e.g. parent BDB
      // delete with deleteControlPlans:true that ran in the same
      // transaction). The tolerant `cpStillExists` check skips it.
      const before = readMoliospec(h);
      applyEdits(h, [{ target: "deleteControlPlan", id: 999_999_999 }]);
      const after = readMoliospec(h);
      expect(after.controlPlans.length).toBe(before.controlPlans.length);
    } finally {
      await h.close();
    }
  });

  // FIX-DelBdbCps 2026-05-11 — when the renderer sets
  // `deleteControlPlans: true`, the BDB's attached CPs (rows + headers
  // + CP itself) are removed in the same transaction. Default
  // (omitted/false) preserves the historical behavior.
  it("deleteBdb with deleteControlPlans: true also deletes attached CPs", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Pick a BDB that has at least one CP attached.
      const bdb = before.constructionElementSpecs.find(
        (b) =>
          (b.controlplan_design_id != null && b.controlplan_design_id !== "") ||
          (b.controlplan_production_id != null &&
            b.controlplan_production_id !== ""),
      );
      if (!bdb) return; // sample lacks an attached CP — skip
      const slotIds = [bdb.controlplan_design_id, bdb.controlplan_production_id]
        .filter((x): x is string => x != null && x !== "")
        .map((x) => Number.parseInt(x, 10))
        .filter((n) => Number.isFinite(n));

      applyEdits(h, [
        { target: "deleteBdb", id: bdb.id, deleteControlPlans: true },
      ]);

      const after = readMoliospec(h);
      // BDB gone.
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id),
      ).toBeUndefined();
      // Each attached CP is gone too — including headers and rows
      // (cascade inside the same transaction).
      for (const cpId of slotIds) {
        expect(after.controlPlans.find((c) => c.id === cpId)).toBeUndefined();
        expect(
          after.controlPlanSectionHeaders.find(
            (x) => x.control_plan_id === cpId,
          ),
        ).toBeUndefined();
        expect(
          after.controlPlanSections.find((x) => x.control_plan_id === cpId),
        ).toBeUndefined();
      }
    } finally {
      await h.close();
    }
  });

  it("deleteBdb without flag preserves CPs (default / historical behavior)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const bdb = before.constructionElementSpecs.find(
        (b) =>
          (b.controlplan_design_id != null && b.controlplan_design_id !== "") ||
          (b.controlplan_production_id != null &&
            b.controlplan_production_id !== ""),
      );
      if (!bdb) return;
      const slotIds = [bdb.controlplan_design_id, bdb.controlplan_production_id]
        .filter((x): x is string => x != null && x !== "")
        .map((x) => Number.parseInt(x, 10))
        .filter((n) => Number.isFinite(n));

      // Omit the flag — should be a pure "unlink" (CP rows survive).
      applyEdits(h, [{ target: "deleteBdb", id: bdb.id }]);

      const after = readMoliospec(h);
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id),
      ).toBeUndefined();
      for (const cpId of slotIds) {
        expect(after.controlPlans.find((c) => c.id === cpId)).toBeDefined();
      }
    } finally {
      await h.close();
    }
  });

  it("deleteWorkArea removes the work area and cascades to BDBs + sections", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const ws =
        before.workSpecs.find((w) =>
          before.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
        ) ?? before.workSpecs[0];
      expect(ws).toBeDefined();
      const bdbsBefore = before.constructionElementSpecs.filter(
        (b) => b.work_spec_id === ws.id,
      );

      applyEdits(h, [{ target: "deleteWorkArea", id: ws.id }]);

      const after = readMoliospec(h);
      expect(after.workSpecs.find((w) => w.id === ws.id)).toBeUndefined();
      // All BDBs under it are gone.
      for (const b of bdbsBefore) {
        expect(
          after.constructionElementSpecs.find((x) => x.id === b.id),
        ).toBeUndefined();
      }
      // CPs are preserved.
      for (const cp of before.controlPlans) {
        expect(after.controlPlans.find((x) => x.id === cp.id)).toBeDefined();
      }
    } finally {
      await h.close();
    }
  });

  it("deleteContract removes an unreferenced contract", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Create a fresh contract with no work areas on it.
      const { contractId } = createContract(h, {
        contractCode: "TEST",
        contractName: "Buffered delete",
      });
      const before = readMoliospec(h);
      expect(before.contracts.find((c) => c.id === contractId)).toBeDefined();

      applyEdits(h, [{ target: "deleteContract", id: contractId }]);

      const after = readMoliospec(h);
      expect(after.contracts.find((c) => c.id === contractId)).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("reassignment + contract delete in one call — the reassignment unblocks the delete", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Create two contracts. Put a work area on C1, then in one
      // applyEdits call: reassign WS → C2 and delete C1. Both must
      // succeed in the single transaction.
      const { contractId: c1 } = createContract(h, {
        contractCode: "C1",
        contractName: "one",
      });
      const { contractId: c2 } = createContract(h, {
        contractCode: "C2",
        contractName: "two",
      });
      const before = readMoliospec(h);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();
      // Seed the ws → c1 link first (outside the transaction — we
      // want the scenario to match the user case where ws started
      // on C1).
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: ws.id, contractId: c1 },
      ]);
      expect(
        readMoliospec(h).workSpecs.find((w) => w.id === ws.id)?.contract_id,
      ).toBe(c1);

      // Now the buffered scenario: in a SINGLE applyEdits call,
      // reassign ws → c2 and delete c1.
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: ws.id, contractId: c2 },
        { target: "deleteContract", id: c1 },
      ]);

      const after = readMoliospec(h);
      // c1 is gone.
      expect(after.contracts.find((c) => c.id === c1)).toBeUndefined();
      // ws now points at c2.
      expect(after.workSpecs.find((w) => w.id === ws.id)?.contract_id).toBe(c2);
    } finally {
      await h.close();
    }
  });

  it("deleteContract with lingering refs throws and rolls back everything", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId } = createContract(h, {
        contractCode: "REF",
        contractName: "still referenced",
      });
      const before = readMoliospec(h);
      const ws = before.workSpecs[0];
      expect(ws).toBeDefined();
      // Link ws → contract.
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: ws.id, contractId },
      ]);
      const countsMid = readMoliospec(h);
      expect(
        countsMid.contracts.find((c) => c.id === contractId),
      ).toBeDefined();

      // Attempt to delete in one call with an extra update — both
      // should be rolled back when the delete fails.
      expect(() =>
        applyEdits(h, [
          {
            target: "contractRename",
            id: contractId,
            contractName: "mutated before throw",
          },
          { target: "deleteContract", id: contractId },
        ]),
      ).toThrow(/still referenced/i);

      // Transaction rolled back: the rename did NOT stick.
      const after = readMoliospec(h);
      const c = after.contracts.find((x) => x.id === contractId);
      expect(c).toBeDefined();
      expect(c?.contract_name).toBe("still referenced");
    } finally {
      await h.close();
    }
  });

  it("overlapping deletes — BDB + its parent workArea — do not error", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const ws = before.workSpecs.find((w) =>
        before.constructionElementSpecs.some((b) => b.work_spec_id === w.id),
      );
      if (!ws) return;
      const bdb = before.constructionElementSpecs.find(
        (b) => b.work_spec_id === ws.id,
      );
      expect(bdb).toBeDefined();

      // Both marked for deletion. BDB delete runs first (tolerant),
      // then workArea delete runs (bdb already gone — `delete from
      // construction_element_spec where work_spec_id = ?` returns 0
      // rows and that's fine).
      applyEdits(h, [
        { target: "deleteBdb", id: bdb.id },
        { target: "deleteWorkArea", id: ws.id },
      ]);

      const after = readMoliospec(h);
      expect(after.workSpecs.find((w) => w.id === ws.id)).toBeUndefined();
      expect(
        after.constructionElementSpecs.find((b) => b.id === bdb.id),
      ).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("updates + deletes in the same call — updates run first, edits on cascaded rows are silently lost", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const ws = before.workSpecs.find((w) =>
        before.workSpecSections.some((s) => s.work_spec_id === w.id),
      );
      if (!ws) return;
      const section = before.workSpecSections.find(
        (s) => s.work_spec_id === ws.id,
      );
      expect(section).toBeDefined();

      applyEdits(h, [
        // Body edit on a section that's about to be cascade-deleted.
        {
          target: "workSpec",
          sectionId: section!.id,
          body: "<p>ephemeral</p>",
        },
        { target: "deleteWorkArea", id: ws.id },
      ]);

      // Work area (and its sections) are gone — including the section
      // we "edited". The edit is silently lost, which is the design
      // per the 6M conversation.
      const after = readMoliospec(h);
      expect(after.workSpecs.find((w) => w.id === ws.id)).toBeUndefined();
      expect(
        after.workSpecSections.find((s) => s.id === section!.id),
      ).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("unknown id for a delete throws and leaves the DB untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);

      expect(() =>
        applyEdits(h, [{ target: "deleteBdb", id: 999_999 }]),
      ).toThrow(/no such bdb/i);
      expect(() =>
        applyEdits(h, [{ target: "deleteWorkArea", id: 999_999 }]),
      ).toThrow(/no such work area/i);
      expect(() =>
        applyEdits(h, [{ target: "deleteContract", id: 999_999 }]),
      ).toThrow(/no such contract/i);

      const after = readMoliospec(h);
      expect(after.workSpecs.length).toBe(before.workSpecs.length);
      expect(after.constructionElementSpecs.length).toBe(
        before.constructionElementSpecs.length,
      );
      expect(after.contracts.length).toBe(before.contracts.length);
    } finally {
      await h.close();
    }
  });
});
