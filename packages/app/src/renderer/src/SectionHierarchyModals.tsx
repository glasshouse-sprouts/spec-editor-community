/**
 * SectionHierarchyModals — slice 10G.
 *
 * Three tiny dialogs used by the TOC right-click menu:
 *   - AddSectionModal          "Add a new section" with heading input.
 *   - RenameSectionModal       Rename an existing section (heading only).
 *   - DeleteSectionConfirmModal Cascade confirm with descendant count,
 *                               plus a PFBB warning when the section
 *                               is a master with live child supplements.
 *
 * All three are controlled components — dialog state is held by
 * App.tsx and threaded in via props. The modals don't mutate the
 * edit buffer directly; they call `onConfirm`-style callbacks that
 * stage patches at the parent level.
 */

import { useEffect, useRef, useState } from "react";

import { useT } from "./i18n/i18n.js";
import { useEscToClose } from "./modals/useEscToClose.js";

// ---- Add / Rename ---------------------------------------------------

interface AddRenameProps {
  title: string;
  /** Text shown below the title (context for the user — what row
   *  they're acting on, what rules apply). */
  description: string;
  /** Pre-fill for the heading input. Empty for Add, existing for Rename. */
  initialHeading: string;
  /** Button label on the primary action. */
  confirmLabel: string;
  onCancel: () => void;
  /** Called with the trimmed heading. Empty headings are blocked
   *  by the form, so callers can assume non-empty here. */
  onConfirm: (heading: string) => void;
}

export function AddSectionModal(
  props: Omit<AddRenameProps, "title" | "confirmLabel" | "initialHeading">,
): JSX.Element {
  const t = useT();
  return (
    <HeadingForm
      title={t("modal.addSection.title")}
      confirmLabel={t("modal.addSection.confirmButton")}
      initialHeading=""
      {...props}
    />
  );
}

export function RenameSectionModal(
  props: Omit<AddRenameProps, "title" | "confirmLabel">,
): JSX.Element {
  const t = useT();
  return (
    <HeadingForm
      title={t("modal.renameSection.title")}
      confirmLabel={t("common.save")}
      {...props}
    />
  );
}

function HeadingForm({
  title,
  description,
  initialHeading,
  confirmLabel,
  onCancel,
  onConfirm,
}: AddRenameProps): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);
  const [heading, setHeading] = useState(initialHeading);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // On mount: focus + select whatever's already in the field so
  // rename flows type-to-replace. Add flow starts empty.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canSubmit = heading.trim().length > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-hierarchy-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h2 id="section-hierarchy-modal-title" className="modal__title">
          {title}
        </h2>
        <p className="modal__body">{description}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm(heading.trim());
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.section.headingLabel")}
            </span>
            <input
              ref={inputRef}
              type="text"
              className="modal__input"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              required
              data-testid="section-hierarchy-heading-input"
            />
          </label>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={!canSubmit}
              data-testid="section-hierarchy-confirm"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Delete confirm -------------------------------------------------

interface DeleteConfirmProps {
  /** Label of the section being deleted — headline of the dialog. */
  sectionLabel: string;
  /** Count of descendant sections that will also disappear. 0 when
   *  the section is a leaf. */
  descendantCount: number;
  /**
   * Slice 10G.PFBB — when this section is on a PFBB master BDB
   * AND at least one live child currently supplements it (directly
   * or transitively through a descendant), this count drives an
   * extra warning line calling out the post-save impact. 0 hides
   * the warning entirely.
   */
  childSupplementCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteSectionConfirmModal({
  sectionLabel,
  descendantCount,
  childSupplementCount,
  onCancel,
  onConfirm,
}: DeleteConfirmProps): JSX.Element {
  const t = useT();
  useEscToClose(onCancel);
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-delete-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <h2 id="section-delete-title" className="modal__title">
          {t("modal.deleteSection.title")}
        </h2>
        <p className="modal__body">
          <strong>{sectionLabel}</strong>
          {t("modal.deleteSection.bodyAfterLabel")}
        </p>
        {descendantCount > 0 && (
          <p className="modal__body">
            {t("modal.deleteSection.descendantsBefore")}
            <strong>{descendantCount}</strong>
            {descendantCount === 1
              ? t("modal.deleteSection.descendantsAfterOne")
              : t("modal.deleteSection.descendantsAfterMany")}
          </p>
        )}
        {childSupplementCount > 0 && (
          <p className="modal__body modal__muted">
            {t("modal.deleteSection.pfbbBefore")}
            <strong>{childSupplementCount}</strong>
            {childSupplementCount === 1
              ? t("modal.deleteSection.pfbbAfterOne")
              : t("modal.deleteSection.pfbbAfterMany")}
            <em>{t("modal.deleteSection.pfbbBrokenLabel")}</em>
            {t("modal.deleteSection.pfbbAfterEm")}
          </p>
        )}
        <p className="modal__body modal__muted">
          <strong>{t("modal.deleteSection.cantUndoStrong")}</strong>
          {t("modal.deleteSection.cantUndoAfter")}
        </p>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            autoFocus
            data-testid="section-delete-cancel"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--danger"
            onClick={onConfirm}
            data-testid="section-delete-confirm"
          >
            {t("modal.deleteSection.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
