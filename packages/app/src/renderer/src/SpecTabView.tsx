/**
 * SpecTabView — composes the full View 2 middle+right area:
 *   [ Project sidebar | TOC | Content | ReferencePanel ]
 *                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * This file owns everything to the right of the project sidebar.
 *
 * Two rendering modes, picked from the active Reference sub-tab:
 *
 *   Standard mode (Basis / Referenceliste / Paradigm):
 *     TOC | SpecView (content, own scroll) | ReferencePanel (own scroll)
 *
 *   Aligned mode (Work-area sub-tab, BDB only):
 *     TOC | AlignedSpecView (shared scroll, BDB side + work-area side)
 *
 * Scrollspy (used to highlight matching rows in the TOC):
 *   - Runs on whichever column is the active scroll container.
 *   - Finds `[data-section-id]` descendants of that container. In aligned
 *     mode only the *left* (BDB) cells carry that attribute, so the TOC
 *     still mirrors the BDB we're editing, not the work-area we're
 *     comparing to.
 *   - Uses scroll + requestAnimationFrame instead of IntersectionObserver
 *     because we need the *set* of intersecting rects plus DOM order in
 *     one pass, which is awkward with IO.
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";

import type { ReferenceLinks, SectionData } from "../../shared/ipc.js";
import type { SectionKind } from "./edits.js";
import type { LayoutMode } from "./layoutModePrefs.js";
import type { PfbbChildContext } from "./pfbbChildContext.js";
import { AlignedSpecView } from "./AlignedSpecView.js";
import { useReferenceContentApi } from "./ReferenceContentContext.js";
import { RefTypeDropdown } from "./RefTypeDropdown.js";
import {
  coerceSubTab,
  defaultSubTab,
  labelKeyFor,
  visibleSubTabs,
  type RefPanelTargetKind,
  type RefSubTab,
} from "./refTypes.js";
import { useT } from "./i18n/i18n.js";
import { SpecView } from "./SpecView.js";
import { decideSpecTabLayout, refPanelToggleLabel } from "./specTabLayout.js";
import { TOCColumn } from "./TOCColumn.js";

interface Props {
  title: string;
  subtitle?: string;
  kind: string;
  revision: string | null;
  revisionDate: string | null;
  sections: SectionData[];
  tocFilter: string;
  onTocFilterChange: (q: string) => void;
  tocCollapsedNodeIds: ReadonlySet<number>;
  onTocCollapsedNodeIdsChange: (next: ReadonlySet<number>) => void;
  // ---- Reference panel / alignment ----
  /** The target's own reference links (GUIDs + referencelist area). */
  refs: ReferenceLinks;
  /** Kind of target this tab represents. Drives which sub-tabs are shown. */
  targetKind: RefPanelTargetKind;
  /** Which reference sub-tab is active, as remembered by App.
   *  `null` means "no explicit choice yet" → this view falls back to the
   *  per-target default (BDB with alignment → Work area, else Basis). */
  refSubTab: RefSubTab | null;
  onRefSubTabChange: (t: RefSubTab) => void;
  /**
   * Whether the Reference panel is hidden. Only honoured in standard mode
   * (Basis / Referenceliste / Paradigm); aligned mode always renders the
   * parent work-area column regardless.
   */
  refPanelCollapsed: boolean;
  onToggleRefPanelCollapsed: () => void;
  /**
   * For BDB tabs: sections of the parent work area, used by the aligned
   * "Work area" sub-tab. `null` means no parent work area is available
   * (unassigned BDB) — the Work-area sub-tab is then hidden entirely.
   *
   * For work-area tabs: always null.
   */
  alignment: {
    sideTitle: string;
    sections: SectionData[];
  } | null;
  /**
   * Slice "Version compare" Phase E — same shape as `alignment`,
   * holding the matched-and-diff-marked sections from the loaded
   * Version reference. Drives the right column of the aligned view
   * when the user picks the "Version reference" sub-tab.
   *
   * Null when no reference file is loaded, OR when the current spec
   * has no match in the reference. The "Version reference" sub-tab
   * is hidden in those cases (the consumer in MainPane gates on
   * `referenceFile != null`; SpecTabView gates the dropdown option
   * on `versionAlignment != null`).
   */
  versionAlignment?: {
    sideTitle: string;
    sections: SectionData[];
  } | null;
  /** Global "Compact view" toggle. When true, the content + aligned
   *  views and the TOC hide sections whose body has no content. */
  compactView: boolean;
  /** Global layout mode. "print" wraps the section list in an A4-
   *  wide "page" container with a grey gutter. Ignored in aligned
   *  mode — two columns don't fit on one page. */
  layoutMode: LayoutMode;
  /** Edit plumbing for Phase 6 Slice B. Omit all three for read-only. */
  sectionKind?: SectionKind;
  editedBodyFor?: (sectionId: number) => string;
  onEditBody?: (
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  /**
   * Slice 10H.7.b — PFBB child mode. When set, the sections passed in
   * are the master's sections; each one renders the master body as a
   * read-only grey block followed by the child's editable supplement
   * (via SectionBlock's child-mode branch). When absent, the view
   * behaves exactly as before. Forwarded straight to SpecView.
   *
   * Aligned mode is hidden in child mode: the meaningful "comparison"
   * for a child is master → supplement, which the main column already
   * renders.
   */
  childContext?: PfbbChildContext;
  /**
   * Slice 10H.11 / #235 — optional banner rendered below the sticky
   * header and above the TOC/content/reference row. Used by the PFBB
   * child view to surface broken supplements. Null / undefined means
   * no banner.
   */
  banner?: React.ReactNode;
  /**
   * Slice 10G — right-click on a TOC node fires this callback. The
   * parent (App.tsx) pops up the hierarchy context menu. Optional;
   * PFBB child views omit this so the menu doesn't appear (the
   * master owns the section structure).
   */
  onSectionContextMenu?: (
    sectionId: number,
    coords: { x: number; y: number },
  ) => void;
  /**
   * UX3 / UX3-bis — section ids that should carry the TOC change
   * dot (computed by MainPane via `findChangedSectionIds` from the
   * canonical `compareVersions` output). Empty / undefined → no
   * compare in progress, no dots. Forwarded straight to TOCColumn.
   */
  sectionsWithChanges?: ReadonlySet<number>;
  /** SPLIT-Merge (#248) — passed through to SpecView's empty-state action. */
  onFillFromStandard?: (() => void) | null;
}

const EMPTY_IDS: ReadonlySet<number> = new Set();

export function SpecTabView({
  sections,
  tocFilter,
  onTocFilterChange,
  tocCollapsedNodeIds,
  onTocCollapsedNodeIdsChange,
  refs,
  targetKind,
  refSubTab,
  onRefSubTabChange,
  refPanelCollapsed,
  onToggleRefPanelCollapsed,
  alignment,
  versionAlignment,
  compactView,
  layoutMode,
  sectionKind,
  editedBodyFor,
  onEditBody,
  childContext,
  banner,
  onSectionContextMenu,
  sectionsWithChanges,
  ...specProps
}: Props): JSX.Element {
  const t = useT();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const alignedScrollRef = useRef<HTMLDivElement>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<number>>(EMPTY_IDS);

  // Picking a different reference type can swap the whole scroll container
  // (standard mode ↔ aligned mode = different DOM). Without special care
  // the new container mounts at scrollTop = 0 and the editor "jumps to the
  // top of the spec". We fix that by snapshotting the section the user was
  // currently looking at *before* the switch, then scrolling the new
  // container to that same section after it mounts. Anchor is the BDB/work-
  // area section id — works across layouts because both sides carry the
  // same section ids on the left column.
  const pendingAnchorRef = useRef<number | null>(null);

  const handleSubTabChange = (t: RefSubTab): void => {
    const root = isAlignedRendered
      ? alignedScrollRef.current
      : contentScrollRef.current;
    if (root) {
      pendingAnchorRef.current = findAnchorSectionId(root);
    }
    onRefSubTabChange(t);
  };

  /**
   * Collapse-toggle handler. Same anchor-preservation trick as sub-tab
   * changes: in aligned mode the rendered layout flips between the
   * 2-column aligned grid and the single-column SpecView, so the scroll
   * container changes. Without this, toggling in aligned mode would jump
   * the user to the top of the BDB.
   */
  const handleToggleRefPanel = (): void => {
    const root = isAlignedRendered
      ? alignedScrollRef.current
      : contentScrollRef.current;
    if (root) {
      pendingAnchorRef.current = findAnchorSectionId(root);
    }
    onToggleRefPanelCollapsed();
  };

  // Injected reference content (Glasshouse-only Molio). In Community no
  // provider is mounted: `molioReferenceEnabled` is false, the Molio sub-tabs
  // are hidden, and the Molio alignment + panel below are null.
  const referenceContentApi = useReferenceContentApi();
  const molioReferenceEnabled = referenceContentApi.enabled;

  // If the requested sub-tab is not valid for this target (e.g. "paradigm"
  // on a BDB, or "workArea" on a BDB with no parent), fall back to the
  // per-target default. `null` also means "use the default", which lets
  // fresh tabs open on Work-area for BDBs that have a parent.
  const hasAlignment = alignment != null;
  const hasVersionAlignment = versionAlignment != null;
  const chosen = refSubTab ?? defaultSubTab(targetKind, hasAlignment);
  const effectiveSubTab = coerceSubTab(
    chosen,
    targetKind,
    hasAlignment,
    hasVersionAlignment,
    molioReferenceEnabled,
  );

  // Whether there is any reference sub-tab worth showing. False in Community
  // for targets with no work-area alignment and no version reference, so the
  // view renders content only (no reference column, no dropdown).
  const hasReferenceUi =
    visibleSubTabs(
      targetKind,
      hasAlignment,
      hasVersionAlignment,
      molioReferenceEnabled,
    ).length > 0;

  // Pure sub-tab classification (no Molio imports). Basis / Instruction /
  // Paradigm render through the aligned view when Molio content is loaded.
  const isMolioContentTab =
    effectiveSubTab === "basis" ||
    effectiveSubTab === "instruction" ||
    effectiveSubTab === "paradigm";

  // Molio content for the active sub-tab: the aligned right side (Basis /
  // Instruction / Paradigm) and the standard-mode reference panel. Both null
  // in Community.
  const { alignment: molioAlignment, panel: referencePanel } =
    referenceContentApi.useContent({ refs, effectiveSubTab });
  const hasMolioAlignment = molioAlignment != null;

  // "Aligned mode" - the user picked a side-by-side sub-tab that has data:
  //   - Work area          -> PFBB-style alignment of BDB vs parent.
  //   - Version reference  -> user's spec vs matched reference spec.
  //   - Basis/Instruction/Paradigm -> user's spec vs Molio content.
  // All render through AlignedSpecView; only the right side (and version-
  // compare's diff marks) differ.
  const isAlignedMode =
    (effectiveSubTab === "workArea" && hasAlignment) ||
    (effectiveSubTab === "versionReference" && hasVersionAlignment) ||
    (isMolioContentTab && hasMolioAlignment);
  // The alignment record actually used by the right column. Picks between the
  // three variants based on which sub-tab is active and what's loaded.
  const activeAlignment =
    isMolioContentTab && hasMolioAlignment
      ? molioAlignment
      : effectiveSubTab === "versionReference" && hasVersionAlignment
        ? versionAlignment
        : alignment;
  // Which of the three layouts we actually render. See specTabLayout.ts
  // for the decision table. `isAlignedRendered` is a convenience for the
  // many places that just need to know "is the aligned grid live?".
  const layout = decideSpecTabLayout({ isAlignedMode, refPanelCollapsed });
  // Aligned view works in both layout modes:
  // - web:   two fluid columns, user spec left, parent paradigm right.
  // - print: same two-column grid, but the LEFT column is locked to A4
  //          width (210mm) with paper background. Right column stays
  //          web-style so the reference reads as before.
  const isAlignedRendered = layout === "aligned";

  useEffect(() => {
    // Decide which container the scrollspy watches based on the mode.
    const root = isAlignedRendered
      ? alignedScrollRef.current
      : contentScrollRef.current;
    if (!root) return;

    const updateActive = (): void => {
      const els = root.querySelectorAll<HTMLElement>("[data-section-id]");
      if (els.length === 0) {
        setActiveIds((prev) => (prev.size === 0 ? prev : EMPTY_IDS));
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const rootTop = rootRect.top;
      const rootBottom = rootRect.bottom;

      // Test visibility against each section's heading row — not its whole
      // rect. See the long comment in the previous version of this file;
      // heading-only detection is what lets us highlight only the sections
      // actually on screen without pulling in ancestors.
      const visible = new Set<number>();
      let firstVisibleIdx = -1;
      let lastAboveIdx = -1;
      const elsArr = Array.from(els);
      for (let i = 0; i < elsArr.length; i++) {
        const header = elsArr[i]!.querySelector<HTMLElement>(
          ":scope > .section__header",
        );
        if (!header) continue;
        const rect = header.getBoundingClientRect();
        if (rect.bottom <= rootTop) {
          lastAboveIdx = i;
        } else if (rect.top < rootBottom) {
          visible.add(Number(elsArr[i]!.dataset.sectionId));
          if (firstVisibleIdx === -1) firstVisibleIdx = i;
        } else {
          // DOM order == visual order, so stop.
          break;
        }
      }

      if (firstVisibleIdx > 0) {
        visible.add(Number(elsArr[firstVisibleIdx - 1]!.dataset.sectionId));
      }
      if (visible.size === 0) {
        const idx = lastAboveIdx !== -1 ? lastAboveIdx : 0;
        visible.add(Number(elsArr[idx]!.dataset.sectionId));
      }

      setActiveIds((prev) => (setsEqual(prev, visible) ? prev : visible));
    };

    let rafId: number | null = null;
    const onScroll = (): void => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateActive();
      });
    };

    updateActive();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    // Re-run when the sections or rendered layout mode change, so we pick
    // up the right scroll container and the right element list. Collapse
    // toggling counts as a layout change in aligned mode (2-col → 1-col).
  }, [sections, isAlignedRendered]);

  // After a layout mode switch, restore the scroll position to the section
  // the user was viewing before the switch — see the comment above
  // `pendingAnchorRef` for the rationale. `scroll-margin-top` on .section /
  // .aligned__cell keeps the sticky header from covering the anchor.
  useEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (anchor == null) return;
    pendingAnchorRef.current = null;
    const root = isAlignedRendered
      ? alignedScrollRef.current
      : contentScrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-section-id="${anchor}"]`);
    if (el) el.scrollIntoView({ block: "start" });
  }, [isAlignedRendered]);

  // Label shown on the right side of the unified header. In aligned mode
  // the dropdown displays the work-area name (that's the "reference" the
  // user is comparing against); in standard mode it displays the current
  // ref-type's plain label ("Basis", "Referenceliste", …).
  const rightLabel =
    isAlignedMode && activeAlignment
      ? activeAlignment.sideTitle
      : t(labelKeyFor(effectiveSubTab));

  return (
    <>
      <TOCColumn
        sections={sections}
        filter={tocFilter}
        onFilterChange={onTocFilterChange}
        collapsedNodeIds={tocCollapsedNodeIds}
        onCollapsedNodeIdsChange={onTocCollapsedNodeIdsChange}
        activeSectionIds={activeIds}
        compactView={compactView}
        // Slice 10H.7.b polish — in child mode, compute the set of
        // master-section ids where a supplement exists (either on
        // disk or pending) so TOCColumn can show a marker.
        sectionsWithSupplement={
          childContext
            ? buildSectionsWithSupplementSet(sections, childContext)
            : undefined
        }
        // UX3 / UX3-bis — pre-computed by MainPane from the same
        // compareVersions output the Revisions tab uses, so the TOC
        // dots and the Revisions list never disagree. Undefined
        // when no compare is in progress.
        sectionsWithChanges={sectionsWithChanges}
        // Slice 10G — right-click context menu for hierarchy edits.
        // Only offered when the parent provided a handler. Child views
        // pass nothing (master owns the section structure).
        onSectionContextMenu={onSectionContextMenu}
      />
      {/* Unified spec layout: one header bar across the full width of the
       *  content + reference area, plus a body below that shows either the
       *  standard (SpecView + ReferencePanel) pair or the aligned grid.
       *  The header is a flex-shrink-0 child of a flex-column, so it stays
       *  pinned at the top while whichever scroll container is below
       *  scrolls independently. Same structure for both modes — the only
       *  thing that changes when the user picks a different reference
       *  type is the body. */}
      <div
        className={`spec-main${
          refPanelCollapsed || !hasReferenceUi
            ? " spec-main--ref-collapsed"
            : ""
        }`}
      >
        <header className="spec-main__header">
          <div
            className="spec-main__title spec-main__title--left"
            title={specProps.title}
          >
            <span className="spec-main__title-text">{specProps.title}</span>
            {/* Expand chevron lives at the right edge of the (now-only)
             *  left cell when the reference/aligned pane is collapsed.
             *  Shown in BOTH standard and aligned modes — in aligned
             *  mode it brings back the parent work-area column. */}
            {refPanelCollapsed && hasReferenceUi && (
              <button
                type="button"
                className="ref-panel__toggle ref-panel__toggle--expand"
                onClick={handleToggleRefPanel}
                aria-label={refPanelToggleLabel({
                  isAlignedMode,
                  collapsed: true,
                })}
                aria-expanded={false}
                title={refPanelToggleLabel({ isAlignedMode, collapsed: true })}
              >
                ‹
              </button>
            )}
          </div>
          {/* Right cell hosts the ref-type dropdown when the pane is open.
           *  When collapsed we drop the cell entirely so the header
           *  reverts to a single column (see .spec-main--ref-collapsed in
           *  styles.css). The dropdown is not meaningful with no pane to
           *  drive; clicking the expand chevron brings it back. */}
          {!refPanelCollapsed && hasReferenceUi && (
            <div className="spec-main__title spec-main__title--right">
              <RefTypeDropdown
                label={rightLabel}
                targetKind={targetKind}
                hasAlignment={hasAlignment}
                hasVersionReference={hasVersionAlignment}
                hasMolioReference={molioReferenceEnabled}
                activeSubTab={effectiveSubTab}
                onSubTabChange={handleSubTabChange}
                className="ref-dropdown--inline"
              />
              {/* Collapse chevron sits flush against the left edge of the
               *  right cell (i.e. the divider between content + ref pane)
               *  so the click target is right where the pane actually
               *  attaches. Shown in both modes. */}
              <button
                type="button"
                className="ref-panel__toggle ref-panel__toggle--collapse"
                onClick={handleToggleRefPanel}
                aria-label={refPanelToggleLabel({
                  isAlignedMode,
                  collapsed: false,
                })}
                aria-expanded={true}
                title={refPanelToggleLabel({ isAlignedMode, collapsed: false })}
              >
                ›
              </button>
            </div>
          )}
        </header>
        {banner}
        <div className="spec-main__body">
          {isAlignedRendered && activeAlignment ? (
            <AlignedSpecView
              ref={alignedScrollRef}
              leftSections={sections}
              rightSections={activeAlignment.sections}
              compactView={compactView}
              sectionKind={sectionKind}
              editedBodyFor={editedBodyFor}
              onEditBody={onEditBody}
              layoutMode={layoutMode}
              leftTitle={specProps.title}
              leftSubtitle={specProps.subtitle}
              leftKind={specProps.kind}
              leftRevision={specProps.revision}
              leftRevisionDate={specProps.revisionDate}
              rightTitle={activeAlignment.sideTitle}
              childContext={
                effectiveSubTab === "versionReference"
                  ? undefined
                  : childContext
              }
            />
          ) : (
            <>
              <div
                className={`spec-content${
                  layoutMode === "print" ? " spec-content--print" : ""
                }`}
                ref={contentScrollRef}
              >
                {layoutMode === "print" ? (
                  <div className="spec-content__page">
                    <SpecView
                      sections={sections}
                      compactView={compactView}
                      sectionKind={sectionKind}
                      editedBodyFor={editedBodyFor}
                      onEditBody={onEditBody}
                      childContext={childContext}
                      {...specProps}
                    />
                  </div>
                ) : (
                  <SpecView
                    sections={sections}
                    compactView={compactView}
                    sectionKind={sectionKind}
                    editedBodyFor={editedBodyFor}
                    onEditBody={onEditBody}
                    childContext={childContext}
                    {...specProps}
                  />
                )}
              </div>
              {!refPanelCollapsed && !isAlignedMode && hasReferenceUi
                ? referencePanel
                : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Slice 10H.7.b polish — collect master-section ids that should get a
 * supplement marker in the TOC. We mark based on the EFFECTIVE body
 * (edit-buffer merged with disk): the dot should reflect what the
 * user will see after the next save.
 *
 *   - Persisted supplement with disk text → effectiveBody non-empty → marked.
 *   - Persisted supplement cleared to empty (staged delete) →
 *     effectiveBody "" → NOT marked. Clearing the text visibly
 *     removes the dot even though a delete edit is pending.
 *   - New-this-session supplement with typed text → effectiveBody
 *     non-empty → marked.
 *   - New-this-session supplement cleared again → effectiveBody "" →
 *     NOT marked (the pending create was dropped by the edit-map
 *     helper).
 *
 * Pure; called once per SpecTabView render in child mode.
 */
function buildSectionsWithSupplementSet(
  sections: readonly SectionData[],
  childContext: PfbbChildContext,
): ReadonlySet<number> {
  const out = new Set<number>();
  for (const s of sections) {
    const snap = childContext.supplementFor(s.id);
    if (snap.effectiveBody.length > 0) {
      out.add(s.id);
    }
  }
  return out;
}

/** Cheap set-equality for primitive members. Prevents re-renders when the
 *  scroll tick produces an identical set. */
function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Find the section id the user is currently "reading" in the given scroll
 * container. We pick the first section whose header is at or below the
 * container's top edge — i.e. the topmost section still visible after any
 * sections above have scrolled off. Falls back to the last-above section
 * if nothing is visible (empty spec or scrolled far past the end), and
 * finally to null when the container has no sections.
 */
function findAnchorSectionId(root: HTMLElement): number | null {
  const els = root.querySelectorAll<HTMLElement>("[data-section-id]");
  if (els.length === 0) return null;
  const rootTop = root.getBoundingClientRect().top;
  let lastAbove: number | null = null;
  for (const el of Array.from(els)) {
    const header = el.querySelector<HTMLElement>(":scope > .section__header");
    if (!header) continue;
    const rect = header.getBoundingClientRect();
    if (rect.bottom > rootTop) {
      return Number(el.dataset.sectionId);
    }
    lastAbove = Number(el.dataset.sectionId);
  }
  return lastAbove;
}
