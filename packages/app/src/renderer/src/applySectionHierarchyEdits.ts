/**
 * applySectionHierarchyEdits — slice 10G.
 *
 * Pure helper that takes a raw `SectionData[]` (as read from disk) and
 * the current edit buffer, and returns a view of the sections that
 * reflects any pending renames AND filters out any sections staged
 * for delete (including every descendant of those sections, since the
 * core cascade-delete wipes the whole subtree).
 *
 * Creates are NOT folded in — new sections get disk ids only after
 * save + reload. The renderer shows the "dirty" indicator and the
 * user has to save to see new sections appear. This matches the
 * 10H.7 PFBB-supplement-create flow.
 *
 * Kept deliberately narrow: one function, one array in → one array
 * out. No state, no React. Trivial to test.
 */

import type { SectionData } from "../../shared/ipc.js";
import type { EditMap } from "./edits.js";
import { getEffectiveSectionHeading, stagedSectionDeleteIds } from "./edits.js";

/**
 * Apply pending hierarchy edits of the given `specKind` to `sections`.
 * Returns a new array; input is not mutated.
 *
 * Algorithm:
 *   1. Collect the set of ids staged for deletion.
 *   2. Walk the parent chain of every section; if any ancestor is in
 *      the delete set, the section is hidden too (cascade).
 *   3. Patch the heading on every surviving section via the pending
 *      rename patches.
 *
 * Section arrays can be very long in practice (hundreds of rows per
 * BDB), so the ancestor walk uses a cached lookup map to stay O(n).
 */
export function applySectionHierarchyEdits(
  sections: readonly SectionData[],
  edits: EditMap,
  specKind: "workSpec" | "bdb",
): SectionData[] {
  const deletedIds = stagedSectionDeleteIds(edits, specKind);
  if (deletedIds.size === 0) {
    // Fast path — no deletes. Still apply renames.
    return sections.map((s) => ({
      ...s,
      heading: getEffectiveSectionHeading(edits, specKind, s.id, s.heading),
    }));
  }
  // Build id → section lookup for parent walks.
  const byId = new Map<number, SectionData>();
  for (const s of sections) byId.set(s.id, s);
  // Cache of "is this id under a deleted ancestor?" keyed by id.
  const hiddenById = new Map<number, boolean>();
  const isHidden = (id: number): boolean => {
    const cached = hiddenById.get(id);
    if (cached !== undefined) return cached;
    if (deletedIds.has(id)) {
      hiddenById.set(id, true);
      return true;
    }
    const s = byId.get(id);
    if (!s) {
      hiddenById.set(id, false);
      return false;
    }
    if (s.parentId == null) {
      hiddenById.set(id, false);
      return false;
    }
    const hidden = isHidden(s.parentId);
    hiddenById.set(id, hidden);
    return hidden;
  };
  const out: SectionData[] = [];
  for (const s of sections) {
    if (isHidden(s.id)) continue;
    out.push({
      ...s,
      heading: getEffectiveSectionHeading(edits, specKind, s.id, s.heading),
    });
  }
  return out;
}
