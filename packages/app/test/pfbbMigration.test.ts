/**
 * Slice 10H.6b — orphan PFBB master detection (renderer helper).
 *
 * Pure-function tests: no DOM, no IPC. Builds minimal BdbInfo /
 * WorkSpecInfo fixtures and asserts which BDB ids
 * `findOrphanPfbbMasters` flags.
 */
import { describe, expect, it } from "vitest";

import {
  computePfbbToggleHint,
  countLivePfbbChildren,
  findOrphanPfbbMasters,
  summarizeSourceWorkAreaNames,
} from "../src/renderer/src/pfbbMigration.js";
import type { BdbInfo, WorkSpecInfo } from "../src/shared/ipc.ts";

function makeBdb(overrides: Partial<BdbInfo>): BdbInfo {
  return {
    id: 1,
    name: "test",
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
    ...overrides,
  };
}

function makeWorkSpec(
  overrides: Partial<WorkSpecInfo> & { id: number },
): WorkSpecInfo {
  return {
    workAreaCode: "S100.01",
    workAreaName: "Regular work area",
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
    ...overrides,
  };
}

// Canonical virtual work_spec, as Molio ships it.
const VIRTUAL = makeWorkSpec({
  id: 999,
  workAreaCode: "S999.01",
  workAreaName: "Projektfælles bygningsdelsbeskrivelser",
});

describe("findOrphanPfbbMasters", () => {
  it("returns empty lists when there are no BDBs at all", () => {
    const result = findOrphanPfbbMasters({ bdbs: [], workSpecs: [VIRTUAL] });
    expect(result.orphanBdbIds).toEqual([]);
    expect(result.sourceWorkAreaNames).toEqual([]);
  });

  it("returns empty lists when every master already lives in the virtual work_spec", () => {
    const result = findOrphanPfbbMasters({
      bdbs: [
        makeBdb({ id: 1, isPfbb: true, pfbbId: null, workSpecId: 999 }),
        makeBdb({ id: 2, isPfbb: true, pfbbId: null, workSpecId: 999 }),
        // Regular (non-PFBB) BDB in a regular work area — not an orphan.
        makeBdb({ id: 3, isPfbb: false, workSpecId: 1 }),
      ],
      workSpecs: [VIRTUAL, makeWorkSpec({ id: 1 })],
    });
    expect(result.orphanBdbIds).toEqual([]);
    expect(result.sourceWorkAreaNames).toEqual([]);
  });

  it("flags masters that live in a regular work_spec as orphans", () => {
    const ws1 = makeWorkSpec({ id: 10, workAreaName: "Beton" });
    const ws2 = makeWorkSpec({ id: 20, workAreaName: "Tag" });
    const result = findOrphanPfbbMasters({
      bdbs: [
        // Orphan masters, one in each regular work_spec.
        makeBdb({ id: 5, isPfbb: true, pfbbId: null, workSpecId: 10 }),
        makeBdb({ id: 3, isPfbb: true, pfbbId: null, workSpecId: 20 }),
        // A subscriber with pfbbId set — NOT an orphan, even though it
        // also lives in a regular work area.
        makeBdb({ id: 7, isPfbb: true, pfbbId: 5, workSpecId: 10 }),
        // A plain BDB — not PFBB at all.
        makeBdb({ id: 8, isPfbb: false, workSpecId: 10 }),
      ],
      workSpecs: [VIRTUAL, ws1, ws2],
    });
    // Ids sorted ascending.
    expect(result.orphanBdbIds).toEqual([3, 5]);
    // Names sorted by Danish locale ("Beton" < "Tag"), deduped.
    expect(result.sourceWorkAreaNames).toEqual(["Beton", "Tag"]);
  });

  it("flags a master whose workSpecId is null (fully unassigned) as an orphan", () => {
    const result = findOrphanPfbbMasters({
      bdbs: [makeBdb({ id: 42, isPfbb: true, pfbbId: null, workSpecId: null })],
      workSpecs: [VIRTUAL],
    });
    expect(result.orphanBdbIds).toEqual([42]);
    // No source work areas to report (none to name) — list is empty.
    expect(result.sourceWorkAreaNames).toEqual([]);
  });

  it("treats a virtual work_spec identified only by CODE as virtual", () => {
    // Name is wrong, but S999.01 code matches → still the virtual row.
    const ws = makeWorkSpec({
      id: 5,
      workAreaCode: "S999.01",
      workAreaName: "Renamed by hand",
    });
    const result = findOrphanPfbbMasters({
      bdbs: [makeBdb({ id: 1, isPfbb: true, pfbbId: null, workSpecId: 5 })],
      workSpecs: [ws],
    });
    expect(result.orphanBdbIds).toEqual([]);
  });

  it("treats a virtual work_spec identified only by NAME as virtual", () => {
    // Code is missing but canonical name matches.
    const ws = makeWorkSpec({
      id: 5,
      workAreaCode: null,
      workAreaName: "Projektfælles bygningsdelsbeskrivelser",
    });
    const result = findOrphanPfbbMasters({
      bdbs: [makeBdb({ id: 1, isPfbb: true, pfbbId: null, workSpecId: 5 })],
      workSpecs: [ws],
    });
    expect(result.orphanBdbIds).toEqual([]);
  });

  it("is forgiving about casing on the virtual name", () => {
    const ws = makeWorkSpec({
      id: 5,
      workAreaCode: "s999.01",
      workAreaName: "projektfælles BYGNINGSDELSBESKRIVELSER",
    });
    const result = findOrphanPfbbMasters({
      bdbs: [makeBdb({ id: 1, isPfbb: true, pfbbId: null, workSpecId: 5 })],
      workSpecs: [ws],
    });
    expect(result.orphanBdbIds).toEqual([]);
  });

  it("does NOT match substrings (so 'Projektfælles (KOPI)' is still a regular work_spec)", () => {
    // Important defensive case: a user who renamed the virtual row
    // must NOT silently still count as virtual — detection should
    // bail out and flag its PFBB masters as orphans instead.
    const ws = makeWorkSpec({
      id: 5,
      workAreaCode: "S999.01 (kopi)",
      workAreaName: "Projektfælles bygningsdelsbeskrivelser (KOPI)",
    });
    const result = findOrphanPfbbMasters({
      bdbs: [makeBdb({ id: 77, isPfbb: true, pfbbId: null, workSpecId: 5 })],
      workSpecs: [ws],
    });
    expect(result.orphanBdbIds).toEqual([77]);
    expect(result.sourceWorkAreaNames).toEqual([
      "Projektfælles bygningsdelsbeskrivelser (KOPI)",
    ]);
  });
});

describe("summarizeSourceWorkAreaNames", () => {
  it("returns empty string for an empty list", () => {
    expect(summarizeSourceWorkAreaNames([])).toBe("");
  });

  it("quotes a single name", () => {
    expect(summarizeSourceWorkAreaNames(["Beton"])).toBe("'Beton'");
  });

  it("joins two names with 'and'", () => {
    expect(summarizeSourceWorkAreaNames(["Beton", "Tag"])).toBe(
      "'Beton' and 'Tag'",
    );
  });

  it("joins three names with commas + Oxford 'and'", () => {
    expect(summarizeSourceWorkAreaNames(["A", "B", "C"])).toBe(
      "'A', 'B', and 'C'",
    );
  });

  it("shows first three names + overflow count when 4 given", () => {
    expect(summarizeSourceWorkAreaNames(["A", "B", "C", "D"])).toBe(
      "'A', 'B', 'C', and 1 more",
    );
  });

  it("shows first three names + overflow count when many given", () => {
    expect(summarizeSourceWorkAreaNames(["A", "B", "C", "D", "E", "F"])).toBe(
      "'A', 'B', 'C', and 3 more",
    );
  });
});

describe("computePfbbToggleHint (Slice 10H.6c)", () => {
  it("returns 'none' when nothing relevant changed", () => {
    // Was off, still off.
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 0,
        isPfbb: false,
        currentWorkSpecIsVirtual: false,
      }),
    ).toEqual({ kind: "none" });
    // Was on, still on.
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 1,
        isPfbb: true,
        currentWorkSpecIsVirtual: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns 'info' when toggling ON from a regular work_spec", () => {
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 0,
        isPfbb: true,
        currentWorkSpecIsVirtual: false,
      }),
    ).toEqual({ kind: "info" });
  });

  it("returns 'none' when toggling ON but BDB is already in virtual", () => {
    // Rare but possible — nothing to tell the user; no move needed.
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 0,
        isPfbb: true,
        currentWorkSpecIsVirtual: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns 'block' when toggling OFF on a BDB in the virtual row", () => {
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 1,
        isPfbb: false,
        currentWorkSpecIsVirtual: true,
      }),
    ).toEqual({ kind: "block" });
  });

  it("returns 'none' when toggling OFF on a BDB in a regular row", () => {
    // A PFBB child (is_pfbb=1 + pfbb_id!=null) typically lives in a
    // regular work_spec — we don't block that. (Wider guards for
    // children are Slice 10H.9 scope.)
    expect(
      computePfbbToggleHint({
        originalIsPfbb: 1,
        isPfbb: false,
        currentWorkSpecIsVirtual: false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("countLivePfbbChildren (Slice 10H.8)", () => {
  const pendNever = (_id: number) => false;

  it("returns 0 when there are no BDBs", () => {
    expect(countLivePfbbChildren([], 5, pendNever)).toBe(0);
  });

  it("returns 0 when no BDB points at the given master", () => {
    expect(
      countLivePfbbChildren(
        [makeBdb({ id: 1, pfbbId: null }), makeBdb({ id: 2, pfbbId: 99 })],
        5,
        pendNever,
      ),
    ).toBe(0);
  });

  it("counts every BDB whose pfbbId matches the master", () => {
    expect(
      countLivePfbbChildren(
        [
          makeBdb({ id: 1, pfbbId: 5 }),
          makeBdb({ id: 2, pfbbId: 5 }),
          makeBdb({ id: 3, pfbbId: 99 }),
          makeBdb({ id: 4, pfbbId: null }),
        ],
        5,
        pendNever,
      ),
    ).toBe(2);
  });

  it("excludes children already marked for deletion", () => {
    // Child 1 and 2 point at master 5; user has marked child 2 for
    // deletion in the edit buffer. Only child 1 is live.
    const pendingDeleteIds = new Set([2]);
    const isPending = (id: number) => pendingDeleteIds.has(id);
    expect(
      countLivePfbbChildren(
        [
          makeBdb({ id: 1, pfbbId: 5 }),
          makeBdb({ id: 2, pfbbId: 5 }),
          makeBdb({ id: 3, pfbbId: 99 }),
        ],
        5,
        isPending,
      ),
    ).toBe(1);
  });

  it("returns 0 when every child is already marked for deletion", () => {
    const pendingDeleteIds = new Set([1, 2]);
    expect(
      countLivePfbbChildren(
        [makeBdb({ id: 1, pfbbId: 5 }), makeBdb({ id: 2, pfbbId: 5 })],
        5,
        (id) => pendingDeleteIds.has(id),
      ),
    ).toBe(0);
  });
});
