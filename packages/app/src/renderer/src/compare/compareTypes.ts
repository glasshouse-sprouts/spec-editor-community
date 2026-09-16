/**
 * Slice "Version compare" — output shapes for the diff orchestrator.
 *
 * Three flavours of revision (section / CP row / attachment) plus a
 * shared parent shape so the Revisions tab and the aligned view can
 * group results by location without re-deriving labels.
 */

import type { DiffSegment } from "./wordDiff.js";

/** What changed kind. Same three values for every revision target. */
export type RevisionKind = "added" | "deleted" | "modified";

/**
 * Identifier for the parent (work area or BDB) a section / CP belongs
 * to. The `key` is the matching key chosen by Phase B's matchers
 * (workAreaCode-or-name for work areas, "<workAreaKey>::name" for
 * BDBs); it's stable across versions so the Revisions tab can group
 * rows under the same parent label even when the underlying SQLite
 * ids differ.
 *
 * `currentId` / `referenceId` are the in-payload SQLite ids if the
 * parent exists in that side; null when the parent itself is
 * added/deleted (e.g. a brand-new work area appearing in `current`).
 * Click-to-jump uses these.
 */
export interface RevisionParent {
  kind: "workSpec" | "bdb";
  key: string;
  label: string;
  /** For BDB parents, the work-area label is included so the
   *  breadcrumb can read "WorkArea / BDB / Section". */
  workAreaLabel?: string;
  currentId: number | null;
  referenceId: number | null;
}

/**
 * One revision affecting a section body. `currentBody` / `referenceBody`
 * are the (already-sanitised) HTML strings; the segments[] is a plain-
 * text word-level diff useful for list previews. Phase F (PDF marking)
 * reuses these alongside the structured DOM-aware path.
 */
export interface SectionRevision {
  type: "section";
  kind: RevisionKind;
  parent: RevisionParent;
  /** Local `section_no` (numeric) — the section's own number under
   *  its immediate parent. Useful for callers that need the leaf
   *  number. For display in the Revisions list, prefer `sectionPath`. */
  sectionNo: number;
  /**
   * Hierarchical dotted path identifying the section within its
   * owning BDB or work area, e.g. "1", "1.2", "2.2.3". This is the
   * stable matching key (built by `sectionPath.computeSectionPaths`)
   * and the value the Revisions tab and preview modal show to the
   * user — local `sectionNo` alone is ambiguous because many
   * sections share `sectionNo=1` at different nesting levels.
   */
  sectionPath: string;
  /** Heading on whichever side has it ("current" preferred). */
  heading: string;
  /** Body in the current file. Empty string when `kind === "deleted"`. */
  currentBody: string;
  /** Body in the reference file. Empty string when `kind === "added"`. */
  referenceBody: string;
  /**
   * Word-level diff of the two bodies as plain text. Empty for
   * `added` / `deleted` (which are 100% on one side). For `modified`
   * the array carries `equal` / `added` / `deleted` segments
   * interleaved.
   */
  textSegments: DiffSegment[];
}

/**
 * One revision affecting a control-plan row. Rows are matched by their
 * `sectionNo` string within a matched CP (slot-based: a BDB has at
 * most one design + one production CP, so the slot uniquely identifies
 * the CP across versions).
 */
export interface CpRowRevision {
  type: "cpRow";
  kind: RevisionKind;
  /** Owning BDB's parent (work area). */
  parent: RevisionParent;
  /** Owning BDB label, e.g. `"Fundering"`. */
  bdbLabel: string;
  /** "design" | "production" — the slot the CP lives in. */
  slot: "design" | "production";
  /** CP title at time of compare (current preferred). */
  cpTitle: string;
  /** Row's `section_no` string (e.g. "1.2.3"). The matching key. */
  sectionNo: string;
  /**
   * The rows themselves, for cell-level rendering. Either one is null
   * when the row only exists on one side.
   */
  currentRow: CpRowSnapshot | null;
  referenceRow: CpRowSnapshot | null;
  /**
   * For `modified`: which fields differ. Empty for `added` / `deleted`.
   * Subset of the editable CP-row column set.
   */
  changedFields: ReadonlyArray<CpRowFieldName>;
}

/** The editable CP-row columns we track for diff purposes. */
export type CpRowFieldName =
  | "subject"
  | "reference"
  | "method"
  | "quantity"
  | "time"
  | "acceptanceCriteria"
  | "documentation"
  | "controlType"
  | "controlLevel"
  | "sampleLevel";

/** Snapshot of a CP row's editable fields, as used by the diff. */
export interface CpRowSnapshot {
  sectionNo: string;
  subject: string;
  reference: string;
  method: string;
  quantity: string;
  time: string;
  acceptanceCriteria: string;
  documentation: string;
  controlType: number;
  controlLevel: string;
  sampleLevel: string;
}

/**
 * One revision affecting an attachment. Tore's call: just record
 * whether the attachment was added / deleted / modified — no inner
 * content diff (we don't peer into the bytes). "Modified" means the
 * attachment with the same name / parent has different bytes (sha
 * changed) or different mime / type.
 */
export interface AttachmentRevision {
  type: "attachment";
  kind: RevisionKind;
  /** Parent work-area label so the row groups visibly. */
  workAreaLabel: string;
  /** Stable parent key (work-area-code-or-name). */
  workAreaKey: string;
  name: string;
  /** Only meaningful on `modified`. Subset of attachment fields that differ. */
  changedFields: ReadonlyArray<"mime" | "attachmentTypeId" | "bytes">;
}

/**
 * Whole-spec add / delete — collapses the case where an entire work
 * area or BDB exists on only one side. Without this collapse the
 * Revisions tab would carry one SectionRevision per section in the
 * vanished spec, which is noisy when the user just wants to know
 * "the whole thing was deleted". Tore's call 2026-04-26.
 *
 * Only "added" / "deleted" — a "modified" whole spec doesn't apply
 * (a spec that's matched on both sides falls through to the
 * per-section diff path naturally).
 */
export interface WholeSpecRevision {
  type: "wholeSpec";
  kind: "added" | "deleted";
  parent: RevisionParent;
  /** Number of sections inside the missing/added spec, for display. */
  sectionCount: number;
}

export type Revision =
  | SectionRevision
  | CpRowRevision
  | AttachmentRevision
  | WholeSpecRevision;
