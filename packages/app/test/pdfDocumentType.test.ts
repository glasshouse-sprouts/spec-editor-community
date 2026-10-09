/**
 * Task 147 - the document type on the PDF cover.
 *
 * Owner's decisions 2026-10-08: the type stands on its own small grey
 * line ABOVE the title, value only (no "Dokumenttype:" label). It is
 * derived from the file and from what the export contains, never chosen
 * in the export dialog. The "Type: ..." line under the title in the body
 * shows the same value as the cover.
 *
 *   1. the three work-area values match Molio's seeds in core
 *   2. the five single-file values, on the cover and in the "Type:" line
 *   3. every row of the approved table for composite PDFs (card 147)
 *   4. the version summary: "Ændringsoversigt" once, no repeated subtitle
 *   5. the value travels through the real export path (file -> export
 *      job -> builder): single and composite
 *   6. the line sits above the title without moving the title down
 *   8. B2.1: a custom cover's "Dokumenttype" field gets exactly the value
 *      the built-in cover prints - five single values, every composite row
 *   7. row 4 of the running header (page 2 on) shows the same type for a
 *      work-area PDF (owner 2026-10-08), and the BDB's name for a BDB
 *
 * A custom cover (.speccustom) replaces the built-in one and so has no
 * document-type line. That is accepted (prompt 1.0.4, part B) and not
 * tested here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { CANONICAL_SEEDS } from "@molio2-editor/core";

const renderSpecPdf = vi.fn(async (_args: unknown) => new Uint8Array([1]));
const renderCompositePdf = vi.fn(async (_args: unknown) => new Uint8Array([2]));
const renderCpPdf = vi.fn(async (_args: unknown) => new Uint8Array([3]));
vi.mock("../src/renderer/src/pdf/renderPdf.js", async (orig) => ({
  ...(await orig<object>()),
  renderSpecPdf: (args: unknown) => renderSpecPdf(args),
  renderCompositePdf: (args: unknown) => renderCompositePdf(args),
  renderCpPdf: (args: unknown) => renderCpPdf(args),
}));

import type {
  BdbInfo,
  FilePayload,
  ReferenceLinks,
  SectionData,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  WORK_AREA_TYPE_LABELS,
  workAreaTypeLabel,
} from "../src/renderer/src/pdf/documentTypes.js";
import {
  buildSpecPdf,
  type BuildSpecPdfArgs,
} from "../src/renderer/src/pdf/buildSpecPdf.js";
import {
  buildCompositePdf,
  type BuildCompositePdfArgs,
} from "../src/renderer/src/pdf/buildCompositePdf.js";
import {
  buildCpPdf,
  type BuildCpPdfArgs,
} from "../src/renderer/src/pdf/buildCpPdf.js";
import { buildVersionSummaryPdf } from "../src/renderer/src/pdf/buildVersionSummaryPdf.js";
import { makeCover } from "../src/renderer/src/pdf/pdfChrome.js";
import {
  buildExportTree,
  emptySelection,
  type ExportSelection,
} from "../src/renderer/src/exportTree.js";
import {
  buildPdfExportJobs,
  type ExportGroupBy,
  type PdfExportJob,
} from "../src/renderer/src/exportGrouping.js";
import { buildBytesFor, buildTargets } from "../src/renderer/src/ExportCard.js";
import { buildBytesForCompositeJob } from "../src/renderer/src/executeCompositeExport.js";

const identity = (html: string): Content => ({ text: html });

const sections: SectionData[] = [
  {
    id: 1,
    sectionNo: 1,
    heading: "Omfang",
    body: "<p>x</p>",
    parentId: null,
    pfbbSectionId: null,
  },
];

/** The cover's nodes: everything up to and including the page break. */
function coverNodes(doc: TDocumentDefinitions): Content[] {
  const out: Content[] = [];
  for (const node of doc.content as Content[]) {
    out.push(node);
    if ((node as { pageBreak?: string }).pageBreak === "after") break;
  }
  return out;
}

function nodeText(n: Content): string {
  const t = (n as { text?: unknown }).text;
  return typeof t === "string" ? t : "";
}

/** The document-type line: the small grey line right above the title. */
function coverDocType(doc: TDocumentDefinitions): string | null {
  const nodes = coverNodes(doc);
  const titleIdx = nodes.findIndex(
    (n) => (n as { fontSize?: number }).fontSize === 26,
  );
  expect(titleIdx).toBeGreaterThan(0);
  const above = nodes[titleIdx - 1] as { fontSize?: number; color?: string };
  if (above.fontSize !== 10) return null;
  expect(above.color).toBe("#666");
  return nodeText(above as Content);
}

/** The body's "Type: ..." metadata value(s). */
function metaTypes(doc: TDocumentDefinitions): string[] {
  return (doc.content as Content[])
    .filter((n) => (n as { style?: string }).style === "meta")
    .map((n) => /^Type: ([^·]+?)(\s+·|$)/.exec(nodeText(n))?.[1] ?? "");
}

function specDoc(
  kind: "workSpec" | "bdb",
  workAreaType: number | null,
): TDocumentDefinitions {
  return buildSpecPdf({
    kind,
    workAreaType,
    title: "Titel",
    projectName: "Projekt",
    includeCoverPage: true,
    sections,
    htmlConverter: identity,
  });
}

// ---------------------------------------------------------------------------
// 1. Molio's seeds
// ---------------------------------------------------------------------------

describe("work-area type labels", () => {
  it("are spelled exactly as Molio's seeds in core (CANONICAL_SEEDS)", () => {
    const seeds = Object.fromEntries(
      CANONICAL_SEEDS.work_area_type!.map((r) => [r[0], r[1]]),
    );
    expect(WORK_AREA_TYPE_LABELS).toEqual(seeds);
  });

  it("falls back to Arbejdsbeskrivelse for a missing or unknown type", () => {
    expect(workAreaTypeLabel(null)).toBe("Arbejdsbeskrivelse");
    expect(workAreaTypeLabel(undefined)).toBe("Arbejdsbeskrivelse");
    expect(workAreaTypeLabel(7)).toBe("Arbejdsbeskrivelse");
  });
});

// ---------------------------------------------------------------------------
// 2. The five single-file values
// ---------------------------------------------------------------------------

describe("single PDFs: document type on the cover and in the Type line", () => {
  const cases: Array<[string, () => TDocumentDefinitions, string]> = [
    ["work area type 0", () => specDoc("workSpec", 0), "Arbejdsbeskrivelse"],
    ["work area type 1", () => specDoc("workSpec", 1), "Fælles beskrivelse"],
    [
      "work area type 2",
      () => specDoc("workSpec", 2),
      "Paradigme for arbejdsbeskrivelse",
    ],
    ["BDB", () => specDoc("bdb", null), "Bygningsdelsbeskrivelse"],
    [
      "control plan",
      () =>
        buildCpPdf({
          numberText: "1",
          title: "Kontrol",
          ownerLabel: "Ejer",
          includeCoverPage: true,
          headers: [],
          rows: [],
        }),
      "Kontrolplan",
    ],
  ];
  for (const [name, build, expected] of cases) {
    it(`${name}: "${expected}"`, () => {
      const doc = build();
      expect(coverDocType(doc)).toBe(expected);
      expect(metaTypes(doc)).toEqual([expected]);
    });
  }

  it("a BDB ignores a work-area type passed by mistake", () => {
    expect(coverDocType(specDoc("bdb", 1))).toBe("Bygningsdelsbeskrivelse");
  });

  it("the control plan keeps its owner line under the title", () => {
    const doc = buildCpPdf({
      numberText: "1",
      title: "Kontrol",
      ownerLabel: "Ejer",
      includeCoverPage: true,
      headers: [],
      rows: [],
    });
    expect(coverNodes(doc).map(nodeText)).toContain("Ejer");
  });
});

// ---------------------------------------------------------------------------
// 3. Composite PDFs - the approved table on card 147
// ---------------------------------------------------------------------------

const EMPTY_REFS: ReferenceLinks = {
  basisGuid: null,
  basisRevisionGuid: null,
  paradigmGuid: null,
  paradigmRevisionGuid: null,
  referencelistArea: null,
  referencelistAreaDate: null,
};

function ws(id: number, type: number, name: string): WorkSpecInfo {
  return {
    id,
    workAreaCode: `S${id}`,
    workAreaName: name,
    workAreaType: type,
    revision: null,
    revisionDate: null,
    contractId: 1,
    refs: EMPTY_REFS,
  } as WorkSpecInfo;
}

function bdb(id: number, workSpecId: number | null): BdbInfo {
  return {
    id,
    name: `BDB ${id}`,
    workSpecId,
    isPfbb: false,
    pfbbId: null,
    revision: null,
    revisionDate: null,
    controlPlanIds: [],
    refs: EMPTY_REFS,
  } as BdbInfo;
}

/** WA 10 Arbejdsbeskrivelse (BDB 100), WA 11 Fælles beskrivelse (BDB 110),
 *  WA 12 Paradigme, and standalone BDB 900. */
function payload(): FilePayload {
  return {
    path: "/tmp/fake.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: { name: "Projekt", builder: null },
    contracts: [{ id: 1, contractCode: "E11", contractName: "Råhus" }],
    workSpecs: [
      ws(10, 0, "Beton"),
      ws(11, 1, "Fælles"),
      ws(12, 2, "Paradigme"),
    ],
    bdbs: [bdb(100, 10), bdb(110, 11), bdb(900, null)],
    controlPlans: [],
    attachments: [],
    sectionsByWorkSpec: { 10: sections, 11: sections, 12: sections },
    sectionsByBdb: { 100: sections, 110: sections, 900: sections },
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
  } as unknown as FilePayload;
}

function sel(workAreas: number[], bdbs: number[]): ExportSelection {
  const s = emptySelection();
  for (const id of workAreas) s.workAreas.add(id);
  for (const id of bdbs) s.bdbs.add(id);
  return s;
}

function compositeJob(
  groupBy: ExportGroupBy,
  selection: ExportSelection,
): Extract<PdfExportJob, { kind: "composite" }> {
  const data = payload();
  const jobs = buildPdfExportJobs({
    data,
    tree: buildExportTree(data),
    selection,
    groupBy,
  });
  const composites = jobs.filter(
    (j): j is Extract<PdfExportJob, { kind: "composite" }> =>
      j.kind === "composite",
  );
  expect(composites).toHaveLength(1);
  return composites[0]!;
}

/** The approved table on card 147 - one row per composite case. */
const COMPOSITE_ROWS: Array<[string, ExportGroupBy, ExportSelection, string]> =
  [
    [
      "per work area, WA only (type 0)",
      "perWorkArea",
      sel([10], []),
      "Arbejdsbeskrivelse",
    ],
    [
      "per work area, WA only (type 1)",
      "perWorkArea",
      sel([11], []),
      "Fælles beskrivelse",
    ],
    [
      "per work area, WA only (type 2)",
      "perWorkArea",
      sel([12], []),
      "Paradigme for arbejdsbeskrivelse",
    ],
    [
      "per work area, WA + BDB (type 0)",
      "perWorkArea",
      sel([10], [100]),
      "Arbejdsbeskrivelse med bygningsdelsbeskrivelser",
    ],
    [
      "per work area, WA + BDB (type 1)",
      "perWorkArea",
      sel([11], [110]),
      "Fælles beskrivelse med bygningsdelsbeskrivelser",
    ],
    [
      "per contract, WAs only",
      "perContract",
      sel([10, 11], []),
      "Samlede arbejdsbeskrivelser for entreprisen",
    ],
    [
      "per contract, WAs + BDBs",
      "perContract",
      sel([10], [110]),
      "Samlede arbejds- og bygningsdelsbeskrivelser for entreprisen",
    ],
    [
      "whole project, WAs only",
      "perProject",
      sel([10, 12], []),
      "Samlede arbejdsbeskrivelser for projektet",
    ],
    [
      "whole project, WAs + BDBs",
      "perProject",
      sel([10], [100, 900]),
      "Samlede arbejds- og bygningsdelsbeskrivelser for projektet",
    ],
    [
      "whole project, standalone BDBs only",
      "perProject",
      sel([], [900]),
      "Samlede bygningsdelsbeskrivelser for projektet",
    ],
  ];

describe("composite PDFs: the approved table", () => {
  for (const [name, groupBy, selection, expected] of COMPOSITE_ROWS) {
    it(`${name}: "${expected}"`, () => {
      const job = compositeJob(groupBy, selection);
      expect(job.cover.documentType).toBe(expected);
    });
  }

  it("the composite builder prints the job's text above the cover title", () => {
    const doc = buildCompositePdf({
      cover: {
        documentType: "Samlede arbejdsbeskrivelser for entreprisen",
        title: "E11 - Råhus",
      },
      chapters: [
        { kind: "workSpec", workAreaType: 1, title: "S11 Fælles", sections },
      ],
      htmlConverter: identity,
    });
    expect(coverDocType(doc)).toBe(
      "Samlede arbejdsbeskrivelser for entreprisen",
    );
    // Each chapter's Type line still shows the chapter's own type.
    expect(metaTypes(doc)).toEqual(["Fælles beskrivelse"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Version summary
// ---------------------------------------------------------------------------

describe("version summary", () => {
  it('has "Ændringsoversigt" as the document type, once on the cover', () => {
    const doc = buildVersionSummaryPdf({
      projectName: "Projekt",
      referenceLabel: "gammel.moliospec",
      revisions: [],
    });
    expect(coverDocType(doc)).toBe("Ændringsoversigt");
    const cover = coverNodes(doc).map(nodeText);
    expect(cover.filter((t) => t === "Ændringsoversigt")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Through the real export path
// ---------------------------------------------------------------------------

beforeEach(() => {
  renderSpecPdf.mockClear();
  renderCompositePdf.mockClear();
});

describe("the type travels from the file to the PDF", () => {
  it("single export: a Fælles beskrivelse gets its own type", async () => {
    const data = payload();
    const target = buildTargets(data).find(
      (t) => t.kind === "workSpec" && t.id === 11,
    )!;
    await buildBytesFor(data, target, {
      includeCoverPage: true,
      compact: false,
    });
    const args = renderSpecPdf.mock.calls[0]![0] as Omit<
      BuildSpecPdfArgs,
      "htmlConverter"
    >;
    expect(args.workAreaType).toBe(1);
    const doc = buildSpecPdf({ ...args, htmlConverter: identity });
    expect(coverDocType(doc)).toBe("Fælles beskrivelse");
    expect(metaTypes(doc)).toEqual(["Fælles beskrivelse"]);
  });

  it("composite export: cover text from the job, chapter types from the file", async () => {
    const data = payload();
    const job = compositeJob("perContract", sel([10, 11], [110]));
    await buildBytesForCompositeJob(data, job, {
      includeCoverPage: true,
      compact: false,
    });
    const args = renderCompositePdf.mock.calls[0]![0] as Omit<
      BuildCompositePdfArgs,
      "htmlConverter"
    >;
    expect(args.cover.documentType).toBe(
      "Samlede arbejds- og bygningsdelsbeskrivelser for entreprisen",
    );
    const doc = buildCompositePdf({ ...args, htmlConverter: identity });
    expect(coverDocType(doc)).toBe(
      "Samlede arbejds- og bygningsdelsbeskrivelser for entreprisen",
    );
    expect(metaTypes(doc)).toEqual([
      "Arbejdsbeskrivelse",
      "Fælles beskrivelse",
      "Bygningsdelsbeskrivelse",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Placement
// ---------------------------------------------------------------------------

describe("cover layout", () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    it(`${orientation}: the type line takes its height from the top spacer, so the title does not move`, () => {
      const base = {
        projectName: null,
        builder: null,
        contractLabel: null,
        workAreaName: null,
        documentLabel: "",
        companyName: null,
        dateText: "2026-10-08",
        revisionDateText: null,
        title: "Titel",
        orientation,
      };
      const without = makeCover({ ...base, documentType: "" });
      const withType = makeCover({ ...base, documentType: "Kontrolplan" });
      const top = (c: Content[]): number =>
        ((c[0] as { margin: number[] }).margin[1] ?? 0) as number;
      // 10pt line (~12pt) + 4pt bottom margin = 16pt.
      expect(top(without) - top(withType)).toBe(16);
      expect(nodeText(withType[1]!)).toBe("Kontrolplan");
      expect(nodeText(withType[2]!)).toBe("Titel");
      // No empty type line when there is no value.
      expect(nodeText(without[1]!)).toBe("Titel");
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Running header, row 4
// ---------------------------------------------------------------------------

type Chrome = (page: number, count: number) => Content;

/** Every string under a `text` key anywhere in the tree (tables too). */
function deepTexts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const n of node) deepTexts(n, out);
    return out;
  }
  if (typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "text" && typeof value === "string") out.push(value);
    else deepTexts(value, out);
  }
  return out;
}

describe("running header row 4 from page 2", () => {
  const types: Array<[number, string]> = [
    [0, "Arbejdsbeskrivelse"],
    [1, "Fælles beskrivelse"],
    [2, "Paradigme for arbejdsbeskrivelse"],
  ];
  for (const [type, expected] of types) {
    it(`work area type ${type}: "${expected}", same as the cover`, () => {
      const doc = specDoc("workSpec", type);
      const header = deepTexts((doc.header as Chrome)(2, 3));
      expect(header).toContain(expected);
      expect(coverDocType(doc)).toBe(expected);
      for (const [, other] of types) {
        if (other !== expected) expect(header).not.toContain(other);
      }
    });
  }

  it("BDB: the BDB's own name, as before", () => {
    const doc = specDoc("bdb", null);
    const header = deepTexts((doc.header as Chrome)(2, 3));
    expect(header).toContain("Titel");
    expect(header).not.toContain("Bygningsdelsbeskrivelse");
  });
});

// ---------------------------------------------------------------------------
// 8. B2.1 - the custom cover's "Dokumenttype" field
// ---------------------------------------------------------------------------

/** The payload plus one control plan owned by BDB 100. */
function payloadWithCp(): FilePayload {
  const data = payload() as unknown as Record<string, unknown>;
  data.bdbs = (data.bdbs as BdbInfo[]).map((b) =>
    b.id === 100 ? { ...b, controlPlanIds: [300] } : b,
  );
  data.controlPlans = [
    { id: 300, numberText: "KP1", title: "Kontrol", controlPlanType: 0 },
  ];
  data.cpHeadersByPlan = { 300: [] };
  data.cpRowsByPlan = { 300: [] };
  return data as unknown as FilePayload;
}

/** A stand-in custom cover that records the context it is given. */
function customCover() {
  const apply = vi.fn(async (_a: unknown, b: Uint8Array) => b);
  return {
    opts: { active: {} as never, apply: apply as never },
    documentType: () =>
      (apply.mock.calls[0]![2] as { documentType: string }).documentType,
  };
}

describe("B2.1 - a custom cover gets the same document type as the built-in cover", () => {
  beforeEach(() => {
    renderSpecPdf.mockClear();
    renderCompositePdf.mockClear();
    renderCpPdf.mockClear();
  });

  const singles: Array<[string, "workSpec" | "bdb" | "cp", number, string]> = [
    ["work area type 0", "workSpec", 10, "Arbejdsbeskrivelse"],
    ["work area type 1", "workSpec", 11, "Fælles beskrivelse"],
    ["work area type 2", "workSpec", 12, "Paradigme for arbejdsbeskrivelse"],
    ["BDB", "bdb", 100, "Bygningsdelsbeskrivelse"],
    ["control plan", "cp", 300, "Kontrolplan"],
  ];
  for (const [name, kind, id, expected] of singles) {
    it(`${name}: "${expected}"`, async () => {
      const data = payloadWithCp();
      const target = buildTargets(data).find(
        (t) => t.kind === kind && t.id === id,
      )!;
      const render = kind === "cp" ? renderCpPdf : renderSpecPdf;

      // Built-in cover: what the PDF prints above the title.
      await buildBytesFor(data, target, {
        includeCoverPage: true,
        compact: false,
      });
      const args = render.mock.calls[0]![0];
      const builtIn = coverDocType(
        kind === "cp"
          ? buildCpPdf(args as BuildCpPdfArgs)
          : buildSpecPdf({
              ...(args as Omit<BuildSpecPdfArgs, "htmlConverter">),
              htmlConverter: identity,
            }),
      );

      // Custom cover: what its "Dokumenttype" field is given.
      const cover = customCover();
      await buildBytesFor(data, target, {
        includeCoverPage: true,
        compact: false,
        cover: cover.opts,
      });

      expect(builtIn).toBe(expected);
      expect(cover.documentType()).toBe(builtIn);
    });
  }

  for (const [name, groupBy, selection, expected] of COMPOSITE_ROWS) {
    it(`composite, ${name}: "${expected}"`, async () => {
      const data = payload();
      const job = compositeJob(groupBy, selection);

      await buildBytesForCompositeJob(data, job, {
        includeCoverPage: true,
        compact: false,
      });
      const args = renderCompositePdf.mock.calls[0]![0] as Omit<
        BuildCompositePdfArgs,
        "htmlConverter"
      >;
      const builtIn = coverDocType(
        buildCompositePdf({ ...args, htmlConverter: identity }),
      );

      const cover = customCover();
      await buildBytesForCompositeJob(data, job, {
        includeCoverPage: true,
        compact: false,
        cover: cover.opts,
      });

      expect(builtIn).toBe(expected);
      expect(cover.documentType()).toBe(builtIn);
    });
  }
});
