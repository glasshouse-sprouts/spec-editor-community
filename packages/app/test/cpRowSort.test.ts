/**
 * Tests for the CP row comparator used by main's `groupControlPlanRows`.
 *
 * Why these cases:
 *   - The "empty sortsLast" rule is the actual bug fix — without it, a
 *     newly-added blank row (section_no = "") bubbles to the top of its
 *     group and confuses the user. Covered in multiple scenarios below.
 *   - Natural-number ordering is what makes "2" come before "10". Easy
 *     to accidentally break by swapping the collator for `localeCompare`
 *     without the `numeric` option, so we pin it.
 *   - The `id` tie-break is what keeps two consecutively-added blank
 *     rows in insertion order (oldest first). If we regressed to plain
 *     text sort, two empties would be arbitrary.
 */
import { describe, expect, it } from "vitest";

import { compareCpRows, type CpRowSortable } from "../src/main/cpRowSort.js";

/** Convenience — build the minimal row shape the comparator needs. */
function r(id: number, sectionNo: string): CpRowSortable {
  return { id, sectionNo };
}

/** Sort a copy of the input using the comparator under test. */
function sorted(rows: CpRowSortable[]): CpRowSortable[] {
  return [...rows].sort((a, b) => compareCpRows(a, b));
}

describe("compareCpRows", () => {
  it("orders populated sectionNos naturally (not lexicographically)", () => {
    const out = sorted([r(1, "10"), r(2, "2"), r(3, "1")]);
    expect(out.map((x) => x.sectionNo)).toEqual(["1", "2", "10"]);
  });

  it("sends an empty sectionNo to the bottom of a populated list", () => {
    const out = sorted([r(1, "1"), r(2, ""), r(3, "2")]);
    expect(out.map((x) => x.sectionNo)).toEqual(["1", "2", ""]);
  });

  it("keeps multiple empty sectionNos in ascending id order", () => {
    // Simulates the case where the user added three blank rows in a row
    // without numbering them yet. They should appear in the order they
    // were inserted — newest at the very bottom.
    const out = sorted([r(30, ""), r(10, ""), r(20, "")]);
    expect(out.map((x) => x.id)).toEqual([10, 20, 30]);
  });

  it("handles mixed empties and populated values together", () => {
    const out = sorted([r(5, ""), r(1, "2"), r(7, ""), r(2, "1"), r(3, "10")]);
    expect(out.map((x) => [x.sectionNo, x.id])).toEqual([
      ["1", 2],
      ["2", 1],
      ["10", 3],
      ["", 5],
      ["", 7],
    ]);
  });

  it("tie-breaks populated duplicates by id", () => {
    const out = sorted([r(9, "1"), r(3, "1"), r(5, "1")]);
    expect(out.map((x) => x.id)).toEqual([3, 5, 9]);
  });

  it("orders non-numeric sectionNos alphabetically-ish", () => {
    // Molio allows free-text sectionNos like "A-3". `Intl.Collator` with
    // `numeric: true` handles A/B, and the numeric portion of "A-2" vs
    // "A-10" too.
    const out = sorted([r(1, "B-1"), r(2, "A-10"), r(3, "A-2")]);
    expect(out.map((x) => x.sectionNo)).toEqual(["A-2", "A-10", "B-1"]);
  });

  it("is stable — already-sorted input comes back unchanged", () => {
    const input = [r(2, "1"), r(1, "2"), r(3, "10"), r(4, "")];
    expect(sorted(input)).toEqual(input);
  });
});
