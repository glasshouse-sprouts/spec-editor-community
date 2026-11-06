/**
 * Molio's `<specialchar>` tag, translated to Unicode (card 195).
 *
 * Molio's content marks a character from the Symbol font with
 * `<specialchar>X</specialchar>`: `<specialchar>m</specialchar>m` means
 * "µm", `<specialchar>l</specialchar>` means "λ". The tag is not on the
 * allowlist, so the sanitizers dropped it and kept the letter - "µm"
 * became "mm", a factor of 1000 in a contract document, with nothing
 * on screen to show it. This runs first in every sanitize, so the tag
 * is gone (and its meaning kept) before the allowlist sees it.
 *
 * Found on 2026-11-03 in Molio's files (card 195 has the table):
 * e, l, m and h, `&lambda;` (already the right character) and empty
 * tags, written as `specialchar` or `specialChar`.
 *
 * The rule, per tag:
 *   - empty: removed (nothing was visible);
 *   - one character in SYMBOL_FONT_CHARS: that Unicode character;
 *   - already a symbol (one non-ASCII character, or one entity such as
 *     `&lambda;`): kept as written;
 *   - anything else: kept, followed by a visible "[?]", so an unknown
 *     symbol is never silently read as a plain letter.
 *
 * The output holds no `<specialchar>`, so running it twice changes
 * nothing more. Pure, no DOM.
 *
 * This file exists twice, word for word, because the renderer may not
 * import core: `packages/core/src/symbolFontChars.ts` and
 * `packages/app/src/renderer/src/symbolFontChars.ts`. The parity test
 * `packages/app/test/sectionBodyAllowlistParity.test.ts` runs both
 * sanitizers over every printable ASCII character in the tag.
 */

/**
 * The letters of Adobe's Symbol font encoding, as Unicode. Three
 * deliberate differences from Adobe's own table:
 *   - "m" is MICRO SIGN (U+00B5), not GREEK SMALL LETTER MU (U+03BC).
 *     Every "m" in Molio's files is the micro prefix of a unit ("µm"),
 *     µ in units is usually written as U+00B5 (it is the character on
 *     a Danish keyboard, so it is what a user searches for), and it is
 *     in every Latin-1 font.
 *   - "D" and "W" are the Greek capitals Δ (U+0394) and Ω (U+03A9),
 *     not INCREMENT and OHM SIGN, which Unicode treats as variants.
 */
export const SYMBOL_FONT_CHARS: Readonly<Record<string, string>> =
  Object.freeze({
    a: "α",
    b: "β",
    c: "χ",
    d: "δ",
    e: "ε",
    f: "φ",
    g: "γ",
    h: "η",
    i: "ι",
    j: "ϕ",
    k: "κ",
    l: "λ",
    m: "\u00b5", // MICRO SIGN; see above
    n: "ν",
    o: "ο",
    p: "π",
    q: "θ",
    r: "ρ",
    s: "σ",
    t: "τ",
    u: "υ",
    v: "ϖ",
    w: "ω",
    x: "ξ",
    y: "ψ",
    z: "ζ",
    A: "Α",
    B: "Β",
    C: "Χ",
    D: "Δ",
    E: "Ε",
    F: "Φ",
    G: "Γ",
    H: "Η",
    I: "Ι",
    J: "ϑ",
    K: "Κ",
    L: "Λ",
    M: "Μ",
    N: "Ν",
    O: "Ο",
    P: "Π",
    Q: "Θ",
    R: "Ρ",
    S: "Σ",
    T: "Τ",
    U: "Υ",
    V: "ς",
    W: "Ω",
    X: "Ξ",
    Y: "Ψ",
    Z: "Ζ",
  });

/** Shown after a symbol we cannot translate. */
export const UNKNOWN_SYMBOL_MARK = "[?]";

const SPECIALCHAR = /<specialchar\b[^>]*>([\s\S]*?)<\/specialchar\s*>/gi;
const ONE_ENTITY = /^&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);$/i;

function translateOne(inner: string): string {
  if (inner === "") return "";
  const mapped = SYMBOL_FONT_CHARS[inner];
  if (mapped !== undefined) return mapped;
  const oneNonAscii = [...inner].length === 1 && inner.codePointAt(0)! > 0x7f;
  if (oneNonAscii || ONE_ENTITY.test(inner)) return inner;
  return inner + UNKNOWN_SYMBOL_MARK;
}

/** Replace every `<specialchar>…</specialchar>` in `html`. */
export function translateSymbolFontChars(html: string): string {
  return html.replace(SPECIALCHAR, (_whole, inner: string) =>
    translateOne(inner),
  );
}
