/**
 * Shared helpers for the PDF batch-export flow (Phase 7.3).
 *
 * Pure functions only — usable from main, preload and renderer. The
 * types live in `ipc.ts`; this file exists so the dedup logic can be
 * imported on both sides of the IPC boundary without duplication.
 */

/**
 * Given a list of desired base filenames (without extension), produce a
 * parallel list with no duplicates. On each conflict we append
 * `-1`, `-2`, … until unique. Preserves input order.
 *
 *   ["A", "B", "A", "A"]  →  ["A", "B", "A-1", "A-2"]
 *
 * Empty strings are coerced to "export" before deduping. Callers that
 * want different empty-string behaviour should sanitise upstream.
 */
export function dedupeFileBases(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const raw of names) {
    const base = raw.length > 0 ? raw : "export";
    const prev = seen.get(base) ?? 0;
    if (prev === 0) {
      out.push(base);
      seen.set(base, 1);
    } else {
      // Find the next free suffix. Rare in practice, so linear is fine.
      let i = prev;
      while (seen.has(`${base}-${i}`)) i += 1;
      const next = `${base}-${i}`;
      out.push(next);
      seen.set(base, i + 1);
      seen.set(next, 1);
    }
  }
  return out;
}

/**
 * De-duplicate batch filenames against a set of names already on disk
 * AND against other items in the same batch. Matches the Finder / File
 * Explorer pattern: if "foo.pdf" already exists, write "foo-1.pdf";
 * keep incrementing on further collisions.
 *
 * `existingOnDisk` is the set of file base-names (without extension)
 * the main process has already observed in the target directory. The
 * main handler passes the pre-listed directory contents; this function
 * is otherwise pure so we can unit-test the logic without touching
 * the filesystem.
 */
export function dedupeAgainstDisk(
  names: readonly string[],
  existingOnDisk: ReadonlySet<string>,
): string[] {
  const seen = new Map<string, number>(); // base → next suffix to try
  const out: string[] = [];
  // Pre-seed `seen` with on-disk bases so the first collision bumps to -1.
  for (const n of existingOnDisk) seen.set(n, 1);
  for (const raw of names) {
    const base = raw.length > 0 ? raw : "export";
    const prev = seen.get(base) ?? 0;
    if (prev === 0) {
      out.push(base);
      seen.set(base, 1);
    } else {
      let i = prev;
      while (seen.has(`${base}-${i}`) || existingOnDisk.has(`${base}-${i}`)) {
        i += 1;
      }
      const next = `${base}-${i}`;
      out.push(next);
      seen.set(base, i + 1);
      seen.set(next, 1);
    }
  }
  return out;
}
