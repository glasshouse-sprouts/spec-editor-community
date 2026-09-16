/**
 * Word-level text diff.
 *
 * Slice "Version compare". Pure helper — no DOM, no I/O. Used by the
 * Revisions tab preview, the aligned-view reference column, and the
 * PDF "Mark version changes" export to highlight what's added vs.
 * deleted between two text strings.
 *
 * Algorithm
 * ---------
 * Tokenise both strings into "words" (a word is a maximal run of
 * non-whitespace, with each whitespace gap kept as its own token so
 * the original spacing is preserved on re-emit). Then run the classic
 * O(n×m) LCS matrix to find the longest common subsequence of tokens.
 * Walk the matrix back to produce an ordered list of segments —
 * `equal`, `added` (in `b` only), `deleted` (in `a` only).
 *
 * Trade-offs
 * ----------
 * - Pure, no deps. ~50 LOC.
 * - O(n×m) memory. A typical section body is a few hundred words; even
 *   pathological 5000×5000 inputs use ~25 MB which is fine for an
 *   Electron renderer. If we ever hit a real ceiling, swap for
 *   `jsdiff`'s Myers algorithm.
 * - HTML-blind. The caller passes plain text; if you want to preserve
 *   `<strong>` etc. in the output, strip-then-diff-then-reapply at the
 *   call site (a Phase F concern, not here).
 */

/** One segment of a diff: a contiguous run of either common, added, or deleted tokens. */
export interface DiffSegment {
  kind: "equal" | "added" | "deleted";
  /**
   * The reconstructed text for this segment. Concatenating all
   * segments in order gives back something visually equivalent to a
   * naive "deletions then additions" merge of the two inputs.
   */
  text: string;
}

/**
 * Compute a word-level diff. `a` is the "before" text (so missing
 * tokens are `deleted`), `b` is the "after" text (extra tokens are
 * `added`). Equal segments interleave between them.
 *
 * Empty inputs are handled cleanly: two empties → empty diff; one
 * empty → the other side renders as a single deleted/added segment.
 */
export function wordDiff(a: string, b: string): DiffSegment[] {
  if (!a && !b) return [];
  if (!a) return [{ kind: "added", text: b }];
  if (!b) return [{ kind: "deleted", text: a }];

  const ta = tokenise(a);
  const tb = tokenise(b);

  // LCS length matrix. lcs[i][j] = longest common subsequence length
  // of ta[0..i) and tb[0..j).
  const n = ta.length;
  const m = tb.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      lcs[i + 1]![j + 1] =
        ta[i] === tb[j]
          ? lcs[i]![j]! + 1
          : Math.max(lcs[i]![j + 1]!, lcs[i + 1]![j]!);
    }
  }

  // Walk back from (n, m) building the segment list in reverse.
  const reversed: DiffSegment[] = [];
  let i = n;
  let j = m;
  let pendingKind: DiffSegment["kind"] | null = null;
  let pendingText = "";
  function flush(): void {
    if (pendingKind != null && pendingText !== "") {
      reversed.push({ kind: pendingKind, text: pendingText });
    }
    pendingKind = null;
    pendingText = "";
  }
  function push(kind: DiffSegment["kind"], text: string): void {
    if (pendingKind === kind) {
      // Reverse-walk: prepend, since we're emitting in reverse order.
      pendingText = text + pendingText;
    } else {
      flush();
      pendingKind = kind;
      pendingText = text;
    }
  }
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ta[i - 1] === tb[j - 1]) {
      // Match candidate. Before taking it, check whether there's an
      // EARLIER opportunity to match the same ref token — i.e.
      // dropping cur's current token (j-1) doesn't lose LCS length.
      // If so, defer: push cur's token as `added` so the equal
      // match anchors on the earliest occurrence in forward order.
      // Without this, "ref has one X, cur has X NEW X NEW X" would
      // anchor on the LAST X and squeeze the new content in front of
      // the equal anchor — exactly the "odd inder" artefact users
      // hit on real specs.
      if (lcs[i]![j - 1]! === lcs[i]![j]!) {
        push("added", tb[j - 1]!);
        j--;
        continue;
      }
      // Symmetric: if dropping ref's current token doesn't lose
      // LCS, defer the equal so it anchors on the earliest ref
      // occurrence. Same reasoning, mirrored.
      if (lcs[i - 1]![j]! === lcs[i]![j]!) {
        push("deleted", ta[i - 1]!);
        i--;
        continue;
      }
      push("equal", ta[i - 1]!);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      push("added", tb[j - 1]!);
      j--;
    } else {
      push("deleted", ta[i - 1]!);
      i--;
    }
  }
  flush();
  return consolidateRuns(reversed.reverse());
}

/**
 * Post-process: collapse `deleted` / `added` runs that are split by
 * pure-whitespace `equal` segments into single segments. The LCS pass
 * matches whitespace tokens because regular spaces look identical on
 * both sides — but visually those equal-whitespace breaks chop a
 * single conceptual change ("removed sentence A" / "added sentence B")
 * into a stuttering del-add-del-add stream of one-word fragments.
 *
 * After this pass each "differing region" between two real-content
 * equal segments becomes at most one `deleted` segment followed by
 * one `added` segment — the way a Word-track-changes rendering
 * normally reads.
 *
 * Whitespace-only equals that sit *inside* a differing region are
 * absorbed into BOTH sides (each side's text reconstruction still
 * round-trips through `equal + deleted` and `equal + added`
 * respectively). Whitespace-only equals at the edges of the input,
 * or between two real-content equals, pass through untouched.
 */
function consolidateRuns(segs: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  let pendingDel = "";
  let pendingAdd = "";
  function flushPending(): void {
    if (pendingDel) {
      out.push({ kind: "deleted", text: pendingDel });
      pendingDel = "";
    }
    if (pendingAdd) {
      out.push({ kind: "added", text: pendingAdd });
      pendingAdd = "";
    }
  }
  for (const s of segs) {
    if (s.kind === "deleted") {
      pendingDel += s.text;
      continue;
    }
    if (s.kind === "added") {
      pendingAdd += s.text;
      continue;
    }
    // s.kind === "equal"
    const isWhitespaceOnly = /^\s*$/.test(s.text);
    if (isWhitespaceOnly && (pendingDel || pendingAdd)) {
      // Inside a differing region — absorb the gap into both sides
      // so each side renders as a continuous run of marked text.
      pendingDel += s.text;
      pendingAdd += s.text;
      continue;
    }
    // Real-content equal (or whitespace at the edges with nothing
    // pending) — flush the pending run and pass this through.
    flushPending();
    out.push(s);
  }
  flushPending();
  return out;
}

/**
 * Split a string into "words and whitespace" tokens. Each maximal
 * run of non-whitespace is one token; each maximal run of whitespace
 * is its own token. Keeping whitespace as separate tokens lets the
 * diff land on word boundaries (rather than calling a leading space
 * a "word change") and lets the re-emitted text preserve the
 * original spacing.
 */
function tokenise(s: string): string[] {
  // Match non-whitespace runs OR whitespace runs.
  const re = /\s+|\S+/g;
  return s.match(re) ?? [];
}
