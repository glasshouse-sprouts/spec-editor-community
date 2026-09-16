/**
 * Slice "Version compare" — side-by-side revision preview.
 *
 * Opens from the Revisions tab when the user clicks a row's preview
 * icon. Shows the matched section / CP row / attachment in two
 * read-only columns: **left = current** (today's project), **right =
 * version reference** (the older baseline). Both columns are
 * read-only — we apply the user's diff-mark formatting from
 * Settings (added on the left, deleted on the right) so they can see
 * exactly what changed without leaving the tab.
 *
 * Why diff marks on both sides
 * ----------------------------
 * Tore's UX rule from the slice intake: marks only ever appear in
 * read-only views. Both columns of this modal are read-only, so both
 * can carry marks without confusing the editing flow. The aligned
 * spec view (Phase E) is a different surface — its left column is
 * editable so it stays mark-free.
 */

import type { JSX } from "react";

import {
  useVersionCompareFormat,
  type DiffFormat,
} from "../compare/versionCompareFormat.js";
import { htmlDiffOneSide } from "../compare/htmlDiff.js";
import { diffFormatToCss } from "./SettingsDialog.js";
import type {
  CpRowFieldName,
  CpRowRevision,
  Revision,
  SectionRevision,
} from "../compare/compareTypes.js";
import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface RevisionPreviewModalProps {
  revision: Revision;
  /**
   * Breadcrumb describing where this revision lives — built by
   * `App.tsx` from the same payload it uses for the Highlights
   * modal, so labels stay consistent across the app.
   */
  breadcrumb: string;
  onClose: () => void;
}

export function RevisionPreviewModal({
  revision,
  breadcrumb,
  onClose,
}: RevisionPreviewModalProps): JSX.Element {
  const t = useT();
  const [format] = useVersionCompareFormat();
  useEscToClose(onClose);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revision-preview-title"
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
          id="revision-preview-title"
          className="modal__title"
          style={{ marginTop: 0 }}
        >
          {revisionTitle(revision, t)} <KindBadge kind={revision.kind} t={t} />
        </h2>

        <div
          className="modal__body"
          style={{ maxHeight: "62vh", overflowY: "auto" }}
        >
          {revision.type === "section" && (
            <SectionTwoColumn
              revision={revision}
              addedFormat={format.added}
              deletedFormat={format.deleted}
              t={t}
            />
          )}
          {revision.type === "cpRow" && (
            <CpRowTwoColumn
              revision={revision}
              addedFormat={format.added}
              deletedFormat={format.deleted}
              t={t}
            />
          )}
          {revision.type === "attachment" && (
            <p style={{ opacity: 0.75 }}>
              {t("revisions.preview.attachmentHint")}
            </p>
          )}
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function revisionTitle(
  r: Revision,
  t: (key: string, p?: Record<string, string | number>) => string,
): string {
  if (r.type === "section") {
    // Show the full hierarchical path ("1.2.3") instead of just the
    // local leaf number — local numbers collide across nesting
    // levels and are ambiguous in the title alone.
    return `${r.sectionPath}${r.heading ? `  ${r.heading}` : ""}`;
  }
  if (r.type === "cpRow") {
    return `${r.bdbLabel} · ${t(`revisions.cp.slot.${r.slot}`)} · ${r.sectionNo}`;
  }
  if (r.type === "wholeSpec") {
    return r.parent.label;
  }
  return r.name;
}

function KindBadge({
  kind,
  t,
}: {
  kind: Revision["kind"];
  t: (key: string) => string;
}): JSX.Element {
  const color =
    kind === "added" ? "#16a34a" : kind === "deleted" ? "#dc2626" : "#2563eb";
  return (
    <span
      style={{
        marginLeft: 8,
        padding: "1px 6px",
        fontSize: "0.7rem",
        fontWeight: 600,
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        verticalAlign: "middle",
      }}
    >
      {t(`revisions.kind.${kind}`)}
    </span>
  );
}

/* --------------------------------------------------------------------- */
/*  Section preview — two columns rendered as HTML with one-side marks   */
/* --------------------------------------------------------------------- */

interface SectionTwoColumnProps {
  revision: SectionRevision;
  addedFormat: DiffFormat;
  deletedFormat: DiffFormat;
  t: (key: string) => string;
}

function SectionTwoColumn({
  revision,
  addedFormat,
  deletedFormat,
  t,
}: SectionTwoColumnProps): JSX.Element {
  // Render rules:
  //   - Left column = current body, with HTML structure preserved
  //     (paragraphs, tables, lists, bold etc.) and words that exist
  //     only in current (i.e. "added" relative to reference)
  //     highlighted in addedFormat.
  //   - Right column = reference body, with HTML structure preserved
  //     and words that exist only in reference (i.e. "deleted")
  //     highlighted in deletedFormat.
  // For added / deleted whole-side revisions one column carries the
  // body and the other is replaced with a muted placeholder line.
  const leftHtml = computeColumnHtml(
    revision.kind,
    "current",
    revision.currentBody,
    revision.referenceBody,
    addedFormat,
    deletedFormat,
  );
  const rightHtml = computeColumnHtml(
    revision.kind,
    "reference",
    revision.currentBody,
    revision.referenceBody,
    addedFormat,
    deletedFormat,
  );
  const leftFallback =
    revision.kind === "deleted" ? t("revisions.preview.absentInCurrent") : null;
  const rightFallback =
    revision.kind === "added" ? t("revisions.preview.absentInReference") : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1rem",
      }}
    >
      <PreviewColumn
        title={t("revisions.preview.current")}
        html={leftHtml}
        fallback={leftFallback}
      />
      <PreviewColumn
        title={t("revisions.preview.reference")}
        html={rightHtml}
        fallback={rightFallback}
      />
    </div>
  );
}

/**
 * Build the diff-marked HTML string for one column of the section
 * preview. Wraps the three revision kinds in one place so the JSX
 * stays small.
 */
function computeColumnHtml(
  kind: SectionRevision["kind"],
  side: "current" | "reference",
  currentBody: string,
  referenceBody: string,
  addedFormat: DiffFormat,
  deletedFormat: DiffFormat,
): string {
  if (side === "current") {
    if (kind === "deleted") return ""; // empty → fallback line shows
    // Added (whole) or modified — current's structure with current-
    // only words highlighted as "added". When kind="added" the
    // reference body is empty, and `htmlDiffOneSide` treats every
    // word as own-only — so the entire body renders highlighted.
    return htmlDiffOneSide(currentBody, referenceBody, addedFormat);
  }
  // side === "reference"
  if (kind === "added") return "";
  // Deleted (whole) or modified — reference's structure with
  // reference-only words highlighted as "deleted".
  return htmlDiffOneSide(referenceBody, currentBody, deletedFormat);
}

/** One column of the side-by-side preview. Renders HTML or a muted fallback. */
function PreviewColumn({
  title,
  html,
  fallback,
}: {
  title: string;
  html: string;
  fallback: string | null;
}): JSX.Element {
  return (
    <div>
      <div className="revisions-preview__column-label">{title}</div>
      {html ? (
        <div
          className="revisions-preview__column"
          // Bodies are sanitised at file-load time (see the renderer's
          // sanitizeBody pass) so injecting via dangerouslySetInnerHTML
          // is safe. Rendering as HTML lets the user see paragraphs,
          // tables, lists and bold/italic exactly as they look in the
          // editor — which is what the preview is supposed to show.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : fallback ? (
        <div className="revisions-preview__column">
          <em style={{ opacity: 0.55 }}>{fallback}</em>
        </div>
      ) : (
        <div className="revisions-preview__column" />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  CP row preview — vertical key/value table with changed rows marked   */
/* --------------------------------------------------------------------- */

const CP_ROW_FIELD_LABELS: Record<CpRowFieldName, string> = {
  subject: "subject",
  reference: "reference",
  method: "method",
  quantity: "quantity",
  time: "time",
  acceptanceCriteria: "acceptanceCriteria",
  documentation: "documentation",
  controlType: "controlType",
  controlLevel: "controlLevel",
  sampleLevel: "sampleLevel",
};

function CpRowTwoColumn({
  revision,
  addedFormat,
  deletedFormat,
  t,
}: {
  revision: CpRowRevision;
  addedFormat: DiffFormat;
  deletedFormat: DiffFormat;
  t: (key: string) => string;
}): JSX.Element {
  const fields = Object.keys(CP_ROW_FIELD_LABELS) as CpRowFieldName[];
  const cur = revision.currentRow;
  const ref = revision.referenceRow;
  const changed = new Set(revision.changedFields);
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "0.875rem",
      }}
    >
      <thead>
        <tr>
          <th style={cellHeaderStyle()}>{t("revisions.preview.field")}</th>
          <th style={cellHeaderStyle()}>{t("revisions.preview.current")}</th>
          <th style={cellHeaderStyle()}>{t("revisions.preview.reference")}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => {
          const curVal = cur
            ? String((cur as unknown as Record<string, unknown>)[f] ?? "")
            : "";
          const refVal = ref
            ? String((ref as unknown as Record<string, unknown>)[f] ?? "")
            : "";
          const isChanged = changed.has(f) || cur == null || ref == null;
          return (
            <tr key={f}>
              <td style={cellStyle({ isChanged, label: true })}>
                {t(`revisions.cp.field.${f}`)}
              </td>
              <td style={cellStyle({ isChanged })}>
                {isChanged && curVal !== "" && cur != null ? (
                  <span style={diffFormatToCss(addedFormat)}>{curVal}</span>
                ) : (
                  curVal
                )}
              </td>
              <td style={cellStyle({ isChanged })}>
                {isChanged && refVal !== "" && ref != null ? (
                  <span style={diffFormatToCss(deletedFormat)}>{refVal}</span>
                ) : (
                  refVal
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function cellHeaderStyle(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "0.25rem 0.5rem",
    borderBottom: "1px solid rgba(0,0,0,0.15)",
    fontWeight: 600,
    fontSize: "0.8125rem",
    opacity: 0.8,
  };
}

function cellStyle(opts: {
  isChanged?: boolean;
  label?: boolean;
}): React.CSSProperties {
  return {
    padding: "0.25rem 0.5rem",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    verticalAlign: "top",
    fontWeight: opts.label ? 500 : undefined,
    background: opts.isChanged ? "rgba(20, 110, 220, 0.04)" : undefined,
    width: opts.label ? "20%" : undefined,
  };
}
