/** @vitest-environment jsdom */

/**
 * Task 105 - the renderer and core sanitize section bodies alike.
 *
 * The renderer sanitizes with DOMPurify (`sanitizeBody.ts`); core,
 * which has no DOM, with its own tokenizer (`sanitizeSectionBody.ts`).
 * The renderer may not import core, so the allowlist exists twice.
 * This test is what keeps the copies equal:
 *
 *   - the tag lists and the attribute lists are the same sets;
 *   - a corpus of real-looking bodies, including every attribute rule
 *     at its edges, comes out of both sanitizers identically.
 *
 * Remove a tag from one list only, and the first test fails.
 *
 * Card 195 adds the `<specialchar>` translation, which also exists
 * twice (`symbolFontChars.ts` in core and in the renderer): the two
 * tables must be equal, and both sanitizers must give the same result
 * for every printable ASCII character inside the tag. Change a symbol
 * in one table only, and the last tests fail.
 */
import {
  SECTION_BODY_ALLOWED_ATTRS,
  SECTION_BODY_ALLOWED_CLASSES,
  SECTION_BODY_ALLOWED_TAGS,
  sanitizeSectionBody,
} from "@molio2-editor/core";
import { describe, expect, it } from "vitest";

import { ALL_MARK_KINDS } from "../src/renderer/src/highlights/markKinds.js";
import {
  MOLIO_ALLOWED_ATTRS,
  MOLIO_ALLOWED_TAGS,
  sanitizeBody,
} from "../src/renderer/src/sanitizeBody.js";
import {
  SYMBOL_FONT_CHARS as RENDERER_SYMBOLS,
  UNKNOWN_SYMBOL_MARK as RENDERER_MARK,
} from "../src/renderer/src/symbolFontChars.js";
// Core does not export its table; a test may read core's source.
import {
  SYMBOL_FONT_CHARS as CORE_SYMBOLS,
  UNKNOWN_SYMBOL_MARK as CORE_MARK,
} from "../../core/src/symbolFontChars.js";

const sorted = (xs: readonly string[]) => [...xs].sort();
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("section body allowlist: renderer and core agree", () => {
  it("allow the same tags", () => {
    expect(sorted(SECTION_BODY_ALLOWED_TAGS)).toEqual(
      sorted(MOLIO_ALLOWED_TAGS),
    );
  });

  it("allow the same attributes", () => {
    expect(sorted(SECTION_BODY_ALLOWED_ATTRS)).toEqual(
      sorted(MOLIO_ALLOWED_ATTRS),
    );
  });

  // Task 149 - core's class list is what the MCP server tells the AI
  // it may use, so it must be the editor's eight formatting classes:
  // the four highlights on <mark>, the four text colours on <span>.
  it("allow the editor's eight formatting classes, each on its own tag", () => {
    expect(SECTION_BODY_ALLOWED_CLASSES).toEqual({
      mark: ALL_MARK_KINDS.filter((k) => k.startsWith("bg-")),
      span: ALL_MARK_KINDS.filter((k) => k.startsWith("tc-")),
    });
    expect(ALL_MARK_KINDS).toHaveLength(8);
  });

  it.each([
    // every allowed tag in ordinary use
    "<p>tekst <strong>fed</strong> <em>kursiv</em> <u>u</u> <s>s</s><br>ny linje</p>",
    "<ul><li>a<ol><li>b</li></ol></li></ul>",
    "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>",
    "<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>",
    "<blockquote><p>citat</p></blockquote><pre>a\n  b</pre>",
    "<p><b>b</b> <i>i</i> H<sub>2</sub>O m<sup>2</sup> <span>s</span></p>",
    // class: only the eight palette values, only on mark / span
    '<p><mark class="bg-yellow">y</mark><mark class="bg-pink">p</mark></p>',
    '<p><span class="tc-green">g</span><span class="bg-green">x</span></p>',
    '<p class="tc-red">p</p>',
    // data-width: digits, only on td / th
    '<table><tbody><tr><td data-width="120">a</td><td data-width="12px">b</td><th data-width="99999">c</th></tr></tbody></table>',
    '<p data-width="10">p</p>',
    // img: data URL of four image types, digit width, alt
    `<p><img src="${PNG}" width="320" alt="foto"></p>`,
    '<p><img src="data:image/jpeg;base64,/9j/4AAQ"><img src="data:image/webp;base64,UklG"></p>',
    '<p><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="https://x/y.png"></p>',
    `<p><img src="${PNG}" width="100px" height="20"></p>`,
    // a: http, https, mailto only
    '<p><a href="https://molio.dk">a</a> <a href="http://x.dk">b</a> <a href="mailto:a@b.dk">c</a></p>',
    '<p><a href="javascript:alert(1)">a</a> <a href="ftp://x">b</a> <a href="/rel">c</a></p>',
    '<p><a href="https://x" target="_blank" rel="noopener">a</a></p>',
    '<p><img alt="x" src="' + PNG + '"><a alt="y" src="z">q</a></p>',
    // dangerous content, well-formed
    "<p>a</p><script>alert(1)</script><style>p{}</style><p>b</p>",
    '<p onclick="x()" style="color:red">p</p>',
    "<div><section><p>indpakket</p></section></div>",
  ])("give the same result for %j", (html) => {
    expect(sanitizeSectionBody(html)).toBe(sanitizeBody(html));
  });

  it("translate <specialchar> with the same table", () => {
    expect(CORE_SYMBOLS).toEqual(RENDERER_SYMBOLS);
    expect(CORE_MARK).toBe(RENDERER_MARK);
  });

  // Every printable ASCII character but the three that are markup.
  const ASCII = Array.from({ length: 0x7e - 0x20 }, (_, i) =>
    String.fromCharCode(0x21 + i),
  ).filter((c) => !"<>&".includes(c));

  it.each(ASCII)("translate <specialchar>%s</specialchar> alike", (c) => {
    const html = `<p>x<specialchar>${c}</specialchar>y</p>`;
    expect(sanitizeSectionBody(html)).toBe(sanitizeBody(html));
  });

  it.each([
    "<p>Lagtykkelse: &lt;x&gt; <specialchar>m</specialchar>m</p>",
    "<p>varmeledningsevne <specialchar>l</specialchar><sub>deklareret</sub>: &lt;x&gt; W/mK</p>",
    "<table><tbody><tr><td>Duktilitet<specialchar>e</specialchar><sub>uk</sub> (%)</td></tr></tbody></table>",
    "<p>( <specialchar>h</specialchar>h ) <specialChar>m</specialChar>m</p>",
    "<p><specialchar></specialchar><specialchar>λ</specialchar><specialchar>ab</specialchar></p>",
  ])("translate Molio's own <specialchar> alike: %j", (html) => {
    expect(sanitizeSectionBody(html)).toBe(sanitizeBody(html));
  });
});
