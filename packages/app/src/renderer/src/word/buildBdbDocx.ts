/**
 * Pure Word-export builder for one BDB.
 *
 * Takes the bundled Skabelon BDB template + the FilePayload slice
 * for one BDB and produces a `.docx` byte array. The template's
 * styles, page setup, list numbering and section structure are
 * preserved verbatim — we only:
 *
 *   1. Replace each chapter's body content with paragraphs / lists
 *      generated from the BDB's section tree.
 *   2. Substitute the BDB's title for the literal
 *      "Paradigme for bygningsdels- og procesbeskrivelse" string in
 *      every header XML the template carries.
 *
 * Section-dispatch logic (Tore decision Q1=a)
 * -------------------------------------------
 * The template defines 5 Word sections (4 paragraph-level sectPr's +
 * 1 body-level sectPr) corresponding to:
 *   - front matter (Udarbejdet/Kontrolleret/Godkendt + TOC)
 *   - chapter "1 Omfang"
 *   - chapter "2 Almene specifikationer"
 *   - chapter "3 Projektering"
 *   - chapter "4 Produktion"
 *
 * We walk the BDB's top-level sections (depth=1) in order and inject
 * each into the corresponding template section. Extra BDB chapters
 * beyond 4 are appended to the last section. Fewer chapters means
 * the unused template sections render their headings only.
 *
 * Why string-based zip surgery rather than docx-js
 * -----------------------------------------------
 * The template's styles, TOC field, numbering definitions, page
 * margins, per-section headers, and font lookups would all have to
 * be re-implemented in code if we re-built the doc from scratch.
 * Working with the template as a starting point makes the export
 * look indistinguishable from what Tore handcrafts — which is the
 * whole point of having a template.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

/**
 * Encode a string to a Uint8Array that fflate's `zipSync` will
 * reliably recognise as bytes (not a Zippable subtree). Wraps
 * `strToU8` to defend against the vitest+jsdom realm gotcha:
 * fflate uses `data instanceof Uint8Array` to discriminate, and
 * a Uint8Array created inside jsdom's realm fails that check
 * when fflate evaluates it from the outer test realm — so every
 * replaced file becomes a "directory" full of numeric keys. We
 * sidestep by copying into a fresh outer-realm Uint8Array.
 */
export function toBytes(s: string): Uint8Array {
  const src = strToU8(s);
  const fresh = new Uint8Array(src.length);
  fresh.set(src);
  return fresh;
}

import type {
  BdbInfo,
  FilePayload,
  SectionData,
  WorkSpecInfo,
} from "../../../shared/ipc.js";
import { buildCpDocx } from "./buildCpDocx.js";
import { filterTreeForCompact } from "../compactFilter.js";
import { buildSectionTree, type SectionNode } from "../sectionTree.js";
import {
  htmlToOoxmlBlocks,
  ImageCollector,
  RelationshipCollector,
  type RelIdSeed,
} from "./htmlToOoxml.js";
import { escapeXmlText } from "./ooxmlEscape.js";
import { getBdbTemplateBytes } from "./templateBytes.js";
import { getBdbTemplateNoTocBytes } from "./templateNoTocBytes.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Discriminator identifying which spec kind to build a Word doc for.
 *  - "bdb"      → a construction-element spec (`bdbs[]` + `sectionsByBdb`)
 *                 using the Skabelon BDB template.
 *  - "workSpec" → a work area / arbejdsbeskrivelse
 *                 (`workSpecs[]` + `sectionsByWorkSpec`) using the
 *                 same Skabelon BDB template.
 *  - "cp"       → a control plan (`controlPlans[]` + `cpHeadersByPlan` +
 *                 `cpRowsByPlan`) using the separate
 *                 Molio_2_ControlPlan_Template. Handled by a totally
 *                 different code path (table-row injection) — see
 *                 `buildCpDocx.ts`.
 */
export type DocxSpecKind = "bdb" | "workSpec" | "cp";

export interface DocxSpecRef {
  kind: DocxSpecKind;
  id: number;
}

export interface BuildSpecDocxArgs {
  /** Whole loaded file. */
  data: FilePayload;
  /** Which spec to export. */
  spec: DocxSpecRef;
  /** Optional template override; defaults to bundled Skabelon BDB. */
  templateBytes?: Uint8Array;
  /** Compact mode — hide sections whose body is empty AND whose
   *  descendants are all empty too. */
  compact?: boolean;
  /**
   * Include the table of contents (default true). When true we use
   * the 5-section Skabelon BDB template (front matter carries the
   * TOC). When false we use the 4-section no-TOC template
   * (`templateNoTocBytes`), where the front matter shares its section
   * with chapter 1. Ignored when an explicit `templateBytes` override
   * is supplied AND the caller knows its layout — but note the
   * section-parsing strategy still follows this flag, so only pass a
   * matching override.
   */
  includeToc?: boolean;
}

/**
 * Legacy entry point: build a Word doc for a single BDB. Kept as a
 * thin wrapper over `buildSpecDocx` so existing call sites and tests
 * keep working.
 */
export interface BuildBdbDocxArgs {
  /** Whole loaded file (we need it for the BDB itself plus its
   *  sections and the project name for the header). */
  data: FilePayload;
  /** Which BDB to export. */
  bdbId: number;
  /**
   * Optional template override. Defaults to the bundled
   * Skabelon BDB. Tests pass a fixture here.
   */
  templateBytes?: Uint8Array;
  /**
   * Compact mode — hide sections whose body is empty AND whose
   * descendants are all empty too. Mirrors the PDF "compact" flag
   * (see `compactFilter.ts`). When omitted or false, every section
   * in the BDB tree is emitted, including empty ones.
   */
  compact?: boolean;
  /** Include the table of contents (default true). See
   *  `BuildSpecDocxArgs.includeToc`. */
  includeToc?: boolean;
}

/**
 * Tagged failure modes so the caller can surface a meaningful
 * message rather than a raw error. Thrown as Error subclasses
 * caught by the IPC / MCP wrapper.
 */
export class BdbDocxBuildError extends Error {
  readonly kind:
    | "no-bdb"
    | "no-workSpec"
    | "no-cp"
    | "no-template"
    | "bad-template"
    | "internal";
  constructor(kind: BdbDocxBuildError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/* ------------------------------------------------------------------ */
/*  Top-level entry                                                   */
/* ------------------------------------------------------------------ */

/**
 * Produce a `.docx` byte array for one BDB.
 *
 * Backward-compatible wrapper over `buildSpecDocx`. New callers
 * should prefer `buildSpecDocx` and pass a `DocxSpecRef` so the
 * same entry point can build a work-area Word doc too.
 *
 * Throws `BdbDocxBuildError` on bdb-not-found or template-shape
 * issues. The renderer / MCP wrapper catches and surfaces a
 * friendly message.
 */
export function buildBdbDocx(args: BuildBdbDocxArgs): Uint8Array {
  return buildSpecDocx({
    data: args.data,
    spec: { kind: "bdb", id: args.bdbId },
    templateBytes: args.templateBytes,
    compact: args.compact,
    includeToc: args.includeToc,
  });
}

/**
 * Produce a `.docx` byte array for one work area (work_spec).
 *
 * Same template, same OOXML pipeline as `buildBdbDocx`. The header
 * title is the work area's name (with code prefix when present), and
 * sections come from `data.sectionsByWorkSpec`.
 */
export function buildWorkSpecDocx(args: {
  data: FilePayload;
  workSpecId: number;
  templateBytes?: Uint8Array;
  compact?: boolean;
  includeToc?: boolean;
}): Uint8Array {
  return buildSpecDocx({
    data: args.data,
    spec: { kind: "workSpec", id: args.workSpecId },
    templateBytes: args.templateBytes,
    compact: args.compact,
    includeToc: args.includeToc,
  });
}

/**
 * Build a Word `.docx` byte array for one spec — BDB, work area, or
 * Control Plan. Generalised entry point that all three legacy
 * wrappers delegate to. Dispatches on `spec.kind`:
 *   - "cp" → `buildCpDocx` (CP template + table-row injection)
 *   - "bdb" / "workSpec" → the shared section-tree pipeline below
 */
export function buildSpecDocx(args: BuildSpecDocxArgs): Uint8Array {
  if (args.spec.kind === "cp") {
    // Different template + completely different body strategy (table
    // injection vs. section-tree walk). Hand off to the dedicated
    // CP builder. The import-time cycle between this file and
    // `buildCpDocx.ts` is safe because both sides only consume the
    // other's hoisted function/class exports (not const bindings).
    return buildCpDocx({
      data: args.data,
      controlPlanId: args.spec.id,
      templateBytes: args.templateBytes,
      compact: args.compact,
    });
  }
  const resolved = resolveSpec(args.data, args.spec);

  // Table of contents on (default) → 5-section Skabelon BDB template.
  // Off → 4-section no-TOC template (front matter shares its section
  // with chapter 1). The section-parsing strategy below follows the
  // same flag, so template + parser always match.
  const includeToc = args.includeToc !== false;
  const templateBytes =
    args.templateBytes ??
    (includeToc ? getBdbTemplateBytes() : getBdbTemplateNoTocBytes());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(templateBytes);
  } catch (err) {
    throw new BdbDocxBuildError(
      "bad-template",
      `Could not read the Word template: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const docXmlBytes = files["word/document.xml"];
  if (!docXmlBytes) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Template is missing word/document.xml.",
    );
  }
  const docXml = strFromU8(docXmlBytes);

  const chapters = buildChapters(resolved.sections, args.compact === true);

  // Phase B: hyperlinks AND images both need fresh rIds that don't
  // collide with the template's existing ones, and they share the
  // same `document.xml.rels` file — so they must come from one
  // counter. Both collectors take the same RelIdSeed object and
  // increment it as they issue ids. Start at 1000 to be safe
  // against the template using its own rId numbers below.
  const relIdSeed: RelIdSeed = { value: 1000 };
  const rels = new RelationshipCollector(relIdSeed);
  const images = new ImageCollector(relIdSeed);
  const renderedChapters = chapters.map((chapter) =>
    renderChapterContent(chapter, rels, images),
  );

  const newDocXml = includeToc
    ? replaceBodyContent(docXml, renderedChapters)
    : replaceBodyContentNoToc(docXml, renderedChapters);
  files["word/document.xml"] = toBytes(newDocXml);

  // Header XMLs: replace the literal "Paradigme..." string with
  // the spec's title AND the literal "Byggesag" label with the
  // project name (mirroring the PDF chrome, which shows the project
  // name in that top-right cell). Every header in the template
  // carries both; we walk every header*.xml and patch.
  const headerTitle = resolved.title;
  const projectName = args.data.project?.name?.trim() ?? "";
  for (const path of Object.keys(files)) {
    if (/^word\/header\d+\.xml$/.test(path)) {
      const text = strFromU8(files[path]!);
      const patched = patchHeaderTitle(text, headerTitle, projectName);
      files[path] = toBytes(patched);
    }
  }

  // Append hyperlink + image relationships into document.xml.rels
  // (both share the same rels file).
  if (rels.hasEntries() || images.hasEntries()) {
    const relsPath = "word/_rels/document.xml.rels";
    const relsBytes = files[relsPath];
    if (!relsBytes) {
      throw new BdbDocxBuildError(
        "bad-template",
        "Template is missing word/_rels/document.xml.rels.",
      );
    }
    const relsXml = strFromU8(relsBytes);
    const fragments = rels.toXmlFragments() + images.toRelXmlFragments();
    const patched = insertRelationships(relsXml, fragments);
    files[relsPath] = toBytes(patched);
  }

  // Write the image bytes under word/media/ and patch
  // [Content_Types].xml so Word recognises the new extensions.
  if (images.hasEntries()) {
    for (const img of images.all()) {
      files[`word/media/${img.filename}`] = img.bytes;
    }
    const ctPath = "[Content_Types].xml";
    const ctBytes = files[ctPath];
    if (!ctBytes) {
      throw new BdbDocxBuildError(
        "bad-template",
        "Template is missing [Content_Types].xml.",
      );
    }
    const ctXml = strFromU8(ctBytes);
    const patched = ensureContentTypes(ctXml, images.uniqueExtensions());
    files[ctPath] = toBytes(patched);
  }

  // Repack. fflate's `zipSync` produces a deterministic byte stream
  // — useful for content-equality tests.
  return zipSync(files);
}

/* ------------------------------------------------------------------ */
/*  Chapter-level structure                                           */
/* ------------------------------------------------------------------ */

/**
 * One top-level chapter — the tree rooted at a depth-0 node.
 * Carries the SectionNode directly so we can walk descendants
 * with their computed dotted numbers + depths.
 */
interface Chapter {
  root: SectionNode;
}

/**
 * Resolve a `DocxSpecRef` to the spec's display title + flat section
 * list. Both BDBs and work areas use the same Skabelon BDB template,
 * so the only kind-specific bits are which array to look in and
 * where the title comes from.
 *
 * Throws `BdbDocxBuildError` (`no-bdb` / `no-workSpec`) when the spec
 * is not present in the loaded file.
 */
function resolveSpec(
  data: FilePayload,
  spec: DocxSpecRef,
): { title: string; sections: SectionData[] } {
  if (spec.kind === "bdb") {
    const bdb: BdbInfo | undefined = data.bdbs.find((b) => b.id === spec.id);
    if (!bdb) {
      throw new BdbDocxBuildError(
        "no-bdb",
        `No BDB with id ${spec.id} in the open file.`,
      );
    }
    return {
      title: bdb.name?.trim() || "Bygningsdelsbeskrivelse",
      sections: data.sectionsByBdb[bdb.id] ?? [],
    };
  }
  const wa: WorkSpecInfo | undefined = data.workSpecs.find(
    (w) => w.id === spec.id,
  );
  if (!wa) {
    throw new BdbDocxBuildError(
      "no-workSpec",
      `No work area with id ${spec.id} in the open file.`,
    );
  }
  // Work-area display title: "<code> <name>" when code is present,
  // otherwise just the name. Matches what the sidebar shows.
  const codePart = wa.workAreaCode?.trim();
  const namePart = wa.workAreaName?.trim() || "Arbejdsbeskrivelse";
  const title = codePart ? `${codePart} ${namePart}` : namePart;
  return {
    title,
    sections: data.sectionsByWorkSpec[wa.id] ?? [],
  };
}

/**
 * Group a spec's sections into chapters keyed by their top-level
 * (depth-0) ancestor. Uses the renderer's shared `buildSectionTree`
 * so the dotted numbers we display match what the editor + PDF
 * already produce.
 *
 * Ordering: the root nodes appear in `sectionNo` ascending order
 * (the tree-builder already sorts), so chapter 1 → 2 → 3 → 4.
 *
 * `compact` runs the same `filterTreeForCompact` the PDF side uses
 * so a Word export with compact ON drops the same empty sections
 * the PDF would. Section numbering is preserved because the filter
 * keeps the original `number` values on surviving nodes.
 */
function buildChapters(sections: SectionData[], compact: boolean): Chapter[] {
  const tree = buildSectionTree(sections);
  const filtered = filterTreeForCompact(tree, compact);
  return filtered.map((root) => ({ root }));
}

/**
 * Render one chapter (= one depth-0 section + descendants) into
 * OOXML block elements.
 *
 * For each section we emit:
 *   - One heading paragraph styled `Heading<depth+1>` (Word's
 *     Heading1 = our depth-0; depth caps at 9, Word's ceiling).
 *   - Body paragraphs derived from the section's `body` HTML.
 *
 * Depth-first walk so descendants land directly after their parent
 * — same order the editor and PDF export already use.
 */
function renderChapterContent(
  chapter: Chapter,
  rels: RelationshipCollector,
  images: ImageCollector,
): string {
  const out: string[] = [];
  walkSectionNode(chapter.root, out, rels, images);
  return out.join("");
}

function walkSectionNode(
  node: SectionNode,
  out: string[],
  rels: RelationshipCollector,
  images: ImageCollector,
): void {
  out.push(renderHeading(node));
  const body = node.section.body;
  if (body && body.trim() !== "") {
    out.push(htmlToOoxmlBlocks(body, rels, images));
  }
  for (const child of node.children) {
    walkSectionNode(child, out, rels, images);
  }
}

/**
 * Heading paragraph styled to the section's depth. `buildSectionTree`
 * returns 0-based depths (depth 0 = chapter root), and Word's
 * built-in heading styles are 1-indexed (Heading1 = chapter level).
 * Cap at Heading9 so the style id is always valid.
 */
function renderHeading(node: SectionNode): string {
  const wordDepth = Math.max(1, Math.min(9, node.depth + 1));
  const num = escapeXmlText(node.number);
  const heading = escapeXmlText(node.section.heading ?? "");
  return (
    `<w:p>` +
    `<w:pPr><w:pStyle w:val="Heading${wordDepth}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${num}</w:t></w:r>` +
    `<w:r><w:tab/><w:t xml:space="preserve">${heading}</w:t></w:r>` +
    `</w:p>`
  );
}

/* ------------------------------------------------------------------ */
/*  document.xml body replacement                                     */
/* ------------------------------------------------------------------ */

/**
 * Replace the four chapter slots in the template's `document.xml`
 * with our rendered chapters.
 *
 * Strategy
 * --------
 * The template has 5 sections delimited by 5 `<w:sectPr>` markers
 * (4 inside paragraphs + 1 at body level). Between consecutive
 * sectPr-paragraphs we have:
 *
 *   - Front matter (preserved verbatim): from `<w:body>` start up
 *     to and INCLUDING the paragraph carrying the 1st sectPr.
 *   - Chapter 1 content (replaced): paragraphs after sectPr#1's
 *     paragraph, up to and INCLUDING sectPr#2's paragraph.
 *   - Chapter 2 content (replaced): … up to sectPr#3's paragraph.
 *   - Chapter 3 content (replaced): … up to sectPr#4's paragraph.
 *   - Chapter 4 content (replaced): up to the body-level sectPr.
 *
 * For each chapter we keep the paragraph containing the section
 * break (because it carries the sectPr) but strip the rest of the
 * paragraph's content (heading + body placeholders) and prepend our
 * rendered content.
 *
 * Implementation: find each sectPr-carrying paragraph by its byte
 * span (greedy regex from the sectPr backward to the enclosing
 * `<w:p>` open tag, forward to its `</w:p>` close tag) and substitute.
 *
 * Extra BDB chapters (>4) are appended after the last template
 * section's content — they share the body-level section break.
 */
function replaceBodyContent(docXml: string, chapterContents: string[]): string {
  // Find the four paragraph-level sectPr markers + the body-level
  // one. They appear in document order; the first four are inside
  // paragraphs, the fifth is at body level.
  const sectPrIndices: number[] = [];
  const re = /<w:sectPr\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docXml))) {
    sectPrIndices.push(m.index);
  }
  if (sectPrIndices.length < 5) {
    throw new BdbDocxBuildError(
      "bad-template",
      `Template has ${sectPrIndices.length} sectPr markers, expected at least 5.`,
    );
  }

  // For each of the first 4 sectPr markers (paragraph-level), find
  // the surrounding `<w:p>...</w:p>` span. We need both the OUTER
  // bounds and the closing `</w:p>` of the previous content block
  // (so we can replace between them).
  const sectionEnds = sectPrIndices
    .slice(0, 4)
    .map((idx) => findEnclosingParagraph(docXml, idx));

  // Section content boundaries:
  // - Section 1 (front matter): start of body → end of sectPr-1's paragraph.
  // - Section N (2..5): start = end of sectPr-(N-1)'s paragraph,
  //                     end = end of sectPr-N's paragraph (or body-level
  //                     sectPr's preceding paragraph for the last one).
  // The 5th section ends at the body close (before body-level sectPr).

  const bodyOpenMatch = /<w:body[^>]*>/.exec(docXml);
  if (!bodyOpenMatch) {
    throw new BdbDocxBuildError("bad-template", "Template missing <w:body>.");
  }
  const bodyContentStart = bodyOpenMatch.index + bodyOpenMatch[0].length;

  // The body-level sectPr is the LAST sectPr — sectPrIndices[4]. It
  // is preceded by zero or more paragraphs that form section 5's
  // content. Find where section-5 content starts (right after
  // sectPr-4's enclosing paragraph).
  const section5ContentEnd = sectPrIndices[4]!; // up to (but not
  // including) the body-level sectPr

  // Pieces of the new document.xml:
  //   1. Everything up to the end of front matter (= end of sectPr-1's paragraph)
  const frontMatterEnd = sectionEnds[0]!.endOfParagraph;
  const frontMatter = docXml.slice(0, frontMatterEnd);

  //   2. Chapters 1..4. For chapters 1..3, content + sectPr-N's
  //      paragraph (which carries the section break).  For chapter
  //      4, content + body-level sectPr at the end.
  const pieces: string[] = [frontMatter];

  // Helper: rebuild a sectPr-carrying paragraph from its captured
  // pPr (containing the sectPr) — empty body, just the section
  // break.
  function emptySectPrParagraph(idx: number): string {
    const { ppr } = sectionEnds[idx]!;
    return `<w:p>${ppr}</w:p>`;
  }

  // For each chapter slot 0..3 we emit:
  //   <chapter content>
  //   <empty paragraph carrying sectPr-(slot+1)>
  for (let i = 0; i < 4; i++) {
    const chapter = chapterContents[i] ?? "";
    pieces.push(chapter);
    pieces.push(emptySectPrParagraph(i));
  }

  // Chapter 5+ content: anything beyond chapter 4 is appended here.
  // The body-level sectPr-5 closes the document.
  const extraChapters = chapterContents.slice(4).join("");
  pieces.push(extraChapters);

  // Body-level sectPr — preserve verbatim from template.
  const bodyLevelSectPrEnd = closingSectPrEnd(docXml, sectPrIndices[4]!);
  const bodyLevelSectPr = docXml.slice(sectPrIndices[4]!, bodyLevelSectPrEnd);
  pieces.push(bodyLevelSectPr);

  // Closing tags after body-level sectPr: `</w:body></w:document>`.
  const tail = docXml.slice(bodyLevelSectPrEnd);
  pieces.push(tail);

  // Sanity: bodyContentStart should equal 0 of `frontMatter`? It's
  // already included so we ignore. Keep `section5ContentEnd` lint-quiet:
  void bodyContentStart;
  void section5ContentEnd;

  return pieces.join("");
}

/**
 * No-TOC variant of `replaceBodyContent`.
 *
 * The no-TOC template (`templateNoTocBytes`) has 4 Word sections, not
 * 5: removing the table of contents also removed the front-matter
 * section break, so the front matter (Udarbejdet/Kontrolleret/Godkendt
 * table) now shares its section with chapter 1 ("1 Omfang"). Layout:
 *
 *   - Section 1: front matter + chapter 1   → ends at sectPr #1
 *   - Section 2: chapter 2                   → ends at sectPr #2
 *   - Section 3: chapter 3                   → ends at sectPr #3
 *   - Section 4: chapter 4                   → ends at the body-level sectPr
 *
 * So there are 3 paragraph-level sectPr + 1 body-level = 4 total.
 *
 * Because the front matter no longer has its own section break, we
 * split it from chapter 1 at the FIRST `Heading1` paragraph (the
 * chapter-1 heading) instead of at a sectPr. Everything before that
 * heading (the front-matter table + its labels) is kept verbatim;
 * chapters 1..4 are injected exactly like the 5-section path, just
 * shifted by one because there is one fewer paragraph-level break.
 */
function replaceBodyContentNoToc(
  docXml: string,
  chapterContents: string[],
): string {
  const sectPrIndices: number[] = [];
  const re = /<w:sectPr\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docXml))) {
    sectPrIndices.push(m.index);
  }
  if (sectPrIndices.length < 4) {
    throw new BdbDocxBuildError(
      "bad-template",
      `No-TOC template has ${sectPrIndices.length} sectPr markers, expected at least 4.`,
    );
  }

  // Front matter ends where chapter 1 begins: the first chapter
  // heading. In the template chapter headings carry pStyle Heading1.
  const headingMatch = /<w:pStyle\s+w:val="Heading1"\s*\/>/.exec(docXml);
  if (!headingMatch) {
    throw new BdbDocxBuildError(
      "bad-template",
      "No-TOC template has no Heading1 paragraph — cannot find where chapter 1 starts.",
    );
  }
  const frontMatterEnd = findEnclosingParagraph(
    docXml,
    headingMatch.index,
  ).startOfParagraph;
  const frontMatter = docXml.slice(0, frontMatterEnd);

  // The three paragraph-level breaks end chapters 1, 2, 3.
  const sectionEnds = sectPrIndices
    .slice(0, 3)
    .map((idx) => findEnclosingParagraph(docXml, idx));

  const pieces: string[] = [frontMatter];

  function emptySectPrParagraph(idx: number): string {
    const { ppr } = sectionEnds[idx]!;
    return `<w:p>${ppr}</w:p>`;
  }

  // Chapters 1..3: content + the paragraph carrying their section break.
  for (let i = 0; i < 3; i++) {
    pieces.push(chapterContents[i] ?? "");
    pieces.push(emptySectPrParagraph(i));
  }

  // Chapter 4 (+ any extra chapters beyond 4) closes with the
  // body-level sectPr, preserved verbatim.
  pieces.push(chapterContents[3] ?? "");
  pieces.push(chapterContents.slice(4).join(""));

  const bodyLevelIdx = sectPrIndices[3]!;
  const bodyLevelSectPrEnd = closingSectPrEnd(docXml, bodyLevelIdx);
  pieces.push(docXml.slice(bodyLevelIdx, bodyLevelSectPrEnd));
  pieces.push(docXml.slice(bodyLevelSectPrEnd));

  return pieces.join("");
}

/**
 * Find the `<w:p>...</w:p>` paragraph that encloses the byte offset
 * `sectPrIdx`. Returns the paragraph's outer span PLUS the inner
 * `<w:pPr>...</w:pPr>` block we want to preserve (it contains the
 * section break).
 */
function findEnclosingParagraph(
  docXml: string,
  sectPrIdx: number,
): {
  startOfParagraph: number;
  endOfParagraph: number;
  ppr: string;
} {
  // Walk back for the last `<w:p ...>` or `<w:p>` before sectPrIdx.
  const before = docXml.slice(0, sectPrIdx);
  const lastPOpen = before.lastIndexOf("<w:p");
  if (lastPOpen < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Could not find enclosing <w:p> for a section break.",
    );
  }
  // Confirm the match isn't `<w:pPr>` etc. — we want exactly `<w:p`
  // followed by ` ` or `>`.
  const after = docXml[lastPOpen + 3] ?? "";
  if (after !== " " && after !== ">") {
    // Look further back.
    const beforer = docXml.slice(0, lastPOpen);
    const next = beforer.lastIndexOf("<w:p");
    if (next < 0) {
      throw new BdbDocxBuildError(
        "bad-template",
        "Could not find enclosing <w:p> for a section break (second pass).",
      );
    }
    // Note: we don't recurse fully — this fallback assumes the second-
    // last `<w:p` is the real paragraph opener.
    // In practice the template's only `<w:p` substrings are real
    // paragraph openers, so this branch is defensive.
    return findEnclosingParagraphFrom(docXml, sectPrIdx, next);
  }

  return findEnclosingParagraphFrom(docXml, sectPrIdx, lastPOpen);
}

function findEnclosingParagraphFrom(
  docXml: string,
  sectPrIdx: number,
  pStart: number,
): {
  startOfParagraph: number;
  endOfParagraph: number;
  ppr: string;
} {
  // Forward to `</w:p>` after sectPrIdx.
  const pCloseIdx = docXml.indexOf("</w:p>", sectPrIdx);
  if (pCloseIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Could not find closing </w:p> after section break.",
    );
  }
  const pCloseEnd = pCloseIdx + "</w:p>".length;

  // The `<w:pPr>...</w:pPr>` block sits at the start of the paragraph
  // and carries the sectPr. We grab the whole block verbatim — its
  // exact bytes (including formatting / rsids) are what Word expects.
  const pprOpen = docXml.indexOf("<w:pPr", pStart);
  if (pprOpen < 0 || pprOpen > pCloseEnd) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Paragraph carrying section break has no <w:pPr>.",
    );
  }
  const pprCloseIdx = docXml.indexOf("</w:pPr>", pprOpen);
  if (pprCloseIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Unterminated <w:pPr> in paragraph carrying section break.",
    );
  }
  const pprEnd = pprCloseIdx + "</w:pPr>".length;
  const ppr = docXml.slice(pprOpen, pprEnd);

  return {
    startOfParagraph: pStart,
    endOfParagraph: pCloseEnd,
    ppr,
  };
}

/**
 * Return the byte offset of the `>` that closes the `</w:sectPr>`
 * starting at `sectPrStart` (i.e. one past the closing tag's end).
 */
function closingSectPrEnd(docXml: string, sectPrStart: number): number {
  const closeIdx = docXml.indexOf("</w:sectPr>", sectPrStart);
  if (closeIdx < 0) {
    throw new BdbDocxBuildError("bad-template", "Unterminated <w:sectPr>.");
  }
  return closeIdx + "</w:sectPr>".length;
}

/* ------------------------------------------------------------------ */
/*  Header title replacement                                          */
/* ------------------------------------------------------------------ */

/**
 * Replace every occurrence of the placeholder
 * "Paradigme for bygningsdels- og procesbeskrivelse" in a header
 * XML with the BDB title.
 *
 * The placeholder appears inside `<w:t>...</w:t>` (sometimes split
 * across runs by Word's authoring quirks — though the un-edited
 * template uses a single run, so a simple string replace works).
 * If Tore later restructures the header, we may need to be smarter
 * about run boundaries.
 */
function patchHeaderTitle(
  xml: string,
  bdbTitle: string,
  projectName: string,
): string {
  let out = xml;
  const titlePlaceholder = "Paradigme for bygningsdels- og procesbeskrivelse";
  if (out.includes(titlePlaceholder)) {
    out = out.split(titlePlaceholder).join(escapeXmlText(bdbTitle));
  }
  // FIX (2026-05-26): match the PDF chrome — the top-right cell
  // shows the project name. The template ships with "Byggesag" as
  // a label there, so we substitute when a project name is set.
  // Falls back to the literal label when the project name is empty.
  // Regex handles both `<w:t>...` and `<w:t xml:space="preserve">...`
  // (the CP template uses the latter; the BDB template the former).
  if (projectName !== "") {
    out = out.replace(
      /<w:t([^>]*)>Byggesag<\/w:t>/g,
      `<w:t$1>${escapeXmlText(projectName)}</w:t>`,
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  document.xml.rels injection                                       */
/* ------------------------------------------------------------------ */

/**
 * Insert new `<Relationship>` fragments before the closing
 * `</Relationships>` tag of document.xml.rels.
 */
function insertRelationships(relsXml: string, fragments: string): string {
  const closeIdx = relsXml.lastIndexOf("</Relationships>");
  if (closeIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "Template's document.xml.rels missing </Relationships>.",
    );
  }
  return relsXml.slice(0, closeIdx) + fragments + relsXml.slice(closeIdx);
}

/* ------------------------------------------------------------------ */
/*  [Content_Types].xml — register image extensions                   */
/* ------------------------------------------------------------------ */

/**
 * Ensure `[Content_Types].xml` declares a `<Default>` entry for each
 * supplied (extension, contentType). The template ships with `rels`
 * and `xml` only, so the first export with images injects the image
 * extensions; subsequent exports become no-ops because the entries
 * are already present.
 *
 * Plain string surgery — same approach as `insertRelationships`.
 * Acceptable because we own the input file and its shape is known.
 */
function ensureContentTypes(
  xml: string,
  extensions: Array<{ ext: string; contentType: string }>,
): string {
  if (extensions.length === 0) return xml;
  let out = xml;
  for (const { ext, contentType } of extensions) {
    const probe = `Extension="${ext}"`;
    if (out.includes(probe)) continue;
    const fragment = `<Default Extension="${ext}" ContentType="${contentType}"/>`;
    // Insert just before the closing </Types> tag.
    const closeIdx = out.lastIndexOf("</Types>");
    if (closeIdx < 0) {
      throw new BdbDocxBuildError(
        "bad-template",
        "Template's [Content_Types].xml missing </Types>.",
      );
    }
    out = out.slice(0, closeIdx) + fragment + out.slice(closeIdx);
  }
  return out;
}
