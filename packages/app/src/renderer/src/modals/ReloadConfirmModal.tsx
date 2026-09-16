/**
 * RELOAD-3 — discard-confirm before reloading the open file from
 * disk.
 *
 * Only rendered when the editor has unsaved edits; a clean reload
 * skips the dialog entirely (see `useReloadFromDisk`).
 *
 * Its own component so it can use `useEscToClose` like every other
 * modal — Esc dismisses the dialog (= Cancel).
 */

import type { JSX } from "react";

import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface Props {
  /** Close the dialog, keep the unsaved edits. */
  onCancel: () => void;
  /** Discard the unsaved edits and reload from disk. */
  onConfirm: () => void;
  /**
   * RELOAD-Merge — start the merge flow instead of discarding.
   * Optional: only passed (button only shown) when merge is possible.
   */
  onMerge?: () => void;
}

export function ReloadConfirmModal({
  onCancel,
  onConfirm,
  onMerge,
}: Props): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reload-confirm-title"
    >
      <div className="modal">
        <h2 id="reload-confirm-title" className="modal__title">
          {t("reloadConfirm.title")}
        </h2>
        <p className="modal__body">{t("reloadConfirm.body")}</p>
        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          {onMerge && (
            <button type="button" className="modal__button" onClick={onMerge}>
              {t("mergeModal.openButton")}
            </button>
          )}
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onConfirm}
          >
            {t("reloadConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
