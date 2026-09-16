/**
 * Unit tests for the Compact view filter helpers.
 *
 * Pure TS — no React / DOM involved. Uses buildSectionTree +
 * mergeSectionTreesByNumber from sectionTree.ts to build realistic
 * inputs, so the assertions read like actual section structures.
 */

import { describe, expect, it } from "vitest";

import type { SectionData } from "../src/shared/ipc.js";
import {
  filterAlignedRowsForCompact,
  filterTreeForCompact,
  isEmptyBody,
} from "../src/renderer/src/compactFilter.js";
import {
  buildSectionTree,
  mergeSectionTreesByNumber,
} from "../src/renderer/src/sectionTree.js";

function s(
  id: number,
  parentId: number | null,
  sectionNo: number,
  heading: string,
  body = "",
): SectionData {
  return { id, parentId, sectionNo, heading, body };
}

describe("isEmptyBody", () => {
  it("treats null / undefined / empty string as empty", () => {
    expect(isEmptyBody(null)).toBe(true);
    expect(isEmptyBody(undefined)).toBe(true);
    expect(isEmptyBody("")).toBe(true);
  });

  it("treats whitespace-only HTML as empty", () => {
    expect(isEmptyBody("<p></p>")).toBe(true);
    expect(isEmptyBody("<p> </p>")).toBe(true);
    expect(isEmptyBody("<p>&nbsp;</p>")).toBe(true);
    expect(isEmptyBody("<p>&#160;</p>")).toBe(true);
    expect(isEmptyBody("<p><br/></p>")).toBe(true);
    expect(isEmptyBody("   \n\t  ")).toBe(true);
  });

  it("treats any real text as non-empty", () => {
    expect(isEmptyBody("<p>Hello</p>")).toBe(false);
    expect(isEmptyBody("  x  ")).toBe(false);
    expect(isEmptyBody("<p>.</p>")).toBe(false); // single dot counts — user wrote it
  });

  it("treats images and tables as non-empty even without text", () => {
    expect(isEmptyBody('<p><img src="x.png" /></p>')).toBe(false);
    expect(isEmptyBody("<table><tr><td></td></tr></table>")).toBe(false);
  });
});

describe("filterTreeForCompact", () => {
  it("returns the input unchanged when compact is off", () => {
    const tree = buildSectionTree([s(1, null, 1, "A", "<p></p>")]);
    expect(filterTreeForCompact(tree, false)).toBe(tree);
  });

  it("drops leaves with empty bodies", () => {
    const tree = buildSectionTree([
      s(1, null, 1, "Has content", "<p>hi</p>"),
      s(2, null, 2, "Empty", "<p></p>"),
    ]);
    const out = filterTreeForCompact(tree, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.section.id).toBe(1);
  });

  it("keeps parents whose descendants have content", () => {
    // 1 (empty) → 1.1 (empty) → 1.1.1 (has content)
    const tree = buildSectionTree([
      s(1, null, 1, "Chapter", "<p></p>"),
      s(2, 1, 1, "Sub", "<p></p>"),
      s(3, 2, 1, "Leaf", "<p>hi</p>"),
    ]);
    const out = filterTreeForCompact(tree, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.children).toHaveLength(1);
    expect(out[0]!.children[0]!.children).toHaveLength(1);
    expect(out[0]!.children[0]!.children[0]!.section.id).toBe(3);
  });

  it("drops parents whose descendants are all empty", () => {
    const tree = buildSectionTree([
      s(1, null, 1, "Chapter", "<p></p>"),
      s(2, 1, 1, "Sub", "<p></p>"),
      s(3, 2, 1, "Leaf", "<p></p>"),
      s(4, null, 2, "Real", "<p>hi</p>"),
    ]);
    const out = filterTreeForCompact(tree, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.section.id).toBe(4);
  });

  it("prunes a partial subtree rather than all-or-nothing", () => {
    // 1 (has content): keeps
    //   1.1 (empty, no kids): drop
    //   1.2 (empty) → 1.2.1 (has content): both kept
    const tree = buildSectionTree([
      s(1, null, 1, "Chapter", "<p>intro</p>"),
      s(2, 1, 1, "Empty sub", "<p></p>"),
      s(3, 1, 2, "Parent", "<p></p>"),
      s(4, 3, 1, "Deep", "<p>hi</p>"),
    ]);
    const out = filterTreeForCompact(tree, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.children).toHaveLength(1);
    expect(out[0]!.children[0]!.section.id).toBe(3);
    expect(out[0]!.children[0]!.children[0]!.section.id).toBe(4);
  });

  it("preserves ordering and dotted numbers", () => {
    const tree = buildSectionTree([
      s(1, null, 1, "A", "<p>a</p>"),
      s(2, null, 2, "B", "<p></p>"),
      s(3, 2, 1, "B.1", "<p>b1</p>"),
      s(4, null, 3, "C", "<p>c</p>"),
    ]);
    const out = filterTreeForCompact(tree, true);
    expect(out.map((n) => n.number)).toEqual(["1", "2", "3"]);
    expect(out[1]!.children[0]!.number).toBe("2.1");
  });
});

describe("filterAlignedRowsForCompact", () => {
  function buildRows(
    left: SectionData[],
    right: SectionData[],
  ): ReturnType<typeof mergeSectionTreesByNumber> {
    return mergeSectionTreesByNumber(
      buildSectionTree(left),
      buildSectionTree(right),
    );
  }

  it("returns input unchanged when compact is off", () => {
    const rows = buildRows([s(1, null, 1, "A", "<p></p>")], []);
    expect(filterAlignedRowsForCompact(rows, false)).toBe(rows);
  });

  it("keeps a row when either side has content", () => {
    const rows = buildRows(
      [s(1, null, 1, "A", "<p>hi</p>")],
      [s(11, null, 1, "A", "<p></p>")],
    );
    const out = filterAlignedRowsForCompact(rows, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.number).toBe("1");
  });

  it("drops a row where both sides are empty AND no descendant survives", () => {
    const rows = buildRows(
      [s(1, null, 1, "A", "<p></p>")],
      [s(11, null, 1, "A", "<p></p>")],
    );
    expect(filterAlignedRowsForCompact(rows, true)).toHaveLength(0);
  });

  it("keeps an ancestor row if any descendant survives on any side", () => {
    // Left: 1 (empty) → 1.1 (empty)
    // Right: 1 (empty) → 1.1 (has content)
    // Expect: both "1" and "1.1" kept.
    const rows = buildRows(
      [s(1, null, 1, "A", "<p></p>"), s(2, 1, 1, "A.1", "<p></p>")],
      [s(11, null, 1, "A", "<p></p>"), s(12, 11, 1, "A.1", "<p>hi</p>")],
    );
    const out = filterAlignedRowsForCompact(rows, true);
    expect(out.map((r) => r.number)).toEqual(["1", "1.1"]);
  });

  it("drops a full branch when nothing under it survives", () => {
    // 1 (content), 2 (empty) → 2.1 (empty), 3 (content)
    const rows = buildRows(
      [
        s(1, null, 1, "A", "<p>hi</p>"),
        s(2, null, 2, "B", "<p></p>"),
        s(3, 2, 1, "B.1", "<p></p>"),
        s(4, null, 3, "C", "<p>c</p>"),
      ],
      [],
    );
    const out = filterAlignedRowsForCompact(rows, true);
    expect(out.map((r) => r.number)).toEqual(["1", "3"]);
  });

  it("does NOT treat '10' as a descendant of '1'", () => {
    // Regression guard: prefix match must include the trailing dot.
    // "1" is empty, "10" has content on the right — "1" should be dropped.
    const rows = buildRows(
      [s(1, null, 1, "One", "<p></p>")],
      [s(100, null, 10, "Ten", "<p>hi</p>")],
    );
    const out = filterAlignedRowsForCompact(rows, true);
    expect(out.map((r) => r.number)).toEqual(["10"]);
  });

  it("preserves original row order", () => {
    const rows = buildRows(
      [
        s(1, null, 1, "A", "<p>a</p>"),
        s(2, null, 10, "J", "<p>j</p>"),
        s(3, null, 2, "B", "<p>b</p>"),
      ],
      [],
    );
    const out = filterAlignedRowsForCompact(rows, true);
    // mergeSectionTreesByNumber uses natural dotted-number order: 1, 2, 10.
    expect(out.map((r) => r.number)).toEqual(["1", "2", "10"]);
  });
});
