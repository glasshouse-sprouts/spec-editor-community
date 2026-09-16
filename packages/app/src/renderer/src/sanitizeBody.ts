/**
 * HTML sanitization fence for Molio 2.0 section bodies.
 *
 * The baseline Molio 2.0 schema allows a narrow subset of HTML inside
 * `body`:
 *   Tags:       p, br, em, strong, ul, ol, li, img, table, thead, tbody,
 *               tfoot, tr, td, th
 *   Attributes: only `src` on `img`
 *
 * Our editor intentionally extends that baseline with four additional
 * tags so the formatting bubble-menu can ship highlight color, text
 * color, strikethrough (6L.1), and underline (6L.1+UL). See
 * `docs/molio-gap-audit.md → "Intentional extensions"` for the full
 * rationale. Added tags:
 *   <mark class="bg-yellow|bg-blue|bg-red|bg-green">
 *   <span class="tc-yellow|tc-blue|tc-red|tc-green">
 *   <s>
 *   <u>
 *
 * The `class` attribute is whitelisted globally but only passes through
 * our value-level filter for `<mark>` and `<span>` — a class with any
 * other value (or on any other tag) gets dropped via DOMPurify's
 * `uponSanitizeAttribute` hook. A plain `<span>` with no class is
 * visually a no-op and we leave it alone rather than try to unwrap it
 * mid-sanitize (that's fragile and unnecessary — it's valid HTML).
 *
 * 6L.4 introduced one more narrow exception: `data-width` on `<td>` /
 * `<th>` stores the persisted column width as a plain number string
 * (e.g. `data-width="120"`). The value must be all-digits; anything
 * else is stripped. We use a data-* attribute deliberately so the
 * sanitizer's rule "no inline style, ever" stays categorically true.
 *
 * 6L.5a extends the `<img>` rule. The baseline permitted `src` with any
 * value; we now enforce three things:
 *
 *   - `src` must be a `data:image/(png|jpeg|gif|webp)` URL. `http(s):`,
 *     `file:`, `javascript:`, and `data:image/svg+xml` are all rejected
 *     (SVG is scriptable XML and must never pass through an `<img>`
 *     whitelist). The value-level check calls
 *     `isAllowedImageDataUrl` from imageProcess.ts.
 *   - `width` is allowed but only as an integer pixel value (1–4 digits
 *     — captures everything up to `9999` which is well beyond a real
 *     content column). Non-digit values ("100px", "auto", "50%") are
 *     stripped. Height is derived from aspect at render time, so we
 *     don't persist it.
 *   - `alt` is allowed and passes through untouched (accessibility +
 *     PDF alt-text fallback). The tag attribute hook still strips event
 *     handlers like `onerror` via DOMPurify's default rules.
 *
 * An `<img>` whose `src` is rejected gets the entire `src` attribute
 * stripped. DOMPurify then sees an `<img>` with no `src` and keeps the
 * empty tag — the UI renders a broken-image icon, which is visible
 * enough that the user can fix it. We considered removing the tag
 * entirely but that would silently lose data when a legacy file has
 * an http:// image in it.
 *
 * 6L.2 adds `<a href="...">` for external links. The scheme whitelist
 * allows `http:`, `https:` and `mailto:` only — every other scheme is
 * rejected (`javascript:`, `data:`, `file:`, `vbscript:`, relative
 * paths, bare strings …). An `<a>` whose `href` is rejected loses the
 * attribute and the link becomes inert (the text still shows). No
 * other attributes (`target`, `rel`, `onclick`, …) are allowed. We
 * don't add `rel="noopener"` ourselves because there's no `target`
 * to pair it with — PDF viewers open links in a new app anyway, and
 * the in-editor click is suppressed by the TipTap Link extension's
 * `openOnClick: false`.
 *
 * Everything else gets stripped. This runs in two places:
 *
 *   1. On every incoming body from the file (once at load), so what the
 *      user sees is what would be saved — no last-second surprises.
 *   2. On every patched body before it's sent to the main process on
 *      save. This is the hard fence; TipTap's schema is supposed to
 *      prevent disallowed nodes, but paste-from-Word etc. can still
 *      smuggle things through.
 *
 * DOMPurify runs in the renderer (we have a real DOM) and in jsdom tests.
 */

import DOMPurify from "dompurify";

import { isAllowedImageDataUrl } from "./imageProcess.js";

/**
 * The complete list of allowed tags. Exported so the TipTap schema can
 * be aligned with the sanitizer and both stay in sync from one source of
 * truth.
 */
export const MOLIO_ALLOWED_TAGS: readonly string[] = Object.freeze([
  "p",
  "br",
  "em",
  "strong",
  "ul",
  "ol",
  "li",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  // 6L.1 intentional extensions:
  "mark",
  "span",
  "s",
  // UL slice: underline. Same rationale as <s> — common formatting
  // affordance users expect even though it's not in the baseline
  // Molio schema. html-to-pdfmake maps <u> to pdfmake's
  // `decoration: "underline"` natively, so PDFs render correctly.
  "u",
  // 6L.2: external URL links.
  "a",
]);

/**
 * Attributes allowed. Most are only meaningful on specific tags; value-
 * level enforcement happens in the `uponSanitizeAttribute` hook below.
 *   - `src` → only on `<img>`, value must pass `isAllowedImageDataUrl`.
 *   - `class` → only on `<mark>` / `<span>` with a fixed value set.
 *   - `data-width` → only on `<td>` / `<th>`, digits only.
 *   - `width` → only on `<img>` (6L.5a persisted display width), digits only.
 *   - `alt` → only on `<img>` (accessibility + PDF fallback). Passes
 *     through unchanged.
 *   - `href` → only on `<a>` (6L.2), scheme whitelist http/https/mailto.
 */
export const MOLIO_ALLOWED_ATTRS: readonly string[] = Object.freeze([
  "src",
  "class",
  // 6L.4: column-width persistence for tables (see sanitize hook for
  // value-level validation — digits only, only on <td>/<th>).
  "data-width",
  // 6L.5a: inline image attributes (see sanitize hook for value-level
  // validation).
  "width",
  "alt",
  // 6L.2: external URL links.
  "href",
]);

/**
 * Whitelisted class values, by tag. The sanitizer rejects any class
 * string that doesn't appear here verbatim. Keeping this set small and
 * explicit is the whole point — anything outside these eight values
 * (4 highlight backgrounds + 4 text colors) gets dropped.
 */
const ALLOWED_CLASSES_BY_TAG: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    mark: Object.freeze(["bg-yellow", "bg-blue", "bg-red", "bg-green"]),
    span: Object.freeze(["tc-yellow", "tc-blue", "tc-red", "tc-green"]),
  });

/**
 * Sanitize one section body.
 *
 * Returns the cleaned HTML. Empty/whitespace-only bodies are preserved
 * as-is (we don't synthesise `<p></p>`) so the round-trip for untouched
 * sections stays byte-equal.
 */
export function sanitizeBody(html: string): string {
  if (html === "" || html == null) return html ?? "";

  // DOMPurify hook — runs per attribute. Responsibilities:
  //   1. `class` — only on <mark>/<span>, only 8 whitelisted values.
  //   2. `data-width` — only on <td>/<th>, digits only (1-4 digit
  //      range is enough for column widths in pixels).
  //   3. `src` — only on <img>, only `data:image/(png|jpeg|gif|webp)`.
  //      Rejects http(s), file:, javascript:, data:image/svg+xml, etc.
  //   4. `width` — only on <img>, digits only (6L.5a display width).
  //      `height` is NOT allowed — aspect ratio is preserved at render.
  //   5. `alt` — only on <img>, passes through unchanged.
  const TABLE_CELL_TAGS = new Set(["td", "th"]);
  const DATA_WIDTH_RE = /^\d{1,4}$/;
  const IMG_WIDTH_RE = /^\d{1,4}$/;
  // 6L.2: only http, https, mailto are allowed on <a href>. The leading
  // `^` anchor + the literal colon after the scheme name block are the
  // important bits — `https:evil` style strings still need a colon, and
  // we don't try to parse the rest of the URL (browsers / the PDF viewer
  // do that). Case-insensitive because HTML attribute values are
  // case-insensitive for scheme names per RFC 3986.
  const ALLOWED_HREF_SCHEME_RE = /^(?:https?|mailto):/i;
  const attrHook: (
    node: Element,
    data: { attrName: string; attrValue: string; keepAttr: boolean },
  ) => void = (node, data) => {
    const tag = node.tagName.toLowerCase();
    if (data.attrName === "class") {
      const allowed = ALLOWED_CLASSES_BY_TAG[tag];
      if (!allowed || !allowed.includes(data.attrValue)) {
        data.keepAttr = false;
      }
      return;
    }
    if (data.attrName === "data-width") {
      if (!TABLE_CELL_TAGS.has(tag) || !DATA_WIDTH_RE.test(data.attrValue)) {
        data.keepAttr = false;
      }
      return;
    }
    if (data.attrName === "src") {
      // `src` only makes sense on <img>. Reject anywhere else.
      if (tag !== "img") {
        data.keepAttr = false;
        return;
      }
      // Then enforce the data-URL scheme check from imageProcess.
      if (!isAllowedImageDataUrl(data.attrValue)) {
        data.keepAttr = false;
      }
      return;
    }
    if (data.attrName === "width") {
      if (tag !== "img" || !IMG_WIDTH_RE.test(data.attrValue)) {
        data.keepAttr = false;
      }
      return;
    }
    if (data.attrName === "alt") {
      if (tag !== "img") {
        data.keepAttr = false;
      }
      // otherwise pass through unchanged.
      return;
    }
    if (data.attrName === "href") {
      // `href` is only meaningful on `<a>`. Reject everywhere else.
      if (tag !== "a") {
        data.keepAttr = false;
        return;
      }
      // Trim leading whitespace (and tab/newline, which browsers ignore
      // but attackers occasionally use to slip past naive regex checks).
      const trimmed = data.attrValue.replace(/^[\s\u0000]+/, "");
      if (!ALLOWED_HREF_SCHEME_RE.test(trimmed)) {
        data.keepAttr = false;
      }
      return;
    }
  };

  DOMPurify.addHook("uponSanitizeAttribute", attrHook);
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...MOLIO_ALLOWED_TAGS],
      ALLOWED_ATTR: [...MOLIO_ALLOWED_ATTRS],
      // Keep text content when a tag is stripped rather than dropping the
      // whole subtree. Example: `<div>Hello</div>` → `Hello` instead of ``.
      KEEP_CONTENT: true,
      // We don't need CSS/SVG here; Molio's whitelist has no room for them.
      FORBID_TAGS: ["style", "script"],
      // Explicitly turn off the "allow any data-* attribute" default —
      // we only want `data-width`, and only on <td>/<th> (enforced by
      // the attribute hook above).
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}
