/**
 * XML escaping for OOXML output.
 *
 * Word's document.xml uses XML 1.0. We need to escape exactly the five
 * predefined entities — anything else (curly quotes, em dashes, etc.)
 * is fine to pass through verbatim because we always emit UTF-8.
 *
 * Two variants because attribute values need one more escape than
 * text content does (the double-quote character).
 */

/**
 * Escape user-supplied text for placement inside a `<w:t>...</w:t>`
 * element. Only `&`, `<`, `>` are strictly required (XML treats the
 * single and double quote inside text as literal). Escaping `>` is
 * cheap insurance against tooling that mis-parses `]]>` sequences.
 */
export function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape user-supplied text for placement inside an XML attribute
 * value enclosed in double quotes (the only quoting style we use).
 */
export function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
