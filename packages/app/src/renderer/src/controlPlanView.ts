/**
 * Pure helpers for the Control Plan Editor (View 3).
 *
 * Keep these logic-only and DOM-free so they can be unit tested
 * without React. The component in `ControlPlanTableView.tsx` consumes
 * what these produce.
 */

import type {
  ControlPlanHeaderData,
  ControlPlanRowData,
} from "../../shared/ipc.js";

/**
 * The 4 control-type values Molio stores. Matches core's `ControlType`
 * enum: 0 = not selected, 1 = E (Egenkontrol), 2 = U (Uafhængig),
 * 3 = T (Tredjepart).
 */
export type ControlTypeCode = 0 | 1 | 2 | 3;

/** One group in the table — its header + the rows under it, in order. */
export interface ControlPlanGroup {
  header: ControlPlanHeaderData;
  rows: ControlPlanRowData[];
}

/**
 * Bucket the flat rows list under the provided headers. Rows whose
 * `headerId` doesn't resolve to a known header land in a synthetic
 * "orphans" group at the end — we never silently drop data, because
 * doing so would hide bugs in either the file or our import.
 *
 * Headers come in already sorted (by `headerNo`). Rows inside each
 * group keep the caller's row order — main's IPC handler pre-sorts by
 * `sectionNo`, so no re-sort here.
 */
export function groupRowsByHeader(
  headers: ControlPlanHeaderData[],
  rows: ControlPlanRowData[],
): ControlPlanGroup[] {
  const byHeaderId = new Map<number, ControlPlanRowData[]>();
  const known = new Set(headers.map((h) => h.id));
  const orphans: ControlPlanRowData[] = [];
  for (const r of rows) {
    if (!known.has(r.headerId)) {
      orphans.push(r);
      continue;
    }
    (
      byHeaderId.get(r.headerId) ??
      byHeaderId.set(r.headerId, []).get(r.headerId)!
    ).push(r);
  }
  const groups = headers.map((h) => ({
    header: h,
    rows: byHeaderId.get(h.id) ?? [],
  }));
  if (orphans.length > 0) {
    groups.push({
      header: { id: -1, header: "(no header)", headerNo: "?" },
      rows: orphans,
    });
  }
  return groups;
}

/**
 * Next free section number for "Add section" (Task 89).
 *
 * `header_no` is TEXT in the Molio schema, not an integer — headers can
 * legitimately read "1", "2.1" or "A". We only ever append at the end,
 * so the rule is deliberately simple: take the highest leading integer
 * we can read out of the existing headers and return the next one, as a
 * string. Non-numeric headers contribute nothing (`parseInt` → NaN) and
 * an empty plan starts at "1".
 *
 * No renumbering, no gap-filling: appending is the only way to create a
 * section from the UI, so a gap can't appear from this path.
 */
export function nextHeaderNo(headers: ControlPlanHeaderData[]): string {
  let max = 0;
  for (const h of headers) {
    const n = Number.parseInt(String(h.headerNo ?? "").trim(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

/**
 * Short badge text for the control-type column. Matches the way Molio's
 * own tools (and the user's industry) label these: E / U / T. Value 0
 * ("not selected") shows an em-dash because an empty cell would look
 * like missing data rather than the valid "no choice made yet" state.
 */
export function controlTypeBadge(code: number): string {
  switch (code) {
    case 1:
      return "E";
    case 2:
      return "U";
    case 3:
      return "T";
    default:
      return "—";
  }
}

/**
 * Long label for tooltip / accessibility. Danish matches the source
 * terminology; an English gloss in parentheses keeps the app usable for
 * non-Danish speakers without needing a full i18n layer yet.
 */
export function controlTypeLabel(code: number): string {
  switch (code) {
    case 1:
      return "Egenkontrol (self-check)";
    case 2:
      return "Uafhængig kontrol (independent)";
    case 3:
      return "Tredjepartskontrol (third-party)";
    default:
      return "Not selected";
  }
}

/**
 * CSS modifier suffix used to color the pill per type. Keeping the
 * mapping in one place means the component doesn't grow a conditional
 * branch for each new type Molio might add.
 */
export function controlTypeClass(code: number): string {
  switch (code) {
    case 1:
      return "cp-pill--e";
    case 2:
      return "cp-pill--u";
    case 3:
      return "cp-pill--t";
    default:
      return "cp-pill--none";
  }
}
