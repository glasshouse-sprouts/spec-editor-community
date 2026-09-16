/**
 * Slice "Version compare" — wordDiff helper.
 *
 * Smoke + edge cases for the LCS-based word-level text diff.
 */
import { describe, expect, it } from "vitest";

import { wordDiff } from "../src/renderer/src/compare/wordDiff.js";

describe("wordDiff", () => {
  it("returns [] for two empty strings", () => {
    expect(wordDiff("", "")).toEqual([]);
  });

  it("returns a single 'added' segment when a is empty", () => {
    expect(wordDiff("", "hello")).toEqual([{ kind: "added", text: "hello" }]);
  });

  it("returns a single 'deleted' segment when b is empty", () => {
    expect(wordDiff("hello", "")).toEqual([{ kind: "deleted", text: "hello" }]);
  });

  it("returns a single 'equal' segment when a and b match", () => {
    expect(wordDiff("hello world", "hello world")).toEqual([
      { kind: "equal", text: "hello world" },
    ]);
  });

  it("detects a word inserted in the middle", () => {
    const got = wordDiff("the quick fox", "the quick brown fox");
    // Should be: equal "the quick ", added "brown ", equal "fox"
    expect(got.map((s) => s.kind)).toEqual(["equal", "added", "equal"]);
    expect(got[1]?.text.trim()).toBe("brown");
  });

  it("detects a word deleted from the middle", () => {
    const got = wordDiff("the quick brown fox", "the quick fox");
    expect(got.map((s) => s.kind)).toEqual(["equal", "deleted", "equal"]);
    expect(got[1]?.text.trim()).toBe("brown");
  });

  it("detects a word replaced (delete + add)", () => {
    const got = wordDiff("the quick brown fox", "the quick red fox");
    const kinds = got.map((s) => s.kind);
    // Either delete-then-add or add-then-delete is acceptable as long
    // as both kinds appear.
    expect(kinds).toContain("deleted");
    expect(kinds).toContain("added");
    // The unchanged sides ("the quick", "fox") show up as equal.
    expect(kinds.filter((k) => k === "equal").length).toBeGreaterThan(0);
  });

  it("preserves whitespace on the equal segments", () => {
    const got = wordDiff("alpha beta", "alpha beta");
    // Single equal segment carrying the exact original text + spacing.
    expect(got).toEqual([{ kind: "equal", text: "alpha beta" }]);
  });

  it("handles append-only changes", () => {
    const got = wordDiff("foo bar", "foo bar baz");
    const kinds = got.map((s) => s.kind);
    expect(kinds[0]).toBe("equal");
    expect(kinds.includes("added")).toBe(true);
  });

  it("re-emits each token only on the side it belongs to", () => {
    // Concatenating *all* segments shouldn't fabricate text.
    const a = "one two three";
    const b = "one three four";
    const got = wordDiff(a, b);
    const reconstructA = got
      .filter((s) => s.kind !== "added")
      .map((s) => s.text)
      .join("");
    const reconstructB = got
      .filter((s) => s.kind !== "deleted")
      .map((s) => s.text)
      .join("");
    // Whitespace handling may collapse a trailing space, but the
    // word content should round-trip.
    expect(reconstructA.replace(/\s+/g, " ").trim()).toBe(a);
    expect(reconstructB.replace(/\s+/g, " ").trim()).toBe(b);
  });

  it("collapses interleaved del/add into continuous runs across whitespace", () => {
    // Real-world case from the showoff RAC project (id=411 "Generelt"):
    // ref ends with "noget et slettet, andet er tilføjet"
    // cur ends with "når skriver mere virker det her?"
    // Neither side shares any non-whitespace word with the other, but
    // the regular-space tokens between words match across both sides.
    // Without consolidation, segments come out interleaved (del-add-
    // del-add-…) one word at a time. After consolidation each side
    // should be a single continuous run.
    const ref =
      "Her står den generelle info om bygningsdelen mv. noget et slettet, andet er tilføjet";
    const cur =
      "Her står den generelle info om bygningsdelen mv. når skriver mere virker det her?";
    const got = wordDiff(ref, cur);
    // After the long equal prefix there should be at most one
    // "deleted" segment and one "added" segment in the trailing
    // differing region — not interleaved.
    const kinds = got.map((s) => s.kind);
    const lastEqualIdx = kinds.lastIndexOf("equal");
    const tail = kinds.slice(lastEqualIdx + 1);
    expect(tail.filter((k) => k === "deleted").length).toBeLessThanOrEqual(1);
    expect(tail.filter((k) => k === "added").length).toBeLessThanOrEqual(1);
    // And the deleted/added text should each contain ALL the
    // ref-only / cur-only words.
    const delText = got
      .filter((s) => s.kind === "deleted")
      .map((s) => s.text)
      .join("");
    const addText = got
      .filter((s) => s.kind === "added")
      .map((s) => s.text)
      .join("");
    for (const w of ["noget", "et", "slettet,", "andet", "er", "tilføjet"]) {
      expect(delText).toContain(w);
    }
    for (const w of ["når", "skriver", "mere", "virker", "det", "her?"]) {
      expect(addText).toContain(w);
    }
  });

  it("anchors LCS on the EARLIEST match when a ref word repeats in cur", () => {
    // Real-world case from id=414 "Bygningsdele og processer":
    // ref:  "...dobbelt inder"
    // cur:  "...dobbelt inder NEW1 inder NEW2 inder ..."
    // The LCS could match ref's "inder" with any of the three in cur.
    // We want the FIRST one so the inserted material lands cleanly
    // *after* the equal anchor rather than being squeezed in front
    // of it.
    const ref = "alpha beta inder";
    const cur = "alpha beta inder one two inder three four inder";
    const got = wordDiff(ref, cur);
    // No "equal" segment must come AFTER an "added" segment — the
    // LCS anchor should sit at the earliest possible position so the
    // tail is one clean "added" run.
    let sawAdded = false;
    for (const s of got) {
      if (s.kind === "added") sawAdded = true;
      if (sawAdded) {
        expect(s.kind).not.toBe("equal");
      }
    }
    // The "added" payload includes everything after the first "inder".
    const addText = got
      .filter((s) => s.kind === "added")
      .map((s) => s.text)
      .join("");
    for (const w of ["one", "two", "three", "four"]) {
      expect(addText).toContain(w);
    }
  });
});
