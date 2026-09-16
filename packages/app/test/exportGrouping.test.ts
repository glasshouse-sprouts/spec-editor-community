/**
 * Unit tests for the PDF export grouping helper.
 *
 * The helper is pure data-in / data-out — no IO, no PDF runtime. We
 * synthesise tiny `ExportTree` + `ExportSelection` fixtures and check
 * the shape of the returned job plans for each `groupBy` value.
 *
 * Coverage:
 *   - `perSpec` preserves today's "one PDF per checked target" behaviour.
 *   - `perWorkArea` rolls checked BDBs up into a single composite PDF
 *     per WA, and always includes the WA chapter when there's any
 *     descendant in scope.
 *   - `perContract` does the same per contract.
 *   - `perProject` produces exactly one composite job for the whole
 *     selection.
 *   - Filenames always begin with the project name.
 *   - Control plans become standalone single jobs in ALL four modes
 *     (Task 109). Before 2026-09-09 every test in this file passed
 *     `cps: new Set()`, so the helper was never once asked about a
 *     control plan and the green suite only meant "what is tested
 *     works". The last describe block guards against a repeat.
 */
import { describe, expect, it } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import type {
  ExportSelection,
  ExportTree,
} from "../src/renderer/src/exportTree.js";
import { emptySelection } from "../src/renderer/src/exportTree.js";
import {
  buildPdfExportJobs,
  type ExportGroupBy,
} from "../src/renderer/src/exportGrouping.js";
import { dedupeFileBases } from "../src/shared/pdfExportUtils.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function tree(): ExportTree {
  return {
    contractGroups: [
      {
        id: 1,
        label: "01 - Neutrale",
        workAreas: [
          {
            id: 10,
            label: "S240.01 — Vinduer",
            bdbs: [
              { id: 100, label: "BDB Alpha" },
              { id: 101, label: "BDB Beta" },
            ],
          },
          {
            id: 11,
            label: "S250.01 — Døre",
            bdbs: [{ id: 110, label: "BDB Gamma" }],
          },
        ],
      },
      {
        id: 2,
        label: "02 - Produktspecifikke",
        workAreas: [
          {
            id: 20,
            label: "S240.01 — Vinduer",
            bdbs: [{ id: 200, label: "BDB Delta" }],
          },
        ],
      },
    ],
    standaloneBdbs: [],
    // CP 300 and CP 302 deliberately share a label — that is the
    // filename-collision case. CP 303 is homeless: no BDB references
    // it, which happens when the owning BDB was deleted under it.
    controlPlans: [
      {
        id: 300,
        label: "3.1  Kontrolplan Vinduer",
        ownerLabel: "S240.01 — Vinduer · BDB Alpha",
        owningBdbId: 100,
      },
      {
        id: 301,
        label: "3.2  Kontrolplan Delta",
        ownerLabel: "S240.01 — Vinduer · BDB Delta",
        owningBdbId: 200,
      },
      {
        id: 302,
        label: "3.1  Kontrolplan Vinduer",
        ownerLabel: "S250.01 — Døre · BDB Gamma",
        owningBdbId: 110,
      },
      {
        id: 303,
        label: "9.9  Hjemløs kontrolplan",
        ownerLabel: null,
        owningBdbId: null,
      },
    ],
  };
}

function selection(
  parts: Partial<{
    workAreas: number[];
    bdbs: number[];
    cps: number[];
  }>,
): ExportSelection {
  return {
    workAreas: new Set(parts.workAreas ?? []),
    bdbs: new Set(parts.bdbs ?? []),
    cps: new Set(parts.cps ?? []),
  };
}

function payload(): FilePayload {
  // The grouping helper only touches `data.project.name`; everything
  // else is plumbed through unused in this test set.
  return {
    path: "/tmp/x.moliospec",
    project: {
      project_guid: "g",
      name: "TestProject",
      project_number: "1",
      builder: null,
      created_date: null,
      modified_date: null,
      molio_referencelist_date: null,
    },
    contracts: [],
    workSpecs: [],
    bdbs: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    controlPlans: [],
    controlPlanSectionHeaders: [],
    controlPlanSections: [],
    attachments: [],
    dbVersion: "01.00.04",
  } as unknown as FilePayload;
}

function runJobs(
  sel: ExportSelection,
  groupBy: ExportGroupBy,
): ReturnType<typeof buildPdfExportJobs> {
  return buildPdfExportJobs({
    data: payload(),
    tree: tree(),
    selection: sel,
    groupBy,
  });
}

// ---------------------------------------------------------------------------
// perSpec
// ---------------------------------------------------------------------------

describe("buildPdfExportJobs — perSpec", () => {
  it("emits one job per checked WA + one per checked BDB", () => {
    const sel = selection({ workAreas: [10], bdbs: [100, 200] });
    const jobs = runJobs(sel, "perSpec");
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.kind === "single")).toBe(true);
  });

  it("filenames begin with the project name", () => {
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perSpec");
    expect(jobs[0]!.filename.startsWith("TestProject_")).toBe(true);
    expect(jobs[0]!.filename.endsWith(".pdf")).toBe(true);
  });

  it("attaches the contract label to each single job", () => {
    const sel = selection({ bdbs: [100, 200] });
    const jobs = runJobs(sel, "perSpec");
    const j1 = jobs[0]!;
    const j2 = jobs[1]!;
    expect(j1.kind === "single" ? j1.contractLabel : null).toBe(
      "01 - Neutrale",
    );
    expect(j2.kind === "single" ? j2.contractLabel : null).toBe(
      "02 - Produktspecifikke",
    );
  });

  it("returns an empty list when nothing is checked", () => {
    expect(runJobs(selection({}), "perSpec")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// perWorkArea
// ---------------------------------------------------------------------------

describe("buildPdfExportJobs — perWorkArea", () => {
  it("one composite per WA with any descendant selected", () => {
    // Check two BDBs, one in WA 10, one in WA 20. Expect 2 PDFs.
    const sel = selection({ bdbs: [100, 200] });
    const jobs = runJobs(sel, "perWorkArea");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.kind === "composite")).toBe(true);
  });

  it("includes the WA's own chapter as the first chapter (even when only BDBs were checked)", () => {
    const sel = selection({ bdbs: [100, 101] });
    const jobs = runJobs(sel, "perWorkArea");
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    if (job.kind !== "composite") throw new Error("expected composite");
    expect(job.chapters[0]).toEqual({
      kind: "workSpec",
      targetId: 10,
      title: "S240.01 — Vinduer",
      subtitle: null,
    });
    expect(job.chapters.slice(1).map((c) => c.targetId)).toEqual([100, 101]);
  });

  it("emits a WA-only PDF when only the WA is checked (no BDBs)", () => {
    const sel = selection({ workAreas: [10] });
    const jobs = runJobs(sel, "perWorkArea");
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    if (job.kind !== "composite") throw new Error("expected composite");
    expect(job.chapters).toHaveLength(1);
    expect(job.chapters[0]!.kind).toBe("workSpec");
  });

  it("filename starts with the project name + uses the WA label", () => {
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perWorkArea");
    // The WA label is "S240.01 — Vinduer" (em-dash). `sanitiseFilePart`
    // normalises every fancy dash to a plain ASCII hyphen, so the
    // filename uses "-" even though the label uses "—".
    expect(jobs[0]!.filename).toBe("TestProject_S240.01 - Vinduer.pdf");
  });

  it("cover carries the contract label as the subtitle", () => {
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perWorkArea");
    const j = jobs[0]!;
    if (j.kind !== "composite") throw new Error("expected composite");
    expect(j.cover.subtitle).toBe("01 - Neutrale");
  });

  it("returns an empty list when nothing is checked", () => {
    expect(runJobs(selection({}), "perWorkArea")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// perContract
// ---------------------------------------------------------------------------

describe("buildPdfExportJobs — perContract", () => {
  it("one composite per contract with any descendant selected", () => {
    const sel = selection({ bdbs: [100, 200] });
    const jobs = runJobs(sel, "perContract");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.kind === "composite")).toBe(true);
  });

  it("contract with multiple WAs in scope concatenates WA + its BDBs", () => {
    // Check BDB 100 (WA 10) AND BDB 110 (WA 11) — same contract.
    // Expect one composite with: WA-10 chapter, BDB-100 chapter,
    // WA-11 chapter, BDB-110 chapter.
    const sel = selection({ bdbs: [100, 110] });
    const jobs = runJobs(sel, "perContract");
    expect(jobs).toHaveLength(1);
    const j = jobs[0]!;
    if (j.kind !== "composite") throw new Error("expected composite");
    expect(j.chapters.map((c) => ({ kind: c.kind, id: c.targetId }))).toEqual([
      { kind: "workSpec", id: 10 },
      { kind: "bdb", id: 100 },
      { kind: "workSpec", id: 11 },
      { kind: "bdb", id: 110 },
    ]);
  });

  it("skips a WA that has no selected descendants", () => {
    // Check only BDB-100. WA-11 (no descendants in scope) is dropped.
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perContract");
    const j = jobs[0]!;
    if (j.kind !== "composite") throw new Error("expected composite");
    const wsTargets = j.chapters.filter((c) => c.kind === "workSpec");
    expect(wsTargets.map((c) => c.targetId)).toEqual([10]);
  });

  it("filename starts with the project name + uses the contract label", () => {
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perContract");
    expect(jobs[0]!.filename).toBe("TestProject_01 - Neutrale.pdf");
  });

  it("returns an empty list when nothing is checked", () => {
    expect(runJobs(selection({}), "perContract")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// perProject
// ---------------------------------------------------------------------------

describe("buildPdfExportJobs — perProject", () => {
  it("emits exactly one composite job for the whole selection", () => {
    const sel = selection({ bdbs: [100, 110, 200] });
    const jobs = runJobs(sel, "perProject");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("composite");
  });

  it("filename is just the project name", () => {
    const sel = selection({ bdbs: [100] });
    const jobs = runJobs(sel, "perProject");
    expect(jobs[0]!.filename).toBe("TestProject.pdf");
  });

  it("concatenates chapters across contracts in tree order", () => {
    const sel = selection({ bdbs: [100, 200] });
    const jobs = runJobs(sel, "perProject");
    const j = jobs[0]!;
    if (j.kind !== "composite") throw new Error("expected composite");
    expect(j.chapters.map((c) => ({ kind: c.kind, id: c.targetId }))).toEqual([
      { kind: "workSpec", id: 10 },
      { kind: "bdb", id: 100 },
      { kind: "workSpec", id: 20 },
      { kind: "bdb", id: 200 },
    ]);
  });

  it("returns an empty list when nothing is checked", () => {
    expect(runJobs(selection({}), "perProject")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Control plans (Task 109)
//
// The rule Tore set on 2026-09-09: a checked control plan is ALWAYS its
// own PDF, in every grouping mode, never a chapter inside a composite.
// ---------------------------------------------------------------------------

describe("buildPdfExportJobs — control plans", () => {
  it("perSpec: a lone checked control plan produces one single job", () => {
    const jobs = runJobs(selection({ cps: [300] }), "perSpec");
    expect(jobs).toHaveLength(1);
    const j = jobs[0]!;
    if (j.kind !== "single") throw new Error("expected single");
    expect(j.target).toEqual({ kind: "cp", id: 300 });
  });

  it("perSpec: a control plan AND a BDB produce two jobs", () => {
    const jobs = runJobs(selection({ bdbs: [100], cps: [300] }), "perSpec");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.kind === "single")).toBe(true);
    expect(jobs.map((j) => (j.kind === "single" ? j.target : null))).toEqual([
      { kind: "bdb", id: 100 },
      { kind: "cp", id: 300 },
    ]);
  });

  it("perWorkArea: the composite is joined by a standalone CP job", () => {
    const jobs = runJobs(selection({ bdbs: [100], cps: [300] }), "perWorkArea");
    expect(jobs.map((j) => j.kind)).toEqual(["composite", "single"]);
    const composite = jobs[0]!;
    if (composite.kind !== "composite") throw new Error("expected composite");
    // The CP is NOT folded into the composite as a chapter.
    expect(composite.chapters.map((c) => c.kind)).toEqual(["workSpec", "bdb"]);
  });

  it("perContract: the composite is joined by a standalone CP job", () => {
    const jobs = runJobs(selection({ bdbs: [100], cps: [300] }), "perContract");
    expect(jobs.map((j) => j.kind)).toEqual(["composite", "single"]);
    const composite = jobs[0]!;
    if (composite.kind !== "composite") throw new Error("expected composite");
    expect(composite.chapters.map((c) => c.kind)).toEqual(["workSpec", "bdb"]);
  });

  it("perProject: the composite is joined by a standalone CP job", () => {
    const jobs = runJobs(selection({ bdbs: [100], cps: [300] }), "perProject");
    expect(jobs.map((j) => j.kind)).toEqual(["composite", "single"]);
    const composite = jobs[0]!;
    if (composite.kind !== "composite") throw new Error("expected composite");
    expect(composite.chapters.map((c) => c.kind)).toEqual(["workSpec", "bdb"]);
  });

  it("perProject: a CP-only selection produces no composite at all", () => {
    const jobs = runJobs(selection({ cps: [300] }), "perProject");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("single");
  });

  it("filename follows the same <project>_<label>.pdf pattern", () => {
    const jobs = runJobs(selection({ cps: [300] }), "perSpec");
    expect(jobs[0]!.filename).toBe("TestProject_3.1  Kontrolplan Vinduer.pdf");
  });

  it("two control plans with the same title get distinct filenames", () => {
    // The planner itself emits the colliding names — de-duplication is
    // the executor's job, via the shared helper it already runs over
    // every batch. This asserts the pair actually survives that step.
    const jobs = runJobs(selection({ cps: [300, 302] }), "perSpec");
    expect(jobs).toHaveLength(2);
    const bases = jobs.map((j) => j.filename.replace(/\.pdf$/i, ""));
    expect(bases[0]).toBe(bases[1]);
    const deduped = dedupeFileBases(bases);
    expect(new Set(deduped).size).toBe(2);
    expect(deduped[1]).toBe(`${bases[1]}-1`);
  });

  it("carries the owning BDB's contract label", () => {
    const jobs = runJobs(selection({ cps: [300, 301] }), "perSpec");
    expect(
      jobs.map((j) => (j.kind === "single" ? j.contractLabel : null)),
    ).toEqual(["01 - Neutrale", "02 - Produktspecifikke"]);
  });

  it("a homeless control plan still gets a job, with no contract", () => {
    const jobs = runJobs(selection({ cps: [303] }), "perSpec");
    expect(jobs).toHaveLength(1);
    const j = jobs[0]!;
    if (j.kind !== "single") throw new Error("expected single");
    expect(j.target).toEqual({ kind: "cp", id: 303 });
    expect(j.contractLabel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The guard that is not about this bug, but about the next one.
//
// Task 109 was a whole kind of tick that never reached the planner. The
// two tests below make that shape of mistake loud: the first fails the
// moment a fourth Set is added to `ExportSelection` (naming it, and
// asking for a fixture id), the second then fails until the planner
// actually emits a job for it in every grouping mode.
//
// What this does NOT cover: a selection kind that is added somewhere
// other than `ExportSelection`. That is the only door left, and it is
// a narrow one — `ExportSelection` is the type every surface (modal,
// MCP bridge, Word export) builds its selection into.
// ---------------------------------------------------------------------------

/** One id per selection kind that exists in the `tree()` fixture. */
const FIXTURE_ID_BY_SELECTION_KIND: Record<string, number> = {
  workAreas: 10,
  bdbs: 100,
  cps: 300,
};

const ALL_MODES: ExportGroupBy[] = [
  "perSpec",
  "perWorkArea",
  "perContract",
  "perProject",
];

describe("buildPdfExportJobs — every kind of tick reaches the planner", () => {
  it("has a fixture id for every kind in ExportSelection", () => {
    // If this fails, a new kind of tick was added to ExportSelection.
    // Add an id for it to FIXTURE_ID_BY_SELECTION_KIND that exists in
    // the tree() fixture, then make the test below pass.
    expect(Object.keys(emptySelection()).sort()).toEqual(
      Object.keys(FIXTURE_ID_BY_SELECTION_KIND).sort(),
    );
  });

  for (const mode of ALL_MODES) {
    it(`${mode}: each kind on its own produces at least one job`, () => {
      for (const kind of Object.keys(emptySelection())) {
        const id = FIXTURE_ID_BY_SELECTION_KIND[kind];
        expect(id, `no fixture id for selection kind "${kind}"`).toBeDefined();
        const sel = {
          ...emptySelection(),
          [kind]: new Set([id]),
        } as ExportSelection;
        expect(
          runJobs(sel, mode).length,
          `a lone "${kind}" tick produced no job in ${mode}`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
