/**
 * Shared "chrome" helpers for PDF export — cover page, running header,
 * running footer. Used by both `buildSpecPdf.ts` and `buildCpPdf.ts` so
 * every PDF the app produces looks the same.
 *
 * Design notes:
 *
 *   - All builders are pure: input in → plain data out. The `header` /
 *     `footer` helpers return JavaScript functions because that's the
 *     shape pdfmake expects at runtime, but tests can still call those
 *     functions and assert on the returned Content nodes (no pdfmake
 *     needed, no DOM needed).
 *   - As of 7.3b the running header follows the Danish BIPS B1000
 *     template (Molio 2.0's predecessor): two columns, four rows,
 *     horizontal rule underneath. Left column = spec context
 *     (Bygherre placeholder, Entrepriseform placeholder, work-area
 *     name, BDB name or literal "Arbejdsbeskrivelse"). Right column =
 *     project name (bold top), then Dato / Rev.dato / Side.
 *   - The footer stays simple: a horizontal rule with ~one line of
 *     breathing room above it, then "Company name" on the left and
 *     "Page N of M" on the right.
 *   - "Company name" is a literal placeholder for now. Icebox #119
 *     tracks the decision on where it eventually gets stored.
 */

import type { Content } from "pdfmake/interfaces";

/**
 * Danish placeholder strings. Kept here so there's exactly one source
 * of truth when Tore picks a client name / contract form for real
 * (each will graduate out of its placeholder into a proper data
 * field; for now the header just prints the bracketed text).
 */
export const BYGHERRE_PLACEHOLDER = "[Bygherre]";
export const ENTREPRISEFORM_PLACEHOLDER = "[Entrepriseform]";

/* ------------------------------------------------------------------ */
/*  Standard page margins (Tore's spec, 2026-05-12)                   */
/* ------------------------------------------------------------------ */

/**
 * One source of truth for the page geometry of every non-cover PDF
 * page (running content, headers, footers). All four builders
 * (`buildSpecPdf`, `buildCompositePdf`, `buildVersionSummaryPdf`,
 * `buildCpPdf`) import these instead of hard-coding numbers.
 *
 * Why pt-with-mm-comments: pdfmake speaks points, but the user
 * specifies these in millimetres for paper-print legibility. The
 * arithmetic is `mm × 2.83465 → pt`, rounded to the nearest pt.
 *
 * Cover-page note: the cover sits on the same page-margin canvas as
 * the rest (pageMargins is document-level in pdfmake), so the cover's
 * usable area shifts slightly with these numbers. The actual cover
 * content (title block, project name, company name) is laid out by
 * `makeCover` and was unchanged in this slice — only its bounding
 * area moved by ~13pt top / ~7pt bottom.
 */
/** Left margin (21.5 mm). Header, footer, body text. */
export const PAGE_MARGIN_LEFT_PT = 61;
/** Right margin (22.5 mm). Header, footer, body text. */
export const PAGE_MARGIN_RIGHT_PT = 64;
/** Top page edge to top of body text (39 mm). */
export const PAGE_MARGIN_TOP_PT = 111;
/** Bottom of body text to bottom page edge (27 mm). */
export const PAGE_MARGIN_BOTTOM_PT = 77;
/** Top page edge to top of the running header content (13 mm). */
export const HEADER_TOP_OFFSET_PT = 37;
/** Footer top-of-rule offset from the page bottom edge (15 mm).
 *  Internally we drive the footer position via its bottom margin
 *  inside `makeFooter`; this constant captures the design intent. */
export const FOOTER_TOP_FROM_PAGE_BOTTOM_PT = 43;

/**
 * Convenience array for pdfmake's `pageMargins: [L, T, R, B]` shape.
 * Use this so every builder stays consistent — never recompute the
 * order at the call site.
 */
export const STANDARD_PAGE_MARGINS_PT: [number, number, number, number] = [
  PAGE_MARGIN_LEFT_PT,
  PAGE_MARGIN_TOP_PT,
  PAGE_MARGIN_RIGHT_PT,
  PAGE_MARGIN_BOTTOM_PT,
];

/* ------------------------------------------------------------------ */
/*  Chrome margins (per-PDF override)                                  */
/* ------------------------------------------------------------------ */

/**
 * Margins used by the running header + footer. Most PDFs use the
 * `STANDARD_CHROME_MARGINS` value below (matches the new page margin
 * spec so header and footer text align with body text edges). The
 * control-plan PDF deliberately uses its own narrower set
 * (`CP_CHROME_MARGINS`) so its wide landscape tables aren't squeezed.
 *
 * Why split here rather than just hard-coding the numbers inside
 * `makeHeader` / `makeFooter`: keeps the chrome functions reusable
 * across the four builders that exist today, and makes the CP-vs-rest
 * choice explicit at the call site.
 */
export interface PdfChromeMargins {
  /** Left margin (matches the host PDF's page-left margin). */
  marginLeft: number;
  /** Right margin (matches the host PDF's page-right margin). */
  marginRight: number;
  /** Header top offset from page edge — `pdfChrome.makeHeader` uses
   *  this as the second value in its `margin` tuple. */
  headerTop: number;
  /** Footer top margin — gap between the body content end and the
   *  top of the footer block. */
  footerTop: number;
  /** Footer bottom margin — gap between the footer content and the
   *  page bottom edge. Set so the footer rule lands at the right
   *  vertical position; see FOOTER_TOP_FROM_PAGE_BOTTOM_PT. */
  footerBottom: number;
}

/** Default margins matching the new 2026-05-12 spec. Used by
 *  buildSpecPdf, buildCompositePdf, buildVersionSummaryPdf. */
export const STANDARD_CHROME_MARGINS: PdfChromeMargins = {
  marginLeft: PAGE_MARGIN_LEFT_PT,
  marginRight: PAGE_MARGIN_RIGHT_PT,
  headerTop: HEADER_TOP_OFFSET_PT,
  footerTop: 12,
  // 25pt bottom margin puts the top of the footer rule at
  // ~43pt (15 mm) above the page bottom edge — see the comment on
  // FOOTER_TOP_FROM_PAGE_BOTTOM_PT for the calc.
  footerBottom: 25,
};

/** Narrower margins preserved for buildCpPdf (landscape, table-heavy
 *  layout that benefits from a wider working area). Identical to the
 *  pre-2026-05-12 numbers so existing CP exports keep their look. */
export const CP_CHROME_MARGINS: PdfChromeMargins = {
  marginLeft: 40,
  marginRight: 40,
  headerTop: 20,
  footerTop: 12,
  footerBottom: 20,
};

/** Page margins for the CP PDF (kept at pre-2026-05-12 values per
 *  Tore's request — wider sides squeeze the landscape table). */
export const CP_PAGE_MARGINS_PT: [number, number, number, number] = [
  30, 80, 30, 65,
];

/**
 * Values that appear on the running header + footer. Cover page has a
 * richer superset (see `PdfCoverArgs` below).
 *
 *   - `projectName`          → top-right bold cell.
 *   - `workAreaName`         → row-3 left. For work-area PDFs this is
 *                              the work area's own name; for BDBs it's
 *                              the parent work area; for CPs the owner
 *                              work area. Null → blank cell.
 *   - `documentLabel`        → row-4 left. For BDBs this is the BDB
 *                              name; for work-area PDFs it's the
 *                              literal "Arbejdsbeskrivelse"; for CPs
 *                              it's the CP title.
 *   - `dateText`             → right column, row 2. Expected format is
 *                              whatever the caller decides; we don't
 *                              reformat.
 *   - `revisionDateText`     → right column, row 3. Null → blank value
 *                              (the "Rev.dato :" label still prints).
 *   - `companyName`          → footer left. Until #119 lands this is
 *                              always the literal "Company name".
 */
export interface PdfChromeArgs {
  projectName: string | null;
  workAreaName: string | null;
  documentLabel: string;
  dateText: string;
  revisionDateText: string | null;
  companyName: string;
}

/**
 * Signature pdfmake expects for a dynamic header/footer.
 * Page size is forwarded through for callers that care — the BIPS
 * header doesn't need it (the table's `widths: ['*', 'auto']` handles
 * both portrait and landscape), but we keep the signature in case
 * later tweaks want to lay things out differently by width.
 */
export type ChromeFn = (
  currentPage: number,
  pageCount: number,
  // pdfmake's typed surface lies about the shape of pageSize, so we
  // keep it loose.
  pageSize?: unknown,
) => Content;

// ---------------------------------------------------------------------------
// Running header — BIPS B1000 layout
// ---------------------------------------------------------------------------

/**
 * Build the running header. Two columns, four rows, thin horizontal
 * rule underneath. Hidden on page 1 so the cover page stays clean.
 *
 * Layout sketch (right column's label:value is laid out as a nested
 * 3-column row so the colons line up):
 *
 *     ┌──────────────────────────────┬────────────────────────────┐
 *     │ Bygherre (bold)              │ {projectName} (bold, right)│
 *     │ [Entrepriseform]             │ Dato     :  {date}         │
 *     │ {workAreaName}               │ Rev.dato :  {revDate}      │
 *     │ {documentLabel}              │ Side     :  {N}/{M}        │
 *     └──────────────────────────────┴────────────────────────────┘
 *     ────────────────────────────────────────────────────────────── (hline)
 */
export function makeHeader(
  args: PdfChromeArgs,
  margins: PdfChromeMargins = STANDARD_CHROME_MARGINS,
  // Skip the header on page 1 (default) — but ONLY when page 1 carries
  // the built-in cover. Builders pass `includeCoverPage` here so that a
  // custom (.speccustom) cover, which turns the auto cover off, still
  // gets a header on the body's first page.
  skipFirstPage = true,
  // Add this many pages to the displayed "Side" numbers. Used when a
  // custom cover is prepended OUTSIDE pdfmake (pdfmake counts only the
  // body), so the numbers still match the assembled PDF.
  pageOffset = 0,
): ChromeFn {
  const project = (args.projectName ?? "").trim();
  const workArea = (args.workAreaName ?? "").trim();
  const docLabel = (args.documentLabel ?? "").trim();
  const revDate = (args.revisionDateText ?? "").trim();

  return (currentPage, pageCount) => {
    // Page 1 stays clean only when it's the built-in cover.
    if (skipFirstPage && currentPage === 1) return { text: "" };

    // Two horizontal rules, per the BIPS B1000 template — drawn as the
    // BOTTOM border of each of the two sub-tables below.
    const bottomRule = (
      i: number,
      node: { table: { body: unknown[] } },
    ): number => (i === node.table.body.length ? 0.5 : 0);

    return {
      // Top-of-page margin so the header doesn't hug the page edge.
      // Caller-provided margins keep the header aligned with the host
      // PDF's body text — STANDARD_CHROME_MARGINS for spec/composite/
      // version summary; CP_CHROME_MARGINS for the control-plan PDF.
      margin: [margins.marginLeft, margins.headerTop, margins.marginRight, 0],
      // Row 1 needs its OWN column widths (50/50) so the project name gets
      // a wide cell, while rows 2-4 keep the wide-left + narrow-meta split.
      // pdfmake column widths are per-column (not per-row), so the header
      // is split into two stacked sub-tables.
      stack: [
        // Row 1 — two EQUAL (50/50) cells; project name right-aligned.
        {
          table: {
            widths: ["*", "*"],
            body: [
              [
                cellBold(BYGHERRE_PLACEHOLDER),
                { text: project, bold: true, alignment: "right" as const },
              ],
            ],
          },
          layout: {
            hLineWidth: bottomRule,
            vLineWidth: () => 0,
            hLineColor: () => "#888",
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 4, // air before the rule
          },
        },
        // Rows 2-4 — wide left column + fixed narrow meta block. The right
        // column is a fixed box (label + colon + value) so the colons and
        // right edges line up perfectly across the three rows.
        {
          margin: [0, 4, 0, 0], // air after the rule
          table: {
            widths: ["*", META_RIGHT_COL_WIDTH],
            body: [
              [
                cell(ENTREPRISEFORM_PLACEHOLDER),
                metaCell("Dato", args.dateText),
              ],
              [cell(workArea), metaCell("Rev.dato", revDate)],
              [
                cell(docLabel),
                metaCell(
                  "Side",
                  `${currentPage + pageOffset}/${pageCount + pageOffset}`,
                ),
              ],
            ],
          },
          layout: {
            hLineWidth: bottomRule,
            vLineWidth: () => 0,
            hLineColor: () => "#888",
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 1,
            paddingBottom: () => 1,
          },
        },
      ],
    };
  };
}

/**
 * Fixed widths for the right-column label/colon/value block. Chosen so:
 *   - "Rev.dato" (longest label in practice) fits comfortably at body
 *     font size without wrapping.
 *   - Values like "2026-04-20" right-align flush to the column's right
 *     edge, matching where `project` right-aligns on row 1.
 * The sum (LABEL + COLON + VALUE) is what the outer table uses as the
 * right-column width.
 */
const META_LABEL_WIDTH = 50;
const META_COLON_WIDTH = 8;
const META_VALUE_WIDTH = 70;
const META_RIGHT_COL_WIDTH =
  META_LABEL_WIDTH + META_COLON_WIDTH + META_VALUE_WIDTH;

/**
 * Regular left-column text cell.
 *
 * No explicit `fontSize` / `fontFamily` so the cell inherits the
 * document's `defaultStyle` (body text). Tore wants the header
 * visually consistent with the body font, not tinier than it.
 */
function cell(text: string): Content {
  return { text, color: "#444" };
}

/** Bold left-column cell (used for the "Bygherre" label). */
function cellBold(text: string): Content {
  return { text, bold: true };
}

/**
 * Right-column label:value cell. Uses a 3-column layout internally so:
 *   - Labels ("Dato", "Rev.dato", "Side") are LEFT-aligned in their
 *     column — matching the BIPS reference.
 *   - Colons sit in their own narrow fixed-width column so every ":"
 *     lines up vertically across rows 2-4.
 *   - Values are right-aligned, hugging the header's right edge just
 *     like the bold project name on row 1.
 *
 * Widths come from the shared constants so the outer table's right
 * column (`META_RIGHT_COL_WIDTH`) and the inner columns stay in sync.
 */
function metaCell(label: string, value: string): Content {
  return {
    columns: [
      {
        text: label,
        width: META_LABEL_WIDTH,
        alignment: "left",
        color: "#444",
      },
      {
        text: ":",
        width: META_COLON_WIDTH,
        alignment: "left",
        color: "#444",
      },
      {
        text: value,
        width: META_VALUE_WIDTH,
        alignment: "right",
        color: "#444",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Running footer — company name + page N/M under a horizontal rule
// ---------------------------------------------------------------------------

/**
 * Build the running footer. Layout:
 *
 *     (blank line of breathing room)
 *     ────────────────────────────────────────── (hline)
 *     Company name                    Page N of M
 *
 * Hidden on page 1 so the cover page stays clean.
 */
export function makeFooter(
  args: PdfChromeArgs,
  margins: PdfChromeMargins = STANDARD_CHROME_MARGINS,
  skipFirstPage = true,
  pageOffset = 0,
): ChromeFn {
  return (currentPage, pageCount) => {
    if (skipFirstPage && currentPage === 1) return { text: "" };
    return {
      // Caller-provided margins; defaults match the new 2026-05-12
      // spec (15 mm from page bottom to footer rule). CP PDF passes
      // its own narrower margins via CP_CHROME_MARGINS.
      margin: [
        margins.marginLeft,
        margins.footerTop,
        margins.marginRight,
        margins.footerBottom,
      ],
      table: {
        widths: ["*", "auto"],
        body: [
          [
            {
              // Inherits the document's `defaultStyle.fontSize` so the
              // footer matches body text. (Was hard-coded to 8pt.)
              text: args.companyName,
              color: "#666",
            },
            {
              text: `Page ${currentPage + pageOffset} of ${pageCount + pageOffset}`,
              color: "#666",
              alignment: "right",
            },
          ],
        ],
      },
      layout: {
        // Thin rule above the only row; no other borders.
        hLineWidth: (i: number) => (i === 0 ? 0.5 : 0),
        vLineWidth: () => 0,
        hLineColor: () => "#888",
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 6,
        paddingBottom: () => 0,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

/**
 * Inputs for the cover-page stub. Extends `PdfChromeArgs` with the
 * big title block + the contract label (contract appears only on the
 * cover; the BIPS running header has no slot for it).
 */
export interface PdfCoverArgs extends PdfChromeArgs {
  /** Headline (big). Usually the spec's title. */
  title: string;
  /** Optional second line under the title. */
  subtitle?: string | null;
  /** Optional revision tag — printed below the subtitle. */
  revision?: string | null;
  revisionDate?: string | null;
  /** Contract label shown on the cover (e.g. "01 - Fagentreprise"). */
  contractLabel?: string | null;
  /**
   * Page orientation. Vertical spacers are tuned per-orientation so
   * the cover fits on one page in both A4 portrait (~842pt tall) and
   * A4 landscape (~595pt tall). Defaults to "portrait".
   */
  orientation?: "portrait" | "landscape";
}

/**
 * Build the cover-page content nodes. The caller is responsible for
 * appending these to the document's `content` array. The last node
 * here already carries `pageBreak: "after"` so the body starts on
 * page 2.
 */
export function makeCover(args: PdfCoverArgs): Content[] {
  const { title, subtitle, revision, revisionDate } = args;
  const landscape = args.orientation === "landscape";

  // Vertical spacers are the only thing that changes with orientation.
  // Portrait A4 is ~842pt tall, landscape A4 is only ~595pt, so the
  // portrait-tuned gaps used to overflow onto page 2 in CP PDFs.
  const topSpacer = landscape ? 30 : 60;
  const revBottomGap = landscape ? 60 : 120;
  const bottomSpacer = landscape ? 120 : 260;

  const content: Content[] = [];

  content.push({ text: "", margin: [0, topSpacer, 0, 0] });

  content.push({
    text: title,
    fontSize: 26,
    bold: true,
    margin: [0, 0, 0, 6],
  });
  if (subtitle) {
    content.push({
      text: subtitle,
      fontSize: 14,
      color: "#555",
      margin: [0, 0, 0, 8],
    });
  }

  const revBits: string[] = [];
  if (revision) revBits.push(`Revision: ${revision}`);
  if (revisionDate) revBits.push(`Revision date: ${revisionDate}`);
  if (revBits.length > 0) {
    content.push({
      text: revBits.join("   ·   "),
      fontSize: 10,
      color: "#666",
      margin: [0, 0, 0, revBottomGap],
    });
  } else {
    content.push({ text: "", margin: [0, revBottomGap, 0, 0] });
  }

  if (args.projectName) {
    content.push({
      text: args.projectName,
      fontSize: 12,
      bold: true,
      margin: [0, 0, 0, 4],
    });
  }
  if (args.contractLabel) {
    content.push({
      text: args.contractLabel,
      fontSize: 10,
      color: "#555",
      margin: [0, 0, 0, 4],
    });
  }

  content.push({ text: "", margin: [0, bottomSpacer, 0, 0] });
  content.push({
    text: args.companyName,
    fontSize: 10,
    color: "#777",
    pageBreak: "after",
  });

  return content;
}
