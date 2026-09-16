/**
 * SpecView — hierarchical list of sections for one spec (work area OR BDB).
 *
 * Sections in the Molio file are a tree: each section has a `parent_id` and
 * an ordering number `section_no` that is only meaningful *among siblings*.
 * The main process hands us a flat list; here we rebuild the tree and render
 * it with indentation and a dotted number (1, 1.1, 1.1.2, ...).
 *
 * Editing (Phase 6 Slice B):
 *   - A section body has two render modes: read-only HTML (default) and
 *     TipTap editor (when the section is the "editing target").
 *   - Click on the body to edit; Esc / blur returns to read-only.
 *   - The parent (App) owns the edit map; we only know which section is
 *     being edited and which body to show via the callbacks.
 *
 * Section bodies are HTML. Sanitisation is applied at two points:
 *   1. Inbound at load-time (so what we render equals what we'd save).
 *   2. Outbound on save (DOMPurify as a hard fence).
 * See sanitizeBody.ts.
 */

import { useState } from "react";

import type { SectionData } from "../../shared/ipc.js";
import { filterTreeForCompact } from "./compactFilter.js";
import type { SectionKind } from "./edits.js";
import { useT } from "./i18n/i18n.js";
import type { PfbbChildContext } from "./pfbbChildContext.js";
import {
  PfbbChildSectionBody,
  pfbbChildSectionIsEmpty,
} from "./PfbbChildSectionBody.js";
import { useReaderMode } from "./readerMode/ReaderModeContext.js";
import { SectionEditor } from "./SectionEditor.js";
import {
  buildSectionTree,
  sectionElementId,
  type SectionNode,
} from "./sectionTree.js";

interface Props {
  title: string;
  subtitle?: string;
  kind: string;
  revision: string | null;
  revisionDate: string | null;
  sections: SectionData[];
  /** Global Compact view toggle — when true, sections with empty bodies
   *  are hidden (parents kept when any descendant survives). */
  compactView?: boolean;
  /**
   * Edit support. When provided, clicking a section body switches it
   * into the TipTap editor and calls `onEditBody` on every change.
   * `editedBodyFor(id)` returns the current (possibly patched) body so
   * toggling back to read-only still shows the user's unsaved work.
   * Omit all three to render the view read-only (e.g. in the aligned
   * "Work area" comparison column).
   */
  sectionKind?: SectionKind;
  editedBodyFor?: (sectionId: number) => string;
  onEditBody?: (
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  /**
   * Slice 10H.7.b — when rendering a PFBB child, this carries the
   * supplement-edit plumbing. Each section's normal body slot becomes
   * a grey read-only master block, and the editable body below is the
   * child's supplement. When absent (regular BDB / work-spec), the
   * view renders identically to before. Commit 1 threads the prop
   * without changing any rendering; Commit 2 lights up SectionBlock.
   */
  childContext?: PfbbChildContext;
  /**
   * SPLIT-Merge (#248) — when the spec is an EMPTY work area, we
   * show an inline "Indlæs fra standardbeskrivelse" action below
   * the "ingen afsnit" hint. Provide the callback to enable it;
   * omit (or set null) to hide the link. The link is only rendered
   * when the section tree is also empty.
   */
  onFillFromStandard?: (() => void) | null;
}

export function SpecView({
  title,
  subtitle,
  kind,
  revision,
  revisionDate,
  sections,
  compactView,
  sectionKind,
  editedBodyFor,
  onEditBody,
  childContext,
  onFillFromStandard,
}: Props): JSX.Element {
  const t = useT();
  // Build the tree, then strip empty sections when compact view is on.
  // When compact view is off, filterTreeForCompact returns the input
  // unchanged, so there's no perf cost in the normal case.
  const tree = filterTreeForCompact(
    buildSectionTree(sections),
    compactView === true,
  );
  // Which section (if any) is currently mounted as a live TipTap editor.
  // At most one at a time — keeps the DOM light on 500-section files.
  // Also carries the click coordinates so the editor can drop the caret
  // where the user clicked instead of at the end of the body.
  const [editing, setEditing] = useState<{
    id: number;
    cursorAt: { x: number; y: number } | null;
  } | null>(null);

  const readerMode = useReaderMode();
  // Phase 8 round 2 — Reader mode locks every section. We could
  // alternatively let isEditable through and rely on
  // useEditor({ editable: false }) inside the TipTap layer, but
  // gating here also disables the click-to-edit handler so the
  // user gets immediate visual feedback (no caret-jump) when
  // attempting to edit while reader mode is on.
  const isEditable =
    !readerMode && !!(sectionKind && editedBodyFor && onEditBody);

  return (
    <div className="spec-view">
      <header className="spec-view__header">
        <div className="spec-view__kind">{kind}</div>
        <h2>
          {subtitle && <code className="spec-view__code">{subtitle}</code>}
          {title}
        </h2>
        {(revision || revisionDate) && (
          <div className="spec-view__revision">
            {t("specView.revision", { revision: revision ?? "—" })}
            {revisionDate && <span> · {revisionDate}</span>}
          </div>
        )}
      </header>

      {tree.length === 0 && (
        <div className="spec-view__empty">
          <p className="hint">{t("specView.empty")}</p>
          {onFillFromStandard && !readerMode && (
            <button
              type="button"
              className="spec-view__empty-link"
              onClick={onFillFromStandard}
            >
              {t("specView.empty.fillLink")}
            </button>
          )}
        </div>
      )}

      <div className="spec-view__sections">
        {tree.map((n) => (
          <SectionBlock
            key={n.section.id}
            node={n}
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
            childContext={childContext}
          />
        ))}
      </div>
    </div>
  );
}

interface SectionBlockProps {
  node: SectionNode;
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
  /** When true, parents with empty bodies render only the header + children;
   *  the "(empty)" placeholder is suppressed. */
  compactView: boolean;
  /**
   * Slice 10H.7.b — when set, render as a PFBB child row: the master
   * section's body appears as a muted read-only block in place of
   * the normal body, and the child's supplement (editable) is mounted
   * below it. See pfbbChildContext.ts.
   */
  childContext?: PfbbChildContext;
}

function SectionBlock({
  node,
  isEditable,
  editingId,
  editingCursorAt,
  onStartEdit,
  onStopEdit,
  editedBodyFor,
  onEditBody,
  compactView,
  childContext,
}: SectionBlockProps): JSX.Element {
  const t = useT();
  const { section, depth, number, children } = node;

  // ────────── PFBB child-mode branch ──────────
  if (childContext) {
    return (
      <PfbbChildSectionBlock
        node={node}
        childContext={childContext}
        compactView={compactView}
      />
    );
  }

  // ────────── Regular (non-child) rendering ──────────
  // The body to display: if the parent passes a patch map, always use
  // what's there (so toggling edit on/off doesn't drop unsaved work).
  const displayBody = editedBodyFor ? editedBodyFor(section.id) : section.body;
  const isEditing = isEditable && editingId === section.id;
  // In compact view, a parent with no body but surviving children
  // renders header-only. We mark that case so the stylesheet can
  // tighten its vertical padding and drop the header's bottom margin.
  const isHeaderOnly = compactView && !displayBody;

  return (
    <section
      className={`section${isHeaderOnly ? " section--header-only" : ""}`}
      id={sectionElementId(section.id)}
      style={{ paddingLeft: depth * 16 }}
      data-depth={depth}
      data-section-id={section.id}
    >
      <div className="section__header">
        <span className="section__no">{number}</span>
        <h3 className="section__heading">{section.heading}</h3>
      </div>
      {isEditing && onEditBody ? (
        <SectionEditor
          initialHtml={displayBody}
          autoFocus
          initialCursorAt={editingCursorAt}
          onChange={(html) => onEditBody(section.id, html, section.body)}
          onBlur={onStopEdit}
        />
      ) : displayBody ? (
        <div
          className={`section__body${isEditable ? " section__body--editable" : ""}`}
          onClick={
            isEditable
              ? (e) => onStartEdit(section.id, { x: e.clientX, y: e.clientY })
              : undefined
          }
          title={isEditable ? t("specView.section.clickToEdit") : undefined}
          role={isEditable ? "button" : undefined}
          tabIndex={isEditable ? 0 : undefined}
          onKeyDown={
            isEditable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStartEdit(section.id);
                  }
                }
              : undefined
          }
          // dangerouslySetInnerHTML: body is sanitised upstream + on save via
          // the DOMPurify fence (sanitizeBody.ts). Safe to inject.
          dangerouslySetInnerHTML={{ __html: displayBody }}
        />
      ) : compactView ? // Compact view: suppress the "(empty)" placeholder entirely so
      // parents-of-non-empty-children read as just a header with their
      // subtree underneath. The section can't be edited in this mode —
      // the user has to toggle compact off first. (We still render the
      // <section> wrapper + header above, so numbering + scrollspy
      // remain intact.)
      null : (
        <div
          className={`section__empty${isEditable ? " section__empty--editable" : ""}`}
          onClick={
            isEditable
              ? (e) => onStartEdit(section.id, { x: e.clientX, y: e.clientY })
              : undefined
          }
          title={isEditable ? t("specView.section.clickToAdd") : undefined}
          role={isEditable ? "button" : undefined}
          tabIndex={isEditable ? 0 : undefined}
          onKeyDown={
            isEditable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStartEdit(section.id);
                  }
                }
              : undefined
          }
        >
          {t("specView.section.empty")}
        </div>
      )}
      {children.map((c) => (
        <SectionBlock
          key={c.section.id}
          node={c}
          isEditable={isEditable}
          editingId={editingId}
          editingCursorAt={editingCursorAt}
          onStartEdit={onStartEdit}
          onStopEdit={onStopEdit}
          editedBodyFor={editedBodyFor}
          onEditBody={onEditBody}
          compactView={compactView}
          childContext={childContext}
        />
      ))}
    </section>
  );
}

/**
 * Slice 10H.7.b Commit 2 — a SectionBlock variant for PFBB child rows.
 *
 * Layout per row:
 *   [section header: number + heading]
 *   [grey master body block — always read-only]
 *   [editable supplement editor + Delete icon, OR "+ Add supplement" button]
 *   [recursive children]
 *
 * Uses the same `.section` wrapper + `data-section-id` attribute as
 * the regular block so the SpecTabView scrollspy keeps working
 * unchanged. Indentation by depth mirrors regular mode too.
 *
 * Local state model (rewritten for the Delete-icon UX):
 *   - `userClosed`: the user explicitly removed the supplement via the
 *     Delete icon. Suppresses the editor even when an on-disk row
 *     still exists (the in-memory payload hasn't reloaded yet because
 *     save is buffered). Resets when a *new* on-disk supplement
 *     appears (i.e. existingSectionId transitions from null → number),
 *     or when the user clicks "Add supplement" again.
 *   - `forcedOpen`: the user clicked "Add supplement" on a section
 *     that has nothing on disk and no pending edit. Without this the
 *     editor would collapse back to the button the moment React
 *     re-rendered (empty effectiveBody + null existingSectionId →
 *     no other reason to show).
 *
 * Show editor iff:
 *   NOT userClosed AND (
 *     effectiveBody.length > 0
 *     OR existingSectionId != null
 *     OR forcedOpen
 *   )
 *
 * In compact view, a section with no master body AND no supplement
 * renders header-only.
 */
function PfbbChildSectionBlock({
  node,
  childContext,
  compactView,
}: {
  node: SectionNode;
  childContext: PfbbChildContext;
  compactView: boolean;
}): JSX.Element {
  const { section, depth, number, children } = node;
  // Slice 10H.7.c — compound body (grey master + supplement slot +
  // confirm dialog) extracted into PfbbChildSectionBody so the aligned
  // "Work area" view can reuse the same supplement UX on its left
  // column. The outer section wrapper + header + recursive children
  // stay here because they're specific to the nested SpecView layout
  // (aligned mode renders sections flat in a CSS Grid instead).
  const isHeaderOnly =
    compactView && pfbbChildSectionIsEmpty(section, childContext);

  return (
    <section
      className={`section section--pfbb-child${
        isHeaderOnly ? " section--header-only" : ""
      }`}
      id={sectionElementId(section.id)}
      style={{ paddingLeft: depth * 16 }}
      data-depth={depth}
      data-section-id={section.id}
    >
      <div className="section__header">
        <span className="section__no">{number}</span>
        <h3 className="section__heading">{section.heading}</h3>
      </div>
      {!isHeaderOnly && (
        <PfbbChildSectionBody section={section} childContext={childContext} />
      )}
      {children.map((c) => (
        <SectionBlock
          key={c.section.id}
          node={c}
          isEditable={false}
          editingId={null}
          editingCursorAt={null}
          onStartEdit={() => {}}
          onStopEdit={() => {}}
          compactView={compactView}
          childContext={childContext}
        />
      ))}
    </section>
  );
}
