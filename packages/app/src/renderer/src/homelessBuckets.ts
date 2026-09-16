/**
 * Pure helpers for the sidebar "homeless" catch-all buckets (Slice 6O.1 — #109).
 *
 * Some records in a .moliospec may have no parent anywhere in the tree:
 *
 *   - A work area with `contract_id = NULL`  → no contract.
 *   - A BDB with `work_spec_id = NULL`       → no work area.
 *   - A control plan not referenced by any  → no BDB.
 *     BDB's design/production slot
 *
 * We still want these visible to the user, otherwise they become
 * invisible orphans that only show up in the file's bytes but never in
 * the UI. Tore's UX decision (see the 6O design thread) is to nest the
 * three catch-all buckets inside each other:
 *
 *   ▾ [No contract]
 *     ▾ [No work area]
 *       ▾ [No BDB]
 *           <unlinked control plan 1>
 *           <unlinked control plan 2>
 *         <homeless BDB 1>
 *         <homeless BDB 2>
 *       <homeless work area 1>
 *
 * The buckets are "tidy" — a bucket only appears if at least one row
 * (at any depth) below it is homeless. That keeps the tree clean for
 * well-formed projects while still surfacing orphans for cleanup.
 *
 * All functions here are DOM-free and pure so they can be unit-tested
 * without jsdom. The Sidebar consumes them in 6O.2.
 */

import type {
  BdbInfo,
  ControlPlanInfo,
  WorkSpecInfo,
} from "../../shared/ipc.js";

/**
 * What the sidebar needs to render the three nested catch-all buckets.
 *
 * `noContractWorkSpecs` is already exposed today as the "[No contract]"
 * entry in `groupWorkSpecsByContract`; we re-compute it here so every
 * piece of bucket logic lives in one place. The Sidebar can decide
 * which source to use — they should agree.
 *
 * Note: `noWorkAreaBdbs` are BDBs with `workSpecId == null`, not BDBs
 * whose workspec points to a *deleted* workspec. Those get a synthetic
 * "(unknown work area)" group upstream — different concern.
 */
export interface HomelessBuckets {
  /** Work areas with no contract assignment. */
  noContractWorkSpecs: WorkSpecInfo[];
  /** BDBs with no work_spec assignment. */
  noWorkAreaBdbs: BdbInfo[];
  /** Control plans not referenced by any BDB's design/production slot. */
  noBdbPlans: ControlPlanInfo[];
}

/**
 * Compute the three homeless bucket contents from the raw file payload.
 *
 * Deterministic ordering — we don't sort here so the caller can decide
 * display order (the Sidebar sorts by code/title elsewhere). We just
 * preserve input order, which keeps the tests simple and lets the
 * caller stack Intl.Collator semantics on top.
 *
 * A "homeless" work area is one whose *effective* contract id is null
 * — that way pending, unsaved "Move to contract → (none)" edits also
 * route the row into this bucket. The caller passes in the effective-
 * contract resolver so we don't pull edit-state into this module.
 */
export function computeHomelessBuckets(params: {
  workSpecs: WorkSpecInfo[];
  bdbs: BdbInfo[];
  controlPlans: ControlPlanInfo[];
  getEffectiveContractId?: (w: WorkSpecInfo) => number | null;
}): HomelessBuckets {
  const { workSpecs, bdbs, controlPlans, getEffectiveContractId } = params;

  const effectiveContractIdOf = (w: WorkSpecInfo): number | null =>
    getEffectiveContractId ? getEffectiveContractId(w) : w.contractId;

  const noContractWorkSpecs = workSpecs.filter(
    (w) => effectiveContractIdOf(w) == null,
  );

  const noWorkAreaBdbs = bdbs.filter((b) => b.workSpecId == null);

  // A CP is "no-BDB" if no BDB references it via either slot. We build a
  // Set once — faster than scanning bdbs for each plan, and matches how
  // Sidebar.tsx already computes `referencedPlanIds`.
  const referenced = new Set<number>();
  for (const b of bdbs) for (const id of b.controlPlanIds) referenced.add(id);
  const noBdbPlans = controlPlans.filter((c) => !referenced.has(c.id));

  return { noContractWorkSpecs, noWorkAreaBdbs, noBdbPlans };
}

/**
 * Which of the three nested buckets should be rendered?
 *
 * "Tidy" visibility per Tore's UX call: a bucket is rendered iff it
 * directly contains rows OR any nested-inside bucket contains rows.
 *
 *   - [No BDB] shows   ⇔ there's at least one unlinked CP.
 *   - [No work area]   ⇔ there's at least one homeless BDB OR
 *                        [No BDB] is visible (CPs nest under it).
 *   - [No contract]    ⇔ there's at least one contract-less work area
 *                        OR [No work area] is visible.
 *
 * So a lone orphan CP (no homeless BDB, no homeless work area) still
 * forces all three placeholders into view — which is the point: the
 * user needs to see the chain to understand why the CP is floating.
 */
export interface BucketVisibility {
  /** Render the outermost "[No contract]" node. */
  showNoContract: boolean;
  /** Render the "[No work area]" node nested inside [No contract]. */
  showNoWorkArea: boolean;
  /** Render the "[No BDB]" node nested inside [No work area]. */
  showNoBdb: boolean;
}

export function bucketVisibility(b: HomelessBuckets): BucketVisibility {
  const showNoBdb = b.noBdbPlans.length > 0;
  const showNoWorkArea = b.noWorkAreaBdbs.length > 0 || showNoBdb;
  const showNoContract = b.noContractWorkSpecs.length > 0 || showNoWorkArea;
  return { showNoContract, showNoWorkArea, showNoBdb };
}

/**
 * Convenience: true when nothing at all is homeless — the tree renders
 * without any "[No …]" placeholders. Callers use this to decide whether
 * to render the whole nested cluster in the first place.
 */
export function hasAnyHomeless(b: HomelessBuckets): boolean {
  return (
    b.noContractWorkSpecs.length > 0 ||
    b.noWorkAreaBdbs.length > 0 ||
    b.noBdbPlans.length > 0
  );
}
