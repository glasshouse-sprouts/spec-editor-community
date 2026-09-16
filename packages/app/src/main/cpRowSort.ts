/**
 * Pure sort helpers for control-plan rows (main side).
 *
 * Extracted into its own module so we can unit-test it without booting
 * Electron or SQLite. Used by `groupControlPlanRows` in `index.ts`.
 *
 * Why a custom comparator?
 *   `section_no` is stored as free text in Molio — it can be "1", "1.2",
 *   "A-3", or empty when a row was just inserted via "+ Add row". A plain
 *   natural-collation sort would put empty strings at the top, which is
 *   what surfaced as the "new rows appear above existing rows" bug.
 *
 *   The fix:
 *     1. Empty `sectionNo` always sorts LAST (after all populated rows).
 *     2. Populated `sectionNo` values sort naturally against each other
 *        (so "2" < "10", not string-lex).
 *     3. Ties broken by database `id` ascending, so two freshly-added
 *        blank rows appear in insertion order (newest at the very end).
 */

/** Minimal shape the comparator needs. Kept local so this module has no
 *  dependency on the IPC shared types. */
export interface CpRowSortable {
  id: number;
  sectionNo: string;
}

/**
 * Comparator that matches the ordering rules above. Stable across calls —
 * deterministic for the same input. Uses `Intl.Collator` with
 * `numeric: true` so natural numeric ordering works ("2" before "10").
 */
export function compareCpRows(
  a: CpRowSortable,
  b: CpRowSortable,
  collator: Intl.Collator = new Intl.Collator(undefined, { numeric: true }),
): number {
  const aEmpty = a.sectionNo === "";
  const bEmpty = b.sectionNo === "";
  // Empty strings go to the bottom. One empty, one not → non-empty wins.
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  // Both empty OR both populated: natural-compare the text first.
  const byText = collator.compare(a.sectionNo, b.sectionNo);
  if (byText !== 0) return byText;
  // Tie-break by id so ordering is deterministic (and newly-inserted
  // blank rows land after older blank rows).
  return a.id - b.id;
}
