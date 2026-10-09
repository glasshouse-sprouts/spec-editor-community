/**
 * Task 145 - a work area's code stands IN FRONT of its title in every
 * export: "S215.01 Skeletkonstruktion, let" (owner's decision 2026-10-08,
 * one space, the export tree's form). Without a code the title is just
 * the name, with no leading space.
 *
 * Before the fix the single PDF export put only the name in the title and
 * the code on its own line under it, while the composite export had the
 * code in front of the title AND repeated it on the line under the chapter
 * heading. This file checks the rule itself and then every place that
 * passes a work-area title on to a PDF:
 *
 *   1. formatWorkAreaTitle - the one rule
 *   2. the export tree's label (cover + chapter titles of composites)
 *   3. single export (ExportCard.buildBytesFor): cover, title block,
 *      no second code line, custom cover's specTitle
 *   4. composite export (buildBytesForCompositeJob): cover, chapter
 *      heading, the table of contents entry, no second code line
 *   5. row 3 of the running header and a custom cover's
 *      "Arbejdsbeskrivelse" field (binding workAreaName): "code name" for
 *      a work area's own PDF and for the parent work area of a BDB or
 *      control-plan PDF (owner 2026-10-08). The composite leaves row 3
 *      empty, as before (owner 2026-10-08).
 *
 * The PDF renderer is stubbed (no pdfmake run): the stub captures the
 * arguments the export passes on, and the tests feed those into the real
 * doc-definition builders to look at the cover and the TOC nodes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Content } from "pdfmake/interfaces";

const renderSpecPdf = vi.fn(async (_args: unknown) => new Uint8Array([1]));
const renderCpPdf = vi.fn(async (_args: unknown) => new Uint8Array([3]));
const renderCompositePdf = vi.fn(async (_args: unknown) => new Uint8Array([2]));
vi.mock("../src/renderer/src/pdf/renderPdf.js", async (orig) => ({
  ...(await orig<object>()),
  renderSpecPdf: (args: unknown) => renderSpecPdf(args),
  renderCompositePdf: (args: unknown) => renderCompositePdf(args),
  renderCpPdf: (args: unknown) => renderCpPdf(args),
}));

import type {
  FilePayload,
  ReferenceLinks,
  SectionData,
  WorkSpecInfo,
} from "../src/shared/ipc.js";
import {
  formatWorkAreaTitle,
  workAreaHeaderLabel,
} from "../src/renderer/src/ExportCardLabels.js";
import {
  buildBytesFor,
  buildTargets,
  type ExportTarget,
} from "../src/renderer/src/ExportCard.js";
import { buildBytesForCompositeJob } from "../src/renderer/src/executeCompositeExport.js";
import {
  buildExportTree,
  emptySelection,
} from "../src/renderer/src/exportTree.js";
import {
  buildPdfExportJobs,
  type PdfExportJob,
} from "../src/renderer/src/exportGrouping.js";
import {
  buildSpecPdf,
  type BuildSpecPdfArgs,
} from "../src/renderer/src/pdf/buildSpecPdf.js";
import {
  buildCompositePdf,
  type BuildCompositePdfArgs,
} from "../src/renderer/src/pdf/buildCompositePdf.js";

const CODE = "S215.01";
const NAME = "Skeletkonstruktion, let";
const WITH_CODE = "S215.01 Skeletkonstruktion, let";

const EMPTY_REFS: ReferenceLinks = {
  basisGuid: null,
  basisRevisionGuid: null,
  paradigmGuid: null,
  paradigmRevisionGuid: null,
  referencelistArea: null,
  referencelistAreaDate: null,
};

function ws(id: number, code: string | null, name: string): WorkSpecInfo {
  return {
    id,
    workAreaCode: code,
    workAreaName: name,
    revision: null,
    revisionDate: null,
    contractId: 1,
    refs: EMPTY_REFS,
  };
}

const section: SectionData = {
  id: 1,
  sectionNo: 1,
  heading: "Omfang",
  body: "<p>Tekst</p>",
  parentId: null,
  pfbbSectionId: null,
};

function payload(workSpecs: WorkSpecInfo[]): FilePayload {
  return {
    path: "/tmp/fake.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: { name: "Testprojekt", builder: "Bygherre A/S" },
    workSpecs,
    bdbs: [],
    controlPlans: [],
    contracts: [{ id: 1, contractCode: "E11", contractName: "Råhus" }],
    attachments: [],
    sectionsByWorkSpec: Object.fromEntries(
      workSpecs.map((w) => [w.id, [{ ...section }]]),
    ),
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
  } as unknown as FilePayload;
}

const identity = (html: string): Content => ({ text: html });

/** Every `text` string in a pdfmake content tree, in document order. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const n of node) texts(n, out);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.text === "string") out.push(o.text);
    else if (o.text != null) texts(o.text, out);
    if (o.stack) texts(o.stack, out);
    if (o.columns) texts(o.columns, out);
  }
  return out;
}

/** The cover's big title line (26pt bold) - Task 147 put the document
 *  type on a line above it, so it is no longer the first text. */
function coverTitle(content: Content[]): string | undefined {
  for (const node of content) {
    const n = node as { text?: unknown; fontSize?: number; bold?: boolean };
    if (n.fontSize === 26 && n.bold === true && typeof n.text === "string")
      return n.text;
  }
  return undefined;
}

/** Cover nodes = everything before the first page break. */
function coverTexts(content: Content[]): string[] {
  const out: string[] = [];
  for (const node of content) {
    texts(node, out);
    if ((node as { pageBreak?: string }).pageBreak === "after") break;
  }
  return out.filter((s) => s !== "");
}

beforeEach(() => {
  renderSpecPdf.mockClear();
  renderCompositePdf.mockClear();
  renderCpPdf.mockClear();
});

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------

describe("formatWorkAreaTitle", () => {
  it("puts the code in front of the name with one space", () => {
    expect(formatWorkAreaTitle(CODE, NAME)).toBe(WITH_CODE);
  });

  it("returns just the name, without a leading space, when there is no code", () => {
    expect(formatWorkAreaTitle(null, NAME)).toBe(NAME);
    expect(formatWorkAreaTitle(undefined, NAME)).toBe(NAME);
    expect(formatWorkAreaTitle("", NAME)).toBe(NAME);
  });

  it("treats a whitespace-only code as no code", () => {
    expect(formatWorkAreaTitle("   ", NAME)).toBe(NAME);
  });

  it("trims stray spaces so there is exactly one between code and name", () => {
    expect(formatWorkAreaTitle(" S215.01 ", " Skeletkonstruktion, let ")).toBe(
      WITH_CODE,
    );
  });

  it("returns the code alone when the name is empty", () => {
    expect(formatWorkAreaTitle(CODE, "")).toBe(CODE);
  });
});

// ---------------------------------------------------------------------------
// 2. Export tree label
// ---------------------------------------------------------------------------

describe("export tree label", () => {
  it("has the code in front, or just the name without a code", () => {
    const tree = buildExportTree(
      payload([
        ws(10, CODE, NAME),
        ws(11, null, "Tagdækning"),
        ws(12, "  ", "Murværk"),
      ]),
    );
    const labels = tree.contractGroups.flatMap((g) =>
      g.workAreas.map((w) => w.label),
    );
    expect(labels).toContain(WITH_CODE);
    expect(labels).toContain("Tagdækning");
    expect(labels).toContain("Murværk");
    for (const l of labels) expect(l).toBe(l.trimStart());
  });
});

// ---------------------------------------------------------------------------
// 3. Single export
// ---------------------------------------------------------------------------

async function exportSingle(
  w: WorkSpecInfo,
  cover?: { apply: ReturnType<typeof vi.fn> },
): Promise<Omit<BuildSpecPdfArgs, "htmlConverter">> {
  const data = payload([w]);
  const target = buildTargets(data).find(
    (t): t is Extract<ExportTarget, { kind: "workSpec" }> =>
      t.kind === "workSpec",
  )!;
  await buildBytesFor(data, target, {
    includeCoverPage: true,
    compact: false,
    ...(cover
      ? {
          cover: {
            active: {} as never,
            apply: cover.apply as never,
          },
        }
      : {}),
  });
  expect(renderSpecPdf).toHaveBeenCalledTimes(1);
  return renderSpecPdf.mock.calls[0]![0] as Omit<
    BuildSpecPdfArgs,
    "htmlConverter"
  >;
}

describe("single export of a work area", () => {
  it("passes the code in front of the title and no separate code line", async () => {
    const args = await exportSingle(ws(10, CODE, NAME));
    expect(args.title).toBe(WITH_CODE);
    expect(args.subtitle ?? null).toBeNull();
  });

  it("prints the code in front of the title on the cover and the title block, once", async () => {
    const args = await exportSingle(ws(10, CODE, NAME));
    const doc = buildSpecPdf({ ...args, htmlConverter: identity });
    const content = doc.content as Content[];
    const cover = coverTexts(content);
    expect(coverTitle(content)).toBe(WITH_CODE);
    // The code is not repeated on a line of its own.
    expect(cover).not.toContain(CODE);
    const all = texts(content);
    expect(all.filter((s) => s === CODE)).toHaveLength(0);
    expect(all.filter((s) => s === WITH_CODE)).toHaveLength(2); // cover + title block
  });

  it("uses just the name, with no leading space, when there is no code", async () => {
    const args = await exportSingle(ws(10, null, NAME));
    expect(args.title).toBe(NAME);
    const doc = buildSpecPdf({ ...args, htmlConverter: identity });
    expect(coverTitle(doc.content as Content[])).toBe(NAME);
  });

  it("gives a custom cover the same title as the built-in one", async () => {
    const apply = vi.fn(async (_a: unknown, b: Uint8Array) => b);
    await exportSingle(ws(10, CODE, NAME), { apply });
    expect(apply).toHaveBeenCalledTimes(1);
    const ctx = apply.mock.calls[0]![2] as { specTitle: string };
    expect(ctx.specTitle).toBe(WITH_CODE);
  });
});

// ---------------------------------------------------------------------------
// 4. Composite export
// ---------------------------------------------------------------------------

async function exportComposite(
  w: WorkSpecInfo,
  groupBy: "perWorkArea" | "perContract" | "perProject",
): Promise<Omit<BuildCompositePdfArgs, "htmlConverter">> {
  const data = payload([w]);
  const tree = buildExportTree(data);
  const sel = emptySelection();
  sel.workAreas.add(w.id);
  const jobs = buildPdfExportJobs({ data, tree, selection: sel, groupBy });
  const job = jobs.find(
    (j): j is Extract<PdfExportJob, { kind: "composite" }> =>
      j.kind === "composite",
  )!;
  await buildBytesForCompositeJob(data, job, {
    includeCoverPage: true,
    compact: false,
  });
  expect(renderCompositePdf).toHaveBeenCalledTimes(1);
  return renderCompositePdf.mock.calls[0]![0] as Omit<
    BuildCompositePdfArgs,
    "htmlConverter"
  >;
}

describe("composite export of a work area", () => {
  for (const groupBy of ["perWorkArea", "perContract", "perProject"] as const) {
    it(`${groupBy}: chapter heading has the code in front, and no second code line`, async () => {
      const args = await exportComposite(ws(10, CODE, NAME), groupBy);
      expect(args.chapters[0]!.title).toBe(WITH_CODE);
      expect(args.chapters[0]!.subtitle ?? null).toBeNull();
    });
  }

  it("perWorkArea: the cover title is the same string as the single export's", async () => {
    const args = await exportComposite(ws(10, CODE, NAME), "perWorkArea");
    expect(args.cover.title).toBe(WITH_CODE);
    const doc = buildCompositePdf({ ...args, htmlConverter: identity });
    expect(coverTitle(doc.content as Content[])).toBe(WITH_CODE);
  });

  it("the TOC entry for the chapter is the coded title, and the code is never on its own", async () => {
    const args = await exportComposite(ws(10, CODE, NAME), "perContract");
    const doc = buildCompositePdf({ ...args, htmlConverter: identity });
    const content = doc.content as Array<Record<string, unknown>>;
    const tocItems = content.filter((n) => n.tocItem === true);
    expect(tocItems[0]!.text).toBe(WITH_CODE);
    expect(content.some((n) => n.style === "chapterSubtitle")).toBe(false);
    expect(texts(content).filter((s) => s === CODE)).toHaveLength(0);
  });

  it("without a code: the chapter heading is just the name", async () => {
    const args = await exportComposite(ws(10, null, NAME), "perWorkArea");
    expect(args.chapters[0]!.title).toBe(NAME);
    expect(args.cover.title).toBe(NAME);
    expect(args.chapters[0]!.subtitle ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Running header row 3 + custom cover "Arbejdsbeskrivelse" field
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

/** A payload with one work area, one BDB under it, and one control plan
 *  owned by that BDB. */
function familyPayload(w: WorkSpecInfo): FilePayload {
  const data = payload([w]) as unknown as Record<string, unknown>;
  data.bdbs = [
    {
      id: 20,
      name: "Stålsøjler",
      workSpecId: w.id,
      isPfbb: false,
      pfbbId: null,
      revision: null,
      revisionDate: null,
      controlPlanIds: [30],
      refs: EMPTY_REFS,
    },
  ];
  data.sectionsByBdb = { 20: [{ ...section }] };
  data.controlPlans = [
    {
      id: 30,
      numberText: "KP1",
      title: "Kontrol af søjler",
      controlPlanType: 0,
    },
  ];
  data.cpHeadersByPlan = { 30: [] };
  data.cpRowsByPlan = { 30: [] };
  return data as unknown as FilePayload;
}

async function exportTarget(
  data: FilePayload,
  kind: "workSpec" | "bdb" | "cp",
): Promise<{
  args: Record<string, unknown>;
  coverCtx: Record<string, unknown>;
}> {
  const target = buildTargets(data).find((t) => t.kind === kind)!;
  const apply = vi.fn(async (_a: unknown, b: Uint8Array) => b);
  await buildBytesFor(data, target, {
    includeCoverPage: true,
    compact: false,
    cover: { active: {} as never, apply: apply as never },
  });
  const fn = kind === "cp" ? renderCpPdf : renderSpecPdf;
  return {
    args: fn.mock.calls[0]![0] as Record<string, unknown>,
    coverCtx: apply.mock.calls[0]![2] as Record<string, unknown>,
  };
}

describe("workAreaHeaderLabel", () => {
  it("is the coded title, or just the name, or null", () => {
    expect(
      workAreaHeaderLabel({ workAreaCode: CODE, workAreaName: NAME }),
    ).toBe(WITH_CODE);
    expect(
      workAreaHeaderLabel({ workAreaCode: null, workAreaName: NAME }),
    ).toBe(NAME);
    expect(workAreaHeaderLabel({ workAreaCode: " ", workAreaName: NAME })).toBe(
      NAME,
    );
    expect(
      workAreaHeaderLabel({ workAreaCode: CODE, workAreaName: null }),
    ).toBe(CODE);
    expect(
      workAreaHeaderLabel({ workAreaCode: null, workAreaName: "" }),
    ).toBeNull();
    expect(workAreaHeaderLabel(null)).toBeNull();
    expect(workAreaHeaderLabel(undefined)).toBeNull();
  });
});

describe("running header row 3 and the cover's Arbejdsbeskrivelse field", () => {
  for (const kind of ["workSpec", "bdb", "cp"] as const) {
    it(`${kind}: the work area is "code name" in the header and on a custom cover`, async () => {
      const { args, coverCtx } = await exportTarget(
        familyPayload(ws(10, CODE, NAME)),
        kind,
      );
      expect(args.workAreaName).toBe(WITH_CODE);
      expect(coverCtx.workAreaName).toBe(WITH_CODE);
    });

    it(`${kind}: without a code it is just the name`, async () => {
      const { args, coverCtx } = await exportTarget(
        familyPayload(ws(10, null, NAME)),
        kind,
      );
      expect(args.workAreaName).toBe(NAME);
      expect(coverCtx.workAreaName).toBe(NAME);
    });
  }

  it("the rendered header of a work-area PDF shows the coded title on page 2", async () => {
    const data = familyPayload(ws(10, CODE, NAME));
    const target = buildTargets(data).find((t) => t.kind === "workSpec")!;
    await buildBytesFor(data, target, {
      includeCoverPage: true,
      compact: false,
    });
    const args = renderSpecPdf.mock.calls[0]![0] as Omit<
      BuildSpecPdfArgs,
      "htmlConverter"
    >;
    const doc = buildSpecPdf({ ...args, htmlConverter: identity });
    const header = deepTexts((doc.header as Chrome)(2, 3));
    expect(header).toContain(WITH_CODE);
    expect(header).not.toContain(NAME);
  });

  it("the composite leaves row 3 empty (no workAreaName passed)", async () => {
    const args = await exportComposite(ws(10, CODE, NAME), "perWorkArea");
    expect(args.cover.workAreaName ?? null).toBeNull();
  });
});
