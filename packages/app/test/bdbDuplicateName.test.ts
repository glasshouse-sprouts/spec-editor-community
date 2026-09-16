import { describe, expect, it } from "vitest";

import {
  nextDuplicateName,
  stripCopySuffix,
} from "../src/renderer/src/bdbDuplicateName.js";

describe("stripCopySuffix", () => {
  it("leaves plain names alone", () => {
    expect(stripCopySuffix("Foo")).toBe("Foo");
    expect(stripCopySuffix("Foo Bar")).toBe("Foo Bar");
  });

  it("strips a single (copy) suffix", () => {
    expect(stripCopySuffix("Foo (copy)")).toBe("Foo");
  });

  it("strips a numbered (copy N) suffix", () => {
    expect(stripCopySuffix("Foo (copy 2)")).toBe("Foo");
    expect(stripCopySuffix("Foo (copy 17)")).toBe("Foo");
  });

  it("only strips ONE suffix — chained (copy) (copy) loses the outer one", () => {
    // Intentional: if a user manually renamed something to "Foo (copy)
    // (copy)", stripping only the outermost lets the next duplicate
    // become "Foo (copy) (copy 2)" rather than collapsing their manual
    // work. Good enough for the MVP.
    expect(stripCopySuffix("Foo (copy) (copy)")).toBe("Foo (copy)");
  });

  it("doesn't munge names that just happen to contain 'copy' in prose", () => {
    expect(stripCopySuffix("My copy of the wall")).toBe("My copy of the wall");
    expect(stripCopySuffix("Copy paste guide")).toBe("Copy paste guide");
  });
});

describe("nextDuplicateName", () => {
  it("uses (copy) when the source has no duplicates yet", () => {
    expect(nextDuplicateName("Wall", ["Wall"])).toBe("Wall (copy)");
  });

  it("jumps to (copy 2) when (copy) already exists", () => {
    expect(nextDuplicateName("Wall", ["Wall", "Wall (copy)"])).toBe(
      "Wall (copy 2)",
    );
  });

  it("keeps incrementing as needed", () => {
    expect(
      nextDuplicateName("Wall", ["Wall", "Wall (copy)", "Wall (copy 2)"]),
    ).toBe("Wall (copy 3)");
  });

  it("fills gaps — if (copy 2) is missing it uses that slot", () => {
    // User manually renamed "Wall (copy 2)" to something else; we'd
    // rather reuse the free number than push out to (copy 4).
    expect(
      nextDuplicateName("Wall", ["Wall", "Wall (copy)", "Wall (copy 3)"]),
    ).toBe("Wall (copy 2)");
  });

  it("strips (copy N) off the source before re-attaching a suffix", () => {
    // Regression guard for "Wall (copy) (copy)" tail-growth — this is
    // the whole reason stripCopySuffix exists. Duplicating a dupe
    // should re-anchor on the base name.
    expect(nextDuplicateName("Wall (copy)", ["Wall", "Wall (copy)"])).toBe(
      "Wall (copy 2)",
    );

    expect(
      nextDuplicateName("Wall (copy 3)", [
        "Wall",
        "Wall (copy)",
        "Wall (copy 2)",
        "Wall (copy 3)",
      ]),
    ).toBe("Wall (copy 4)");
  });

  it("treats names in other work-areas as non-colliding (caller filters)", () => {
    // This test pins down the contract — the helper trusts whatever
    // list the caller hands it; it doesn't know about work-areas.
    // Callers are expected to pass only same-scope siblings.
    expect(nextDuplicateName("Wall", [])).toBe("Wall (copy)");
  });

  it("is case-sensitive — differing case doesn't collide", () => {
    expect(nextDuplicateName("Wall", ["Wall", "wall (copy)"])).toBe(
      "Wall (copy)",
    );
  });
});
