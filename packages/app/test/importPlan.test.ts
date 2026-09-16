/**
 * Tests for importPlan — pure helpers behind the Import modal.
 *
 * These exercise tree construction, landing-spot defaults, cascade
 * rules, the Check-button gate, and DTO-building. Collision
 * resolution is covered later (Phase 6K.3-E).
 */

import { describe, expect, it } from "vitest";

import type {
  ContractInfo,
  ImportPrecheckDTO,
  ImportSourceSummary,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  buildImportPlan,
  buildSourceTree,
  canCheck,
  canImport,
  contractLabel,
  defaultContractForWorkArea,
  defaultResolutions,
  defaultWorkAreaForStandaloneBdb,
  emptyModalState,
  indexCollisions,
  setLandingContract,
  setLandingWorkArea,
  toggleBdb,
  toggleWorkArea,
  workAreaLabel,
} from "../src/renderer/src/importPlan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contract(
  id: number,
  code: string | null,
  name: string | null,
): ContractInfo {
  return { id, contractCode: code, contractName: name };
}

function makeSummary(
  over: Partial<ImportSourceSummary> = {},
): ImportSourceSummary {
  return {
    contracts: [],
    workAreas: [],
    bdbs: [],
    ...over,
  };
}

function targetWa(
  id: number,
  code: string | null,
  name: string,
  contractId: number | null = null,
): WorkSpecInfo {
  return {
    id,
    workAreaCode: code,
    workAreaName: name,
    revision: null,
    revisionDate: null,
    contractId,
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

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("contractLabel", () => {
  it("joins code and name with the shared separator", () => {
    expect(
      contractLabel({ contractCode: "C01", contractName: "Fundering" }),
    ).toBe("C01 - Fundering");
  });

  it("falls back to code-only or name-only when one is missing", () => {
    expect(contractLabel({ contractCode: "C01", contractName: null })).toBe(
      "C01",
    );
    expect(
      contractLabel({ contractCode: null, contractName: "Fundering" }),
    ).toBe("Fundering");
  });

  it("returns a visible placeholder when both are missing", () => {
    expect(contractLabel({ contractCode: null, contractName: null })).toBe(
      "(unnamed contract)",
    );
  });
});

describe("workAreaLabel", () => {
  it("joins code and name with a space", () => {
    expect(
      workAreaLabel({ workAreaCode: "01", workAreaName: "Fundament" }),
    ).toBe("01 Fundament");
  });
  it("handles missing code", () => {
    expect(
      workAreaLabel({ workAreaCode: null, workAreaName: "Fundament" }),
    ).toBe("Fundament");
  });
});

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

describe("buildSourceTree", () => {
  it("groups work areas under contracts, BDBs under work areas", () => {
    const tree = buildSourceTree(
      makeSummary({
        contracts: [contract(10, "C01", "Fundering")],
        workAreas: [
          {
            id: 100,
            workAreaCode: "01",
            workAreaName: "Fundament",
            contractId: 10,
          },
          {
            id: 101,
            workAreaCode: "02",
            workAreaName: "Vægge",
            contractId: 10,
          },
        ],
        bdbs: [
          { id: 200, name: "Beton", workSpecId: 100 },
          { id: 201, name: "Isolering", workSpecId: 100 },
          { id: 202, name: "Mur", workSpecId: 101 },
        ],
      }),
    );

    expect(tree.contractGroups).toHaveLength(1);
    const group = tree.contractGroups[0];
    expect(group.id).toBe(10);
    expect(group.label).toBe("C01 - Fundering");
    expect(group.workAreas.map((w) => w.id)).toEqual([100, 101]);
    expect(group.workAreas[0].bdbs.map((b) => b.id)).toEqual([200, 201]);
    expect(group.workAreas[1].bdbs.map((b) => b.id)).toEqual([202]);
    expect(tree.standaloneBdbs).toEqual([]);
  });

  it("adds a trailing '[No contract]' group for orphan work areas", () => {
    const tree = buildSourceTree(
      makeSummary({
        contracts: [contract(10, "C01", "Fundering")],
        workAreas: [
          {
            id: 100,
            workAreaCode: "01",
            workAreaName: "Fundament",
            contractId: 10,
          },
          {
            id: 101,
            workAreaCode: "99",
            workAreaName: "Orphan",
            contractId: null,
          },
        ],
      }),
    );
    expect(tree.contractGroups).toHaveLength(2);
    expect(tree.contractGroups[0].id).toBe(10);
    expect(tree.contractGroups[1].id).toBe(null);
    expect(tree.contractGroups[1].label).toBe("[No contract]");
    expect(tree.contractGroups[1].workAreas.map((w) => w.id)).toEqual([101]);
  });

  it("keeps an empty group for a contract that has no work areas", () => {
    const tree = buildSourceTree(
      makeSummary({
        contracts: [
          contract(10, "C01", "Fundering"),
          contract(20, "C02", "Empty"),
        ],
        workAreas: [
          {
            id: 100,
            workAreaCode: "01",
            workAreaName: "Fundament",
            contractId: 10,
          },
        ],
      }),
    );
    expect(tree.contractGroups).toHaveLength(2);
    const labels = tree.contractGroups.map((g) => g.label);
    expect(labels).toContain("C02 - Empty");
  });

  it("lists standalone BDBs (workSpecId=null) at the root", () => {
    const tree = buildSourceTree(
      makeSummary({
        bdbs: [
          { id: 200, name: "Zeta", workSpecId: null },
          { id: 201, name: "Alpha", workSpecId: null },
        ],
      }),
    );
    expect(tree.contractGroups).toEqual([]);
    // Sorted alphabetically.
    expect(tree.standaloneBdbs.map((b) => b.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("sorts work areas by code using numeric locale compare", () => {
    const tree = buildSourceTree(
      makeSummary({
        contracts: [contract(10, "C01", "Fundering")],
        workAreas: [
          { id: 100, workAreaCode: "10", workAreaName: "Ten", contractId: 10 },
          { id: 101, workAreaCode: "2", workAreaName: "Two", contractId: 10 },
          {
            id: 102,
            workAreaCode: "2.1",
            workAreaName: "TwoPointOne",
            contractId: 10,
          },
        ],
      }),
    );
    const codes = tree.contractGroups[0].workAreas.map((w) => w.workAreaCode);
    // "2" < "2.1" < "10" under { numeric: true }.
    expect(codes).toEqual(["2", "2.1", "10"]);
  });
});

// ---------------------------------------------------------------------------
// Landing-spot defaults
// ---------------------------------------------------------------------------

describe("defaultContractForWorkArea", () => {
  const src = [contract(1, "C01", "Fundering")];

  it("returns null when the source work area has no contract", () => {
    expect(defaultContractForWorkArea(null, src, [])).toBe(null);
  });

  it("matches on label (code + name) first", () => {
    const tgt = [
      contract(10, "C99", "Other"),
      contract(11, "C01", "Fundering"),
    ];
    expect(defaultContractForWorkArea(1, src, tgt)).toBe(11);
  });

  it("falls back to code-only match when the full label doesn't match", () => {
    const tgt = [contract(11, "C01", "Different name")];
    expect(defaultContractForWorkArea(1, src, tgt)).toBe(11);
  });

  it("returns null when nothing matches", () => {
    const tgt = [contract(11, "C99", "Other")];
    expect(defaultContractForWorkArea(1, src, tgt)).toBe(null);
  });
});

describe("defaultWorkAreaForStandaloneBdb", () => {
  it("picks the first target work area by code", () => {
    const targets = [targetWa(2, "10", "Ten"), targetWa(3, "2", "Two")];
    expect(defaultWorkAreaForStandaloneBdb(targets)).toBe(3); // "2" < "10"
  });
  it("returns null when the target has no work areas", () => {
    expect(defaultWorkAreaForStandaloneBdb([])).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe("toggleWorkArea", () => {
  const tree = buildSourceTree(
    makeSummary({
      contracts: [contract(10, "C01", "A")],
      workAreas: [
        { id: 100, workAreaCode: "01", workAreaName: "Wa", contractId: 10 },
      ],
      bdbs: [
        { id: 200, name: "A", workSpecId: 100 },
        { id: 201, name: "B", workSpecId: 100 },
      ],
    }),
  );
  const wa = tree.contractGroups[0].workAreas[0];

  it("checking a work area also checks all its BDBs", () => {
    const next = toggleWorkArea(emptyModalState(), wa, true);
    expect(next.checkedWorkAreas.has(100)).toBe(true);
    expect(next.checkedBdbs.has(200)).toBe(true);
    expect(next.checkedBdbs.has(201)).toBe(true);
  });

  it("unchecking clears the work area + its BDBs + its landing contract", () => {
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, 42);
    expect(s.landingContract.get(100)).toBe(42);
    const next = toggleWorkArea(s, wa, false);
    expect(next.checkedWorkAreas.has(100)).toBe(false);
    expect(next.checkedBdbs.size).toBe(0);
    expect(next.landingContract.has(100)).toBe(false);
  });
});

describe("toggleBdb", () => {
  it("toggles a single BDB without touching the work area check", () => {
    const s0 = {
      ...emptyModalState(),
      checkedWorkAreas: new Set([100]),
      checkedBdbs: new Set([200, 201]),
    };
    const s1 = toggleBdb(s0, 200, false);
    expect(s1.checkedWorkAreas.has(100)).toBe(true);
    expect(s1.checkedBdbs.has(200)).toBe(false);
    expect(s1.checkedBdbs.has(201)).toBe(true);
  });

  it("clears the BDB's landing work area when unchecked", () => {
    const s0 = setLandingWorkArea(
      { ...emptyModalState(), checkedBdbs: new Set([300]) },
      300,
      5,
    );
    const s1 = toggleBdb(s0, 300, false);
    expect(s1.landingWorkArea.has(300)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canCheck
// ---------------------------------------------------------------------------

describe("canCheck", () => {
  const tree = buildSourceTree(
    makeSummary({
      contracts: [contract(10, "C01", "A")],
      workAreas: [
        { id: 100, workAreaCode: "01", workAreaName: "Wa", contractId: 10 },
      ],
      bdbs: [
        { id: 200, name: "Under-wa", workSpecId: 100 },
        { id: 300, name: "Standalone", workSpecId: null },
      ],
    }),
  );

  it("is false when nothing is checked", () => {
    expect(canCheck(emptyModalState(), tree)).toBe(false);
  });

  it("is false when a checked work area has no landing contract", () => {
    const wa = tree.contractGroups[0].workAreas[0];
    const s = toggleWorkArea(emptyModalState(), wa, true);
    expect(canCheck(s, tree)).toBe(false);
  });

  it("is true once a checked work area has a contract (null counts as a choice)", () => {
    const wa = tree.contractGroups[0].workAreas[0];
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, null);
    expect(canCheck(s, tree)).toBe(true);
  });

  it("is false when a checked standalone BDB has no landing work area", () => {
    const s = toggleBdb(emptyModalState(), 300, true);
    expect(canCheck(s, tree)).toBe(false);
  });

  it("is true when the standalone BDB has a landing work area set", () => {
    let s = toggleBdb(emptyModalState(), 300, true);
    s = setLandingWorkArea(s, 300, 99);
    expect(canCheck(s, tree)).toBe(true);
  });

  it("does not require landing work areas for BDBs under a checked work area", () => {
    const wa = tree.contractGroups[0].workAreas[0];
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, null);
    // `200` is checked (cascaded) but has no landingWorkArea — that's fine.
    expect(s.checkedBdbs.has(200)).toBe(true);
    expect(s.landingWorkArea.has(200)).toBe(false);
    expect(canCheck(s, tree)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildImportPlan
// ---------------------------------------------------------------------------

describe("buildImportPlan", () => {
  const tree = buildSourceTree(
    makeSummary({
      contracts: [contract(10, "C01", "A")],
      workAreas: [
        { id: 100, workAreaCode: "01", workAreaName: "Wa", contractId: 10 },
      ],
      bdbs: [
        { id: 200, name: "Under-A", workSpecId: 100 },
        { id: 201, name: "Under-B", workSpecId: 100 },
        { id: 300, name: "Standalone", workSpecId: null },
      ],
    }),
  );
  const wa = tree.contractGroups[0].workAreas[0];

  it("omits includeBdbIds when every BDB is checked", () => {
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, 42);
    const plan = buildImportPlan(s, tree);
    expect(plan.workAreas).toHaveLength(1);
    expect(plan.workAreas[0].sourceWorkSpecId).toBe(100);
    expect(plan.workAreas[0].targetContractId).toBe(42);
    expect(plan.workAreas[0].includeBdbIds).toBeUndefined();
    expect(plan.workAreas[0].onCollision).toBe("skip");
    expect(plan.bdbs).toEqual([]);
  });

  it("lists includeBdbIds when the user unchecked a BDB", () => {
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, null);
    s = toggleBdb(s, 201, false);
    const plan = buildImportPlan(s, tree);
    expect(plan.workAreas[0].includeBdbIds).toEqual([200]);
  });

  it("produces a separate bdbs entry for each standalone BDB", () => {
    let s = toggleBdb(emptyModalState(), 300, true);
    s = setLandingWorkArea(s, 300, 7);
    const plan = buildImportPlan(s, tree);
    expect(plan.workAreas).toEqual([]);
    expect(plan.bdbs).toEqual([
      { sourceBdbId: 300, targetWorkSpecId: 7, onCollision: "skip" },
    ]);
  });

  it("applies resolutions (rename) when passed in", () => {
    let s = toggleWorkArea(emptyModalState(), wa, true);
    s = setLandingContract(s, 100, null);
    const plan = buildImportPlan(s, tree, {
      workAreas: new Map([
        [
          100,
          {
            policy: "rename",
            renamedCode: "01-new",
            renamedName: "Wa imported",
          },
        ],
      ]),
    });
    expect(plan.workAreas[0].onCollision).toBe("rename");
    expect(plan.workAreas[0].renamedCode).toBe("01-new");
    expect(plan.workAreas[0].renamedName).toBe("Wa imported");
  });
});

// ---------------------------------------------------------------------------
// Collision resolution helpers
// ---------------------------------------------------------------------------

function precheckWith(
  over: Partial<ImportPrecheckDTO> = {},
): ImportPrecheckDTO {
  return {
    workAreaCollisions: [],
    bdbCollisions: [],
    ...over,
  };
}

describe("defaultResolutions + indexCollisions", () => {
  const precheck = precheckWith({
    workAreaCollisions: [
      {
        sourceWorkSpecId: 100,
        targetWorkSpecId: 500,
        matchedOn: "code+name",
        workAreaCode: "01",
        workAreaName: "Fundament",
      },
    ],
    bdbCollisions: [
      {
        sourceBdbId: 200,
        targetBdbId: 800,
        targetWorkSpecId: 500,
        name: "Beton",
      },
    ],
  });

  // FIX-ImportMerge 2026-05-11: WA collisions default to "merge"
  // (most common intent — fold new BDBs into the WA the user has
  // already started); BDB collisions still default to "skip".
  it("defaults WA collisions to 'merge' and BDB collisions to 'skip'", () => {
    const d = defaultResolutions(precheck);
    expect(d.workAreas.get(100)?.policy).toBe("merge");
    expect(d.bdbs.get(200)?.policy).toBe("skip");
  });

  it("indexes collisions by source id", () => {
    const idx = indexCollisions(precheck);
    expect(idx.workAreaBySourceId.get(100)?.targetWorkSpecId).toBe(500);
    expect(idx.bdbBySourceId.get(200)?.targetBdbId).toBe(800);
  });
});

describe("canImport", () => {
  const precheck = precheckWith({
    workAreaCollisions: [
      {
        sourceWorkSpecId: 100,
        targetWorkSpecId: 500,
        matchedOn: "code+name",
        workAreaCode: "01",
        workAreaName: "Fundament",
      },
    ],
    bdbCollisions: [
      {
        sourceBdbId: 200,
        targetBdbId: 800,
        targetWorkSpecId: 500,
        name: "Beton",
      },
    ],
  });

  it("is true when every collision is on 'skip'", () => {
    const r = defaultResolutions(precheck);
    expect(canImport(r, precheck)).toBe(true);
  });

  it("is false when a rename has no name", () => {
    const r = defaultResolutions(precheck);
    r.workAreas.set(100, { policy: "rename", renamedName: "" });
    expect(canImport(r, precheck)).toBe(false);
  });

  it("is true when every rename has a non-empty name", () => {
    const r = defaultResolutions(precheck);
    r.workAreas.set(100, { policy: "rename", renamedName: "Imported" });
    r.bdbs.set(200, { policy: "rename", renamedName: "Beton 2" });
    expect(canImport(r, precheck)).toBe(true);
  });

  it("is true when there are no collisions at all (defaultResolutions empty)", () => {
    const empty = precheckWith();
    const r = defaultResolutions(empty);
    expect(canImport(r, empty)).toBe(true);
  });
});
