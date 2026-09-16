/**
 * Slice "Version compare PDF" — buildVersionSummaryPdf.
 *
 * Pure-builder tests on the doc-definition shape. No pdfmake / DOM
 * involvement; we only check that the produced JSON contains the
 * expected text fragments in the expected order.
 */
import { describe, expect, it } from "vitest";

import type {
  AttachmentRevision,
  CpRowRevision,
  Revision,
  SectionRevision,
  WholeSpecRevision,
} from "../src/renderer/src/compare/compareTypes.js";
import {
  buildVersionSummaryPdf,
  type SummaryStrings,
} from "../src/renderer/src/pdf/buildVersionSummaryPdf.js";

/** Minimal English string set so test assertions are easy to read. */
const STRINGS: SummaryStrings = {
  documentTitle: "Version summary",
  referenceLabel: "Reference:",
  noChangesText: "No changes found.",
  sectionsHeader: "Sections",
  cpRowsHeader: "Control-plan rows",
  attachmentsHeader: "Attachments",
  kindLabel: { added: "ADDED", deleted: "DELETED", modified: "MODIFIED" },
  wholeSpecCount: (n) => `${n} sections in total.`,
  cpSlotLabel: { design: "Design", production: "Production" },
};

/** Recursively flatten a Content tree into all the {text:...} strings. */
function flattenText(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(flattenText);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: string[] = [];
    if ("text" in obj) out.push(...flattenText(obj.text));
    if ("stack" in obj) out.push(...flattenText(obj.stack));
    if ("columns" in obj) out.push(...flattenText(obj.columns));
    if ("table" in obj) {
      const table = obj.table as Record<string, unknown>;
      if ("body" in table) out.push(...flattenText(table.body));
    }
    return out;
  }
  return [];
}

function makeSectionRev(
  parentKey: string,
  parentLabel: string,
  parentKind: "workSpec" | "bdb",
  workAreaLabel: string | undefined,
  sectionPath: string,
  heading: string,
  kind: "added" | "deleted" | "modified",
): SectionRevision {
  return {
    type: "section",
    kind,
    parent: {
      kind: parentKind,
      key: parentKey,
      label: parentLabel,
      workAreaLabel,
      currentId: null,
      referenceId: null,
    },
    sectionNo: 0,
    sectionPath,
    heading,
    currentBody: "",
    referenceBody: "",
    textSegments: [],
  };
}

describe("buildVersionSummaryPdf", () => {
  it("produces an empty-state body when no revisions are passed", () => {
    const doc = buildVersionSummaryPdf({
      projectName: "P",
      referenceLabel: "ref.moliospec",
      companyName: "Co.",
      revisions: [],
      strings: STRINGS,
    });
    const text = flattenText(doc.content);
    expect(text).toContain("No changes found.");
  });

  it("includes the document title and reference label on the body", () => {
    const doc = buildVersionSummaryPdf({
      projectName: "Project A",
      referenceLabel: "older.moliospec",
      companyName: "Co.",
      revisions: [],
      strings: STRINGS,
    });
    const text = flattenText(doc.content);
    expect(text).toContain("Version summary");
    expect(text.some((s) => s.includes("older.moliospec"))).toBe(true);
  });

  it("groups section revisions by spec and lists them by hierarchical path", () => {
    const sec_2 = makeSectionRev(
      "wa::01",
      "Work area A",
      "workSpec",
      undefined,
      "2",
      "Header B",
      "modified",
    );
    const sec_1_1 = makeSectionRev(
      "wa::01",
      "Work area A",
      "workSpec",
      undefined,
      "1.1",
      "Sub of OMFANG",
      "added",
    );
    const sec_1 = makeSectionRev(
      "wa::01",
      "Work area A",
      "workSpec",
      undefined,
      "1",
      "OMFANG",
      "deleted",
    );
    // Pass them in arbitrary order; the builder must sort by path.
    const doc = buildVersionSummaryPdf({
      projectName: "P",
      referenceLabel: null,
      companyName: "Co.",
      revisions: [sec_2, sec_1_1, sec_1],
      strings: STRINGS,
    });
    const text = flattenText(doc.content);
    // Spec heading appears before any of its rows.
    const specIdx = text.findIndex((s) => s === "Work area A");
    const sectionsHeaderIdx = text.findIndex((s) => s === "Sections");
    expect(specIdx).toBeGreaterThan(-1);
    expect(sectionsHeaderIdx).toBeGreaterThan(specIdx);
    // The three section labels must appear in path order: 1, 1.1, 2.
    const idx1 = text.findIndex((s) => s.startsWith("1  OMFANG"));
    const idx11 = text.findIndex((s) => s.startsWith("1.1  Sub"));
    const idx2 = text.findIndex((s) => s.startsWith("2  Header B"));
    expect(idx1).toBeGreaterThan(-1);
    expect(idx11).toBeGreaterThan(idx1);
    expect(idx2).toBeGreaterThan(idx11);
  });

  it("renders a whole-spec revision as a single line with the section count", () => {
    const whole: WholeSpecRevision = {
      type: "wholeSpec",
      kind: "added",
      parent: {
        kind: "bdb",
        key: "wa::01::Foo",
        label: "Foo",
        workAreaLabel: "Work area A",
        currentId: 1,
        referenceId: null,
      },
      sectionCount: 7,
    };
    const doc = buildVersionSummaryPdf({
      projectName: "P",
      referenceLabel: null,
      companyName: "Co.",
      revisions: [whole],
      strings: STRINGS,
    });
    const text = flattenText(doc.content);
    expect(text).toContain("Foo");
    expect(text.some((s) => s.includes("7 sections in total."))).toBe(true);
    // The Sections / CP / Attachments sub-headers should NOT appear
    // for whole-spec rows — those are only for the per-revision lists.
    expect(text).not.toContain("Sections");
  });

  it("groups CP rows and attachments under their owning spec", () => {
    const cpRow: CpRowRevision = {
      type: "cpRow",
      kind: "modified",
      parent: {
        kind: "bdb",
        key: "wa::01::Foo",
        label: "Foo",
        workAreaLabel: "Work area A",
        currentId: 1,
        referenceId: 99,
      },
      bdbLabel: "Foo",
      slot: "design",
      cpTitle: "CP",
      sectionNo: "1.2",
      currentRow: null,
      referenceRow: null,
      changedFields: [],
    };
    const att: AttachmentRevision = {
      type: "attachment",
      kind: "added",
      workAreaLabel: "Work area A",
      workAreaKey: "wa::01",
      name: "drawing.pdf",
      changedFields: [],
    };
    const doc = buildVersionSummaryPdf({
      projectName: "P",
      referenceLabel: null,
      companyName: "Co.",
      revisions: [cpRow, att],
      strings: STRINGS,
    });
    const text = flattenText(doc.content);
    expect(text).toContain("Control-plan rows");
    expect(text).toContain("Attachments");
    expect(text.some((s) => s.includes("1.2"))).toBe(true);
    expect(text).toContain("drawing.pdf");
  });
});
