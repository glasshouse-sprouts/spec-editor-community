/**
 * RELOAD-Merge M3 — the Merge dialog.
 *
 * Presentational. Handed a successful merge plan (auto-applied units
 * + conflicts), it shows each conflict side-by-side with the
 * differences coloured, lets the user resolve every conflict
 * (keep mine / keep disk / edit a merged draft), and hands the
 * winning units back via `onApply`. It does NOT reload or save —
 * that's M4, run from `onApply`.
 *
 * Apply stays disabled until every conflict has an explicit choice
 * (zero conflicts → enabled immediately). Esc cancels.
 */

import { useState } from "react";
import type { JSX } from "react";

import { useT } from "../i18n/i18n.js";
import { withMergedValue } from "../mergeApply.js";
import type {
  DiskDelta,
  DiskEntityKind,
  MergeConflict,
  MergeUnit,
} from "../mergeOnReload.js";
import { sanitizeBody } from "../sanitizeBody.js";
import { MergeConflictRow, type Resolution } from "./MergeConflictRow.js";
import { useEscToClose } from "./useEscToClose.js";

/** i18n key for each top-level entity kind's display name. */
const DISK_KIND_KEY: Record<DiskEntityKind, string> = {
  workArea: "mergeModal.diskKindWorkArea",
  bdb: "mergeModal.diskKindBdb",
  controlPlan: "mergeModal.diskKindControlPlan",
};

interface Props {
  /** Units the disk didn't touch — applied automatically. */
  autoApplied: MergeUnit[];
  /** Units changed on both sides — the user picks per row. */
  conflicts: MergeConflict[];
  /**
   * Top-level entities (work areas / BDBs / control plans) the disk
   * added or removed on its own. Purely informational — this content
   * flows in with the merge regardless; the dialog just lists it so
   * the user isn't surprised.
   */
  diskDelta: DiskDelta;
  /** Close without merging. */
  onCancel: () => void;
  /**
   * Apply the merge. Receives every winning unit: all auto-applied
   * units, conflicts kept "mine", and conflicts resolved to an
   * edited draft (with the draft value baked into the unit).
   */
  onApply: (winningUnits: MergeUnit[]) => void;
}

export function ReloadMergeModal({
  autoApplied,
  conflicts,
  diskDelta,
  onCancel,
  onApply,
}: Props): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);

  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  /** Hand-edited merged drafts, kept across keep-mine/theirs toggles. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showAuto, setShowAuto] = useState(false);

  const allResolved = conflicts.every((c) => choices[c.key] !== undefined);

  function handleApply(): void {
    if (!allResolved) return;
    const winners: MergeUnit[] = [...autoApplied];
    for (const c of conflicts) {
      const r = choices[c.key];
      if (r === "mine") {
        winners.push(c);
      } else if (r === "custom") {
        const raw = drafts[c.key] ?? c.mine;
        // Section bodies are HTML — the draft editor (SectionEditor)
        // already emits the Molio whitelist tags; fence the draft the
        // same way every other section edit is fenced.
        const value = c.kind === "sectionBody" ? sanitizeBody(raw) : raw;
        winners.push(withMergedValue(c, value));
      }
      // "theirs" → contributes nothing (the disk value stays).
    }
    onApply(winners);
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-modal-title"
    >
      <div
        className={
          "modal merge-modal" +
          // Conflicts show side-by-side comparisons — give the
          // dialog the room (80% of the window). The no-conflict
          // case is a short message, so keep it compact.
          (conflicts.length > 0 ? " merge-modal--wide" : "")
        }
      >
        <h2 id="merge-modal-title" className="modal__title">
          {t("mergeModal.title")}
        </h2>
        <p className="modal__body">{t("mergeModal.body")}</p>

        <div className="merge-modal__auto">
          <span>
            {t("mergeModal.autoSummary", {
              count: String(autoApplied.length),
            })}
          </span>
          {autoApplied.length > 0 && (
            <button
              type="button"
              className="merge-modal__link"
              onClick={() => setShowAuto((s) => !s)}
            >
              {showAuto
                ? t("mergeModal.autoToggleHide")
                : t("mergeModal.autoToggleShow")}
            </button>
          )}
        </div>
        {showAuto && autoApplied.length > 0 && (
          <ul className="merge-modal__auto-list">
            {autoApplied.map((u) => (
              <li key={u.key}>{u.label}</li>
            ))}
          </ul>
        )}

        {(diskDelta.added.length > 0 || diskDelta.removed.length > 0) && (
          <div className="merge-modal__disk">
            <div className="merge-modal__disk-intro">
              {t("mergeModal.diskDeltaIntro")}
            </div>
            <ul className="merge-modal__disk-list">
              {diskDelta.added.map((c, i) => (
                <li
                  key={`add-${i}`}
                  className="merge-modal__disk-item merge-modal__disk-item--add"
                >
                  <span className="merge-modal__disk-tag">
                    {t("mergeModal.diskAdded")}
                  </span>
                  {t(DISK_KIND_KEY[c.kind])}: {c.name}
                </li>
              ))}
              {diskDelta.removed.map((c, i) => (
                <li
                  key={`rem-${i}`}
                  className="merge-modal__disk-item merge-modal__disk-item--remove"
                >
                  <span className="merge-modal__disk-tag">
                    {t("mergeModal.diskRemoved")}
                  </span>
                  {t(DISK_KIND_KEY[c.kind])}: {c.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {conflicts.length === 0 ? (
          <p className="merge-modal__no-conflicts">
            {t("mergeModal.noConflicts")}
          </p>
        ) : (
          <>
            <h3 className="merge-modal__heading">
              {t("mergeModal.conflictsHeading")}
            </h3>
            <div className="merge-modal__conflicts">
              {conflicts.map((c) => (
                <MergeConflictRow
                  key={c.key}
                  conflict={c}
                  resolution={choices[c.key]}
                  draft={drafts[c.key]}
                  onResolve={(r) =>
                    setChoices((prev) => ({ ...prev, [c.key]: r }))
                  }
                  onDraft={(v) =>
                    setDrafts((prev) => ({ ...prev, [c.key]: v }))
                  }
                />
              ))}
            </div>
          </>
        )}

        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={handleApply}
            disabled={!allResolved}
          >
            {t("mergeModal.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
