/**
 * Shared alphabetical sort helpers (Slice 10B).
 *
 * The app has a handful of tree-style lists (contracts, work areas, BDBs,
 * picker dialogs) that all want the same ordering: natural-sort by a
 * short "code" first, then by name when codes tie, with Danish
 * collation (Æ/Ø/Å sort after Z; case-insensitive).
 *
 * Before this helper each call site rolled its own `Intl.Collator` —
 * some used `localeCompare(undefined, …)`, some used different option
 * combos, none specified a locale. That made the visible order
 * subtly different depending on where you looked.
 *
 * This file centralises that logic so every tree, list and picker in
 * the app sorts the same way.
 *
 * Scope note: control plans use `numberText` like "2.1" / "10.2" and
 * have their own dotted-number comparator in `sectionTree.ts`; they
 * deliberately do NOT go through this helper. See Slice 10B in
 * ROADMAP.md.
 */

/**
 * Danish-aware natural-order collator. Shared across call sites so we
 * only pay the construction cost once.
 *
 * Options:
 *   - `"da"` locale: Æ/Ø/Å get Danish collation (they sort after Z,
 *     not wherever the default locale puts them).
 *   - `numeric: true`: "2" < "10" instead of "10" < "2".
 *   - `sensitivity: "base"`: case-insensitive (a == A == á == Á).
 *     This is what a Danish spec author expects — they've seen
 *     "abc" and "ABC" treated as the same word for decades.
 */
export const danishCollator = new Intl.Collator("da", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Normalise a code for comparison: trim whitespace, then treat null /
 * undefined / the empty string the same. The returned value is either
 * a non-empty trimmed code, or `""` meaning "no code".
 */
function normaliseCode(code: string | null | undefined): string {
  return (code ?? "").trim();
}

/**
 * Normalise a name for comparison. Same null-safety as codes but we
 * don't collapse "" separately — a missing name just compares as empty.
 */
function normaliseName(name: string | null | undefined): string {
  return (name ?? "").trim();
}

/**
 * Compare two items first by code, then by name on tie.
 *
 * Items with an empty / missing code sink to the bottom ("I'll sort
 * proper entries first, stragglers last"). This matches what every
 * existing sort site in the app was already trying to do — it just
 * wasn't consistent before.
 *
 * Returns a standard `Array.sort` comparator value:
 *   negative → a before b
 *   zero     → equivalent for sort purposes
 *   positive → a after b
 *
 * Example:
 *   list.sort((a, b) => compareCodeThenName(
 *     a.workAreaCode, a.workAreaName,
 *     b.workAreaCode, b.workAreaName,
 *   ));
 */
export function compareCodeThenName(
  aCode: string | null | undefined,
  aName: string | null | undefined,
  bCode: string | null | undefined,
  bName: string | null | undefined,
): number {
  const ac = normaliseCode(aCode);
  const bc = normaliseCode(bCode);

  // Non-empty codes before empty ones.
  if (ac && !bc) return -1;
  if (!ac && bc) return 1;

  // Both have codes → compare codes first.
  if (ac && bc) {
    const byCode = danishCollator.compare(ac, bc);
    if (byCode !== 0) return byCode;
  }

  // Tie on codes (or both codeless) → compare names.
  return danishCollator.compare(normaliseName(aName), normaliseName(bName));
}

/**
 * Compare two items by name only. Used for entities that don't have a
 * code at all (e.g. BDBs — they only carry `name`). Separate from
 * `compareCodeThenName` so the intent is explicit at the call site
 * instead of passing a pair of fake `null` codes.
 */
export function compareByName(
  aName: string | null | undefined,
  bName: string | null | undefined,
): number {
  return danishCollator.compare(normaliseName(aName), normaliseName(bName));
}
