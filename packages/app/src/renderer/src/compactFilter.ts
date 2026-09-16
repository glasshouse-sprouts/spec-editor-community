/**
 * Pure helpers for the Compact view mode.
 *
 * Compact view hides every section whose body has no meaningful content,
 * so a long spec full of placeholder headings reads shorter at a glance.
 * A parent section survives if any of its descendants has real content —
 * even though its own body is empty — so the surviving children still
 * have their numbering context intact.
 *
 * What counts as empty:
 *   - null / undefined / empty string
 *   - HTML that renders to only whitespace (`<p></p>`, `<p>&nbsp;</p>`,
 *     `<p> </p>`, `<br />`, etc.)
 *
 * What counts as non-empty:
 *   - Any text after stripping tags + collapsing `&nbsp;`
 *   - Any `<img>` or `<table>` (visual content has no text to measure)
 *
 * Kept deliberately simple: this is display-only filtering, not a
 * semantic "is this section meaningful?" check. A single dot counts as
 * non-empty — which is fine, since the user wrote it on purpose.
 */

import type { AlignedRow, SectionNode } from "./sectionTree.js";

/**
 * True when the given body is visually empty for compact-view purposes.
 * See the module comment for the exact rules.
 */
export function isEmptyBody(body: string | null | undefined): boolean {
  if (body == null) return true;
  // Visual content without text — treat as non-empty so the row survives.
  if (/<img\b/i.test(body)) return false;
  if (/<table\b/i.test(body)) return false;
  const stripped = body
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    // Other common whitespace entities that Word / TipTap may emit.
    .replace(/&#160;|&#xA0;/gi, " ")
    .trim();
  return stripped.length === 0;
}

/**
 * Keep only sections that have content, plus their ancestors as long as
 * any descendant survived. Order and structure of surviving nodes is
 * preserved so numbering ("1.2.3") still reads correctly.
 *
 * Non-compact mode (compact === false) returns the input tree unchanged
 * so callers can wire this in unconditionally.
 */
export function filterTreeForCompact(
  tree: SectionNode[],
  compact: boolean,
): SectionNode[] {
  if (!compact) return tree;
  const walk = (nodes: SectionNode[]): SectionNode[] => {
    const out: SectionNode[] = [];
    for (const n of nodes) {
      const keptKids = walk(n.children);
      const selfHasContent = !isEmptyBody(n.section.body);
      if (selfHasContent || keptKids.length > 0) {
        out.push({ ...n, children: keptKids });
      }
    }
    return out;
  };
  return walk(tree);
}

/**
 * Aligned-view variant.
 *
 * A row survives if EITHER side (BDB or work area) has non-empty
 * content, OR any row further down shares a dotted-number prefix with
 * this row AND survives itself — i.e. this row is an ancestor of a
 * surviving descendant.
 *
 * Example: row "2" is empty on both sides, but "2.1" has content on the
 * work-area side. "2" survives so the "2.1" line still reads with its
 * parent context.
 *
 * Non-compact mode returns the input list unchanged.
 */
export function filterAlignedRowsForCompact(
  rows: AlignedRow[],
  compact: boolean,
): AlignedRow[] {
  if (!compact) return rows;
  // First pass: decide which rows have self-content (both sides empty =
  // no self-content on this row).
  const selfKept = rows.map(
    (r) =>
      (r.left != null && !isEmptyBody(r.left.section.body)) ||
      (r.right != null && !isEmptyBody(r.right.section.body)),
  );
  // Second pass: a row also survives if any later row is a descendant
  // (its dotted number starts with `row.number + "."`) AND that row is
  // kept. Rows are sorted parent-before-child by the merge step, so once
  // we hit the first row that ISN'T in this parent's subtree, we're done.
  const kept = selfKept.slice();
  for (let i = 0; i < rows.length; i++) {
    if (kept[i]) continue;
    const prefix = rows[i]!.number + ".";
    for (let j = i + 1; j < rows.length; j++) {
      if (!rows[j]!.number.startsWith(prefix)) break; // left the subtree
      if (kept[j]) {
        kept[i] = true;
        break;
      }
    }
  }
  return rows.filter((_, i) => kept[i]);
}
