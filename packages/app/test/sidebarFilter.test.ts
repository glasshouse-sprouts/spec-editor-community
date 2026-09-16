import { describe, expect, it } from "vitest";

import type {
  BdbInfo,
  ContractInfo,
  ControlPlanInfo,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  filterSidebarTree,
  groupWorkSpecsByContract,
} from "../src/renderer/src/Sidebar.js";

/** Tiny factories — each test only spells out the fields it cares about. */
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
    contractId,
  } as WorkSpecInfo;
}
function c(id: number, code: string | null, name: string | null): ContractInfo {
  return { id, contractCode: code, contractName: name };
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
    controlPlanIds: cpIds,
    isPfbb: false,
  } as BdbInfo;
}
function cp(id: number, numberText: string, title: string): ControlPlanInfo {
  return { id, numberText, title } as ControlPlanInfo;
}

/** Build a small tree once so each test just calls filterSidebarTree. */
function buildFixture() {
  const contracts = [c(1, "E00", "Generelle"), c(2, "E01", "VVS")];
  const workSpecs = [
    ws(10, "BI 1", "Beton", 1),
    ws(11, "BI 2", "Træ", 1),
    ws(12, "BI 3", "Rør", 2),
  ];
  const bdbs = [
    bdb(100, "Betonmur", 10, [1000, 1001]),
    bdb(101, "Betondæk", 10, []),
    bdb(110, "Trægulv", 11, [1002]),
    bdb(120, "Rørføring", 12, []),
  ];
  const controlPlans = [
    cp(1000, "BI 1.1", "Armering"),
    cp(1001, "BI 1.2", "Støbning"),
    cp(1002, "BI 2.1", "Slibning"),
  ];
  const bdbsByWorkSpec = new Map<number, BdbInfo[]>();
  for (const b of bdbs) {
    if (b.workSpecId == null) continue;
    const arr = bdbsByWorkSpec.get(b.workSpecId) ?? [];
    arr.push(b);
    bdbsByWorkSpec.set(b.workSpecId, arr);
  }
  const planById = new Map<number, ControlPlanInfo>();
  for (const p of controlPlans) planById.set(p.id, p);
  const groups = groupWorkSpecsByContract({
    contracts,
    workSpecs,
    getEffectiveCode: (x) => x.contractCode,
    getEffectiveName: (x) => x.contractName,
    getEffectiveContractId: (w) => w.contractId,
  });
  return {
    groups,
    bdbsByWorkSpec,
    planById,
    unassignedBdbs: [] as BdbInfo[],
    unlinkedPlans: [] as ControlPlanInfo[],
  };
}

describe("filterSidebarTree", () => {
  it("returns everything unchanged when the filter is empty", () => {
    const fx = buildFixture();
    const result = filterSidebarTree({ ...fx, filter: "" });
    expect(result.isFiltering).toBe(false);
    expect(result.groups).toBe(fx.groups); // same reference — no copy
    expect(result.groups.length).toBe(2);
  });

  it("treats whitespace-only filter as empty", () => {
    const fx = buildFixture();
    const result = filterSidebarTree({ ...fx, filter: "   " });
    expect(result.isFiltering).toBe(false);
  });

  it("keeps ancestor chain when a descendant matches", () => {
    const fx = buildFixture();
    // "Armering" is the title of CP 1000 under BDB 100 under WS 10 under E00.
    const result = filterSidebarTree({ ...fx, filter: "Armering" });
    expect(result.isFiltering).toBe(true);
    // Only E00 survives (the other contract has no match anywhere).
    expect(result.groups.map((g) => g.contractId)).toEqual([1]);
    const e00 = result.groups[0];
    // Only the work area that contains the match.
    expect(e00.workSpecs.map((w) => w.id)).toEqual([10]);
    // Only the matching BDB.
    expect(result.bdbsByWorkSpec.get(10)?.map((b) => b.id)).toEqual([100]);
    // Only the matching CP (the sibling CP 1001 is dropped).
    expect(result.plansByBdb.get(100)?.map((p) => p.id)).toEqual([1000]);
  });

  it("keeps whole subtree when the matched node is an ancestor", () => {
    const fx = buildFixture();
    // "Beton" is the work-area name for WS 10 — match carries its entire
    // subtree along (both BDBs, all CPs under the matching BDB).
    const result = filterSidebarTree({ ...fx, filter: "Beton" });
    expect(result.groups.length).toBe(1);
    const e00 = result.groups[0];
    expect(e00.workSpecs.map((w) => w.id)).toEqual([10]);
    // Both BDBs under WS 10 survive because an ancestor matched.
    expect(
      result.bdbsByWorkSpec
        .get(10)
        ?.map((b) => b.id)
        .sort(),
    ).toEqual([100, 101]);
    // BDB 100 keeps both its CPs (ancestor matched).
    expect(
      result.plansByBdb
        .get(100)
        ?.map((p) => p.id)
        .sort(),
    ).toEqual([1000, 1001]);
  });

  it("matching the contract label keeps its whole group visible", () => {
    const fx = buildFixture();
    // "VVS" is the contract name for E01 — whole group comes along.
    const result = filterSidebarTree({ ...fx, filter: "VVS" });
    expect(result.groups.map((g) => g.contractId)).toEqual([2]);
    expect(result.groups[0].workSpecs.map((w) => w.id)).toEqual([12]);
  });

  it("filter is case-insensitive", () => {
    const fx = buildFixture();
    const lower = filterSidebarTree({ ...fx, filter: "beton" });
    const upper = filterSidebarTree({ ...fx, filter: "BETON" });
    expect(lower.groups.length).toBe(upper.groups.length);
    expect(lower.groups[0].workSpecs.length).toBe(
      upper.groups[0].workSpecs.length,
    );
  });

  it("drops groups with no surviving descendants", () => {
    const fx = buildFixture();
    // "Slibning" only exists under WS 11 (E00); E01 disappears entirely.
    const result = filterSidebarTree({ ...fx, filter: "Slibning" });
    expect(result.groups.map((g) => g.contractId)).toEqual([1]);
    expect(result.groups[0].workSpecs.map((w) => w.id)).toEqual([11]);
    // The non-matching sibling WS 10 is pruned.
    expect(result.bdbsByWorkSpec.get(10)).toBeUndefined();
  });

  it("filters unassigned BDBs and their plans", () => {
    const fx = buildFixture();
    const orphanBdb = bdb(200, "Orphan", null, [2000]);
    const orphanPlan = cp(2000, "X.1", "Malerarbejde");
    fx.planById.set(2000, orphanPlan);
    const result = filterSidebarTree({
      ...fx,
      unassignedBdbs: [orphanBdb],
      filter: "Malerarbejde",
    });
    // Orphan BDB survives because a descendant CP matches.
    expect(result.unassignedBdbs.map((b) => b.id)).toEqual([200]);
    expect(result.plansByBdb.get(200)?.map((p) => p.id)).toEqual([2000]);
    // All contract groups drop out — no contract match anywhere.
    expect(result.groups).toEqual([]);
  });

  it("filters unlinked plans as leaves", () => {
    const fx = buildFixture();
    const loosePlan = cp(3000, "Z.1", "Akustik");
    const result = filterSidebarTree({
      ...fx,
      unlinkedPlans: [loosePlan],
      filter: "Akustik",
    });
    expect(result.unlinkedPlans.map((p) => p.id)).toEqual([3000]);
  });

  it("returns empty everything when nothing matches", () => {
    const fx = buildFixture();
    const result = filterSidebarTree({ ...fx, filter: "xxxxNOPExxxx" });
    expect(result.groups).toEqual([]);
    expect(result.unassignedBdbs).toEqual([]);
    expect(result.unlinkedPlans).toEqual([]);
    // `plansByBdb` is still always built (even when filtering), so it's
    // non-null but holds empty entries only for BDBs that never made it
    // into the output.
    expect(result.isFiltering).toBe(true);
  });
});
