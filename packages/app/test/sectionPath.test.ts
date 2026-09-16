/**
 * Slice "Version compare" — sectionPath helper.
 *
 * Builds the dotted hierarchical path ("1", "1.1", "2.2.3") that
 * version-compare uses as a stable section match key. Collision-
 * resistant inside one BDB or work area, where local `sectionNo`
 * alone is not (every nested "Generelt" leaf sits at sectionNo=1).
 */
import { describe, expect, it } from "vitest";

import {
  comparePathNumeric,
  computeSectionPaths,
} from "../src/renderer/src/compare/sectionPath.js";

function s(id: number, sectionNo: number, parentId: number | null) {
  return { id, sectionNo, parentId };
}

describe("computeSectionPaths", () => {
  it("returns an empty map for an empty list", () => {
    expect(computeSectionPaths([])).toEqual(new Map());
  });

  it("uses just the local sectionNo for top-level sections", () => {
    const out = computeSectionPaths([s(10, 1, null), s(11, 2, null)]);
    expect(out.get(10)).toBe("1");
    expect(out.get(11)).toBe("2");
  });

  it("walks the parent chain to build the dotted path", () => {
    // 1 (id=10)
    // 1.1 (id=20, parent=10)
    // 1.1.1 (id=30, parent=20)
    const out = computeSectionPaths([
      s(10, 1, null),
      s(20, 1, 10),
      s(30, 1, 20),
    ]);
    expect(out.get(10)).toBe("1");
    expect(out.get(20)).toBe("1.1");
    expect(out.get(30)).toBe("1.1.1");
  });

  it("disambiguates same-numbered siblings under different parents", () => {
    // 1 (id=10)        OMFANG
    // 1.1 (id=20)      Generelt under OMFANG
    // 2 (id=11)        ALMENE
    // 2.1 (id=30)      Generelt under ALMENE
    // Both id=20 and id=30 share local sectionNo=1 but live under
    // different parents — the path key separates them.
    const out = computeSectionPaths([
      s(10, 1, null),
      s(20, 1, 10),
      s(11, 2, null),
      s(30, 1, 11),
    ]);
    expect(out.get(20)).toBe("1.1");
    expect(out.get(30)).toBe("2.1");
    expect(out.get(20)).not.toBe(out.get(30));
  });

  it("stops the walk if parentId points outside the list", () => {
    // id=20's parent is 999, which is not in the list. Walker stops
    // there; path becomes the section's own number. This is the
    // safe fallback for malformed data.
    const out = computeSectionPaths([s(20, 5, 999)]);
    expect(out.get(20)).toBe("5");
  });

  it("does not infinite-loop on a parent cycle", () => {
    // Pathological cycle: 10's parent is 11, 11's parent is 10.
    // Walker should bail via the visited set.
    const out = computeSectionPaths([s(10, 1, 11), s(11, 2, 10)]);
    // Both produce SOME finite path; the exact value depends on
    // walk order but must terminate.
    expect(typeof out.get(10)).toBe("string");
    expect(typeof out.get(11)).toBe("string");
  });
});

describe("comparePathNumeric", () => {
  it("orders paths in tree-walk order with numeric segment compare", () => {
    // Tore's example: 4.1.2 must come AFTER 2.4.
    const paths = ["4.1.2", "2.4", "1", "1.2", "1.10", "2", "1.1", "10"];
    const sorted = [...paths].sort(comparePathNumeric);
    expect(sorted).toEqual([
      "1",
      "1.1",
      "1.2",
      "1.10",
      "2",
      "2.4",
      "4.1.2",
      "10",
    ]);
  });

  it('places shorter prefix-paths before longer ones ("2" < "2.4")', () => {
    expect(comparePathNumeric("2", "2.4")).toBeLessThan(0);
    expect(comparePathNumeric("2.4", "2")).toBeGreaterThan(0);
  });

  it("compares segments numerically, not lexicographically", () => {
    // "10" must sort AFTER "2", not before. Lex sort would invert.
    expect(comparePathNumeric("2", "10")).toBeLessThan(0);
    expect(comparePathNumeric("1.10", "1.2")).toBeGreaterThan(0);
  });

  it("returns 0 for equal paths", () => {
    expect(comparePathNumeric("2.4", "2.4")).toBe(0);
    expect(comparePathNumeric("", "")).toBe(0);
  });
});
