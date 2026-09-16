/**
 * Pure Word-export builder for one Control Plan.
 *
 * Uses `Molio_2_ControlPlan_Template.docx` as the styling template
 * (landscape A4 with a 9-column table for the CP rows + a header
 * carrying the project/parent labels). We:
 *
 *   1. Replace the placeholder text in the header XMLs with the
 *      parent spec name (the BDB referencing this CP) and the CP's
 *      own title.
 *   2. Strip the template's placeholder data rows (the "1.1"…"2.6"
 *      starter rows) and inject real rows from the CP's
 *      `cpHeadersByPlan` + `cpRowsByPlan` data.
 *      Each group header becomes a merged-cell banner row spanning
 *      all 9 columns; each data row carries the standard 9 columns.
 *
 * Compact mode (Tore decision)
 * ----------------------------
 * `compact: true` drops rows whose nine display columns (sectionNo
 * is included only when there's no other content alongside it) are
 * all blank. A group header is dropped only if every row under it
 * was also dropped — so empty groups never appear, but partial
 * groups always show their banner.
 *
 * Bygherre / Byggesag label enrichment is INTENTIONALLY skipped
 * here — tracked as a cross-cutting future task (TPL-ProjectMeta).
 */

import { strFromU8, unzipSync, zipSync } from "fflate";

import type {
  BdbInfo,
  ControlPlanInfo,
  ControlPlanHeaderData,
  ControlPlanRowData,
  FilePayload,
} from "../../../shared/ipc.js";
import { BdbDocxBuildError, toBytes } from "./buildBdbDocx.js";
import { escapeXmlText } from "./ooxmlEscape.js";
import { getCpTemplateBytes } from "./cpTemplateBytes.js";

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface BuildCpDocxArgs {
  /** Whole loaded file — we need the CP itself + its rows + headers,
   *  plus the BDB list so we can resolve the parent spec name for
   *  the header substitution. */
  data: FilePayload;
  /** Which control plan to export. */
  controlPlanId: number;
  /** Optional template override. Defaults to the bundled CP template. */
  templateBytes?: Uint8Array;
  /** Compact mode — see module doc. */
  compact?: boolean;
}

/**
 * Build a `.docx` byte array for one Control Plan.
 *
 * Throws `BdbDocxBuildError` (`no-cp` / `bad-template`) on lookup
 * or template-shape problems. The renderer / MCP wrapper catches
 * and surfaces a friendly message.
 */
export function buildCpDocx(args: BuildCpDocxArgs): Uint8Array {
  const cp = args.data.controlPlans.find((c) => c.id === args.controlPlanId);
  if (!cp) {
    throw new BdbDocxBuildError(
      "no-cp",
      `No control plan with id ${args.controlPlanId} in the open file.`,
    );
  }

  const templateBytes = args.templateBytes ?? getCpTemplateBytes();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(templateBytes);
  } catch (err) {
    throw new BdbDocxBuildError(
      "bad-template",
      `Could not read the CP Word template: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const docXmlBytes = files["word/document.xml"];
  if (!docXmlBytes) {
    throw new BdbDocxBuildError(
      "bad-template",
      "CP template is missing word/document.xml.",
    );
  }

  // Header text substitutions: parent spec name, CP title, and the
  // project name (which replaces the literal "Byggesag" label so the
  // top-right cell matches what the PDF chrome shows).
  const parentName = resolveParentSpecName(args.data, cp.id);
  const cpTitle = (cp.title ?? "").trim() || "Kontrolplan";
  const projectName = args.data.project?.name?.trim() ?? "";
  patchHeaderXmls(files, parentName, cpTitle, projectName);

  // Body: replace the template's placeholder rows with real CP data.
  const headers = args.data.cpHeadersByPlan[cp.id] ?? [];
  const rows = args.data.cpRowsByPlan[cp.id] ?? [];
  const newDocXml = injectCpTable(
    strFromU8(docXmlBytes),
    headers,
    rows,
    args.compact === true,
  );
  files["word/document.xml"] = toBytes(newDocXml);

  return zipSync(files);
}

/* ------------------------------------------------------------------ */
/*  Header substitutions                                              */
/* ------------------------------------------------------------------ */

/** Placeholders Tore left in the template that we substitute. Kept as
 *  module-level constants so tests can assert exact strings. */
const PARENT_NAME_PLACEHOLDER = "Vindue, dør og port, leverance";
const CP_TITLE_PLACEHOLDER = "Kontrolskema, projektering, særlige kontroller";

/**
 * Patch every header*.xml in the unzipped template to substitute:
 *   - the parent BDB name (replaces the "Vindue, dør..." placeholder)
 *   - the CP title (replaces the "Kontrolskema..." placeholder)
 *
 * Mutates `files` in place. Idempotent on subsequent calls — if a
 * header doesn't contain a placeholder it's left alone.
 */
function patchHeaderXmls(
  files: Record<string, Uint8Array>,
  parentName: string,
  cpTitle: string,
  projectName: string,
): void {
  const safeParent = escapeXmlText(parentName);
  const safeTitle = escapeXmlText(cpTitle);
  const safeProject = escapeXmlText(projectName);
  for (const path of Object.keys(files)) {
    if (!/^word\/header\d+\.xml$/.test(path)) continue;
    let text = strFromU8(files[path]!);
    let dirty = false;
    if (text.includes(PARENT_NAME_PLACEHOLDER)) {
      text = text.split(PARENT_NAME_PLACEHOLDER).join(safeParent);
      dirty = true;
    }
    if (text.includes(CP_TITLE_PLACEHOLDER)) {
      text = text.split(CP_TITLE_PLACEHOLDER).join(safeTitle);
      dirty = true;
    }
    // FIX (2026-05-26): replace the literal "Byggesag" label with
    // the project name so the Word top-right cell matches the PDF
    // chrome. Regex handles both `<w:t>Byggesag</w:t>` and the
    // `xml:space="preserve"` variant the CP template uses.
    if (projectName !== "") {
      const before = text;
      text = text.replace(
        /<w:t([^>]*)>Byggesag<\/w:t>/g,
        `<w:t$1>${safeProject}</w:t>`,
      );
      if (text !== before) dirty = true;
    }
    if (dirty) files[path] = toBytes(text);
  }
}

/**
 * Find the BDB that references this control plan via its
 * `controlPlanIds` (each BDB carries 0-2 ids). Returns the first
 * match's name, or a generic fallback when the CP is "homeless"
 * (no BDB references it — usually because the BDB was deleted out
 * from under it).
 *
 * If multiple BDBs reference the same CP we use the first match in
 * `data.bdbs` order — same tie-breaker the sidebar uses for the
 * "owning BDB" label.
 */
function resolveParentSpecName(data: FilePayload, cpId: number): string {
  for (const bdb of data.bdbs) {
    if (bdb.controlPlanIds.includes(cpId)) {
      return (bdb.name ?? "").trim() || "Bygningsdelsbeskrivelse";
    }
  }
  return "Kontrolplan";
}

/* ------------------------------------------------------------------ */
/*  Body table replacement                                            */
/* ------------------------------------------------------------------ */

/**
 * Standard column widths in twentieths-of-a-point (dxa). Copied
 * verbatim from the template's `<w:tblGrid>`. Order matches the
 * column meanings in `renderDataRow`.
 *
 * Total: 1682+1682+907+1701+1701+2551+1701+1700+1701 = 15326 dxa.
 */
const COL_WIDTHS = [
  1682, // Nr
  1682, // Emne
  907, // Kontroltype
  1701, // Grundlag
  1701, // Metode
  2551, // Kontrolniveau
  1701, // Acceptkriterie
  1700, // Tidspunkt
  1701, // Dokumentation
] as const;

/** Total table width — used for the merged group-banner row. */
const TOTAL_TABLE_WIDTH = COL_WIDTHS.reduce((a, b) => a + b, 0);

/**
 * Replace the template's placeholder data rows with real CP data.
 *
 * Strategy
 * --------
 * The template has one `<w:tbl>` containing:
 *   - One header row (carries `<w:tblHeader/>` in its `<w:trPr>`).
 *   - 13 placeholder rows numbered "1.1"…"2.6" — these are decoy
 *     content that we strip wholesale.
 *
 * We:
 *   1. Locate the `<w:tbl>...</w:tbl>` span.
 *   2. Find every `<w:tr>...</w:tr>` inside it.
 *   3. Preserve the first row (the header) unchanged.
 *   4. Drop the rest, replace with our generated rows.
 *
 * The injected content is plain string XML; we never round-trip
 * through a DOM parser — the OOXML the template produces is stable
 * enough that string splicing is safe and predictable.
 */
function injectCpTable(
  docXml: string,
  headers: ControlPlanHeaderData[],
  rows: ControlPlanRowData[],
  compact: boolean,
): string {
  const tblOpenIdx = docXml.indexOf("<w:tbl>");
  const tblCloseIdx = docXml.indexOf("</w:tbl>", tblOpenIdx);
  if (tblOpenIdx < 0 || tblCloseIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "CP template's document.xml is missing the <w:tbl> body table.",
    );
  }
  const tblContentStart = tblOpenIdx + "<w:tbl>".length;
  const tblBody = docXml.slice(tblContentStart, tblCloseIdx);

  // Find rows + grid/props by scanning for `<w:tr>` boundaries. We
  // keep `<w:tblPr>` and `<w:tblGrid>` (everything BEFORE the first
  // `<w:tr>`) verbatim, then keep the first `<w:tr>` (header), then
  // drop the rest and replace.
  const firstTrIdx = tblBody.indexOf("<w:tr>");
  if (firstTrIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "CP template's <w:tbl> has no rows.",
    );
  }
  const prelude = tblBody.slice(0, firstTrIdx);

  // First row's full extent (header row).
  const firstTrCloseIdx = tblBody.indexOf("</w:tr>", firstTrIdx);
  if (firstTrCloseIdx < 0) {
    throw new BdbDocxBuildError(
      "bad-template",
      "CP template's first <w:tr> is unterminated.",
    );
  }
  const headerRowEnd = firstTrCloseIdx + "</w:tr>".length;
  const headerRow = tblBody.slice(firstTrIdx, headerRowEnd);

  // Build the replacement body: header row + generated rows.
  const generatedRows = buildCpRows(headers, rows, compact);
  const newTblBody = prelude + headerRow + generatedRows;

  return (
    docXml.slice(0, tblContentStart) + newTblBody + docXml.slice(tblCloseIdx)
  );
}

/**
 * Build OOXML for the data rows: a merged-cell group banner per
 * `ControlPlanHeaderData`, followed by all the data rows belonging
 * to that header (matched by `row.headerId === header.id`).
 *
 * Compact: a row is hidden when every editable column is blank
 * AND `controlType` is 0 (= "not selected"). The banner row is
 * hidden when every row under it is hidden.
 *
 * Rows whose `headerId` doesn't match any known header are emitted
 * at the bottom under a synthetic "Uden gruppe" banner so they
 * still reach the document — losing data silently is worse than
 * a faintly-named bucket.
 */
function buildCpRows(
  headers: ControlPlanHeaderData[],
  rows: ControlPlanRowData[],
  compact: boolean,
): string {
  // Index rows by headerId for quick lookup. Preserve order via
  // `sortStableByIndex` — we keep the order the renderer gave us.
  const rowsByHeader = new Map<number, ControlPlanRowData[]>();
  const orphanedRows: ControlPlanRowData[] = [];
  const knownHeaderIds = new Set(headers.map((h) => h.id));
  for (const row of rows) {
    if (!knownHeaderIds.has(row.headerId)) {
      orphanedRows.push(row);
      continue;
    }
    const list = rowsByHeader.get(row.headerId);
    if (list) list.push(row);
    else rowsByHeader.set(row.headerId, [row]);
  }

  const parts: string[] = [];

  for (const header of headers) {
    const groupRows = rowsByHeader.get(header.id) ?? [];
    const visibleRows = compact
      ? groupRows.filter((r) => !isBlankRow(r))
      : groupRows;
    if (compact && visibleRows.length === 0) {
      // Drop the whole group when compact ON and nothing under it.
      continue;
    }
    parts.push(renderGroupBanner(`${header.headerNo}  ${header.header}`));
    for (const row of visibleRows) {
      parts.push(renderDataRow(row));
    }
  }

  if (orphanedRows.length > 0) {
    const visibleOrphans = compact
      ? orphanedRows.filter((r) => !isBlankRow(r))
      : orphanedRows;
    if (visibleOrphans.length > 0) {
      parts.push(renderGroupBanner("Uden gruppe"));
      for (const row of visibleOrphans) {
        parts.push(renderDataRow(row));
      }
    }
  }

  return parts.join("");
}

/**
 * True when every user-editable column on the row is empty AND the
 * control type is "not selected" (0). Used by compact mode.
 *
 * `sectionNo` is auto-derived from row position and isn't user
 * content — we don't count it here.
 */
function isBlankRow(row: ControlPlanRowData): boolean {
  if (row.controlType !== 0) return false;
  const fields: Array<string | undefined | null> = [
    row.subject,
    row.reference,
    row.method,
    row.controlLevel,
    row.acceptanceCriteria,
    row.time,
    row.documentation,
  ];
  return fields.every((v) => !v || v.trim() === "");
}

/**
 * True when a Control Plan contains at least one row with any
 * user-entered data (anywhere — at least one populated column OR a
 * non-zero controlType). Exported because both the GUI Word path
 * (`useDocxExport`) and the MCP Word path (`useMcpExportBridge`) use
 * this to silently skip empty CPs — mirroring the PDF flow's
 * behaviour. A CP is "empty" when:
 *   - `cpRowsByPlan[cpId]` is missing or zero-length, OR
 *   - every row in it satisfies `isBlankRow`.
 */
export function cpHasAnyData(
  data: FilePayload,
  controlPlanId: number,
): boolean {
  const rows = data.cpRowsByPlan[controlPlanId] ?? [];
  if (rows.length === 0) return false;
  return rows.some((r) => !isBlankRow(r));
}

/**
 * Convert the integer `controlType` to its display character:
 *   0 → ""   (not selected)
 *   1 → "E"  (Egenkontrol)
 *   2 → "U"  (Uafhængig)
 *   3 → "T"  (Tredjepart)
 *
 * Any other value falls back to empty string — same robust default
 * the CP table view uses.
 */
function controlTypeLabel(controlType: number): string {
  switch (controlType) {
    case 1:
      return "E";
    case 2:
      return "U";
    case 3:
      return "T";
    default:
      return "";
  }
}

/**
 * One group banner row — a single `<w:tc>` spanning all 9 columns
 * with a light-grey fill so it visually separates from the data
 * rows. The text is rendered bold to mirror the PDF banner styling.
 */
function renderGroupBanner(label: string): string {
  const text = escapeXmlText(label);
  return (
    `<w:tr>` +
    `<w:trPr><w:cantSplit/></w:trPr>` +
    `<w:tc>` +
    `<w:tcPr>` +
    `<w:tcW w:type="dxa" w:w="${TOTAL_TABLE_WIDTH}"/>` +
    `<w:gridSpan w:val="${COL_WIDTHS.length}"/>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>` +
    `</w:tcPr>` +
    `<w:p>` +
    `<w:pPr><w:spacing/><w:rPr><w:b/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="18"/></w:rPr>` +
    `<w:t xml:space="preserve">${text}</w:t></w:r>` +
    `</w:p>` +
    `</w:tc>` +
    `</w:tr>`
  );
}

/**
 * One data row — 9 `<w:tc>` cells whose widths match the template's
 * `<w:tblGrid>`. Text is plain (no inline formatting), Arial 9pt to
 * match the template's body styling.
 *
 * Column order: Nr / Emne / Kontroltype / Grundlag / Metode /
 *               Kontrolniveau / Acceptkriterie / Tidspunkt /
 *               Dokumentation.
 */
function renderDataRow(row: ControlPlanRowData): string {
  const values: string[] = [
    row.sectionNo ?? "",
    row.subject ?? "",
    controlTypeLabel(row.controlType),
    row.reference ?? "",
    row.method ?? "",
    row.controlLevel ?? "",
    row.acceptanceCriteria ?? "",
    row.time ?? "",
    row.documentation ?? "",
  ];
  const cells = values.map((v, i) =>
    renderDataCell(v, COL_WIDTHS[i]!, i === 0),
  );
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join("")}</w:tr>`;
}

/**
 * Single data cell. `bold` is used for the Nr column to match the
 * template's existing styling of "1.1"…"2.6" numbers.
 */
function renderDataCell(text: string, width: number, bold: boolean): string {
  const escaped = escapeXmlText(text);
  const bRpr = bold ? "<w:b/>" : "";
  return (
    `<w:tc>` +
    `<w:tcPr><w:tcW w:type="dxa" w:w="${width}"/><w:tcBorders/></w:tcPr>` +
    `<w:p>` +
    `<w:pPr><w:spacing/><w:rPr/></w:pPr>` +
    `<w:r>` +
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>${bRpr}<w:sz w:val="18"/></w:rPr>` +
    `<w:t xml:space="preserve">${escaped}</w:t>` +
    `</w:r>` +
    `</w:p>` +
    `</w:tc>`
  );
}

/* ------------------------------------------------------------------ */
/*  Re-exports for tests + bridge code                                 */
/* ------------------------------------------------------------------ */

// Re-export for use sites that want to look up the CP's display
// title without re-implementing the trimming rule.
export function cpDocFilenameLabel(cp: ControlPlanInfo): string {
  const num = (cp.numberText ?? "").trim();
  const title = (cp.title ?? "").trim();
  if (num && title) return `${num} ${title}`;
  return num || title || `Kontrolplan ${cp.id}`;
}

/** Exposed for tests so they can assert which BDB the lookup
 *  resolves to without going through the full builder. */
export const _internal = {
  resolveParentSpecName,
  isBlankRow,
  controlTypeLabel,
  PARENT_NAME_PLACEHOLDER,
  CP_TITLE_PLACEHOLDER,
};
