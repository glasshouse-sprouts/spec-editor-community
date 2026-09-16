/**
 * Confirm dialog shown when the user flips Reader mode ON while
 * unsaved edits exist in the buffer.
 *
 * Three branches:
 *   - **Save** — call the existing save flow, then enter Reader
 *     mode. (Owned by App; we just call back.)
 *   - **Discard** — wipe the edit buffer, then enter Reader mode.
 *   - **Cancel** — close the dialog, leave Reader mode OFF.
 *
 * Discarding edits is irreversible — same caveat we use elsewhere
 * in delete dialogs. We spell it out in the body.
 */

import type { JSX } from "react";

import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "../modals/useEscToClose.js";

interface Props {
  /** Save dirty edits, then enter Reader mode. */
  onSave: () => void;
  /** Drop dirty edits, then enter Reader mode. */
  onDiscard: () => void;
  /** Close the dialog. Reader mode stays OFF. */
  onCancel: () => void;
}

export function ReaderModeConfirmDialog({
  onSave,
  onDiscard,
  onCancel,
}: Props): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-mode-confirm-title"
    >
      <div className="modal">
        <h2 id="reader-mode-confirm-title" className="modal__title">
          {t("readerMode.confirm.title")}
        </h2>
        <div className="modal__body">
          <p>{t("readerMode.confirm.body")}</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={onCancel}>
            {t("readerMode.confirm.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--danger"
            onClick={onDiscard}
          >
            {t("readerMode.confirm.discard")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onSave}
          >
            {t("readerMode.confirm.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
