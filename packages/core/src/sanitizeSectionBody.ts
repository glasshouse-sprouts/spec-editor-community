/**
 * Allowlist sanitizer for section bodies, without a DOM (Task 105).
 *
 * Why core sanitizes too
 * ----------------------
 * The editor sanitizes in the renderer with DOMPurify. The MCP server
 * writes bodies through `applyEdits` without passing the renderer, so
 * an AI (for example one steered by a prompt injection in a document
 * it read) could put `<script>` or an `onerror=` handler into the
 * user's `.moliospec`. Our own editor would clean it up on load, but
 * the file is an exchange format: Molio's tools and other editors read
 * it too. `applyEdits` now runs every body through this function.
 *
 * Core has no DOM, so this is a small HTML tokenizer rather than
 * DOMPurify. It does not build a tree. It walks the string once and
 * keeps only what the allowlist in `sectionBodyAllowlist.ts` permits:
 *
 *   - allowed tags, with allowed attributes whose values pass the
 *     same checks the renderer uses;
 *   - other tags are dropped and their text kept, like DOMPurify's
 *     KEEP_CONTENT;
 *   - script, style, svg, math, iframe, template and the rest of
 *     DOMPurify's FORBID_CONTENTS are dropped with everything inside;
 *   - comments, doctypes and processing instructions are dropped;
 *   - a `<` that does not start a tag is written as `&lt;`;
 *   - Molio's `<specialchar>X</specialchar>` becomes the Unicode
 *     symbol it stands for, before anything else (card 195).
 *
 * Safety does not depend on balanced tags: none of the allowed tags
 * switches the HTML parser into a raw-text mode, every `<` in text is
 * escaped, and every attribute value is written double-quoted. Clean
 * input (what the editor writes) comes back unchanged, and the
 * function is idempotent.
 */

import {
  SECTION_BODY_ALLOWED_TAGS,
  isAllowedAttribute,
} from "./sectionBodyAllowlist.js";
import { translateSymbolFontChars } from "./symbolFontChars.js";

const ALLOWED = new Set(SECTION_BODY_ALLOWED_TAGS);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/** Content is raw text up to `</name`: never parsed as markup. */
const RAW_TEXT = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "textarea",
  "title",
]);
/** DOMPurify's default FORBID_CONTENTS, minus `thead` (allowed here). */
const DROP_WITH_CONTENT = new Set([
  "annotation-xml",
  "audio",
  "colgroup",
  "desc",
  "foreignobject",
  "head",
  "iframe",
  "math",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "svg",
  "template",
  "title",
  "video",
  "xmp",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  colon: ":",
  tab: "\t",
  newline: "\n",
};

/**
 * Decode the entities that matter for checking a URL. Unknown named
 * entities stay as written, which can only make an allowlist check
 * fail - never pass.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi,
    (whole, ref: string) => {
      if (ref[0] === "#") {
        const hex = ref[1] === "x" || ref[1] === "X";
        const code = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      if (!whole.endsWith(";")) return whole;
      return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
    },
  );
}

const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quoteAttr = (raw: string) => raw.replace(/"/g, "&quot;");

interface Tag {
  name: string;
  attrs: Array<[string, string]>;
  selfClosing: boolean;
  /** Index just past the closing `>`. */
  end: number;
}

/** Read a start tag whose name begins at `i` (just after `<`). */
function readStartTag(html: string, i: number): Tag | null {
  let j = i;
  while (j < html.length && !/[\s/>]/.test(html[j]!)) j++;
  const name = html.slice(i, j).toLowerCase();
  const attrs: Array<[string, string]> = [];
  const seen = new Set<string>();
  let selfClosing = false;
  while (j < html.length) {
    const ch = html[j]!;
    if (ch === ">") return { name, attrs, selfClosing, end: j + 1 };
    if (/\s/.test(ch)) {
      j++;
      continue;
    }
    if (ch === "/") {
      selfClosing = true;
      j++;
      continue;
    }
    selfClosing = false;
    let k = j + 1; // an attribute name may start with "=" (spec quirk)
    while (k < html.length && !/[\s/>=]/.test(html[k]!)) k++;
    const attrName = html.slice(j, k).toLowerCase();
    while (k < html.length && /\s/.test(html[k]!)) k++;
    let value = "";
    if (html[k] === "=") {
      k++;
      while (k < html.length && /\s/.test(html[k]!)) k++;
      const q = html[k];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, k + 1);
        if (close === -1) return null;
        value = html.slice(k + 1, close);
        k = close + 1;
      } else {
        const start = k;
        while (k < html.length && !/[\s>]/.test(html[k]!)) k++;
        value = html.slice(start, k);
      }
    }
    if (!seen.has(attrName)) {
      seen.add(attrName);
      attrs.push([attrName, value]);
    }
    j = k;
  }
  return null; // EOF inside a tag: the browser drops it too
}

function renderStartTag(tag: Tag): string {
  let out = `<${tag.name}`;
  for (const [name, raw] of tag.attrs) {
    if (isAllowedAttribute(tag.name, name, decodeEntities(raw))) {
      out += ` ${name}="${quoteAttr(raw)}"`;
    }
  }
  return `${out}>`;
}

/** Index just past the `>` that ends a bogus comment, or EOF. */
const skipTo = (html: string, from: number, needle: string) => {
  const at = html.indexOf(needle, from);
  return at === -1 ? html.length : at + needle.length;
};

/**
 * Sanitize one section body. Empty input comes back as it was. Molio's
 * `<specialchar>` is translated to its Unicode character first (card
 * 195, `symbolFontChars.ts`), so the allowlist never drops its meaning.
 */
export function sanitizeSectionBody(input: string): string {
  if (!input) return input ?? "";
  const html = translateSymbolFontChars(input);
  let out = "";
  let i = 0;
  /** Names of open elements whose whole content is being dropped. */
  const dropping: string[] = [];
  const emitText = (s: string) => {
    if (dropping.length === 0) out += escapeText(s);
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emitText(html.slice(i));
      break;
    }
    emitText(html.slice(i, lt));
    const next = html[lt + 1] ?? "";

    if (html.startsWith("<!--", lt)) {
      const quick =
        html.startsWith("<!-->", lt) || html.startsWith("<!--->", lt);
      i = quick ? skipTo(html, lt, ">") : skipTo(html, lt + 4, "-->");
      continue;
    }
    if (next === "!" || next === "?") {
      i = skipTo(html, lt + 2, ">");
      continue;
    }
    if (next === "/") {
      const after = html[lt + 2] ?? "";
      if (!/[a-z]/i.test(after)) {
        i = skipTo(html, lt + 2, ">"); // "</>" or a bogus comment
        continue;
      }
      let j = lt + 2;
      while (j < html.length && !/[\s/>]/.test(html[j]!)) j++;
      const name = html.slice(lt + 2, j).toLowerCase();
      i = skipTo(html, j, ">");
      if (dropping.length > 0) {
        if (dropping[dropping.length - 1] === name) dropping.pop();
      } else if (ALLOWED.has(name) && !VOID.has(name)) {
        out += `</${name}>`;
      }
      continue;
    }
    if (!/[a-z]/i.test(next)) {
      emitText("<");
      i = lt + 1;
      continue;
    }

    const tag = readStartTag(html, lt + 1);
    if (!tag) break;
    i = tag.end;

    if (RAW_TEXT.has(tag.name) || tag.name === "plaintext") {
      // Find the matching end tag; its content is never markup.
      const closeRe = new RegExp(`</${tag.name}[\\s/>]`, "i");
      const m = tag.name === "plaintext" ? null : closeRe.exec(html.slice(i));
      const contentEnd = m ? i + m.index : html.length;
      if (!DROP_WITH_CONTENT.has(tag.name)) emitText(html.slice(i, contentEnd));
      i = m ? skipTo(html, contentEnd, ">") : html.length;
      continue;
    }
    if (dropping.length > 0) {
      if (tag.name === dropping[dropping.length - 1] && !tag.selfClosing) {
        dropping.push(tag.name);
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.selfClosing && !VOID.has(tag.name)) dropping.push(tag.name);
      continue;
    }
    if (ALLOWED.has(tag.name)) out += renderStartTag(tag);
  }
  return out;
}
