/**
 * Pure PDF doc-definition builder for Control Plan specs.
 *
 * Sibling of `buildSpecPdf.ts` — same deal: returns a plain
 * `TDocumentDefinitions` so unit tests can check structure without
 * pulling pdfmake into the test runtime.
 *
 * 7.1 delivered: title + metadata + grouped control-plan table.
 *
 * 7.2 adds:
 *   - Optional cover page (default on) — same stub as specs.
 *   - Running header + footer via `pdfChrome`.
 *   - `dontBreakRows` on the table so a row never splits across a
 *     page break; the header row already repeats via `headerRows: 1`.
 *
 * Layout stays A4 landscape — the CP table has 11 columns of
 * meaningful data, so portrait cramps it unreadably.
 */
import type {
  TDocumentDefinitions,
  Content,
  TableCell,
} from "pdfmake/interfaces";

import type {
  ControlPlanHeaderData,
  ControlPlanRowData,
} from "../../../shared/ipc.js";
import { controlTypeBadge, groupRowsByHeader } from "../controlPlanView.js";
import {
  CP_CHROME_MARGINS,
  CP_PAGE_MARGINS_PT,
  makeCover,
  makeFooter,
  makeHeader,
  type PdfChromeArgs,
} from "./pdfChrome.js";

/**
 * Input to the CP builder. Intentionally doesn't take the full
 * ControlPlanInfo because the builder only needs the display fields —
 * keeping the surface small means tests don't have to fabricate DB ids.
 */
export interface BuildCpPdfArgs {
  /** Display number — e.g. "1.2.3" or whatever Molio stored. */
  numberText: string;
  /** Headline shown at the top of page one. */
  title: string;
  /** Owner label — e.g. "Work area 2.5 Beton – BDB 2.5.1 Fundering".
   *  Optional; hidden when null/empty. */
  ownerLabel?: string | null;
  /** Optional revision tag. */
  revision?: string | null;
  revisionDate?: string | null;
  /** Project name shown in the small metadata block + chrome. */
  projectName?: string | null;
  /** Contract label for the cover only (BIPS header has no slot). */
  contractLabel?: string | null;
  /**
   * Name of the parent work area — printed in row 3 (left column) of
   * the BIPS running header. For CP PDFs this is the work area that
   * owns the BDB that owns this control plan. Null prints blank.
   */
  workAreaName?: string | null;
  /**
   * Today's date, pre-formatted as a string — goes into the header's
   * "Dato :" field. Caller controls format (ISO `YYYY-MM-DD` by
   * convention). If omitted, the builder fills in today's date.
   */
  dateText?: string;
  /**
   * Footer-left literal text. Icebox #119 — for now the caller
   * passes the hard-coded `"Company name"`.
   */
  companyName: string;
  /** Cover page on/off. Defaults to true. */
  includeCoverPage?: boolean;
  /** Add this many pages to the displayed page numbers (1 when a custom
   *  cover is prepended after rendering). Default 0. */
  pageNumberOffset?: number;
  /** Group headers for this plan, pre-sorted by `headerNo`. */
  headers: ControlPlanHeaderData[];
  /** All rows for this plan, pre-sorted by `sectionNo`. */
  rows: ControlPlanRowData[];
}

/**
 * Columns printed in the PDF. Order matches the editor view in
 * `ControlPlanTableView.tsx`, with `controlType` first because a reader
 * typically scans for the control-type badge first.
 *
 * `widthStar` is in pdfmake units. We mix `*` (proportional) and fixed
 * widths so the numeric columns stay narrow while the prose columns
 * can stretch.
 */
const COLUMNS: {
  key:
    | "controlType"
    | "sectionNo"
    | "subject"
    | "reference"
    | "method"
    | "quantity"
    | "time"
    | "acceptanceCriteria"
    | "documentation"
    | "controlLevel"
    | "sampleLevel";
  label: string;
  /** pdfmake width spec. Numbers = fixed pt, `*` = flex share. */
  width: number | "*";
}[] = [
  { key: "controlType", label: "Type", width: 34 },
  { key: "sectionNo", label: "Nr.", width: 30 },
  { key: "subject", label: "Emne", width: "*" },
  { key: "reference", label: "Reference", width: 70 },
  { key: "method", label: "Metode", width: "*" },
  { key: "quantity", label: "Mængde", width: 55 },
  { key: "time", label: "Tidspunkt", width: 60 },
  { key: "acceptanceCriteria", label: "Acceptkriterier", width: "*" },
  { key: "documentation", label: "Dokumentation", width: 80 },
  { key: "controlLevel", label: "Kontrol-\nniveau", width: 55 },
  { key: "sampleLevel", label: "Prøve-\nniveau", width: 55 },
];

/**
 * Extract one column's display value from a row. Centralised so the
 * per-column switch only lives in one place — adding a column means
 * touching `COLUMNS` and this function.
 */
function cellValue(
  row: ControlPlanRowData,
  key: (typeof COLUMNS)[number]["key"],
): string {
  switch (key) {
    case "controlType":
      return controlTypeBadge(row.controlType);
    case "sectionNo":
      return row.sectionNo;
    case "subject":
      return row.subject;
    case "reference":
      return row.reference;
    case "method":
      return row.method;
    case "quantity":
      return row.quantity;
    case "time":
      return row.time;
    case "acceptanceCriteria":
      return row.acceptanceCriteria;
    case "documentation":
      return row.documentation;
    case "controlLevel":
      return row.controlLevel;
    case "sampleLevel":
      return row.sampleLevel;
  }
}

/**
 * Build the final pdfmake doc definition for one control plan.
 * Safe to call many times — no hidden state, no I/O.
 */
export function buildCpPdf(args: BuildCpPdfArgs): TDocumentDefinitions {
  const {
    numberText,
    title,
    ownerLabel,
    revision,
    revisionDate,
    projectName,
    contractLabel,
    workAreaName,
    dateText,
    companyName,
    includeCoverPage = true,
    pageNumberOffset = 0,
    headers,
    rows,
  } = args;

  const fullTitle = numberText ? `${numberText}  ${title}` : title;

  // Row 4 of the BIPS header for CP PDFs: use the CP's numbered title
  // (e.g. "1.2.3  Beton"). This keeps CP headers distinguishable from
  // BDB headers (which show the BDB name on this row).
  const documentLabel = fullTitle;

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
        title: fullTitle,
        subtitle: ownerLabel ?? null,
        revision: revision ?? null,
        revisionDate: revisionDate ?? null,
        contractLabel: contractLabel ?? null,
        // CP PDFs are landscape — use tighter vertical spacers so the
        // cover fits on page 1 instead of spilling a "Company name"
        // line onto page 2.
        orientation: "landscape",
      }),
    );
  }

  // Title block ---------------------------------------------------------
  content.push({ text: fullTitle, style: "title" });
  if (ownerLabel) {
    content.push({ text: ownerLabel, style: "subtitle" });
  }

  // Small metadata block ------------------------------------------------
  const metaLines: string[] = ["Kind: Control plan"];
  if (projectName) metaLines.push(`Project: ${projectName}`);
  if (revision) metaLines.push(`Revision: ${revision}`);
  if (revisionDate) metaLines.push(`Revision date: ${revisionDate}`);
  content.push({ text: metaLines.join("   ·   "), style: "meta" });

  // Table ---------------------------------------------------------------
  const groups = groupRowsByHeader(headers, rows);
  const hasAnyRows = groups.some((g) => g.rows.length > 0);
  if (!hasAnyRows) {
    content.push({
      text: "(no control-plan rows)",
      style: "empty",
      italics: true,
    });
  } else {
    content.push(buildTable(groups));
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    // CP-specific page margins (kept tight per Tore's request — the
    // wider standard margins squeeze the landscape table). Header +
    // footer also get the matching narrower set so they stay aligned
    // with the CP's body text.
    pageMargins: CP_PAGE_MARGINS_PT,
    header: makeHeader(
      chromeArgs,
      CP_CHROME_MARGINS,
      includeCoverPage,
      pageNumberOffset,
    ),
    footer: makeFooter(
      chromeArgs,
      CP_CHROME_MARGINS,
      includeCoverPage,
      pageNumberOffset,
    ),
    content,
    defaultStyle: { fontSize: 8 },
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 11, color: "#555", margin: [0, 0, 0, 10] },
      meta: { fontSize: 8, color: "#555", margin: [0, 0, 0, 12] },
      th: { bold: true, fillColor: "#eeeeee", fontSize: 8 },
      groupRow: { bold: true, fillColor: "#f7f7f7", fontSize: 9 },
      empty: { fontSize: 10, color: "#888" },
    },
    info: {
      title: fullTitle,
      creator: "Spec Editor Community",
    },
  };
}

/**
 * Build the pdfmake `table` content node from the already-grouped rows.
 * Extracted so `buildCpPdf` stays readable and so future work (row
 * striping, page-break control per group) has an obvious home.
 */
function buildTable(
  groups: ReadonlyArray<{
    header: ControlPlanHeaderData;
    rows: ControlPlanRowData[];
  }>,
): Content {
  // Header row
  const headerRow: TableCell[] = COLUMNS.map((col) => ({
    text: col.label,
    style: "th",
  }));

  const body: TableCell[][] = [headerRow];

  for (const group of groups) {
    if (group.rows.length === 0) continue;
    // Group row — spans all columns. pdfmake uses `colSpan` on the
    // first cell; the other N-1 cells must still be present (empty).
    const groupCell: TableCell = {
      text: group.header.headerNo
        ? `${group.header.headerNo}  ${group.header.header}`
        : group.header.header,
      colSpan: COLUMNS.length,
      style: "groupRow",
    };
    const spannerRow: TableCell[] = [groupCell];
    for (let i = 1; i < COLUMNS.length; i++) spannerRow.push({ text: "" });
    body.push(spannerRow);
    // Data rows
    for (const r of group.rows) {
      body.push(
        COLUMNS.map((col) => ({
          text: cellValue(r, col.key),
          // Centre the control-type badge so "E"/"U"/"T"/"—" aren't
          // hugging the left edge.
          alignment: col.key === "controlType" ? "center" : "left",
        })),
      );
    }
  }

  return {
    table: {
      headerRows: 1,
      // Keep each row (including the group spanner) intact across page
      // breaks — pdfmake otherwise splits tall rows mid-cell, which
      // looks broken on a CP table where cells often wrap.
      dontBreakRows: true,
      widths: COLUMNS.map((c) => c.width),
      body,
    },
    layout: "lightHorizontalLines",
    fontSize: 8,
  };
}

/**
 * Today's date as ISO (YYYY-MM-DD). Used as the fallback when the
 * caller doesn't pass `dateText`. Matches `buildSpecPdf`'s helper so
 * both PDFs format the header date identically.
 */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
