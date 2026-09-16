/**
 * Shared helpers for turning the flat section list from the IPC payload into
 * a tree with computed dotted numbers.
 *
 * Used by both SpecView (to render the content column hierarchically) and
 * TOCColumn (to render the navigation outline).
 *
 * Kept in its own module so both components use the same logic — if we fix a
 * bug or change the display-number rules, both stay in sync for free.
 */

import type { SectionData } from "../../shared/ipc.js";

/** One node in the section tree. */
export interface SectionNode {
  section: SectionData;
  /** 0 = top-level section. */
  depth: number;
  /** Dotted path built from each section's `section_no`, walking up the
   *  tree. E.g. "1.2.3". */
  number: string;
  children: SectionNode[];
}

/**
 * Rebuild the hierarchy from a flat section list.
 *
 * - Groups sections by `parent_id`.
 * - Sorts each group by `section_no` ascending.
 * - Sections whose `parent_id` points to something we don't have are treated
 *   as roots, so nothing silently disappears from the UI.
 * - The displayed dotted number is built from each section's own
 *   `section_no`, walking up the tree — so an item with sibling position 3
 *   under parent "1.2" is shown as "1.2.3".
 */
export function buildSectionTree(sections: SectionData[]): SectionNode[] {
  const knownIds = new Set(sections.map((s) => s.id));
  const byParent = new Map<number | null, SectionData[]>();
  for (const s of sections) {
    const parent =
      s.parentId != null && knownIds.has(s.parentId) ? s.parentId : null;
    const arr = byParent.get(parent);
    if (arr) arr.push(s);
    else byParent.set(parent, [s]);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sectionNo - b.sectionNo);
  }

  const build = (
    parentId: number | null,
    prefix: readonly string[],
    depth: number,
  ): SectionNode[] => {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((s) => {
      const path = [...prefix, String(s.sectionNo)];
      return {
        section: s,
        depth,
        number: path.join("."),
        children: build(s.id, path, depth + 1),
      };
    });
  };
  return build(null, [], 0);
}

/**
 * Filter a section tree by a free-text query against each heading.
 *
 * A node is kept if:
 *   - its own heading matches, OR
 *   - any ancestor's heading matches (children inherit the match), OR
 *   - any descendant's heading matches (so a hit keeps its context above).
 *
 * In other words, once a node matches, its entire subtree comes along for
 * the ride — filtering by "Materials" shows Materials *and* everything
 * nested under it, even if those children don't contain the word.
 *
 * Empty/whitespace-only query returns the tree unchanged.
 */
export function filterSectionTree(
  tree: SectionNode[],
  query: string,
): SectionNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;

  const walk = (
    nodes: SectionNode[],
    ancestorMatched: boolean,
  ): SectionNode[] => {
    const out: SectionNode[] = [];
    for (const n of nodes) {
      const selfMatch = (n.section.heading ?? "").toLowerCase().includes(q);
      if (ancestorMatched || selfMatch) {
        // Ancestor (or this node) matched — keep the whole subtree as-is.
        // Safe to share the reference since consumers treat nodes as
        // immutable render data.
        out.push(n);
      } else {
        // Otherwise, only keep this node if some descendant matches, and
        // prune its children down to the surviving paths.
        const keptChildren = walk(n.children, false);
        if (keptChildren.length > 0) {
          out.push({ ...n, children: keptChildren });
        }
      }
    }
    return out;
  };
  return walk(tree, false);
}

/** DOM id used on each rendered section in SpecView — lets TOC click-to-scroll. */
export function sectionElementId(sectionId: number): string {
  return `section-${sectionId}`;
}

/**
 * One row in the aligned dual-view for a BDB next to its parent work area.
 *
 * Identified by `number` — the dotted number both sides *would* have for
 * the same logical section (e.g. "2.5.1"). Either side may be null when
 * one side adds or removes a section the other doesn't have; the UI then
 * shows whitespace on the missing side.
 */
export interface AlignedRow {
  number: string;
  left: SectionNode | null;
  right: SectionNode | null;
}

/**
 * Flatten a tree into the order a human reads it: depth-first, pre-order
 * (parent before its children). Each node produces one entry; the dotted
 * number comes from `SectionNode.number`.
 */
function flattenTree(tree: SectionNode[]): SectionNode[] {
  const out: SectionNode[] = [];
  const walk = (nodes: SectionNode[]): void => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * Compare two dotted numbers like "2.5" vs "2.10" in natural order —
 * component by component as integers (so "2.10" > "2.2").
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareDottedNumber(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const ai = pa[i] ?? -1; // shorter path sorts before longer path with same prefix
    const bi = pb[i] ?? -1;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/**
 * Merge a left and right section tree into a single list of aligned rows.
 *
 * Matching rule: dotted number. "2.5" on the left pairs with "2.5" on the
 * right. Numbers only on one side get a row with the other side null.
 *
 * The output is sorted by the dotted number's natural order, so parents
 * come before children ("2" before "2.1") and siblings come numerically
 * ("2.2" before "2.10"). Both sides read the output in the same order.
 */
export function mergeSectionTreesByNumber(
  left: SectionNode[],
  right: SectionNode[],
): AlignedRow[] {
  const leftByNumber = new Map<string, SectionNode>();
  for (const n of flattenTree(left)) leftByNumber.set(n.number, n);
  const rightByNumber = new Map<string, SectionNode>();
  for (const n of flattenTree(right)) rightByNumber.set(n.number, n);

  const allNumbers = new Set<string>([
    ...leftByNumber.keys(),
    ...rightByNumber.keys(),
  ]);
  const sorted = [...allNumbers].sort(compareDottedNumber);

  return sorted.map((number) => ({
    number,
    left: leftByNumber.get(number) ?? null,
    right: rightByNumber.get(number) ?? null,
  }));
}
