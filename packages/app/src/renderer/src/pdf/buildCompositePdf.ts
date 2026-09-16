/**
 * Composite spec PDF — multi-chapter document with one cover + one
 * unified TOC, then one chapter per spec.
 *
 * Why a separate builder rather than extending `buildSpecPdf`:
 *   - `buildSpecPdf` is a "one spec → one PDF" function. Stuffing
 *     conditional "is this a composite" logic into it would make the
 *     single-spec path harder to read.
 *   - The composite layout has a unified TOC that collects headings
 *     from every chapter. pdfmake's `toc` node picks up any node
 *     marked `tocItem: true`, so we can simply call `buildSpecPdf`
 *     for each chapter (with cover/TOC turned OFF), take its
 *     `.content` array, prefix a chapter title, and concatenate.
 *
 * Chapters in:
 *   - Per work_area: { WA intro sections } then each contained BDB.
 *   - Per contract:  every work_area's chapters in turn.
 *   - Per project:   every contract's chapters in turn.
 *
 * The caller is responsible for ordering the chapters; this builder
 * just renders them in the order received.
 */
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";

import type { SectionData } from "../../../shared/ipc.js";
import {
  buildSpecPdf,
  specPdfStyles,
  type AttachmentAppendixEntry,
  type BuildSpecPdfArgs,
  type PfbbChildPdfOverlay,
  type SpecKind,
} from "./buildSpecPdf.js";
import {
  makeCover,
  makeFooter,
  makeHeader,
  STANDARD_PAGE_MARGINS_PT,
  type PdfChromeArgs,
} from "./pdfChrome.js";

/** One chapter in a composite PDF — a single spec's worth of content. */
export interface CompositePdfChapter {
  kind: SpecKind;
  /** Chapter heading (e.g. the BDB's name or work_area's "code — name"). */
  title: string;
  /** Smaller heading printed under the title. Hidden when null/empty. */
  subtitle?: string | null;
  /** Optional revision / revision-date pair printed in the metadata row. */
  revision?: string | null;
  revisionDate?: string | null;
  /** The spec's sections, flat list (same shape as `FilePayload`). */
  sections: SectionData[];
  /** Work-area attachments appendix. Only used for `kind: "workSpec"`. */
  attachments?: AttachmentAppendixEntry[];
  /** PFBB child overlay (rare in composites, but supported). */
  pfbbChildOverlay?: PfbbChildPdfOverlay;
}

export interface BuildCompositePdfArgs {
  /**
   * Composite-level cover. Shows the project name + a scope label
   * (e.g. "Work area 01 — Neutrale" or "Entire project") instead of
   * a single spec's title. The chrome (header/footer) is built from
   * this so every page reads as one document.
   */
  cover: {
    title: string;
    subtitle?: string | null;
    projectName?: string | null;
    contractLabel?: string | null;
    revision?: string | null;
    revisionDate?: string | null;
    dateText?: string;
    companyName: string;
    /** Document-label used in the running header's row 4. Defaults to the
     *  cover title. Caller can pass a shorter label here. */
    documentLabel?: string;
    /** Work-area label for the running header's row 3 left. Caller
     *  chooses what to print — for a multi-WA composite it's
     *  reasonable to leave this null or use the contract / project
     *  name instead. */
    workAreaName?: string | null;
  };
  /**
   * One entry per chapter. Order is preserved verbatim — the caller
   * decides whether to group by work_area, contract, or project.
   */
  chapters: CompositePdfChapter[];
  /** Cover page on by default; turn off for tests / specialised callers. */
  includeCoverPage?: boolean;
  /** Add this many pages to the displayed page numbers (1 when a custom
   *  cover is prepended after rendering). Default 0. */
  pageNumberOffset?: number;
  /** TOC on by default. */
  includeToc?: boolean;
  /** Forwarded to each chapter — see {@link BuildSpecPdfArgs.compact}. */
  compact?: boolean;
  /** Section-body HTML → pdfmake Content. Same contract as buildSpecPdf. */
  htmlConverter: (html: string) => Content;
  /** Optional pre-strip pass (hide marks etc.). Same as buildSpecPdf. */
  stripBody?: (html: string) => string;
}

/**
 * Build a composite spec PDF.
 *
 * Implementation: defers the per-chapter section rendering to
 * `buildSpecPdf` (with cover + TOC switched off + the chapter's own
 * chrome irrelevant — only `.content` is consumed). That keeps the
 * walk function / PFBB note-page logic / attachments appendix in
 * one place. We then prepend a composite cover + unified TOC and
 * install a document-wide header / footer so the running chrome is
 * stable across chapters.
 *
 * Pure: no I/O, no global state. Safe to call repeatedly.
 */
export function buildCompositePdf(
  args: BuildCompositePdfArgs,
): TDocumentDefinitions {
  const {
    cover,
    chapters,
    includeCoverPage = true,
    pageNumberOffset = 0,
    includeToc = true,
    compact = false,
    htmlConverter,
    stripBody,
  } = args;

  const chromeArgs: PdfChromeArgs = {
    projectName: cover.projectName ?? null,
    workAreaName: cover.workAreaName ?? null,
    documentLabel: cover.documentLabel ?? cover.title,
    companyName: cover.companyName,
    dateText: cover.dateText ?? todayISO(),
    revisionDateText: cover.revisionDate ?? null,
  };

  const content: Content[] = [];

  // Cover page ----------------------------------------------------------
  if (includeCoverPage) {
    content.push(
      ...makeCover({
        ...chromeArgs,
        title: cover.title,
        subtitle: cover.subtitle ?? null,
        revision: cover.revision ?? null,
        revisionDate: cover.revisionDate ?? null,
        contractLabel: cover.contractLabel ?? null,
      }),
    );
  }

  // Unified TOC ---------------------------------------------------------
  // pdfmake's `toc` node collects every `tocItem: true` node in the
  // document, regardless of how deeply nested. Each chapter's heading
  // and section heading already gets `tocItem: true` from buildSpecPdf
  // — and we tag chapter titles below — so one TOC covers everything.
  if (includeToc) {
    content.push({
      toc: {
        title: { text: "Indholdsfortegnelse", style: "tocHeader" },
        textMargin: [0, 2, 0, 2],
      },
      pageBreak: "after",
    } as unknown as Content);
  }

  // Chapter contents ----------------------------------------------------
  // Empty composites still produce a (cover + empty TOC) PDF rather
  // than throw — matches the editor's "(no sections)" placeholder
  // behaviour from the single-spec builder.
  chapters.forEach((chapter, i) => {
    // Page break BEFORE each chapter (except the first if there's
    // no cover + no TOC, since we'd start on page 1 with one). The
    // `pageBreak: "before"` on the chapter heading is the simplest
    // way to force this.
    const isFirstNoChrome = i === 0 && !includeCoverPage && !includeToc;
    content.push({
      text: chapter.title,
      style: "chapterTitle",
      tocItem: true,
      tocStyle: { fontSize: 11, bold: true },
      ...(isFirstNoChrome ? {} : { pageBreak: "before" }),
    } as Content);

    if (chapter.subtitle) {
      content.push({
        text: chapter.subtitle,
        style: "chapterSubtitle",
      } as Content);
    }

    // Defer section rendering to buildSpecPdf — chrome + cover + TOC
    // off, since the composite owns those. We pass the chapter's own
    // revision data into a metadata block below by faking a thin
    // per-chapter call.
    const sub: BuildSpecPdfArgs = {
      kind: chapter.kind,
      title: chapter.title,
      subtitle: chapter.subtitle ?? null,
      revision: chapter.revision ?? null,
      revisionDate: chapter.revisionDate ?? null,
      projectName: cover.projectName ?? null,
      contractLabel: cover.contractLabel ?? null,
      workAreaName: chapter.kind === "workSpec" ? chapter.title : null,
      companyName: cover.companyName,
      includeCoverPage: false,
      includeToc: false,
      compact,
      sections: chapter.sections,
      htmlConverter,
    };
    if (chapter.attachments) sub.attachments = chapter.attachments;
    if (chapter.pfbbChildOverlay)
      sub.pfbbChildOverlay = chapter.pfbbChildOverlay;
    if (stripBody) sub.stripBody = stripBody;

    const subDoc = buildSpecPdf(sub);
    // buildSpecPdf emits its own title + subtitle + meta block at the
    // top of its content array; we just rendered our chapter title
    // above, so drop the inner title/subtitle nodes and keep the
    // meta line + sections. The title/subtitle are the FIRST two
    // entries (subtitle is conditional) — we look at the style
    // marker rather than positional indexes so this stays correct
    // if buildSpecPdf adds a leading node later.
    const innerContent = Array.isArray(subDoc.content) ? subDoc.content : [];
    for (const node of innerContent) {
      if (isStyledNode(node, "title")) continue;
      if (isStyledNode(node, "subtitle")) continue;
      content.push(node);
    }
  });

  return {
    pageSize: "A4",
    pageMargins: STANDARD_PAGE_MARGINS_PT,
    header: makeHeader(chromeArgs, undefined, includeCoverPage, pageNumberOffset),
    footer: makeFooter(chromeArgs, undefined, includeCoverPage, pageNumberOffset),
    content,
    defaultStyle: { fontSize: 10 },
    styles: specPdfStyles,
    info: {
      title: cover.title,
      creator: "Spec Editor Community",
    },
  };
}

/** Type-guard for "is this pdfmake content node tagged with `style: X`". */
function isStyledNode(node: unknown, style: string): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "style" in node &&
    (node as { style?: unknown }).style === style
  );
}

/** Today's date as ISO (YYYY-MM-DD). Same fallback as buildSpecPdf. */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
