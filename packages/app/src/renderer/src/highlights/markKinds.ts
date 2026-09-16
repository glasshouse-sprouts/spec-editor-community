/**
 * Stable identifiers for the eight 6L.1 formatting marks the editor
 * lets users apply: four highlight backgrounds (`<mark class="bg-…">`)
 * and four text colors (`<span class="tc-…">`). The same eight
 * strings appear in `sanitizeBody.ts`'s class allowlist and in
 * `pdf/renderPdf.ts`'s pdfmake style map — keep this file in sync if
 * the palette ever grows.
 *
 * Slice "Highlights & formatting" — used by the inspection modal,
 * the Export options modal, and the strip helper.
 */

/** Discriminator for which kind of mark a user run carries. */
export type MarkKind =
  | "bg-yellow"
  | "bg-blue"
  | "bg-red"
  | "bg-green"
  | "tc-yellow"
  | "tc-blue"
  | "tc-red"
  | "tc-green";

/** All eight mark kinds in display order (backgrounds first, then text). */
export const ALL_MARK_KINDS: readonly MarkKind[] = [
  "bg-yellow",
  "bg-blue",
  "bg-red",
  "bg-green",
  "tc-yellow",
  "tc-blue",
  "tc-red",
  "tc-green",
] as const;

/** Just the four background kinds. */
export const BG_MARK_KINDS: readonly MarkKind[] = [
  "bg-yellow",
  "bg-blue",
  "bg-red",
  "bg-green",
] as const;

/** Just the four text-color kinds. */
export const TC_MARK_KINDS: readonly MarkKind[] = [
  "tc-yellow",
  "tc-blue",
  "tc-red",
  "tc-green",
] as const;

/**
 * Whether a given mark kind paints a background or the text.
 * Used by the modal grouping + the export-options sections.
 */
export function isBackgroundMark(k: MarkKind): boolean {
  return k.startsWith("bg-");
}

/** Pull the colour token (yellow / blue / red / green) out of a mark kind. */
export function colorOf(k: MarkKind): "yellow" | "blue" | "red" | "green" {
  return k.slice(3) as "yellow" | "blue" | "red" | "green";
}
