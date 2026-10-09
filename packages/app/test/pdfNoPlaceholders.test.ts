/**
 * Task 183 - regression guard: no placeholder or English chrome text may
 * reach a customer PDF, from any of the four PDF builders.
 *
 * A customer received PDFs whose running header said "[Bygherre]" and
 * "[Entrepriseform]", whose footer said "Company name" and "Page 2 of 3",
 * and whose metadata line said "Kind: ... · Project: ...". This file
 * builds a doc definition with every builder - once with all values
 * present and once with all of them missing - renders the header and
 * footer for the first pages, walks EVERY text node in the result and
 * fails if one of the forbidden strings is there.
 *
 * It also checks the positive half of the fix for all four builders: the
 * running header shows the project's bygherre and the entreprise, and an
 * empty cell when they are missing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import type { SectionData } from "../src/shared/ipc.js";
import { buildCompositePdf } from "../src/renderer/src/pdf/buildCompositePdf.js";
import { buildCpPdf } from "../src/renderer/src/pdf/buildCpPdf.js";
import { buildSpecPdf } from "../src/renderer/src/pdf/buildSpecPdf.js";
import { compositeDocumentType } from "../src/renderer/src/pdf/documentTypes.js";
import { getLocale, setLocale } from "../src/renderer/src/i18n/i18n.js";
import type {
  AttachmentRevision,
  CpRowRevision,
  Revision,
  SectionRevision,
  WholeSpecRevision,
} from "../src/renderer/src/compare/compareTypes.js";
import { buildVersionSummaryPdf } from "../src/renderer/src/pdf/buildVersionSummaryPdf.js";

/** Texts that must never appear anywhere in a generated PDF. */
const FORBIDDEN = [
  "[Bygherre]",
  "[Entrepriseform]",
  "Company name",
  "Page ",
  "Kind:",
  "(no sections)",
  // Found while fixing the above - same class of problem.
  "Project:",
  "Revision date",
  "(no control-plan rows)",
];

const BUILDER = "A.P. Møller-Mærsk";
const CONTRACT = "E11 - Belægning";

const identity = (html: string): Content => ({ text: html });

const sections: SectionData[] = [
  { id: 1, parentId: null, sectionNo: 1, heading: "Omfang", body: "<p>x</p>" },
];

type Chrome = (p: number, pc: number) => unknown;

/** Every string under a `text` key, anywhere in the tree. */
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

/** Content + header/footer on pages 1-3, as one list of strings. */
function allPdfText(doc: TDocumentDefinitions): string[] {
  const texts = deepTexts(doc.content);
  for (const fn of [doc.header, doc.footer]) {
    if (typeof fn !== "function") continue;
    for (const page of [1, 2, 3]) deepTexts((fn as Chrome)(page, 3), texts);
  }
  return texts;
}

function headerTexts(doc: TDocumentDefinitions): string[] {
  return deepTexts((doc.header as Chrome)(2, 3));
}

/** Each builder, called with every optional value present or absent.
 *  `companyName` is the "Firmanavn" app setting (Task 185). */
function buildAll(
  withValues: boolean,
  companyName: string | null = null,
): Record<string, TDocumentDefinitions> {
  const v = <T>(x: T): T | null => (withValues ? x : null);
  return {
    spec: buildSpecPdf({
      kind: "workSpec",
      title: "Befæstelse",
      subtitle: "S203.01",
      revision: v("A"),
      revisionDate: v("2026-10-01"),
      projectName: v("Udvidelsesdomicil"),
      builder: v(BUILDER),
      contractLabel: v(CONTRACT),
      workAreaName: "Befæstelse",
      companyName,
      includeCoverPage: true,
      includeToc: true,
      sections: withValues ? sections : [],
      htmlConverter: identity,
    }),
    controlPlan: buildCpPdf({
      numberText: "1",
      title: "Kontrolplan",
      revision: v("A"),
      revisionDate: v("2026-10-01"),
      projectName: v("Udvidelsesdomicil"),
      builder: v(BUILDER),
      contractLabel: v(CONTRACT),
      companyName,
      includeCoverPage: true,
      headers: [],
      rows: [],
    }),
    composite: buildCompositePdf({
      cover: {
        title: "Samlet",
        projectName: v("Udvidelsesdomicil"),
        builder: v(BUILDER),
        contractLabel: v(CONTRACT),
        revision: v("A"),
        revisionDate: v("2026-10-01"),
        companyName,
      },
      chapters: [
        {
          kind: "workSpec",
          title: "Befæstelse",
          revision: v("A"),
          revisionDate: v("2026-10-01"),
          sections: withValues ? sections : [],
        },
      ],
      htmlConverter: identity,
    }),
    versionSummary: buildVersionSummaryPdf({
      projectName: v("Udvidelsesdomicil"),
      builder: v(BUILDER),
      referenceLabel: "gammel.moliospec",
      companyName,
      revisions: [],
    }),
  };
}

describe("Task 183 - no placeholder or English chrome text in any PDF", () => {
  for (const withValues of [true, false]) {
    const label = withValues ? "all values present" : "all values missing";
    for (const [name, doc] of Object.entries(buildAll(withValues))) {
      it(`${name}, ${label}`, () => {
        const text = allPdfText(doc).join("\n");
        for (const bad of FORBIDDEN) {
          expect(text, `"${bad}" found in the ${name} PDF`).not.toContain(bad);
        }
      });
    }
  }
});

describe("Task 183 - running header shows bygherre and entreprise in all four builders", () => {
  const docs = buildAll(true);

  for (const name of ["spec", "controlPlan", "composite"] as const) {
    it(`${name}: bygherre and entreprise`, () => {
      const texts = headerTexts(docs[name]);
      expect(texts).toContain(BUILDER);
      expect(texts).toContain(CONTRACT);
    });
  }

  it("versionSummary: bygherre, and no entreprise (it spans the whole project)", () => {
    const texts = headerTexts(docs.versionSummary);
    expect(texts).toContain(BUILDER);
    expect(texts).not.toContain(CONTRACT);
  });

  it("all four: empty cells, not placeholders, when the values are missing", () => {
    for (const [name, doc] of Object.entries(buildAll(false))) {
      const texts = headerTexts(doc);
      expect(texts, name).not.toContain(BUILDER);
      expect(texts, name).not.toContain(CONTRACT);
      expect(texts.join("|"), name).not.toMatch(/\[|\]/);
    }
  });
});

describe("Task 147 - a Fælles beskrivelse never says Arbejdsbeskrivelse on its cover or in its header", () => {
  /** Every text on the cover page: content up to the first page break,
   *  plus the page-1 header and footer (both empty on a cover). */
  function coverText(doc: TDocumentDefinitions): string {
    const texts: string[] = [];
    for (const node of doc.content as Content[]) {
      deepTexts(node, texts);
      if ((node as { pageBreak?: string }).pageBreak === "after") break;
    }
    for (const fn of [doc.header, doc.footer]) {
      if (typeof fn === "function") deepTexts((fn as Chrome)(1, 3), texts);
    }
    return texts.join("\n");
  }

  function spec(workAreaType: number): TDocumentDefinitions {
    return buildSpecPdf({
      kind: "workSpec",
      workAreaType,
      title: "S100 Fællesbestemmelser",
      projectName: "Udvidelsesdomicil",
      builder: BUILDER,
      contractLabel: CONTRACT,
      workAreaName: "S100 Fællesbestemmelser",
      includeCoverPage: true,
      sections,
      htmlConverter: identity,
    });
  }

  function composite(workAreaType: number): TDocumentDefinitions {
    return buildCompositePdf({
      cover: {
        documentType: compositeDocumentType({
          scope: "workArea",
          hasWorkAreas: true,
          hasBdbs: true,
          workAreaType,
        }),
        title: "S100 Fællesbestemmelser",
        projectName: "Udvidelsesdomicil",
        builder: BUILDER,
        contractLabel: CONTRACT,
      },
      chapters: [
        {
          kind: "workSpec",
          workAreaType,
          title: "S100 Fællesbestemmelser",
          sections,
        },
        { kind: "bdb", title: "Fundering", sections },
      ],
      htmlConverter: identity,
    });
  }

  it("single PDF", () => {
    const text = coverText(spec(1));
    expect(text).toContain("Fælles beskrivelse");
    expect(text).not.toMatch(/arbejdsbeskrivelse/i);
  });

  it("single PDF, running header on pages 2-3 (owner 2026-10-08)", () => {
    const doc = spec(1);
    for (const page of [2, 3]) {
      const header = deepTexts((doc.header as Chrome)(page, 3)).join("\n");
      expect(header, `page ${page}`).toContain("Fælles beskrivelse");
      expect(header, `page ${page}`).not.toMatch(/arbejdsbeskrivelse/i);
    }
  });

  it("composite per work area", () => {
    const text = coverText(composite(1));
    expect(text).toContain("Fælles beskrivelse med bygningsdelsbeskrivelser");
    expect(text).not.toMatch(/arbejdsbeskrivelse/i);
  });

  it("control: a plain Arbejdsbeskrivelse does print the word, so the check above can fail", () => {
    expect(coverText(spec(0))).toContain("Arbejdsbeskrivelse");
    expect(coverText(composite(0))).toContain(
      "Arbejdsbeskrivelse med bygningsdelsbeskrivelser",
    );
  });
});

describe("Task 186 - the version summary is Danish whatever language the app runs in", () => {
  /** The English texts the summary used to print in an English app
   *  (`versionSummary.*` in messages.en.json before Task 186). */
  const ENGLISH = [
    "Version summary",
    "Version reference:",
    "No changes found.",
    "Sections",
    "Control-plan rows",
    "Attachments",
    "ADDED",
    "DELETED",
    "MODIFIED",
    "sections in total",
    "Design control plan",
    "Production control plan",
  ];

  const parent = (kind: "workSpec" | "bdb", label: string) => ({
    kind,
    key: `k::${label}`,
    label,
    workAreaLabel: kind === "bdb" ? "S100 Beton" : undefined,
    currentId: 1,
    referenceId: 1,
  });

  /** One revision of every kind and type the summary can print. */
  function everyRevision(): Revision[] {
    const section = (
      kind: "added" | "deleted" | "modified",
      path: string,
    ): SectionRevision => ({
      type: "section",
      kind,
      parent: parent("workSpec", "S100 Beton"),
      sectionNo: 0,
      sectionPath: path,
      heading: "Omfang",
      currentBody: "",
      referenceBody: "",
      textSegments: [],
    });
    const whole: WholeSpecRevision = {
      type: "wholeSpec",
      kind: "added",
      parent: parent("bdb", "Fundering"),
      sectionCount: 7,
    };
    const cpRow = (slot: "design" | "production"): CpRowRevision => ({
      type: "cpRow",
      kind: "modified",
      parent: parent("bdb", "Stålsøjler"),
      bdbLabel: "Stålsøjler",
      slot,
      cpTitle: "KP",
      sectionNo: "1.2",
      currentRow: null,
      referenceRow: null,
      changedFields: [],
    });
    const att: AttachmentRevision = {
      type: "attachment",
      kind: "deleted",
      workAreaLabel: "S100 Beton",
      workAreaKey: "k::S100 Beton",
      name: "tegning.pdf",
      changedFields: [],
    };
    return [
      section("added", "1"),
      section("deleted", "2"),
      section("modified", "3"),
      whole,
      cpRow("design"),
      cpRow("production"),
      att,
    ];
  }

  const before = getLocale();
  afterEach(() => setLocale(before));

  for (const [name, revisions] of [
    ["no changes", [] as Revision[]],
    ["every kind of change", everyRevision()],
  ] as const) {
    it(`${name}: no English text with the app in English`, () => {
      setLocale("en");
      expect(getLocale()).toBe("en");
      const doc = buildVersionSummaryPdf({
        projectName: "Udvidelsesdomicil",
        referenceLabel: "gammel.moliospec",
        builder: BUILDER,
        revisions,
      });
      const text = allPdfText(doc).join("\n");
      for (const english of ENGLISH) {
        expect(text, `"${english}" in the version summary`).not.toContain(
          english,
        );
      }
      for (const bad of FORBIDDEN) expect(text).not.toContain(bad);
    });
  }

  it("with the app in English, the Danish texts are there", () => {
    setLocale("en");
    const doc = buildVersionSummaryPdf({
      projectName: "Udvidelsesdomicil",
      referenceLabel: "gammel.moliospec",
      revisions: everyRevision(),
    });
    const text = allPdfText(doc).join("\n");
    for (const danish of [
      "Ændringsoversigt",
      "Versionsreference: gammel.moliospec",
      "Sektioner",
      "Kontrolplanrækker",
      "Bilag",
      "TILFØJET",
      "FJERNET",
      "ÆNDRET",
      "7 sektioner i alt.",
      "Projektkontrolplan",
      "Udførelseskontrolplan",
    ]) {
      expect(text, danish).toContain(danish);
    }
  });

  it("the builder does not read the translation files", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL(
          "../src/renderer/src/pdf/buildVersionSummaryPdf.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'][^"']*i18n/);
  });
});

describe("Task 185 - company name from the app setting, in all four builders", () => {
  const COMPANY = "Eksempel Rådgivning A/S";

  function footerTexts(doc: TDocumentDefinitions, page: number): string[] {
    return deepTexts((doc.footer as Chrome)(page, 3));
  }

  /** Cover-page content: everything up to the first page break. */
  function coverTexts(doc: TDocumentDefinitions): string[] {
    const texts: string[] = [];
    for (const node of doc.content as Content[]) {
      deepTexts(node, texts);
      if ((node as { pageBreak?: string }).pageBreak === "after") break;
    }
    return texts;
  }

  for (const name of [
    "spec",
    "controlPlan",
    "composite",
    "versionSummary",
  ] as const) {
    it(`${name}: the name is in the footer and on the built-in cover`, () => {
      const doc = buildAll(true, COMPANY)[name]!;
      expect(footerTexts(doc, 2)).toContain(COMPANY);
      expect(footerTexts(doc, 3)).toContain(COMPANY);
      expect(coverTexts(doc)).toContain(COMPANY);
      // Page 1 is the cover: no footer there, the name is on the cover.
      expect(footerTexts(doc, 1)).not.toContain(COMPANY);
    });

    it(`${name}: no name -> empty footer, no placeholder`, () => {
      for (const withValues of [true, false]) {
        const doc = buildAll(withValues, null)[name]!;
        for (const page of [2, 3]) {
          const footer = footerTexts(doc, page).filter((t) => t.trim() !== "");
          expect(footer, `${name} page ${page}`).toEqual([]);
        }
        expect(coverTexts(doc)).not.toContain("Company name");
      }
    });
  }
});
