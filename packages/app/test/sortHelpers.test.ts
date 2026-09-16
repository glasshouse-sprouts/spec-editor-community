import { describe, expect, it } from "vitest";

import {
  compareByName,
  compareCodeThenName,
  danishCollator,
} from "../src/renderer/src/sortHelpers.js";

/**
 * Small helper so tests read "sort these strings and check the order"
 * instead of verbose sort callback noise.
 */
function sortByCodeThenName<T extends { code: string | null; name: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) =>
    compareCodeThenName(a.code, a.name, b.code, b.name),
  );
}

describe("danishCollator", () => {
  it("puts Æ / Ø / Å after Z (Danish order)", () => {
    const sorted = ["Æble", "Banan", "Ål", "Citron", "Øl"].sort((a, b) =>
      danishCollator.compare(a, b),
    );
    // In Danish: ... Z, Æ, Ø, Å.
    expect(sorted).toEqual(["Banan", "Citron", "Æble", "Øl", "Ål"]);
  });

  it("is case-insensitive (base sensitivity)", () => {
    expect(danishCollator.compare("abc", "ABC")).toBe(0);
    expect(danishCollator.compare("Æble", "æble")).toBe(0);
  });

  it("sorts numbers naturally (2 before 10)", () => {
    const sorted = ["10", "2", "1", "20"].sort((a, b) =>
      danishCollator.compare(a, b),
    );
    expect(sorted).toEqual(["1", "2", "10", "20"]);
  });

  it("handles embedded numbers naturally ('01' vs '1A' vs '2')", () => {
    // "01" has a leading zero but numerically equals 1; "1A" is 1 then a letter.
    // With numeric collation: "01" == "1" < "1A" < "2".
    const sorted = ["2", "1A", "01"].sort((a, b) =>
      danishCollator.compare(a, b),
    );
    expect(sorted).toEqual(["01", "1A", "2"]);
  });
});

describe("compareCodeThenName", () => {
  it("orders items with codes by code, ascending", () => {
    const sorted = sortByCodeThenName([
      { code: "C10", name: "ten" },
      { code: "C2", name: "two" },
      { code: "C1", name: "one" },
    ]);
    expect(sorted.map((s) => s.code)).toEqual(["C1", "C2", "C10"]);
  });

  it("tie-breaks on name when codes are identical", () => {
    const sorted = sortByCodeThenName([
      { code: "A", name: "zulu" },
      { code: "A", name: "alpha" },
      { code: "A", name: "mike" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["alpha", "mike", "zulu"]);
  });

  it("tie-break on name respects Danish collation (Æ after Z)", () => {
    const sorted = sortByCodeThenName([
      { code: "X", name: "Øl" },
      { code: "X", name: "Zebra" },
      { code: "X", name: "Æble" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Zebra", "Æble", "Øl"]);
  });

  it("items without a code sink to the bottom", () => {
    const sorted = sortByCodeThenName([
      { code: null, name: "orphan-A" },
      { code: "B", name: "banana" },
      { code: "", name: "orphan-B" },
      { code: "A", name: "apple" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual([
      "apple",
      "banana",
      "orphan-A",
      "orphan-B",
    ]);
  });

  it("within the 'no code' bucket, items sort by name alphabetically", () => {
    const sorted = sortByCodeThenName([
      { code: null, name: "zulu" },
      { code: "", name: "alpha" },
      { code: null, name: "mike" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["alpha", "mike", "zulu"]);
  });

  it("treats whitespace-only codes as empty", () => {
    const sorted = sortByCodeThenName([
      { code: "   ", name: "fake-orphan" },
      { code: "A", name: "real-code" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["real-code", "fake-orphan"]);
  });

  it("ignores case when comparing codes", () => {
    // Not a Danish-specific case, just a sanity check that base sensitivity
    // applies everywhere.
    const sorted = sortByCodeThenName([
      { code: "b", name: "lower" },
      { code: "A", name: "upper" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["upper", "lower"]);
  });

  it("numeric codes with leading zeros compare as numbers (realistic Molio case)", () => {
    // Building site codes frequently look like "01", "02", "10" — written
    // with a leading zero so they line up in PDFs. We want the natural
    // numeric order, not lexicographic ("01" < "10" < "2" would be wrong).
    const sorted = sortByCodeThenName([
      { code: "10", name: "ten" },
      { code: "01", name: "one" },
      { code: "02", name: "two" },
    ]);
    expect(sorted.map((s) => s.code)).toEqual(["01", "02", "10"]);
  });
});

describe("compareByName", () => {
  it("sorts by name alphabetically", () => {
    const sorted = ["banana", "Apple", "cherry"].sort(compareByName);
    // Case-insensitive → Apple/banana/cherry in that order.
    expect(sorted).toEqual(["Apple", "banana", "cherry"]);
  });

  it("respects Danish collation (Æ after Z)", () => {
    const sorted = ["Øl", "Zebra", "Æble"].sort(compareByName);
    expect(sorted).toEqual(["Zebra", "Æble", "Øl"]);
  });

  it("treats missing / empty names safely", () => {
    // NB: JavaScript's `Array.sort` moves `undefined` values to the end
    // of the array without running the comparator, so we only test null
    // + empty-string here — those paths DO go through compareByName.
    const input: (string | null)[] = [null, "banana", "apple", ""];
    const sorted = [...input].sort((a, b) => compareByName(a, b));
    // null + "" both normalise to "" and cluster together at the top
    // (empty string sorts before any real letter in Danish collation).
    expect(sorted.slice(-2)).toEqual(["apple", "banana"]);
    // The two "empty-like" entries (null and "") sort as equivalents,
    // so either order is acceptable — we just check neither real name
    // ended up at the top.
    expect(sorted[0] === null || sorted[0] === "").toBe(true);
    expect(sorted[1] === null || sorted[1] === "").toBe(true);
  });
});
