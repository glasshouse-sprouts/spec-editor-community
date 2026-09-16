/**
 * PfbbChildSectionBody — the "compound body" of a PFBB child section.
 *
 * Renders (in order, top to bottom):
 *   1. Grey read-only master body block (via PfbbMasterSectionBlock)
 *   2. Either the editable supplement (SectionEditor + Delete ✕ +
 *      Supplement label) OR an "+ Add supplement" button
 *   3. Confirm-dialog modal (only mounted when the Delete ✕ was clicked)
 *
 * Does NOT render the outer <section> wrapper or the section header
 * (number + heading) — the caller owns those because the required DOM
 * attributes (id, data-section-id, data-depth, padding-left) differ
 * between the nested SpecView layout and the flat AlignedSpecView grid.
 *
 * Extracted in slice 10H.7.c so the aligned "Work area" view can reuse
 * the same supplement UX on its left column when a PFBB child is
 * rendered against its parent work_spec.
 *
 * State model — identical to the previous inline implementation in
 * SpecView's PfbbChildSectionBlock:
 *   - `userClosed`: user explicitly removed the supplement via the
 *     Delete ✕. Suppresses the editor even when the in-memory payload
 *     still has an on-disk row (save is buffered). Resets when a NEW
 *     disk-id appears.
 *   - `forcedOpen`: user clicked "+ Add supplement" on a section with
 *     no disk row and no pending edit. Without this the editor would
 *     collapse back to the button the moment React re-rendered.
 *   - `confirmDelete`: controls the small confirm modal before we
 *     destructively wipe supplement content.
 *
 * Show editor iff:
 *   NOT userClosed AND (
 *     effectiveBody.length > 0
 *     OR existingSectionId != null
 *     OR forcedOpen
 *   )
 */

import { useEffect, useRef, useState } from "react";

import type { SectionData } from "../../shared/ipc.js";
import { useT } from "./i18n/i18n.js";
import type { PfbbChildContext } from "./pfbbChildContext.js";
import { PfbbMasterSectionBlock } from "./PfbbMasterSectionBlock.js";
import { useReaderMode } from "./readerMode/ReaderModeContext.js";
import { SectionEditor } from "./SectionEditor.js";

interface Props {
  section: SectionData;
  childContext: PfbbChildContext;
}

export function PfbbChildSectionBody({
  section,
  childContext,
}: Props): JSX.Element {
  const t = useT();
  const readerMode = useReaderMode();
  const snap = childContext.supplementFor(section.id);
  const [forcedOpen, setForcedOpen] = useState(false);
  const [userClosed, setUserClosed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset `userClosed` when a NEW on-disk supplement appears
  // (null → number transition). We deliberately do NOT auto-reset on
  // the reverse transition, because that's exactly the post-save state
  // the user wanted by clicking Delete.
  const prevExistingIdRef = useRef<number | null>(snap.existingSectionId);
  useEffect(() => {
    const prev = prevExistingIdRef.current;
    if (prev == null && snap.existingSectionId != null) {
      setUserClosed(false);
    }
    prevExistingIdRef.current = snap.existingSectionId;
  }, [snap.existingSectionId]);

  const showEditor =
    !userClosed &&
    (snap.effectiveBody.length > 0 ||
      snap.existingSectionId != null ||
      forcedOpen);

  const handleAddSupplement = (): void => {
    setUserClosed(false);
    setForcedOpen(true);
  };

  const handleDeleteSupplement = (): void => {
    childContext.onSupplementBodyChange({
      masterSectionId: section.id,
      sectionNo: String(section.sectionNo ?? ""),
      body: "",
    });
    setUserClosed(true);
    setForcedOpen(false);
    setConfirmDelete(false);
  };

  return (
    <>
      <PfbbMasterSectionBlock
        sectionNo={null}
        heading={null}
        body={section.body ?? ""}
        masterSectionId={section.id}
      />
      {showEditor ? (
        <div
          className="pfbb-supplement"
          data-testid={`pfbb-supplement-editor-${section.id}`}
        >
          <div className="pfbb-supplement__label">
            <span className="pfbb-supplement__label-text">
              {t("pfbb.childSection.supplementLabel")}
              {snap.hasPendingEdit ? (
                <span
                  className="pfbb-supplement__dirty"
                  data-testid={`pfbb-supplement-dirty-${section.id}`}
                  title={t("pfbb.childSection.unsavedTitle")}
                >
                  {" "}
                  ●
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="pfbb-supplement__delete"
              onClick={() => setConfirmDelete(true)}
              disabled={readerMode}
              title={t("pfbb.childSection.deleteTitle")}
              aria-label={t("pfbb.childSection.deleteAriaLabel")}
              data-testid={`pfbb-delete-supplement-${section.id}`}
            >
              ✕
            </button>
          </div>
          <SectionEditor
            key={
              snap.existingSectionId == null
                ? `new:${section.id}`
                : `disk:${snap.existingSectionId}`
            }
            initialHtml={snap.effectiveBody}
            autoFocus={forcedOpen && snap.effectiveBody === ""}
            editable={!readerMode}
            onChange={(html) =>
              childContext.onSupplementBodyChange({
                masterSectionId: section.id,
                sectionNo: String(section.sectionNo ?? ""),
                body: html,
              })
            }
          />
        </div>
      ) : (
        <button
          type="button"
          className="pfbb-supplement__add"
          onClick={handleAddSupplement}
          disabled={readerMode}
          data-testid={`pfbb-add-supplement-${section.id}`}
        >
          {t("pfbb.childSection.addSupplement")}
        </button>
      )}
      {confirmDelete && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`pfbb-confirm-delete-title-${section.id}`}
          onClick={(e) => {
            // Click on backdrop (outside the modal) cancels — matches
            // the "press Esc" affordance most users expect.
            if (e.target === e.currentTarget) setConfirmDelete(false);
          }}
        >
          <div className="modal">
            <h2
              id={`pfbb-confirm-delete-title-${section.id}`}
              className="modal__title"
            >
              {t("pfbb.childSection.confirmTitle")}
            </h2>
            <p className="modal__body">
              {t("pfbb.childSection.confirmBodyBefore")}
              <strong>
                {section.heading ||
                  t("pfbb.childSection.confirmBodySectionFallback", {
                    sectionNo: section.sectionNo ?? "",
                  })}
              </strong>
              {t("pfbb.childSection.confirmBodyAfter")}
            </p>
            <p className="modal__body modal__muted">
              <strong>{t("pfbb.childSection.confirmCantUndoStrong")}</strong>
              {t("pfbb.childSection.confirmCantUndoAfter")}
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="modal__button"
                onClick={() => setConfirmDelete(false)}
                autoFocus
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="modal__button modal__button--danger"
                onClick={handleDeleteSupplement}
                data-testid={`pfbb-confirm-delete-supplement-${section.id}`}
              >
                {t("pfbb.childSection.confirmRemoveButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * True when the section has neither a master body nor any supplement
 * data (on disk or pending). Used by compact-view callers to decide
 * whether to collapse the row to header-only. Ignores transient local
 * state (userClosed / forcedOpen) — if the user acts on the row, the
 * row re-mounts with the editor and compact-mode header-only will
 * naturally fall away.
 */
export function pfbbChildSectionIsEmpty(
  section: SectionData,
  childContext: PfbbChildContext,
): boolean {
  const snap = childContext.supplementFor(section.id);
  const hasMasterBody = (section.body ?? "").trim().length > 0;
  const hasSupplement =
    snap.effectiveBody.length > 0 || snap.existingSectionId != null;
  return !hasMasterBody && !hasSupplement;
}
