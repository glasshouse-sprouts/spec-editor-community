/** @vitest-environment jsdom */

/**
 * Tests for the 6L.2 external URL link → pdfmake pipeline.
 *
 * The editor emits `<a href="…">text</a>` in the section body. On PDF
 * export the HTML passes through `html-to-pdfmake`, which should turn
 * each `<a>` into a pdfmake text node with a `link:` attribute so the
 * link is clickable in the exported PDF viewer.
 *
 * We don't render a real PDF here (that needs pdfmake's VFS + Roboto,
 * which is an Electron-runtime concern). Instead we probe the step we
 * actually own: the HTML → pdfmake-doc conversion. If html-to-pdfmake
 * ever stops emitting `link:` for `<a href>`, these tests catch it and
 * we pin the library version.
 */

import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const htmlToPdfmake = require("html-to-pdfmake") as (
  html: string,
  opts?: Record<string, unknown>,
) => unknown;

/**
 * Walk a pdfmake content tree and collect every `link:` value found.
 * The tree nests arbitrarily (paragraphs contain text arrays, which
 * contain runs, which can have their own children), so we recurse.
 */
function collectLinks(node: unknown): string[] {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if (typeof obj.link === "string") out.push(obj.link);
      if (obj.text) visit(obj.text);
      if (obj.stack) visit(obj.stack);
    }
  };
  visit(node);
  return out;
}

describe("6L.2 links → pdfmake export", () => {
  it("converts https link to pdfmake { link: ... } node", () => {
    const html = '<p>See <a href="https://example.com">docs</a>.</p>';
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual(["https://example.com"]);
  });

  it("converts mailto link to pdfmake { link: mailto:... } node", () => {
    const html = '<p>Mail <a href="mailto:team@example.dk">us</a>.</p>';
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual(["mailto:team@example.dk"]);
  });

  it("converts http link (plain) to pdfmake link node", () => {
    const html = '<p><a href="http://legacy.example/page">legacy</a></p>';
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual(["http://legacy.example/page"]);
  });

  it("preserves multiple links in a single paragraph in order", () => {
    const html =
      '<p>See <a href="https://a.example">A</a>, ' +
      '<a href="https://b.example">B</a> and ' +
      '<a href="mailto:c@d.dk">C</a>.</p>';
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual([
      "https://a.example",
      "https://b.example",
      "mailto:c@d.dk",
    ]);
  });

  it("preserves the link's visible text on the same node", () => {
    // The text run carrying `link:` must also carry the anchor text, so
    // pdfmake draws a clickable label rather than a bare URL.
    const html = '<p><a href="https://example.com">Visit us</a></p>';
    const result = htmlToPdfmake(html, { window }) as unknown;
    const links: Array<{ text: string; link: string }> = [];
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(visit);
        return;
      }
      if (n && typeof n === "object") {
        const obj = n as Record<string, unknown>;
        if (typeof obj.link === "string" && typeof obj.text === "string") {
          links.push({ text: obj.text, link: obj.link });
        }
        if (obj.text && typeof obj.text !== "string") visit(obj.text);
        if (obj.stack) visit(obj.stack);
      }
    };
    visit(result);
    expect(links).toEqual([{ text: "Visit us", link: "https://example.com" }]);
  });

  it("emits no links when the HTML has none", () => {
    const html = "<p>Plain text with no links.</p>";
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual([]);
  });

  it("survives paragraphs with only a link and nothing else", () => {
    const html = '<p><a href="https://example.com">only</a></p>';
    const result = htmlToPdfmake(html, { window });
    expect(collectLinks(result)).toEqual(["https://example.com"]);
  });
});
