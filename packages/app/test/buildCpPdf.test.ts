/**
 * Unit tests for the pure CP-PDF builder.
 *
 * Same pattern as buildSpecPdf.test.ts — inspect the returned
 * pdfmake doc-def JSON. No pdfmake, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { Content } from "pdfmake/interfaces";

import type {
  ControlPlanHeaderData,
  ControlPlanRowData,
} from "../src/shared/ipc.js";
import { buildCpPdf } from "../src/renderer/src/pdf/buildCpPdf.js";

function h(
  id: number,
  headerNo: string,
  header: string,
): ControlPlanHeaderData {
  return { id, headerNo, header };
}

function r(
  id: number,
  headerId: number,
  sectionNo: string,
  subject: string,
  extra: Partial<ControlPlanRowData> = {},
): ControlPlanRowData {
  return {
    id,
    headerId,
    sectionNo,
    subject,
    controlType: 0,
    reference: "",
    method: "",
    quantity: "",
    time: "",
    acceptanceCriteria: "",
    documentation: "",
    controlLevel: "",
    sampleLevel: "",
    ...extra,
  };
}

/** Narrow helper — look up a node's text when it exists. */
function textAt(content: Content[], i: number): string | undefined {
  const n = content[i];
  if (n && typeof n === "object" && "text" in n) {
    const t = (n as { text: unknown }).text;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/** First index in `content` whose node has the given text. */
function indexOfText(content: Content[], needle: string): number {
  for (let i = 0; i < content.length; i++) {
    const t = textAt(content, i);
    if (t === needle) return i;
  }
  return -1;
}

/** Minimal args so the 7.2 new required fields default to sensible values. */
function defaultArgs(): Parameters<typeof buildCpPdf>[0] {
  return {
    numberText: "",
    title: "T",
    headers: [],
    rows: [],
    companyName: "Company name",
    // Older assertions were written against the pre-cover layout; opt in
    // to the cover only where the test actually checks it.
    includeCoverPage: false,
  };
}

describe("buildCpPdf", () => {
  it("prefixes the title with the CP number when given", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "3.1",
      title: "Kontrolplan",
    });
    const content = doc.content as Content[];
    expect(textAt(content, 0)).toBe("3.1  Kontrolplan");
  });

  it("falls back to just the title when no number is given", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "",
      title: "Untitled plan",
    });
    const content = doc.content as Content[];
    expect(textAt(content, 0)).toBe("Untitled plan");
  });

  it("includes owner label and project in metadata when provided", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "1",
      title: "CP",
      ownerLabel: "BDB 2.5.1 Fundering",
      projectName: "Test project",
    });
    const content = doc.content as Content[];
    // Find the owner subtitle relative to the title (no cover, so
    // title is index 0).
    const titleIdx = indexOfText(content, "1  CP");
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(textAt(content, titleIdx + 1)).toBe("BDB 2.5.1 Fundering");
    const meta = textAt(content, titleIdx + 2);
    expect(meta).toContain("Kind: Control plan");
    expect(meta).toContain("Project: Test project");
  });

  it("emits the empty marker when no rows exist", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "1",
      title: "CP",
      headers: [h(1, "1", "Udførelse")],
      rows: [],
    });
    const content = doc.content as Content[];
    // last node should be the empty marker
    const last = content[content.length - 1];
    expect(
      last && typeof last === "object" && "text" in last
        ? (last as { text: unknown }).text
        : undefined,
    ).toBe("(no control-plan rows)");
  });

  it("renders a table with header row + group rows + data rows", () => {
    const headers = [h(1, "1", "Udførelse"), h(2, "2", "Kvalitetskontrol")];
    const rows = [
      r(10, 1, "1.1", "Støbning", { controlType: 1 }),
      r(11, 1, "1.2", "Hærdning", { controlType: 2 }),
      r(12, 2, "2.1", "Trykprøve", { controlType: 3 }),
    ];
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "3.1",
      title: "CP",
      headers,
      rows,
    });
    const content = doc.content as Content[];
    // Find the table node (last content item when rows exist).
    const tableNode = content[content.length - 1] as {
      table?: { body?: unknown[]; widths?: unknown[]; headerRows?: number };
    };
    expect(tableNode.table).toBeDefined();
    expect(tableNode.table!.headerRows).toBe(1);
    const body = tableNode.table!.body as unknown[][];
    // 1 header row + 2 group rows + 3 data rows = 6
    expect(body.length).toBe(6);
    // First group cell text should start with "1  Udførelse"
    const firstGroupCell = body[1]![0] as { text?: unknown };
    expect(firstGroupCell.text).toBe("1  Udførelse");
    // Second group cell text should start with "2  Kvalitetskontrol"
    const secondGroupCell = body[4]![0] as { text?: unknown };
    expect(secondGroupCell.text).toBe("2  Kvalitetskontrol");
  });

  it("renders the control-type badge as E/U/T/—", () => {
    const headers = [h(1, "1", "G")];
    const rows = [
      r(1, 1, "1", "none"), // controlType 0
      r(2, 1, "2", "e", { controlType: 1 }),
      r(3, 1, "3", "u", { controlType: 2 }),
      r(4, 1, "4", "t", { controlType: 3 }),
    ];
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "",
      title: "T",
      headers,
      rows,
    });
    const content = doc.content as Content[];
    const tableNode = content[content.length - 1] as {
      table: { body: unknown[][] };
    };
    const body = tableNode.table.body;
    // row 0 = col header; row 1 = group; rows 2..5 = data
    const badges = body.slice(2).map((row) => {
      const cell = row[0] as { text?: unknown };
      return cell.text;
    });
    expect(badges).toEqual(["—", "E", "U", "T"]);
  });

  it("skips groups that ended up empty", () => {
    // Two headers, but only one has rows. Empty group must not
    // produce a visible group row (would look like dead whitespace).
    const headers = [h(1, "1", "A"), h(2, "2", "B")];
    const rows = [r(10, 2, "2.1", "only B")];
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "",
      title: "T",
      headers,
      rows,
    });
    const content = doc.content as Content[];
    const tableNode = content[content.length - 1] as {
      table: { body: unknown[][] };
    };
    const body = tableNode.table.body;
    // header row + 1 group row + 1 data row
    expect(body.length).toBe(3);
    const group = body[1]![0] as { text?: unknown };
    expect(group.text).toBe("2  B");
  });

  it("uses A4 landscape", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
    });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("landscape");
  });

  it("lands orphan rows under a '(no header)' synthetic group", () => {
    const rows = [r(10, 999, "1", "orphan")];
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "",
      title: "T",
      headers: [],
      rows,
    });
    const content = doc.content as Content[];
    const tableNode = content[content.length - 1] as {
      table: { body: unknown[][] };
    };
    const body = tableNode.table.body;
    const group = body[1]![0] as { text?: unknown };
    expect(group.text).toBe("?  (no header)");
  });

  // ---- 7.2 additions ------------------------------------------------

  it("turns on dontBreakRows so table rows don't split mid-row", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      headers: [h(1, "1", "G")],
      rows: [r(10, 1, "1", "row")],
    });
    const content = doc.content as Content[];
    const tableNode = content[content.length - 1] as {
      table: { dontBreakRows?: boolean };
    };
    expect(tableNode.table.dontBreakRows).toBe(true);
  });

  it("emits a cover page when includeCoverPage is true", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      includeCoverPage: true,
      numberText: "3.1",
      title: "CP",
      projectName: "Prj",
    });
    const content = doc.content as Content[];
    const texts = content
      .map((n) =>
        n && typeof n === "object" && "text" in n
          ? (n as { text: unknown }).text
          : undefined,
      )
      .filter((t): t is string => typeof t === "string");
    // Cover contributes the big title "3.1  CP" string AND the
    // title-block version emits it again further down — so it should
    // appear at least twice.
    const occurrences = texts.filter((t) => t === "3.1  CP").length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(texts).toContain("Company name");
    expect(texts).toContain("Prj");
  });

  it("builds a BIPS-style running header + footer for CPs", () => {
    const doc = buildCpPdf({
      ...defaultArgs(),
      numberText: "3.1",
      title: "Kontrolplan",
      projectName: "Prj",
      workAreaName: "2.5 Beton",
      contractLabel: "01 - X",
    });
    const headerFn = doc.header as (p: number, pc: number) => unknown;
    const headerTexts = collectAllText(headerFn(2, 4));
    // Right-column bold top cell.
    expect(headerTexts).toContain("Prj");
    // Row 3 left — work area inherited from the BDB that owns the CP.
    expect(headerTexts).toContain("2.5 Beton");
    // Row 4 left — CP's full title ("number  title").
    expect(headerTexts).toContain("3.1  Kontrolplan");
    // Danish BIPS labels.
    expect(headerTexts).toContain("Dato");
    expect(headerTexts).toContain("Side");
    // Contract label is cover-only now, not in the header.
    expect(headerTexts).not.toContain("01 - X");

    const footerFn = doc.footer as (p: number, pc: number) => unknown;
    const footerTexts = collectAllText(footerFn(2, 4));
    expect(footerTexts).toContain("Company name");
    expect(footerTexts).toContain("Page 2 of 4");
  });
});

/**
 * Walk a pdfmake Content node recursively and collect every string
 * `text`. Needed because the 7.3b BIPS header is a nested table, not
 * a flat columns node.
 */
function collectAllText(node: unknown): string[] {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    if (typeof obj.text === "string") out.push(obj.text);
    else if (Array.isArray(obj.text)) visit(obj.text);
    if (Array.isArray(obj.columns)) visit(obj.columns);
    if (obj.table && typeof obj.table === "object") {
      const t = obj.table as { body?: unknown };
      if (Array.isArray(t.body)) visit(t.body);
    }
    if (Array.isArray(obj.stack)) visit(obj.stack);
  };
  visit(node);
  return out;
}
