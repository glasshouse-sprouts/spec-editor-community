/** @vitest-environment jsdom */
/**
 * Slice "Version compare" Phase F — HTML-aware word diff.
 *
 * The aligned-view right column should preserve the reference HTML's
 * structure (tables, bold, lists) while marking word-level deletes
 * inside the original tags and surfacing additions somewhere visible.
 *
 * Coverage focus:
 *   - Both empty / single-side empty short-circuits.
 *   - Word change inside a `<strong>` keeps the `<strong>` tag.
 *   - Table cells stay as `<td>`/`<tr>` after diff (no flat collapse).
 *   - Added text appears in the output (appended to last block when
 *     not in-place).
 *   - All-deleted case still preserves table structure on the right.
 */
import { describe, expect, it } from "vitest";

import {
  htmlDiff,
  htmlDiffOneSide,
} from "../src/renderer/src/compare/htmlDiff.js";
import {
  DEFAULT_VERSION_COMPARE_FORMAT,
  type DiffFormat,
} from "../src/renderer/src/compare/versionCompareFormat.js";

const ADDED: DiffFormat = DEFAULT_VERSION_COMPARE_FORMAT.added;
const DELETED: DiffFormat = DEFAULT_VERSION_COMPARE_FORMAT.deleted;

describe("htmlDiff", () => {
  it("returns '' when both bodies are empty", () => {
    expect(htmlDiff("", "", ADDED, DELETED)).toBe("");
  });

  it("wraps current as added when reference is empty", () => {
    const out = htmlDiff("", "<p>brand new</p>", ADDED, DELETED);
    expect(out).toContain("brand new");
    // Added formatting (the default added format includes the green colour).
    expect(out.toLowerCase()).toContain("color");
  });

  it("preserves the <strong> tag when a word inside it is deleted", () => {
    const ref = "<p>Hello <strong>brave</strong> world</p>";
    const cur = "<p>Hello world</p>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // The original <strong> wrapper stays — only its inner text is wrapped
    // with a deleted-format span.
    expect(out).toContain("<strong>");
    expect(out).toContain("brave");
    // Some kind of inline marker for the deleted text.
    expect(out.toLowerCase()).toContain("line-through");
  });

  it("preserves table structure across diff", () => {
    const ref = "<table><tr><td>A1</td><td>A2</td></tr></table>";
    const cur = "<table><tr><td>A1</td><td>A2 plus</td></tr></table>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // Cells remain in separate <td>s — not flattened.
    expect(out).toContain("<td>");
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    // The added word "plus" must surface somewhere in the output.
    expect(out).toContain("plus");
  });

  it("preserves table structure when current is empty (all deleted)", () => {
    const ref = "<table><tr><td>x</td><td>y</td></tr></table>";
    const out = htmlDiff(ref, "", ADDED, DELETED);
    // Two cells still present; both contents marked as deleted.
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    expect(out).toContain("x");
    expect(out).toContain("y");
    expect(out.toLowerCase()).toContain("line-through");
  });

  it("returns reference HTML unchanged when both texts are identical", () => {
    const ref = "<p>Hello <em>there</em></p>";
    const out = htmlDiff(ref, ref, ADDED, DELETED);
    // No diff marks — no inline style spans should be added.
    expect(out).not.toContain("line-through");
    // The <em> wrapper survives.
    expect(out).toContain("<em>");
    expect(out).toContain("there");
  });

  it("surfaces added words when reference is mostly the same", () => {
    const ref = "<p>The quick fox jumps</p>";
    const cur = "<p>The quick brown fox jumps</p>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // The reference text survives.
    expect(out).toContain("quick");
    expect(out).toContain("fox");
    // The added word is present somewhere in the output — even if the
    // current diff implementation appends it at the end of the block
    // rather than splicing it in-place, the user must still see it.
    expect(out).toContain("brown");
  });

  it("places an added word inline before the next surviving word, not at the end", () => {
    // Regression: previously, all 'added' segments were concatenated
    // and appended at the very end of the last block element. That
    // turned every changed section into "all original = deleted +
    // big green blob at the bottom". Adds should land near where
    // they were inserted in the document order.
    const ref = "<p>The quick fox jumps over the lazy dog</p>";
    const cur = "<p>The quick brown fox jumps over the lazy dog</p>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // "brown" must appear BEFORE "fox" in the output string —
    // i.e. roughly where it was actually inserted.
    const idxBrown = out.indexOf("brown");
    const idxFox = out.indexOf("fox");
    expect(idxBrown).toBeGreaterThan(-1);
    expect(idxFox).toBeGreaterThan(-1);
    expect(idxBrown).toBeLessThan(idxFox);
  });

  it("does not silently drop diff marks after a `<br>` boundary", () => {
    // Regression: the old refQueue included whitespace tokens from
    // bodyToText (which converts `<br>` into "\n"). The DOM walk had
    // no matching whitespace token at that boundary, so queueIdx
    // desynced and the rest of the section degraded to plain text
    // (no marks). After the fix, words after the <br> still get
    // proper deleted/equal marks.
    const ref = "<p>line one<br>line two</p>";
    const cur = "<p>line one<br>line</p>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // "two" was deleted and must appear with deleted styling.
    expect(out).toContain("two");
    expect(out.toLowerCase()).toContain("line-through");
  });

  it("does not silently drop diff marks after a `</td>` cell boundary", () => {
    // Same desync as above but for table cells: bodyToText injects
    // a space at `</td>` which used to enter the queue. The first
    // cell would render correctly, the second would degrade to plain.
    const ref = "<table><tr><td>old</td><td>kept</td></tr></table>";
    const cur = "<table><tr><td>new</td><td>kept</td></tr></table>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // The deleted "old" must still be marked, AND the equal "kept"
    // in the next cell must remain plain text (no spurious marks).
    expect(out).toContain("old");
    expect(out.toLowerCase()).toContain("line-through");
    // The 2nd cell keeps "kept" as plain text — no styled span around it.
    // We can at least verify the cell structure is preserved.
    expect((out.match(/<td/g) ?? []).length).toBe(2);
  });

  it("preserves added <li> elements as new list items, not flat text", () => {
    // The classic case: ref has a 2-bullet list, cur added 3 more
    // bullets at the end. We want the right column to have all 5
    // <li>s with the new ones rendered as actual bullets in the
    // added format — not as a single flat text run at the end of
    // the last existing <li>.
    const ref = "<ul><li>A</li><li>B</li></ul>";
    const cur = "<ul><li>A</li><li>B</li><li>C</li><li>D</li><li>E</li></ul>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // The output must contain 5 <li>s — all three additions arrive
    // as proper list items, not as text inside the last existing one.
    expect((out.match(/<li/g) ?? []).length).toBe(5);
    expect(out).toContain("C");
    expect(out).toContain("D");
    expect(out).toContain("E");
    // The <ul> wrapper is preserved as exactly one element — not
    // nested or duplicated.
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
  });

  it("preserves added <p> blocks as new paragraphs at sibling level", () => {
    // Ref has 2 paragraphs; cur added a third. The new paragraph
    // should arrive as its own <p>, not as text appended inside the
    // last existing <p>.
    const ref = "<p>first</p><p>second</p>";
    const cur = "<p>first</p><p>second</p><p>third paragraph here</p>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    expect((out.match(/<p[\s>]/g) ?? []).length).toBe(3);
    expect(out).toContain("third");
    expect(out).toContain("paragraph");
    expect(out).toContain("here");
  });

  it("merges added <li>s into ref's existing <ul> when ref's <li>s wrap content in <p>", () => {
    // Real-world shape from the showoff RAC project: ref's <li>
    // children wrap their content in <p>. The leaf-block detection
    // returns the inner <p>, but the splice anchor should still walk
    // up to the <ul> so new <li>s land as siblings of the matched
    // <li>, NOT nested inside it.
    const ref =
      "<ul><li><p>312001 - Glas dør</p></li><li><p>322001 - Dør, dobbelt inder</p></li></ul>";
    const cur =
      "<ul><li>312001 - Glas dør</li><li>322001 - Dør, dobbelt inder</li><li>322001 - Dør, skyde inder</li><li>322002 - Dør, enkelt inder</li></ul>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // Exactly ONE <ul> in the output (no nested duplicate).
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
    // 4 <li>s — the 2 ref ones + 2 added ones, all as peers.
    expect((out.match(/<li/g) ?? []).length).toBe(4);
    // Added words must surface.
    expect(out).toContain("skyde");
    expect(out).toContain("enkelt");
  });

  it("falls back to plain-text append when the trailing add is INSIDE the same block", () => {
    // Ref's last cell contains "A2"; cur adds "plus" inside the
    // same cell. The trailing addition is inline within the same
    // block — splicing in a new <td> would duplicate the cell. The
    // fallback renders a styled span at the end of ref's <td>.
    const ref = "<table><tr><td>A1</td><td>A2</td></tr></table>";
    const cur = "<table><tr><td>A1</td><td>A2 plus</td></tr></table>";
    const out = htmlDiff(ref, cur, ADDED, DELETED);
    // Exactly 2 <td>s — no spurious extra cell.
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    expect(out).toContain("plus");
    // "plus" should appear inside the second <td>, not outside.
    const td2match = out.match(/<td>A2[\s\S]*?<\/td>/);
    expect(td2match).not.toBeNull();
    expect(td2match![0]).toContain("plus");
  });
});

describe("htmlDiffOneSide", () => {
  it("returns '' when own is empty", () => {
    expect(htmlDiffOneSide("", "<p>x</p>", ADDED)).toBe("");
  });

  it("preserves the <strong> tag and highlights only the own-only word", () => {
    // own = "Hello world" — both words are also in other except for
    // "world" which is unique to own.
    const own = "<p>Hello <strong>world</strong></p>";
    const other = "<p>Hello there</p>";
    const out = htmlDiffOneSide(own, other, ADDED);
    expect(out).toContain("<strong>");
    expect(out).toContain("world");
    expect(out).toContain("Hello");
    // own-only "world" gets the highlight; equal "Hello" does not.
    // The highlight uses the addedFormat colour so it shows up via
    // an inline style attribute.
    expect(out.toLowerCase()).toContain("color");
  });

  it("never inserts cross-side text from `other`", () => {
    // own contains "alpha"; other contains "beta gamma". A regular
    // htmlDiff would append "beta gamma" somewhere; htmlDiffOneSide
    // must not.
    const own = "<p>alpha</p>";
    const other = "<p>beta gamma</p>";
    const out = htmlDiffOneSide(own, other, ADDED);
    expect(out).toContain("alpha");
    expect(out).not.toContain("beta");
    expect(out).not.toContain("gamma");
  });

  it("highlights every word when other is empty (whole-side added/deleted case)", () => {
    const own = "<p>brand <em>new</em> stuff</p>";
    const out = htmlDiffOneSide(own, "", ADDED);
    expect(out).toContain("<em>");
    // All three words are own-only; the body should carry the
    // highlight format somewhere.
    expect(out.toLowerCase()).toContain("color");
    expect(out).toContain("brand");
    expect(out).toContain("new");
    expect(out).toContain("stuff");
  });

  it("preserves table structure on the own side", () => {
    const own = "<table><tr><td>kept</td><td>changed</td></tr></table>";
    const other = "<table><tr><td>kept</td><td>different</td></tr></table>";
    const out = htmlDiffOneSide(own, other, ADDED);
    expect((out.match(/<td/g) ?? []).length).toBe(2);
    expect(out).toContain("kept");
    expect(out).toContain("changed");
    expect(out).not.toContain("different");
  });

  it("returns reference unchanged when both sides have identical text", () => {
    const own = "<p>same <strong>words</strong></p>";
    const out = htmlDiffOneSide(own, own, ADDED);
    expect(out).toContain("<strong>");
    // No highlight since nothing is own-only.
    // (We don't assert the absence of "color" because the addedFormat
    //  default already carries one in span styles, but no style span
    //  should be emitted for these words.)
    expect(out).not.toMatch(/<span style[^>]+>same<\/span>/);
    expect(out).not.toMatch(/<span style[^>]+>words<\/span>/);
  });
});
