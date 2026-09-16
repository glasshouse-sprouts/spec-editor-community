/**
 * PfbbBrokenSupplementsBanner — slice 10H.11 / task #235.
 *
 * A PFBB child BDB can end up with "broken" supplement rows when:
 *   - a master section it was supplementing got deleted, leaving the
 *     child row's `pfbbSectionId` pointing at nothing, OR
 *   - the file was hand-edited and a child row exists with no
 *     `pfbbSectionId` at all (not legal under 10H.7 rules).
 *
 * These rows don't render in the merged child view because there's
 * no master section to pair them with — so without a banner the user
 * has no way to notice they're there, let alone clean them up. This
 * component shows a red warning line at the top of the child view
 * with a count, expands to list each broken row on click, and
 * offers a Delete button per row that stages a `bdbSectionDelete`
 * patch through the normal edit buffer (applied on the next save).
 */

import { useState } from "react";

import type { SectionData } from "../../shared/ipc.js";
import { useT } from "./i18n/i18n.js";

export interface Props {
  /** Broken child-side supplement rows (from `buildMergedChildView`). */
  broken: readonly SectionData[];
  /**
   * Stage a delete of the given broken row. The caller wires this to
   * the app's edit buffer (usually `stageBdbSectionDelete(edits, id)`).
   */
  onDeleteBroken: (sectionId: number) => void;
}

export function PfbbBrokenSupplementsBanner({
  broken,
  onDeleteBroken,
}: Props): JSX.Element | null {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (broken.length === 0) return null;

  const label =
    broken.length === 1
      ? t("pfbb.brokenSupplements.summaryOne")
      : t("pfbb.brokenSupplements.summaryMany", { count: broken.length });

  return (
    <div
      className="pfbb-broken-banner"
      role="alert"
      aria-live="polite"
      data-testid="pfbb-broken-banner"
    >
      <button
        type="button"
        className="pfbb-broken-banner__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="pfbb-broken-banner-list"
        data-testid="pfbb-broken-banner-toggle"
      >
        <span className="pfbb-broken-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span className="pfbb-broken-banner__label">{label}</span>
        <span className="pfbb-broken-banner__chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <ul id="pfbb-broken-banner-list" className="pfbb-broken-banner__list">
          {broken.map((row) => (
            <BrokenRow
              key={row.id}
              row={row}
              onDelete={() => onDeleteBroken(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BrokenRow({
  row,
  onDelete,
}: {
  row: SectionData;
  onDelete: () => void;
}): JSX.Element {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const label =
    (row.sectionNo ? `${row.sectionNo}  ` : "") +
    (row.heading || t("pfbb.brokenSupplements.noHeading"));
  const reason =
    row.pfbbSectionId == null
      ? t("pfbb.brokenSupplements.reasonNoLink")
      : t("pfbb.brokenSupplements.reasonMissingMaster", {
          masterId: row.pfbbSectionId,
        });
  return (
    <li
      className="pfbb-broken-banner__row"
      data-testid={`pfbb-broken-row-${row.id}`}
    >
      <div className="pfbb-broken-banner__row-text">
        <span className="pfbb-broken-banner__row-label">{label}</span>
        <span className="pfbb-broken-banner__row-reason">{reason}</span>
      </div>
      {confirm ? (
        <span className="pfbb-broken-banner__row-actions">
          <button
            type="button"
            className="pfbb-broken-banner__btn"
            onClick={() => setConfirm(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="pfbb-broken-banner__btn pfbb-broken-banner__btn--danger"
            onClick={() => {
              onDelete();
              setConfirm(false);
            }}
            data-testid={`pfbb-broken-confirm-delete-${row.id}`}
          >
            {t("pfbb.brokenSupplements.confirmDelete")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="pfbb-broken-banner__btn pfbb-broken-banner__btn--danger"
          onClick={() => setConfirm(true)}
          data-testid={`pfbb-broken-delete-${row.id}`}
        >
          {t("common.delete")}
        </button>
      )}
    </li>
  );
}
