/**
 * Pure helper for picking the default name the "Duplicate BDB" dialog
 * pre-fills. Lives in its own file so it can be unit-tested without
 * any UI plumbing.
 *
 * Naming rules (worked out with the user up front):
 *   - First duplicate of `Foo` → `Foo (copy)`.
 *   - If `Foo (copy)` already exists → `Foo (copy 2)`.
 *   - If both `Foo (copy)` and `Foo (copy 2)` exist → `Foo (copy 3)`.
 *   - Duplicating `Foo (copy)` directly also starts from `Foo (copy 2)`
 *     (we strip the trailing `(copy N)` off the source name before
 *      re-attaching a fresh suffix, so chained duplicates don't grow
 *      an ever-longer " (copy) (copy) (copy)" tail).
 *
 * The comparison is case-sensitive and whitespace-sensitive — same as
 * the rest of the app treats BDB names.
 */

/** Strip a trailing " (copy)" or " (copy N)" suffix, if present. */
export function stripCopySuffix(name: string): string {
  // ` (copy)` or ` (copy 2)`, ` (copy 17)`, ...
  const m = name.match(/^(.*?)\s*\(copy(?:\s+\d+)?\)\s*$/);
  // m[1] is the first capture group. It's only nullable in TS's
  // strict type model — if the regex matched, the group always exists.
  // Fall back to the original name defensively.
  return m?.[1] ?? name;
}

/**
 * Pick the default name for a duplicate of `sourceName`, avoiding any
 * collision with the names already in `existingNames`.
 *
 * `existingNames` should include every sibling BDB name — including the
 * source — in the same scope the duplicate is being added to (i.e. the
 * same work-area for now; schema allows BDB names to repeat across
 * work-areas, but within a work-area they should stay unique-looking).
 */
export function nextDuplicateName(
  sourceName: string,
  existingNames: readonly string[],
): string {
  const base = stripCopySuffix(sourceName);
  const taken = new Set(existingNames);

  const first = `${base} (copy)`;
  if (!taken.has(first)) return first;

  // Try "(copy 2)", "(copy 3)", ... until we find a free slot. Bounded
  // by taken.size + 2 so we can't loop forever even on pathological
  // inputs — the worst realistic case hits a free slot within the
  // first few tries.
  for (let n = 2; n <= taken.size + 2; n++) {
    const candidate = `${base} (copy ${n})`;
    if (!taken.has(candidate)) return candidate;
  }

  // Fallback — should be unreachable given the loop bound above, but
  // we'd rather return a timestamped name than throw.
  return `${base} (copy ${Date.now()})`;
}
