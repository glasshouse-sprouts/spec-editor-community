/**
 * Slice 10H.7 Commit 3 — read-only view of a master section, as seen
 * from a PFBB child.
 *
 * Renders the master's section number + heading + sanitized body in
 * the muted "inherited" style (`.master-section-block`). Not editable:
 * clicking inside the body does nothing visible; a `title` tooltip
 * tells the user where the text lives.
 *
 * Intentionally does NOT include the "Add supplement" button or the
 * supplement editor — those are the next commit's responsibility.
 * Keep this component single-purpose so tests can snapshot it and so
 * the layer boundary between "read master" and "write supplement" is
 * crisp.
 *
 * Body HTML is run through the existing `sanitizeBody` pipeline —
 * same allow-list as the editable `SectionEditor` uses on save.
 * That way a master with inline images, tables, links, or the 6L.1
 * highlight/colour classes renders identically in the child view.
 */
import type { JSX } from "react";

import { sanitizeBody } from "./sanitizeBody.js";

export interface PfbbMasterSectionBlockProps {
  /** Master section_no, shown at the start of the block (e.g. "1.2.3"). */
  sectionNo: string | null;
  /** Master section heading (may be empty — then we render just a rule). */
  heading: string | null;
  /**
   * Sanitised master body HTML. An empty string renders a "(no content)"
   * placeholder in the muted style so the user sees the section exists
   * but has no body text to inherit.
   */
  body: string | null;
  /**
   * Stable id used by tests + the Add-supplement affordance in the
   * enclosing merged view. Not rendered visually.
   */
  masterSectionId: number;
}

const TOOLTIP =
  "This text lives on the master building element specification. Open the master to edit.";

export function PfbbMasterSectionBlock(
  props: PfbbMasterSectionBlockProps,
): JSX.Element {
  const { sectionNo, heading, body, masterSectionId } = props;
  const cleaned = body == null || body === "" ? "" : sanitizeBody(body);
  const isEmpty = cleaned.trim().length === 0;

  return (
    <section
      className="master-section-block"
      data-master-section-id={masterSectionId}
      data-testid="pfbb-master-section-block"
      title={TOOLTIP}
      aria-label="Master section (read-only)"
    >
      <header className="master-section-block__header">
        {sectionNo ? (
          <span className="master-section-block__section-no">{sectionNo}</span>
        ) : null}
        {heading ? (
          <span className="master-section-block__heading">{heading}</span>
        ) : null}
      </header>
      {isEmpty ? (
        <div
          className="master-section-block__body master-section-block__body--empty"
          data-testid="pfbb-master-section-block-empty"
        >
          (no master content)
        </div>
      ) : (
        <div
          className="master-section-block__body"
          data-testid="pfbb-master-section-block-body"
          // sanitizeBody runs through DOMPurify with the same allow-list
          // the editor uses on save, so we can safely dangerouslySetInnerHTML.
          dangerouslySetInnerHTML={{ __html: cleaned }}
        />
      )}
    </section>
  );
}
