/**
 * Slice "Highlights & formatting" — read-only section preview.
 *
 * Opens on top of the Highlights tab when the user clicks a row's
 * Eye icon. Shows the section's heading + body HTML rendered
 * (sanitised already at load time, so we trust `dangerouslySetInnerHTML`
 * here — the same trust the editor already applies). No editing
 * inside this modal: the user gets a "Edit here" button that closes
 * the preview and switches to the section's actual tab + scrolls to
 * the run.
 *
 * Picked option B-2 over a fully-editable preview: a second TipTap
 * instance bound to the same edit buffer would clobber selection /
 * caret state in the main tab if both editors were open. The
 * read-only + jump path is one extra click but keeps editor state
 * unambiguous.
 */

import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface SectionPreviewModalProps {
  /** Section heading shown in the modal title bar. */
  heading: string;
  /** Section number (e.g. 1.2.3) — small label above the title. */
  sectionNo: number;
  /** Sanitised body HTML — rendered via dangerouslySetInnerHTML. */
  bodyHtml: string;
  /** Breadcrumb shown above the title (Work area / BDB / Section …). */
  breadcrumb: string;
  /**
   * Edit-here action — closes the preview AND tells the parent to
   * jump to the underlying section's tab with pendingScroll set,
   * so the user lands at the exact run.
   */
  onEditHere: () => void;
  onClose: () => void;
}

export function SectionPreviewModal({
  heading,
  sectionNo,
  bodyHtml,
  breadcrumb,
  onEditHere,
  onClose,
}: SectionPreviewModalProps): JSX.Element {
  const t = useT();
  useEscToClose(onClose);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-preview-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--xl">
        <div
          style={{
            fontSize: "0.75rem",
            opacity: 0.65,
            marginBottom: "0.25rem",
          }}
        >
          {breadcrumb}
        </div>
        <h2
          id="section-preview-title"
          className="modal__title"
          style={{ marginTop: 0 }}
        >
          <span
            style={{ opacity: 0.6, fontWeight: 400, marginRight: "0.5rem" }}
          >
            {sectionNo}
          </span>
          {heading || (
            <em style={{ opacity: 0.6 }}>{t("sectionPreview.untitled")}</em>
          )}
        </h2>
        <div
          className="modal__body section__body"
          style={{
            maxHeight: "60vh",
            overflowY: "auto",
            // Read-only signal: muted background + subtle border.
            background: "rgba(0,0,0,0.02)",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 4,
            padding: "0.75rem 1rem",
          }}
          // The body HTML is sanitised at file-load time via
          // sanitizeLoadedFile.ts and again on save via sanitizeBody.
          // Rendering the stored string directly here mirrors the
          // editor's own approach.
          dangerouslySetInnerHTML={{ __html: bodyHtml || "" }}
        />
        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={onClose}>
            {t("common.close")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onEditHere}
          >
            {t("sectionPreview.editHere")}
          </button>
        </div>
      </div>
    </div>
  );
}
