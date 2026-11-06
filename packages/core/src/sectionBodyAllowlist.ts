/**
 * What a section body may contain, for the core-side sanitizer
 * (Task 105, `sanitizeSectionBody.ts`).
 *
 * This is a copy of the renderer's rules in
 * `packages/app/src/renderer/src/sanitizeBody.ts`: the same tags, the
 * same attributes, the same value checks. The renderer cannot import
 * core (it ships as a browser bundle), so the list lives twice. The
 * parity test `packages/app/test/sectionBodyAllowlistParity.test.ts`
 * fails if the two drift apart.
 */

/** Allowed tags. Same order as the renderer's `MOLIO_ALLOWED_TAGS`. */
export const SECTION_BODY_ALLOWED_TAGS: readonly string[] = Object.freeze([
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
  "mark",
  "span",
  "s",
  "u",
  "a",
  // Task 138
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "b",
  "i",
  "sub",
  "sup",
]);

/** Allowed attributes. Same as the renderer's `MOLIO_ALLOWED_ATTRS`. */
export const SECTION_BODY_ALLOWED_ATTRS: readonly string[] = Object.freeze([
  "src",
  "class",
  "data-width",
  "width",
  "alt",
  "href",
]);

/**
 * Longest body `applyEdits` accepts, in characters (Task 105).
 *
 * Real bodies are small: plain text stays under 2 KB in Molio's own
 * example projects, and the largest body there is 350 KB, from one
 * inline image. The editor accepts images up to 5 MB, which is about
 * 6.7 MB as base64. 20 MiB leaves room for three such images in one
 * section, and still stops a runaway or hostile write long before it
 * bloats the user's file.
 */
export const SECTION_BODY_MAX_LENGTH = 20 * 1024 * 1024;

/**
 * The formatting classes a body may carry, per tag: highlights on
 * <mark>, text colours on <span>. Exported so the MCP server's
 * edit_section_body description is built from it (Task 149).
 */
export const ALLOWED_CLASSES_BY_TAG: Readonly<
  Record<string, readonly string[]>
> = {
  mark: ["bg-yellow", "bg-blue", "bg-red", "bg-green"],
  span: ["tc-yellow", "tc-blue", "tc-red", "tc-green"],
};
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const DIGITS_1_TO_4 = /^\d{1,4}$/;
const ALLOWED_HREF_SCHEME = /^(?:https?|mailto):/i;

/** Same rule as the renderer's `isAllowedImageDataUrl`. */
function isAllowedImageDataUrl(src: string): boolean {
  if (!src.startsWith("data:")) return false;
  const rest = src.slice(5);
  const end = rest.search(/[,;]/);
  if (end === -1) return false;
  return IMAGE_MIMES.includes(rest.slice(0, end).toLowerCase());
}

/**
 * May `tag` keep attribute `name` with this (entity-decoded) value?
 * Mirrors the renderer's `uponSanitizeAttribute` hook.
 */
export function isAllowedAttribute(
  tag: string,
  name: string,
  value: string,
): boolean {
  switch (name) {
    case "class":
      return ALLOWED_CLASSES_BY_TAG[tag]?.includes(value) ?? false;
    case "data-width":
      return (tag === "td" || tag === "th") && DIGITS_1_TO_4.test(value);
    case "src":
      return tag === "img" && isAllowedImageDataUrl(value);
    case "width":
      return tag === "img" && DIGITS_1_TO_4.test(value);
    case "alt":
      return tag === "img";
    case "href":
      return (
        tag === "a" &&
        ALLOWED_HREF_SCHEME.test(value.replace(/^[\s\u0000]+/, ""))
      );
    default:
      return false;
  }
}
