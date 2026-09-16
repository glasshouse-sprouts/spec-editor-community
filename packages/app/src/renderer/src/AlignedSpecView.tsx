/**
 * AlignedSpecView — dual-column side-by-side view of a BDB next to its
 * parent work area, with sections lined up by their dotted number.
 *
 * Used when the Reference dropdown's "Work area" option is active on a
 * BDB. Lives inside SpecTabView's `.spec-main__body`, below the unified
 * sticky header. This component no longer owns the header — SpecTabView
 * renders it above us and it's shared with standard-mode layouts so the
 * top bar of the editor looks the same regardless of reference type.
 *
 * Layout:
 *   | 2.5      BDB body                 | 2.5      Work-area body           |
 *   | 2.5.1    BDB body                 | (missing — whitespace)            |
 *   | (missing — whitespace)            | 2.5.2    Work-area body           |
 *
 * Editing (Slice 6B follow-up):
 *   - LEFT (BDB) cells are click-to-edit, same affordance as SpecView.
 *   - RIGHT (work-area) cells stay read-only — that side is the
 *     reference the user is comparing against, not the edit target.
 *   - One <SectionEditor> mounts at a time, scoped to the left column.
 *
 * Implementation:
 *   - CSS Grid with two columns: left = flex (content width), right = the
 *     same fixed width as the standard Reference panel, so the overall
 *     layout width stays the same whether the user is viewing Basis/Ref/
 *     Paradigm or the aligned Work-area. No sideways jump.
 *   - One shared scroll container so the two sides can never drift out
 *     of sync. Each grid row auto-equalises its two cells' heights.
 *   - The BDB (left) side carries `data-section-id` so the existing
 *     scrollspy keeps lighting up the TOC. The right (work-area) side
 *     deliberately does NOT — TOC mirrors only the target we're editing.
 *   - Rendering is "flat" (not nested): the grid needs siblings at the
 *     same level for row alignment to work. Depth is still visible via
 *     left padding and heading font size, same as the nested view.
 *
 *   Copyright: Molio spec HTML is trusted per the file-format whitelist;
 *   see the file-level TODO in SpecView.tsx.
 */

import { forwardRef, useState } from "react";

import type { SectionData } from "../../shared/ipc.js";
import { filterAlignedRowsForCompact } from "./compactFilter.js";
import type { SectionKind } from "./edits.js";
import { useT } from "./i18n/i18n.js";
import type { LayoutMode } from "./layoutModePrefs.js";
import type { PfbbChildContext } from "./pfbbChildContext.js";
import { PfbbChildSectionBody } from "./PfbbChildSectionBody.js";
import { SectionEditor } from "./SectionEditor.js";
import {
  buildSectionTree,
  mergeSectionTreesByNumber,
  sectionElementId,
  type AlignedRow,
  type SectionNode,
} from "./sectionTree.js";

interface Props {
  leftSections: SectionData[];
  rightSections: SectionData[];
  /** Global Compact view toggle — when true, rows are hidden when both
   *  sides are empty AND no descendant row survives. */
  compactView?: boolean;
  /**
   * Edit plumbing for the LEFT (BDB) column only. Omit all three to
   * render both sides read-only (legacy behaviour). The right column
   * is never editable regardless of these props.
   */
  sectionKind?: SectionKind;
  editedBodyFor?: (sectionId: number) => string;
  onEditBody?: (
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  /**
   * When "print", the LEFT column is locked to A4 width with a paper
   * background so the user-spec side looks like the printed page. The
   * right (reference) column is unaffected and stays web-style.
   */
  layoutMode?: LayoutMode;
  /** Header metadata for the LEFT (user spec) column. Only rendered when
   *  `layoutMode === "print"` — matches the SpecView header shown in
   *  non-aligned print so the paper reads identically across modes. */
  leftTitle?: string;
  leftSubtitle?: string;
  leftKind?: string;
  leftRevision?: string | null;
  leftRevisionDate?: string | null;
  /** Header metadata for the RIGHT (parent paradigm) column. Only
   *  rendered when `layoutMode === "print"`. The parent's title comes
   *  from `alignment.sideTitle`; the kind label is fixed ("Work area").
   *  Revision isn't threaded through for the parent — see slice notes. */
  rightTitle?: string;
  /**
   * Slice 10H.7.c — when present, the LEFT column renders in PFBB
   * child mode: each left cell becomes a compound (grey master body +
   * editable supplement slot + confirm-delete modal) instead of the
   * click-to-edit single body. The right column is unaffected and
   * continues to show the parent work_spec sections read-only.
   *
   * Consumers should leave `sectionKind`, `editedBodyFor` and
   * `onEditBody` undefined in this mode — supplement writes happen
   * through `childContext.onSupplementBodyChange`, not through the
   * regular section-body edit path.
   */
  childContext?: PfbbChildContext;
}

export const AlignedSpecView = forwardRef<HTMLDivElement, Props>(
  function AlignedSpecView(
    {
      leftSections,
      rightSections,
      compactView,
      sectionKind,
      editedBodyFor,
      onEditBody,
      layoutMode,
      leftTitle,
      leftSubtitle,
      leftKind,
      leftRevision,
      leftRevisionDate,
      rightTitle,
      childContext,
    },
    scrollRef,
  ) {
    const t = useT();
    const leftTree = buildSectionTree(leftSections);
    const rightTree = buildSectionTree(rightSections);
    // Hide rows where BOTH sides are empty — unless a descendant row
    // survives below, in which case we keep this row as context.
    const rows = filterAlignedRowsForCompact(
      mergeSectionTreesByNumber(leftTree, rightTree),
      compactView === true,
    );

    // One editor at a time across the whole left column. Same policy as
    // SpecView — keeps the DOM light on files with hundreds of sections.
    // We also carry the click coordinates that started the edit so the
    // editor can place the caret where the user actually clicked.
    const [editing, setEditing] = useState<{
      id: number;
      cursorAt: { x: number; y: number } | null;
    } | null>(null);
    const isEditable = !!(sectionKind && editedBodyFor && onEditBody);

    const isPrint = layoutMode === "print";
    const printClass = isPrint ? " aligned--print" : "";
    return (
      <div className={`aligned${printClass}`} ref={scrollRef}>
        <div className="aligned__grid">
          {isPrint && (
            <>
              <AlignedHeaderCell
                side="left"
                title={leftTitle}
                subtitle={leftSubtitle}
                kind={leftKind}
                revision={leftRevision ?? null}
                revisionDate={leftRevisionDate ?? null}
              />
              <AlignedHeaderCell
                side="right"
                title={rightTitle}
                kind={t("aligned.workAreaKind")}
              />
            </>
          )}
          {rows.length === 0 ? (
            <div className="aligned__empty" style={{ gridColumn: "1 / -1" }}>
              {t("aligned.empty")}
            </div>
          ) : (
            rows.map((row) => (
              <AlignedRowView
                key={row.number}
                row={row}
                isEditable={isEditable}
                editingId={editing?.id ?? null}
                editingCursorAt={editing?.cursorAt ?? null}
                onStartEdit={(id, cursorAt) =>
                  isEditable && setEditing({ id, cursorAt: cursorAt ?? null })
                }
                onStopEdit={() => setEditing(null)}
                editedBodyFor={editedBodyFor}
                onEditBody={onEditBody}
                compactView={compactView === true}
                isPrint={isPrint}
                childContext={childContext}
              />
            ))
          )}
        </div>
      </div>
    );
  },
);

interface RowProps {
  row: AlignedRow;
  isEditable: boolean;
  editingId: number | null;
  editingCursorAt: { x: number; y: number } | null;
  onStartEdit: (id: number, cursorAt?: { x: number; y: number }) => void;
  onStopEdit: () => void;
  editedBodyFor?: (sectionId: number) => string;
  onEditBody?: (
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  compactView: boolean;
  isPrint: boolean;
  childContext?: PfbbChildContext;
}

function AlignedRowView({
  row,
  isEditable,
  editingId,
  editingCursorAt,
  onStartEdit,
  onStopEdit,
  editedBodyFor,
  onEditBody,
  compactView,
  isPrint,
  childContext,
}: RowProps): JSX.Element {
  return (
    <>
      <SideCell
        node={row.left}
        side="left"
        isEditable={isEditable}
        editingId={editingId}
        editingCursorAt={editingCursorAt}
        onStartEdit={onStartEdit}
        onStopEdit={onStopEdit}
        editedBodyFor={editedBodyFor}
        onEditBody={onEditBody}
        compactView={compactView}
        isPrint={isPrint}
        childContext={childContext}
      />
      {/* Right side never participates in editing. */}
      <SideCell
        node={row.right}
        side="right"
        isEditable={false}
        editingId={null}
        editingCursorAt={null}
        onStartEdit={() => {}}
        onStopEdit={() => {}}
        compactView={compactView}
        isPrint={isPrint}
      />
    </>
  );
}

interface CellProps {
  node: SectionNode | null;
  side: "left" | "right";
  isEditable: boolean;
  editingId: number | null;
  editingCursorAt: { x: number; y: number } | null;
  onStartEdit: (id: number, cursorAt?: { x: number; y: number }) => void;
  onStopEdit: () => void;
  editedBodyFor?: (sectionId: number) => string;
  onEditBody?: (
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  compactView: boolean;
  isPrint: boolean;
  /** Only meaningful on the LEFT side — when present, the cell renders
   *  in PFBB child mode (master + supplement + confirm dialog). */
  childContext?: PfbbChildContext;
}

/**
 * One cell in the aligned grid.
 *
 * When `node` is null the section is missing on this side — render an
 * empty placeholder so the grid still has a cell to measure height
 * against. Visually it's just a blank cell with the same background as
 * its filled siblings, so the user reads the gap naturally as "nothing
 * goes here".
 *
 * The left side uses `data-section-id` + the full `section-<id>` DOM id
 * that the TOC click-to-scroll target relies on. The right side skips
 * both — the TOC only ever cares about the target we're editing.
 *
 * Edit behaviour (left side only): mirrors SpecView's SectionBlock.
 * Click / Enter / Space on the body mounts a SectionEditor in place.
 * Blur returns to read-only. The body shown is always
 * `editedBodyFor(id)` so toggling edit on/off doesn't drop unsaved
 * work.
 */
function SideCell({
  node,
  side,
  isEditable,
  editingId,
  editingCursorAt,
  onStartEdit,
  onStopEdit,
  editedBodyFor,
  onEditBody,
  compactView,
  isPrint,
  childContext,
}: CellProps): JSX.Element {
  const t = useT();
  if (!node) {
    return <div className="aligned__cell aligned__cell--missing" />;
  }
  const { section, depth, number } = node;
  const commonProps =
    side === "left"
      ? {
          id: sectionElementId(section.id),
          "data-depth": depth,
          "data-section-id": section.id,
        }
      : { "data-depth": depth };
  // In print mode the LEFT column is the paper — horizontal padding is
  // controlled by CSS (page margins), and we deliberately drop the
  // depth-based indentation so it reads 1:1 with non-aligned print.
  // The RIGHT column keeps the normal indent so it still looks like
  // web-aligned.
  const skipInlinePadding = isPrint && side === "left";

  // PFBB child mode on the left side — compound body (grey master +
  // supplement slot + confirm dialog). Right side is never in child
  // mode regardless of the prop.
  const isChildLeft = side === "left" && childContext != null;

  // Only the LEFT side actually edits; the right side ignores isEditable.
  // In child mode the regular click-to-edit is disabled — supplement
  // writes go through childContext, not editedBodyFor/onEditBody.
  const canEdit = side === "left" && isEditable && !isChildLeft;
  const displayBody =
    canEdit && editedBodyFor ? editedBodyFor(section.id) : section.body;
  const isEditing = canEdit && editingId === section.id;
  // In compact view, a cell with no body rendered should take less
  // vertical space — header-only rows otherwise carry the full 22/16
  // section padding.
  const isHeaderOnly = compactView && !displayBody;

  return (
    <section
      className={`aligned__cell section${
        isHeaderOnly && !isChildLeft ? " section--header-only" : ""
      }${isChildLeft ? " section--pfbb-child" : ""}`}
      // Cell padding-left in CSS is overridden by this inline style
      // (inline beats stylesheet for longhand properties). We bake a
      // base 16px back in and then add depth-based indentation on top,
      // so the left-most number doesn't hug the panel edge.
      // In print+left we skip it — CSS handles the paper page margin.
      style={skipInlinePadding ? undefined : { paddingLeft: 16 + depth * 16 }}
      {...commonProps}
    >
      <div className="section__header">
        <span className="section__no">{number}</span>
        <h3 className="section__heading">{section.heading}</h3>
      </div>
      {isChildLeft && childContext ? (
        <PfbbChildSectionBody section={section} childContext={childContext} />
      ) : isEditing && onEditBody ? (
        <SectionEditor
          initialHtml={displayBody}
          autoFocus
          initialCursorAt={editingCursorAt}
          onChange={(html) => onEditBody(section.id, html, section.body)}
          onBlur={onStopEdit}
        />
      ) : displayBody ? (
        <div
          className={`section__body${canEdit ? " section__body--editable" : ""}`}
          onClick={
            canEdit
              ? (e) => onStartEdit(section.id, { x: e.clientX, y: e.clientY })
              : undefined
          }
          title={canEdit ? t("aligned.cell.clickToEdit") : undefined}
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          onKeyDown={
            canEdit
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStartEdit(section.id);
                  }
                }
              : undefined
          }
          // dangerouslySetInnerHTML: body is sanitised at load + save via the
          // DOMPurify fence (sanitizeBody.ts). Safe to inject.
          dangerouslySetInnerHTML={{ __html: displayBody }}
        />
      ) : compactView ? // Compact view: suppress the "(empty)" placeholder. The header
      // above still renders so numbering + the row height pair up
      // with the other side.
      null : (
        <div
          className={`section__empty${canEdit ? " section__empty--editable" : ""}`}
          onClick={
            canEdit
              ? (e) => onStartEdit(section.id, { x: e.clientX, y: e.clientY })
              : undefined
          }
          title={canEdit ? t("aligned.cell.clickToAddContent") : undefined}
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          onKeyDown={
            canEdit
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStartEdit(section.id);
                  }
                }
              : undefined
          }
        >
          {t("aligned.cell.empty")}
        </div>
      )}
    </section>
  );
}

/**
 * Header cell rendered as the first row of the grid in print+aligned.
 * Mirrors the `<header className="spec-view__header">` block from
 * SpecView so the paper reads the same as non-aligned print. For the
 * RIGHT side we only have the parent's title + a fixed "Work area"
 * kind label (revision isn't threaded through for the parent).
 */
function AlignedHeaderCell({
  side,
  title,
  subtitle,
  kind,
  revision,
  revisionDate,
}: {
  side: "left" | "right";
  title?: string;
  subtitle?: string;
  kind?: string;
  revision?: string | null;
  revisionDate?: string | null;
}): JSX.Element {
  const t = useT();
  return (
    <div
      className={`aligned__cell aligned__cell--header aligned__cell--header-${side}`}
    >
      <header className="spec-view__header">
        {kind && <div className="spec-view__kind">{kind}</div>}
        {title && (
          <h2>
            {subtitle && <code className="spec-view__code">{subtitle}</code>}
            {title}
          </h2>
        )}
        {(revision || revisionDate) && (
          <div className="spec-view__revision">
            {t("aligned.header.revision", { revision: revision ?? "—" })}
            {revisionDate && <span> · {revisionDate}</span>}
          </div>
        )}
      </header>
    </div>
  );
}
