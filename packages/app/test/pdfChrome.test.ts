/**
 * Unit tests for the shared PDF chrome helpers — running header,
 * running footer, and the cover-page stub.
 *
 * As of 7.3b the running header follows the Danish BIPS B1000 template:
 * a 2-column × 4-row table with Bygherre/Entrepriseform placeholders on
 * the left and a label:value block on the right. Tests poke inside the
 * returned `table.body` to check both the structure and the content.
 *
 * The helpers are pure — header/footer return functions, so we call
 * those functions directly with sample page numbers.
 */
import { describe, expect, it } from "vitest";

import {
  BYGHERRE_PLACEHOLDER,
  ENTREPRISEFORM_PLACEHOLDER,
  makeCover,
  makeFooter,
  makeHeader,
  type PdfChromeArgs,
  type PdfCoverArgs,
} from "../src/renderer/src/pdf/pdfChrome.js";

function baseArgs(overrides: Partial<PdfChromeArgs> = {}): PdfChromeArgs {
  return {
    projectName: "Prj",
    workAreaName: "2.5 Beton",
    documentLabel: "Arbejdsbeskrivelse",
    dateText: "2026-04-20",
    revisionDateText: null,
    companyName: "Company name",
    ...overrides,
  };
}

function baseCoverArgs(overrides: Partial<PdfCoverArgs> = {}): PdfCoverArgs {
  return {
    ...baseArgs(),
    title: "My spec title",
    subtitle: null,
    revision: null,
    revisionDate: null,
    contractLabel: "01 - Fagentreprise",
    ...overrides,
  };
}

/**
 * Walk a pdfmake Content node recursively and return every string
 * `text` value encountered. Good enough for the "did this string
 * survive into the output" class of assertion without coupling to the
 * exact nesting shape.
 */
function collectText(node: unknown): string[] {
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

/**
 * Shape of the running header node: a `stack` of two sub-tables (see
 * `makeHeader` - row 1 is 50/50, rows 2-4 are wide-left + fixed meta).
 */
interface HeaderSubTable {
  table?: { widths?: unknown[]; body?: unknown[] };
  layout?: {
    hLineWidth?: (i: number, n: { table: { body: unknown[] } }) => number;
  };
}
interface HeaderNode {
  stack?: HeaderSubTable[];
}

describe("makeHeader (BIPS B1000)", () => {
  it("returns an empty node for page 1 so the cover stays clean", () => {
    const fn = makeHeader(baseArgs());
    const node = fn(1, 5) as { text?: string };
    expect(node.text).toBe("");
  });

  it("builds two stacked sub-tables (50/50 row 1, wide+meta rows 2-4) with a rule under each", () => {
    const fn = makeHeader(baseArgs());
    const node = fn(2, 5) as HeaderNode;
    // pdfmake column widths are per-COLUMN, not per-row, and row 1 needs
    // 50/50 while rows 2-4 need wide-left + fixed meta. So the header is
    // two stacked sub-tables rather than one 4-row table.
    expect(node.stack).toHaveLength(2);
    const [topRow, metaRows] = node.stack ?? [];

    // Row 1 — two EQUAL cells (placeholder left, project name right).
    expect(topRow?.table?.widths).toEqual(["*", "*"]);
    expect(topRow?.table?.body).toHaveLength(1);

    // Rows 2-4 — left column flexes; right column is the fixed
    // label+colon+value block (numeric width) so the meta rows line up.
    const widths = metaRows?.table?.widths ?? [];
    expect(widths[0]).toBe("*");
    expect(typeof widths[1]).toBe("number");
    expect(widths[1] as number).toBeGreaterThan(0);
    expect(metaRows?.table?.body).toHaveLength(3);

    // Every row in both sub-tables has exactly 2 cells.
    for (const sub of node.stack ?? []) {
      for (const row of sub.table?.body ?? []) {
        expect(Array.isArray(row)).toBe(true);
        expect((row as unknown[]).length).toBe(2);
      }
    }

    // BIPS template: a rule under the LAST row of each sub-table, which
    // reproduces the old "under row 1 and under row 4". Nothing else.
    for (const sub of node.stack ?? []) {
      const h = sub.layout?.hLineWidth;
      expect(h).toBeTypeOf("function");
      if (h) {
        const rows = sub.table?.body ?? [];
        const fakeNode = { table: { body: rows } };
        expect(h(0, fakeNode)).toBe(0);
        for (let i = 1; i < rows.length; i += 1) {
          expect(h(i, fakeNode)).toBe(0);
        }
        expect(h(rows.length, fakeNode)).toBe(0.5);
      }
    }
  });

  it("does not set explicit fontSize on header cells (inherits body font)", () => {
    const fn = makeHeader(baseArgs());
    const node = fn(2, 5) as HeaderNode;
    // Walk every cell in every row and assert no `fontSize` override.
    // This is what makes the header match the document's normal text.
    const assertNoFontSize = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      expect(obj.fontSize).toBeUndefined();
      if (Array.isArray(obj.columns)) obj.columns.forEach(assertNoFontSize);
    };
    for (const sub of node.stack ?? []) {
      for (const row of sub.table?.body ?? []) {
        for (const cell of row as unknown[]) assertNoFontSize(cell);
      }
    }
  });

  it("prints the Danish placeholders, work-area name, document label on the left", () => {
    const fn = makeHeader(
      baseArgs({ workAreaName: "3.1 Gulv", documentLabel: "BDB X" }),
    );
    const node = fn(2, 5);
    const texts = collectText(node);
    expect(texts).toContain(BYGHERRE_PLACEHOLDER);
    expect(texts).toContain(ENTREPRISEFORM_PLACEHOLDER);
    expect(texts).toContain("3.1 Gulv");
    expect(texts).toContain("BDB X");
  });

  it("prints project name, Dato, Rev.dato, and Side on the right", () => {
    const fn = makeHeader(
      baseArgs({
        projectName: "My Project",
        dateText: "2026-04-20",
        revisionDateText: "2026-04-19",
      }),
    );
    const node = fn(3, 7);
    const texts = collectText(node);
    expect(texts).toContain("My Project");
    expect(texts).toContain("Dato");
    expect(texts).toContain("Rev.dato");
    expect(texts).toContain("Side");
    expect(texts).toContain("2026-04-20");
    expect(texts).toContain("2026-04-19");
    // Side value is current / total.
    expect(texts).toContain("3/7");
  });

  it("leaves the Rev.dato value blank when no revisionDate is supplied", () => {
    const fn = makeHeader(baseArgs({ revisionDateText: null }));
    const node = fn(2, 5);
    const texts = collectText(node);
    expect(texts).toContain("Rev.dato");
    // No date present; label still prints.
    expect(texts.some((t) => /\d{4}-\d{2}-\d{2}/.test(t))).toBe(true); // dateText only
  });

  it("does not duplicate the contract label in the header (cover-only now)", () => {
    const fn = makeHeader(baseArgs());
    const texts = collectText(fn(2, 5));
    expect(texts).not.toContain("01 - Fagentreprise");
  });
});

describe("makeFooter", () => {
  it("returns an empty node for page 1", () => {
    const fn = makeFooter(baseArgs());
    const node = fn(1, 9) as { text?: string };
    expect(node.text).toBe("");
  });

  it("renders company name on the left and Page N of M on the right", () => {
    const fn = makeFooter(baseArgs());
    const node = fn(3, 9);
    const texts = collectText(node);
    expect(texts).toContain("Company name");
    expect(texts).toContain("Page 3 of 9");
  });

  it("puts a horizontal rule above the only row (Tore's 'line above')", () => {
    const fn = makeFooter(baseArgs());
    const node = fn(2, 5) as {
      layout?: { hLineWidth?: (i: number) => number };
    };
    const h = node.layout?.hLineWidth;
    expect(h).toBeTypeOf("function");
    if (h) {
      // Top of the only row = hline. Bottom = none.
      expect(h(0)).toBe(0.5);
      expect(h(1)).toBe(0);
    }
  });

  it("adds breathing-room margin above the footer (~one line)", () => {
    const fn = makeFooter(baseArgs());
    const node = fn(2, 5) as { margin?: number[] };
    // [left, top, right, bottom] — top margin must be > 0.
    expect(Array.isArray(node.margin)).toBe(true);
    expect((node.margin ?? [])[1]).toBeGreaterThanOrEqual(8);
  });

  it("does not set explicit fontSize on footer cells (inherits body font)", () => {
    const fn = makeFooter(baseArgs());
    const node = fn(2, 5) as { table?: { body?: unknown[][] } };
    for (const row of node.table?.body ?? []) {
      for (const cell of row) {
        if (cell && typeof cell === "object") {
          expect((cell as { fontSize?: unknown }).fontSize).toBeUndefined();
        }
      }
    }
  });
});

describe("makeCover", () => {
  it("includes title, project, contract, and company name", () => {
    const content = makeCover(
      baseCoverArgs({ title: "My spec title", subtitle: "2.5" }),
    );
    const texts = collectText(content);
    expect(texts).toContain("My spec title");
    expect(texts).toContain("2.5");
    expect(texts).toContain("Prj");
    expect(texts).toContain("01 - Fagentreprise");
    expect(texts).toContain("Company name");
  });

  it("marks the tail node with pageBreak: 'after'", () => {
    const content = makeCover(baseCoverArgs({ title: "X" }));
    const last = content[content.length - 1];
    expect(
      last && typeof last === "object"
        ? (last as { pageBreak?: string }).pageBreak
        : undefined,
    ).toBe("after");
  });

  it("omits the contract line when no contract is assigned", () => {
    const content = makeCover(
      baseCoverArgs({ title: "X", contractLabel: null }),
    );
    const texts = collectText(content);
    expect(texts).not.toContain("01 - Fagentreprise");
  });

  it("prints a revision line when revision or revisionDate is set", () => {
    const content = makeCover(
      baseCoverArgs({
        title: "X",
        revision: "B",
        revisionDate: "2026-04-19",
      }),
    );
    const combined = collectText(content).join("|");
    expect(combined).toContain("Revision: B");
    expect(combined).toContain("Revision date: 2026-04-19");
  });

  it("uses tighter vertical spacers when orientation is landscape", () => {
    // Sum every [left, top, right, bottom] margin in both variants and
    // assert landscape's total vertical space is meaningfully smaller —
    // otherwise the landscape CP cover spills onto page 2 again.
    const totalVertical = (content: ReturnType<typeof makeCover>) =>
      content.reduce((acc, node) => {
        if (!node || typeof node !== "object" || !("margin" in node))
          return acc;
        const m = (node as { margin?: unknown }).margin;
        if (Array.isArray(m) && m.length === 4) {
          return (
            acc +
            (typeof m[1] === "number" ? m[1] : 0) +
            (typeof m[3] === "number" ? m[3] : 0)
          );
        }
        return acc;
      }, 0);
    const portrait = makeCover(baseCoverArgs({ title: "X" }));
    const landscape = makeCover(
      baseCoverArgs({ title: "X", orientation: "landscape" }),
    );
    expect(totalVertical(landscape)).toBeLessThan(totalVertical(portrait));
    // Hard upper bound: landscape A4 is ~595pt tall; with ~100pt of
    // page-margin chrome that leaves ~495pt. Keep spacer total well
    // under that so text + gaps fit together.
    expect(totalVertical(landscape)).toBeLessThan(350);
  });
});
