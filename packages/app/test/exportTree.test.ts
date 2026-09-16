/**
 * Tests for exportTree — pure helpers behind the Batch-Export modal
 * (Phase 7.3, task #124 / #127).
 *
 * Everything here is pure: buildExportTree, the selection transitions,
 * tri-state helpers, and selectionToTargets. No React, no IPC.
 *
 * `dedupeFileBases` is now re-exported from `shared/pdfExportUtils.ts`;
 * those tests live in `pdfExportUtils.test.ts` so both the main-side
 * and renderer-side imports are covered.
 */

import { describe, expect, it } from "vitest";

import type {
  BdbInfo,
  ContractInfo,
  ControlPlanHeaderData,
  ControlPlanInfo,
  ControlPlanRowData,
  FilePayload,
  ReferenceLinks,
  SectionData,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  buildExportTree,
  contractGroupState,
  emptySelection,
  isEmptySelection,
  selectAll,
  selectionCount,
  selectionToTargets,
  toggleContractGroup,
  toggleLeaf,
  toggleWorkArea,
  workAreaState,
} from "../src/renderer/src/exportTree.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_REFS: ReferenceLinks = {
  basisGuid: null,
  basisRevisionGuid: null,
  paradigmGuid: null,
  paradigmRevisionGuid: null,
  referencelistArea: null,
  referencelistAreaDate: null,
};

function contract(id: number, code: string, name: string): ContractInfo {
  return { id, contractCode: code, contractName: name };
}

function ws(
  id: number,
  code: string | null,
  name: string,
  contractId: number | null,
): WorkSpecInfo {
  return {
    id,
    workAreaCode: code,
    workAreaName: name,
    revision: null,
    revisionDate: null,
    contractId,
    refs: EMPTY_REFS,
  };
}

function bdb(
  id: number,
  name: string,
  workSpecId: number | null,
  cpIds: number[] = [],
): BdbInfo {
  return {
    id,
    name,
    workSpecId,
    isPfbb: false,
    revision: null,
    revisionDate: null,
    controlPlanIds: cpIds,
    refs: EMPTY_REFS,
  };
}

function cp(id: number, numberText: string, title: string): ControlPlanInfo {
  return { id, numberText, title, controlPlanType: 0 };
}

function makePayload(override: Partial<FilePayload> = {}): FilePayload {
  return {
    path: "/tmp/fake.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: {} as Record<number, SectionData[]>,
    sectionsByBdb: {} as Record<number, SectionData[]>,
    cpHeadersByPlan: {} as Record<number, ControlPlanHeaderData[]>,
    cpRowsByPlan: {} as Record<number, ControlPlanRowData[]>,
    ...override,
  };
}

// A small but realistic payload: 2 contracts, 3 work areas, 4 BDBs, 2 CPs.
function biggishPayload(): FilePayload {
  return makePayload({
    contracts: [
      contract(1, "01", "Fagentreprise"),
      contract(2, "02", "Hovedentreprise"),
    ],
    workSpecs: [
      ws(10, "2.5", "Beton", 1),
      ws(11, "3", "Konstruktioner", 1),
      ws(12, "4", "Klimaskærm", 2),
    ],
    bdbs: [
      bdb(100, "2.5.1 Fundering", 10, [500]),
      bdb(101, "2.5.2 Dæk", 10),
      bdb(102, "3.1 Stål", 11),
      bdb(103, "orphan BDB", null, [501]),
    ],
    controlPlans: [
      cp(500, "2.5.1", "Fundering kontrol"),
      cp(501, "9.9", "Homeless CP"),
    ],
  });
}

// ---------------------------------------------------------------------------
// buildExportTree
// ---------------------------------------------------------------------------

describe("buildExportTree", () => {
  it("returns empty structure when the payload has nothing", () => {
    const tree = buildExportTree(makePayload());
    expect(tree.contractGroups).toEqual([]);
    expect(tree.standaloneBdbs).toEqual([]);
    expect(tree.controlPlans).toEqual([]);
  });

  it("groups work areas by contract and nests BDBs", () => {
    const tree = buildExportTree(biggishPayload());
    expect(tree.contractGroups).toHaveLength(2);
    const g1 = tree.contractGroups[0]!;
    expect(g1.id).toBe(1);
    expect(g1.label).toBe("01 - Fagentreprise");
    expect(g1.workAreas.map((w) => w.id)).toEqual([10, 11]);
    expect(g1.workAreas[0]!.label).toBe("2.5 Beton");
    expect(g1.workAreas[0]!.bdbs.map((b) => b.id)).toEqual([100, 101]);
    expect(g1.workAreas[1]!.bdbs.map((b) => b.id)).toEqual([102]);
    const g2 = tree.contractGroups[1]!;
    expect(g2.id).toBe(2);
    expect(g2.workAreas.map((w) => w.id)).toEqual([12]);
  });

  it("puts orphan BDBs under standaloneBdbs", () => {
    const tree = buildExportTree(biggishPayload());
    expect(tree.standaloneBdbs.map((b) => b.id)).toEqual([103]);
  });

  it("emits a '[No contract]' group when work areas have null contractId", () => {
    const payload = makePayload({
      contracts: [contract(1, "01", "Fag")],
      workSpecs: [ws(20, "9.9", "Orphan-WS", null), ws(21, "1", "Assigned", 1)],
    });
    const tree = buildExportTree(payload);
    expect(tree.contractGroups.map((g) => g.id)).toEqual([1, null]);
    const noContract = tree.contractGroups.find((g) => g.id === null)!;
    expect(noContract.label).toBe("[No contract]");
    expect(noContract.workAreas[0]!.id).toBe(20);
  });

  it("resolves CP ownership via the BDB that references it", () => {
    const tree = buildExportTree(biggishPayload());
    expect(tree.controlPlans.map((c) => c.id)).toEqual([500, 501]);
    expect(tree.controlPlans[0]!.label).toBe("2.5.1  Fundering kontrol");
    expect(tree.controlPlans[0]!.ownerLabel).toBe(
      "2.5 Beton · 2.5.1 Fundering",
    );
    // 501 lives under the orphan BDB (workSpecId null) → no parent WA label.
    expect(tree.controlPlans[1]!.ownerLabel).toBe("orphan BDB");
  });
});

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

describe("selection helpers", () => {
  it("emptySelection + isEmptySelection + selectionCount", () => {
    const sel = emptySelection();
    expect(isEmptySelection(sel)).toBe(true);
    expect(selectionCount(sel)).toBe(0);
    const bumped = toggleLeaf(sel, "bdb", 42);
    expect(isEmptySelection(bumped)).toBe(false);
    expect(selectionCount(bumped)).toBe(1);
  });

  it("toggleLeaf flips each kind independently and returns a new Set", () => {
    const a = emptySelection();
    const b = toggleLeaf(a, "workArea", 10);
    expect(a.workAreas.has(10)).toBe(false); // original untouched
    expect(b.workAreas.has(10)).toBe(true);
    const c = toggleLeaf(b, "workArea", 10);
    expect(c.workAreas.has(10)).toBe(false);
  });

  it("selectAll(true) ticks every leaf in the tree", () => {
    const tree = buildExportTree(biggishPayload());
    const sel = selectAll(tree, true);
    // workAreas: 10, 11, 12 → 3
    // bdbs: 100, 101, 102, 103 → 4
    // cps: 500, 501 → 2
    expect(sel.workAreas.size).toBe(3);
    expect(sel.bdbs.size).toBe(4);
    expect(sel.cps.size).toBe(2);
    expect(selectionCount(sel)).toBe(9);
  });

  it("selectAll(false) returns an empty selection", () => {
    const tree = buildExportTree(biggishPayload());
    expect(isEmptySelection(selectAll(tree, false))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tri-state helpers + cascading toggles
// ---------------------------------------------------------------------------

describe("tri-state helpers", () => {
  it("workAreaState reflects none / some / all", () => {
    const tree = buildExportTree(biggishPayload());
    const wa = tree.contractGroups[0]!.workAreas[0]!; // WA 10 with 2 BDBs
    let sel = emptySelection();
    expect(workAreaState(sel, wa)).toBe("none");
    sel = toggleLeaf(sel, "bdb", 100);
    expect(workAreaState(sel, wa)).toBe("some");
    sel = toggleLeaf(sel, "bdb", 101);
    sel = toggleLeaf(sel, "workArea", 10);
    expect(workAreaState(sel, wa)).toBe("all");
  });

  it("toggleWorkArea cascades across WA + all BDBs under it", () => {
    const tree = buildExportTree(biggishPayload());
    const wa = tree.contractGroups[0]!.workAreas[0]!; // WA 10 with BDBs 100, 101
    let sel = emptySelection();
    sel = toggleWorkArea(sel, wa);
    expect(sel.workAreas.has(10)).toBe(true);
    expect(sel.bdbs.has(100)).toBe(true);
    expect(sel.bdbs.has(101)).toBe(true);
    // Toggle again → clears them all.
    sel = toggleWorkArea(sel, wa);
    expect(sel.workAreas.has(10)).toBe(false);
    expect(sel.bdbs.has(100)).toBe(false);
    expect(sel.bdbs.has(101)).toBe(false);
  });

  it("contractGroupState + toggleContractGroup across multiple WAs", () => {
    const tree = buildExportTree(biggishPayload());
    const grp = tree.contractGroups[0]!; // Contract 1 with WAs 10, 11
    let sel = emptySelection();
    expect(contractGroupState(sel, grp)).toBe("none");
    sel = toggleContractGroup(sel, grp);
    expect(contractGroupState(sel, grp)).toBe("all");
    // WA 10 = 1 WA + 2 BDBs, WA 11 = 1 WA + 1 BDB → 5 descendants.
    expect(sel.workAreas.size + sel.bdbs.size).toBe(5);
    // Flip again → empty.
    sel = toggleContractGroup(sel, grp);
    expect(contractGroupState(sel, grp)).toBe("none");
  });

  it("contractGroupState is 'some' when only partial descendants are on", () => {
    const tree = buildExportTree(biggishPayload());
    const grp = tree.contractGroups[0]!;
    let sel = emptySelection();
    sel = toggleLeaf(sel, "bdb", 100);
    expect(contractGroupState(sel, grp)).toBe("some");
  });
});

// ---------------------------------------------------------------------------
// selectionToTargets ordering
// ---------------------------------------------------------------------------

describe("selectionToTargets", () => {
  it("returns a stable-ordered list: contracts → WAs → BDBs, standalones, CPs", () => {
    const tree = buildExportTree(biggishPayload());
    const sel = selectAll(tree, true);
    const out = selectionToTargets(tree, sel);
    expect(out).toEqual([
      { kind: "workSpec", id: 10 },
      { kind: "bdb", id: 100 },
      { kind: "bdb", id: 101 },
      { kind: "workSpec", id: 11 },
      { kind: "bdb", id: 102 },
      { kind: "workSpec", id: 12 },
      { kind: "bdb", id: 103 },
      { kind: "cp", id: 500 },
      { kind: "cp", id: 501 },
    ]);
  });

  it("omits items that aren't in the selection", () => {
    const tree = buildExportTree(biggishPayload());
    let sel = emptySelection();
    sel = toggleLeaf(sel, "bdb", 100);
    sel = toggleLeaf(sel, "cp", 501);
    expect(selectionToTargets(tree, sel)).toEqual([
      { kind: "bdb", id: 100 },
      { kind: "cp", id: 501 },
    ]);
  });
});
