/**
 * View 3 — Control Plan Editor.
 *
 * Spreadsheet-style table built with plain CSS `position: sticky`:
 *   - The column-header row sticks to the top while the user scrolls.
 *   - Each section-group row also sticks just under the column header
 *     so the user always knows which group they're looking at.
 *   - Horizontal overflow scrolls. Columns have fixed widths so the
 *     layout stays predictable regardless of text length.
 *
 * Editing model (Phase 6 Slice 6H — #40, Wave C):
 *   - All text cells render as `<input type="text">` with no border —
 *     they look like plain cells but accept typing on click/focus.
 *     Changes are reported up on every keystroke through
 *     `onEditCell(rowId, field, nextValue, originalValue)`. The parent
 *     owns the dirty-map: a patch is recorded on change, and cleared
 *     automatically if the user reverts to the original value.
 *   - `controlType` renders as a `<select>` with the four Molio values
 *     (0..3). The patch value is stringified — main coerces to int.
 *   - The CP title at the top is also editable inline. Blur-and-Enter
 *     behaviour mirrors the cells.
 *
 * Why plain inputs and not a rich editor?
 *   CP cells in Molio are short labels, numbers, and references — not
 *   paragraphs of prose. A full TipTap-per-cell would triple the bundle
 *   size and complicate clipboard semantics (the user expects
 *   spreadsheet-like paste). We can upgrade individual columns to a
 *   richer editor later if the field type demands it.
 */

import { useMemo } from "react";

import type {
  ControlPlanHeaderData,
  ControlPlanInfo,
  ControlPlanRowData,
  CpRowEditableField,
} from "../../shared/ipc.js";
import { controlTypeLabel, groupRowsByHeader } from "./controlPlanView.js";
import { useT } from "./i18n/i18n.js";
// Community edition: the "Default control plan" feature (Molio) is removed.
import { useReaderMode } from "./readerMode/ReaderModeContext.js";

interface Props {
  plan: ControlPlanInfo;
  headers: ControlPlanHeaderData[];
  rows: ControlPlanRowData[];
  /** Title as currently edited (patched or original). */
  editedTitle: string;
  /** Report a new title draft. Called on every keystroke. */
  onEditTitle: (nextTitle: string) => void;
  /** Effective value for a cell (patched or original). */
  editedCellFor: (
    rowId: number,
    field: CpRowEditableField,
    originalValue: string,
  ) => string;
  /** Report a cell edit. Called on every keystroke / select change. */
  onEditCell: (
    rowId: number,
    field: CpRowEditableField,
    nextValue: string,
    originalValue: string,
  ) => void;
  /** Append a new blank row to the given header/group. Host handles the
   *  dirty-state guard, IPC call, and reload. */
  onRequestAddRow: (headerId: number) => void;
  /**
   * Task 89 — append a new, empty section (group header) at the BOTTOM
   * of this control plan. The host owns the dirty-state guard, the IPC
   * call and the reload, exactly like `onRequestAddRow`.
   *
   * Deliberately append-only: no insert-in-the-middle, no renumbering
   * and no delete. Deleting a section cascades to its rows, which needs
   * a confirm dialog we have not designed yet.
   */
  onRequestAddHeader: () => void;
  /** Right-click on a row → open host's "Delete row?" confirm dialog. */
  onRequestDeleteRow: (row: ControlPlanRowData) => void;
  /**
   * 10I-followup gap 3 — effective header text/no for an inline-
   * edited section header. Returns the patched value if there's a
   * pending `cpHeaderUpdate`, else the original.
   */
  editedHeaderFor?: (
    headerId: number,
    field: "header" | "headerNo",
    originalValue: string,
  ) => string;
  /** 10I-followup gap 3 — report a header edit. Called on each
   *  keystroke. */
  onEditHeader?: (
    headerId: number,
    field: "header" | "headerNo",
    nextValue: string,
    originalValue: string,
  ) => void;
  /**
   * CP-API — the matching `common_controlplan_*_guid` from the
   * parent BDB's locked metadata, picked based on the CP's type
   * (design vs production). Drives the "Default Control plan"
   * button in the top-right: when null, the button is disabled
   * with an explanatory tooltip; when set, clicking it opens the
   * read-only Molio reference CP modal.
   */
  commonControlPlanGuid?: string | null;
}

/** Column metadata. `width` is in pixels — CSS `min-width: N px`
 *  keeps the cell from shrinking in a narrow window.
 *
 *  The `labelKey` points at the i18n catalog — the JSX below resolves
 *  it through `t(...)` so the header reflects the current locale. */
const COLUMNS: {
  key: CpRowEditableField;
  labelKey: string;
  width: number;
}[] = [
  { key: "sectionNo", labelKey: "cpTable.col.sectionNo", width: 64 },
  { key: "subject", labelKey: "cpTable.col.subject", width: 220 },
  { key: "reference", labelKey: "cpTable.col.reference", width: 160 },
  { key: "method", labelKey: "cpTable.col.method", width: 220 },
  { key: "quantity", labelKey: "cpTable.col.quantity", width: 110 },
  { key: "time", labelKey: "cpTable.col.time", width: 130 },
  {
    key: "acceptanceCriteria",
    labelKey: "cpTable.col.acceptanceCriteria",
    width: 240,
  },
  { key: "documentation", labelKey: "cpTable.col.documentation", width: 180 },
  { key: "controlLevel", labelKey: "cpTable.col.controlLevel", width: 140 },
  { key: "sampleLevel", labelKey: "cpTable.col.sampleLevel", width: 130 },
  // `controlType` is rendered as a <select> in DataRow — see the JSX
  // below. The column metadata is still used for header alignment.
  { key: "controlType", labelKey: "cpTable.col.controlType", width: 100 },
];

export function ControlPlanTableView({
  plan,
  headers,
  rows,
  editedTitle,
  onEditTitle,
  editedCellFor,
  onEditCell,
  onRequestAddRow,
  onRequestAddHeader,
  onRequestDeleteRow,
  editedHeaderFor,
  onEditHeader,
  commonControlPlanGuid = null,
}: Props): JSX.Element {
  const t = useT();
  const readerMode = useReaderMode();
  // CP-API — open the Default Control plan modal on demand.
  // Modal state is local: opening another tab unmounts the view
  // and clears the modal automatically.
  const groups = useMemo(
    () => groupRowsByHeader(headers, rows),
    [headers, rows],
  );

  return (
    <div className="cp-view">
      <header className="cp-view__header">
        <div className="cp-view__title">
          <code>{plan.numberText}</code>{" "}
          <input
            type="text"
            className="cp-view__title-input"
            value={editedTitle}
            onChange={(e) => onEditTitle(e.target.value)}
            aria-label={t("cpTable.titleAria")}
            placeholder={t("cpTable.titlePlaceholder")}
            readOnly={readerMode}
          />
        </div>
      </header>

      <div className="cp-view__scroll">
        {headers.length === 0 ? (
          <div className="cp-view__empty">{t("cpTable.empty")}</div>
        ) : (
          <table
            className="cp-table"
            style={
              {
                "--cp-min-width": `${COLUMNS.reduce(
                  (n, c) => n + c.width,
                  0,
                )}px`,
              } as React.CSSProperties
            }
          >
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col">
                    {t(c.labelKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g.header.id}
                  header={g.header}
                  rows={g.rows}
                  editedCellFor={editedCellFor}
                  onEditCell={onEditCell}
                  onRequestAddRow={onRequestAddRow}
                  onRequestDeleteRow={onRequestDeleteRow}
                  editedHeaderFor={editedHeaderFor}
                  onEditHeader={onEditHeader}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Task 89 — "+ Add section". Sits OUTSIDE the scroll container so
       *  it stays put while the table scrolls, and so it is reachable
       *  even when the plan has no sections at all (the table isn't
       *  rendered in that case). Same dashed, muted look as the per-group
       *  "+ Add row" button, one step wider, so the two read as the same
       *  family of actions at two levels. */}
      <footer className="cp-view__footer">
        <button
          type="button"
          className="cp-table__add-row cp-view__add-section"
          onClick={() => onRequestAddHeader()}
          title={t("cpTable.addSectionTooltip")}
          disabled={readerMode}
        >
          {t("cpTable.addSection")}
        </button>
      </footer>
    </div>
  );
}

/** A sticky header row for one group, followed by that group's rows. */
function GroupRows({
  header,
  rows,
  editedCellFor,
  onEditCell,
  onRequestAddRow,
  onRequestDeleteRow,
  editedHeaderFor,
  onEditHeader,
}: {
  header: ControlPlanHeaderData;
  rows: ControlPlanRowData[];
  editedCellFor: Props["editedCellFor"];
  onEditCell: Props["onEditCell"];
  onRequestAddRow: Props["onRequestAddRow"];
  onRequestDeleteRow: Props["onRequestDeleteRow"];
  editedHeaderFor?: Props["editedHeaderFor"];
  onEditHeader?: Props["onEditHeader"];
}): JSX.Element {
  const t = useT();
  const readerMode = useReaderMode();
  // 10I-followup gap 3 — read effective values from the patch
  // helpers (or fall back to the disk values).
  const effHeaderNo = editedHeaderFor
    ? editedHeaderFor(header.id, "headerNo", header.headerNo)
    : header.headerNo;
  const effHeader = editedHeaderFor
    ? editedHeaderFor(header.id, "header", header.header)
    : header.header;
  // Phase 8 round 2 — Reader mode forces read-only render even
  // when the parent provides edit callbacks.
  const editable = !readerMode && !!onEditHeader;
  return (
    <>
      <tr className="cp-table__group-row">
        <th
          className="cp-table__group"
          scope="rowgroup"
          colSpan={COLUMNS.length}
        >
          {editable ? (
            <span className="cp-table__group-edit">
              <input
                type="text"
                className="cp-table__group-no-input"
                value={effHeaderNo}
                onChange={(e) =>
                  onEditHeader!(
                    header.id,
                    "headerNo",
                    e.target.value,
                    header.headerNo,
                  )
                }
                aria-label={t("cpTable.sectionNumberAria")}
              />
              <input
                type="text"
                className="cp-table__group-text-input"
                value={effHeader}
                onChange={(e) =>
                  onEditHeader!(
                    header.id,
                    "header",
                    e.target.value,
                    header.header,
                  )
                }
                aria-label={t("cpTable.sectionHeadingAria")}
                placeholder={t("cpTable.sectionUntitledPlaceholder")}
              />
            </span>
          ) : (
            <>
              <span className="cp-table__group-no">{effHeaderNo}</span>{" "}
              {effHeader}
            </>
          )}
        </th>
      </tr>
      {rows.length === 0 ? (
        <tr>
          <td className="cp-table__empty" colSpan={COLUMNS.length}>
            {t("cpTable.groupEmpty")}
          </td>
        </tr>
      ) : (
        rows.map((r) => (
          <DataRow
            key={r.id}
            row={r}
            editedCellFor={editedCellFor}
            onEditCell={onEditCell}
            onRequestDeleteRow={onRequestDeleteRow}
          />
        ))
      )}
      {/* "+ Add row" footer for this group. Always visible so the user
          can add a row even to a currently-empty group. */}
      <tr className="cp-table__add-row-wrap">
        <td className="cp-table__add-row-cell" colSpan={COLUMNS.length}>
          <button
            type="button"
            className="cp-table__add-row"
            onClick={() => onRequestAddRow(header.id)}
            aria-label={t("cpTable.addRowAria", { header: header.header })}
            disabled={readerMode}
          >
            {t("cpTable.addRow")}
          </button>
        </td>
      </tr>
    </>
  );
}

/** One detail row. All cells are editable; right-click opens the host's
 *  "Delete row?" confirm. */
function DataRow({
  row,
  editedCellFor,
  onEditCell,
  onRequestDeleteRow,
}: {
  row: ControlPlanRowData;
  editedCellFor: Props["editedCellFor"];
  onEditCell: Props["onEditCell"];
  onRequestDeleteRow: Props["onRequestDeleteRow"];
}): JSX.Element {
  const t = useT();
  const readerMode = useReaderMode();
  return (
    <tr
      onContextMenu={(e) => {
        e.preventDefault();
        // Phase 8 round 2 — Reader mode: right-click "delete row"
        // is suppressed.
        if (readerMode) return;
        onRequestDeleteRow(row);
      }}
    >
      {COLUMNS.map((c) => {
        if (c.key === "controlType") {
          const original = String(row.controlType ?? 0);
          const value = editedCellFor(row.id, "controlType", original);
          return (
            <td key={c.key} className="cp-table__cell cp-table__cell--type">
              <select
                className="cp-table__select"
                value={value}
                onChange={(e) =>
                  onEditCell(row.id, "controlType", e.target.value, original)
                }
                aria-label={t("cpTable.controlTypeAria", {
                  row: row.sectionNo || row.id,
                })}
                title={controlTypeLabel(Number(value))}
                disabled={readerMode}
              >
                <option value="0">{t("cpTable.controlType.0")}</option>
                <option value="1">{t("cpTable.controlType.1")}</option>
                <option value="2">{t("cpTable.controlType.2")}</option>
                <option value="3">{t("cpTable.controlType.3")}</option>
              </select>
            </td>
          );
        }
        const original = String((row[c.key] as string | number | null) ?? "");
        const value = editedCellFor(row.id, c.key, original);
        return (
          <td key={c.key} className="cp-table__cell" title={value}>
            <input
              type="text"
              className="cp-table__input"
              value={value}
              onChange={(e) =>
                onEditCell(row.id, c.key, e.target.value, original)
              }
              aria-label={t("cpTable.cellAria", {
                label: t(c.labelKey),
                row: row.sectionNo || row.id,
              })}
              readOnly={readerMode}
            />
          </td>
        );
      })}
    </tr>
  );
}
