/**
 * Slice 10H.7.b Commit 1 — shared type that lets `SpecTabView` render
 * a PFBB child's merged view (master sections in grey + editable
 * supplements in black) without any child-specific chrome.
 *
 * When this type is threaded through `SpecTabView` → `SpecView` →
 * `SectionBlock`, the standard spec chrome (TOC, reference panel,
 * layout toggles, scrollspy) is reused verbatim. Regular BDB and
 * work-spec views pass `undefined` and are unaffected.
 *
 * Commit 1 adds the type plumbing only. No rendering branches change
 * in this commit. Commit 2 lights up the rendering in SectionBlock.
 */

import type { SectionData } from "../../shared/ipc.js";

export interface PfbbChildSupplementSnapshot {
  /**
   * Effective supplement body after merging edit-buffer + disk.
   * Empty string means no content either way.
   */
  effectiveBody: string;
  /**
   * The child-side `construction_element_spec_section.id` for this
   * supplement, or null if nothing has been persisted yet.
   */
  existingSectionId: number | null;
  /**
   * True when the edit buffer carries a staged create or delete for
   * this `(child, master-section)` pair. Drives the "●" dirty hint
   * and keeps the editor mounted mid-edit even after a clear-to-empty.
   */
  hasPendingEdit: boolean;
}

export interface PfbbChildContext {
  /** The child BDB's id — passed through to edit helpers. */
  childBdbId: number;
  /** Display name of the master BDB (used in the subtitle). */
  masterName: string;
  /**
   * Look up the on-disk + pending-edit supplement state for a given
   * master section. Returns a fresh snapshot on every call; the host
   * wires this to `getEffectiveBdbSupplementBody` + `isBdbSupplementEdited`.
   */
  supplementFor: (masterSectionId: number) => PfbbChildSupplementSnapshot;
  /** Stage a body change (or clear to empty) for a supplement. */
  onSupplementBodyChange: (input: {
    masterSectionId: number;
    sectionNo: string;
    body: string;
  }) => void;
  /**
   * Rows on the child that don't match a section on the master. Shown
   * as a "Broken supplements" panel below the main section list so
   * orphans aren't silently lost. See pfbbMergedView.ts §
   * `brokenSupplements` for how they're produced.
   */
  brokenSupplements: readonly SectionData[];
}
