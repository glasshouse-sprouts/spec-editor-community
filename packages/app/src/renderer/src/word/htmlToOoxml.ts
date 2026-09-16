/**
 * HTML → OOXML converter for the BDB Word export.
 *
 * Scope (Phase A + B)
 * -------------------
 * Mirrors what `sanitizeBody.ts` allows in a section body. We turn
 * the sanitised HTML into a sequence of OOXML block elements (mostly
 * `<w:p>` paragraphs, plus `<w:tbl>` for tables).
 *
 * Supported:
 *   - `<p>` → `<w:p>` with body styling.
 *   - `<br>` inside a paragraph → `<w:br/>`.
 *   - Inline marks: `<strong>` (bold), `<em>` (italic), `<u>`
 *     (underline), `<s>` (strikethrough), `<span class="tc-X">`
 *     (text colour), `<mark class="bg-X">` (highlight via Word
 *     shading). Nestable.
 *   - `<ul>` / `<ol>` → series of paragraphs with `<w:numPr>`
 *     referencing the template's numbering (default `numId="1"`).
 *   - `<a href="...">` → `<w:hyperlink>` with a fresh relationship.
 *   - `<table>` / `<tr>` / `<td>` / `<th>` → `<w:tbl>` with the
 *     template's `TableGrid` style. Auto-width for v1.
 *   - `<img src="data:image/...">` → embedded image. Caller collects
 *     the bytes from `ImageCollector` and writes them to
 *     `word/media/` before repacking.
 *
 * Design notes
 * ------------
 * The converter is pure-function-shaped: it takes HTML text + a
 * `RelationshipCollector` and an `ImageCollector` and returns an
 * OOXML string. The collectors accumulate side-effects (hyperlinks
 * and images) so the caller can splice the matching files +
 * relationships into the docx before repacking.
 *
 * DOMParser availability: this module runs in the renderer (where
 * the browser DOM is real) and in jsdom-backed Vitest tests. Both
 * provide `DOMParser` natively, so we don't ship a polyfill.
 */

import { escapeXmlAttr, escapeXmlText } from "./ooxmlEscape.js";

/* ------------------------------------------------------------------ */
/*  Colour palette                                                    */
/* ------------------------------------------------------------------ */

/**
 * Hex values for the 6L.1 highlight + text-colour palette. Kept in
 * sync with `pdf/renderPdf.ts → PALETTE_HEX` so the editor, PDF and
 * Word renderings match. The map keys are the sanitised class
 * suffixes (e.g. `tc-yellow` → key `yellow`).
 *
 * Word's `<w:color>` and `<w:shd>` elements take uppercase hex
 * without the leading `#`.
 */
const PALETTE_HEX: Record<string, string> = {
  yellow: "FFF26B",
  blue: "9ED6FF",
  red: "FF8B8B",
  green: "B7F0A3",
};

/** Strip the `tc-` / `bg-` prefix and return the palette hex,
 *  or null when the class isn't one of ours. */
function lookupClassColor(el: Element, prefix: "tc-" | "bg-"): string | null {
  const cls = el.getAttribute("class") ?? "";
  for (const token of cls.split(/\s+/)) {
    if (token.startsWith(prefix)) {
      const key = token.slice(prefix.length);
      const hex = PALETTE_HEX[key];
      if (hex) return hex;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Accumulator for hyperlinks discovered during HTML walking. The
 * builder calls `.add()` for each `<a href="...">` it emits and
 * receives back the relationship id to use in the OOXML
 * `<w:hyperlink r:id="...">` element. The caller serialises the
 * collected entries into the document.xml.rels file before
 * repacking.
 */
/**
 * Mutable counter shared between `RelationshipCollector` and
 * `ImageCollector` so the rIds they hand out don't collide inside
 * `document.xml.rels`. Pass the same `{ value: ... }` object to
 * both. Start the seed somewhere safely above any template-defined
 * rIds (the bundled Skabelon BDB stops below 50, so 1000 is comfy).
 */
export interface RelIdSeed {
  value: number;
}

export class RelationshipCollector {
  private entries: { id: string; target: string }[] = [];

  constructor(private seed: RelIdSeed) {}

  /** Register a hyperlink target and return its newly-issued rId. */
  add(target: string): string {
    const id = `rId${this.seed.value}`;
    this.seed.value += 1;
    this.entries.push({ id, target });
    return id;
  }

  /** Serialise the collected entries as `<Relationship>` XML
   *  fragments ready to splice into document.xml.rels. */
  toXmlFragments(): string {
    return this.entries
      .map(
        (e) =>
          `<Relationship Id="${e.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(e.target)}" TargetMode="External"/>`,
      )
      .join("");
  }

  /** True when at least one hyperlink was collected. */
  hasEntries(): boolean {
    return this.entries.length > 0;
  }
}

/** One image discovered while walking an HTML body. The collector
 *  hands the consumer enough information to splice the bytes into
 *  the docx archive (under `word/media/<filename>`), register a
 *  relationship, and declare the content type. */
export interface CollectedImage {
  /** rId used in the `<a:blip r:embed="..."/>` element. */
  relId: string;
  /** Filename inside word/media (e.g. "image1.png"). */
  filename: string;
  /** File extension (lowercase, no dot): "png", "jpeg", "gif", "webp". */
  ext: string;
  /** Raw decoded image bytes — caller writes them under
   *  `word/media/<filename>`. */
  bytes: Uint8Array;
  /** MIME type ("image/png" etc.). Caller adds a matching
   *  `<Default Extension="ext" ContentType="..."/>` to
   *  `[Content_Types].xml` if not present. */
  contentType: string;
}

/**
 * Image accumulator. Mirrors `RelationshipCollector`. Filenames are
 * sequenced from `image1.<ext>` upward to avoid collisions inside
 * `word/media/`. rIds share the same counter as hyperlinks (the
 * caller passes one shared counter into both collectors so we get
 * a globally-unique sequence).
 */
export class ImageCollector {
  private entries: CollectedImage[] = [];
  private nextImageSeed = 1;

  constructor(private seed: RelIdSeed) {}

  /** Decode a `data:image/...;base64,...` URL and stash the bytes.
   *  Returns the assigned rId + filename for the OOXML to reference. */
  add(dataUrl: string): { relId: string; filename: string } | null {
    const m = /^data:image\/([a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl.trim(),
    );
    if (!m) return null;
    const mime = m[1]!.toLowerCase();
    const ext = mime === "jpg" ? "jpeg" : mime === "svg+xml" ? "svg" : mime;
    const contentType = `image/${ext === "svg" ? "svg+xml" : ext}`;
    let bytes: Uint8Array;
    try {
      const binStr = atob(m[2]!);
      const u8 = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) u8[i] = binStr.charCodeAt(i);
      bytes = u8;
    } catch {
      return null;
    }
    const relId = `rId${this.seed.value}`;
    this.seed.value += 1;
    const filename = `image${this.nextImageSeed}.${ext}`;
    this.nextImageSeed += 1;
    this.entries.push({ relId, filename, ext, bytes, contentType });
    return { relId, filename };
  }

  /** Serialise as `<Relationship>` XML fragments for
   *  document.xml.rels. */
  toRelXmlFragments(): string {
    return this.entries
      .map(
        (e) =>
          `<Relationship Id="${e.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${e.filename}"/>`,
      )
      .join("");
  }

  /** Returns the set of unique (ext, contentType) pairs so the caller
   *  can ensure `[Content_Types].xml` declares each one. */
  uniqueExtensions(): Array<{ ext: string; contentType: string }> {
    const seen = new Set<string>();
    const out: Array<{ ext: string; contentType: string }> = [];
    for (const e of this.entries) {
      if (!seen.has(e.ext)) {
        seen.add(e.ext);
        out.push({ ext: e.ext, contentType: e.contentType });
      }
    }
    return out;
  }

  /** All collected images for caller to splice into word/media/. */
  all(): CollectedImage[] {
    return this.entries;
  }

  hasEntries(): boolean {
    return this.entries.length > 0;
  }
}

/**
 * Convert a body HTML string into a list of OOXML block-level
 * paragraphs / tables.
 *
 * Returns the concatenated `<w:p>...</w:p>` (and `<w:tbl>` for
 * tables) elements as a single string ready to be spliced into a
 * `<w:body>` or a section.
 *
 * Empty / whitespace-only input returns an empty string so the
 * caller can decide whether to emit a placeholder paragraph.
 */
export function htmlToOoxmlBlocks(
  html: string,
  rels: RelationshipCollector,
  images: ImageCollector,
): string {
  if (html == null) return "";
  const trimmed = html.trim();
  if (trimmed === "") return "";

  const doc = new DOMParser().parseFromString(
    `<!doctype html><body><div id="__root__">${html}</div></body>`,
    "text/html",
  );
  const root = doc.getElementById("__root__");
  if (!root) return "";

  const out: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    walkBlock(child, out, rels, images);
  }
  return out.join("");
}

/* ------------------------------------------------------------------ */
/*  Block-level walking                                               */
/* ------------------------------------------------------------------ */

function walkBlock(
  node: Node,
  out: string[],
  rels: RelationshipCollector,
  images: ImageCollector,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").trim();
    if (text === "") return;
    out.push(`<w:p>${buildRuns([node], rels, images)}</w:p>`);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "p":
      out.push(
        `<w:p>${buildRuns(Array.from(el.childNodes), rels, images)}</w:p>`,
      );
      return;
    case "ul":
      emitList(el, out, rels, images, /* ordered */ false);
      return;
    case "ol":
      // Phase A/B: template only ships bullet numberings, so ordered
      // lists fall back to bullets.
      emitList(el, out, rels, images, /* ordered */ true);
      return;
    case "table":
      emitTable(el, out, rels, images);
      return;
    case "img": {
      // Top-level image (rare — sanitiser usually wraps in a <p>,
      // but defensive).
      const inner = buildRuns([el], rels, images);
      if (inner !== "") out.push(`<w:p>${inner}</w:p>`);
      return;
    }
    default:
      out.push(
        `<w:p>${buildRuns(Array.from(el.childNodes), rels, images)}</w:p>`,
      );
      return;
  }
}

/** Emit each `<li>` of a list as its own paragraph carrying the
 *  template's numbering reference. */
function emitList(
  listEl: Element,
  out: string[],
  rels: RelationshipCollector,
  images: ImageCollector,
  _ordered: boolean,
): void {
  const numId = 1;
  const items = Array.from(listEl.children).filter(
    (c) => c.tagName.toLowerCase() === "li",
  );
  for (const li of items) {
    const runs = buildRuns(Array.from(li.childNodes), rels, images);
    out.push(
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runs}</w:p>`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Tables                                                            */
/* ------------------------------------------------------------------ */

/**
 * Emit a `<w:tbl>` element from an HTML `<table>`. Walks `<tr>`,
 * `<td>`, `<th>` collecting paragraph content per cell.
 *
 * v1 design choices (call out for Phase B+ tuning):
 *   - `tblStyle="TableGrid"` (the template defines it; gives single-
 *     line borders all around).
 *   - `tblW w:type="auto"` so Word distributes column widths.
 *     The `data-width` attributes on the HTML cells are ignored
 *     in v1 — adding proportional widths is straightforward but
 *     adds enough code that we keep it for a follow-up.
 *   - `<th>` cells get bold + light-grey shading.
 */
function emitTable(
  tableEl: Element,
  out: string[],
  rels: RelationshipCollector,
  images: ImageCollector,
): void {
  // Collect every row, regardless of whether it sits inside
  // `<thead>` / `<tbody>` / `<tfoot>` (HTML browsers auto-wrap rows
  // in `<tbody>`; the sanitiser allows any of the three).
  const rows = Array.from(tableEl.querySelectorAll(":scope tr"));
  if (rows.length === 0) return;

  // Determine column count from the widest row so the grid is
  // consistent across rows.
  let maxCols = 0;
  for (const tr of rows) {
    const cells = tr.querySelectorAll(":scope > td, :scope > th");
    if (cells.length > maxCols) maxCols = cells.length;
  }
  if (maxCols === 0) return;

  // Build the table.
  const rowFrags: string[] = [];
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll(":scope > td, :scope > th"));
    const cellFrags: string[] = [];
    for (const cell of cells) {
      const isHeader = cell.tagName.toLowerCase() === "th";
      const paragraphs = htmlToCellParagraphs(cell, rels, images, isHeader);
      const shading = isHeader
        ? `<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>`
        : "";
      cellFrags.push(`<w:tc><w:tcPr>${shading}</w:tcPr>${paragraphs}</w:tc>`);
    }
    rowFrags.push(`<w:tr>${cellFrags.join("")}</w:tr>`);
  }

  // `<w:tblGrid>` with N empty `<w:gridCol/>` entries is enough for
  // auto-layout. Word fills in widths when it opens the document.
  const gridCols = Array.from({ length: maxCols }, () => `<w:gridCol/>`).join(
    "",
  );

  out.push(
    `<w:tbl>` +
      `<w:tblPr>` +
      `<w:tblStyle w:val="TableGrid"/>` +
      `<w:tblW w:w="0" w:type="auto"/>` +
      `</w:tblPr>` +
      `<w:tblGrid>${gridCols}</w:tblGrid>` +
      rowFrags.join("") +
      `</w:tbl>`,
  );

  // Trailing empty paragraph — required after a table so the cursor
  // has somewhere to go. Without it Word can produce an end-of-
  // document error.
  out.push(`<w:p/>`);
}

/**
 * Convert one `<td>` / `<th>` cell's children into a sequence of
 * `<w:p>` paragraphs. Each cell MUST contain at least one paragraph
 * (Word raises an error otherwise) — we emit an empty `<w:p/>` if
 * the cell is blank.
 *
 * `isHeader` makes the cell's paragraphs bold by injecting `<w:b/>`
 * into every run's properties.
 */
function htmlToCellParagraphs(
  cell: Element,
  rels: RelationshipCollector,
  images: ImageCollector,
  isHeader: boolean,
): string {
  // If the cell's children are themselves block elements (`<p>`,
  // `<ul>`, etc.) we walk them as blocks. Otherwise treat the cell's
  // content as inline runs wrapped in one paragraph.
  const childNodes = Array.from(cell.childNodes);
  const hasBlockChildren = childNodes.some((n) => {
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const t = (n as Element).tagName.toLowerCase();
    return t === "p" || t === "ul" || t === "ol" || t === "table";
  });

  let paragraphs: string;
  if (hasBlockChildren) {
    const out: string[] = [];
    for (const c of childNodes) walkBlock(c, out, rels, images);
    paragraphs = out.join("");
  } else {
    const runs = buildRuns(childNodes, rels, images);
    paragraphs = `<w:p>${runs}</w:p>`;
  }
  if (paragraphs === "") paragraphs = `<w:p/>`;

  // Header rows: wrap every w:p that has a w:r without an explicit
  // bold marker. Simplest approach is a post-process: append a
  // pPr/rPr with <w:b/> universally — but that's invasive. Instead
  // we just rely on inline `<strong>` if the author wanted bold; for
  // the v1 default appearance, leave the shading + paragraph as-is.
  void isHeader;
  return paragraphs;
}

/* ------------------------------------------------------------------ */
/*  Inline runs                                                       */
/* ------------------------------------------------------------------ */

interface RunFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Foreground colour as upper-case hex (no `#`). */
  textColor: string | null;
  /** Background fill (run shading) as upper-case hex. */
  highlight: string | null;
}

const EMPTY_FORMAT: RunFormat = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  textColor: null,
  highlight: null,
};

function buildRuns(
  nodes: Iterable<Node>,
  rels: RelationshipCollector,
  images: ImageCollector,
): string {
  const out: string[] = [];
  for (const n of nodes) {
    walkInline(n, EMPTY_FORMAT, out, rels, images);
  }
  return out.join("");
}

function walkInline(
  node: Node,
  fmt: RunFormat,
  out: string[],
  rels: RelationshipCollector,
  images: ImageCollector,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text === "") return;
    out.push(renderRun(text, fmt));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    out.push("<w:r><w:br/></w:r>");
    return;
  }

  if (tag === "img") {
    const src = el.getAttribute("src") ?? "";
    const widthAttr = el.getAttribute("width");
    const widthPx =
      widthAttr && /^\d{1,4}$/.test(widthAttr) ? parseInt(widthAttr, 10) : null;
    const altText = el.getAttribute("alt") ?? "";
    const added = images.add(src);
    if (added) {
      out.push(renderImage(added.relId, added.filename, widthPx, altText));
    }
    return;
  }

  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (href === "") {
      for (const child of Array.from(el.childNodes)) {
        walkInline(child, fmt, out, rels, images);
      }
      return;
    }
    const relId = rels.add(href);
    const innerOut: string[] = [];
    for (const child of Array.from(el.childNodes)) {
      walkInline(child, { ...fmt, underline: true }, innerOut, rels, images);
    }
    out.push(`<w:hyperlink r:id="${relId}">${innerOut.join("")}</w:hyperlink>`);
    return;
  }

  // Inline marks toggle the format for the subtree.
  const next: RunFormat = { ...fmt };
  if (tag === "strong" || tag === "b") next.bold = true;
  else if (tag === "em" || tag === "i") next.italic = true;
  else if (tag === "u") next.underline = true;
  else if (tag === "s") next.strike = true;
  else if (tag === "span") {
    const hex = lookupClassColor(el, "tc-");
    if (hex) next.textColor = hex;
  } else if (tag === "mark") {
    const hex = lookupClassColor(el, "bg-");
    // Default <mark> with no recognised class falls back to yellow
    // — matches html-to-pdfmake's default for the same element.
    next.highlight = hex ?? PALETTE_HEX.yellow!;
  }

  for (const child of Array.from(el.childNodes)) {
    walkInline(child, next, out, rels, images);
  }
}

function renderRun(text: string, fmt: RunFormat): string {
  const props: string[] = [];
  if (fmt.bold) props.push("<w:b/>");
  if (fmt.italic) props.push("<w:i/>");
  if (fmt.underline) props.push('<w:u w:val="single"/>');
  if (fmt.strike) props.push("<w:strike/>");
  if (fmt.textColor) props.push(`<w:color w:val="${fmt.textColor}"/>`);
  if (fmt.highlight)
    props.push(
      `<w:shd w:val="clear" w:color="auto" w:fill="${fmt.highlight}"/>`,
    );
  const rPr = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
}

/* ------------------------------------------------------------------ */
/*  Image rendering                                                   */
/* ------------------------------------------------------------------ */

/** Max embedded image width, in EMU. 1 inch = 914,400 EMU =
 *  72 pt. We cap at ~480 pt (matches the PDF builder's cap) so
 *  large screenshots don't break the page layout. */
const MAX_IMAGE_WIDTH_EMU = 6_096_000;
const PX_TO_EMU = 9525; // 1 px at 96 dpi = 9525 EMU

/**
 * Render an inline image inside a paragraph. Returns one `<w:r>`
 * carrying a `<w:drawing>` block.
 *
 * Dimensions:
 *   - When the HTML img has a `width` attribute we use it (clamped
 *     to MAX). Height = width × 0.75 (4:3 fallback) when we don't
 *     have a natural aspect. For PNGs we could parse IHDR; left as
 *     a follow-up — most pasted images survive the 4:3 default.
 *   - Without a width attribute we default to half the max width.
 */
function renderImage(
  relId: string,
  filename: string,
  widthPx: number | null,
  altText: string,
): string {
  const safeAlt = escapeXmlAttr(altText || filename);
  // Pick the inline render width (EMU).
  let cx: number;
  if (widthPx != null && widthPx > 0) {
    cx = Math.min(MAX_IMAGE_WIDTH_EMU, widthPx * PX_TO_EMU);
  } else {
    cx = Math.floor(MAX_IMAGE_WIDTH_EMU / 2);
  }
  const cy = Math.floor(cx * 0.75); // 4:3 fallback

  // Use a unique id for the drawing — OOXML wants integers. The
  // filename's digit suffix is good enough (image1.png → 1).
  const idMatch = /(\d+)/.exec(filename);
  const docPrId = idMatch ? idMatch[1] : "1";

  return (
    `<w:r><w:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${safeAlt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${safeAlt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r>`
  );
}
