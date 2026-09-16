/**
 * Slice "Version compare" — hierarchical section path helper.
 *
 * The Molio data model gives each section a *local* `sectionNo` (an
 * integer that's unique among siblings under one parent) plus a
 * `parentId`. Multiple sections at different nesting levels can share
 * the same `sectionNo` (e.g. every "Generelt" sub-row in a BDB sits at
 * sectionNo=1 under its own parent). The hierarchical path — the
 * dotted number you see in the TOC, like "1.2.3" — is what actually
 * uniquely identifies a section within its owning BDB or work area.
 *
 * The version-compare slice originally matched sections by the flat
 * `sectionNo` integer, which collapsed all same-numbered siblings to
 * a single bucket. That meant unrelated sections were diffed against
 * each other (OMFANG against the last "Generelt" leaf, etc.). This
 * helper produces the proper match key.
 *
 * Pure function — no DOM, no I/O. Safe to import from anywhere.
 */
export interface PathLike {
  id: number;
  sectionNo: number;
  parentId: number | null;
}

/**
 * Return a Map from section id to its dotted path ("1", "1.1",
 * "2.2.3", …) within the supplied list. Walks each section's
 * `parentId` chain up to the root using only sections in `list` —
 * if a `parentId` doesn't resolve inside the list (data anomaly),
 * the chain stops there and we use what we have, which still gives
 * a unique-within-list key.
 *
 * Defensive against accidental cycles via a per-walk `visited` set.
 */
export function computeSectionPaths<T extends PathLike>(
  list: ReadonlyArray<T>,
): Map<number, string> {
  const byId = new Map<number, T>();
  for (const s of list) byId.set(s.id, s);
  const out = new Map<number, string>();
  for (const s of list) {
    const parts: number[] = [];
    let cur: T | undefined = s;
    const visited = new Set<number>();
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      parts.unshift(cur.sectionNo);
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
    out.set(s.id, parts.join("."));
  }
  return out;
}

/**
 * Numerically compare two dotted-path strings ("1", "1.2", "2.4",
 * "4.1.2") in tree-walk order. Splits each path on `.` and compares
 * the numeric segments left-to-right. Shorter paths sort BEFORE
 * longer paths that share the same prefix ("2" < "2.4"). Useful as a
 * comparator for the Revisions list, where the user expects natural
 * ordering: "2.4" < "4.1.2" rather than the lexicographic "10" < "2".
 *
 * Non-numeric segments are treated as 0; cleanly tolerates empty
 * strings (sort to the front).
 */
export function comparePathNumeric(a: string, b: string): number {
  if (a === b) return 0;
  const aParts = a ? a.split(".") : [];
  const bParts = b ? b.split(".") : [];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = i < aParts.length ? Number.parseInt(aParts[i]!, 10) || 0 : -1;
    const bv = i < bParts.length ? Number.parseInt(bParts[i]!, 10) || 0 : -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}
