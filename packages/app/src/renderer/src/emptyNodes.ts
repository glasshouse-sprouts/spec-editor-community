/**
 * Pure predicate for the "hide empty nodes" sidebar feature (#255).
 *
 * "Empty" has a deliberately narrow definition (locked 2026-06-19):
 *   - a control plan is empty when it has no detail rows;
 *   - a contract is empty when no work area is assigned to it.
 *
 * Control-plan emptiness is computed in the main process and rides on
 * the payload as `ControlPlanInfo.isEmpty`, so only the contract rule
 * lives here (it depends on the renderer's effective contract grouping,
 * which reflects unsaved "move to contract" edits). No I/O, no React.
 *
 * The Sidebar calls this to (a) draw a small "tom" marker on an empty
 * contract and (b) drop it when the "Skjul tomme" toggle is on. The
 * `[No contract]` bucket (contractId === null) is never treated as a
 * hideable empty contract — it only appears when it actually holds
 * orphaned work areas, so hiding it would be meaningless.
 */

/**
 * True when a real contract has no work areas assigned. The null bucket
 * ("[No contract]") is never empty-by-this-rule — return false for it.
 */
export function isContractEmpty(
  contractId: number | null,
  workSpecCount: number,
): boolean {
  if (contractId === null) return false;
  return workSpecCount === 0;
}
