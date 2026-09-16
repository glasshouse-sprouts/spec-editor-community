/** @vitest-environment jsdom */
/**
 * Slice "Highlights & formatting" — `stripHighlights` helper.
 *
 * Verifies the markup-only strip semantics: matching `<mark>` /
 * `<span>` tags are unwrapped, inner text + nested formatting
 * survives, and unrelated content (tables, images, links, headings)
 * is untouched.
 */
import { describe, expect, it } from "vitest";

import { stripHighlights } from "../src/renderer/src/highlights/stripHighlights.js";
import type { MarkKind } from "../src/renderer/src/highlights/markKinds.js";

function set(...kinds: MarkKind[]): ReadonlySet<MarkKind> {
  return new Set(kinds);
}

describe("stripHighlights", () => {
  it("returns '' for null / empty input", () => {
    expect(stripHighlights(null, set("bg-yellow"))).toBe("");
    expect(stripHighlights(undefined, set("bg-yellow"))).toBe("");
    expect(stripHighlights("", set("bg-yellow"))).toBe("");
  });

  it("returns input unchanged when no kinds are selected", () => {
    const html = '<p>Some <mark class="bg-yellow">text</mark>.</p>';
    expect(stripHighlights(html, set())).toBe(html);
  });

  it("returns input unchanged when no marks present", () => {
    const html = "<p>Just plain text.</p>";
    expect(stripHighlights(html, set("bg-yellow", "tc-red"))).toBe(html);
  });

  it("unwraps a single matching highlight, keeping inner text", () => {
    const html = '<p>before <mark class="bg-yellow">middle</mark> after</p>';
    const out = stripHighlights(html, set("bg-yellow"));
    // Inner text survives, no <mark> wrapper left.
    expect(out).not.toContain("<mark");
    expect(out).toContain("middle");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("leaves non-matching mark kinds alone", () => {
    const html =
      '<p><mark class="bg-yellow">y</mark><mark class="bg-blue">b</mark></p>';
    const out = stripHighlights(html, set("bg-yellow"));
    expect(out).not.toContain('class="bg-yellow"');
    expect(out).toContain('class="bg-blue"');
  });

  it("strips text-color spans without touching highlight backgrounds", () => {
    const html =
      '<p><mark class="bg-yellow">y</mark><span class="tc-red">r</span></p>';
    const out = stripHighlights(html, set("tc-red"));
    expect(out).toContain('class="bg-yellow"');
    expect(out).not.toContain('class="tc-red"');
    expect(out).toContain("r");
  });

  it("preserves nested formatting inside the stripped wrapper", () => {
    const html = '<p><mark class="bg-yellow">a <strong>b</strong> c</mark></p>';
    const out = stripHighlights(html, set("bg-yellow"));
    expect(out).not.toContain("<mark");
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("a");
    expect(out).toContain("c");
  });

  it("strips multiple kinds in one pass", () => {
    const html =
      "<p>" +
      '<mark class="bg-yellow">y</mark> ' +
      '<mark class="bg-blue">b</mark> ' +
      '<span class="tc-red">r</span> ' +
      '<span class="tc-green">g</span>' +
      "</p>";
    const out = stripHighlights(html, set("bg-yellow", "tc-red"));
    expect(out).not.toContain('class="bg-yellow"');
    expect(out).toContain('class="bg-blue"');
    expect(out).not.toContain('class="tc-red"');
    expect(out).toContain('class="tc-green"');
  });

  it("leaves tables, images, and links untouched", () => {
    const html =
      '<table><tr><td><mark class="bg-yellow">cell</mark></td></tr></table>' +
      '<p><a href="https://example.com">link</a></p>' +
      '<p><img src="data:image/png;base64,xx" alt="i" /></p>';
    const out = stripHighlights(html, set("bg-yellow"));
    expect(out).toContain("<table");
    expect(out).toContain("<td>cell</td>");
    expect(out).toContain('<a href="https://example.com">link</a>');
    expect(out).toContain("<img");
  });
});
