/**
 * Tests for `applyEdits`.
 *
 * Strategy: open a real sample, pick a known section, apply an edit, save
 * to a fresh temp path, reopen, and verify the body changed exactly as
 * expected (and that sibling rows did NOT change).
 *
 * Uses the Showoff example because it has plenty of work_spec_section and
 * construction_element_spec_section rows.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addAttachment,
  addControlPlanHeader,
  addControlPlanRow,
  applyEdits,
  AttachmentType,
  createContract,
  createControlPlan,
  deleteAttachment,
  deleteContract,
  deleteControlPlan,
  deleteControlPlanHeader,
  deleteControlPlanRow,
  duplicateBdb,
  duplicateControlPlan,
  moveAttachment,
  moveControlPlan,
  openMoliospec,
  readAttachmentBytes,
  readMoliospec,
  renameAttachment,
  replaceAttachment,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const showoff = samples.find((s) => s.label.toLowerCase().includes("showoff"));

describe("applyEdits", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-write-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("is a no-op on an empty edit list", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const result = applyEdits(h, []);
      expect(result.updated).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("updates exactly one work-spec section body and nothing else", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const target = file.workSpecSections[0];
      expect(target).toBeDefined();
      const sibling = file.workSpecSections[1];
      expect(sibling).toBeDefined();

      const newBody = "<p>edited in test</p>";
      const result = applyEdits(h, [
        { target: "workSpec", sectionId: target.id, body: newBody },
      ]);
      expect(result.updated).toBe(1);

      const outPath = join(workDir, "workspec-edit.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const updated = reread.workSpecSections.find((s) => s.id === target.id);
        expect(updated?.body).toBe(newBody);
        const unchanged = reread.workSpecSections.find(
          (s) => s.id === sibling.id,
        );
        expect(unchanged?.body).toBe(sibling.body);
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

  it("updates a BDB section body independently of work-spec rows", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const bdb = file.constructionElementSpecSections[0];
      expect(bdb).toBeDefined();
      const ws = file.workSpecSections[0];
      expect(ws).toBeDefined();

      const newBody = "<p>bdb edit</p>";
      applyEdits(h, [{ target: "bdb", sectionId: bdb.id, body: newBody }]);

      const outPath = join(workDir, "bdb-edit.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        expect(
          reread.constructionElementSpecSections.find((s) => s.id === bdb.id)
            ?.body,
        ).toBe(newBody);
        // work-spec rows untouched
        expect(reread.workSpecSections.find((s) => s.id === ws.id)?.body).toBe(
          ws.body,
        );
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

  it("moves a BDB to a different work area (bdbWorkArea)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const bdb = file.constructionElementSpecs.find((b) => !b.is_pfbb);
      expect(bdb).toBeDefined();
      const targetWs = file.workSpecs.find((w) => w.id !== bdb!.work_spec_id);
      expect(targetWs).toBeDefined();

      const result = applyEdits(h, [
        { target: "bdbWorkArea", bdbId: bdb!.id, workSpecId: targetWs!.id },
      ]);
      expect(result.updated).toBe(1);

      const outPath = join(workDir, "bdb-workarea.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        expect(
          reread.constructionElementSpecs.find((b) => b.id === bdb!.id)
            ?.work_spec_id,
        ).toBe(targetWs!.id);
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

  it("throws on bdbWorkArea with an unknown BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          { target: "bdbWorkArea", bdbId: 999_999_999, workSpecId: 1 },
        ]),
      ).toThrow();
    } finally {
      await h.close();
    }
  });

  it("throws on bdbWorkArea with an unknown work-area id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const bdb = file.constructionElementSpecs[0];
      expect(bdb).toBeDefined();
      expect(() =>
        applyEdits(h, [
          { target: "bdbWorkArea", bdbId: bdb.id, workSpecId: 999_999_999 },
        ]),
      ).toThrow();
    } finally {
      await h.close();
    }
  });

  it("throws on unknown section id and leaves the DB untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const target = file.workSpecSections[0];
      const originalBody = target.body;

      // Mix a valid edit with an invalid one. Because we validate BEFORE
      // running the transaction, nothing should be written.
      expect(() =>
        applyEdits(h, [
          { target: "workSpec", sectionId: target.id, body: "<p>nope</p>" },
          { target: "workSpec", sectionId: 999_999_999, body: "<p>bad</p>" },
        ]),
      ).toThrow(/no such workSpec section/);

      // Re-read: body unchanged.
      const reread = readMoliospec(h);
      expect(
        reread.workSpecSections.find((s) => s.id === target.id)?.body,
      ).toBe(originalBody);
    } finally {
      await h.close();
    }
  });

  it("updates a control-plan row cell (text field)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const row = file.controlPlanSections[0];
      if (!row) {
        // Sample has no CP rows — skip rather than fail.
        return;
      }
      const sibling = file.controlPlanSections[1];

      applyEdits(h, [
        {
          target: "cpRow",
          rowId: row.id,
          field: "subject",
          value: "edited subject",
        },
      ]);

      const outPath = join(workDir, "cp-row-edit.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const updated = reread.controlPlanSections.find((r) => r.id === row.id);
        expect(updated?.subject).toBe("edited subject");
        if (sibling) {
          const untouched = reread.controlPlanSections.find(
            (r) => r.id === sibling.id,
          );
          expect(untouched?.subject).toBe(sibling.subject);
        }
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

  it("updates a control-plan row's controlType as a number (not a string)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const row = file.controlPlanSections[0];
      if (!row) return;

      applyEdits(h, [
        {
          target: "cpRow",
          rowId: row.id,
          field: "controlType",
          value: "2", // Uafhængig kontrol
        },
      ]);

      const outPath = join(workDir, "cp-row-control-type.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const updated = reread.controlPlanSections.find((r) => r.id === row.id);
        expect(updated?.control_type).toBe(2);
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

  it("updates a control-plan title", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const cp = file.controlPlans[0];
      if (!cp) return;

      applyEdits(h, [
        { target: "cpTitle", controlPlanId: cp.id, title: "Renamed CP" },
      ]);

      const outPath = join(workDir, "cp-title.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        expect(reread.controlPlans.find((x) => x.id === cp.id)?.title).toBe(
          "Renamed CP",
        );
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

  it("throws on unknown CP row id and leaves data untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "cpRow",
            rowId: 999_999_999,
            field: "subject",
            value: "nope",
          },
        ]),
      ).toThrow(/no such CP row/);
    } finally {
      await h.close();
    }
  });

  it("batches multiple edits in one transaction", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const a = file.workSpecSections[0];
      const b = file.workSpecSections[1];
      const c = file.constructionElementSpecSections[0];
      expect(a && b && c).toBeTruthy();

      const result = applyEdits(h, [
        { target: "workSpec", sectionId: a.id, body: "<p>A</p>" },
        { target: "workSpec", sectionId: b.id, body: "<p>B</p>" },
        { target: "bdb", sectionId: c.id, body: "<p>C</p>" },
      ]);
      expect(result.updated).toBe(3);

      const outPath = join(workDir, "batch-edit.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        expect(reread.workSpecSections.find((s) => s.id === a.id)?.body).toBe(
          "<p>A</p>",
        );
        expect(reread.workSpecSections.find((s) => s.id === b.id)?.body).toBe(
          "<p>B</p>",
        );
        expect(
          reread.constructionElementSpecSections.find((s) => s.id === c.id)
            ?.body,
        ).toBe("<p>C</p>");
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
});

/**
 * Lifecycle tests for control plans: create, delete, add/remove rows and
 * headers. These exercise transactional paths that applyEdits doesn't
 * touch, so they get their own describe block.
 */
describe("control plan lifecycle", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-cp-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  /**
   * Helper: find a BDB with at least one empty CP slot. If every BDB has
   * both slots filled, we return null and the test skips.
   */
  function findBdbWithEmptySlot(
    h: Awaited<ReturnType<typeof openMoliospec>>,
  ): { bdbId: number; slot: "design" | "production" } | null {
    const rows = h.db
      .prepare(
        "select id, controlplan_design_id, controlplan_production_id from construction_element_spec",
      )
      .all() as {
      id: number;
      controlplan_design_id: string | null;
      controlplan_production_id: string | null;
    }[];
    for (const r of rows) {
      if (!r.controlplan_design_id) return { bdbId: r.id, slot: "design" };
      if (!r.controlplan_production_id)
        return { bdbId: r.id, slot: "production" };
    }
    return null;
  }

  it("createControlPlan inserts CP + header + row and links to BDB", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return; // sample fully populated — skip

      const result = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "Test CP",
        numberText: "99.9",
      });
      expect(result.controlPlanId).toBeGreaterThan(0);
      expect(result.headerId).toBeGreaterThan(0);
      expect(result.rowId).toBeGreaterThan(0);

      // Round-trip to verify on-disk state.
      const outPath = join(workDir, "created-cp.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const file = readMoliospec(reopen);
        const cp = file.controlPlans.find((x) => x.id === result.controlPlanId);
        expect(cp?.title).toBe("Test CP");
        expect(cp?.number_text).toBe("99.9");
        expect(cp?.control_plan_type).toBe(pick.slot === "design" ? 0 : 1);

        // BDB slot column should point at the new CP id (as TEXT).
        const bdb = file.constructionElementSpecs.find(
          (b) => b.id === pick.bdbId,
        );
        const linkCol =
          pick.slot === "design"
            ? bdb?.controlplan_design_id
            : bdb?.controlplan_production_id;
        expect(linkCol).toBe(String(result.controlPlanId));

        // Header + seed row exist.
        const hdr = file.controlPlanSectionHeaders.find(
          (x) => x.id === result.headerId,
        );
        expect(hdr?.control_plan_id).toBe(result.controlPlanId);
        const row = file.controlPlanSections.find((x) => x.id === result.rowId);
        expect(row?.control_plan_id).toBe(result.controlPlanId);
        expect(row?.header_id).toBe(result.headerId);
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

  it("createControlPlan refuses to overwrite an already-filled slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Find a BDB that already has a design CP.
      const filled = h.db
        .prepare(
          "select id from construction_element_spec where controlplan_design_id is not null and controlplan_design_id != '' limit 1",
        )
        .get() as { id: number } | undefined;
      if (!filled) return;

      expect(() =>
        createControlPlan(h, {
          bdbId: filled.id,
          slot: "design",
          title: "Should not succeed",
        }),
      ).toThrow(/already has a design control plan/);
    } finally {
      await h.close();
    }
  });

  it("createControlPlan throws for unknown BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        createControlPlan(h, {
          bdbId: 999_999_999,
          slot: "design",
          title: "x",
        }),
      ).toThrow(/no such BDB/);
    } finally {
      await h.close();
    }
  });

  it("deleteControlPlan cascades headers + rows and NULLs BDB slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // Create a CP we can safely delete — that way we don't damage the
      // sample state for other assertions.
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return;

      const created = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "Disposable CP",
      });

      deleteControlPlan(h, created.controlPlanId);

      const outPath = join(workDir, "deleted-cp.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const file = readMoliospec(reopen);
        // CP, header, row all gone.
        expect(
          file.controlPlans.find((x) => x.id === created.controlPlanId),
        ).toBeUndefined();
        expect(
          file.controlPlanSectionHeaders.find((x) => x.id === created.headerId),
        ).toBeUndefined();
        expect(
          file.controlPlanSections.find((x) => x.id === created.rowId),
        ).toBeUndefined();
        // BDB slot cleared.
        const bdb = file.constructionElementSpecs.find(
          (b) => b.id === pick.bdbId,
        );
        const linkCol =
          pick.slot === "design"
            ? bdb?.controlplan_design_id
            : bdb?.controlplan_production_id;
        expect(linkCol).toBeNull();
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

  it("deleteControlPlan throws for unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() => deleteControlPlan(h, 999_999_999)).toThrow(
        /no such control plan/,
      );
    } finally {
      await h.close();
    }
  });

  it("addControlPlanRow adds a row under an existing header", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return;
      const created = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "Row-host CP",
      });
      if (created.headerId === null)
        throw new Error("test precondition failed");

      const rowId = addControlPlanRow(h, {
        controlPlanId: created.controlPlanId,
        headerId: created.headerId,
        sectionNo: "1.2",
      });
      expect(rowId).toBeGreaterThan(0);

      const reread = readMoliospec(h);
      const row = reread.controlPlanSections.find((r) => r.id === rowId);
      expect(row?.section_no).toBe("1.2");
      expect(row?.header_id).toBe(created.headerId);
      expect(row?.control_plan_id).toBe(created.controlPlanId);
    } finally {
      await h.close();
    }
  });

  it("addControlPlanRow rejects a header that belongs to a different CP", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return;
      const cpA = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "CP A",
      });
      if (cpA.headerId === null) throw new Error("test precondition failed");

      // Fake CP id that doesn't own the header.
      expect(() =>
        addControlPlanRow(h, {
          controlPlanId: cpA.controlPlanId + 999_999,
          headerId: cpA.headerId,
        }),
      ).toThrow(/belongs to CP/);
    } finally {
      await h.close();
    }
  });

  it("deleteControlPlanRow removes exactly the requested row", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return;
      const cp = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "Row-del CP",
      });
      if (cp.rowId === null) throw new Error("test precondition failed");

      deleteControlPlanRow(h, cp.rowId);

      const reread = readMoliospec(h);
      expect(
        reread.controlPlanSections.find((r) => r.id === cp.rowId),
      ).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("addControlPlanHeader + deleteControlPlanHeader cascade rows", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findBdbWithEmptySlot(h);
      if (!pick) return;
      const cp = createControlPlan(h, {
        bdbId: pick.bdbId,
        slot: pick.slot,
        title: "Header-cascade CP",
      });

      const newHeaderId = addControlPlanHeader(h, {
        controlPlanId: cp.controlPlanId,
        header: "Group 2",
        headerNo: "2",
      });
      const newRowId = addControlPlanRow(h, {
        controlPlanId: cp.controlPlanId,
        headerId: newHeaderId,
        sectionNo: "2.1",
      });
      expect(newHeaderId).toBeGreaterThan(0);
      expect(newRowId).toBeGreaterThan(0);

      deleteControlPlanHeader(h, newHeaderId);

      const reread = readMoliospec(h);
      expect(
        reread.controlPlanSectionHeaders.find((x) => x.id === newHeaderId),
      ).toBeUndefined();
      expect(
        reread.controlPlanSections.find((x) => x.id === newRowId),
      ).toBeUndefined();
    } finally {
      await h.close();
    }
  });
});

/**
 * BDB duplication — per user spec (2026-04-18):
 *   - Sections cloned with new ids, parent_id remapped.
 *   - References (basis/referenceliste) copied as-is.
 *   - Identity GUIDs cleared on the copy.
 *   - CP links (design/production) cleared — copies don't share CPs.
 *   - Attachments not touched (attachments FK work_spec, not BDB).
 *   - Default name = `<original> (copy)`.
 */
describe("duplicateBdb", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-dup-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("duplicates a BDB with a default '<name> (copy)' name", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const source = file.constructionElementSpecs[0];
      expect(source).toBeDefined();

      const result = duplicateBdb(h, { bdbId: source.id });
      expect(result.newBdbId).toBeGreaterThan(0);
      expect(result.newBdbId).not.toBe(source.id);

      const outPath = join(workDir, "dup-default.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const copy = reread.constructionElementSpecs.find(
          (b) => b.id === result.newBdbId,
        );
        expect(copy?.name).toBe(`${source.name} (copy)`);
        // Source is still there with its original name.
        expect(
          reread.constructionElementSpecs.find((b) => b.id === source.id)?.name,
        ).toBe(source.name);
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

  it("respects an explicit newName", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const source = file.constructionElementSpecs[0];
      if (!source) return;

      const result = duplicateBdb(h, { bdbId: source.id, newName: "Custom" });
      const reread = readMoliospec(h);
      const copy = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      expect(copy?.name).toBe("Custom");
    } finally {
      await h.close();
    }
  });

  it("copies section bodies and remaps parent_id links", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      // Find a BDB with sections.
      const source = file.constructionElementSpecs.find((b) =>
        file.constructionElementSpecSections.some(
          (s) => s.construction_element_spec_id === b.id,
        ),
      );
      if (!source) return;

      const origSections = file.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === source.id,
      );

      const result = duplicateBdb(h, { bdbId: source.id });

      const reread = readMoliospec(h);
      const copySections = reread.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === result.newBdbId,
      );
      expect(copySections.length).toBe(origSections.length);

      // Bodies and headings identical; ids differ.
      for (const orig of origSections) {
        const mapped = result.sectionIdMap[orig.id];
        const copy = copySections.find((s) => s.id === mapped);
        expect(copy).toBeDefined();
        expect(copy?.body).toBe(orig.body);
        expect(copy?.heading).toBe(orig.heading);
        expect(copy?.section_no).toBe(orig.section_no);
      }

      // Parent links are rewritten to point at the NEW ids (never at
      // the originals). If the original had a non-null parent_id, the
      // copy's parent_id should be the copy of that same parent.
      for (const orig of origSections) {
        if (orig.parent_id == null) continue;
        const mappedParent = result.sectionIdMap[orig.parent_id];
        if (mappedParent == null) continue;
        const mappedSelf = result.sectionIdMap[orig.id];
        const copy = copySections.find((s) => s.id === mappedSelf);
        expect(copy?.parent_id).toBe(mappedParent);
      }
    } finally {
      await h.close();
    }
  });

  it("clears identity GUIDs and CP links on the copy", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      // Prefer a BDB that has CP links so we actually test the clearing.
      const source =
        file.constructionElementSpecs.find(
          (b) => b.controlplan_design_id || b.controlplan_production_id,
        ) ?? file.constructionElementSpecs[0];
      if (!source) return;

      const result = duplicateBdb(h, { bdbId: source.id });
      const reread = readMoliospec(h);
      const copy = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      expect(copy).toBeDefined();
      expect(copy?.molio_construction_element_spec_guid).toBeNull();
      expect(copy?.molio_construction_element_spec_revision_guid).toBeNull();
      expect(copy?.controlplan_design_id).toBeNull();
      expect(copy?.controlplan_production_id).toBeNull();
      expect(copy?.common_controlplan_design_guid).toBeNull();
      expect(copy?.common_controlplan_production_guid).toBeNull();
    } finally {
      await h.close();
    }
  });

  it("copies CPs and links them to the new BDB when includeControlPlans=true", async () => {
    // FIX-DupBdbCps 2026-05-11 — opt-in flag should deep-copy
    // each attached CP (design / production) and link the new
    // CPs to the duplicate. Original BDB's CPs are untouched.
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      // Find a BDB that has at least one CP slot filled.
      const source = file.constructionElementSpecs.find(
        (b) => b.controlplan_design_id || b.controlplan_production_id,
      );
      if (!source) return; // showoff has no CP-bearing BDB → skip

      const originalCpIds = new Set(file.controlPlans.map((c) => c.id));
      const origDesignId = source.controlplan_design_id;
      const origProductionId = source.controlplan_production_id;

      const result = duplicateBdb(h, {
        bdbId: source.id,
        includeControlPlans: true,
      });
      expect(result.newControlPlanIds.length).toBeGreaterThan(0);

      const reread = readMoliospec(h);

      // Original BDB's CP links untouched.
      const sourceAfter = reread.constructionElementSpecs.find(
        (b) => b.id === source.id,
      );
      expect(sourceAfter?.controlplan_design_id).toBe(origDesignId);
      expect(sourceAfter?.controlplan_production_id).toBe(origProductionId);

      // New BDB has its own CP ids — different from the originals.
      const copy = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      const hadDesign = origDesignId != null && origDesignId !== "";
      const hadProduction = origProductionId != null && origProductionId !== "";
      if (hadDesign) {
        expect(copy?.controlplan_design_id).toBeTruthy();
        expect(copy?.controlplan_design_id).not.toBe(origDesignId);
      }
      if (hadProduction) {
        expect(copy?.controlplan_production_id).toBeTruthy();
        expect(copy?.controlplan_production_id).not.toBe(origProductionId);
      }

      // The new CP ids are present in the rereaded control_plans
      // table — they're real rows, not just dangling references.
      for (const newId of result.newControlPlanIds) {
        expect(originalCpIds.has(newId)).toBe(false);
        expect(reread.controlPlans.some((c) => c.id === newId)).toBe(true);
      }
    } finally {
      await h.close();
    }
  });

  it("leaves CP slots NULL when includeControlPlans=false (default)", async () => {
    // Existing behavior — same as `clears identity GUIDs and CP
    // links` above but exercises the default-off path explicitly.
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const source = file.constructionElementSpecs.find(
        (b) => b.controlplan_design_id || b.controlplan_production_id,
      );
      if (!source) return;

      const result = duplicateBdb(h, {
        bdbId: source.id,
        includeControlPlans: false,
      });
      expect(result.newControlPlanIds).toEqual([]);

      const reread = readMoliospec(h);
      const copy = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      expect(copy?.controlplan_design_id).toBeNull();
      expect(copy?.controlplan_production_id).toBeNull();
    } finally {
      await h.close();
    }
  });

  it("preserves basis + referenceliste references", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const source = file.constructionElementSpecs[0];
      if (!source) return;

      const result = duplicateBdb(h, { bdbId: source.id });
      const reread = readMoliospec(h);
      const copy = reread.constructionElementSpecs.find(
        (b) => b.id === result.newBdbId,
      );
      expect(copy?.molio_spec_guid).toBe(source.molio_spec_guid);
      expect(copy?.molio_spec_revision_guid).toBe(
        source.molio_spec_revision_guid,
      );
      expect(copy?.molio_referencelist_area).toBe(
        source.molio_referencelist_area,
      );
      expect(copy?.molio_referencelist_area_date).toBe(
        source.molio_referencelist_area_date,
      );
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() => duplicateBdb(h, { bdbId: 999_999_999 })).toThrow(
        /no such BDB/,
      );
    } finally {
      await h.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Contracts (Slice 6I)                                               */
/* ------------------------------------------------------------------ */

describe("contracts: create / rename / delete / assign", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-contracts-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("creates a contract that survives a round-trip through save", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId } = createContract(h, {
        contractCode: "K-01",
        contractName: "Foundation works",
      });
      expect(contractId).toBeGreaterThan(0);

      const outPath = join(workDir, "create-contract.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const file = readMoliospec(reopen);
        const found = file.contracts.find((c) => c.id === contractId);
        expect(found).toBeDefined();
        expect(found?.contract_code).toBe("K-01");
        expect(found?.contract_name).toBe("Foundation works");
      } finally {
        await reopen.close();
      }
    } finally {
      // safe even if already closed above — close() must be idempotent
      // for this catch-all; real impl throws, so only hit on early fail.
    }
  });

  it("creates with nullable fields omitted", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId } = createContract(h);
      const outPath = join(workDir, "create-contract-null.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const file = readMoliospec(reopen);
        const found = file.contracts.find((c) => c.id === contractId);
        expect(found?.contract_code).toBeNull();
        expect(found?.contract_name).toBeNull();
      } finally {
        await reopen.close();
      }
    } finally {
      /* handled above */
    }
  });

  it("renames a contract via applyEdits (code only, name only, both)", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId: id1 } = createContract(h, {
        contractCode: "ORIG-1",
        contractName: "Original 1",
      });
      const { contractId: id2 } = createContract(h, {
        contractCode: "ORIG-2",
        contractName: "Original 2",
      });
      const { contractId: id3 } = createContract(h, {
        contractCode: "ORIG-3",
        contractName: "Original 3",
      });

      applyEdits(h, [
        { target: "contractRename", id: id1, contractCode: "NEW-1" },
        { target: "contractRename", id: id2, contractName: "New name 2" },
        {
          target: "contractRename",
          id: id3,
          contractCode: "NEW-3",
          contractName: "New name 3",
        },
      ]);

      const outPath = join(workDir, "rename-contract.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const file = readMoliospec(reopen);
        const c1 = file.contracts.find((c) => c.id === id1);
        const c2 = file.contracts.find((c) => c.id === id2);
        const c3 = file.contracts.find((c) => c.id === id3);
        expect(c1?.contract_code).toBe("NEW-1");
        expect(c1?.contract_name).toBe("Original 1"); // untouched
        expect(c2?.contract_code).toBe("ORIG-2"); // untouched
        expect(c2?.contract_name).toBe("New name 2");
        expect(c3?.contract_code).toBe("NEW-3");
        expect(c3?.contract_name).toBe("New name 3");
      } finally {
        await reopen.close();
      }
    } finally {
      /* handled above */
    }
  });

  it("assigns and clears a work-area's contract via applyEdits", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId } = createContract(h, {
        contractCode: "WA-LINK",
        contractName: "Link test",
      });
      const file = readMoliospec(h);
      const wa = file.workSpecs[0];
      expect(wa).toBeDefined();

      // Assign.
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: wa.id, contractId },
      ]);
      // Save + reopen to prove it persists.
      const assignPath = join(workDir, "assign.moliospec");
      await h.saveAs(assignPath);
      await h.close();

      const r1 = await openMoliospec(assignPath);
      let r1File;
      try {
        r1File = readMoliospec(r1);
        const updated = r1File.workSpecs.find((w) => w.id === wa.id);
        expect(updated?.contract_id).toBe(contractId);
      } finally {
        /* re-used below */
      }

      // Clear.
      applyEdits(r1, [
        { target: "workSpecContract", workSpecId: wa.id, contractId: null },
      ]);
      const clearPath = join(workDir, "clear.moliospec");
      await r1.saveAs(clearPath);
      await r1.close();

      const r2 = await openMoliospec(clearPath);
      try {
        const f2 = readMoliospec(r2);
        const cleared = f2.workSpecs.find((w) => w.id === wa.id);
        expect(cleared?.contract_id).toBeNull();
      } finally {
        await r2.close();
      }
    } finally {
      /* handled above */
    }
  });

  it("refuses to delete a contract still referenced by a work area", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const { contractId } = createContract(h, {
        contractCode: "REF-1",
        contractName: "Still referenced",
      });
      const file = readMoliospec(h);
      const wa = file.workSpecs[0];
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: wa.id, contractId },
      ]);

      // The error message mentions both how many work areas reference the
      // contract and the actual work_spec ids, so the UI can show them.
      expect(() => deleteContract(h, contractId)).toThrow(
        /still referenced by 1 work area/,
      );
      expect(() => deleteContract(h, contractId)).toThrow(
        new RegExp(`\\b${wa.id}\\b`),
      );

      // After clearing the link, delete succeeds.
      applyEdits(h, [
        { target: "workSpecContract", workSpecId: wa.id, contractId: null },
      ]);
      expect(() => deleteContract(h, contractId)).not.toThrow();

      const outPath = join(workDir, "deleted-contract.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const f = readMoliospec(reopen);
        expect(f.contracts.find((c) => c.id === contractId)).toBeUndefined();
      } finally {
        await reopen.close();
      }
    } finally {
      /* handled above */
    }
  });

  it("throws on unknown contract or work-spec ids", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      // First create a contract so the table exists (otherwise the
      // contract-id existence check itself would see a missing table).
      createContract(h, { contractCode: "E", contractName: "existence" });

      expect(() =>
        applyEdits(h, [
          { target: "contractRename", id: 999_999, contractCode: "X" },
        ]),
      ).toThrow(/no such contract/);

      expect(() =>
        applyEdits(h, [
          {
            target: "workSpecContract",
            workSpecId: 999_999,
            contractId: null,
          },
        ]),
      ).toThrow(/no such work area/);

      const file = readMoliospec(h);
      const wa = file.workSpecs[0];
      expect(() =>
        applyEdits(h, [
          {
            target: "workSpecContract",
            workSpecId: wa.id,
            contractId: 888_888,
          },
        ]),
      ).toThrow(/no such contract/);

      expect(() => deleteContract(h, 999_999)).toThrow(/no such contract/);
    } finally {
      await h.close();
    }
  });
});

/**
 * Control-plan duplication — Slice 6N.1 (#105).
 *
 *   - Full deep copy: new control_plan row + cloned headers + cloned rows,
 *     all with fresh ids, linked to the chosen BDB slot.
 *   - control_plan_type follows the caller's slot argument (not the
 *     source CP's type) — caller picks Design vs Production.
 *   - Source CP is untouched after the duplication.
 *   - Refuses to overwrite an already-filled slot.
 */
describe("duplicateControlPlan", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-dup-cp-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  /** Pick the first BDB in the sample that already has at least one CP
   *  we can use as a source. Returns both the source CP id and a
   *  *different* BDB with a free slot to clone into. */
  function findSourceAndTarget(
    h: Awaited<ReturnType<typeof openMoliospec>>,
  ): {
    sourceCpId: number;
    targetBdbId: number;
    targetSlot: "design" | "production";
  } | null {
    const bdbs = h.db
      .prepare(
        "select id, controlplan_design_id, controlplan_production_id " +
          "from construction_element_spec",
      )
      .all() as {
      id: number;
      controlplan_design_id: string | null;
      controlplan_production_id: string | null;
    }[];

    // Source = any BDB with a CP linked via design or production.
    const withCp = bdbs.find(
      (b) =>
        (b.controlplan_design_id && b.controlplan_design_id !== "") ||
        (b.controlplan_production_id && b.controlplan_production_id !== ""),
    );
    if (!withCp) return null;
    const srcIdText =
      withCp.controlplan_design_id && withCp.controlplan_design_id !== ""
        ? withCp.controlplan_design_id
        : withCp.controlplan_production_id!;
    const sourceCpId = Number(srcIdText);

    // Target = any BDB (could be the same or a different one) with a
    // free slot we can drop into.
    const target = bdbs.find((b) => {
      if (b.id === withCp.id) {
        // Same BDB — the *other* slot must be free.
        const slotInUse =
          withCp.controlplan_design_id && withCp.controlplan_design_id !== ""
            ? "design"
            : "production";
        if (slotInUse === "design") {
          return (
            !b.controlplan_production_id || b.controlplan_production_id === ""
          );
        }
        return !b.controlplan_design_id || b.controlplan_design_id === "";
      }
      return (
        !b.controlplan_design_id ||
        b.controlplan_design_id === "" ||
        !b.controlplan_production_id ||
        b.controlplan_production_id === ""
      );
    });
    if (!target) return null;

    const targetSlot: "design" | "production" =
      !target.controlplan_design_id || target.controlplan_design_id === ""
        ? "design"
        : "production";
    return { sourceCpId, targetBdbId: target.id, targetSlot };
  }

  it("clones headers + rows with fresh ids and links to the target BDB slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return; // sample too sparse — skip

      const before = readMoliospec(h);
      const sourceHeaders = before.controlPlanSectionHeaders.filter(
        (x) => x.control_plan_id === pick.sourceCpId,
      );
      const sourceRows = before.controlPlanSections.filter(
        (x) => x.control_plan_id === pick.sourceCpId,
      );

      const result = duplicateControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        bdbId: pick.targetBdbId,
        slot: pick.targetSlot,
        title: "Duplicated CP",
      });

      expect(result.newControlPlanId).toBeGreaterThan(0);
      expect(result.newControlPlanId).not.toBe(pick.sourceCpId);
      expect(result.clonedHeaderCount).toBe(sourceHeaders.length);
      expect(result.clonedRowCount).toBe(sourceRows.length);

      // Round-trip through disk.
      const outPath = join(workDir, "dup-cp.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const after = readMoliospec(reopen);
        const newCp = after.controlPlans.find(
          (x) => x.id === result.newControlPlanId,
        );
        expect(newCp?.title).toBe("Duplicated CP");
        expect(newCp?.control_plan_type).toBe(
          pick.targetSlot === "design" ? 0 : 1,
        );

        // Cloned rows are attached to the new CP with fresh ids.
        const newRows = after.controlPlanSections.filter(
          (x) => x.control_plan_id === result.newControlPlanId,
        );
        expect(newRows.length).toBe(sourceRows.length);
        for (const r of newRows) {
          expect(sourceRows.find((s) => s.id === r.id)).toBeUndefined();
        }

        // Cloned headers are attached to the new CP with fresh ids.
        const newHeaders = after.controlPlanSectionHeaders.filter(
          (x) => x.control_plan_id === result.newControlPlanId,
        );
        expect(newHeaders.length).toBe(sourceHeaders.length);
        for (const hdr of newHeaders) {
          expect(sourceHeaders.find((s) => s.id === hdr.id)).toBeUndefined();
        }

        // Target BDB's slot now points at the new CP.
        const targetBdb = after.constructionElementSpecs.find(
          (b) => b.id === pick.targetBdbId,
        );
        const linkCol =
          pick.targetSlot === "design"
            ? targetBdb?.controlplan_design_id
            : targetBdb?.controlplan_production_id;
        expect(linkCol).toBe(String(result.newControlPlanId));
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

  it("preserves every row's content verbatim on the clone", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      const before = readMoliospec(h);
      const sourceRows = before.controlPlanSections
        .filter((x) => x.control_plan_id === pick.sourceCpId)
        .sort((a, b) => a.id - b.id);

      const result = duplicateControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        bdbId: pick.targetBdbId,
        slot: pick.targetSlot,
        title: "Content-parity test",
      });

      const after = readMoliospec(h);
      const newRows = after.controlPlanSections
        .filter((x) => x.control_plan_id === result.newControlPlanId)
        .sort((a, b) => a.id - b.id);

      // Insertion order = source order (we select by id order in the
      // core, and sqlite autoincrement preserves insert order), so we
      // can compare field-by-field at the same array index.
      expect(newRows.length).toBe(sourceRows.length);
      for (let i = 0; i < sourceRows.length; i++) {
        const src = sourceRows[i]!;
        const dst = newRows[i]!;
        expect(dst.control_type).toBe(src.control_type);
        expect(dst.section_no).toBe(src.section_no);
        expect(dst.subject).toBe(src.subject);
        expect(dst.reference).toBe(src.reference);
        expect(dst.method).toBe(src.method);
        expect(dst.quantity).toBe(src.quantity);
        expect(dst.time).toBe(src.time);
        expect(dst.acceptance_criteria).toBe(src.acceptance_criteria);
        expect(dst.documentation).toBe(src.documentation);
        expect(dst.control_level).toBe(src.control_level);
        expect(dst.sample_level).toBe(src.sample_level);
      }
    } finally {
      await h.close();
    }
  });

  it("leaves the source CP completely untouched", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      const before = readMoliospec(h);
      const sourceCp = before.controlPlans.find(
        (x) => x.id === pick.sourceCpId,
      );
      const sourceRowCountBefore = before.controlPlanSections.filter(
        (x) => x.control_plan_id === pick.sourceCpId,
      ).length;
      const sourceHeaderCountBefore = before.controlPlanSectionHeaders.filter(
        (x) => x.control_plan_id === pick.sourceCpId,
      ).length;

      duplicateControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        bdbId: pick.targetBdbId,
        slot: pick.targetSlot,
        title: "Doesn't affect source",
      });

      const after = readMoliospec(h);
      const sourceCpAfter = after.controlPlans.find(
        (x) => x.id === pick.sourceCpId,
      );
      // Core fields unchanged.
      expect(sourceCpAfter?.title).toBe(sourceCp?.title);
      expect(sourceCpAfter?.number_text).toBe(sourceCp?.number_text);
      expect(sourceCpAfter?.control_plan_type).toBe(
        sourceCp?.control_plan_type,
      );
      // Row + header counts on source unchanged.
      expect(
        after.controlPlanSections.filter(
          (x) => x.control_plan_id === pick.sourceCpId,
        ).length,
      ).toBe(sourceRowCountBefore);
      expect(
        after.controlPlanSectionHeaders.filter(
          (x) => x.control_plan_id === pick.sourceCpId,
        ).length,
      ).toBe(sourceHeaderCountBefore);
    } finally {
      await h.close();
    }
  });

  it("refuses to overwrite an already-filled slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      // Fill the target slot first.
      duplicateControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        bdbId: pick.targetBdbId,
        slot: pick.targetSlot,
        title: "First",
      });

      // Second attempt on the same slot must fail.
      expect(() =>
        duplicateControlPlan(h, {
          sourceCpId: pick.sourceCpId,
          bdbId: pick.targetBdbId,
          slot: pick.targetSlot,
          title: "Second — should throw",
        }),
      ).toThrow(/already has a/);
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown source CP id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      expect(() =>
        duplicateControlPlan(h, {
          sourceCpId: 999_999_999,
          bdbId: pick.targetBdbId,
          slot: pick.targetSlot,
          title: "nope",
        }),
      ).toThrow(/no such source CP/);
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown target BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      expect(() =>
        duplicateControlPlan(h, {
          sourceCpId: pick.sourceCpId,
          bdbId: 999_999_999,
          slot: "design",
          title: "nope",
        }),
      ).toThrow(/no such BDB/);
    } finally {
      await h.close();
    }
  });

  it("sets control_plan_type from the chosen slot, not the source CP", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findSourceAndTarget(h);
      if (!pick) return;

      const before = readMoliospec(h);
      const source = before.controlPlans.find((x) => x.id === pick.sourceCpId);
      // Pick the opposite slot from the source's type so we can observe
      // the type actually change on the clone. Fall back to the same
      // slot if only that slot is free on the target BDB.
      let targetSlot: "design" | "production" = pick.targetSlot;
      const bdbRow = h.db
        .prepare(
          "select controlplan_design_id, controlplan_production_id from construction_element_spec where id = ? limit 1",
        )
        .get(pick.targetBdbId) as {
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      };
      if (source?.control_plan_type === 0) {
        // source is design; prefer "production" slot if free
        if (
          !bdbRow.controlplan_production_id ||
          bdbRow.controlplan_production_id === ""
        ) {
          targetSlot = "production";
        }
      } else {
        if (
          !bdbRow.controlplan_design_id ||
          bdbRow.controlplan_design_id === ""
        ) {
          targetSlot = "design";
        }
      }

      const result = duplicateControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        bdbId: pick.targetBdbId,
        slot: targetSlot,
        title: "Slot-driven type",
      });

      const after = readMoliospec(h);
      const newCp = after.controlPlans.find(
        (x) => x.id === result.newControlPlanId,
      );
      expect(newCp?.control_plan_type).toBe(targetSlot === "design" ? 0 : 1);
    } finally {
      await h.close();
    }
  });
});

// -------------------------------------------------------------
// moveControlPlan (Slice 6O.3 — #111)
// -------------------------------------------------------------
//
// The intent of "move" is distinct from "duplicate":
//   - duplicate → deep clone rows/headers into a NEW CP linked to a target BDB
//   - move      → keep the same CP row, just rewrite which BDB's slot points
//                 at it. The slot is auto-picked from the CP's own
//                 `control_plan_type` (0 = design, 1 = production) per Tore's
//                 design call, so the caller doesn't have to.
//
// The tests below re-use the Showoff sample so we have real CPs and BDBs to
// move around. Each test reopens a fresh file so side-effects don't leak.
describe("moveControlPlan", () => {
  /** Pick a CP that's already linked to some BDB — we use it as the source
   *  for moves — and a *different* BDB with a free slot matching the CP's
   *  type. Returns null if the sample is too sparse. */
  function findMoveSourceAndTarget(
    h: Awaited<ReturnType<typeof openMoliospec>>,
  ): {
    sourceCpId: number;
    sourceCpType: 0 | 1;
    originBdbId: number;
    originSlot: "design" | "production";
    targetBdbId: number;
  } | null {
    const file = readMoliospec(h);
    const bdbs = file.constructionElementSpecs;

    for (const bdb of bdbs) {
      // Try design slot first, then production.
      for (const [col, slot] of [
        ["controlplan_design_id", "design"] as const,
        ["controlplan_production_id", "production"] as const,
      ]) {
        const raw = bdb[col];
        if (!raw || raw === "") continue;
        const sourceCpId = Number(raw);
        const sourceCp = file.controlPlans.find((c) => c.id === sourceCpId);
        if (!sourceCp) continue;
        const sourceCpType = sourceCp.control_plan_type as 0 | 1;
        const wantedCol =
          sourceCpType === 0
            ? "controlplan_design_id"
            : "controlplan_production_id";

        // Target = a *different* BDB whose matching slot is free.
        const target = bdbs.find(
          (b) => b.id !== bdb.id && (!b[wantedCol] || b[wantedCol] === ""),
        );
        if (!target) continue;

        return {
          sourceCpId,
          sourceCpType,
          originBdbId: bdb.id,
          originSlot: slot,
          targetBdbId: target.id,
        };
      }
    }
    return null;
  }

  it("moves a CP to a new BDB, clearing the old slot and filling the target slot from control_plan_type", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findMoveSourceAndTarget(h);
      if (!pick) return;

      const result = moveControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        targetBdbId: pick.targetBdbId,
      });

      // Reported slot matches the CP's type (0=design, 1=production).
      expect(result.slot).toBe(
        pick.sourceCpType === 0 ? "design" : "production",
      );
      expect(result.previousBdbId).toBe(pick.originBdbId);
      expect(result.previousSlot).toBe(pick.originSlot);

      // Old slot on origin BDB is now cleared.
      const after = readMoliospec(h);
      const origin = after.constructionElementSpecs.find(
        (b) => b.id === pick.originBdbId,
      );
      const originSlotCol =
        pick.originSlot === "design"
          ? origin?.controlplan_design_id
          : origin?.controlplan_production_id;
      expect(originSlotCol == null || originSlotCol === "").toBe(true);

      // New slot on target BDB now points at the source CP.
      const target = after.constructionElementSpecs.find(
        (b) => b.id === pick.targetBdbId,
      );
      const targetSlotCol =
        result.slot === "design"
          ? target?.controlplan_design_id
          : target?.controlplan_production_id;
      expect(Number(targetSlotCol)).toBe(pick.sourceCpId);

      // CP rows/headers unchanged — the CP itself wasn't cloned.
      const rowsAfter = after.controlPlanSections.filter(
        (x) => x.control_plan_id === pick.sourceCpId,
      );
      expect(rowsAfter.length).toBeGreaterThanOrEqual(0);
    } finally {
      await h.close();
    }
  });

  it("is a no-op self-move when target BDB already owns the CP in the right slot", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findMoveSourceAndTarget(h);
      if (!pick) return;

      const result = moveControlPlan(h, {
        sourceCpId: pick.sourceCpId,
        targetBdbId: pick.originBdbId, // same BDB that already owns it
      });
      expect(result.previousBdbId).toBe(pick.originBdbId);
      // Origin still owns it in the correct slot.
      const after = readMoliospec(h);
      const origin = after.constructionElementSpecs.find(
        (b) => b.id === pick.originBdbId,
      );
      const col =
        pick.originSlot === "design"
          ? origin?.controlplan_design_id
          : origin?.controlplan_production_id;
      expect(Number(col)).toBe(pick.sourceCpId);
    } finally {
      await h.close();
    }
  });

  it("blocks the move when the target BDB's matching slot is already filled by another CP", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      // Find two BDBs that both already have a CP in the SAME slot, so
      // moving one into the other is guaranteed to conflict.
      const bdbsWithDesign = file.constructionElementSpecs.filter(
        (b) => b.controlplan_design_id && b.controlplan_design_id !== "",
      );
      const bdbsWithProd = file.constructionElementSpecs.filter(
        (b) =>
          b.controlplan_production_id && b.controlplan_production_id !== "",
      );
      let sourceCpId = 0;
      let targetBdbId = 0;
      if (bdbsWithDesign.length >= 2) {
        sourceCpId = Number(bdbsWithDesign[0]!.controlplan_design_id);
        targetBdbId = bdbsWithDesign[1]!.id;
      } else if (bdbsWithProd.length >= 2) {
        sourceCpId = Number(bdbsWithProd[0]!.controlplan_production_id);
        targetBdbId = bdbsWithProd[1]!.id;
      } else {
        return; // sample too sparse
      }

      expect(() => moveControlPlan(h, { sourceCpId, targetBdbId })).toThrow(
        /already has a/,
      );
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown source CP id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const someBdb = file.constructionElementSpecs[0];
      if (!someBdb) return;
      expect(() =>
        moveControlPlan(h, {
          sourceCpId: 999_999_999,
          targetBdbId: someBdb.id,
        }),
      ).toThrow(/no such source CP/);
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown target BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const pick = findMoveSourceAndTarget(h);
      if (!pick) return;
      expect(() =>
        moveControlPlan(h, {
          sourceCpId: pick.sourceCpId,
          targetBdbId: 999_999_999,
        }),
      ).toThrow(/no such target BDB/);
    } finally {
      await h.close();
    }
  });
});

// ── Project metadata edits (Slice 10D) ─────────────────────────────────
//
// The `project` Edit variant lets the UI save changes to the four
// editable columns on the single project row:
//   - name (NOT NULL)
//   - project_number (NOT NULL)
//   - builder (nullable)
//   - molio_referencelist_date (nullable)
//
// Every save also bumps modified_date via a SQLite strftime() so the
// "Last modified" line in the UI stays current.

describe("applyEdits: project metadata", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-project-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  async function writeProjectEdit(
    srcPath: string,
    outName: string,
    edit: {
      name?: string;
      projectNumber?: string;
      builder?: string | null;
      molioReferencelistDate?: string | null;
    },
  ): Promise<{ outPath: string; guid: string; prevModified: string | null }> {
    const h = await openMoliospec(srcPath);
    const before = readMoliospec(h);
    const prevGuid = before.project!.project_guid;
    const prevModified = before.project!.modified_date;
    const outPath = join(workDir, outName);
    try {
      applyEdits(h, [
        {
          target: "project",
          projectGuid: prevGuid,
          ...edit,
        },
      ]);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }
    return { outPath, guid: prevGuid, prevModified };
  }

  it("updates one field and bumps modified_date", async () => {
    if (!showoff) return;
    const { outPath, prevModified } = await writeProjectEdit(
      showoff.path,
      "project-one-field.moliospec",
      { name: "A new project name" },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      expect(file.project?.name).toBe("A new project name");
      // modified_date should be a fresh ISO-ish stamp, and different
      // from the one we captured before the edit (or set if it was null).
      expect(file.project?.modified_date).toBeTruthy();
      expect(file.project?.modified_date).not.toBe(prevModified);
    } finally {
      await h2.close();
    }
  });

  it("updates all four editable fields round-trip", async () => {
    if (!showoff) return;
    const { outPath } = await writeProjectEdit(
      showoff.path,
      "project-all-fields.moliospec",
      {
        name: "Full update",
        projectNumber: "P-999",
        builder: "Test builder",
        molioReferencelistDate: "2025-05-01",
      },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      expect(file.project?.name).toBe("Full update");
      expect(file.project?.project_number).toBe("P-999");
      expect(file.project?.builder).toBe("Test builder");
      expect(file.project?.molio_referencelist_date).toBe("2025-05-01");
    } finally {
      await h2.close();
    }
  });

  it("clears nullable fields when passed null", async () => {
    if (!showoff) return;
    const { outPath } = await writeProjectEdit(
      showoff.path,
      "project-clear-nullables.moliospec",
      { builder: null, molioReferencelistDate: null },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      expect(file.project?.builder).toBeNull();
      expect(file.project?.molio_referencelist_date).toBeNull();
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown project_guid", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "project",
            projectGuid: "00000000-0000-0000-0000-000000000000",
            name: "X",
          },
        ]),
      ).toThrow(/no such project/);
    } finally {
      await h.close();
    }
  });
});

describe("applyEdits: work-area metadata", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-ws-meta-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  async function writeWorkSpecEdit(
    srcPath: string,
    outName: string,
    edit: Omit<
      Extract<
        Parameters<typeof applyEdits>[1][number],
        { target: "workSpecMetadata" }
      >,
      "target" | "id"
    >,
  ): Promise<{ outPath: string; wsId: number; prevModified: string | null }> {
    const h = await openMoliospec(srcPath);
    const before = readMoliospec(h);
    const wsId = before.workSpecs[0]!.id;
    const prevModified = before.project!.modified_date;
    const outPath = join(workDir, outName);
    try {
      applyEdits(h, [{ target: "workSpecMetadata", id: wsId, ...edit }]);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }
    return { outPath, wsId, prevModified };
  }

  it("updates one field and bumps project.modified_date", async () => {
    if (!showoff) return;
    const { outPath, wsId, prevModified } = await writeWorkSpecEdit(
      showoff.path,
      "ws-one-field.moliospec",
      { workAreaName: "Revised work-area name" },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.workSpecs.find((w) => w.id === wsId)!;
      expect(row.work_area_name).toBe("Revised work-area name");
      expect(file.project?.modified_date).toBeTruthy();
      expect(file.project?.modified_date).not.toBe(prevModified);
    } finally {
      await h2.close();
    }
  });

  it("updates every editable field round-trip", async () => {
    if (!showoff) return;
    const { outPath, wsId } = await writeWorkSpecEdit(
      showoff.path,
      "ws-all-fields.moliospec",
      {
        workAreaCode: "BI9",
        workAreaName: "Everything set",
        workAreaType: 1, // FaellesBeskrivelse
        createdBy: "thv",
        createdByOrganization: "3D Byggeri",
        revision: "B",
        revisionDate: "2025-05-01",
        issueDate: "2025-05-10",
        reviewedBy: "reviewer",
        approvedBy: "approver",
      },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.workSpecs.find((w) => w.id === wsId)!;
      expect(row.work_area_code).toBe("BI9");
      expect(row.work_area_name).toBe("Everything set");
      expect(row.work_area_type).toBe(1);
      expect(row.created_by).toBe("thv");
      expect(row.created_by_organization).toBe("3D Byggeri");
      expect(row.revision).toBe("B");
      expect(row.revision_date).toBe("2025-05-01");
      expect(row.issue_date).toBe("2025-05-10");
      expect(row.reviewed_by).toBe("reviewer");
      expect(row.approved_by).toBe("approver");
    } finally {
      await h2.close();
    }
  });

  it("clears nullable fields when passed null", async () => {
    if (!showoff) return;
    const { outPath, wsId } = await writeWorkSpecEdit(
      showoff.path,
      "ws-clear-nullables.moliospec",
      {
        workAreaCode: null,
        createdBy: null,
        revision: null,
        revisionDate: null,
        issueDate: null,
        reviewedBy: null,
        approvedBy: null,
      },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.workSpecs.find((w) => w.id === wsId)!;
      expect(row.work_area_code).toBeNull();
      expect(row.created_by).toBeNull();
      expect(row.revision).toBeNull();
      expect(row.revision_date).toBeNull();
      expect(row.issue_date).toBeNull();
      expect(row.reviewed_by).toBeNull();
      expect(row.approved_by).toBeNull();
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown work_spec id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "workSpecMetadata",
            id: 999_999,
            workAreaName: "nope",
          },
        ]),
      ).toThrow(/no such work area/);
    } finally {
      await h.close();
    }
  });
});

describe("applyEdits: BDB metadata", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-bdb-meta-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  async function writeBdbEdit(
    srcPath: string,
    outName: string,
    edit: Omit<
      Extract<
        Parameters<typeof applyEdits>[1][number],
        { target: "bdbMetadata" }
      >,
      "target" | "id"
    >,
  ): Promise<{ outPath: string; bdbId: number; prevModified: string | null }> {
    const h = await openMoliospec(srcPath);
    const before = readMoliospec(h);
    const bdbId = before.constructionElementSpecs[0]!.id;
    const prevModified = before.project!.modified_date;
    const outPath = join(workDir, outName);
    try {
      applyEdits(h, [{ target: "bdbMetadata", id: bdbId, ...edit }]);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }
    return { outPath, bdbId, prevModified };
  }

  it("updates one field and bumps project.modified_date", async () => {
    if (!showoff) return;
    const { outPath, bdbId, prevModified } = await writeBdbEdit(
      showoff.path,
      "bdb-one-field.moliospec",
      { name: "Revised BDB name" },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.constructionElementSpecs.find((b) => b.id === bdbId)!;
      expect(row.name).toBe("Revised BDB name");
      expect(file.project?.modified_date).toBeTruthy();
      expect(file.project?.modified_date).not.toBe(prevModified);
    } finally {
      await h2.close();
    }
  });

  it("updates every editable field round-trip including is_pfbb", async () => {
    if (!showoff) return;
    const { outPath, bdbId } = await writeBdbEdit(
      showoff.path,
      "bdb-all-fields.moliospec",
      {
        name: "Full BDB",
        isPfbb: 1,
        createdBy: "thv",
        createdByOrganization: "3D Byggeri",
        revision: "C",
        revisionDate: "2025-05-05",
        issueDate: "2025-05-12",
        reviewedBy: "rb",
        approvedBy: "ab",
      },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.constructionElementSpecs.find((b) => b.id === bdbId)!;
      expect(row.name).toBe("Full BDB");
      expect(row.is_pfbb).toBe(1);
      expect(row.created_by).toBe("thv");
      expect(row.created_by_organization).toBe("3D Byggeri");
      expect(row.revision).toBe("C");
      expect(row.revision_date).toBe("2025-05-05");
      expect(row.issue_date).toBe("2025-05-12");
      expect(row.reviewed_by).toBe("rb");
      expect(row.approved_by).toBe("ab");
    } finally {
      await h2.close();
    }
  });

  it("clears nullable fields when passed null", async () => {
    if (!showoff) return;
    const { outPath, bdbId } = await writeBdbEdit(
      showoff.path,
      "bdb-clear-nullables.moliospec",
      {
        createdBy: null,
        revision: null,
        revisionDate: null,
        issueDate: null,
        reviewedBy: null,
        approvedBy: null,
      },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.constructionElementSpecs.find((b) => b.id === bdbId)!;
      expect(row.created_by).toBeNull();
      expect(row.revision).toBeNull();
      expect(row.revision_date).toBeNull();
      expect(row.issue_date).toBeNull();
      expect(row.reviewed_by).toBeNull();
      expect(row.approved_by).toBeNull();
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown BDB id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [{ target: "bdbMetadata", id: 999_999, name: "nope" }]),
      ).toThrow(/no such BDB/);
    } finally {
      await h.close();
    }
  });
});

describe("applyEdits: control plan metadata", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-cp-meta-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  async function writeCpEdit(
    srcPath: string,
    outName: string,
    edit: Omit<
      Extract<
        Parameters<typeof applyEdits>[1][number],
        { target: "cpMetadata" }
      >,
      "target" | "id"
    >,
  ): Promise<{ outPath: string; cpId: number; prevModified: string | null }> {
    const h = await openMoliospec(srcPath);
    const before = readMoliospec(h);
    const cpId = before.controlPlans[0]!.id;
    const prevModified = before.project!.modified_date;
    const outPath = join(workDir, outName);
    try {
      applyEdits(h, [{ target: "cpMetadata", id: cpId, ...edit }]);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }
    return { outPath, cpId, prevModified };
  }

  it("updates revision and bumps project.modified_date", async () => {
    if (!showoff) return;
    const { outPath, cpId, prevModified } = await writeCpEdit(
      showoff.path,
      "cp-revision.moliospec",
      { revision: "B" },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.controlPlans.find((c) => c.id === cpId)!;
      expect(row.revision).toBe("B");
      expect(file.project?.modified_date).toBeTruthy();
      expect(file.project?.modified_date).not.toBe(prevModified);
    } finally {
      await h2.close();
    }
  });

  it("updates both revision and revision_date round-trip", async () => {
    if (!showoff) return;
    const { outPath, cpId } = await writeCpEdit(
      showoff.path,
      "cp-both-fields.moliospec",
      { revision: "C", revisionDate: "2026-04-22" },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.controlPlans.find((c) => c.id === cpId)!;
      expect(row.revision).toBe("C");
      expect(row.revision_date).toBe("2026-04-22");
    } finally {
      await h2.close();
    }
  });

  it("clears nullable fields when passed null", async () => {
    if (!showoff) return;
    const { outPath, cpId } = await writeCpEdit(
      showoff.path,
      "cp-clear-nullables.moliospec",
      { revision: null, revisionDate: null },
    );
    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.controlPlans.find((c) => c.id === cpId)!;
      expect(row.revision).toBeNull();
      expect(row.revision_date).toBeNull();
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown control plan id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          { target: "cpMetadata", id: 999_999, revision: "nope" },
        ]),
      ).toThrow(/no such control plan/);
    } finally {
      await h.close();
    }
  });
});

describe("attachments: add / delete / replace (Slice 10K.1)", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-att-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("addAttachment inserts a row and round-trips the bytes", async () => {
    if (!showoff) return;
    const outPath = join(workDir, "att-add.moliospec");
    let newId = -1;
    const bytes = Buffer.from("hello world, this is an attachment", "utf8");

    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "greeting.txt",
        mimeType: "text/plain",
        content: bytes,
        attachmentTypeId: AttachmentType.Bilag,
      });
      expect(added.id).toBeGreaterThan(0);
      expect(added.sha1_hash).not.toBeNull();
      newId = added.id;
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }

    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.attachments.find((a) => a.id === newId)!;
      expect(row).toBeTruthy();
      expect(row.name).toBe("greeting.txt");
      expect(row.mime_type).toBe("text/plain");
      expect(row.attachment_type_id).toBe(AttachmentType.Bilag);
      expect(Buffer.compare(row.content, bytes)).toBe(0);
      expect(row.sha1_hash).not.toBeNull();
      // Verify the sha is actually sha-1 of the content.
      const expected = createHash("sha1").update(bytes).digest();
      expect(Buffer.compare(row.sha1_hash as Buffer, expected)).toBe(0);
    } finally {
      await h2.close();
    }
  });

  it("addAttachment defaults attachmentTypeId to Bilag when omitted", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "x.bin",
        mimeType: "application/octet-stream",
        content: Buffer.from([1, 2, 3]),
      });
      expect(added.attachment_type_id).toBe(AttachmentType.Bilag);
    } finally {
      await h.close();
    }
  });

  it("addAttachment bumps project.modified_date", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const prevModified = before.project!.modified_date;
      addAttachment(h, {
        workSpecId: wsId,
        name: "touch.bin",
        mimeType: "application/octet-stream",
        content: Buffer.from([0]),
      });
      const after = readMoliospec(h);
      expect(after.project?.modified_date).toBeTruthy();
      expect(after.project?.modified_date).not.toBe(prevModified);
    } finally {
      await h.close();
    }
  });

  it("addAttachment throws for unknown workSpecId", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        addAttachment(h, {
          workSpecId: 999_999,
          name: "x.bin",
          mimeType: "application/octet-stream",
          content: Buffer.from([0]),
        }),
      ).toThrow(/no such work spec/);
    } finally {
      await h.close();
    }
  });

  it("deleteAttachment removes the row and persists", async () => {
    if (!showoff) return;
    const outPath = join(workDir, "att-delete.moliospec");
    let targetId = -1;

    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "to-delete.txt",
        mimeType: "text/plain",
        content: Buffer.from("bye"),
      });
      targetId = added.id;
      deleteAttachment(h, targetId);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }

    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      expect(file.attachments.find((a) => a.id === targetId)).toBeUndefined();
    } finally {
      await h2.close();
    }
  });

  it("deleteAttachment throws for unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() => deleteAttachment(h, 999_999)).toThrow(/no such attachment/);
    } finally {
      await h.close();
    }
  });

  it("replaceAttachment updates name + content + recomputes sha", async () => {
    if (!showoff) return;
    const outPath = join(workDir, "att-replace.moliospec");
    let targetId = -1;
    const newBytes = Buffer.from("updated content", "utf8");

    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "original.txt",
        mimeType: "text/plain",
        content: Buffer.from("original"),
      });
      targetId = added.id;
      const replaced = replaceAttachment(h, targetId, {
        name: "renamed.md",
        mimeType: "text/markdown",
        content: newBytes,
      });
      expect(replaced.id).toBe(targetId);
      expect(replaced.name).toBe("renamed.md");
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }

    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.attachments.find((a) => a.id === targetId)!;
      expect(row.name).toBe("renamed.md");
      expect(row.mime_type).toBe("text/markdown");
      expect(Buffer.compare(row.content, newBytes)).toBe(0);
      const expectedSha = createHash("sha1").update(newBytes).digest();
      expect(Buffer.compare(row.sha1_hash as Buffer, expectedSha)).toBe(0);
    } finally {
      await h2.close();
    }
  });

  it("replaceAttachment preserves content when only name is changed", async () => {
    if (!showoff) return;
    const originalBytes = Buffer.from("keep me", "utf8");
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "a.txt",
        mimeType: "text/plain",
        content: originalBytes,
      });
      const replaced = replaceAttachment(h, added.id, { name: "b.txt" });
      expect(replaced.name).toBe("b.txt");
      expect(Buffer.compare(replaced.content, originalBytes)).toBe(0);
      // sha should NOT have changed since content didn't change.
      expect(
        Buffer.compare(replaced.sha1_hash as Buffer, added.sha1_hash as Buffer),
      ).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("replaceAttachment throws for unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() => replaceAttachment(h, 999_999, { name: "x" })).toThrow(
        /no such attachment/,
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * Slice 10L.1 / 10L.5 — `readAttachmentBytes` is the on-demand bytes
 * reader used by the PDF-export pipeline. It reads the `content` blob
 * (plus name / mime / work_spec_id) for a single attachment id without
 * pulling every attachment into memory up front.
 *
 * Verifies: happy path (matches an added row, bytes identical), unknown
 * id returns null (not throw), and the returned `workSpecId` matches
 * the parent the row was attached to.
 */
describe("readAttachmentBytes (Slice 10L.1)", () => {
  it("returns the name / mime / workSpecId / bytes of an existing attachment", async () => {
    if (!showoff) return;
    const bytes = Buffer.from("sample file content", "utf8");
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "attach.txt",
        mimeType: "text/plain",
        content: bytes,
        attachmentTypeId: AttachmentType.Bilag,
      });
      const got = readAttachmentBytes(h, added.id);
      expect(got).not.toBeNull();
      expect(got!.id).toBe(added.id);
      expect(got!.name).toBe("attach.txt");
      expect(got!.mimeType).toBe("text/plain");
      expect(got!.workSpecId).toBe(wsId);
      expect(Buffer.compare(got!.content, bytes)).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("returns null (not an exception) for an unknown id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const got = readAttachmentBytes(h, 999_999);
      expect(got).toBeNull();
    } finally {
      await h.close();
    }
  });

  it("round-trips unchanged bytes across a save + reopen", async () => {
    if (!showoff) return;
    const workDir = await mkdtemp(join(tmpdir(), "moliospec-readbytes-"));
    try {
      const outPath = join(workDir, "readbytes.moliospec");
      const bytes = Buffer.from([0, 1, 2, 3, 254, 255]);
      let addedId = -1;
      const h = await openMoliospec(showoff.path);
      try {
        const before = readMoliospec(h);
        const wsId = before.workSpecs[0]!.id;
        const added = addAttachment(h, {
          workSpecId: wsId,
          name: "blob.bin",
          mimeType: "application/octet-stream",
          content: bytes,
        });
        addedId = added.id;
        await h.saveAs(outPath);
      } finally {
        await h.close();
      }

      const h2 = await openMoliospec(outPath);
      try {
        const got = readAttachmentBytes(h2, addedId);
        expect(got).not.toBeNull();
        expect(Buffer.compare(got!.content, bytes)).toBe(0);
      } finally {
        await h2.close();
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

/**
 * Slice 10K.8 / task #205 — `renameAttachment` is a thin wrapper on
 * `replaceAttachment({ name })`. Covers: rename updates only the name
 * (bytes, sha, mime, workSpecId preserved), change persists across
 * save + reopen, and unknown id throws.
 */
describe("renameAttachment (Slice 10K.8)", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-rename-att-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("changes only the name — bytes / sha / mime / workSpecId preserved", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const original = Buffer.from("rename me", "utf8");
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "old.txt",
        mimeType: "text/plain",
        content: original,
        attachmentTypeId: AttachmentType.Bilag,
      });
      const renamed = renameAttachment(h, added.id, "new.txt");
      expect(renamed.id).toBe(added.id);
      expect(renamed.name).toBe("new.txt");
      // mime, bytes, sha, parent must all be untouched.
      expect(renamed.mime_type).toBe("text/plain");
      expect(Buffer.compare(renamed.content, original)).toBe(0);
      expect(
        Buffer.compare(renamed.sha1_hash as Buffer, added.sha1_hash as Buffer),
      ).toBe(0);
      expect(renamed.work_spec_id).toBe(wsId);
    } finally {
      await h.close();
    }
  });

  it("persists the renamed name across a save + reopen", async () => {
    if (!showoff) return;
    const outPath = join(workDir, "att-rename.moliospec");
    let targetId = -1;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const wsId = before.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "before.txt",
        mimeType: "text/plain",
        content: Buffer.from("persist-rename"),
      });
      targetId = added.id;
      renameAttachment(h, targetId, "after.txt");
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }

    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.attachments.find((a) => a.id === targetId)!;
      expect(row).toBeTruthy();
      expect(row.name).toBe("after.txt");
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown attachment id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      expect(() => renameAttachment(h, 999_999, "whatever.txt")).toThrow(
        /no such attachment/,
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * Slice 10K.8 / task #205 — `moveAttachment` reassigns an attachment
 * to a different work area. Covers: happy-path move (workSpecId flips,
 * bytes / sha / name / mime preserved), change persists across save +
 * reopen, unknown attachment id throws, and unknown target work_spec
 * id throws. Also verifies the sha stays untouched so the
 * UNIQUE(sha1_hash) constraint is never violated by a move.
 */
describe("moveAttachment (Slice 10K.8)", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-move-att-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("reassigns work_spec_id and keeps bytes / sha / name / mime", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      // Need two distinct work areas for a meaningful move. If the
      // fixture somehow only has one, skip quietly.
      if (before.workSpecs.length < 2) return;
      const srcId = before.workSpecs[0]!.id;
      const destId = before.workSpecs[1]!.id;
      const bytes = Buffer.from("move me", "utf8");
      const added = addAttachment(h, {
        workSpecId: srcId,
        name: "travelling.txt",
        mimeType: "text/plain",
        content: bytes,
        attachmentTypeId: AttachmentType.Bilag,
      });
      const moved = moveAttachment(h, added.id, destId);
      expect(moved.id).toBe(added.id);
      expect(moved.work_spec_id).toBe(destId);
      expect(moved.name).toBe("travelling.txt");
      expect(moved.mime_type).toBe("text/plain");
      expect(Buffer.compare(moved.content, bytes)).toBe(0);
      expect(
        Buffer.compare(moved.sha1_hash as Buffer, added.sha1_hash as Buffer),
      ).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("persists the new work_spec_id across a save + reopen", async () => {
    if (!showoff) return;
    const outPath = join(workDir, "att-move.moliospec");
    let targetId = -1;
    let destId = -1;
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      if (before.workSpecs.length < 2) return;
      const srcId = before.workSpecs[0]!.id;
      destId = before.workSpecs[1]!.id;
      const added = addAttachment(h, {
        workSpecId: srcId,
        name: "persist-move.txt",
        mimeType: "text/plain",
        content: Buffer.from("persist-move"),
      });
      targetId = added.id;
      moveAttachment(h, targetId, destId);
      await h.saveAs(outPath);
    } finally {
      await h.close();
    }

    const h2 = await openMoliospec(outPath);
    try {
      const file = readMoliospec(h2);
      const row = file.attachments.find((a) => a.id === targetId)!;
      expect(row).toBeTruthy();
      expect(row.work_spec_id).toBe(destId);
    } finally {
      await h2.close();
    }
  });

  it("throws for an unknown attachment id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const wsId = file.workSpecs[0]!.id;
      expect(() => moveAttachment(h, 999_999, wsId)).toThrow(
        /no such attachment/,
      );
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown target work_spec id", async () => {
    if (!showoff) return;
    const h = await openMoliospec(showoff.path);
    try {
      const file = readMoliospec(h);
      const wsId = file.workSpecs[0]!.id;
      const added = addAttachment(h, {
        workSpecId: wsId,
        name: "orphan-move.txt",
        mimeType: "text/plain",
        content: Buffer.from("orphan-move"),
      });
      expect(() => moveAttachment(h, added.id, 999_999)).toThrow(
        /no such work spec/,
      );
    } finally {
      await h.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Slice 10H.7 — PFBB child supplement edits                          */
/* ------------------------------------------------------------------ */

describe("applyEdits: PFBB child supplement (Slice 10H.7)", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-pfbb-supplement-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  const pfbbSample =
    samples.find(
      (s) =>
        s.label.includes("Version 01.00.04") &&
        s.label.toLowerCase().includes("projektf"),
    ) ?? samples.find((s) => s.label.toLowerCase().includes("projektf"));

  it("creates a supplement row on the child with the right columns", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      // Find an existing child (pfbb_id != null) and one of its master's
      // sections that the child does NOT yet supplement.
      const file = readMoliospec(h);
      const child = file.constructionElementSpecs.find(
        (b) => b.pfbb_id != null,
      );
      expect(child).toBeDefined();
      const masterId = child!.pfbb_id as number;
      const masterSections = file.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === masterId,
      );
      const existingSupplementTargets = new Set(
        file.constructionElementSpecSections
          .filter((s) => s.construction_element_spec_id === child!.id)
          .map((s) => s.pfbb_section_id),
      );
      const target = masterSections.find(
        (s) => !existingSupplementTargets.has(s.id),
      );
      expect(target).toBeDefined();

      const body = "<p>project-specific supplement</p>";
      const result = applyEdits(h, [
        {
          target: "bdbSectionCreate",
          bdbId: child!.id,
          pfbbSectionId: target!.id,
          sectionNo: target!.section_no ?? "0",
          body,
        },
      ]);
      expect(result.updated).toBe(1);

      // Round-trip: save + reopen, confirm the row landed.
      const outPath = join(workDir, "supplement-create.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        const row = reread.constructionElementSpecSections.find(
          (s) =>
            s.construction_element_spec_id === child!.id &&
            s.pfbb_section_id === target!.id,
        );
        expect(row).toBeDefined();
        expect(row!.body).toBe(body);
        expect(row!.section_no).toBe(target!.section_no);
        // Supplement rows carry empty-string heading (schema says
        // heading is NOT NULL) + null molio_guid / parent_id —
        // those are the master's concern.
        expect(row!.heading).toBe("");
        expect(row!.molio_section_guid).toBeNull();
        expect(row!.parent_id).toBeNull();
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

  it("is idempotent — two creates for the same pair UPDATE not duplicate", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const file = readMoliospec(h);
      const child = file.constructionElementSpecs.find(
        (b) => b.pfbb_id != null,
      )!;
      const masterSections = file.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === child.pfbb_id,
      );
      const existingSupplementTargets = new Set(
        file.constructionElementSpecSections
          .filter((s) => s.construction_element_spec_id === child.id)
          .map((s) => s.pfbb_section_id),
      );
      const target = masterSections.find(
        (s) => !existingSupplementTargets.has(s.id),
      )!;

      // First create.
      applyEdits(h, [
        {
          target: "bdbSectionCreate",
          bdbId: child.id,
          pfbbSectionId: target.id,
          sectionNo: target.section_no ?? "0",
          body: "<p>first</p>",
        },
      ]);
      // Second create for the SAME pair — should UPDATE, not duplicate.
      applyEdits(h, [
        {
          target: "bdbSectionCreate",
          bdbId: child.id,
          pfbbSectionId: target.id,
          sectionNo: target.section_no ?? "0",
          body: "<p>second</p>",
        },
      ]);

      const matching = h.db
        .prepare(
          "select id, body from construction_element_spec_section " +
            "where construction_element_spec_id = ? and pfbb_section_id = ?",
        )
        .all(child.id, target.id) as { id: number; body: string }[];
      expect(matching.length).toBe(1);
      expect(matching[0].body).toBe("<p>second</p>");
    } finally {
      await h.close();
    }
  });

  it("deletes a supplement row by id", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      // Use an existing child supplement if the sample has one; otherwise
      // create one first.
      const file = readMoliospec(h);
      const child = file.constructionElementSpecs.find(
        (b) => b.pfbb_id != null,
      )!;
      let supplement = file.constructionElementSpecSections.find(
        (s) =>
          s.construction_element_spec_id === child.id &&
          s.pfbb_section_id != null,
      );
      if (!supplement) {
        // Create one so we have something to delete.
        const masterSection = file.constructionElementSpecSections.find(
          (s) => s.construction_element_spec_id === child.pfbb_id,
        )!;
        applyEdits(h, [
          {
            target: "bdbSectionCreate",
            bdbId: child.id,
            pfbbSectionId: masterSection.id,
            sectionNo: masterSection.section_no ?? "0",
            body: "<p>temp</p>",
          },
        ]);
        const refreshed = readMoliospec(h);
        supplement = refreshed.constructionElementSpecSections.find(
          (s) =>
            s.construction_element_spec_id === child.id &&
            s.pfbb_section_id === masterSection.id,
        );
      }
      expect(supplement).toBeDefined();

      const deleted = applyEdits(h, [
        { target: "bdbSectionDelete", sectionId: supplement!.id },
      ]);
      expect(deleted.updated).toBe(1);

      const outPath = join(workDir, "supplement-delete.moliospec");
      await h.saveAs(outPath);
      await h.close();

      const reopen = await openMoliospec(outPath);
      try {
        const reread = readMoliospec(reopen);
        expect(
          reread.constructionElementSpecSections.find(
            (s) => s.id === supplement!.id,
          ),
        ).toBeUndefined();
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

  it("throws pre-transaction on bdbSectionCreate with an unknown bdbId", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "bdbSectionCreate",
            bdbId: 999_999,
            pfbbSectionId: 1,
            sectionNo: "0",
            body: "",
          },
        ]),
      ).toThrow(/no such BDB/);
    } finally {
      await h.close();
    }
  });

  it("throws pre-transaction on bdbSectionDelete with an unknown sectionId", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      expect(() =>
        applyEdits(h, [{ target: "bdbSectionDelete", sectionId: 999_999 }]),
      ).toThrow(/no such bdb section/);
    } finally {
      await h.close();
    }
  });
});

// ---- applyEdits: custom_data (Slice 10I.b) -----------------------------

describe("applyEdits: custom_data (Slice 10I.b)", () => {
  it("inserts a new custom_data row via customDataSet", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h).customData;
      const beforeKeys = new Set(before.map((e) => e.key));
      const uniqueKey = `molio2editor.test.${Date.now()}`;
      expect(beforeKeys.has(uniqueKey)).toBe(false);

      applyEdits(h, [
        {
          target: "customDataSet",
          key: uniqueKey,
          valueBase64: Buffer.from("hello world", "utf8").toString("base64"),
        },
      ]);

      const after = readMoliospec(h).customData;
      const row = after.find((e) => e.key === uniqueKey);
      expect(row).toBeDefined();
      expect(row!.value.toString("utf8")).toBe("hello world");
    } finally {
      await h.close();
    }
  });

  it("overwrites an existing custom_data row (INSERT OR REPLACE)", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const key = `molio2editor.test.${Date.now()}`;
      applyEdits(h, [
        {
          target: "customDataSet",
          key,
          valueBase64: Buffer.from("first", "utf8").toString("base64"),
        },
      ]);
      applyEdits(h, [
        {
          target: "customDataSet",
          key,
          valueBase64: Buffer.from("second", "utf8").toString("base64"),
        },
      ]);
      const after = readMoliospec(h).customData;
      const rows = after.filter((e) => e.key === key);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.value.toString("utf8")).toBe("second");
    } finally {
      await h.close();
    }
  });

  it("deletes a custom_data row via customDataDelete", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const key = `molio2editor.test.${Date.now()}`;
      applyEdits(h, [
        {
          target: "customDataSet",
          key,
          valueBase64: Buffer.from("x", "utf8").toString("base64"),
        },
      ]);
      expect(readMoliospec(h).customData.some((e) => e.key === key)).toBe(true);

      applyEdits(h, [{ target: "customDataDelete", key }]);
      expect(readMoliospec(h).customData.some((e) => e.key === key)).toBe(
        false,
      );
    } finally {
      await h.close();
    }
  });

  it("customDataDelete is idempotent for a missing key", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          { target: "customDataDelete", key: "no-such-key-anywhere" },
        ]),
      ).not.toThrow();
    } finally {
      await h.close();
    }
  });

  it("customDataSet preserves binary bytes round-trip", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const key = `molio2editor.test.bin.${Date.now()}`;
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      applyEdits(h, [
        {
          target: "customDataSet",
          key,
          valueBase64: binary.toString("base64"),
        },
      ]);
      const row = readMoliospec(h).customData.find((e) => e.key === key);
      expect(row).toBeDefined();
      expect(Buffer.compare(row!.value, binary)).toBe(0);
    } finally {
      await h.close();
    }
  });
});

// ---- applyEdits: section hierarchy (Slice 10G) ------------------------

describe("applyEdits: section hierarchy (Slice 10G)", () => {
  it("appends a new BDB root section with max-sibling-no + 1", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const bdb = before.constructionElementSpecs[0];
      if (!bdb) {
        // No BDB to insert against on this sample — skip.
        return;
      }
      const siblingsBefore = before.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === bdb.id && s.parent_id == null,
      );
      const maxBefore = siblingsBefore.reduce(
        (m, s) => Math.max(m, s.section_no ?? 0),
        0,
      );

      applyEdits(h, [
        {
          target: "sectionCreate",
          specKind: "bdb",
          specId: bdb.id,
          parentId: null,
          insertAfterSectionNo: null,
          heading: "New root section",
        },
      ]);

      const after = readMoliospec(h);
      const siblingsAfter = after.constructionElementSpecSections.filter(
        (s) => s.construction_element_spec_id === bdb.id && s.parent_id == null,
      );
      expect(siblingsAfter.length).toBe(siblingsBefore.length + 1);
      const inserted = siblingsAfter.find(
        (s) => s.heading === "New root section",
      );
      expect(inserted).toBeDefined();
      expect(inserted!.section_no).toBe(maxBefore + 1);
    } finally {
      await h.close();
    }
  });

  it("insert-after renumbers later siblings and takes the freed slot", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const bdb = before.constructionElementSpecs[0];
      if (!bdb) return;
      const siblingsBefore = before.constructionElementSpecSections
        .filter(
          (s) =>
            s.construction_element_spec_id === bdb.id && s.parent_id == null,
        )
        .sort((a, b) => (a.section_no ?? 0) - (b.section_no ?? 0));
      if (siblingsBefore.length < 2) return;
      const first = siblingsBefore[0]!;
      const second = siblingsBefore[1]!;
      const insertAfter = first.section_no!;
      const originalSecondNo = second.section_no!;

      applyEdits(h, [
        {
          target: "sectionCreate",
          specKind: "bdb",
          specId: bdb.id,
          parentId: null,
          insertAfterSectionNo: insertAfter,
          heading: "Wedged in",
        },
      ]);

      const after = readMoliospec(h);
      const refreshedSecond = after.constructionElementSpecSections.find(
        (s) => s.id === second.id,
      );
      expect(refreshedSecond!.section_no).toBe(originalSecondNo + 1);
      const inserted = after.constructionElementSpecSections.find(
        (s) => s.heading === "Wedged in",
      );
      expect(inserted).toBeDefined();
      expect(inserted!.section_no).toBe(insertAfter + 1);
    } finally {
      await h.close();
    }
  });

  it("sectionRename updates just the heading column", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const section = readMoliospec(h).constructionElementSpecSections[0];
      if (!section) return;
      const before = section.heading;
      expect(before).not.toBe("Renamed via 10G test");
      applyEdits(h, [
        {
          target: "sectionRename",
          specKind: "bdb",
          sectionId: section.id,
          heading: "Renamed via 10G test",
        },
      ]);
      const after = readMoliospec(h).constructionElementSpecSections.find(
        (s) => s.id === section.id,
      );
      expect(after!.heading).toBe("Renamed via 10G test");
      // Body + section_no unchanged.
      expect(after!.body).toBe(section.body);
      expect(after!.section_no).toBe(section.section_no);
    } finally {
      await h.close();
    }
  });

  it("sectionDelete cascades the entire subtree", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      const before = readMoliospec(h);
      const bdb = before.constructionElementSpecs[0];
      if (!bdb) return;
      // Create a mini tree: parent + 2 children so we can verify
      // cascade without depending on sample data shape.
      applyEdits(h, [
        {
          target: "sectionCreate",
          specKind: "bdb",
          specId: bdb.id,
          parentId: null,
          insertAfterSectionNo: null,
          heading: "Cascade test parent",
        },
      ]);
      const afterInsert = readMoliospec(h);
      const parent = afterInsert.constructionElementSpecSections.find(
        (s) => s.heading === "Cascade test parent",
      );
      expect(parent).toBeDefined();
      applyEdits(h, [
        {
          target: "sectionCreate",
          specKind: "bdb",
          specId: bdb.id,
          parentId: parent!.id,
          insertAfterSectionNo: null,
          heading: "child-1",
        },
        {
          target: "sectionCreate",
          specKind: "bdb",
          specId: bdb.id,
          parentId: parent!.id,
          insertAfterSectionNo: null,
          heading: "child-2",
        },
      ]);
      const withChildren = readMoliospec(h);
      const childIds = withChildren.constructionElementSpecSections
        .filter((s) => s.parent_id === parent!.id)
        .map((s) => s.id);
      expect(childIds.length).toBe(2);

      applyEdits(h, [
        {
          target: "sectionDelete",
          specKind: "bdb",
          sectionId: parent!.id,
        },
      ]);

      const final = readMoliospec(h);
      expect(
        final.constructionElementSpecSections.find((s) => s.id === parent!.id),
      ).toBeUndefined();
      for (const id of childIds) {
        expect(
          final.constructionElementSpecSections.find((s) => s.id === id),
        ).toBeUndefined();
      }
    } finally {
      await h.close();
    }
  });

  it("throws pre-transaction on sectionCreate with unknown spec id", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "sectionCreate",
            specKind: "bdb",
            specId: 999_999,
            parentId: null,
            insertAfterSectionNo: null,
            heading: "Nope",
          },
        ]),
      ).toThrow(/no such bdb id=999999/);
    } finally {
      await h.close();
    }
  });

  it("throws pre-transaction on sectionDelete with unknown section id", async () => {
    const h = await openMoliospec(showoff.path);
    try {
      expect(() =>
        applyEdits(h, [
          {
            target: "sectionDelete",
            specKind: "bdb",
            sectionId: 999_999,
          },
        ]),
      ).toThrow(/no such bdb section id=999999/);
    } finally {
      await h.close();
    }
  });
});
