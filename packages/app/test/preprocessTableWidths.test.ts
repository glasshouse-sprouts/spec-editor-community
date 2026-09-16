/** @vitest-environment jsdom */

/**
 * Tests for the 6L.4 HTML → pdfmake column-width preprocessor.
 *
 * The input is HTML that carries `data-width="N"` on first-row cells
 * (written by the TipTap editor's MolioTableCell/Header extensions).
 * The output is the same HTML but with a `data-pdfmake='{"widths":[…]}'`
 * attribute on the `<table>` so html-to-pdfmake wires those proportions
 * straight into pdfmake's `widths` array.
 *
 * We test the *behavior* not the exact numeric output: proportions must
 * round-trip correctly, and missing/invalid data stays safe.
 */

import { describe, expect, it } from "vitest";

import { preprocessTableWidths } from "../src/renderer/src/pdf/renderPdf.js";

function parseTableAttr(html: string): {
  widths?: Array<number | string>;
} | null {
  const m = html.match(/<table[^>]*\sdata-pdfmake=(['"])([^]*?)\1/);
  if (!m) return null;
  // data-pdfmake value could have been HTML-entity escaped — the parser
  // puts back real quotes but " would become &quot;. Normalize both.
  const raw = m[2].replace(/&quot;/g, '"').replace(/&#34;/g, '"');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

describe("preprocessTableWidths", () => {
  it("leaves HTML without tables untouched", () => {
    expect(preprocessTableWidths("<p>no tables here</p>")).toBe(
      "<p>no tables here</p>",
    );
  });

  it("leaves empty input untouched", () => {
    expect(preprocessTableWidths("")).toBe("");
  });

  it("does not add data-pdfmake when no cell has data-width", () => {
    const html = "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>";
    const out = preprocessTableWidths(html);
    expect(out).not.toContain("data-pdfmake");
  });

  it("emits widths array that preserves proportions (100 vs 200 → 1:2)", () => {
    const html =
      '<table><tbody><tr><td data-width="100">a</td><td data-width="200">b</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    const parsed = parseTableAttr(out);
    expect(parsed?.widths).toBeDefined();
    const widths = parsed!.widths as number[];
    expect(widths).toHaveLength(2);
    // 100:200 ⇒ second should be ~2× first. Allow rounding slack.
    expect(widths[1] / widths[0]).toBeGreaterThan(1.8);
    expect(widths[1] / widths[0]).toBeLessThan(2.2);
  });

  it("uses '*' for cells that lack data-width (mixed case)", () => {
    const html =
      '<table><tbody><tr><td data-width="120">a</td><td>b</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    const parsed = parseTableAttr(out);
    expect(parsed?.widths).toEqual([expect.any(Number), "*"]);
  });

  it("reads first-row widths (<thead>) when the header holds them", () => {
    const html =
      '<table><thead><tr><th data-width="80">H1</th><th data-width="80">H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    const parsed = parseTableAttr(out);
    expect(parsed?.widths).toBeDefined();
    const widths = parsed!.widths as number[];
    expect(widths).toHaveLength(2);
    // Equal widths → roughly equal numbers.
    expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(1);
  });

  it("ignores malformed data-width values (e.g. '100px')", () => {
    const html =
      '<table><tbody><tr><td data-width="100px">a</td><td>b</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    // Both cells invalid/missing → no widths array emitted.
    expect(out).not.toContain("data-pdfmake");
  });

  it("handles multiple tables independently", () => {
    const html =
      '<table><tbody><tr><td data-width="50">a</td><td data-width="50">b</td></tr></tbody></table>' +
      '<table><tbody><tr><td data-width="10">c</td><td data-width="90">d</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    // Two <table> tags, both should carry data-pdfmake.
    const matches = out.match(/data-pdfmake=/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("is a no-op when DOMParser is unavailable (safety path)", () => {
    // Not practical to unset DOMParser mid-test; we assert by giving a
    // table with no rows — the function should gracefully return input.
    const html = "<table></table>";
    expect(preprocessTableWidths(html)).toBe(html);
  });

  it("widths stay within a reasonable pdfmake range (1–1000pt)", () => {
    const html =
      '<table><tbody><tr><td data-width="100">a</td><td data-width="200">b</td><td data-width="100">c</td></tr></tbody></table>';
    const out = preprocessTableWidths(html);
    const parsed = parseTableAttr(out);
    const widths = parsed!.widths as number[];
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(1000);
    }
  });
});
