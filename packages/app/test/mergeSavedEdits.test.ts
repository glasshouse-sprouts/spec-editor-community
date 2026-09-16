/** @vitest-environment jsdom */
/**
 * Regression tests for `mergeSavedEdits` — the post-save in-memory
 * stitcher.
 *
 * Background (why this file exists)
 * ─────────────────────────────────
 *
 * After Cmd+S succeeds the renderer clears its edit buffer but keeps
 * its in-memory `FilePayload` (no reload from disk, for perf + UX).
 * `mergeSavedEdits` is what folds the buffer into that payload so the
 * sidebar / badges / icons that read `state.data.*` reflect saved
 * values. Slice 10E originally shipped the *edit → disk* half of the
 * story and forgot the *buffer → state* half for four patch kinds
 * (bdbMeta, wsMeta, cpMeta, project). The bug was invisible until
 * Slice 10H.5 added the first badge that reads `bdb.isPfbb` raw — the
 * PFBB pill didn't appear after save.
 *
 * These tests lock down the round-trip for each patch kind, with extra
 * coverage of the two coercions that are easy to get wrong:
 *
 *   1. `isPfbb` on the wire is 0/1 but `BdbInfo.isPfbb` is boolean.
 *   2. The edit key is `molioReferencelistDate` (single-i) but the
 *      `ProjectInfo` field is `moliioReferencelistDate` (double-i,
 *      historical schema typo).
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_EDITS,
  setBdbField,
  setCpField,
  setCpTitle,
  setProjectField,
  setSectionBody,
  setWorkSpecField,
} from "../src/renderer/src/edits.js";
import { mergeSavedEdits } from "../src/renderer/src/mergeSavedEdits.js";
import type {
  BdbInfo,
  ControlPlanInfo,
  FilePayload,
  ProjectInfo,
  WorkSpecInfo,
} from "../src/shared/ipc.js";

// ── Fixtures ──────────────────────────────────────────────────────
//
// Minimal but realistic payload: one project, one work-spec, one BDB,
// one control plan. No rows / contracts / attachments — those paths
// are already covered by the pre-existing save tests.

const baseProject: ProjectInfo = {
  projectGuid: "proj-guid-1",
  name: "Sample project",
  projectNumber: "P-001",
  builder: null,
  createdBySystem: "molio2-editor",
  createdDate: "2025-01-01",
  modifiedDate: null,
  moliioReferencelistDate: null,
};

const baseWorkSpec: WorkSpecInfo = {
  id: 10,
  workAreaCode: "01",
  workAreaName: "Jordarbejde",
  workAreaType: 0,
  revision: null,
  revisionDate: null,
  contractId: null,
  refs: {
    basisGuid: null,
    basisRevisionGuid: null,
    paradigmGuid: null,
    paradigmRevisionGuid: null,
    referencelistArea: null,
    referencelistAreaDate: null,
  },
  createdBy: null,
  createdByOrganization: null,
  issueDate: null,
  reviewedBy: null,
  approvedBy: null,
  locked: {
    molioSpecRevisionNo: null,
    molioSpecRevisionDate: null,
  },
};

const baseBdb: BdbInfo = {
  id: 100,
  name: "Gipsvæg",
  workSpecId: 10,
  isPfbb: false,
  pfbbId: null,
  revision: null,
  revisionDate: null,
  controlPlanIds: [],
  refs: {
    basisGuid: null,
    basisRevisionGuid: null,
    paradigmGuid: null,
    paradigmRevisionGuid: null,
    referencelistArea: null,
    referencelistAreaDate: null,
  },
  createdBy: null,
  createdByOrganization: null,
  issueDate: null,
  reviewedBy: null,
  approvedBy: null,
  locked: {
    molioSpecRevisionNo: null,
    molioSpecRevisionDate: null,
    controlplanDesignId: null,
    controlplanProductionId: null,
    commonControlplanDesignGuid: null,
    commonControlplanProductionGuid: null,
    molioConstructionElementSpecGuid: null,
    molioConstructionElementSpecRevisionGuid: null,
    molioConstructionElementSpecRevisionNo: null,
    molioConstructionElementSpecRevisionDate: null,
  },
};

const baseCp: ControlPlanInfo = {
  id: 500,
  numberText: "1",
  title: "Kontrolplan A",
  controlPlanType: 0,
  revision: null,
  revisionDate: null,
};

function makePayload(overrides: Partial<FilePayload> = {}): FilePayload {
  return {
    path: "/tmp/sample.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 1_000_000,
    project: baseProject,
    workSpecs: [baseWorkSpec],
    bdbs: [baseBdb],
    controlPlans: [baseCp],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
    ...overrides,
  };
}

// ── No-op behaviour ──────────────────────────────────────────────

describe("mergeSavedEdits — no-op", () => {
  it("returns the same reference when the edit map is empty", () => {
    const data = makePayload();
    expect(mergeSavedEdits(data, EMPTY_EDITS)).toBe(data);
  });
});

// ── BDB metadata (the bug that caused this slice) ─────────────────

describe("mergeSavedEdits — bdbMeta", () => {
  it("folds isPfbb = 1 back onto BdbInfo as boolean true", () => {
    const data = makePayload();
    // User ticks the PFBB checkbox in Edit BDB modal. The modal stores
    // it as 1 (number) in the buffer.
    const edits = setBdbField(EMPTY_EDITS, 100, "isPfbb", 1, 0);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.bdbs[0]!.isPfbb).toBe(true);
    // Nothing else on the BDB should have changed.
    expect(merged.bdbs[0]!.name).toBe("Gipsvæg");
    expect(merged.bdbs[0]!.id).toBe(100);
  });

  it("folds isPfbb = 0 back onto BdbInfo as boolean false", () => {
    const data = makePayload({
      bdbs: [{ ...baseBdb, isPfbb: true }],
    });
    const edits = setBdbField(EMPTY_EDITS, 100, "isPfbb", 0, 1);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.bdbs[0]!.isPfbb).toBe(false);
  });

  it("folds a name rename back onto BdbInfo", () => {
    const data = makePayload();
    const edits = setBdbField(EMPTY_EDITS, 100, "name", "Letvæg", "Gipsvæg");

    const merged = mergeSavedEdits(data, edits);

    expect(merged.bdbs[0]!.name).toBe("Letvæg");
  });

  it("folds multiple nullable text fields in one pass", () => {
    const data = makePayload();
    let edits = setBdbField(EMPTY_EDITS, 100, "revision", "B", null);
    edits = setBdbField(edits, 100, "reviewedBy", "Jens", null);
    edits = setBdbField(edits, 100, "approvedBy", "Marie", null);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.bdbs[0]!.revision).toBe("B");
    expect(merged.bdbs[0]!.reviewedBy).toBe("Jens");
    expect(merged.bdbs[0]!.approvedBy).toBe("Marie");
    // Untouched nullable field stays null.
    expect(merged.bdbs[0]!.createdBy).toBeNull();
  });

  it("leaves BDBs with no pending edit untouched (same reference)", () => {
    const otherBdb: BdbInfo = { ...baseBdb, id: 101, name: "Anden BDB" };
    const data = makePayload({ bdbs: [baseBdb, otherBdb] });
    const edits = setBdbField(EMPTY_EDITS, 100, "name", "Renamed", "Gipsvæg");

    const merged = mergeSavedEdits(data, edits);

    // BDB 100 got a new object; BDB 101 must keep its original reference.
    expect(merged.bdbs[1]).toBe(otherBdb);
    expect(merged.bdbs[0]).not.toBe(baseBdb);
  });
});

// ── Work-spec metadata ────────────────────────────────────────────

describe("mergeSavedEdits — wsMeta", () => {
  it("folds workAreaName rename onto WorkSpecInfo", () => {
    const data = makePayload();
    const edits = setWorkSpecField(
      EMPTY_EDITS,
      10,
      "workAreaName",
      "Jordarbejde (revideret)",
      "Jordarbejde",
    );

    const merged = mergeSavedEdits(data, edits);

    expect(merged.workSpecs[0]!.workAreaName).toBe("Jordarbejde (revideret)");
  });

  it("folds a workAreaCode change plus revision in one pass", () => {
    const data = makePayload();
    let edits = setWorkSpecField(EMPTY_EDITS, 10, "workAreaCode", "02", "01");
    edits = setWorkSpecField(edits, 10, "revision", "C", null);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.workSpecs[0]!.workAreaCode).toBe("02");
    expect(merged.workSpecs[0]!.revision).toBe("C");
  });

  it("preserves contractId when only metadata was edited", () => {
    const data = makePayload({
      workSpecs: [{ ...baseWorkSpec, contractId: 77 }],
    });
    const edits = setWorkSpecField(
      EMPTY_EDITS,
      10,
      "workAreaName",
      "Noget andet",
      "Jordarbejde",
    );

    const merged = mergeSavedEdits(data, edits);

    expect(merged.workSpecs[0]!.contractId).toBe(77);
    expect(merged.workSpecs[0]!.workAreaName).toBe("Noget andet");
  });
});

// ── CP metadata ───────────────────────────────────────────────────

describe("mergeSavedEdits — cpMeta", () => {
  it("folds revision + revisionDate onto ControlPlanInfo", () => {
    const data = makePayload();
    let edits = setCpField(EMPTY_EDITS, 500, "revision", "B", null);
    edits = setCpField(edits, 500, "revisionDate", "2026-04-23", null);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.controlPlans[0]!.revision).toBe("B");
    expect(merged.controlPlans[0]!.revisionDate).toBe("2026-04-23");
    // title untouched by cpMeta (that lives under cpTitle:<id>).
    expect(merged.controlPlans[0]!.title).toBe("Kontrolplan A");
  });

  it("coexists with a cpTitle rename in the same merge", () => {
    const data = makePayload();
    let edits = setCpTitle(EMPTY_EDITS, 500, "Ny titel", "Kontrolplan A");
    edits = setCpField(edits, 500, "revision", "C", null);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.controlPlans[0]!.title).toBe("Ny titel");
    expect(merged.controlPlans[0]!.revision).toBe("C");
  });
});

// ── Project metadata (typo mapping) ──────────────────────────────

describe("mergeSavedEdits — project", () => {
  it("folds a name + projectNumber change onto ProjectInfo", () => {
    const data = makePayload();
    let edits = setProjectField(
      EMPTY_EDITS,
      "proj-guid-1",
      "name",
      "Nyt navn",
      "Sample project",
    );
    edits = setProjectField(
      edits,
      "proj-guid-1",
      "projectNumber",
      "P-999",
      "P-001",
    );

    const merged = mergeSavedEdits(data, edits);

    expect(merged.project!.name).toBe("Nyt navn");
    expect(merged.project!.projectNumber).toBe("P-999");
  });

  it("maps molioReferencelistDate (edit key) → moliioReferencelistDate (schema typo)", () => {
    const data = makePayload();
    const edits = setProjectField(
      EMPTY_EDITS,
      "proj-guid-1",
      "molioReferencelistDate",
      "2026-04-23",
      null,
    );

    const merged = mergeSavedEdits(data, edits);

    // Double-i on the ProjectInfo field — deliberately preserved for
    // historical compatibility with existing .moliospec files.
    expect(merged.project!.moliioReferencelistDate).toBe("2026-04-23");
  });

  it("does nothing when the payload has no project row", () => {
    const data = makePayload({ project: null });
    const edits = setProjectField(
      EMPTY_EDITS,
      "proj-guid-1",
      "name",
      "Will be ignored",
      "Sample project",
    );

    const merged = mergeSavedEdits(data, edits);

    expect(merged.project).toBeNull();
  });
});

// ── Regression guard for the original Slice 10H bug ───────────────

describe("mergeSavedEdits — 10H.5 PFBB pill regression", () => {
  it("a single isPfbb toggle survives round-trip so the sidebar pill can read it", () => {
    // The exact scenario that was broken before this slice:
    //   1. user opens Edit BDB modal,
    //   2. ticks PFBB ON,
    //   3. clicks OK (edits buffer has bdbMeta:100.isPfbb = 1),
    //   4. saves the file (main writes, renderer clears buffer, calls
    //      mergeSavedEdits),
    //   5. reopens modal / sidebar reads bdbs[i].isPfbb for the pill.
    //
    // Before the fix, step 5 saw the stale false. After the fix it
    // sees true.
    const data = makePayload();
    const edits = setBdbField(EMPTY_EDITS, 100, "isPfbb", 1, 0);

    const merged = mergeSavedEdits(data, edits);

    expect(merged.bdbs[0]!.isPfbb).toBe(true);
  });
});

// ── Section bodies (regression — not broken, but covered here now
//    that the module has a dedicated test file) ──────────────────

describe("mergeSavedEdits — section bodies (back-compat)", () => {
  it("folds a work-spec section body edit into sectionsByWorkSpec", () => {
    const data = makePayload({
      sectionsByWorkSpec: {
        10: [
          {
            id: 7,
            sectionNo: 1,
            heading: "Indledning",
            body: "<p>Old</p>",
            parentId: null,
          },
        ],
      },
    });
    const edits = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      7,
      "<p>New</p>",
      "<p>Old</p>",
    );

    const merged = mergeSavedEdits(data, edits);

    expect(merged.sectionsByWorkSpec[10]![0]!.body).toBe("<p>New</p>");
  });
});
