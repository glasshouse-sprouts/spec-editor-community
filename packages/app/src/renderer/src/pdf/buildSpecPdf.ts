/**
 * Pure PDF doc-definition builder for work-area and BDB specs.
 *
 * Keeps the pdfmake runtime out of unit tests — this file returns a
 * plain JSON-compatible `TDocumentDefinitions` object. `renderPdf.ts`
 * is the tiny wrapper that actually asks pdfmake to turn it into a
 * byte buffer.
 *
 * 7.1 delivered: title + metadata + hierarchical section dump.
 *
 * 7.2 adds:
 *   - Optional cover page (default on). Built via `pdfChrome.makeCover`.
 *   - A table of contents that lists every heading with its dotted
 *     number + auto-populated page number (pdfmake's built-in
 *     `toc` mechanism; section headings get `tocItem: true`).
 *   - Running header / footer built via `pdfChrome.makeHeader` and
 *     `makeFooter`, both of which skip page 1 so the cover stays clean.
 */
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";

import type { SectionData } from "../../../shared/ipc.js";
import { filterTreeForCompact } from "../compactFilter.js";
import { buildSectionTree, type SectionNode } from "../sectionTree.js";
import { danishCollator } from "../sortHelpers.js";
import {
  makeCover,
  makeFooter,
  makeHeader,
  STANDARD_PAGE_MARGINS_PT,
  type PdfChromeArgs,
} from "./pdfChrome.js";

/** Kind of spec this PDF is for. Affects the "Kind" metadata label. */
export type SpecKind = "workSpec" | "bdb";

/**
 * Shared pdfmake style sheet for spec-shaped PDFs. Exported so the
 * composite builder (buildCompositePdf — "per work_area" / "per
 * contract" / "whole project" exports) can use the exact same
 * styles without duplicating the table. Single source of truth.
 */
export const specPdfStyles = {
  title: {
    fontSize: 20,
    bold: true,
    margin: [0, 0, 0, 4] as [number, number, number, number],
  },
  subtitle: {
    fontSize: 12,
    color: "#555",
    margin: [0, 0, 0, 12] as [number, number, number, number],
  },
  meta: {
    fontSize: 9,
    color: "#555",
    margin: [0, 0, 0, 18] as [number, number, number, number],
  },
  sectionHeading: {
    fontSize: 12,
    bold: true,
    margin: [0, 12, 0, 4] as [number, number, number, number],
  },
  tocHeader: {
    fontSize: 16,
    bold: true,
    margin: [0, 0, 0, 12] as [number, number, number, number],
  },
  empty: { fontSize: 10, color: "#888" },
  appendixHeading: {
    fontSize: 16,
    bold: true,
    margin: [0, 0, 0, 12] as [number, number, number, number],
  },
  appendixFilename: { fontSize: 11, bold: true },
  appendixMeta: { fontSize: 9, color: "#666" },
  pfbbNoteTitle: {
    fontSize: 18,
    bold: true,
    margin: [0, 0, 0, 10] as [number, number, number, number],
  },
  pfbbNoteBody: {
    fontSize: 11,
    margin: [0, 0, 0, 6] as [number, number, number, number],
  },
  pfbbNoteListHeader: {
    fontSize: 12,
    bold: true,
    margin: [0, 14, 0, 6] as [number, number, number, number],
  },
  pfbbNoteListItem: {
    fontSize: 10,
    color: "#0366d6",
    decoration: "underline" as const,
    margin: [0, 0, 0, 3] as [number, number, number, number],
  },
  // Composite-only — chapter heading inside a multi-spec PDF. The
  // chapter title is roughly the same visual weight as the cover's
  // own title block so the TOC reads "Cover → Chapter 1 → ...".
  chapterTitle: {
    fontSize: 16,
    bold: true,
    margin: [0, 0, 0, 4] as [number, number, number, number],
  },
  chapterSubtitle: {
    fontSize: 11,
    color: "#555",
    margin: [0, 0, 0, 10] as [number, number, number, number],
  },
};

/**
 * One attachment to show in the per-work-spec appendix (Slice 10L).
 *
 * The renderer is responsible for pre-fetching image bytes via IPC and
 * turning them into data URLs — this builder stays pure and purely
 * structural. Non-image entries leave `dataUrl` undefined and are
 * rendered as a small type icon + filename + size row.
 */
export interface AttachmentAppendixEntry {
  /** Filename as stored on the attachment (e.g. "plan.png"). */
  name: string;
  /** IANA mime type (e.g. "image/png", "application/pdf"). */
  mimeType: string;
  /** File size in bytes. Used to build the "123 KB" label. */
  byteLength: number;
  /**
   * For image attachments: a `data:image/png;base64,...` URL that
   * pdfmake can render directly. Omit / leave undefined for non-image
   * attachments — the builder shows a type-icon row instead.
   *
   * If an image attachment is missing / unreadable, the renderer can
   * omit `dataUrl` and this entry will fall back to the filename-only
   * row with a generic "image (unavailable)" icon.
   */
  dataUrl?: string;
}

/**
 * Overlay that turns a plain BDB PDF into a "PFBB child" PDF.
 *
 * Slice 10H.10 — when a PFBB child BDB is exported, the caller still
 * passes the MASTER's sections as `sections` (so inherited headings +
 * bodies render), and supplies this overlay on the side:
 *
 *   - `masterName` — shown on the new "Om denne bygningsdelsbeskrivelse"
 *     note page that the builder inserts between cover and TOC.
 *   - `supplementBodyBySectionId` — sanitised supplement HTML keyed
 *     by master-section id. Missing / empty entries mean "no project-
 *     specific addition here".
 *
 * When this overlay is set the walk function renders each section as:
 *   - heading (black, as normal)
 *   - master body (tinted grey `#999`) if present
 *   - supplement body (black) if present
 * Rules: both can be omitted independently; a section with neither
 * just renders its heading.
 */
export interface PfbbChildPdfOverlay {
  masterName: string;
  supplementBodyBySectionId: Record<number, string>;
}

/**
 * Input to the builder. Intentionally narrow so the test doubles are
 * trivial and the builder doesn't peek at fields it doesn't use.
 *
 * `htmlConverter` is injected so tests can pass an identity function
 * without loading the real html-to-pdfmake library (it needs a DOM,
 * and we don't want that in unit tests). In production the renderer
 * passes the real converter.
 */
export interface BuildSpecPdfArgs {
  /** "Work area" or "BDB" — printed under the title. */
  kind: SpecKind;
  /** Headline shown at the top of page one. */
  title: string;
  /** Optional subtitle (e.g. work-area code). Hidden when null/empty. */
  subtitle?: string | null;
  /** Optional "revision X — date Y" pair. Both can be null. */
  revision?: string | null;
  revisionDate?: string | null;
  /** Project name shown in the small metadata block + chrome. */
  projectName?: string | null;
  /** Contract label (e.g. "01 - Fagentreprise") for the cover. */
  contractLabel?: string | null;
  /**
   * Name of the parent work area, used by the BIPS-style running
   * header (row 3 left). For work-area PDFs pass the WA's own name;
   * for BDB PDFs pass the parent WA's name. Null prints blank.
   */
  workAreaName?: string | null;
  /**
   * Today's date, pre-formatted as a string — goes into the header's
   * "Dato :" field. Caller controls format (we standardise on ISO
   * YYYY-MM-DD for now; a future i18n pass can switch to DD-MM-YYYY).
   * If omitted the builder fills in today's date itself.
   */
  dateText?: string;
  /**
   * Literal string for the footer left cell. Icebox #119 tracks where
   * this eventually comes from; for now the caller passes
   * `"Company name"`.
   */
  companyName: string;
  /**
   * When true (default), a cover page is rendered as page 1 with a
   * forced page break after. When false, the PDF starts straight on
   * the TOC (or sections, if TOC is also disabled).
   */
  includeCoverPage?: boolean;
  /**
   * Add this many pages to the displayed page numbers. Set to 1 when a
   * custom cover is prepended after rendering (pdfmake counts only the
   * body), so numbers match the assembled PDF. Default 0.
   */
  pageNumberOffset?: number;
  /**
   * Whether to emit the table-of-contents block. Defaults to true.
   * Exposed so tests (and future callers) can turn it off.
   */
  includeToc?: boolean;
  /**
   * When true, hide sections whose body is "visually empty" (same
   * rule as the editor's Compact view — see `compactFilter.ts`). A
   * parent is kept if any descendant survived, so numbering stays
   * readable. Default false.
   *
   * Only affects spec PDFs (work areas + BDBs). Control plan PDFs
   * use a different data model so the flag doesn't apply there.
   */
  compact?: boolean;
  /** The spec's sections, flat list (same shape as `FilePayload`). */
  sections: SectionData[];
  /**
   * Attachments appendix (Slice 10L). When present + non-empty, the
   * builder pushes a page break + "Bilag" heading + one row per
   * attachment at the tail of the document.
   *
   * - Work-area PDFs only — the caller must pass the parent work
   *   spec's attachments here for a work-area PDF, and leave this
   *   undefined / empty for BDB and control-plan PDFs.
   * - Empty or undefined → no appendix page, no extra page break.
   * - The builder sorts entries by filename using the Danish collator
   *   so the UI's "attachments list" order and the PDF order match.
   */
  attachments?: AttachmentAppendixEntry[];
  /**
   * Slice 10H.10 — opt-in PFBB child styling. See
   * {@link PfbbChildPdfOverlay}. Omit (or pass undefined) for normal
   * BDB / work-area PDFs.
   */
  pfbbChildOverlay?: PfbbChildPdfOverlay;
  /**
   * Converts one sanitised HTML string into one or more pdfmake
   * Content nodes. Injected so tests don't need a DOM. A reasonable
   * fallback when HTML is empty is to return a single empty-string
   * text node — the builder handles that.
   */
  htmlConverter: (html: string) => Content;
  /**
   * Slice "Highlights & formatting" — mark kinds (highlight
   * backgrounds + text colors) the user has chosen to hide on
   * export via the Export options modal. Bodies are run through
   * `stripHighlights` BEFORE the htmlConverter so the matching
   * `<mark>` / `<span>` wrappers are dropped while inner text
   * (and nested formatting) survive. Empty / undefined → no strip.
   *
   * Plain function-of-string here rather than the full
   * `stripHighlights` import so the builder stays test-friendly
   * without pulling DOMParser at unit-test time.
   */
  stripBody?: (html: string) => string;
}

/**
 * Build the final pdfmake doc definition. Safe to call many times —
 * no hidden state, no I/O.
 */
export function buildSpecPdf(args: BuildSpecPdfArgs): TDocumentDefinitions {
  const {
    kind,
    title,
    subtitle,
    revision,
    revisionDate,
    projectName,
    contractLabel,
    workAreaName,
    dateText,
    companyName,
    includeCoverPage = true,
    pageNumberOffset = 0,
    includeToc = true,
    compact = false,
    sections,
    attachments,
    pfbbChildOverlay,
    htmlConverter,
    stripBody,
  } = args;

  // Wrap the htmlConverter once so every call inside the builder
  // applies the optional hide-marks pre-pass without sprinkling the
  // check through the walk function. Identity when `stripBody` is
  // not provided.
  const convert: (html: string) => Content = stripBody
    ? (html) => htmlConverter(stripBody(html))
    : htmlConverter;

  const kindLabel =
    kind === "workSpec" ? "Arbejdsbeskrivelse" : "Bygningsdelsbeskrivelse";

  // Row 4 of the BIPS header: for work-area PDFs we print the literal
  // Danish "Arbejdsbeskrivelse" (lit. "Work description") — Tore's
  // call — and for BDB PDFs we print the BDB's own name.
  const documentLabel = kind === "workSpec" ? "Arbejdsbeskrivelse" : title;

  const chromeArgs: PdfChromeArgs = {
    projectName: projectName ?? null,
    workAreaName: workAreaName ?? null,
    documentLabel,
    companyName,
    dateText: dateText ?? todayISO(),
    revisionDateText: revisionDate ?? null,
  };

  const content: Content[] = [];

  // Cover page ----------------------------------------------------------
  if (includeCoverPage) {
    content.push(
      ...makeCover({
        ...chromeArgs,
        title,
        subtitle: subtitle ?? null,
        revision: revision ?? null,
        revisionDate: revisionDate ?? null,
        contractLabel: contractLabel ?? null,
      }),
    );
  }

  // PFBB child note page -----------------------------------------------
  // Slice 10H.10 — inserted between cover and TOC. The builder needs
  // the section tree to enumerate "which sections have supplements",
  // but Compact filtering must NOT kick in for the note-page list:
  // compact hides empty rows from the main body, but the note page
  // always reflects the actual supplements regardless of display.
  if (pfbbChildOverlay) {
    appendPfbbChildNote(content, pfbbChildOverlay, buildSectionTree(sections));
  }

  // Table of contents ---------------------------------------------------
  if (includeToc) {
    content.push({
      toc: {
        title: { text: "Indholdsfortegnelse", style: "tocHeader" },
        // `textMargin` on pdfmake's TOC node accepts the same
        // [left, top, right, bottom] tuple as general margins.
        textMargin: [0, 2, 0, 2],
      },
      pageBreak: "after",
    } as unknown as Content);
  }

  // Title block ---------------------------------------------------------
  content.push({ text: title, style: "title" });
  if (subtitle) {
    content.push({ text: subtitle, style: "subtitle" });
  }

  // Small metadata block ------------------------------------------------
  const metaLines: string[] = [`Kind: ${kindLabel}`];
  if (projectName) metaLines.push(`Project: ${projectName}`);
  if (revision) metaLines.push(`Revision: ${revision}`);
  if (revisionDate) metaLines.push(`Revision date: ${revisionDate}`);
  content.push({ text: metaLines.join("   ·   "), style: "meta" });

  // Sections ------------------------------------------------------------
  // Build the tree, then apply the Compact filter when asked. Compact
  // strips sections whose body is visually empty, keeping parents when
  // any descendant survived so numbering still makes sense. A fully
  // empty spec under Compact falls through to the "(no sections)"
  // placeholder — by design: the user said "still produce the PDF".
  const tree = filterTreeForCompact(buildSectionTree(sections), compact);
  if (tree.length === 0) {
    content.push({ text: "(no sections)", style: "empty", italics: true });
  } else {
    walk(tree, content, convert, pfbbChildOverlay);
  }

  // Attachments appendix (Slice 10L) ------------------------------------
  // Only runs for work-area PDFs (the caller gates this) and only when
  // there is at least one attachment. Empty / undefined → nothing is
  // emitted, not even the page break.
  if (attachments && attachments.length > 0) {
    appendAttachmentsAppendix(content, attachments);
  }

  return {
    pageSize: "A4",
    // Standard page margins (Tore's spec, 2026-05-12) — see
    // pdfChrome.ts for the mm-source-of-truth.
    pageMargins: STANDARD_PAGE_MARGINS_PT,
    header: makeHeader(chromeArgs, undefined, includeCoverPage, pageNumberOffset),
    footer: makeFooter(chromeArgs, undefined, includeCoverPage, pageNumberOffset),
    content,
    defaultStyle: { fontSize: 10 },
    styles: specPdfStyles,
    info: {
      title,
      creator: "Spec Editor Community",
    },
  };
}

/**
 * Today's date as ISO (YYYY-MM-DD). Used as the fallback when the
 * caller doesn't pass `dateText`. We match the format the renderer
 * already uses for `revisionDate` so both sides of the BIPS header
 * line up visually.
 */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * pdfmake destination id for a section heading. Used by the PFBB
 * child note page so its list of "sections with supplements" can be
 * clickable jump-links into the document.
 */
function sectionDestId(sectionId: number): string {
  return `section-${sectionId}`;
}

/**
 * Depth-first walk over the section tree. Emits:
 *   - heading line  "<dotted no>  <heading>"  (tagged for the TOC)
 *   - body (via htmlConverter) if present
 *   - children recursively
 *
 * When `overlay` is supplied (PFBB child PDF, slice 10H.10):
 *   - the `section.body` is treated as the MASTER body and rendered
 *     in grey;
 *   - the per-id supplement lookup yields the child's project-specific
 *     addition, rendered in the default (black) color right after;
 *   - either half can be missing independently; a section with
 *     nothing renders only its heading.
 * In the non-overlay path the behaviour is unchanged from 7.1.
 */
function walk(
  nodes: readonly SectionNode[],
  out: Content[],
  htmlConverter: (html: string) => Content,
  overlay?: PfbbChildPdfOverlay,
): void {
  for (const node of nodes) {
    const { section, number } = node;
    const head = section.heading
      ? number
        ? `${number}  ${section.heading}`
        : section.heading
      : number;
    const masterBody = section.body ?? "";
    const supplementBody = overlay?.supplementBodyBySectionId[section.id] ?? "";
    const hasMaster = masterBody.trim().length > 0;
    const hasSupplement = supplementBody.trim().length > 0;
    // Slice 10H.10 follow-up — in PFBB child mode, the heading is
    // greyed out when the section has NO supplement (i.e. the row is
    // entirely inherited from the master). Black heading is reserved
    // for sections where the child added its own content.
    const headingIsGrey = !!overlay && !hasSupplement;
    if (head) {
      // Every heading goes into the default TOC. pdfmake will fill in
      // the page number automatically on render. We keep this a plain
      // text node (not rich Content) so the TOC gets a clean string.
      // The `id` is a destination anchor so the PFBB child note page
      // can jump-link into the section; harmless when unused.
      out.push({
        text: head,
        style: "sectionHeading",
        tocItem: true,
        id: sectionDestId(section.id),
        ...(headingIsGrey ? { color: "#999" } : {}),
        // Indent the TOC line by the heading depth so deeper headings
        // are visually nested. 10 points per level is enough to see
        // the hierarchy without eating horizontal space.
        tocMargin: [node.depth * 10, 0, 0, 0],
      } as unknown as Content);
    }
    if (overlay) {
      // PFBB child mode — master grey, supplement black, either may
      // be absent. Grey is a simple wrap since pdfmake inherits
      // `color` through Content trees.
      if (hasMaster) {
        out.push({
          stack: [htmlConverter(masterBody)],
          color: "#999",
        } as unknown as Content);
      }
      if (hasSupplement) {
        out.push(htmlConverter(supplementBody));
      }
    } else if (hasMaster) {
      // Regular path — unchanged from before 10H.10.
      out.push(htmlConverter(masterBody));
    }
    if (node.children.length > 0) {
      walk(node.children, out, htmlConverter, overlay);
    }
  }
}

/**
 * Push the PFBB child note page onto the content array. Called once,
 * between the cover and the TOC, when the caller supplied a
 * `pfbbChildOverlay`.
 *
 * Contents:
 *   - Title "Om denne bygningsdelsbeskrivelse"
 *   - One-paragraph explainer in Danish naming the master and the
 *     grey-vs-black reading key
 *   - Either a clickable list of "Afsnit med supplementer (N):" or
 *     a muted line saying the project has no supplements
 *   - pageBreak: "after" so the TOC starts fresh on the next page.
 */
function appendPfbbChildNote(
  out: Content[],
  overlay: PfbbChildPdfOverlay,
  tree: readonly SectionNode[],
): void {
  out.push({
    text: "Om denne bygningsdelsbeskrivelse",
    style: "pfbbNoteTitle",
  });
  out.push({
    text: [
      "Denne bygningsdelsbeskrivelse er baseret på PFBB-masteren ",
      { text: `"${overlay.masterName}"`, bold: true },
      ". Grå tekst er overtaget fra PFBB'en uændret. Sort tekst er projektets supplerende indhold, som er tilføjet specifikt til dette projekt.",
    ],
    style: "pfbbNoteBody",
  });

  // Collect all sections (flat) that have a non-empty supplement.
  // Keep in tree/document order so the list reads naturally.
  const withSupplements: { number: string; heading: string; id: number }[] = [];
  const visit = (nodes: readonly SectionNode[]): void => {
    for (const node of nodes) {
      const body = overlay.supplementBodyBySectionId[node.section.id] ?? "";
      if (body.trim().length > 0) {
        withSupplements.push({
          number: node.number,
          heading: node.section.heading ?? "",
          id: node.section.id,
        });
      }
      if (node.children.length > 0) visit(node.children);
    }
  };
  visit(tree);

  if (withSupplements.length === 0) {
    out.push({
      text: "Dette projekt har ingen projektspecifikke supplementer — al tekst er overtaget direkte fra PFBB'en.",
      style: "pfbbNoteBody",
      italics: true,
      margin: [0, 14, 0, 0],
    });
  } else {
    out.push({
      text: `Afsnit med supplementer (${withSupplements.length}):`,
      style: "pfbbNoteListHeader",
    });
    for (const row of withSupplements) {
      const label = row.number
        ? `${row.number}  ${row.heading}`.trim()
        : row.heading;
      out.push({
        text: label,
        style: "pfbbNoteListItem",
        linkToDestination: sectionDestId(row.id),
      } as unknown as Content);
    }
  }

  // Force the TOC onto the next page.
  out.push({ text: "", pageBreak: "after" } as unknown as Content);
}

/* --------------------------------------------------------------------- */
/*  Attachments appendix helpers (Slice 10L)                             */
/* --------------------------------------------------------------------- */

/**
 * Is this mime type something pdfmake can inline as an `image` node?
 * We restrict to the raster formats pdfmake actually supports (PNG,
 * JPEG). SVG is not supported out of the box; everything else falls
 * back to the filename-only row.
 */
export function isInlinableImageMime(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  return m === "image/png" || m === "image/jpeg" || m === "image/jpg";
}

/**
 * Format a byte count as a short human-readable string. Matches the
 * style used in the GlobalAttachmentsModal so the PDF labels and the
 * in-app UI stay consistent.
 *
 *   0      → "0 B"
 *   950    → "950 B"
 *   2048   → "2 KB"
 *   1_500_000 → "1.4 MB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

/**
 * Shared Danish-locale collator — used across the app for alphabetical
 * sort. The canonical collator (with `numeric: true` so "2" < "10")
 * lives in `sortHelpers.ts` — imported above.
 */

/**
 * Very short label for a non-image mime — drives the tiny type-icon
 * shown in the appendix row. Returned label is shown inside a small
 * bordered rectangle so it doubles as a visual cue.
 *
 *   application/pdf → "PDF"
 *   application/vnd.openxmlformats…wordprocessingml.document → "DOC"
 *   application/vnd.ms-excel → "XLS"
 *   etc.
 *
 * Falls back to the subtype up to 3 chars ("FIL") so unknown mimes
 * still render a consistent-size icon.
 */
export function mimeShortLabel(mime: string): string {
  const m = mime.toLowerCase().trim();
  if (m === "application/pdf") return "PDF";
  if (m.includes("wordprocessingml") || m === "application/msword")
    return "DOC";
  if (m.includes("spreadsheetml") || m === "application/vnd.ms-excel")
    return "XLS";
  if (m.includes("presentationml") || m === "application/vnd.ms-powerpoint")
    return "PPT";
  if (m.startsWith("text/")) return "TXT";
  if (m.startsWith("image/")) return "IMG";
  const slash = m.indexOf("/");
  const sub = slash >= 0 ? m.slice(slash + 1) : m;
  return (sub || "FIL").slice(0, 3).toUpperCase();
}

/**
 * Push the Bilag appendix onto the content array. Called only when
 * `attachments` has at least one entry.
 *
 * Layout per row (pdfmake `columns`):
 *   [  icon-or-thumbnail (fixed width)  |  { filename, size }  ]
 *
 * Image rows use the provided `dataUrl` with `fit: [200, 200]` so the
 * thumbnail never exceeds 200 pt in either dimension (aspect ratio
 * preserved by pdfmake). Non-image rows and images missing `dataUrl`
 * fall back to a small type-icon rectangle.
 */
function appendAttachmentsAppendix(
  out: Content[],
  attachments: AttachmentAppendixEntry[],
): void {
  // Stable alphabetical sort using the Danish collator. Copy first so
  // we don't mutate the caller's array.
  const sorted = attachments
    .slice()
    .sort((a, b) => danishCollator.compare(a.name, b.name));

  // Page break + heading. `pageBreak: "before"` on the heading is
  // enough — we don't need a separate empty node. `tocItem: true` +
  // `tocStyle: "tocHeader"` make the heading show up in the TOC so
  // readers can jump straight to "Bilag" like any other section.
  out.push({
    text: "Bilag",
    style: "appendixHeading",
    pageBreak: "before",
    tocItem: true,
    tocStyle: "tocHeader",
    tocMargin: [0, 4, 0, 0],
  });

  for (const entry of sorted) {
    out.push(buildAppendixRow(entry));
  }
}

/**
 * Build one `columns` row for the appendix. Exported for unit tests
 * so we can assert both the image and non-image branches without
 * reaching into the bigger doc-def.
 */
export function buildAppendixRow(entry: AttachmentAppendixEntry): Content {
  // We trust any supplied `dataUrl` — the renderer rasterizes non-image
  // mime types to PNG icons upstream (canvas API, Slice 10L.7) and
  // pdfmake accepts both image blobs + those rasterized icons the same
  // way. Fall back to a text badge cell only when no dataUrl is present
  // (e.g. headless unit tests, or a runtime where icon rendering
  // failed).
  const hasDataUrl =
    typeof entry.dataUrl === "string" && entry.dataUrl.length > 0;

  const iconCell: Content = hasDataUrl
    ? {
        image: entry.dataUrl as string,
        fit: [150, 150],
        width: 150,
      }
    : buildTypeIconCell(entry.mimeType);

  return {
    columns: [
      { width: 150, stack: [iconCell] },
      {
        width: "*",
        stack: [
          { text: entry.name, style: "appendixFilename" },
          {
            text: `${entry.mimeType} · ${formatBytes(entry.byteLength)}`,
            style: "appendixMeta",
          },
        ],
        margin: [12, 4, 0, 0],
      },
    ],
    margin: [0, 0, 0, 18],
  };
}

/**
 * Build the non-image type-icon cell: a bordered rectangle with the
 * short mime label (e.g. "PDF", "DOC"). Kept deliberately tiny +
 * monochrome so it doesn't compete with the filename text.
 */
function buildTypeIconCell(mime: string): Content {
  return {
    table: {
      widths: [48],
      heights: [48],
      body: [
        [
          {
            text: mimeShortLabel(mime),
            alignment: "center",
            bold: true,
            fontSize: 11,
            color: "#555",
            margin: [0, 16, 0, 0],
          },
        ],
      ],
    },
    layout: {
      hLineColor: () => "#bbb",
      vLineColor: () => "#bbb",
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}
