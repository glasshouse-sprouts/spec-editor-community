/**
 * Save-conflict dialog.
 *
 * Shown when a Save detects the file changed on disk since we opened
 * it (an mtime mismatch). Three branches:
 *   - **Cancel** — close, leave the editor's edits untouched.
 *   - **Reload** — discard our edits, re-open the on-disk version.
 *   - **Overwrite** — force the save, clobbering the on-disk changes.
 *
 * Extracted from App.tsx so it can use `useEscToClose` like every
 * other modal — Esc dismisses the dialog (= Cancel).
 */

import type { JSX } from "react";

import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface Props {
  /** File name shown in the body text. */
  filename: string;
  /** Close the dialog, keep editing. */
  onCancel: () => void;
  /** Discard local edits, reload the on-disk version. */
  onReload: () => void;
  /** Force the save, overwriting the on-disk changes. */
  onOverwrite: () => void;
  /**
   * RELOAD-Merge — start the merge flow. Optional: only passed (and
   * the button only shown) when a merge is possible to offer.
   */
  onMerge?: () => void;
}

export function ConflictModal({
  filename,
  onCancel,
  onReload,
  onOverwrite,
  onMerge,
}: Props): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
    >
      <div className="modal">
        <h2 id="conflict-title" className="modal__title">
          {t("conflict.title")}
        </h2>
        <p className="modal__body">{t("conflict.body", { filename })}</p>
        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="modal__button" onClick={onReload}>
            {t("conflict.reload")}
          </button>
          {onMerge && (
            <button type="button" className="modal__button" onClick={onMerge}>
              {t("mergeModal.openButton")}
            </button>
          )}
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onOverwrite}
          >
            {t("conflict.overwrite")}
          </button>
        </div>
      </div>
    </div>
  );
}
