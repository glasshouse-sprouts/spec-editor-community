/**
 * Slice 10H.7 Commit 4 — pure helpers that build the "merged" view a
 * PFBB child shows in the editor: master sections paired with any
 * supplement the child already has.
 *
 * No React, no DOM. Exported so the merged-view component can stay
 * shallow (just layout + render) and so tests can exercise the
 * invariants we care about — that every master section gets a row,
 * that unmatched child supplements surface as "broken inheritance",
 * and that nothing leaks from a different BDB accidentally.
 */
import type { SectionData } from "../../shared/ipc.js";

/**
 * One pairing: a master section, plus the child's supplement (if any).
 *
 * - `supplement` is null when the child has not yet added any content
 *   for this master section. The merged view shows an "Add supplement"
 *   affordance in that case.
 * - When non-null, `supplement.id` is the child-side
 *   `construction_element_spec_section.id` — feed it to
 *   `setBdbSectionSupplement`'s `existingSectionId` when editing, so
 *   clearing-to-empty flips to a delete edit instead of dropping the
 *   create patch.
 */
export interface MergedChildSection {
  masterSection: SectionData;
  supplement: SectionData | null;
}

/**
 * Build the merged view for a child BDB.
 *
 * Inputs:
 *  - `masterSections`: every section on the master BDB, ordered by
 *    `sectionNo` (the payload already sorts them; we don't resort).
 *  - `childSections`: every section on the child BDB. Used twice:
 *    1. those with `pfbbSectionId` pointing to a master section id →
 *       form the supplement join.
 *    2. those with `pfbbSectionId` that does NOT match any master
 *       section → "broken inheritance" rows (see `brokenSupplements`).
 *
 * Output:
 *  - `merged`: one row per master section, in order.
 *  - `brokenSupplements`: child rows whose `pfbbSectionId` matches
 *    nothing on the master — either a master section was deleted out
 *    from under the child, or the file was hand-edited. These render
 *    in a panel at the end of the TOC so the user can find and fix
 *    them, but are NOT silently dropped from the UI.
 *
 * Subscriber sections WITHOUT a `pfbbSectionId` (i.e. child-only
 * sections not tied to any master) are also "broken" per the 10H.7
 * rule that says children can't add new sections — those show up in
 * `brokenSupplements` too, distinguished by `pfbbSectionId === null`.
 */
export interface MergedChildView {
  merged: MergedChildSection[];
  brokenSupplements: SectionData[];
}

export function buildMergedChildView(input: {
  masterSections: readonly SectionData[];
  childSections: readonly SectionData[];
}): MergedChildView {
  const { masterSections, childSections } = input;

  // Index child supplements by the master-section id they point at.
  // Duplicates (two child rows pointing at the same master section)
  // keep only the first — the 10H.7 applyEdits upsert guarantees at
  // most one going forward, and older files with duplicates surface
  // the extras via brokenSupplements so the user can see them.
  const supplementByMaster = new Map<number, SectionData>();
  const seenMasterIds = new Set<number>();
  const broken: SectionData[] = [];
  const masterIdSet = new Set(masterSections.map((s) => s.id));

  for (const c of childSections) {
    if (c.pfbbSectionId == null) {
      // Child-only section — not legal per 10H.7 rules; surface it.
      broken.push(c);
      continue;
    }
    if (!masterIdSet.has(c.pfbbSectionId)) {
      // Points at a section that doesn't exist on this master.
      broken.push(c);
      continue;
    }
    if (supplementByMaster.has(c.pfbbSectionId)) {
      // Already have a supplement for this master section — the
      // extra one is a duplicate we can't render inline without
      // losing information, so surface it as broken.
      broken.push(c);
      continue;
    }
    supplementByMaster.set(c.pfbbSectionId, c);
    seenMasterIds.add(c.pfbbSectionId);
  }

  const merged: MergedChildSection[] = masterSections.map((m) => ({
    masterSection: m,
    supplement: supplementByMaster.get(m.id) ?? null,
  }));

  return { merged, brokenSupplements: broken };
}
