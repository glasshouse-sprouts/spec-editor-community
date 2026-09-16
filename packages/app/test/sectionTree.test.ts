/**
 * Unit tests for the section-tree helpers in renderer/src/sectionTree.ts.
 *
 * Pure TS, no React/DOM — imported directly.
 */

import { describe, expect, it } from "vitest";

import type { SectionData } from "../src/shared/ipc.js";
import {
  buildSectionTree,
  compareDottedNumber,
  filterSectionTree,
  mergeSectionTreesByNumber,
  sectionElementId,
} from "../src/renderer/src/sectionTree.js";

/** Tiny helper to make test section rows less noisy. */
function s(
  id: number,
  parentId: number | null,
  sectionNo: number,
  heading: string,
  body = "",
): SectionData {
  return { id, parentId, sectionNo, heading, body };
}

describe("buildSectionTree", () => {
  it("returns empty array when given no sections", () => {
    expect(buildSectionTree([])).toEqual([]);
  });

  it("builds a single-level tree with dotted numbers from section_no", () => {
    const tree = buildSectionTree([s(2, null, 2, "Two"), s(1, null, 1, "One")]);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.section.id).toBe(1);
    expect(tree[0]!.number).toBe("1");
    expect(tree[0]!.depth).toBe(0);
    expect(tree[1]!.number).toBe("2");
  });

  it("nests children under their parent", () => {
    const tree = buildSectionTree([
      s(1, null, 1, "Chapter"),
      s(2, 1, 1, "First sub"),
      s(3, 1, 2, "Second sub"),
      s(4, 2, 1, "Nested"),
    ]);
    expect(tree).toHaveLength(1);
    const chapter = tree[0]!;
    expect(chapter.children).toHaveLength(2);
    expect(chapter.children[0]!.number).toBe("1.1");
    expect(chapter.children[0]!.depth).toBe(1);
    expect(chapter.children[1]!.number).toBe("1.2");
    expect(chapter.children[0]!.children[0]!.number).toBe("1.1.1");
    expect(chapter.children[0]!.children[0]!.depth).toBe(2);
  });

  it("sorts siblings by section_no, not by id or input order", () => {
    const tree = buildSectionTree([
      s(10, null, 3, "Third"),
      s(11, null, 1, "First"),
      s(12, null, 2, "Second"),
    ]);
    expect(tree.map((n) => n.section.heading)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("treats a section whose parentId is unknown as a root", () => {
    // parent 99 doesn't exist in the list → section 2 becomes a root
    const tree = buildSectionTree([
      s(1, null, 1, "Real root"),
      s(2, 99, 1, "Orphan"),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.section.id)).toContain(2);
    const orphan = tree.find((n) => n.section.id === 2)!;
    expect(orphan.depth).toBe(0);
    expect(orphan.number).toBe("1");
  });

  it("dotted number reflects the section's own section_no, walking up", () => {
    // A child with section_no=5 under a parent with section_no=2 should
    // show as "2.5" — not renumbered by array index.
    const tree = buildSectionTree([
      s(1, null, 2, "Two"),
      s(2, 1, 5, "Two-five"),
    ]);
    expect(tree[0]!.number).toBe("2");
    expect(tree[0]!.children[0]!.number).toBe("2.5");
  });
});

describe("filterSectionTree", () => {
  /** Build a tree we can reuse across the filter cases. */
  const baseTree = () =>
    buildSectionTree([
      s(1, null, 1, "Materials"),
      s(2, 1, 1, "Concrete"),
      s(3, 1, 2, "Steel"),
      s(4, null, 2, "Installation"),
      s(5, 4, 1, "Concrete placement"),
    ]);

  it("returns the tree unchanged for an empty query", () => {
    const tree = baseTree();
    expect(filterSectionTree(tree, "")).toBe(tree);
    expect(filterSectionTree(tree, "   ")).toBe(tree);
  });

  it("keeps a matching node and its ancestors, drops siblings", () => {
    const filtered = filterSectionTree(baseTree(), "steel");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.section.heading).toBe("Materials");
    expect(filtered[0]!.children).toHaveLength(1);
    expect(filtered[0]!.children[0]!.section.heading).toBe("Steel");
  });

  it("matches case-insensitively", () => {
    const filtered = filterSectionTree(baseTree(), "CONCRETE");
    // "Concrete" under Materials AND "Concrete placement" under Installation
    const headings = filtered.flatMap((n) => [
      n.section.heading,
      ...n.children.map((c) => c.section.heading),
    ]);
    expect(headings).toContain("Materials");
    expect(headings).toContain("Concrete");
    expect(headings).toContain("Installation");
    expect(headings).toContain("Concrete placement");
  });

  it("returns an empty tree when nothing matches", () => {
    expect(filterSectionTree(baseTree(), "rocket-science")).toEqual([]);
  });

  it("when a parent matches, it keeps its ENTIRE subtree (children inherit)", () => {
    // "materials" matches Materials; under the inherit-from-parent rule,
    // Concrete and Steel should also come along even though their own
    // headings don't contain "materials".
    const filtered = filterSectionTree(baseTree(), "materials");
    expect(filtered).toHaveLength(1);
    const root = filtered[0]!;
    expect(root.section.heading).toBe("Materials");
    expect(root.children.map((c) => c.section.heading)).toEqual([
      "Concrete",
      "Steel",
    ]);
    // Installation / Concrete placement should NOT appear — neither they
    // nor any ancestor of theirs matched the query.
    expect(
      filtered.find((n) => n.section.heading === "Installation"),
    ).toBeUndefined();
  });

  it("inheritance reaches grandchildren too (A → B → E kept when only A matches)", () => {
    // Matches the user's example: filter "A" → keep A, B, E, C; drop D.
    const tree = buildSectionTree([
      s(1, null, 1, "Section A"),
      s(2, 1, 1, "Section B"),
      s(5, 2, 1, "Section E"),
      s(3, 1, 2, "Section C"),
      s(4, null, 2, "Section D"),
    ]);
    const filtered = filterSectionTree(tree, "A");
    expect(filtered).toHaveLength(1);
    const a = filtered[0]!;
    expect(a.section.heading).toBe("Section A");
    expect(a.children.map((c) => c.section.heading)).toEqual([
      "Section B",
      "Section C",
    ]);
    const b = a.children[0]!;
    expect(b.children.map((c) => c.section.heading)).toEqual(["Section E"]);
  });
});

describe("sectionElementId", () => {
  it("produces a stable DOM id", () => {
    expect(sectionElementId(42)).toBe("section-42");
    expect(sectionElementId(0)).toBe("section-0");
  });
});

describe("compareDottedNumber", () => {
  it("orders by integer components, not lexicographically", () => {
    // Lexicographic sort would put "2.10" before "2.2" — wrong.
    expect(compareDottedNumber("2.2", "2.10")).toBeLessThan(0);
    expect(compareDottedNumber("2.10", "2.2")).toBeGreaterThan(0);
  });

  it("considers a parent number smaller than its children", () => {
    // "2" < "2.1" < "2.2" in reading order.
    expect(compareDottedNumber("2", "2.1")).toBeLessThan(0);
    expect(compareDottedNumber("2.1", "2.2")).toBeLessThan(0);
  });

  it("treats equal numbers as equal", () => {
    expect(compareDottedNumber("2.5.1", "2.5.1")).toBe(0);
  });
});

describe("mergeSectionTreesByNumber", () => {
  it("pairs sections that share a dotted number", () => {
    const left = buildSectionTree([
      s(1, null, 1, "Left Intro"),
      s(2, 1, 1, "Left Sub"),
    ]);
    const right = buildSectionTree([
      s(10, null, 1, "Right Intro"),
      s(11, 10, 1, "Right Sub"),
    ]);
    const rows = mergeSectionTreesByNumber(left, right);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.number).toBe("1");
    expect(rows[0]!.left?.section.heading).toBe("Left Intro");
    expect(rows[0]!.right?.section.heading).toBe("Right Intro");
    expect(rows[1]!.number).toBe("1.1");
    expect(rows[1]!.left?.section.heading).toBe("Left Sub");
    expect(rows[1]!.right?.section.heading).toBe("Right Sub");
  });

  it("emits a row with one side null when the other side is missing", () => {
    // Left has 1, 2. Right has 1, 3. Expect three rows: 1 paired, 2 left-only,
    // 3 right-only.
    const left = buildSectionTree([s(1, null, 1, "L1"), s(2, null, 2, "L2")]);
    const right = buildSectionTree([
      s(10, null, 1, "R1"),
      s(11, null, 3, "R3"),
    ]);
    const rows = mergeSectionTreesByNumber(left, right);
    expect(rows.map((r) => r.number)).toEqual(["1", "2", "3"]);
    expect(rows[0]!.left && rows[0]!.right).toBeTruthy();
    expect(rows[1]!.left).not.toBeNull();
    expect(rows[1]!.right).toBeNull();
    expect(rows[2]!.left).toBeNull();
    expect(rows[2]!.right).not.toBeNull();
  });

  it("keeps output in natural document order (parent before child, siblings numeric)", () => {
    const left = buildSectionTree([
      s(1, null, 2, "L 2"),
      s(2, 1, 10, "L 2.10"),
      s(3, 1, 2, "L 2.2"),
    ]);
    const right: ReturnType<typeof buildSectionTree> = [];
    const rows = mergeSectionTreesByNumber(left, right);
    expect(rows.map((r) => r.number)).toEqual(["2", "2.2", "2.10"]);
  });

  it("returns [] when both trees are empty", () => {
    expect(mergeSectionTreesByNumber([], [])).toEqual([]);
  });
});
