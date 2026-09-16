/**
 * "Is this control plan empty?" — shared by the main process (which sets
 * `ControlPlanInfo.isEmpty` on the payload) so the sidebar can mark + hide
 * empty plans (#255).
 *
 * Deliberately STRICTER than `cpSlots.rowHasContent` (the delete-row
 * warning). A control plan seeded from a Molio default template arrives
 * with skeleton rows that carry a section number but no actual content —
 * the user rightly sees those as empty. So a row counts as content only
 * when it has a real control-type selection or text in a meaningful
 * column. The section number alone (structure, not content) does NOT
 * count, and group headers are ignored entirely (they live in a separate
 * table, never in the detail rows passed here).
 */

/** The detail-row fields we look at. A subset of `ControlPlanRowData`. */
export interface CpEmptyRow {
  controlType: number;
  subject: string;
  reference: string;
  method: string;
  quantity: string;
  time: string;
  acceptanceCriteria: string;
  documentation: string;
  controlLevel: string;
  sampleLevel: string;
}

/**
 * A cell is "blank" when it's empty OR a Molio template placeholder token
 * such as `<Emne 1>` / `<Reference>` (angle-bracketed). Those are scaffold
 * text the user hasn't filled in, so they don't count as real content.
 */
function isBlankOrPlaceholder(value: string | null | undefined): boolean {
  const t = (value ?? "").trim();
  if (t.length === 0) return true;
  // e.g. "<Emne 1>", "<Reference>", "<...>"
  return /^<.*>$/.test(t);
}

/** True when the row carries real content (ignores the section number
 *  and template placeholders like `<Emne 1>`). */
export function cpRowHasContent(row: CpEmptyRow): boolean {
  if (row.controlType !== 0) return true;
  const texts = [
    row.subject,
    row.reference,
    row.method,
    row.quantity,
    row.time,
    row.acceptanceCriteria,
    row.documentation,
    row.controlLevel,
    row.sampleLevel,
  ];
  return texts.some((s) => !isBlankOrPlaceholder(s));
}

/**
 * True when a control plan has no rows, or every row is a blank skeleton
 * row (section number only / nothing).
 */
export function controlPlanIsEmpty(rows: readonly CpEmptyRow[]): boolean {
  return !rows.some(cpRowHasContent);
}
