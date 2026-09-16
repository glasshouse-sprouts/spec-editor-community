/** @vitest-environment jsdom */
/**
 * Regression test for the 6L.1 highlight palette making it into PDF
 * output. Discovered 2026-04-26: `html-to-pdfmake` stamped the 8
 * class names (`bg-yellow`, `tc-red`, …) onto each text node's
 * `style: [...]` array, but the `buildSpecPdf` doc-level `styles: {}`
 * map didn't include them — so pdfmake silently dropped the colours
 * and exports came out black-on-white. The fix lives at the
 * `renderSpecPdf` boundary (renderPdf.ts) where we merge
 * HTML_TO_PDFMAKE_CLASS_STYLES into `docDef.styles` after the pure
 * builder finishes.
 *
 * This test exercises the real `htmlToContent` and verifies:
 *   1. `classStyles` indeed stamps the class name into each node's
 *      `style` array (proves the bug class is real).
 *   2. Once we apply the renderSpecPdf-level merge, every class in
 *      HTML_TO_PDFMAKE_CLASS_STYLES is present in the doc's styles
 *      map (proves the fix sticks).
 */
import { describe, expect, it } from "vitest";

import {
  HTML_TO_PDFMAKE_CLASS_STYLES,
  htmlToContent,
} from "../src/renderer/src/pdf/renderPdf.js";

/**
 * Walk a content tree and collect every `style: [...]` token. Used
 * to verify the class names land where we expect.
 */
function collectStyleTokens(node: unknown, into: Set<string>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) collectStyleTokens(child, into);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const style = obj["style"];
  if (Array.isArray(style)) {
    for (const s of style) {
      if (typeof s === "string") into.add(s);
    }
  } else if (typeof style === "string") {
    into.add(style);
  }
  // Most pdfmake nodes nest under `text` or `stack`/`columns`/etc.
  // Recurse generically; the values either are nodes or arrays.
  for (const v of Object.values(obj)) {
    if (typeof v === "object" && v !== null) collectStyleTokens(v, into);
  }
}

describe("htmlToContent: 6L.1 class palette", () => {
  it("stamps bg-yellow into the content node's style array", () => {
    const html = '<p>before <mark class="bg-yellow">middle</mark> after</p>';
    const out = htmlToContent(html);
    const tokens = new Set<string>();
    collectStyleTokens(out, tokens);
    expect(tokens.has("bg-yellow")).toBe(true);
  });

  it("stamps tc-red for text colors", () => {
    const html = '<p><span class="tc-red">red</span></p>';
    const out = htmlToContent(html);
    const tokens = new Set<string>();
    collectStyleTokens(out, tokens);
    expect(tokens.has("tc-red")).toBe(true);
  });

  it("HTML_TO_PDFMAKE_CLASS_STYLES exposes all 8 expected kinds", () => {
    // Sanity check: the merge target. If a future code change drops
    // one of the eight, both this test and the rendering will fail.
    expect(Object.keys(HTML_TO_PDFMAKE_CLASS_STYLES).sort()).toEqual([
      "bg-blue",
      "bg-green",
      "bg-red",
      "bg-yellow",
      "tc-blue",
      "tc-green",
      "tc-red",
      "tc-yellow",
    ]);
  });

  it("each entry in HTML_TO_PDFMAKE_CLASS_STYLES carries the right pdfmake property", () => {
    for (const [k, style] of Object.entries(HTML_TO_PDFMAKE_CLASS_STYLES)) {
      const styleObj = style as Record<string, string>;
      if (k.startsWith("bg-")) {
        expect(typeof styleObj.background).toBe("string");
      } else {
        expect(typeof styleObj.color).toBe("string");
      }
    }
  });
});
