/**
 * Tests for homelessBuckets — pure helpers behind the sidebar's
 * nested "[No contract] / [No work area] / [No BDB]" catch-all buckets
 * (Slice 6O.1 — #109).
 *
 * Only pure logic is exercised here. Rendering is covered by the
 * Sidebar in 6O.2.
 */

import { describe, expect, it } from "vitest";

import type {
  BdbInfo,
  ControlPlanInfo,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  bucketVisibility,
  computeHomelessBuckets,
  hasAnyHomeless,
} from "../src/renderer/src/homelessBuckets.js";

// ----------
// Fixtures
// ----------

function ws(
  id: number,
  contractId: number | null,
  name = `WS-${id}`,
): WorkSpecInfo {
  return {
    id,
    contractId,
    workAreaCode: `W${id}`,
    workAreaName: name,
  };
}

function bdb(
  id: number,
  workSpecId: number | null,
  controlPlanIds: number[] = [],
): BdbInfo {
  return {
    id,
    name: `B-${id}`,
    workSpecId,
    isPfbb: false,
    revision: null,
    revisionDate: null,
    controlPlanIds,
    refs: {
      basisGuid: null,
      basisRevisionGuid: null,
      paradigmGuid: null,
      paradigmRevisionGuid: null,
      referencelistArea: null,
      referencelistAreaDate: null,
    },
  };
}

function cp(id: number, title = `CP-${id}`): ControlPlanInfo {
  return { id, numberText: String(id), title, controlPlanType: 0 };
}

// ----------
// computeHomelessBuckets
// ----------

describe("computeHomelessBuckets", () => {
  it("returns all three buckets empty when every row is well-parented", () => {
    const workSpecs = [ws(1, 10), ws(2, 10)];
    const bdbs = [bdb(1, 1, [100]), bdb(2, 2)];
    const controlPlans = [cp(100)];
    const result = computeHomelessBuckets({ workSpecs, bdbs, controlPlans });
    expect(result.noContractWorkSpecs).toEqual([]);
    expect(result.noWorkAreaBdbs).toEqual([]);
    expect(result.noBdbPlans).toEqual([]);
  });

  it("collects work areas with null contract_id", () => {
    const workSpecs = [ws(1, null), ws(2, 10), ws(3, null)];
    const result = computeHomelessBuckets({
      workSpecs,
      bdbs: [],
      controlPlans: [],
    });
    expect(result.noContractWorkSpecs.map((w) => w.id)).toEqual([1, 3]);
  });

  it("collects BDBs with null work_spec_id", () => {
    const bdbs = [bdb(1, null), bdb(2, 5), bdb(3, null)];
    const result = computeHomelessBuckets({
      workSpecs: [],
      bdbs,
      controlPlans: [],
    });
    expect(result.noWorkAreaBdbs.map((b) => b.id)).toEqual([1, 3]);
  });

  it("collects CPs not referenced by any BDB", () => {
    const controlPlans = [cp(100), cp(101), cp(102)];
    const bdbs = [bdb(1, 5, [100]), bdb(2, 6, [102])];
    const result = computeHomelessBuckets({
      workSpecs: [],
      bdbs,
      controlPlans,
    });
    expect(result.noBdbPlans.map((c) => c.id)).toEqual([101]);
  });

  it("uses getEffectiveContractId so pending reassignments route correctly", () => {
    // w#1 saved with contract 10, but buffered "Move to (no contract)".
    // w#2 saved with no contract, but buffered "Move to contract 20".
    const workSpecs = [ws(1, 10), ws(2, null)];
    const pendingContractFor = new Map<number, number | null>([
      [1, null],
      [2, 20],
    ]);
    const result = computeHomelessBuckets({
      workSpecs,
      bdbs: [],
      controlPlans: [],
      getEffectiveContractId: (w) =>
        pendingContractFor.has(w.id)
          ? (pendingContractFor.get(w.id) as number | null)
          : w.contractId,
    });
    // w#1 now orphan; w#2 now parented.
    expect(result.noContractWorkSpecs.map((w) => w.id)).toEqual([1]);
  });

  it("preserves input order inside each bucket", () => {
    const workSpecs = [ws(3, null), ws(1, null), ws(2, null)];
    const result = computeHomelessBuckets({
      workSpecs,
      bdbs: [],
      controlPlans: [],
    });
    expect(result.noContractWorkSpecs.map((w) => w.id)).toEqual([3, 1, 2]);
  });

  it("treats CPs referenced by either slot on any BDB as non-homeless", () => {
    // BDB references 100 in its design slot, 200 in production.
    const bdbs = [bdb(1, 5, [100, 200])];
    const controlPlans = [cp(100), cp(200), cp(300)];
    const result = computeHomelessBuckets({
      workSpecs: [],
      bdbs,
      controlPlans,
    });
    expect(result.noBdbPlans.map((c) => c.id)).toEqual([300]);
  });
});

// ----------
// bucketVisibility
// ----------

describe("bucketVisibility", () => {
  it("hides every bucket when nothing is homeless", () => {
    const v = bucketVisibility({
      noContractWorkSpecs: [],
      noWorkAreaBdbs: [],
      noBdbPlans: [],
    });
    expect(v).toEqual({
      showNoContract: false,
      showNoWorkArea: false,
      showNoBdb: false,
    });
  });

  it("shows [No contract] only, when only work areas are homeless", () => {
    const v = bucketVisibility({
      noContractWorkSpecs: [ws(1, null)],
      noWorkAreaBdbs: [],
      noBdbPlans: [],
    });
    expect(v).toEqual({
      showNoContract: true,
      showNoWorkArea: false,
      showNoBdb: false,
    });
  });

  it("cascades [No contract] + [No work area] when only BDBs are homeless", () => {
    const v = bucketVisibility({
      noContractWorkSpecs: [],
      noWorkAreaBdbs: [bdb(1, null)],
      noBdbPlans: [],
    });
    expect(v).toEqual({
      showNoContract: true,
      showNoWorkArea: true,
      showNoBdb: false,
    });
  });

  it("cascades all three when a lone orphan CP exists", () => {
    const v = bucketVisibility({
      noContractWorkSpecs: [],
      noWorkAreaBdbs: [],
      noBdbPlans: [cp(1)],
    });
    expect(v).toEqual({
      showNoContract: true,
      showNoWorkArea: true,
      showNoBdb: true,
    });
  });

  it("shows every level when every bucket has content", () => {
    const v = bucketVisibility({
      noContractWorkSpecs: [ws(1, null)],
      noWorkAreaBdbs: [bdb(2, null)],
      noBdbPlans: [cp(3)],
    });
    expect(v).toEqual({
      showNoContract: true,
      showNoWorkArea: true,
      showNoBdb: true,
    });
  });
});

// ----------
// hasAnyHomeless
// ----------

describe("hasAnyHomeless", () => {
  it("is false when all three buckets are empty", () => {
    expect(
      hasAnyHomeless({
        noContractWorkSpecs: [],
        noWorkAreaBdbs: [],
        noBdbPlans: [],
      }),
    ).toBe(false);
  });

  it("is true when any single bucket has content", () => {
    expect(
      hasAnyHomeless({
        noContractWorkSpecs: [ws(1, null)],
        noWorkAreaBdbs: [],
        noBdbPlans: [],
      }),
    ).toBe(true);
    expect(
      hasAnyHomeless({
        noContractWorkSpecs: [],
        noWorkAreaBdbs: [bdb(1, null)],
        noBdbPlans: [],
      }),
    ).toBe(true);
    expect(
      hasAnyHomeless({
        noContractWorkSpecs: [],
        noWorkAreaBdbs: [],
        noBdbPlans: [cp(1)],
      }),
    ).toBe(true);
  });
});
