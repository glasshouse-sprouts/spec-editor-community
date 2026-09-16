/**
 * Main pane — renders the content for the currently active tab.
 *
 *   - project       → project metadata card
 *   - workSpec      → SpecTabView (TOC + spec content + Reference panel)
 *   - bdb           → SpecTabView for the BDB (same layout, plus the
 *                     "Work area" sub-tab that aligns with the parent work
 *                     area)
 *   - controlPlan   → Phase-5 placeholder
 *
 * Note on layout: the outer `.main-pane` (in App.tsx) is a flex row with
 * no padding/overflow of its own. Spec tab views render their own 3-column
 * layout directly (TOC + content + Reference). Card-style views wrap
 * themselves in `.main-pane__scroll` for padding and independent scrolling.
 *
 * Per-tab UI state (TOC filter, TOC collapsed, active Reference sub-tab)
 * is owned by App.tsx and plumbed through as controlled props so each tab
 * remembers its own state across switches.
 */

import { useEffect, useRef, useState } from "react";

import type {
  BdbInfo,
  ContractInfo,
  ControlPlanRowData,
  CpRowEditableField,
  FilePayload,
  SectionData,
  WorkSpecInfo,
} from "../../shared/ipc.js";
import { ControlPlanTableView } from "./ControlPlanTableView.js";
import { basename } from "./fileUtils.js";
import { useT } from "./i18n/i18n.js";
import {
  useVersionCompareEngine,
  type VersionCompareEngine,
} from "./VersionCompareContext.js";
import { useVersionCompareFormat } from "./compare/versionCompareFormat.js";
import {
  findBdbById,
  findControlPlanById,
  findWorkSpecById,
} from "./loaded.js";
import { ExportCard } from "./ExportCard.js";
import { CoverCard } from "./CoverCard.js";
import type { SectionKind } from "./edits.js";
import type { LayoutMode } from "./layoutModePrefs.js";
import type { RefSubTab } from "./refTypes.js";
import { PfbbBrokenSupplementsBanner } from "./PfbbBrokenSupplementsBanner.js";
import { buildMergedChildView } from "./pfbbMergedView.js";
import { Sidebar, sidebarContractLabel } from "./Sidebar.js";
import { SpecTabView } from "./SpecTabView.js";
import type { TabTarget } from "./tabs.js";

interface Props {
  data: FilePayload;
  target: TabTarget;
  tocFilter: string;
  onTocFilterChange: (q: string) => void;
  tocCollapsedNodeIds: ReadonlySet<number>;
  onTocCollapsedNodeIdsChange: (next: ReadonlySet<number>) => void;
  refSubTab: RefSubTab | null;
  onRefSubTabChange: (t: RefSubTab) => void;
  /** Whether this tab's Reference panel is collapsed. Ignored in
   *  aligned mode — there is no separate reference pane to hide. */
  refPanelCollapsed: boolean;
  onToggleRefPanelCollapsed: () => void;
  /** Global "Compact view" toggle. When true, sections with empty
   *  bodies are hidden throughout this pane (spec content, aligned
   *  view, and TOC). */
  compactView: boolean;
  /** Global layout mode. "print" wraps the section pane in an A4-
   *  width "page" with a grey gutter so editing feels document-like.
   *  "web" is the default fluid layout. Only affects SpecTabView;
   *  control plans keep their own layout. */
  layoutMode: LayoutMode;
  /** Edit plumbing for Phase 6 Slice B. */
  editedBodyFor: (
    kind: SectionKind,
    sectionId: number,
    originalBody: string,
  ) => string;
  onEditBody: (
    kind: SectionKind,
    sectionId: number,
    nextBody: string,
    originalBody: string,
  ) => void;
  /**
   * Slice 10H.7 Commit 5 — PFBB child supplement plumbing. Only
   * invoked when the active target is a PFBB child BDB (pfbbId set).
   * Optional so callers that never open a child (tests, Storybook)
   * don't need to stub these.
   */
  pfbbSupplementFor?: (
    childBdbId: number,
    masterSectionId: number,
    view: import("./pfbbMergedView.js").MergedChildView,
  ) => import("./pfbbChildContext.js").PfbbChildSupplementSnapshot;
  onPfbbSupplementBodyChange?: (
    childBdbId: number,
    view: import("./pfbbMergedView.js").MergedChildView,
    input: { masterSectionId: number; sectionNo: string; body: string },
  ) => void;
  /**
   * Slice 10H.11 / #235 — delete a broken child-side supplement row
   * (one whose `pfbbSectionId` no longer matches a master section).
   * Surfaced from the red warning banner above the child view.
   */
  onDeletePfbbBrokenSupplement?: (sectionId: number) => void;
  /**
   * Slice 10G — right-click on a TOC node fires this. Parent app
   * pops up the section context menu. Threaded only for non-child
   * views (PFBB child tabs omit it so the menu doesn't appear).
   */
  onSectionContextMenu?: (
    specKind: "workSpec" | "bdb",
    specId: number,
    sectionId: number,
    coords: { x: number; y: number },
  ) => void;
  /** CP edit plumbing (Phase 6 Slice 6H — #40). */
  editedCpTitleFor: (controlPlanId: number, originalTitle: string) => string;
  onEditCpTitle: (
    controlPlanId: number,
    nextTitle: string,
    originalTitle: string,
  ) => void;
  editedCpRowCellFor: (
    rowId: number,
    field: CpRowEditableField,
    originalValue: string,
  ) => string;
  onEditCpRowCell: (
    rowId: number,
    field: CpRowEditableField,
    nextValue: string,
    originalValue: string,
  ) => void;
  /** Insert a blank row under the given header in this plan. No modal —
   *  fires the IPC directly; the host pops a banner on failure. */
  onRequestAddRow: (controlPlanId: number, headerId: number) => void;
  /** Task 89 — append an empty section at the bottom of this plan. Same
   *  no-modal, fire-the-IPC-directly shape as `onRequestAddRow`. */
  onRequestAddHeader: (controlPlanId: number) => void;
  /** Right-click on a data row → host opens a confirm dialog. */
  onRequestDeleteRow: (row: ControlPlanRowData) => void;
  /** 10I-followup gap 3 — effective header text/no for inline-edited
   *  CP section headers. */
  editedCpHeaderFor?: (
    headerId: number,
    field: "header" | "headerNo",
    originalValue: string,
  ) => string;
  /** 10I-followup gap 3 — stage a header text/no edit. */
  onEditCpHeader?: (
    headerId: number,
    field: "header" | "headerNo",
    nextValue: string,
    originalValue: string,
  ) => void;
  /**
   * Contract-card plumbing for the Project view (Slice 6I).
   * `effective*For` helpers let us show buffered edits without the
   * Project view having to know about the edit map.
   */
  effectiveContractCodeFor: (
    contractId: number,
    originalCode: string | null,
  ) => string | null;
  effectiveContractNameFor: (
    contractId: number,
    originalName: string | null,
  ) => string | null;
  isContractEditedFor: (contractId: number) => boolean;
  onRequestNewContract: () => void;
  onSeedDefaultContracts: () => void;
  onRequestEditContract: (contractId: number) => void;
  onRequestDeleteContract: (contractId: number) => void;
  /**
   * Slice 10D — project metadata editing. Optional so tab-only
   * MainPane callers (tests, spec views) don't have to wire it. When
   * the user clicks "Edit…" on the project metadata card, the host
   * opens a modal and the buffered edit goes through the same save
   * pipeline as section edits.
   *
   * `effectiveProjectField` lets the card show pending edits without
   * knowing about the edit buffer; `isProjectEdited` is used to show
   * the "• edited" marker next to the card title.
   */
  effectiveProjectField?: (
    field: "name" | "projectNumber" | "builder" | "molioReferencelistDate",
    originalValue: string | null,
  ) => string | null;
  isProjectEdited?: boolean;
  onRequestEditProject?: () => void;
  /**
   * Phase 10 Slice 10C — Project Overview's 2fr column hosts an
   * embedded instance of the same <Sidebar> as the main rail. These
   * props are plumbed straight through from App.tsx so the embedded
   * tree sees the exact same tree, selection and right-click handlers
   * as the main one. All optional — the spec tab views ignore them,
   * and tests can render MainPane without them.
   */
  selection?: TabTarget;
  onSelect?: (s: TabTarget) => void;
  onDuplicateBdb?: (bdbId: number) => void;
  onCreatePfbbChild?: (bdbId: number) => void;
  onNewControlPlan?: (bdbId: number) => void;
  onDeleteControlPlan?: (controlPlanId: number) => void;
  onMoveControlPlan?: (controlPlanId: number) => void;
  onMoveWorkSpecToContract?: (workSpecId: number) => void;
  onDeleteWorkSpec?: (workSpecId: number) => void;
  onDeleteBdb?: (bdbId: number) => void;
  /** Slice 10E — "Edit metadata…" passed through to embedded tree. */
  onRequestEditWorkSpec?: (workSpecId: number) => void;
  onRequestEditBdb?: (bdbId: number) => void;
  /** Slice 10K — "Attachments…" on work-area rows. Attachments FK to
   *  `work_spec(id)` per Molio 2.0, not to BDB. */
  onManageAttachments?: (workSpecId: number) => void;
  /** Slice 10K.5 — clicking the project-wide Attachments counter on the
   *  Project Overview card opens the global Attachments overview modal. */
  onShowGlobalAttachments?: () => void;
  /** Slice 10K.8 — sidebar-driven attachment actions. Threaded through
   *  to the embedded project-overview tree so right-click / double-click
   *  behave the same as on the main rail. */
  onRequestOpenAttachment?: (attachmentId: number) => void;
  onRequestRenameAttachment?: (attachmentId: number) => void;
  onRequestDeleteAttachment?: (attachmentId: number) => void;
  onRequestMoveAttachment?: (attachmentId: number) => void;
  /** Slice 10F — "Edit metadata…" on control-plan rows. */
  onRequestEditCp?: (controlPlanId: number) => void;
  isContractPendingDelete?: (contractId: number) => boolean;
  isWorkSpecPendingDelete?: (workSpecId: number) => boolean;
  /** Slice 10H.6d — lock actions on the virtual PFBB work_spec row. */
  isVirtualWorkSpec?: (workSpecId: number) => boolean;
  isBdbPendingDelete?: (bdbId: number) => boolean;
  /** FIX-DelCpStrike 2026-05-11 — strikethrough for CPs in the embedded
   *  project-overview sidebar (same predicate as the main rail). */
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
  onRestoreContract?: (contractId: number) => void;
  onRestoreWorkSpec?: (workSpecId: number) => void;
  onRestoreBdb?: (bdbId: number) => void;
  /** Restore a directly-pending CP delete patch. */
  onRestoreControlPlan?: (controlPlanId: number) => void;
  effectiveWorkSpecContractFor?: (
    workSpecId: number,
    originalContractId: number | null,
  ) => number | null;
  /**
   * Slice 6M — buffered container deletes. When the active tab's target
   * has been marked for deletion (directly or via a pending-deleted
   * ancestor), MainPane shows a placeholder instead of the normal
   * editor. The host decides when to set `isPendingDelete` and wires
   * `onRestore` to the exact patch that should be dropped (direct or
   * ancestor). Optional so old callers still compile.
   */
  isPendingDelete?: boolean;
  /** Human-readable phrase for the restore button ("Restore work area",
   *  "Restore contract", "Restore BDB"). Shown only when
   *  `isPendingDelete` is true. */
  pendingDeleteRestoreLabel?: string;
  onRestorePendingDelete?: () => void;
  /** Slice 10H.10-UX — opens the shared Export-PDFs modal (owned by
   *  App.tsx). Threaded to ExportCard in the Project-tab cards. */
  onOpenExport: () => void;
  /**
   * Slice "Highlights & formatting" — the pre-rendered view shown
   * when the active tab is `{ kind: "highlights" }`. App.tsx owns
   * the wiring (highlights array, breadcrumb resolver, jump-to
   * handler) and hands MainPane the finished JSX so MainPane stays
   * thin. Null when no file is loaded.
   */
  highlightsView?: JSX.Element | null;
  /**
   * Slice "Version compare" — same shape as `highlightsView`, but for
   * the `{ kind: "revisions" }` tab. Null when no Version reference
   * is loaded (which means the user can't reach the tab anyway, but
   * we render an empty-state fallback as defence-in-depth).
   */
  revisionsView?: JSX.Element | null;
  /**
   * Slice "Version compare" Phase E — the loaded Version reference
   * payload, if any. Used to build `versionAlignment` per spec tab
   * (workSpec / BDB) so SpecTabView can offer the "Version
   * reference" sub-tab + the aligned read-only-with-diff view.
   * Null when no reference is loaded.
   */
  referenceFile?: FilePayload | null;
  /**
   * UX3-bis — pre-computed `compareVersions` output for the current
   * (data, referenceFile) pair, memoised at the App level. Used here
   * to build the per-tab Set<sectionId> of sections that should
   * carry a "changed" dot in the TOC. Same source as the Revisions
   * tab so the two views can never diverge. Null when no compare
   * is in progress.
   */
  versionRevisions?: ReadonlyArray<
    import("./compare/compareTypes.js").Revision
  > | null;
  /**
   * SPLIT-Merge (#248) — when the user opens an empty arbejdsbeskrivelse,
   * SpecView shows a "Indlæs fra standardbeskrivelse" link below the
   * "Denne specifikation har ingen afsnit"-hint. The callback opens
   * the FillFromStandardModal. App.tsx provides it; we only thread it
   * through to the workSpec branch and skip BDB/CP branches.
   * Omit to hide the link.
   */
  onFillFromStandard?: (wsId: number) => void;
  /** SPLIT-Merge — same set as Sidebar uses to gate its context-menu
   *  item. Computed once in App.tsx via useMemo. */
  fillFromStandardEligible?: ReadonlySet<number>;
}

export function MainPane({
  data,
  target,
  tocFilter,
  onTocFilterChange,
  tocCollapsedNodeIds,
  onTocCollapsedNodeIdsChange,
  refSubTab,
  onRefSubTabChange,
  refPanelCollapsed,
  onToggleRefPanelCollapsed,
  compactView,
  layoutMode,
  editedBodyFor,
  onEditBody,
  pfbbSupplementFor,
  onPfbbSupplementBodyChange,
  onDeletePfbbBrokenSupplement,
  onSectionContextMenu,
  editedCpTitleFor,
  onEditCpTitle,
  editedCpHeaderFor,
  onEditCpHeader,
  editedCpRowCellFor,
  onEditCpRowCell,
  onRequestAddRow,
  onRequestAddHeader,
  onRequestDeleteRow,
  effectiveContractCodeFor,
  effectiveContractNameFor,
  isContractEditedFor,
  onRequestNewContract,
  onSeedDefaultContracts,
  onRequestEditContract,
  onRequestDeleteContract,
  effectiveProjectField,
  isProjectEdited = false,
  onRequestEditProject,
  selection,
  onSelect,
  onDuplicateBdb,
  onCreatePfbbChild,
  onNewControlPlan,
  onDeleteControlPlan,
  onMoveControlPlan,
  onMoveWorkSpecToContract,
  onDeleteWorkSpec,
  onDeleteBdb,
  onRequestEditWorkSpec,
  onRequestEditBdb,
  onManageAttachments,
  onShowGlobalAttachments,
  onRequestOpenAttachment,
  onRequestRenameAttachment,
  onRequestDeleteAttachment,
  onRequestMoveAttachment,
  onRequestEditCp,
  isContractPendingDelete,
  isWorkSpecPendingDelete,
  isVirtualWorkSpec,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
  onRestoreContract,
  onRestoreWorkSpec,
  onRestoreBdb,
  onRestoreControlPlan,
  effectiveWorkSpecContractFor,
  isPendingDelete = false,
  pendingDeleteRestoreLabel,
  onRestorePendingDelete,
  onOpenExport,
  highlightsView,
  revisionsView,
  referenceFile,
  versionRevisions,
  onFillFromStandard,
  fillFromStandardEligible,
}: Props): JSX.Element {
  const t = useT();
  // Slice "Version compare" Phase E — used to format the diff marks
  // baked into the right column of the aligned view.
  const [versionFormat] = useVersionCompareFormat();
  // Version-compare engine (Glasshouse-only; no-op default in Community).
  // Drives the aligned version column + the TOC change dots.
  const versionEngine = useVersionCompareEngine();
  // Slice 6M — doomed containers render a placeholder in the tab so
  // the user can't keep editing something that's about to disappear.
  // The project tab itself never gets deleted, so skip the guard there.
  if (isPendingDelete && target.kind !== "project") {
    return (
      <div className="main-pane__scroll">
        <PendingDeletePlaceholder
          label={pendingDeleteRestoreLabel}
          onRestore={onRestorePendingDelete}
        />
      </div>
    );
  }

  if (target.kind === "project") {
    // Project overview uses its own layout wrapper (no single outer
    // scroller) so that the tree column and cards column can scroll
    // independently — see `.main-pane__project` + `.project-overview`
    // in styles.css.
    return (
      <div className="main-pane__project">
        <ProjectView
          data={data}
          effectiveContractCodeFor={effectiveContractCodeFor}
          effectiveContractNameFor={effectiveContractNameFor}
          isContractEditedFor={isContractEditedFor}
          onRequestNewContract={onRequestNewContract}
          onSeedDefaultContracts={onSeedDefaultContracts}
          onRequestEditContract={onRequestEditContract}
          onRequestDeleteContract={onRequestDeleteContract}
          effectiveProjectField={effectiveProjectField}
          isProjectEdited={isProjectEdited}
          onRequestEditProject={onRequestEditProject}
          selection={selection ?? target}
          onSelect={onSelect}
          onDuplicateBdb={onDuplicateBdb}
          onCreatePfbbChild={onCreatePfbbChild}
          onNewControlPlan={onNewControlPlan}
          onDeleteControlPlan={onDeleteControlPlan}
          onMoveControlPlan={onMoveControlPlan}
          onMoveWorkSpecToContract={onMoveWorkSpecToContract}
          onDeleteWorkSpec={onDeleteWorkSpec}
          onDeleteBdb={onDeleteBdb}
          onRequestEditWorkSpec={onRequestEditWorkSpec}
          onRequestEditBdb={onRequestEditBdb}
          onFillFromStandard={onFillFromStandard}
          fillFromStandardEligible={fillFromStandardEligible}
          onManageAttachments={onManageAttachments}
          onShowGlobalAttachments={onShowGlobalAttachments}
          onRequestOpenAttachment={onRequestOpenAttachment}
          onRequestRenameAttachment={onRequestRenameAttachment}
          onRequestDeleteAttachment={onRequestDeleteAttachment}
          onRequestMoveAttachment={onRequestMoveAttachment}
          onRequestEditCp={onRequestEditCp}
          isContractPendingDelete={isContractPendingDelete}
          isWorkSpecPendingDelete={isWorkSpecPendingDelete}
          isVirtualWorkSpec={isVirtualWorkSpec}
          isBdbPendingDelete={isBdbPendingDelete}
          isControlPlanPendingDelete={isControlPlanPendingDelete}
          onRestoreContract={onRestoreContract}
          onRestoreWorkSpec={onRestoreWorkSpec}
          onRestoreBdb={onRestoreBdb}
          onRestoreControlPlan={onRestoreControlPlan}
          effectiveWorkSpecContractFor={effectiveWorkSpecContractFor}
          onOpenExport={onOpenExport}
        />
      </div>
    );
  }

  if (target.kind === "workSpec") {
    const ws = findWorkSpecById(data, target.id);
    if (!ws) {
      return (
        <div className="main-pane__scroll">
          <div className="main-pane__empty">
            {t("mainPane.workSpecNotFound")}
          </div>
        </div>
      );
    }
    const sections = data.sectionsByWorkSpec[ws.id] ?? [];
    // Slice "Live aligned diff" — the right column shows the diff
    // against the user's IN-PROGRESS edits, not the saved bodies, so
    // typing in the left column updates the right column live. We
    // build a per-render "liveSections" that swaps each body with
    // `editedBodyFor("workSpec", id, savedBody)`. The original
    // `sections` array stays untouched for the LEFT column path,
    // which already applies edits via its own `editedBodyFor` prop.
    const liveSectionsForAlignment = referenceFile
      ? sections.map((s) => ({
          ...s,
          body: editedBodyFor("workSpec", s.id, s.body),
        }))
      : sections;
    const versionAlignment = referenceFile
      ? findMatchingWorkAreaAlignment(
          ws,
          liveSectionsForAlignment,
          referenceFile,
          versionFormat.added,
          versionFormat.deleted,
          versionEngine.buildVersionAlignmentSections,
        )
      : null;
    // UX3-bis — derive the TOC change-dot set from the canonical
    // revisions list (same source as the Revisions tab). When no
    // compare is in progress, pass undefined → no dots.
    const wsChangedIds = versionRevisions
      ? versionEngine.findChangedSectionIds(sections, versionRevisions, {
          kind: "workSpec",
          currentId: ws.id,
        })
      : undefined;
    return (
      <SpecTabView
        title={ws.workAreaName}
        subtitle={ws.workAreaCode ?? undefined}
        kind={t("mainPane.kind.workArea")}
        revision={ws.revision}
        revisionDate={ws.revisionDate}
        sections={sections}
        tocFilter={tocFilter}
        onTocFilterChange={onTocFilterChange}
        tocCollapsedNodeIds={tocCollapsedNodeIds}
        onTocCollapsedNodeIdsChange={onTocCollapsedNodeIdsChange}
        refs={ws.refs}
        targetKind="workSpec"
        refSubTab={refSubTab}
        onRefSubTabChange={onRefSubTabChange}
        refPanelCollapsed={refPanelCollapsed}
        onToggleRefPanelCollapsed={onToggleRefPanelCollapsed}
        alignment={null}
        versionAlignment={versionAlignment}
        sectionsWithChanges={wsChangedIds}
        compactView={compactView}
        layoutMode={layoutMode}
        sectionKind="workSpec"
        editedBodyFor={(id) => {
          const s = sections.find((x) => x.id === id);
          return editedBodyFor("workSpec", id, s?.body ?? "");
        }}
        onEditBody={(id, nextBody, originalBody) =>
          onEditBody("workSpec", id, nextBody, originalBody)
        }
        onSectionContextMenu={
          onSectionContextMenu
            ? (sectionId, coords) =>
                onSectionContextMenu("workSpec", ws.id, sectionId, coords)
            : undefined
        }
        onFillFromStandard={
          // SPLIT-Merge — only show the link when the work area is
          // actually empty (no sections). Core re-checks this server-
          // side too; the client gate just avoids a useless click.
          sections.length === 0 && onFillFromStandard
            ? () => onFillFromStandard(ws.id)
            : null
        }
      />
    );
  }

  if (target.kind === "bdb") {
    const b = findBdbById(data, target.id);
    if (!b) {
      return (
        <div className="main-pane__scroll">
          <div className="main-pane__empty">{t("mainPane.bdbNotFound")}</div>
        </div>
      );
    }
    // Slice 10H.7.b — PFBB child: route to SpecTabView with a
    // childContext so the child inherits the full normal-spec chrome
    // (TOC, reference panel, compact view, print layout). The
    // standalone PfbbChildMergedView is gone; per-section grey master +
    // editable supplement rendering lives in SectionBlock's child branch.
    if (b.pfbbId != null) {
      const master = findBdbById(data, b.pfbbId);
      const masterSections =
        master != null ? (data.sectionsByBdb[master.id] ?? []) : [];
      const childSections = data.sectionsByBdb[b.id] ?? [];
      const view = buildMergedChildView({
        masterSections,
        childSections,
      });
      if (pfbbSupplementFor == null || onPfbbSupplementBodyChange == null) {
        return (
          <div className="main-pane__scroll">
            <div className="main-pane__empty">
              {t("mainPane.pfbbChildMissingWiring")}
            </div>
          </div>
        );
      }
      // A child inherits the master's references. Slice 10H.7.c:
      // the aligned "Work area" sub-tab is now available on PFBB
      // children too — it lines the child's (master + supplement)
      // column up against the child's OWN parent work_spec (the
      // real work_area it sits under in the tree). The master
      // itself lives under the virtual "Projektfælles" container
      // which is empty by design, so using the master's workSpecId
      // would give an empty comparison — we want the child's.
      const masterRefs = master?.refs ?? {
        basisGuid: null,
        basisRevisionGuid: null,
        paradigmGuid: null,
        paradigmRevisionGuid: null,
        referencelistArea: null,
        referencelistAreaDate: null,
      };
      const childParentWorkSpec =
        b.workSpecId != null
          ? (findWorkSpecById(data, b.workSpecId) ?? null)
          : null;
      const childAlignment =
        childParentWorkSpec != null
          ? {
              sideTitle: childParentWorkSpec.workAreaCode
                ? `${childParentWorkSpec.workAreaCode} — ${childParentWorkSpec.workAreaName}`
                : childParentWorkSpec.workAreaName,
              sections: data.sectionsByWorkSpec[childParentWorkSpec.id] ?? [],
            }
          : null;
      return (
        <SpecTabView
          title={b.name || t("mainPane.untitledChild")}
          subtitle={
            master
              ? t("mainPane.childOf", {
                  name: master.name || t("mainPane.untitledMaster"),
                })
              : t("mainPane.childOfMissingMaster")
          }
          kind={t("mainPane.kind.bdbPfbbChild")}
          revision={b.revision}
          revisionDate={b.revisionDate}
          sections={masterSections}
          tocFilter={tocFilter}
          onTocFilterChange={onTocFilterChange}
          tocCollapsedNodeIds={tocCollapsedNodeIds}
          onTocCollapsedNodeIdsChange={onTocCollapsedNodeIdsChange}
          refs={masterRefs}
          targetKind="bdb"
          refSubTab={refSubTab}
          onRefSubTabChange={onRefSubTabChange}
          refPanelCollapsed={refPanelCollapsed}
          onToggleRefPanelCollapsed={onToggleRefPanelCollapsed}
          alignment={childAlignment}
          compactView={compactView}
          layoutMode={layoutMode}
          // Section-body edits are NOT offered on the master in
          // child mode — the supplement editor handles writes.
          // Leaving sectionKind / editedBodyFor / onEditBody unset
          // keeps the master's body read-only via SectionBlock's
          // `isEditable` check.
          childContext={{
            childBdbId: b.id,
            masterName: master?.name ?? t("mainPane.missingMaster"),
            supplementFor: (masterSectionId) =>
              pfbbSupplementFor(b.id, masterSectionId, view),
            onSupplementBodyChange: (input) =>
              onPfbbSupplementBodyChange(b.id, view, input),
            brokenSupplements: view.brokenSupplements,
          }}
          banner={
            view.brokenSupplements.length > 0 &&
            onDeletePfbbBrokenSupplement ? (
              <PfbbBrokenSupplementsBanner
                broken={view.brokenSupplements}
                onDeleteBroken={onDeletePfbbBrokenSupplement}
              />
            ) : null
          }
        />
      );
    }
    const sections = data.sectionsByBdb[b.id] ?? [];
    // For BDBs with a parent work area, build the alignment side. If the
    // BDB is unassigned (workSpecId === null) or the id doesn't resolve,
    // we pass `null` — SpecTabView then hides the Work-area sub-tab.
    const parentWorkSpec =
      b.workSpecId != null
        ? (findWorkSpecById(data, b.workSpecId) ?? null)
        : null;
    const alignment =
      parentWorkSpec != null
        ? {
            sideTitle: parentWorkSpec.workAreaCode
              ? `${parentWorkSpec.workAreaCode} — ${parentWorkSpec.workAreaName}`
              : parentWorkSpec.workAreaName,
            sections: data.sectionsByWorkSpec[parentWorkSpec.id] ?? [],
          }
        : null;
    // Slice "Live aligned diff" — same in-progress-edit pass for BDB
    // tabs. See the workSpec branch comment.
    const liveSectionsForBdbAlignment = referenceFile
      ? sections.map((s) => ({
          ...s,
          body: editedBodyFor("bdb", s.id, s.body),
        }))
      : sections;
    const versionAlignmentBdb = referenceFile
      ? findMatchingBdbAlignment(
          b,
          parentWorkSpec,
          liveSectionsForBdbAlignment,
          referenceFile,
          versionFormat.added,
          versionFormat.deleted,
          versionEngine.buildVersionAlignmentSections,
        )
      : null;
    // UX3-bis — TOC change-dot set for the BDB tab. Same canonical
    // revisions list, parent matcher = this BDB's id.
    const bdbChangedIds = versionRevisions
      ? versionEngine.findChangedSectionIds(sections, versionRevisions, {
          kind: "bdb",
          currentId: b.id,
        })
      : undefined;
    return (
      <SpecTabView
        title={b.name}
        kind={b.isPfbb ? t("mainPane.kind.bdbPfbb") : t("mainPane.kind.bdb")}
        revision={b.revision}
        revisionDate={b.revisionDate}
        sections={sections}
        tocFilter={tocFilter}
        onTocFilterChange={onTocFilterChange}
        tocCollapsedNodeIds={tocCollapsedNodeIds}
        onTocCollapsedNodeIdsChange={onTocCollapsedNodeIdsChange}
        refs={b.refs}
        targetKind="bdb"
        refSubTab={refSubTab}
        onRefSubTabChange={onRefSubTabChange}
        refPanelCollapsed={refPanelCollapsed}
        onToggleRefPanelCollapsed={onToggleRefPanelCollapsed}
        alignment={alignment}
        versionAlignment={versionAlignmentBdb}
        sectionsWithChanges={bdbChangedIds}
        compactView={compactView}
        layoutMode={layoutMode}
        sectionKind="bdb"
        editedBodyFor={(id) => {
          const s = sections.find((x) => x.id === id);
          return editedBodyFor("bdb", id, s?.body ?? "");
        }}
        onEditBody={(id, nextBody, originalBody) =>
          onEditBody("bdb", id, nextBody, originalBody)
        }
        onSectionContextMenu={
          onSectionContextMenu
            ? (sectionId, coords) =>
                onSectionContextMenu("bdb", b.id, sectionId, coords)
            : undefined
        }
      />
    );
  }

  if (target.kind === "controlPlan") {
    const cp = findControlPlanById(data, target.id);
    if (!cp) {
      return (
        <div className="main-pane__scroll">
          <div className="main-pane__empty">{t("mainPane.cpNotFound")}</div>
        </div>
      );
    }
    const headers = data.cpHeadersByPlan[cp.id] ?? [];
    const rows = data.cpRowsByPlan[cp.id] ?? [];
    // CP-API — find the parent BDB and pick the matching
    // `common_controlplan_*_guid` based on the CP's type
    // (0 = design, 1 = production). Null when no BDB references
    // this CP, or when the parent BDB's matching guid is unset.
    // The button below stays disabled in that case (Tore's call —
    // discoverable but clearly inactive).
    const commonControlPlanGuid = findCommonControlPlanGuid(data, cp);
    return (
      <ControlPlanTableView
        plan={cp}
        headers={headers}
        rows={rows}
        editedTitle={editedCpTitleFor(cp.id, cp.title)}
        onEditTitle={(nextTitle) => onEditCpTitle(cp.id, nextTitle, cp.title)}
        editedCellFor={(rowId, field, original) =>
          editedCpRowCellFor(rowId, field, original)
        }
        onEditCell={(rowId, field, nextValue, originalValue) =>
          onEditCpRowCell(rowId, field, nextValue, originalValue)
        }
        onRequestAddRow={(headerId) => onRequestAddRow(cp.id, headerId)}
        onRequestAddHeader={() => onRequestAddHeader(cp.id)}
        onRequestDeleteRow={onRequestDeleteRow}
        editedHeaderFor={editedCpHeaderFor}
        onEditHeader={onEditCpHeader}
        commonControlPlanGuid={commonControlPlanGuid}
      />
    );
  }

  if (target.kind === "highlights") {
    // App.tsx pre-renders the view and threads it through. MainPane
    // just slots it; the rest of the rendering layer doesn't need
    // to know about the highlights data shape.
    return (
      highlightsView ?? (
        <div className="main-pane__empty">{t("mainPane.unknownTarget")}</div>
      )
    );
  }

  if (target.kind === "revisions") {
    // Same slot pattern as highlights — App.tsx pre-renders the view
    // (only when a reference is loaded) and threads it through.
    return (
      revisionsView ?? (
        <div className="main-pane__scroll">
          <div className="main-pane__empty">{t("revisions.tab.empty")}</div>
        </div>
      )
    );
  }

  // Exhaustive check — if we add a new TabTarget kind, TS forces us to handle it.
  const _never: never = target;
  void _never;
  return <div className="main-pane__empty">{t("mainPane.unknownTarget")}</div>;
}

function ProjectView({
  data,
  effectiveContractCodeFor,
  effectiveContractNameFor,
  isContractEditedFor,
  onRequestNewContract,
  onSeedDefaultContracts,
  onRequestEditContract,
  onRequestDeleteContract,
  effectiveProjectField,
  isProjectEdited = false,
  onRequestEditProject,
  selection,
  onSelect,
  onDuplicateBdb,
  onCreatePfbbChild,
  onNewControlPlan,
  onDeleteControlPlan,
  onMoveControlPlan,
  onMoveWorkSpecToContract,
  onDeleteWorkSpec,
  onDeleteBdb,
  onRequestEditWorkSpec,
  onRequestEditBdb,
  onManageAttachments,
  onShowGlobalAttachments,
  onRequestOpenAttachment,
  onRequestRenameAttachment,
  onRequestDeleteAttachment,
  onRequestMoveAttachment,
  onRequestEditCp,
  isContractPendingDelete,
  isWorkSpecPendingDelete,
  isVirtualWorkSpec,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
  onRestoreContract,
  onRestoreWorkSpec,
  onRestoreBdb,
  onRestoreControlPlan,
  effectiveWorkSpecContractFor,
  onFillFromStandard,
  fillFromStandardEligible,
  onOpenExport,
}: {
  data: FilePayload;
  onOpenExport: () => void;
  effectiveContractCodeFor: (
    contractId: number,
    originalCode: string | null,
  ) => string | null;
  effectiveContractNameFor: (
    contractId: number,
    originalName: string | null,
  ) => string | null;
  isContractEditedFor: (contractId: number) => boolean;
  onRequestNewContract: () => void;
  onSeedDefaultContracts: () => void;
  onRequestEditContract: (contractId: number) => void;
  onRequestDeleteContract: (contractId: number) => void;
  effectiveProjectField?: (
    field: "name" | "projectNumber" | "builder" | "molioReferencelistDate",
    originalValue: string | null,
  ) => string | null;
  isProjectEdited?: boolean;
  onRequestEditProject?: () => void;
  selection: TabTarget;
  onSelect?: (s: TabTarget) => void;
  onDuplicateBdb?: (bdbId: number) => void;
  onCreatePfbbChild?: (bdbId: number) => void;
  onNewControlPlan?: (bdbId: number) => void;
  onDeleteControlPlan?: (controlPlanId: number) => void;
  onMoveControlPlan?: (controlPlanId: number) => void;
  onMoveWorkSpecToContract?: (workSpecId: number) => void;
  onDeleteWorkSpec?: (workSpecId: number) => void;
  onDeleteBdb?: (bdbId: number) => void;
  /** Slice 10E — "Edit metadata…" passed through to embedded tree. */
  onRequestEditWorkSpec?: (workSpecId: number) => void;
  onRequestEditBdb?: (bdbId: number) => void;
  /** Slice 10K — "Attachments…" on work-area rows. Attachments FK to
   *  `work_spec(id)` per Molio 2.0, not to BDB. */
  onManageAttachments?: (workSpecId: number) => void;
  /** Slice 10K.5 — click handler for the project-wide Attachments counter. */
  onShowGlobalAttachments?: () => void;
  /** Slice 10K.8 — sidebar-driven attachment actions. */
  onRequestOpenAttachment?: (attachmentId: number) => void;
  onRequestRenameAttachment?: (attachmentId: number) => void;
  onRequestDeleteAttachment?: (attachmentId: number) => void;
  onRequestMoveAttachment?: (attachmentId: number) => void;
  /** Slice 10F — "Edit metadata…" on control-plan rows. */
  onRequestEditCp?: (controlPlanId: number) => void;
  isContractPendingDelete?: (contractId: number) => boolean;
  isWorkSpecPendingDelete?: (workSpecId: number) => boolean;
  /** Slice 10H.6d — lock actions on the virtual PFBB work_spec row. */
  isVirtualWorkSpec?: (workSpecId: number) => boolean;
  isBdbPendingDelete?: (bdbId: number) => boolean;
  /** FIX-DelCpStrike 2026-05-11 — strikethrough for CPs in the embedded
   *  project-overview sidebar (same predicate as the main rail). */
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
  onRestoreContract?: (contractId: number) => void;
  onRestoreWorkSpec?: (workSpecId: number) => void;
  onRestoreBdb?: (bdbId: number) => void;
  /** Restore a directly-pending CP delete patch. */
  onRestoreControlPlan?: (controlPlanId: number) => void;
  effectiveWorkSpecContractFor?: (
    workSpecId: number,
    originalContractId: number | null,
  ) => number | null;
  /** SPLIT-Merge (#248) — passed through to the embedded Sidebar. */
  onFillFromStandard?: (workSpecId: number) => void;
  fillFromStandardEligible?: ReadonlySet<number>;
}): JSX.Element {
  const t = useT();
  const p = data.project;
  // Phase 10 Slice 10A + 10C — Project Overview redesign.
  //
  // Layout: 2fr / 1fr grid.
  //   - Left column (2fr): an **embedded** copy of <Sidebar>. Same
  //     tree, same grouping (contracts → work areas → BDBs → CPs),
  //     same right-click menus. The `embedded` flag on Sidebar just
  //     strips the fixed width/border so it fills the grid cell.
  //     Clicking a leaf opens the corresponding tab via `onSelect`,
  //     which is the same handler as the main rail.
  //   - Right column (1fr): the existing action cards (metadata,
  //     counters, contracts, export). The counter block stays — a
  //     useful at-a-glance dashboard that will grow in later slices.
  //
  // Trade-off: we now have two <Sidebar> instances mounted at once
  // (the main rail + this embedded one). Each has its own filter
  // input state. For MVP this is fine; if filter state ever needs
  // to sync, lift it into App.tsx.
  return (
    <div className="project-overview">
      <div className="project-overview__tree">
        {onSelect ? (
          <Sidebar
            data={data}
            selection={selection}
            onSelect={onSelect}
            onDuplicateBdb={onDuplicateBdb}
            onCreatePfbbChild={onCreatePfbbChild}
            onNewControlPlan={onNewControlPlan}
            onDeleteControlPlan={onDeleteControlPlan}
            onMoveControlPlan={onMoveControlPlan}
            onMoveWorkSpecToContract={onMoveWorkSpecToContract}
            onDeleteWorkSpec={onDeleteWorkSpec}
            onDeleteBdb={onDeleteBdb}
            onRequestEditWorkSpec={onRequestEditWorkSpec}
            onRequestEditBdb={onRequestEditBdb}
            onFillFromStandard={onFillFromStandard}
            fillFromStandardEligible={fillFromStandardEligible}
            onManageAttachments={onManageAttachments}
            onRequestOpenAttachment={onRequestOpenAttachment}
            onRequestRenameAttachment={onRequestRenameAttachment}
            onRequestDeleteAttachment={onRequestDeleteAttachment}
            onRequestMoveAttachment={onRequestMoveAttachment}
            onRequestEditCp={onRequestEditCp}
            effectiveContractCodeFor={effectiveContractCodeFor}
            effectiveContractNameFor={effectiveContractNameFor}
            effectiveWorkSpecContractFor={effectiveWorkSpecContractFor}
            isContractPendingDelete={isContractPendingDelete}
            isWorkSpecPendingDelete={isWorkSpecPendingDelete}
            isVirtualWorkSpec={isVirtualWorkSpec}
            isBdbPendingDelete={isBdbPendingDelete}
            isControlPlanPendingDelete={isControlPlanPendingDelete}
            onRestoreContract={onRestoreContract}
            onRestoreWorkSpec={onRestoreWorkSpec}
            onRestoreBdb={onRestoreBdb}
            onRestoreControlPlan={onRestoreControlPlan}
            collapsed={false}
            embedded
          />
        ) : null}
      </div>
      <div className="project-overview__cards">
        <section
          className="main-pane__card project-overview__metadata-card"
          aria-label={t("projectOverview.metadata.ariaLabel")}
        >
          <div className="project-overview__metadata-card__header">
            <h2>
              {effectiveProjectField
                ? effectiveProjectField("name", p?.name ?? null) ||
                  t("projectOverview.metadata.unnamedProject")
                : (p?.name ?? t("projectOverview.metadata.unnamedProject"))}
              {isProjectEdited ? (
                <span className="meta__edited-marker">
                  {" "}
                  {t("projectOverview.metadata.editedMarker")}
                </span>
              ) : null}
            </h2>
            {onRequestEditProject ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={onRequestEditProject}
                aria-label={t("projectOverview.metadata.editAriaLabel")}
              >
                {t("projectOverview.metadata.editButton")}
              </button>
            ) : null}
          </div>
          <dl className="meta">
            <dt>{t("projectOverview.metadata.projectNumber")}</dt>
            <dd>
              {(effectiveProjectField
                ? effectiveProjectField(
                    "projectNumber",
                    p?.projectNumber ?? null,
                  )
                : p?.projectNumber) || <em>—</em>}
            </dd>
            <dt>{t("projectOverview.metadata.builder")}</dt>
            <dd>
              {(effectiveProjectField
                ? effectiveProjectField("builder", p?.builder ?? null)
                : p?.builder) || <em>—</em>}
            </dd>
            <dt>{t("projectOverview.metadata.createdBySystem")}</dt>
            <dd>{p?.createdBySystem || <em>—</em>}</dd>
            <dt>{t("projectOverview.metadata.created")}</dt>
            <dd>{p?.createdDate || <em>—</em>}</dd>
            <dt>{t("projectOverview.metadata.lastModified")}</dt>
            <dd>{p?.modifiedDate || <em>—</em>}</dd>
            <dt>{t("projectOverview.metadata.schemaVersion")}</dt>
            <dd>
              <code>{data.dbVersion}</code>
            </dd>
            <dt>{t("projectOverview.metadata.molioReferenceListDate")}</dt>
            <dd>
              {(effectiveProjectField
                ? effectiveProjectField(
                    "molioReferencelistDate",
                    p?.moliioReferencelistDate ?? null,
                  )
                : p?.moliioReferencelistDate) || <em>—</em>}
            </dd>
            {/* The file path gets the WHOLE card width, label on its
             *  own line above the value, rather than sharing the
             *  180px-label / rest-of-the-card split every other row
             *  uses. At the app's default 1100px window this card is
             *  only about 245px wide, so a normal row leaves roughly
             *  50px for the value — a path wrapped into that column
             *  ran to nine lines and dominated the card. Full width
             *  gives it ~45 characters per line, so a typical path
             *  lands in two or three. */}
            <dt className="meta__full-row">
              {t("projectOverview.metadata.filePath")}
            </dt>
            {/* `title` sits on the <dd>, not on the <code>. The whole
             *  row is then a hover target for the tooltip, including
             *  the space to the right of a short path. */}
            <dd className="meta__full-row" title={data.path}>
              {/* Deliberately NOT the shared `.path` class: that one
               *  is `word-break: break-all` and is still used by the
               *  import dialog, where the full path must stay
               *  readable. Changing `.path` would silently reformat
               *  that dialog too. */}
              <code className="path-split">
                {dirnameOf(data.path) && (
                  <span className="path-split__dir">
                    <bdi>{dirnameOf(data.path)}</bdi>
                  </span>
                )}
                <span className="path-split__name">{basename(data.path)}</span>
              </code>
            </dd>
          </dl>
        </section>
        <section
          className="main-pane__card project-overview__counters-card"
          aria-label={t("projectOverview.counters.ariaLabel")}
        >
          <div className="counts">
            <Counter
              label={t("projectOverview.counters.workAreas")}
              n={data.workSpecs.length}
            />
            <Counter
              label={t("projectOverview.counters.bdbs")}
              n={data.bdbs.length}
            />
            <Counter
              label={t("projectOverview.counters.controlPlans")}
              n={data.controlPlans.length}
            />
            <Counter
              label={t("projectOverview.counters.attachments")}
              n={data.attachments.length}
              onClick={onShowGlobalAttachments}
              title={t("projectOverview.counters.attachmentsTooltip")}
            />
          </div>
        </section>
        <ContractsCard
          contracts={data.contracts}
          workSpecs={data.workSpecs}
          effectiveContractCodeFor={effectiveContractCodeFor}
          effectiveContractNameFor={effectiveContractNameFor}
          isContractEditedFor={isContractEditedFor}
          onRequestNewContract={onRequestNewContract}
          onSeedDefaultContracts={onSeedDefaultContracts}
          onRequestEditContract={onRequestEditContract}
          onRequestDeleteContract={onRequestDeleteContract}
        />
        <ExportCard data={data} onOpenExport={onOpenExport} />
        {/* Glasshouse-only — renders null in Community (cover engine off). */}
        <CoverCard />
      </div>
    </div>
  );
}

/**
 * The folder part of a path, separator included: everything
 * `basename()` leaves behind. Empty string when the path is a bare
 * filename.
 */
function dirnameOf(path: string): string {
  return path.slice(0, path.length - basename(path).length);
}

function Counter({
  label,
  n,
  onClick,
  title,
}: {
  label: string;
  n: number;
  /** When provided, the counter renders as a button and triggers the handler. */
  onClick?: () => void;
  /** Optional tooltip — shown only when the counter is clickable. */
  title?: string;
}): JSX.Element {
  if (onClick) {
    return (
      <button
        type="button"
        className="counter counter--clickable"
        onClick={onClick}
        title={title}
      >
        <div className="counter__n">{n}</div>
        <div className="counter__label">{label}</div>
      </button>
    );
  }
  return (
    <div className="counter">
      <div className="counter__n">{n}</div>
      <div className="counter__label">{label}</div>
    </div>
  );
}

/**
 * Slice 6M — shown in place of the normal tab content when the tab's
 * target (work area, BDB, or control plan via its BDB) has been marked
 * for deletion. Plain card with a Restore button. The host supplies the
 * exact label + callback so we don't guess which level to restore.
 */
function PendingDeletePlaceholder({
  label,
  onRestore,
}: {
  label?: string;
  onRestore?: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <div className="main-pane__card pending-delete-card">
      <h2>{t("mainPane.pendingDelete.title")}</h2>
      <p>{t("mainPane.pendingDelete.body")}</p>
      {onRestore && (
        <button type="button" className="btn btn--primary" onClick={onRestore}>
          {label ?? t("mainPane.pendingDelete.restore")}
        </button>
      )}
    </div>
  );
}

/**
 * Project-level contracts list (Slice 6I).
 *
 * Shows every contract in the file with its effective (buffered) code +
 * name, a count of assigned work areas, and per-row Edit / Delete
 * buttons. A "+ New contract…" button sits at the top-right.
 *
 * Empty state: when there are no contracts at all, we just show the
 * "new" button — no table header.
 */
function ContractsCard({
  contracts,
  workSpecs,
  effectiveContractCodeFor,
  effectiveContractNameFor,
  isContractEditedFor,
  onRequestNewContract,
  onSeedDefaultContracts,
  onRequestEditContract,
  onRequestDeleteContract,
}: {
  contracts: ContractInfo[];
  workSpecs: FilePayload["workSpecs"];
  effectiveContractCodeFor: (
    contractId: number,
    originalCode: string | null,
  ) => string | null;
  effectiveContractNameFor: (
    contractId: number,
    originalName: string | null,
  ) => string | null;
  isContractEditedFor: (contractId: number) => boolean;
  onRequestNewContract: () => void;
  onSeedDefaultContracts: () => void;
  onRequestEditContract: (contractId: number) => void;
  onRequestDeleteContract: (contractId: number) => void;
}): JSX.Element {
  const t = useT();
  // Count of assigned work areas per contract. Uses the raw contractId
  // from the payload — buffered workSpecContract edits are not reflected
  // here on purpose: counts stay stable until the user saves.
  const countsById = new Map<number, number>();
  for (const w of workSpecs) {
    if (w.contractId == null) continue;
    countsById.set(w.contractId, (countsById.get(w.contractId) ?? 0) + 1);
  }

  // Which row has its "…" popout open. Only one at a time. Outside-
  // click and Esc both close it (see the effect inside <ContractRow/>).
  const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);

  // #250 — header split-button menu: "New contract" with a caret that
  // reveals "Create standard contracts". Same outside-click/Esc pattern
  // as the per-row kebab.
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const headerToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (headerMenuRef.current?.contains(target)) return;
      if (headerToggleRef.current?.contains(target)) return;
      setHeaderMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [headerMenuOpen]);

  return (
    <section className="contracts-card" aria-labelledby="contracts-card-title">
      <div className="contracts-card__header">
        <h3 id="contracts-card-title">
          {t("projectOverview.contracts.title")}
        </h3>
        <div className="contracts-card__actions">
          <button
            type="button"
            className="contracts-card__new"
            onClick={onRequestNewContract}
            title={t("projectOverview.contracts.newTooltip")}
          >
            {t("projectOverview.contracts.newButton")}
          </button>
          <button
            ref={headerToggleRef}
            type="button"
            className="contracts-card__menu-toggle"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            aria-label={t("projectOverview.contracts.moreActions")}
            title={t("projectOverview.contracts.moreActions")}
            onClick={() => setHeaderMenuOpen((o) => !o)}
          >
            <span aria-hidden="true">▾</span>
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="contracts-card__menu"
              role="menu"
              aria-label={t("projectOverview.contracts.moreActions")}
            >
              <button
                type="button"
                role="menuitem"
                className="contracts-card__menu-item"
                title={t("projectOverview.contracts.seedTooltip")}
                onClick={() => {
                  setHeaderMenuOpen(false);
                  onSeedDefaultContracts();
                }}
              >
                {t("projectOverview.contracts.seedButton")}
              </button>
            </div>
          )}
        </div>
      </div>
      {contracts.length === 0 ? (
        <p className="contracts-card__empty">
          {t("projectOverview.contracts.empty")}
        </p>
      ) : (
        <ul className="contracts-card__list">
          {contracts.map((c, idx) => {
            const code = effectiveContractCodeFor(c.id, c.contractCode);
            const name = effectiveContractNameFor(c.id, c.contractName);
            const label = sidebarContractLabel(code, name);
            const edited = isContractEditedFor(c.id);
            const count = countsById.get(c.id) ?? 0;
            const isFirst = idx === 0;
            return (
              <ContractRow
                key={c.id}
                contractId={c.id}
                label={label}
                edited={edited}
                count={count}
                showDivider={!isFirst}
                menuOpen={openMenuFor === c.id}
                onOpenMenu={() => setOpenMenuFor(c.id)}
                onCloseMenu={() => setOpenMenuFor(null)}
                onEdit={() => {
                  setOpenMenuFor(null);
                  onRequestEditContract(c.id);
                }}
                onDelete={() => {
                  setOpenMenuFor(null);
                  onRequestDeleteContract(c.id);
                }}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One contract row + its kebab ("…") popout.
 *
 * Pulled out so each row owns the refs it needs for the outside-click
 * / Esc handlers — keeping that logic in the parent would mean wiring
 * a map of refs. Cleaner to colocate.
 *
 * The `showDivider` prop decides whether we draw a horizontal rule
 * **above** the row. We use this instead of CSS `:not(:first-child)`
 * so the rule is part of the semantic tree (hr inside li) and adapts
 * if the list is ever rendered differently.
 */
function ContractRow({
  contractId,
  label,
  edited,
  count,
  showDivider,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onEdit,
  onDelete,
}: {
  contractId: number;
  label: string;
  edited: boolean;
  count: number;
  showDivider: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const t = useT();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Close the menu on outside-click or Escape. Mirrors the Sidebar
  // context-menu pattern so the interaction feels the same everywhere.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onCloseMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCloseMenu();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, onCloseMenu]);

  const menuId = `contracts-card-menu-${contractId}`;

  return (
    <li className="contracts-card__row">
      {showDivider && (
        <hr className="contracts-card__divider" aria-hidden="true" />
      )}
      <div className="contracts-card__row-body">
        <span className="contracts-card__label" title={label}>
          {label}
        </span>
        {edited && (
          <span
            className="contracts-card__dirty"
            title={t("projectOverview.contracts.row.dirtyTooltip")}
            aria-label={t("projectOverview.contracts.row.dirtyAriaLabel")}
          >
            ●
          </span>
        )}
        <span className="contracts-card__count">
          {count === 1
            ? t("projectOverview.contracts.row.workAreaCountOne", { count })
            : t("projectOverview.contracts.row.workAreaCountMany", { count })}
        </span>
        <div className="contracts-card__actions">
          <button
            ref={buttonRef}
            type="button"
            className="contracts-card__kebab"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={t("projectOverview.contracts.row.actionsAriaLabel")}
            title={t("projectOverview.contracts.row.actionsTooltip")}
            onClick={() => (menuOpen ? onCloseMenu() : onOpenMenu())}
          >
            {/* Vertical three-dot "kebab" — the icon-menu convention. */}
            <span aria-hidden="true" className="contracts-card__kebab-glyph">
              ⋮
            </span>
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              id={menuId}
              className="contracts-card__menu"
              role="menu"
              aria-label={t("projectOverview.contracts.row.actionsAriaLabel")}
            >
              <button
                type="button"
                role="menuitem"
                className="contracts-card__menu-item"
                onClick={onEdit}
              >
                {t("projectOverview.contracts.row.editMenu")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="contracts-card__menu-item contracts-card__menu-item--danger"
                onClick={onDelete}
                title={
                  count > 0
                    ? count === 1
                      ? t(
                          "projectOverview.contracts.row.deleteWithReassignOne",
                          { count },
                        )
                      : t(
                          "projectOverview.contracts.row.deleteWithReassignMany",
                          { count },
                        )
                    : t("projectOverview.contracts.row.deleteSimple")
                }
              >
                {t("projectOverview.contracts.row.deleteMenu")}
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ----------------------------------------------------------------------- */
/* Slice "Version compare" Phase E — match the active spec across the       */
/* current and reference payloads, and pre-bake the right column's          */
/* sections with diff marks ready for AlignedSpecView.                      */
/* ----------------------------------------------------------------------- */

/** Stable matching key for a work area — code first, name fallback. */
function waMatchKey(ws: WorkSpecInfo): string {
  const code = (ws.workAreaCode ?? "").trim();
  if (code) return `code:${code}`;
  const name = (ws.workAreaName ?? "").trim();
  return name ? `name:${name}` : `id:${ws.id}`;
}

function findMatchingWorkAreaAlignment(
  ws: WorkSpecInfo,
  currentSections: SectionData[],
  reference: FilePayload,
  addedFormat: import("./compare/versionCompareFormat.js").DiffFormat,
  deletedFormat: import("./compare/versionCompareFormat.js").DiffFormat,
  buildAlignment: VersionCompareEngine["buildVersionAlignmentSections"],
): { sideTitle: string; sections: SectionData[] } | null {
  const wantKey = waMatchKey(ws);
  const refWs = reference.workSpecs.find((r) => waMatchKey(r) === wantKey);
  if (!refWs) return null;
  const refSecs = reference.sectionsByWorkSpec[refWs.id] ?? [];
  const baked = buildAlignment(
    currentSections,
    refSecs,
    addedFormat,
    deletedFormat,
  );
  return {
    sideTitle: refWs.workAreaCode
      ? `${refWs.workAreaCode} — ${refWs.workAreaName}`
      : refWs.workAreaName,
    sections: baked,
  };
}

function findMatchingBdbAlignment(
  bdb: BdbInfo,
  parentWa: WorkSpecInfo | null,
  currentSections: SectionData[],
  reference: FilePayload,
  addedFormat: import("./compare/versionCompareFormat.js").DiffFormat,
  deletedFormat: import("./compare/versionCompareFormat.js").DiffFormat,
  buildAlignment: VersionCompareEngine["buildVersionAlignmentSections"],
): { sideTitle: string; sections: SectionData[] } | null {
  if (!parentWa) return null;
  const parentKey = waMatchKey(parentWa);
  const refParentWa = reference.workSpecs.find(
    (r) => waMatchKey(r) === parentKey,
  );
  if (!refParentWa) return null;
  // Match BDB by name within the matched parent work area.
  const want = (bdb.name ?? "").trim();
  const refBdb = reference.bdbs.find(
    (b) => b.workSpecId === refParentWa.id && (b.name ?? "").trim() === want,
  );
  if (!refBdb) return null;
  const refSecs = reference.sectionsByBdb[refBdb.id] ?? [];
  const baked = buildAlignment(
    currentSections,
    refSecs,
    addedFormat,
    deletedFormat,
  );
  return {
    sideTitle: refBdb.name,
    sections: baked,
  };
}

/**
 * CP-API helper — find the Molio reference CP guid that matches a
 * given control plan, by walking the BDBs in the loaded payload.
 *
 * Steps:
 *   1. Find a BDB whose `controlPlanIds` includes `cp.id`.
 *   2. Pick the matching `common_controlplan_*_guid` from that
 *      BDB's locked metadata, based on the CP's type
 *      (`controlPlanType`: 0 = design, 1 = production).
 *
 * Returns `null` when:
 *   - no BDB owns this CP (shouldn't normally happen — every CP
 *     should be reachable from a BDB), or
 *   - the parent BDB has the matching slot guid unset (common
 *     case for CPs created from scratch instead of seeded from
 *     a Molio template).
 *
 * The caller passes the result through to ControlPlanTableView,
 * which disables the "Default Control plan" button when null.
 */
function findCommonControlPlanGuid(
  data: FilePayload,
  cp: { id: number; controlPlanType: number },
): string | null {
  const owner = data.bdbs.find((b) => b.controlPlanIds.includes(cp.id));
  if (!owner) return null;
  const guid =
    cp.controlPlanType === 0
      ? owner.locked.commonControlplanDesignGuid
      : owner.locked.commonControlplanProductionGuid;
  if (!guid || guid === "00000000-0000-0000-0000-000000000000") {
    return null;
  }
  return guid;
}
