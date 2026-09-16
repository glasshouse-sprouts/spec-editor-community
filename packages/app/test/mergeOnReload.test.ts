/**
 * RELOAD-Merge M1 — tests for the merge brain (computeMergePlan).
 *
 * Pure data-in / plan-out. We synthesise tiny FilePayload fixtures
 * (base + disk) and a buffered EditRequest[] and assert the plan.
 */
import { describe, expect, it } from "vitest";

import type {
  BdbInfo,
  ControlPlanInfo,
  ControlPlanRowData,
  EditRequest,
  FilePayload,
  SectionData,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  computeDiskDelta,
  computeMergePlan,
  editsContainStructural,
} from "../src/renderer/src/mergeOnReload.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function payload(parts: Partial<FilePayload>): FilePayload {
  return {
    path: "/x.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
    customData: [],
    ...parts,
  } as FilePayload;
}

function section(id: number, body: string): SectionData {
  return {
    id,
    sectionNo: id,
    heading: `Section ${id}`,
    body,
    parentId: null,
    pfbbSectionId: null,
  };
}

function bdb(id: number, over: Partial<BdbInfo> = {}): BdbInfo {
  return {
    id,
    name: `BDB ${id}`,
    workSpecId: null,
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
    ...over,
  };
}

function cpRow(
  id: number,
  over: Partial<ControlPlanRowData> = {},
): ControlPlanRowData {
  return {
    id,
    headerId: 1,
    controlType: 0,
    sectionNo: String(id),
    subject: "",
    reference: "",
    method: "",
    quantity: "",
    time: "",
    acceptanceCriteria: "",
    documentation: "",
    controlLevel: "",
    sampleLevel: "",
    ...over,
  };
}

function cp(id: number, title: string): ControlPlanInfo {
  return {
    id,
    numberText: String(id),
    title,
    controlPlanType: 0,
    revision: null,
    revisionDate: null,
  };
}

// ---------------------------------------------------------------------------
// Section-body merges
// ---------------------------------------------------------------------------

describe("computeMergePlan — section bodies", () => {
  it("auto-applies my edit when the disk didn't touch the section", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — my change" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("flags a conflict when both sides changed the same section", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A — disk")] } });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.base).toBe("A");
    expect(plan.conflicts[0]!.mine).toBe("A — mine");
    expect(plan.conflicts[0]!.theirs).toBe("A — disk");
  });

  it("skips an 'edit' that equals the base (not a real change)", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A — disk")] } });
    const edits: EditRequest[] = [{ target: "bdb", sectionId: 100, body: "A" }];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("skips when my edit and the disk converged on the same value", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "SAME")] } });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "SAME" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Blocking rules
// ---------------------------------------------------------------------------

describe("computeMergePlan — blocking", () => {
  it("blocks when a buffered edit is itself structural", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A2" },
      { target: "sectionDelete", specKind: "bdb", sectionId: 101 },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "blocked") throw new Error("expected blocked");
    expect(plan.blockers.some((b) => b.kind === "structural-edit")).toBe(true);
  });

  it("blocks when the disk deleted a section I edited", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [] } }); // 100 gone
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "blocked") throw new Error("expected blocked");
    expect(plan.blockers.some((b) => b.kind === "target-deleted")).toBe(true);
  });

  it("does NOT block when the disk deleted a section I did not edit", () => {
    // base has 100 + 101; I only edit 100; disk dropped 101.
    const base = payload({
      sectionsByBdb: { 5: [section(100, "A"), section(101, "B")] },
    });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Metadata — per-field
// ---------------------------------------------------------------------------

describe("computeMergePlan — metadata is per-field", () => {
  it("auto-applies the untouched field and conflicts only the clashing one", () => {
    const base = payload({
      bdbs: [bdb(5, { name: "Old name", revision: "r1" })],
    });
    // Disk changed only `revision`, left `name` alone.
    const disk = payload({
      bdbs: [bdb(5, { name: "Old name", revision: "r2-disk" })],
    });
    const edits: EditRequest[] = [
      { target: "bdbMetadata", id: 5, name: "New name", revision: "r3-mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied.map((u) => u.key)).toEqual([
      "meta:bdbMetadata:5:name",
    ]);
    expect(plan.conflicts.map((u) => u.key)).toEqual([
      "meta:bdbMetadata:5:revision",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Control-plan cell + title
// ---------------------------------------------------------------------------

describe("computeMergePlan — control plans", () => {
  it("auto-applies a CP cell edit the disk didn't touch", () => {
    const base = payload({
      controlPlans: [cp(9, "Plan")],
      cpRowsByPlan: { 9: [cpRow(50, { subject: "old" })] },
    });
    const disk = payload({
      controlPlans: [cp(9, "Plan")],
      cpRowsByPlan: { 9: [cpRow(50, { subject: "old" })] },
    });
    const edits: EditRequest[] = [
      { target: "cpRow", rowId: 50, field: "subject", value: "new" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.autoApplied).toHaveLength(1);
    expect(plan.autoApplied[0]!.kind).toBe("cpCell");
  });

  it("conflicts a CP title changed on both sides", () => {
    const base = payload({ controlPlans: [cp(9, "Plan")] });
    const disk = payload({ controlPlans: [cp(9, "Plan — disk")] });
    const edits: EditRequest[] = [
      { target: "cpTitle", controlPlanId: 9, title: "Plan — mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.kind).toBe("cpTitle");
  });
});

// ---------------------------------------------------------------------------
// editsContainStructural (M2's cheap gate)
// ---------------------------------------------------------------------------

describe("editsContainStructural", () => {
  it("is false for section-body + metadata edits", () => {
    expect(
      editsContainStructural([
        { target: "bdb", sectionId: 1, body: "x" },
        { target: "bdbMetadata", id: 2, name: "y" },
      ]),
    ).toBe(false);
  });

  it("is true when a structural edit is present", () => {
    expect(
      editsContainStructural([
        { target: "bdb", sectionId: 1, body: "x" },
        { target: "deleteBdb", id: 2 },
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeDiskDelta — top-level additions / removals
// ---------------------------------------------------------------------------

/** Minimal work area — computeDiskDelta only reads id + name + code. */
function ws(id: number, name: string): WorkSpecInfo {
  return {
    id,
    workAreaName: name,
    workAreaCode: "",
  } as unknown as WorkSpecInfo;
}

describe("computeDiskDelta", () => {
  it("is empty when base and disk have the same top-level entities", () => {
    const base = payload({ bdbs: [bdb(1)], controlPlans: [cp(9, "P")] });
    const disk = payload({ bdbs: [bdb(1)], controlPlans: [cp(9, "P")] });
    const d = computeDiskDelta(base, disk);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });

  it("reports a BDB and a work area added on disk", () => {
    const base = payload({});
    const disk = payload({
      bdbs: [bdb(2, { name: "New BDB" })],
      workSpecs: [ws(7, "New area")],
    });
    const d = computeDiskDelta(base, disk);
    expect(d.added).toEqual(
      expect.arrayContaining([
        { kind: "bdb", name: "New BDB" },
        { kind: "workArea", name: "New area" },
      ]),
    );
    expect(d.removed).toHaveLength(0);
  });

  it("reports a control plan removed on disk", () => {
    const base = payload({ controlPlans: [cp(9, "Gone plan")] });
    const disk = payload({ controlPlans: [] });
    const d = computeDiskDelta(base, disk);
    expect(d.removed).toEqual([{ kind: "controlPlan", name: "Gone plan" }]);
    expect(d.added).toHaveLength(0);
  });
});

describe("computeMergePlan — diskDelta", () => {
  it("carries the disk's new BDB in the ok plan", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({
      sectionsByBdb: { 5: [section(100, "A")] },
      bdbs: [bdb(8, { name: "Disk BDB" })],
    });
    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — mine" },
    ];
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind !== "ok") throw new Error("expected ok");
    expect(plan.diskDelta.added).toEqual([{ kind: "bdb", name: "Disk BDB" }]);
    expect(plan.diskDelta.removed).toHaveLength(0);
  });
});
