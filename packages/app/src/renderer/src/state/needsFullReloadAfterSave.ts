/**
 * Decide whether a successful Save / Save As needs to reload the
 * file from disk (slow path) or can be folded into in-memory state
 * via `mergeSavedEdits` (fast path).
 *
 * The fast path covers field updates we can safely merge into the
 * existing payload: section bodies, CP rows, CP titles, contract
 * names, work-area / BDB / CP metadata.
 *
 * The slow path is required when:
 *   - An edit assigns ids the renderer can't predict (creates).
 *   - An edit removes rows the renderer would otherwise still
 *     show as "deleted but visible" zombies (container deletes —
 *     fix 2026-05-11).
 *   - An edit touches a part of the payload `mergeSavedEdits`
 *     doesn't yet understand (custom_data, cp header text,
 *     PFBB child supplements).
 *
 * Kept as a pure function so the test suite doesn't have to mock
 * the React save flow to verify the decision.
 */

import type { EditRequest } from "../../../shared/ipc.js";

/**
 * The set of `Edit.target` values that require a full reload from
 * disk after a successful save. If you add a new core Edit kind,
 * decide here whether mergeSavedEdits can fold it locally — if
 * not, add it to this set.
 */
const RELOAD_TARGETS: ReadonlySet<EditRequest["target"]> = new Set([
  // PFBB child supplement creates + deletes assign / remove rows
  // with disk-side ids the renderer can't guess.
  "bdbSectionCreate",
  "bdbSectionDelete",
  // custom_data: not modelled in FilePayload's merge yet.
  "customDataSet",
  "customDataDelete",
  // Section hierarchy: creates assign disk ids; deletes cascade
  // subtrees mergeSavedEdits can't reconstruct.
  "sectionCreate",
  "sectionRename",
  "sectionDelete",
  // CP header updates: mergeSavedEdits has no helper for
  // cpHeadersByPlan yet.
  "cpHeaderUpdate",
  // FIX-Zombie 2026-05-11 — container deletes were silently
  // ignored by mergeSavedEdits, leaving deleted rows visible in
  // the renderer until close-and-reopen. Reload pulls the
  // post-delete state from disk; core's cascade is the source
  // of truth, so the renderer doesn't have to mirror it.
  "deleteContract",
  "deleteWorkArea",
  "deleteBdb",
]);

/** True when at least one edit in the batch needs a disk reload. */
export function needsFullReloadAfterSave(outgoing: EditRequest[]): boolean {
  return outgoing.some((e) => RELOAD_TARGETS.has(e.target));
}
