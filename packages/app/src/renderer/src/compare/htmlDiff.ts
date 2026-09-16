/**
 * Slice "Version compare" Phase F — HTML-aware word-level diff.
 *
 * Produces a diff-marked HTML string that preserves the reference
 * body's tag structure (tables, lists, bold, links) while marking
 * deleted and added word runs with the user's chosen styles.
 *
 * Why HTML-aware
 * --------------
 * The earlier plain-text approach stripped the reference's HTML
 * structure entirely, so a section with a table on the reference
 * side rendered as a flat string of cell text on the right column.
 * This helper walks the reference DOM, leaves the surrounding tag
 * tree alone, and only modifies text-node content + injects added
 * runs near the matching position in the original document order.
 *
 * Approach (Phase F round 2)
 * --------------------------
 * 1. Tokenise the reference's plain-text and the current's plain-text.
 *    Run the LCS-based word diff on those plain-text streams — gives
 *    an ordered list of `equal`/`added`/`deleted` segments.
 * 2. Build an "entry queue" derived from those segments. The queue
 *    contains ONLY non-whitespace words (so paragraph- and cell-
 *    boundary whitespace introduced by `bodyToText` doesn't desync
 *    against the live DOM, which has no such tokens). Each "ref-side"
 *    word is tagged with its kind (equal or deleted); each "added"
 *    segment becomes an "add" entry that sits between the surrounding
 *    ref words.
 * 3. Walk the reference DOM. For every text node, tokenise it and:
 *    - Whitespace tokens flow through into the current buffer
 *      (preserving the original spacing).
 *    - Word tokens consume the next entry. Before consuming a ref-
 *      word, drain any preceding `add` entries — emitting them as
 *      inline `<span>`s with the added format right at this position
 *      in the document.
 * 4. Any trailing `add` entries that weren't drained inline (because
 *    they came after the last ref word) get appended to the deepest
 *    block element inside the root, so the user can still see them.
 *
 * Why this layout
 * ---------------
 * Word-level matching lets the diff marks land on real boundaries
 * inside `<strong>`/`<em>`/`<td>`/etc. without disturbing the tag
 * tree. The whitespace-between-words is plain text (not styled), so
 * the strikethrough / colour shows on the changed words but the
 * inter-word spaces stay readable. Limitations:
 *   - Inline placement of an `add` is "before the next surviving ref
 *     word". When that next ref word lives in a different block from
 *     where the user actually inserted the text, the add lands in the
 *     wrong block. That's a real trade-off; surgical mid-sentence
 *     splicing needs a much heavier character-level diff. Acceptable
 *     for review purposes — the user still sees what was added.
 *   - When the reference has no DOM elements at all (body is plain
 *     text without tags), we fall through to a single `<p>` wrapping
 *     the diff segments inline.
 */

import type { DiffFormat } from "./versionCompareFormat.js";
import { wordDiff, type DiffSegment } from "./wordDiff.js";

/** Inline CSS string for a DiffFormat record. */
function diffFormatToCss(f: DiffFormat): string {
  const parts: string[] = [];
  const decorations: string[] = [];
  if (f.bold) parts.push("font-weight:700");
  if (f.italic) parts.push("font-style:italic");
  if (f.strikethrough) decorations.push("line-through");
  if (f.underline) decorations.push("underline");
  if (decorations.length > 0)
    parts.push(`text-decoration:${decorations.join(" ")}`);
  if (f.color) parts.push(`color:${f.color}`);
  if (f.background) parts.push(`background:${f.background}`);
  return parts.join(";");
}

/** Tag names that act as "block boundaries" — we append unmatched
 *  added runs at the end of these when the surrounding context fits. */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "TD",
  "TH",
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/**
 * Tokenise a string the same way `wordDiff` does so we can compare
 * lookups token-for-token across both files. Whitespace runs are
 * separate tokens.
 */
function tokenise(s: string): string[] {
  const re = /\s+|\S+/g;
  return s.match(re) ?? [];
}

/** True for a token that is purely whitespace (so contains no word characters). */
function isWhitespace(s: string): boolean {
  return /^\s+$/.test(s);
}

/**
 * Plain-text extraction matching the helper in compareVersions /
 * buildVersionAlignmentSections. Used as the diff input on both
 * sides — the reference's structural HTML is preserved separately
 * via DOM walk.
 */
function bodyToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * One entry in the queue we walk against the reference DOM. Either
 * a ref-side word (consumes one matching DOM token) or an "add"
 * payload that gets injected inline before the next ref-side word.
 */
type Entry =
  | { kind: "refWord"; word: string; ref: "equal" | "deleted" }
  | { kind: "add"; text: string };

/** Build the entry queue from the diff segment list. */
function buildEntries(segs: ReadonlyArray<DiffSegment>): Entry[] {
  const out: Entry[] = [];
  for (const s of segs) {
    if (s.kind === "added") {
      // Skip pure-whitespace adds — they contribute no signal.
      const trimmed = s.text.replace(/^\s+|\s+$/g, "");
      if (trimmed) out.push({ kind: "add", text: trimmed });
      continue;
    }
    // equal | deleted: emit one entry per word token (skip whitespace).
    for (const tok of tokenise(s.text)) {
      if (isWhitespace(tok)) continue;
      out.push({
        kind: "refWord",
        word: tok,
        ref: s.kind === "equal" ? "equal" : "deleted",
      });
    }
  }
  return out;
}

/**
 * Build a diff-marked HTML string from reference + current bodies.
 * Preserves the reference body's HTML structure; injects styled
 * `<span>` marks for word-level changes.
 */
export function htmlDiff(
  referenceHtml: string,
  currentHtml: string,
  addedFormat: DiffFormat,
  deletedFormat: DiffFormat,
): string {
  if (!referenceHtml && !currentHtml) return "";
  const refText = bodyToText(referenceHtml);
  const curText = bodyToText(currentHtml);
  if (!refText && !curText) return "";

  // No reference at all — render current's text wrapped as added.
  if (!referenceHtml || !refText) {
    return `<p><span style="${diffFormatToCss(addedFormat)}">${escapeHtml(
      curText,
    )}</span></p>`;
  }

  const segs = wordDiff(refText, curText);
  const entries = buildEntries(segs);

  // Parse the reference DOM. Wrap in a div so we can return its
  // innerHTML (root-level tag tree preserved).
  const doc = new DOMParser().parseFromString(
    `<div>${referenceHtml}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) {
    return renderInlineSegments(segs, addedFormat, deletedFormat);
  }

  // Pre-collect all text nodes inside `root` (tree-walker output is
  // live, so collecting first lets us replace nodes safely).
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  // Walk the entry queue + DOM text nodes in lock-step.
  let entIdx = 0;
  const deletedCss = diffFormatToCss(deletedFormat);
  const addedCss = diffFormatToCss(addedFormat);
  // Track the BLOCK ELEMENT containing the last ref text node we
  // matched an "equal" word in. We capture the block before we
  // `replaceChild` the text node — once replaced, the text node is
  // detached and `parentNode` returns null, so findContainingBlock
  // would no longer work. The block is the anchor for splicing in
  // current's HTML tail so added <li>s/<p>s land as siblings of the
  // matched block rather than as a flat run at the end.
  let lastMatchedRefBlock: Element | null = null;

  for (const tn of textNodes) {
    const tokens = tokenise(tn.textContent ?? "");
    if (tokens.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    // The "buf" accumulates a contiguous run of plain-or-deleted text.
    // bufKind is "plain" when the run carries no styling, "deleted"
    // when it should render as a deleted-span. Equal ref-words flow
    // through as plain.
    let buf = "";
    let bufKind: "plain" | "deleted" = "plain";
    let matchedAnEqualHere = false;

    function flushBuf(): void {
      if (!buf) return;
      if (bufKind === "deleted") {
        const span = doc.createElement("span");
        span.setAttribute("style", deletedCss);
        span.textContent = buf;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(doc.createTextNode(buf));
      }
      buf = "";
      bufKind = "plain";
    }

    function appendAdded(text: string): void {
      flushBuf();
      const span = doc.createElement("span");
      span.setAttribute("style", addedCss);
      // Pad with a space on each side so the added text doesn't
      // visually fuse with the surrounding plain text.
      span.textContent = " " + text + " ";
      fragment.appendChild(span);
    }

    for (const tok of tokens) {
      if (isWhitespace(tok)) {
        // Whitespace flows into the current buf, inheriting whatever
        // kind we're in. Keeps consecutive deleted words visually
        // joined when they sit next to each other in the source.
        buf += tok;
        continue;
      }

      // Non-whitespace word token — drain any pending "add" entries
      // first so the addition appears at the correct position.
      while (entIdx < entries.length && entries[entIdx]!.kind === "add") {
        appendAdded((entries[entIdx] as { kind: "add"; text: string }).text);
        entIdx += 1;
      }

      // Match against the next ref-word.
      const e = entries[entIdx];
      if (e && e.kind === "refWord" && e.word === tok) {
        const targetKind: "plain" | "deleted" =
          e.ref === "equal" ? "plain" : "deleted";
        if (bufKind !== targetKind) flushBuf();
        bufKind = targetKind;
        buf += tok;
        entIdx += 1;
        if (e.ref === "equal") matchedAnEqualHere = true;
      } else {
        // Defensive fallback: token didn't line up with the queue
        // (rare — happens when `bodyToText` and the live DOM disagree
        // on word boundaries, e.g. entity-decoded characters). Render
        // as plain text without consuming an entry.
        if (bufKind !== "plain") flushBuf();
        bufKind = "plain";
        buf += tok;
      }
    }
    flushBuf();
    // Capture the containing block BEFORE we replace tn with the
    // fragment — once replaced, tn is detached from the DOM and
    // `parentNode` walking won't work.
    if (matchedAnEqualHere) {
      lastMatchedRefBlock = findContainingBlock(tn, root);
    }
    tn.parentNode?.replaceChild(fragment, tn);
  }

  // Any "add" entries remaining at the end of the queue come AFTER
  // the last surviving ref word — i.e. trailing additions. Try to
  // splice in current's actual HTML tail (preserving lists, tables,
  // bold etc.) instead of a flat text run. If anything blocks that
  // path (no anchor, parser error, range failure), fall back to the
  // legacy plain-text append.
  const remainingAddTexts: string[] = [];
  while (entIdx < entries.length) {
    const e = entries[entIdx]!;
    if (e.kind === "add") remainingAddTexts.push(e.text);
    entIdx += 1;
  }
  if (remainingAddTexts.length > 0) {
    const splicedOk = trySpliceCurrentTailHtml(
      root,
      doc,
      lastMatchedRefBlock,
      currentHtml,
      segs,
      addedCss,
    );
    if (!splicedOk) {
      const trailing = remainingAddTexts.join(" ");
      const wrap = doc.createElement("span");
      wrap.setAttribute("style", addedCss);
      wrap.textContent = " " + trailing;
      appendToLastBlock(root, wrap);
    }
  }
  return root.innerHTML;
}

/**
 * Try to splice current's HTML tail (the structural content that
 * appears after the last surviving ref word in current) into the
 * reference DOM at the matching position. Returns `true` on success,
 * `false` if any prerequisite is missing — caller falls back to the
 * legacy plain-text trailing-add behaviour.
 *
 * Decision tree
 * -------------
 * 1. Find the BLOCK ELEMENT that contains current's last-matched
 *    word and the BLOCK ELEMENT that contains the first-trailing
 *    word. Same element ⇒ trailing addition is INLINE inside an
 *    existing block (e.g. extra word in a table cell). Return false
 *    so the caller appends as a plain text styled span — preserving
 *    surrounding structure without duplicating the block.
 *
 * 2. Different block ⇒ STRUCTURAL addition (new list items, new
 *    paragraphs, new table rows, etc.). Build a Range starting
 *    BEFORE the first-trailing block element, ending at the end of
 *    current's root, and clone its contents. Apply the `added`
 *    format to text nodes inside.
 *
 * 3. The cloned fragment may carry a redundant outer wrapper that
 *    duplicates ref's structure (e.g. cloning `<li>C</li><li>D</li>`
 *    via Range produces a wrapping `<ul>` because `<ul>` is the
 *    common ancestor). When the fragment's outermost element shares
 *    its tag with ref's containing-block PARENT, unwrap it: use the
 *    children directly so they merge cleanly into ref's existing
 *    `<ul>` / `<table>` / etc. instead of nesting a new one inside.
 *
 * 4. Insert the resulting nodes as siblings AFTER ref's containing
 *    block. So `<ul><li>A</li><li>B</li></ul>` + 3 added `<li>`s
 *    becomes `<ul><li>A</li><li>B</li><li>C</li><li>D</li><li>E</li></ul>`.
 */
function trySpliceCurrentTailHtml(
  refRoot: HTMLElement,
  refDoc: Document,
  lastMatchedRefBlock: Element | null,
  currentHtml: string,
  segs: ReadonlyArray<DiffSegment>,
  addedCss: string,
): boolean {
  if (!lastMatchedRefBlock) return false;
  if (!currentHtml) return false;

  // Identify the start of the trailing added run in `segs`.
  let trailingStartIdx = segs.length;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i]!.kind === "added") {
      trailingStartIdx = i;
    } else {
      break;
    }
  }
  if (trailingStartIdx === segs.length) return false;

  // Count current-side word tokens before the trailing run.
  let curWordCount = 0;
  for (let i = 0; i < trailingStartIdx; i++) {
    const s = segs[i]!;
    if (s.kind === "deleted") continue;
    const m = s.text.match(/\S+/g);
    curWordCount += m ? m.length : 0;
  }
  if (curWordCount === 0) return false; // no last-matched word, can't anchor

  // Parse current's DOM and tokenise it in document order.
  let curDoc: Document;
  try {
    curDoc = new DOMParser().parseFromString(
      `<div>${currentHtml}</div>`,
      "text/html",
    );
  } catch {
    return false;
  }
  const curRoot = curDoc.body.firstElementChild as HTMLElement | null;
  if (!curRoot) return false;
  const curWordTokens = tokenizeDOMWords(curRoot);
  if (curWordCount >= curWordTokens.length) return false;

  const lastMatchedToken = curWordTokens[curWordCount - 1]!;
  const firstTrailingToken = curWordTokens[curWordCount]!;
  const lastMatchedBlock = findContainingBlock(lastMatchedToken.node, curRoot);
  const firstTrailingBlock = findContainingBlock(
    firstTrailingToken.node,
    curRoot,
  );

  // Inline case — trailing addition lives in the same block as the
  // last-matched word (e.g. extra word in a table cell). Let the
  // legacy plain-text fallback append a styled span to ref's
  // containing block; that produces the right visual without
  // duplicating the block.
  if (lastMatchedBlock === firstTrailingBlock) return false;

  // Structural case — start a Range BEFORE the first trailing block
  // so we don't pull in a partial wrapper of the last-matched block.
  const range = curDoc.createRange();
  let fragment: DocumentFragment;
  try {
    range.setStartBefore(firstTrailingBlock);
    range.setEnd(curRoot, curRoot.childNodes.length);
    fragment = range.cloneContents();
  } catch {
    return false;
  }

  // Drop empty whitespace-only text nodes at the start.
  while (
    fragment.firstChild &&
    fragment.firstChild.nodeType === 3 &&
    /^\s*$/.test(fragment.firstChild.textContent ?? "")
  ) {
    fragment.firstChild.remove();
  }
  if (!fragment.firstChild) return false;

  // Build the ref ancestor chain starting at the matched block and
  // climbing toward the root. We use this to figure out HOW DEEP a
  // redundant wrapper in the cloned fragment goes, so we can unwrap
  // the right number of levels before inserting. Indices: [0] is the
  // matched leaf block itself, [N-1] is the outermost element under
  // root.
  const ancestorChain: Element[] = [lastMatchedRefBlock];
  {
    let p: Node | null = lastMatchedRefBlock.parentNode;
    while (p && p !== refRoot) {
      if (p.nodeType === 1) ancestorChain.push(p as Element);
      p = p.parentNode;
    }
  }

  // Walk fragment's outer single-child wrappers and match them
  // against ancestorChain from the OUTERMOST ancestor inward. Each
  // match means the wrapper duplicates an existing ref ancestor and
  // should be hoisted away so the contents merge with ref's
  // structure. Matching at index 0 (the leaf block itself) is
  // SKIPPED — that would mean the fragment is a new peer of the
  // leaf, not a redundant wrapper.
  let fragLevel: ParentNode = fragment;
  let matchedAtLevel = -1; // -1 = no merge; insert as siblings of leaf block
  while (
    fragLevel.children.length === 1 &&
    fragLevel.firstElementChild != null
  ) {
    const wrapper = fragLevel.firstElementChild;
    let candidate = -1;
    for (let i = ancestorChain.length - 1; i > matchedAtLevel; i--) {
      if (ancestorChain[i]!.tagName === wrapper.tagName) {
        candidate = i;
        break;
      }
    }
    if (candidate <= 0) break; // no match, or only matches the leaf block itself
    fragLevel = wrapper;
    matchedAtLevel = candidate;
  }

  // After unwrapping, hoist fragLevel's children up to the fragment
  // root so the rest of the code can iterate `fragment.firstChild`
  // uniformly. Skip if fragLevel is already the fragment root.
  if (fragLevel !== fragment) {
    // Empty existing fragment first (defensive — should already be
    // empty since we descended through single-child wrappers).
    while (fragment.firstChild) fragment.firstChild.remove();
    while (fragLevel.firstChild) {
      fragment.appendChild(fragLevel.firstChild);
    }
  }

  // Drop empty whitespace-only nodes at the start (unwrap may have
  // exposed previously-buried whitespace).
  while (
    fragment.firstChild &&
    fragment.firstChild.nodeType === 3 &&
    /^\s*$/.test(fragment.firstChild.textContent ?? "")
  ) {
    fragment.firstChild.remove();
  }
  if (!fragment.firstChild) return false;

  // Apply the addedCss to text nodes inside the fragment so the
  // user sees the "this is new" colour while keeping the structural
  // tags (li/p/tr/strong/...) untouched.
  applyAddedFormatToFragment(fragment, addedCss, curDoc);

  // Import nodes into the ref document. DOMParser-created nodes
  // belong to a different Document; `importNode` performs the
  // cross-document move safely.
  const importedNodes: Node[] = [];
  while (fragment.firstChild) {
    const node = fragment.firstChild;
    fragment.removeChild(node);
    importedNodes.push(refDoc.importNode(node, true));
  }

  // Insertion point: when we matched an outer ancestor (>=1), the new
  // children become siblings of ancestorChain[matchedAtLevel - 1]
  // (the descendant on the path to the leaf) inside their shared
  // parent ancestorChain[matchedAtLevel]. Otherwise (no merge), they
  // become siblings of the leaf block in its own parent.
  let insertParent: Element;
  let insertAfter: Element;
  if (matchedAtLevel >= 1) {
    insertParent = ancestorChain[matchedAtLevel]!;
    insertAfter = ancestorChain[matchedAtLevel - 1]!;
  } else {
    insertParent = lastMatchedRefBlock.parentElement ?? refRoot;
    insertAfter = lastMatchedRefBlock;
  }
  const after = insertAfter.nextSibling;
  for (const n of importedNodes) {
    if (after) insertParent.insertBefore(n, after);
    else insertParent.appendChild(n);
  }
  return true;
}

/**
 * Walk a fragment's text nodes and wrap each non-whitespace one in a
 * `<span>` with `addedCss`. Empty / whitespace-only text nodes pass
 * through untouched (avoids decorating "between elements" whitespace
 * that exists only for prettyprinting).
 */
function applyAddedFormatToFragment(
  fragment: DocumentFragment,
  addedCss: string,
  doc: Document,
): void {
  const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }
  for (const tn of textNodes) {
    const text = tn.textContent ?? "";
    if (!text || /^\s*$/.test(text)) continue;
    const span = doc.createElement("span");
    span.setAttribute("style", addedCss);
    span.textContent = text;
    tn.parentNode?.replaceChild(span, tn);
  }
}

/** Word-token positions inside a DOM subtree, in document order. */
function tokenizeDOMWords(
  root: Element,
): { word: string; node: Text; start: number; end: number }[] {
  const out: { word: string; node: Text; start: number; end: number }[] = [];
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null = walker.nextNode();
  const re = /\S+/g;
  while (n) {
    const tn = n as Text;
    const text = tn.textContent ?? "";
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        word: m[0],
        node: tn,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    n = walker.nextNode();
  }
  return out;
}

/**
 * Walk up from `node` looking for the closest element whose tag is
 * one of `BLOCK_TAGS`. Falls back to the supplied root when none is
 * found (e.g. content sat directly under root with no wrapper).
 */
function findContainingBlock(node: Node, root: Element): Element {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nodeType === 1 && BLOCK_TAGS.has((cur as Element).tagName)) {
      return cur as Element;
    }
    cur = cur.parentNode;
  }
  return root;
}

/** Append a node to the deepest "block" element inside `root`. */
function appendToLastBlock(root: HTMLElement, child: Node): void {
  function walk(el: Element): Element | null {
    for (let i = el.children.length - 1; i >= 0; i--) {
      const c = el.children[i]!;
      const found = walk(c);
      if (found) return found;
      if (BLOCK_TAGS.has(c.tagName)) return c;
    }
    return null;
  }
  const target = walk(root) ?? root;
  target.appendChild(child);
}

/** Fallback renderer when the reference has no DOM structure at all. */
function renderInlineSegments(
  segs: ReadonlyArray<DiffSegment>,
  addedFormat: DiffFormat,
  deletedFormat: DiffFormat,
): string {
  const inner = segs
    .map((s) => {
      if (s.kind === "equal") return escapeHtml(s.text);
      if (s.kind === "added") {
        return `<span style="${diffFormatToCss(addedFormat)}">${escapeHtml(
          s.text,
        )}</span>`;
      }
      return `<span style="${diffFormatToCss(deletedFormat)}">${escapeHtml(
        s.text,
      )}</span>`;
    })
    .join("");
  return `<p>${inner}</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render `ownHtml`'s structure with words that exist only in
 * `ownHtml` (i.e. not in `otherHtml`) wrapped in `ownOnlyFormat`.
 * Words present in both sides render as plain text. Words only in
 * `otherHtml` are not rendered at all (they don't exist in the
 * structure being walked).
 *
 * Used by the side-by-side preview modal to draw each column with
 * its OWN HTML structure preserved (paragraphs, tables, lists, bold
 * etc.) and only the differing words highlighted on that side.
 *
 * Implementation
 * --------------
 * Same DOM walk as `htmlDiff`, but:
 * - `wordDiff` is run with the OTHER side as `a` and OWN side as
 *   `b`, so segments classify own-only words as `added`.
 * - The entry queue contains only own-side words (skipping the
 *   `deleted` segments that are other-only).
 * - No cross-side text is appended at the end.
 */
export function htmlDiffOneSide(
  ownHtml: string,
  otherHtml: string,
  ownOnlyFormat: DiffFormat,
): string {
  if (!ownHtml) return "";
  const ownText = bodyToText(ownHtml);
  if (!ownText) {
    // own has no text content (e.g. just `<p></p>`). Return an empty
    // string so the caller can render a placeholder.
    return "";
  }
  const otherText = bodyToText(otherHtml);

  // wordDiff(a=other, b=own): "added" segments are own-only; "equal"
  // are present in both; "deleted" are other-only and not in own.
  const segs = wordDiff(otherText, ownText);

  // Queue of own-side words tagged with their kind.
  type OwnEntry = { word: string; ownOnly: boolean };
  const queue: OwnEntry[] = [];
  for (const s of segs) {
    if (s.kind === "deleted") continue; // other-only, not present in own
    for (const tok of tokenise(s.text)) {
      if (isWhitespace(tok)) continue;
      queue.push({ word: tok, ownOnly: s.kind === "added" });
    }
  }

  // Parse the own DOM. Wrap in a div so we can return its innerHTML.
  const doc = new DOMParser().parseFromString(
    `<div>${ownHtml}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) {
    // No DOM structure — wrap own text as a single styled paragraph.
    return `<p><span style="${diffFormatToCss(ownOnlyFormat)}">${escapeHtml(
      ownText,
    )}</span></p>`;
  }

  // Pre-collect all text nodes inside `root`.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let entIdx = 0;
  const ownOnlyCss = diffFormatToCss(ownOnlyFormat);

  for (const tn of textNodes) {
    const tokens = tokenise(tn.textContent ?? "");
    if (tokens.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    let buf = "";
    let bufKind: "plain" | "ownOnly" = "plain";

    function flushBuf(): void {
      if (!buf) return;
      if (bufKind === "ownOnly") {
        const span = doc.createElement("span");
        span.setAttribute("style", ownOnlyCss);
        span.textContent = buf;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(doc.createTextNode(buf));
      }
      buf = "";
      bufKind = "plain";
    }

    for (const tok of tokens) {
      if (isWhitespace(tok)) {
        // Whitespace flows into the current buf, inheriting whatever
        // kind we're in. Keeps consecutive own-only words visually
        // joined with a continuous styling run when they sit together.
        buf += tok;
        continue;
      }
      const e = queue[entIdx];
      if (e && e.word === tok) {
        const target: "plain" | "ownOnly" = e.ownOnly ? "ownOnly" : "plain";
        if (bufKind !== target) flushBuf();
        bufKind = target;
        buf += tok;
        entIdx += 1;
      } else {
        // Defensive fallback — emit as plain text without consuming
        // an entry, same policy as `htmlDiff`.
        if (bufKind !== "plain") flushBuf();
        bufKind = "plain";
        buf += tok;
      }
    }
    flushBuf();
    tn.parentNode?.replaceChild(fragment, tn);
  }

  return root.innerHTML;
}
