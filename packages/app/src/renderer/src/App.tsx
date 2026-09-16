/**
 * App shell: top bar → tab bar → split layout (Sidebar | MainPane).
 *
 * State model (Phase 6 Slice B):
 *   - LoadState      file-level state (idle / loading / loaded / error)
 *   - TabState       which spec/BDB/control plan is active in the tab view.
 *                    Project tab is always present.
 *   - tabUiStates    per-tab UI state: TOC filter + collapsed, plus the
 *                    active Reference-panel sub-tab.
 *   - edits          section-body patch map, keyed by (kind, sectionId).
 *                    Dirty state is derived from this map, so tabs are
 *                    pure views onto the document — closing a tab never
 *                    discards pending edits.
 *
 * The Sidebar always shows the project tree. Clicking a node in the
 * sidebar opens it in a new tab (or focuses the existing one).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText as FileTextIcon,
  GitCompareArrows as GitCompareIcon,
  GitMerge as RevisionsIcon,
  Highlighter as HighlighterIcon,
  Printer as PrinterIcon,
  RefreshCw as ReplaceIcon,
  Settings as SettingsIcon,
  SlidersHorizontal as ExportOptionsIcon,
  Trash2 as TrashIcon,
  X as XIcon,
} from "lucide-react";

import type {
  AttachmentInfo,
  BdbInfo,
  ContractInfo,
  ControlPlanInfo,
  ControlPlanRowData,
  CpRowEditableField,
  CreateCpResult,
  OpenAttachmentResult,
  DuplicateCpResult,
  DeleteBdbResult,
  DeleteContractResult,
  DeleteCpResult,
  DeleteCpRowResult,
  DeleteImpact,
  DeleteWorkAreaResult,
  DuplicateBdbResult,
  CreatePfbbChildResult,
  FilePayload,
  MigrateOrphanPfbbMastersResult,
  GetDeleteImpactResult,
  SchemaUpgradeInfo,
  SectionData,
  WorkSpecInfo,
  AppInfo,
} from "../../shared/ipc.js";
import { nextDuplicateName } from "./bdbDuplicateName.js";
import { availableSlots, hasFreeSlot, rowHasContent } from "./cpSlots.js";
import { nextHeaderNo } from "./controlPlanView.js";
import {
  EMPTY_EDITS,
  cpTitleKey,
  editKey,
  getEffectiveBdbSupplementBody,
  getEffectiveBody,
  getEffectiveContractCode,
  getEffectiveContractName,
  getEffectiveCpField,
  getEffectiveCpHeaderField,
  getEffectiveCpRowCell,
  getEffectiveCpTitle,
  getEffectiveProjectField,
  getEffectiveWorkSpecContract,
  getEffectiveWorkSpecField,
  hasEdits,
  bdbDeleteIncludesCps,
  isAnyCpRowCellEdited,
  isBdbMetadataEdited,
  isBdbSupplementEdited,
  isContractEdited,
  isCpMetadataEdited,
  isCpTitleEdited,
  isPendingDelete,
  isProjectEdited,
  isSectionEdited,
  isWorkSpecContractEdited,
  isWorkSpecMetadataEdited,
  markDelete,
  restoreDelete,
  setBdbSectionSupplement,
  setCustomData,
  deleteCustomDataEdit,
  clearCustomDataEdit,
  getEffectiveCustomData,
  stageBdbSectionDelete,
  setCpField,
  setCpHeaderField,
  setCpRowCell,
  setCpTitle,
  setProjectField,
  setSectionBody,
  setWorkSpecContract,
  setWorkSpecField,
  type DeleteEntityKind,
  type EditMap,
  type SectionKind,
} from "./edits.js";
import { basename, isMoliospecFile } from "./fileUtils.js";
import { ImportModal, type ImportDialogView } from "./ImportModal.js";
import { FillFromStandardModal } from "./modals/FillFromStandardModal.js";
import { ImportSourceModal } from "./modals/ImportSourceModal.js";
import { WindowTitleBar } from "./WindowTitleBar.js";
// Community edition: Molio license-status UI removed.
import {
  canCheck as canCheckImport,
  canImport as canImportGate,
  indexCollisions,
} from "./importPlan.js";
import { readCompactView, writeCompactView } from "./compactViewPrefs.js";
import { readReaderMode, writeReaderMode } from "./readerMode/readerMode.js";
// Community edition: Glasshouse sign-in provider removed.
import { ReaderModeProvider } from "./readerMode/ReaderModeContext.js";
import { ReaderModeConfirmDialog } from "./readerMode/ReaderModeConfirmDialog.js";
import { ReaderModeBanner } from "./readerMode/ReaderModeBanner.js";
import {
  readLayoutMode,
  writeLayoutMode,
  type LayoutMode,
} from "./layoutModePrefs.js";
import { MainPane } from "./MainPane.js";
import type { PfbbChildSupplementSnapshot } from "./pfbbChildContext.js";
import type { MergedChildView } from "./pfbbMergedView.js";
import {
  computePfbbToggleHint,
  countLivePfbbChildren,
  findOrphanPfbbMasters,
  isVirtualWorkSpecInfo,
} from "./pfbbMigration.js";
import {
  isPfbbMigrationDismissed,
  setPfbbMigrationDismissed,
} from "./pfbbMigrationPrefs.js";
import { PfbbMigrationBanner } from "./PfbbMigrationBanner.js";
import {
  readRefPanelCollapsed,
  writeRefPanelCollapsed,
} from "./refPanelPrefs.js";
import { sanitizeLoadedFile } from "./sanitizeLoadedFile.js";
// Community edition: Compare versions (reference/compare) is Glasshouse-only.
import { Sidebar } from "./Sidebar.js";
import {
  effectiveSidebarCollapsed,
  handleActiveTabChange,
  handleSidebarToggle,
  initialSidebarPrefState,
  type SidebarPrefState,
} from "./projectTabSidebar.js";
// Renderer-prefs storage (PREFS, 2026-04-27) — replaces direct
// `window.localStorage` access with a store backed by a JSON file
// in `app.getPath('userData')`, surviving Electron's dev-mode
// localStorage wipes.
import { prefStore } from "./prefs.js";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarPrefs.js";
import { compareCodeThenName, danishCollator } from "./sortHelpers.js";
import { CustomDataAccordion } from "./CustomDataAccordion.js";
import { applySectionHierarchyEdits } from "./applySectionHierarchyEdits.js";
import { mergeSavedEdits } from "./mergeSavedEdits.js";
import { classifyCpOpError, type CpOpDialogError } from "./cpOpError.js";
import {
  findBdbById,
  findControlPlanById,
  findWorkSpecById,
} from "./loaded.js";
import {
  SectionMenuController,
  type SectionMenuRef,
} from "./SectionMenuController.js";
import { useAttachmentsDialog } from "./state/useAttachmentsDialog.js";
import { useCreatePfbbChildDialog } from "./state/useCreatePfbbChildDialog.js";
import { useDeleteAttachmentDialog } from "./state/useDeleteAttachmentDialog.js";
import { useDeleteBdbDialog } from "./state/useDeleteBdbDialog.js";
import { useDeleteContractDialog } from "./state/useDeleteContractDialog.js";
import { useDeleteCpDialog } from "./state/useDeleteCpDialog.js";
import { useDeleteRowDialog } from "./state/useDeleteRowDialog.js";
import { useDeleteWorkSpecDialog } from "./state/useDeleteWorkSpecDialog.js";
import { useDragDrop } from "./state/useDragDrop.js";
import { useDuplicateBdbDialog } from "./state/useDuplicateBdbDialog.js";
import { useEditBdbDialog } from "./state/useEditBdbDialog.js";
import { useEditContractDialog } from "./state/useEditContractDialog.js";
import { useEditCpDialog } from "./state/useEditCpDialog.js";
import { useEditProjectDialog } from "./state/useEditProjectDialog.js";
import { useEditWorkSpecDialog } from "./state/useEditWorkSpecDialog.js";
import { type LoadState, useFileState } from "./state/useFileState.js";
import { useFileWatch } from "./state/useFileWatch.js";
import { useGlobalAttachmentsDialog } from "./state/useGlobalAttachmentsDialog.js";
import { useImportDialog } from "./state/useImportDialog.js";
import { useMoveAttachmentDialog } from "./state/useMoveAttachmentDialog.js";
import { useMoveCpDialog } from "./state/useMoveCpDialog.js";
import { useMoveWorkSpecDialog } from "./state/useMoveWorkSpecDialog.js";
import { useNewContractDialog } from "./state/useNewContractDialog.js";
import { useNewCpDialog } from "./state/useNewCpDialog.js";
import { useReloadFromDisk } from "./state/useReloadFromDisk.js";
import { useReloadMerge } from "./state/useReloadMerge.js";
import { usePfbbOrphanMigration } from "./state/usePfbbOrphanMigration.js";
import { useRenameAttachmentDialog } from "./state/useRenameAttachmentDialog.js";
import { useShortcutHandler } from "./state/useShortcutHandler.js";
import { useTabScrollPersistence } from "./state/useTabScrollPersistence.js";
import { useTabSwitchShortcuts } from "./state/useTabSwitchShortcuts.js";
import { useTabs } from "./state/useTabs.js";
import {
  DeleteCpModal,
  DeleteRowModal,
  EditCpModal,
  NewCpModal,
} from "./modals/cpModals.js";
import {
  contractLabel,
  DeleteContractModal,
  EditContractModal,
  NewContractModal,
} from "./modals/contractModals.js";
import {
  EditBdbModal,
  EditProjectModal,
  EditWorkSpecModal,
} from "./modals/metadataModals.js";
import {
  AttachmentsModal,
  ConfirmDeleteAttachmentModal,
  GlobalAttachmentsModal,
  MoveAttachmentModal,
  RenameAttachmentModal,
} from "./modals/attachmentModals.js";
import {
  DeleteTargetModal,
  MoveControlPlanModal,
  MoveWorkSpecModal,
} from "./modals/structuralModals.js";
import type { Revision, SectionRevision } from "./compare/compareTypes.js";
import { computeSectionPaths } from "./compare/sectionPath.js";
import { useVersionCompareFormat } from "./compare/versionCompareFormat.js";
import {
  findHighlights,
  type Highlight,
  type HighlightLocation,
} from "./highlights/findHighlights.js";
import { HighlightsView } from "./HighlightsView.js";
// Community edition: RevisionsView (Compare versions) removed.
import { ConflictModal } from "./modals/ConflictModal.js";
import { ExportOptionsModal } from "./modals/ExportOptionsModal.js";
import { ReloadConfirmModal } from "./modals/ReloadConfirmModal.js";
import { SchemaUpgradeModal } from "./modals/SchemaUpgradeModal.js";
import { ReloadMergeModal } from "./modals/ReloadMergeModal.js";
import { SettingsDialog } from "./modals/SettingsDialog.js";
import { ShortcutsCheatSheet } from "./modals/ShortcutsCheatSheet.js";
import { AboutDialog } from "./modals/AboutDialog.js";
import { useAppUpdater } from "./state/useAppUpdater.js";
import { useT } from "./i18n/i18n.js";
import { useDocxExport } from "./useDocxExport.js";
import { useExportController } from "./useExportController.js";
// Community edition: MCP export bridge removed.
import { WelcomeScreen } from "./WelcomeScreen.js";
import { TabBar } from "./TabBar.js";
import {
  activeTab,
  closeTab,
  openOrFocusTab,
  pruneTabsForFile,
  type TabState,
  type TabTarget,
} from "./tabs.js";
import { friendlyErrorForDialog } from "./i18n/friendlyError.js";

/**
 * Build the set of tab IDs that currently have unsaved edits.
 *
 *   - Spec / BDB / Work area tab: any section with a body patch OR a
 *     `wsContract:<id>` patch (reassignment to a different contract)
 *     flags the tab. Also flagged when the tab's target is itself
 *     pending-deleted (direct or via cascade), since Save will delete
 *     it from disk.
 *   - Control-plan tab: a `cpTitle:<id>` patch OR any `cpRow:<rowId>:*`
 *     patch where the row belongs to that plan.
 *   - Project tab: dirty when any `contract:<id>` patch is pending
 *     (contract rename) OR any buffered delete (`del:*`) is pending
 *     (Slice 6M). Work-area reassignments do NOT mark the project tab
 *     dirty — they live on the work-area tab.
 */
/**
 * Slice 10G — collect every descendant section id under `rootId`
 * given a flat section list with `parentId` pointers. Used by the
 * delete-confirm dialog to show "N descendants will be removed".
 */
function collectDescendantIds(
  sections: readonly import("../../shared/ipc.js").SectionData[],
  rootId: number,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const s of sections) {
    const p = s.parentId ?? -1;
    const list = childrenByParent.get(p);
    if (list) list.push(s.id);
    else childrenByParent.set(p, [s.id]);
  }
  const out: number[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    const kids = childrenByParent.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

function buildDirtyTabIds(
  tabs: TabState,
  data: FilePayload,
  edits: EditMap,
): ReadonlySet<string> {
  if (!hasEdits(edits)) return EMPTY_SET;

  // Cheap scan: does any key in the map start with the given prefix?
  const hasAnyWithPrefix = (prefix: string): boolean => {
    for (const k in edits) if (k.startsWith(prefix)) return true;
    return false;
  };
  const anyContractRename = hasAnyWithPrefix("contract:");
  const anyDelete = hasAnyWithPrefix("del:");

  // Small helpers for cascade pending-delete checks. Mirror the logic in
  // the sidebar props: a workSpec is effectively pending if its own patch
  // is set OR its contract is; a BDB is effectively pending if its own
  // patch is set OR its workSpec is effectively pending OR its contract is.
  const isContractPending = (cid: number): boolean =>
    `del:contract:${cid}` in edits;
  const isWorkSpecPending = (wsId: number): boolean => {
    if (`del:workSpec:${wsId}` in edits) return true;
    const ws = findWorkSpecById(data, wsId);
    if (!ws) return false;
    const cid = getEffectiveWorkSpecContract(edits, wsId, ws.contractId);
    return cid !== null && isContractPending(cid);
  };
  const isBdbPending = (bdbId: number): boolean => {
    if (`del:bdb:${bdbId}` in edits) return true;
    const b = findBdbById(data, bdbId);
    if (!b || b.workSpecId == null) return false;
    return isWorkSpecPending(b.workSpecId);
  };

  const out = new Set<string>();
  for (const tab of tabs.tabs) {
    const target = tab.target;
    if (target.kind === "project") {
      if (anyContractRename || anyDelete) out.add(tab.id);
    } else if (target.kind === "workSpec") {
      if (isWorkSpecPending(target.id)) {
        out.add(tab.id);
        continue;
      }
      const sections = data.sectionsByWorkSpec[target.id] ?? [];
      if (sections.some((s) => editKey("workSpec", s.id) in edits)) {
        out.add(tab.id);
        continue;
      }
      if (isWorkSpecContractEdited(edits, target.id)) {
        out.add(tab.id);
      }
    } else if (target.kind === "bdb") {
      if (isBdbPending(target.id)) {
        out.add(tab.id);
        continue;
      }
      const sections = data.sectionsByBdb[target.id] ?? [];
      if (sections.some((s) => editKey("bdb", s.id) in edits)) {
        out.add(tab.id);
      }
    } else if (target.kind === "controlPlan") {
      if (cpTitleKey(target.id) in edits) {
        out.add(tab.id);
        continue;
      }
      const rows = data.cpRowsByPlan[target.id] ?? [];
      if (rows.some((r) => isAnyCpRowCellEdited(edits, r.id))) {
        out.add(tab.id);
      }
    }
  }
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function App(): JSX.Element {
  // App-level settings dialog (gear icon top-right). Currently houses
  // the UI language picker; will grow as we add more settings rows.
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Slice #41 — keyboard shortcuts cheat sheet. Opened via the Help
  // menu (⌘? / Ctrl+/) and via the question-mark key on the document.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // About panel. Opened from the app menu on macOS and from Help on
  // Windows/Linux. `appInfo` is fetched once when the panel is first
  // opened rather than on every mount - it cannot change while the app
  // runs, and nobody should pay for it who never opens About.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  // The updater hook lives here, not in the panel: main broadcasts
  // state whether or not anyone is looking, and a subscription that
  // only exists while a modal is open would miss the transitions the
  // panel is meant to report.
  const appUpdater = useAppUpdater();
  // Slice "Highlights & formatting" — Highlights view promoted to a
  // dedicated tab so it survives navigation; Export options stays a
  // modal because it's a settings panel, not browseable content.
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  /**
   * Transient "scroll to this run after the destination tab mounts"
   * directive. Set when a row in HighlightsView is clicked, consumed
   * (and cleared) by the SectionEditor inside the destination tab.
   */
  const [pendingScroll, setPendingScroll] = useState<{
    tabId: string;
    sectionId: number;
    markKind: string;
    ordinal: number;
  } | null>(null);
  // Community edition: no reference/compare feature, so no clear-reference ref.

  // Default "Reference panel collapsed" for freshly opened tabs. Reads
  // the persisted preference once on mount; we deliberately don't
  // subscribe to it afterwards because each tab has its own in-memory
  // override — the preference only decides what a brand-new tab starts
  // as.
  //
  // Declared early because useTabs (below) reads from this ref during
  // its initial render to seed a fresh TabUiState. Moving it later
  // would crash the first render with a TDZ error.
  const refPanelCollapsedDefaultRef = useRef<boolean>(
    readRefPanelCollapsed(prefStore()),
  );

  // Tabs cluster (slice #233 Session 2 round 8). The hook reads the
  // Ref-panel default through the getter on first render to seed a
  // fresh TabUiState — see the ref declaration just above.
  const tabsController = useTabs({
    getRefPanelDefault: () => refPanelCollapsedDefaultRef.current,
  });
  const { tabs, setTabs, tabUiStates } = tabsController;

  // Task 1 / M1 — set when the file we just opened had to be upgraded
  // from a pre-01.00.03 schema. Shown as a dialog the user has to click
  // away, because the upgrade changes their document and cannot be
  // undone. Cleared on dismiss and on every subsequent open.
  const [schemaUpgradeNotice, setSchemaUpgradeNotice] =
    useState<SchemaUpgradeInfo | null>(null);

  // File state cluster lives in ./state/useFileState.ts. Owns
  // state / edits / baselineMtimeMs / saveError / isSaving /
  // recentFiles / pendingConflict, plus the open / save /
  // dirty-tracking machinery. The `onFileLoaded` cb wires the
  // cross-cutting reset concerns (tabs + drop-error) to the
  // file-load event.
  const fileStateController = useFileState({
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    onFileLoaded: (data) => {
      // Only fires on a genuine open, not on a reload or a post-save
      // refresh — which is exactly when this notice belongs.
      setSchemaUpgradeNotice(data.schemaUpgrade);
      tabsController.reset();
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      dismissDropError();
    },
  });
  const {
    state,
    setState,
    edits,
    setEdits,
    baselineMtimeMs,
    setBaselineMtimeMs,
    pendingConflict,
    setPendingConflict,
    saveError,
    setSaveError,
    isSaving,
    recentFiles,
    removeRecent,
    clearRecent,
    dirty,
    openPath,
    handleOpen,
    save,
    saveAs,
    reloadFromDisk,
    applyMerge,
  } = fileStateController;

  // Community edition: Compare versions is Glasshouse-only, so there is never a
  // loaded reference. Keep a null so the (gated) export + main-pane paths stay
  // inactive.
  const referenceFile: FilePayload | null = null;

  // RELOAD-2 — keep the main-process file watcher pointed at the open
  // file and surface a banner when something else writes to it under
  // us (a second window, the MCP server, a Dropbox sync).
  const { changedOnDisk, dismiss: dismissDiskChange } = useFileWatch(
    state.kind === "loaded" ? state.data.path : null,
    baselineMtimeMs,
  );

  // RELOAD-3 — shared "reload from disk" action, used by both the
  // File → Reload from Disk menu item and the RELOAD-2 banner.
  // Reloads immediately when the editor is clean; opens a styled
  // discard-confirm dialog when there are unsaved edits.
  const {
    confirmOpen: reloadConfirmOpen,
    requestReload,
    confirmReload,
    cancelReload,
  } = useReloadFromDisk({
    canReload: state.kind === "loaded",
    dirty,
    reload: reloadFromDisk,
    onBeforeReload: dismissDiskChange,
  });

  // RELOAD-Merge — the 3-way merge flow. `startMerge` re-reads the
  // disk file and opens the merge dialog (or reports it can't run);
  // applying a merge leaves the result as unsaved edits to review.
  const reloadMerge = useReloadMerge({
    state,
    edits,
    applyMerge,
    onUnavailable: setSaveError,
  });

  // "Merge…" from the save-conflict dialog: on success the conflict
  // dialog closes (the merge dialog has taken over); on failure it
  // stays so the user can still pick Reload / Overwrite.
  const handleMergeFromConflict = useCallback((): void => {
    void (async () => {
      if (await reloadMerge.startMerge()) setPendingConflict(null);
    })();
  }, [reloadMerge, setPendingConflict]);

  // "Merge…" from the discard-confirm dialog (reload path).
  const handleMergeFromReload = useCallback((): void => {
    void (async () => {
      if (await reloadMerge.startMerge()) cancelReload();
    })();
  }, [reloadMerge, cancelReload]);

  // FIX-Tab 2026-05-11 — after a reload (typically post-save with
  // container deletes), drop any tabs whose target spec no longer
  // exists. Otherwise a tab opened on a now-deleted work area /
  // BDB / CP stays open and renders an error ("no BDB"). Uses
  // `pruneTabsForFile` so the rule is one source of truth and
  // testable without React.
  useEffect(() => {
    if (state.kind !== "loaded") return;
    const valid = {
      workSpecs: new Set(state.data.workSpecs.map((w) => w.id)),
      bdbs: new Set(state.data.bdbs.map((b) => b.id)),
      controlPlans: new Set(state.data.controlPlans.map((c) => c.id)),
    };
    setTabs((prev) => pruneTabsForFile(prev, valid));
  }, [state, setTabs]);

  // Slice 10H.10-UX — shared Export-PDFs modal controller. Two
  // triggers open it: the Project-tab "Export PDF" card button and
  // the printer icon in the top nav bar.
  // Slice "Version compare PDF" — also feed the loaded reference and
  // the user's diff-format choices to the controller so the export
  // modal can offer the "Mark version changes" + "Include summary
  // report" checkboxes when a reference is present.
  const [versionCompareFmt] = useVersionCompareFormat();

  // DOCX-4 — Word export controller. Independent of PDF flow; the
  // BatchExportModal calls onExportDocx when the user clicks the
  // Word button. Phase A: one OS save dialog per checked BDB.
  const docxExport = useDocxExport(state.kind === "loaded" ? state.data : null);

  const exportController = useExportController(
    state.kind === "loaded" ? state.data : null,
    referenceFile,
    versionCompareFmt,
    (refs, opts) => {
      // Build the Word docs + show the OS dialog, then close the
      // export modal on completion (success, cancel, or error).
      // `opts.compact` mirrors the modal's "Compact (hide empty
      // sections)" checkbox; `opts.includeToc` mirrors the "Table of
      // contents" checkbox (picks the with-/no-TOC Word template) so
      // Word respects the same toggles PDFs already do. `refs` mixes
      // BDB + work-area specs in a single call (DOCX-WA).
      void docxExport
        .exportSpecs(refs, {
          compact: opts.compact,
          includeToc: opts.includeToc,
        })
        .finally(() => {
          exportController.close();
        });
    },
  );

  // Community edition: no MCP server, so no MCP export bridge.

  // Phase 10 Slice 10A — sidebar collapse is now a two-part state:
  //   1. `userPreference` (persisted) — what we honour on spec / BDB /
  //      CP tabs. Mirrors what we used to persist before 10A.
  //   2. `projectTabOverride` (session-only) — an opt-in "I actually
  //      want to see the sidebar while looking at the Project tab"
  //      gesture. Cleared automatically when the user navigates away.
  // See `projectTabSidebar.ts` for the full state machine + unit tests.
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPrefState>(() =>
    initialSidebarPrefState(readSidebarCollapsed(prefStore())),
  );
  useEffect(() => {
    // Only the persisted user preference goes to storage — the
    // session override is intentionally not saved.
    writeSidebarCollapsed(prefStore(), sidebarPrefs.userPreference);
  }, [sidebarPrefs.userPreference]);

  // refPanelCollapsedDefaultRef is now declared at the top of the
  // component (above useTabs) — moved 2026-04-25 because useTabs reads
  // it during initial render via getRefPanelDefault, and JS's TDZ
  // crashes if the ref is declared later.

  // Compact view: global preference. When ON, every section whose body
  // renders to whitespace (plus parents whose whole subtree is empty) is
  // hidden from the spec pane, aligned view, and TOC. Persisted in
  // localStorage, mirrors sidebarPrefs.userPreference.
  const [compactView, setCompactView] = useState<boolean>(() =>
    readCompactView(prefStore()),
  );
  useEffect(() => {
    writeCompactView(prefStore(), compactView);
  }, [compactView]);

  // Phase 8 round 2 — Reader mode (Læsetilstand). When ON, every
  // edit-trigger button + handler is locked. The provider wraps
  // the app body below; per-component checks read this via
  // `useReaderMode()`. Persisted in PREFS.
  const [readerMode, setReaderMode] = useState<boolean>(() =>
    readReaderMode(prefStore()),
  );
  useEffect(() => {
    writeReaderMode(prefStore(), readerMode);
  }, [readerMode]);
  // Confirm-dialog state for the "you have unsaved edits" branch
  // when the user flips reader mode ON.
  const [readerModeConfirmOpen, setReaderModeConfirmOpen] = useState(false);

  // Layout mode: "web" (default fluid view) vs. "print" (A4 content-width
  // with a white "page" backdrop — gives a document-like writing feel).
  // Only affects the section editor; control plans keep their own layout.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    readLayoutMode(prefStore()),
  );
  useEffect(() => {
    writeLayoutMode(prefStore(), layoutMode);
  }, [layoutMode]);

  // ---- Drag-and-drop state ----
  // Lives in ./state/useDragDrop.ts. The hook owns the visual
  // highlight, the pending-drop confirm modal, and the inline
  // drop-error banner. We forward `openPath` so the hook can
  // directly load the file when a drop happens on an empty
  // window, and `isLoaded` so it knows when to show the confirm.
  const dragDrop = useDragDrop({
    isLoaded: state.kind === "loaded",
    // forward-declare via closure: openPath is defined a few lines
    // below, so we wrap it in an arrow to defer the lookup.
    openPath: (p) => openPath(p),
  });
  const {
    isDraggingOver,
    pendingDrop,
    dropError,
    dragHandlers,
    confirmPendingDrop,
    cancelPendingDrop,
    dismissDropError,
  } = dragDrop;

  /**
   * Duplicate-BDB rename dialog state. Populated when the user picks
   * "Duplicate BDB…" in the sidebar context menu; cleared on
   * Cancel/success. The `name` field is the live text in the input so
   * the user can edit the default before confirming.
   *
   * Errors shown inside the modal:
   *   - "dirty": there are unsaved edits. We refuse the duplicate
   *     because the op writes to disk directly and a reload would drop
   *     pending edits. The user's option is to Cancel → Save → retry.
   *   - "conflict": the on-disk mtime changed between load and now.
   *     Rare; same Cancel-and-reload story as the conflict modal.
   *   - "missing": source BDB was deleted from disk by something else.
   *   - "other": any other IPC failure — message is surfaced.
   */

  /**
   * Slice 10H.5 — "Create PFBB child" dialog. Opened from the sidebar
   * right-click on a BDB that has `isPfbb === true` (a Projektfælles
   * master). The child gets:
   *   - a new `construction_element_spec` row in the chosen work-spec,
   *   - `pfbb_id` pointing at the master (inheritance link),
   *   - an empty body the user can later supplement.
   *
   * State shape mirrors duplicateBdbDialog: same dirty/conflict/missing
   * error kinds, same `saving` flag to block double-submit.
   *
   * `targetWorkSpecId === null` means the user hasn't picked a work-area
   * yet — the Create button stays disabled. The contract dropdown is
   * derived from the work-spec, so we don't store it separately.
   */

  /**
   * "New control plan…" dialog. Opened from the sidebar right-click on a
   * BDB. The slot picker disables slots that are already filled; if both
   * slots are taken the menu item itself was hidden. Title defaults to
   * blank — the user picks.
   *
   * Dirty-state guard mirrors duplicate-BDB: we refuse to create a CP
   * while there are unsaved edits, because the op writes to disk and
   * reloads the file, which would discard those edits.
   */

  /**
   * "Move control plan to specification" picker (Slice 6O.4 — #112).
   *
   * Immediate-persistence: on confirm we call `moveControlPlan` over IPC,
   * which saves the file and reloads the payload. That's why we share the
   * same dirty-state guard as the other reload-on-success ops. `targetBdbId`
   * is pre-selected to the CP's *current* BDB (or null if homeless) so the
   * user starts from a known state; the confirm button is disabled while
   * the selection equals the original.
   *
   * `slotOccupiedMessage` carries the `kind:"slot-occupied"` reply from
   * core — rendered inline as a blocker error instead of a throw (Tore's
   * UX call per the 6O design thread).
   */

  const deleteWorkSpecController = useDeleteWorkSpecDialog({ state, setEdits });
  const deleteWorkSpecDialog = deleteWorkSpecController.dialog;
  const handleRequestDeleteWorkSpec = deleteWorkSpecController.open;
  const cancelDeleteWorkSpec = deleteWorkSpecController.cancel;
  const confirmDeleteWorkSpec = deleteWorkSpecController.confirm;

  const deleteBdbController = useDeleteBdbDialog({ state, edits, setEdits });
  const deleteBdbDialog = deleteBdbController.dialog;
  const handleRequestDeleteBdb = deleteBdbController.open;
  const cancelDeleteBdb = deleteBdbController.cancel;
  const confirmDeleteBdb = deleteBdbController.confirm;

  /**
   * Transient banner for CP lifecycle failures that happen outside a
   * dialog — specifically the "+ Add row" button, which fires IPC
   * directly without its own modal. Mirrors `saveError` behaviour:
   * auto-dismisses after a few seconds.
   */
  const [cpOpError, setCpOpError] = useState<string | null>(null);

  // ---- Contract dialogs (Slice 6I — #65) ---------------------------------
  //
  // Four separate dialogs cover contract lifecycle + assignment:
  //   • newContractDialog        "+ New contract…" on the Project card.
  //                              Immediate-persistence: open → create → saveAs
  //                              → close → reload. Same dirty-guard as NewCp.
  //   • editContractDialog       Per-row "Edit…" on a contract — buffered edit.
  //                              Writes to `edits` via setContractCode /
  //                              setContractName; user saves with ⌘S.
  //   • deleteContractDialog     Per-row Delete button. Starts as a plain
  //                              confirm; if the IPC returns `referenced` we
  //                              switch it into "reassign" mode with a target
  //                              picker. On OK we save the reassignment edits
  //                              AND retry the delete in one IPC chain.
  //   • moveWorkSpecDialog       Right-click on a work area → "Move to
  //                              contract…". Buffered edit via
  //                              setWorkSpecContract; ⌘S persists.

  const editContractController = useEditContractDialog({
    state,
    edits,
    setEdits,
  });
  const editContractDialog = editContractController.dialog;
  const handleRequestEditContract = editContractController.open;
  const cancelEditContract = editContractController.cancel;
  const confirmEditContract = editContractController.confirm;

  /**
   * Slice 10D — buffered "Edit project" modal state. All four editable
   * fields live together in one dialog, prefilled with the currently
   * effective values (so reopening after a pending edit shows the
   * buffered draft). Submit flushes all four through `setProjectField`
   * so the buffered patch merges naturally with any prior edits.
   *
   *   `name` / `projectNumber`   — NOT NULL in schema, but we still use
   *                                the string type here; on submit we
   *                                trim and fall back to the original
   *                                if the user tries to clear them.
   *   `builder` / `molioRefDate` — nullable; blank string → null.
   */
  const editProjectController = useEditProjectDialog({
    state,
    edits,
    setEdits,
  });
  const editProjectDialog = editProjectController.dialog;

  /**
   * Slice 10E — Edit work-area metadata dialog. Same pattern as the
   * project dialog above: the dialog state holds the *originals*
   * (captured from the effective snapshot at open time) plus the
   * user-editable strings. On confirm, `confirmEditWorkSpec` flushes
   * every field through `setWorkSpecField`; the helper itself
   * short-circuits when a field reverts to its original, so we don't
   * dirty the map with noop touches.
   *
   * Nullable text columns are represented as blank in the form; blank
   * on submit → null. NOT-NULL `workAreaName` falls back to original
   * if the user tries to clear it (same safety net as project.name).
   */
  const editWorkSpecController = useEditWorkSpecDialog({
    state,
    edits,
    setEdits,
  });
  const editWorkSpecDialog = editWorkSpecController.dialog;

  /** Slice 10E — Edit BDB metadata dialog. Same shape as above. */
  const editBdbController = useEditBdbDialog({
    state,
    edits,
    setEdits,
  });
  const editBdbDialog = editBdbController.dialog;

  /**
   * Slice 10F — Edit control-plan metadata dialog. Narrower than the
   * BDB/WorkSpec versions because the Molio `control_plan` schema only
   * has `title` + `revision` + `revision_date` as writable columns.
   * Title routes through the existing `setCpTitle` path on confirm;
   * revision + revision_date go through `setCpField`.
   */
  const editCpController = useEditCpDialog({
    state,
    edits,
    setEdits,
  });
  const editCpDialog = editCpController.dialog;

  const deleteContractController = useDeleteContractDialog({
    state,
    edits,
    setEdits,
  });
  const deleteContractDialog = deleteContractController.dialog;
  const handleRequestDeleteContract = deleteContractController.open;
  const cancelDeleteContract = deleteContractController.cancel;
  const confirmDeleteContract = deleteContractController.confirm;
  const confirmReassignAndDelete = deleteContractController.confirmReassign;

  const moveWorkSpecController = useMoveWorkSpecDialog({
    state,
    edits,
    setEdits,
  });
  const moveWorkSpecDialog = moveWorkSpecController.dialog;
  const handleRequestMoveWorkSpec = moveWorkSpecController.open;
  const cancelMoveWorkSpec = moveWorkSpecController.cancel;
  const confirmMoveWorkSpec = moveWorkSpecController.confirm;

  const openTarget = (target: TabTarget): void => {
    setTabs((t) => openOrFocusTab(t, target));
  };

  /**
   * Open the "Duplicate BDB" rename dialog for the given BDB id.
   * Pre-fills the rename input with `nextDuplicateName(...)` using the
   * current work-area siblings (plus the source name itself) as the
   * collision list.
   *
   * Guarded: if there are unsaved edits, we show the dialog with a
   * "dirty" error banner and a disabled Duplicate button. The user
   * saves first and retries.
   */

  // ---- Create PFBB child (Slice 10H.5 — #218) ----------------------------

  /**
   * Open the "Create PFBB child" dialog for a master BDB. Called from the
   * sidebar right-click. Caller has already verified `isPfbb === true`.
   *
   * Seeds the target work-area as null (the user must pick) and defaults
   * the child name to the master's name — that's what the Molio convention
   * leans toward: a child IS a project-scoped version of the same BDB, so
   * the name carries over and the user can tweak it if needed.
   *
   * Dirty guard: if there are unsaved edits we show the dialog with a
   * "dirty" banner and a disabled Create button. Same pattern as duplicate.
   */

  // ---- PFBB orphan-master migration banner (Slice 10H.6b) ---------------

  /**
   * Detection result for the currently loaded project. `null` means
   * "nothing to show" — either the file isn't loaded, or the user
   * dismissed the banner, or no orphan masters were found.
   *
   * Dismissal is session-scoped (sessionStorage) — it survives closing
   * and reopening the same project within one app run, but resets on
   * quit. That gives the user a way to say "leave me alone for now"
   * without suppressing the reminder forever.
   */
  // PFBB orphan-migration state lives in
  // ./state/usePfbbOrphanMigration.ts. The hook owns detection,
  // the dismiss-for-this-session preference, and the migrate-IPC
  // + reload flow. App.tsx forwards the post-reload payload back.
  const {
    pfbbOrphanState,
    onMigrate: confirmMigrateOrphanPfbbMasters,
    onDismiss: dismissPfbbMigrationBanner,
  } = usePfbbOrphanMigration({
    state,
    edits,
    baselineMtimeMs,
    onReloadComplete: (data, mtimeMs) => {
      setState({ kind: "loaded", data });
      setBaselineMtimeMs(mtimeMs);
    },
    resetEdits: () => setEdits(EMPTY_EDITS),
    sanitizeLoadedFile,
  });

  // ---- CP lifecycle helpers (Wave D — #40) ------------------------------

  /**
   * After any CP lifecycle op that mutates the file, reload the payload
   * so the sidebar tree and tabs reflect the new row graph. Shared by
   * create/delete CP and add/delete row. Optionally focuses a specific
   * tab afterwards (used for "open the newly created CP" on create).
   *
   * Tabs that point at ids which no longer exist are left in place —
   * MainPane renders a "not found" message and the user can close the
   * tab manually. The one exception is the active-delete-CP case, where
   * we explicitly close the tab that matched the deleted id so the user
   * isn't stuck on a stale empty view.
   */
  const reloadAfterCpOp = useCallback(
    async (opts?: {
      focus?: TabTarget;
      closeTarget?: (t: TabTarget) => boolean;
    }): Promise<void> => {
      if (state.kind !== "loaded") return;
      const raw = await window.molio.openFile(state.data.path);
      const data = sanitizeLoadedFile(raw);
      setState({ kind: "loaded", data });
      setBaselineMtimeMs(data.mtimeMs);
      setEdits(EMPTY_EDITS);
      setTabs((t) => {
        let next = t;
        if (opts?.closeTarget) {
          for (const tab of t.tabs) {
            if (opts.closeTarget(tab.target)) {
              next = closeTab(next, tab.id);
            }
          }
        }
        if (opts?.focus) {
          next = openOrFocusTab(next, opts.focus);
        }
        return next;
      });
    },
    [state],
  );

  // #250 — "Opret standard-entrepriser": create any default contracts not
  // already present, then reload so they appear. Guarded against unsaved
  // edits (the reload would drop them).
  const handleSeedDefaultContracts = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded") return;
    if (hasEdits(edits)) {
      window.alert(t("projectOverview.contracts.seedDirty"));
      return;
    }
    try {
      const res = await window.molio.seedDefaultContracts({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
      });
      if (res.kind === "ok") {
        await reloadAfterCpOp();
      } else {
        // conflict (disk changed) or missing (file gone) — resync.
        window.alert(t("projectOverview.contracts.seedConflict"));
        await reloadAfterCpOp();
      }
    } catch (err) {
      window.alert(friendlyErrorForDialog(err));
    }
  }, [state, edits, baselineMtimeMs, reloadAfterCpOp, t]);

  // Structural-dialog hook controllers declared here (after
  // `reloadAfterCpOp` is in scope). Each owns its own dialog
  // state + IPC orchestration + reload-on-success flow.
  const duplicateBdbController = useDuplicateBdbDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const duplicateBdbDialog = duplicateBdbController.dialog;
  const handleRequestDuplicateBdb = duplicateBdbController.open;
  const cancelDuplicateBdb = duplicateBdbController.cancel;
  const confirmDuplicateBdb = duplicateBdbController.confirm;

  const createPfbbChildController = useCreatePfbbChildDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const createPfbbChildDialog = createPfbbChildController.dialog;
  const handleRequestCreatePfbbChild = createPfbbChildController.open;
  const cancelCreatePfbbChild = createPfbbChildController.cancel;
  const confirmCreatePfbbChild = createPfbbChildController.confirm;

  const newCpController = useNewCpDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const newCpDialog = newCpController.dialog;
  const handleRequestNewControlPlan = newCpController.open;
  const cancelNewCp = newCpController.cancel;
  const confirmNewCp = newCpController.confirm;

  // FIX-DelCpStrike 2026-05-11 — buffered now (markDelete +
  // strikethrough). No IPC or reload needed.
  const deleteCpController = useDeleteCpDialog({
    state,
    setEdits,
  });
  const deleteCpDialog = deleteCpController.dialog;
  const handleRequestDeleteControlPlan = deleteCpController.open;
  const cancelDeleteCp = deleteCpController.cancel;
  const confirmDeleteCp = deleteCpController.confirm;

  const moveCpController = useMoveCpDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const moveCpDialog = moveCpController.dialog;
  const handleRequestMoveControlPlan = moveCpController.open;
  const cancelMoveCp = moveCpController.cancel;
  const confirmMoveCp = moveCpController.confirm;

  const deleteRowController = useDeleteRowDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const deleteRowDialog = deleteRowController.dialog;
  const handleRequestDeleteRow = deleteRowController.open;
  const cancelDeleteRow = deleteRowController.cancel;
  const confirmDeleteRow = deleteRowController.confirm;

  const newContractController = useNewContractDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const newContractDialog = newContractController.dialog;
  const handleRequestNewContract = newContractController.open;
  const cancelNewContract = newContractController.cancel;
  const confirmNewContract = newContractController.confirm;

  const importController = useImportDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const importDialog = importController.dialog;
  // IMP-API — clicking the top-bar import icon now opens the
  // unified source picker instead of jumping straight to the OS
  // file dialog. The picker handles both the file path AND the
  // Browse Molio download flow, then routes through the existing
  // requestWithPath path.
  const [importSourceOpen, setImportSourceOpen] = useState(false);
  // SPLIT-Merge (#248) — the empty arbejdsbeskrivelse being filled.
  // null = modal closed; number = modal open with this target ws id.
  const [fillFromStandardWsId, setFillFromStandardWsId] = useState<
    number | null
  >(null);
  // Queue of pending source paths from a multi-select Browse Molio
  // download. After each ImportModal closes (success or cancel),
  // we dequeue the next path and re-open the import dialog. Empty
  // when no batch is in flight.
  const [importQueue, setImportQueue] = useState<string[]>([]);
  const handleRequestImport = (): void => setImportSourceOpen(true);
  const cancelImport = (): void => {
    // Distinguish "closing after a successful import" from "user
    // bailed mid-precheck". The dialog uses the same close action
    // for both, so we read `successSummary` to decide whether to
    // continue draining a multi-file Browse Molio batch or to
    // abort it. Closing a success dialog → queue continues.
    // Cancelling before completion → drop the rest of the batch.
    const wasSuccess = importController.dialog?.successSummary != null;
    importController.cancel();
    if (!wasSuccess) {
      setImportQueue([]);
    }
  };
  // Picker → ImportModal handoff + multi-file batch drain. After
  // each ImportModal closes (cancel or success), if there's a
  // queued path, kick off the next import. Tracking previous
  // dialog state through a ref avoids firing on the initial
  // null → null mount.
  const handleImportSourcePicked = (paths: string[]): void => {
    if (paths.length === 0) return;
    setImportSourceOpen(false);
    const [first, ...rest] = paths;
    setImportQueue(rest);
    void importController.requestWithPath(first!);
  };
  const prevImportDialogRef = useRef(importDialog);
  useEffect(() => {
    const wasOpen = prevImportDialogRef.current != null;
    const isOpen = importDialog != null;
    prevImportDialogRef.current = importDialog;
    if (wasOpen && !isOpen && importQueue.length > 0) {
      const [next, ...rest] = importQueue;
      setImportQueue(rest);
      void importController.requestWithPath(next!);
    }
  }, [importDialog, importQueue, importController]);
  const onImportToggleWorkArea = importController.toggleWorkArea;
  const onImportToggleBdb = importController.toggleBdb;
  const onImportSetLandingContract = importController.setLandingContractFor;
  const onImportSetLandingWorkArea = importController.setLandingWorkAreaFor;
  const onImportSetWaResolution = importController.setWaResolution;
  const onImportSetBdbResolution = importController.setBdbResolution;
  const onImportCheck = importController.check;
  const onImportApply = importController.apply;

  // -- New Control Plan --

  // -- Delete Control Plan --

  // -- Move Control Plan to Specification (Slice 6O.4 — #112) ---------------
  //
  // Immediate-persistence, same envelope as duplicate/delete CP. The
  // server-side guard (`moveControlPlan` in core/write.ts) auto-picks the
  // target slot from the CP's own `control_plan_type`, so the UI only has
  // to ask the user which BDB to move it to.
  //
  // Differences from "Move to contract…" (buffered):
  //   - This reloads the file on success → same dirty-state guard that
  //     Duplicate CP / Delete CP use.
  //   - The conflict/missing/slot-occupied outcomes surface inline on the
  //     dialog rather than as a toast, since the user might pick a
  //     different BDB and retry.

  /**
   * Slice 6M: restore a row that the user previously marked for deletion.
   * Works from the sidebar right-click menu ("Restore") and from the
   * in-tab placeholder's Restore button. Entirely local — just drops
   * the `delete` patch out of the edit map.
   */
  const handleRestoreDelete = useCallback(
    (entityKind: DeleteEntityKind, id: number): void => {
      setEdits((prev) => restoreDelete(prev, entityKind, id));
    },
    [],
  );

  // -- Add Row (no modal — direct action with banner on failure) --

  const handleRequestAddRow = useCallback(
    async (controlPlanId: number, headerId: number): Promise<void> => {
      if (state.kind !== "loaded") return;
      if (hasEdits(edits)) {
        setCpOpError(
          "You have unsaved changes. Save the file first, then add a new row.",
        );
        return;
      }
      try {
        const result = await window.molio.addControlPlanRow({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          controlPlanId,
          headerId,
        });
        if (result.kind === "conflict") {
          setCpOpError(
            "The file changed on disk since you opened it. Reload and try again.",
          );
          return;
        }
        if (result.kind === "missing") {
          setCpOpError("The file no longer exists at its original location.");
          return;
        }
        setCpOpError(null);
        await reloadAfterCpOp();
      } catch (err) {
        setCpOpError(friendlyErrorForDialog(err));
      }
    },
    [baselineMtimeMs, edits, reloadAfterCpOp, state],
  );

  // -- Add Section (Task 89) ----------------------------------------------
  //
  // Same shape as Add Row above: no modal, immediate write, banner on
  // failure, reload on success. The new section is APPENDED at the
  // bottom with an empty heading — the heading cell is already editable
  // inline, so the user types it right where it appears.
  //
  // `headerNo` is TEXT in the schema; `nextHeaderNo` reads the highest
  // leading integer among the existing sections and returns the next
  // one as a string. Deliberately no renumbering and no insert-in-the-
  // middle: appending is the only path, so numbers can't collide.

  const handleRequestAddHeader = useCallback(
    async (controlPlanId: number): Promise<void> => {
      if (state.kind !== "loaded") return;
      if (hasEdits(edits)) {
        setCpOpError(
          "You have unsaved changes. Save the file first, then add a new section.",
        );
        return;
      }
      try {
        const existing = state.data.cpHeadersByPlan[controlPlanId] ?? [];
        const result = await window.molio.addControlPlanHeader({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          controlPlanId,
          header: "",
          headerNo: nextHeaderNo(existing),
        });
        if (result.kind === "conflict") {
          setCpOpError(
            "The file changed on disk since you opened it. Reload and try again.",
          );
          return;
        }
        if (result.kind === "missing") {
          setCpOpError("The file no longer exists at its original location.");
          return;
        }
        setCpOpError(null);
        await reloadAfterCpOp();
      } catch (err) {
        setCpOpError(friendlyErrorForDialog(err));
      }
    },
    [baselineMtimeMs, edits, reloadAfterCpOp, state],
  );

  // -- Delete Row --

  // Dismiss the transient CP op error banner after a few seconds.
  useEffect(() => {
    if (!cpOpError) return;
    const id = window.setTimeout(() => setCpOpError(null), 6000);
    return () => window.clearTimeout(id);
  }, [cpOpError]);

  // ---- Contract lifecycle + assignment handlers (Slice 6I) ---------------

  // --- New contract / Edit contract --------------------------------------

  // --- Edit project metadata (Slice 10D — #157) --------------------------
  //
  // Same buffered pattern as contract edit. The modal prefills with
  // effective values (so a pending draft is resumed, not discarded).
  // On submit we flush all four fields through `setProjectField` —
  // identical values short-circuit inside the helper so we don't
  // dirty the map with noop touches.

  const handleRequestEditProject = editProjectController.open;
  const cancelEditProject = editProjectController.cancel;
  const confirmEditProject = editProjectController.confirm;

  // --- Edit work-area metadata (Slice 10E) --------------------------------

  /**
   * Open the EditWorkSpecModal for a given work_spec.id. Reads the
   * effective value per field (so pending edits show up pre-filled)
   * and captures the originals for later revert-detection inside
   * `setWorkSpecField`. Implementation in
   * `./state/useEditWorkSpecDialog.ts`.
   */
  const handleRequestEditWorkSpec = editWorkSpecController.open;
  const cancelEditWorkSpec = editWorkSpecController.cancel;
  const confirmEditWorkSpec = editWorkSpecController.confirm;

  // --- Edit BDB metadata (Slice 10E) --------------------------------------
  const handleRequestEditBdb = editBdbController.open;
  const cancelEditBdb = editBdbController.cancel;
  const confirmEditBdb = editBdbController.confirm;

  // --- Edit control plan metadata (Slice 10F) -----------------------------
  const handleRequestEditCp = editCpController.open;
  const cancelEditCp = editCpController.cancel;
  const confirmEditCp = editCpController.confirm;

  // --- Attachments (Slice 10K) -------------------------------------------
  // The hook owns the immediate-persistence flow (open → IPC → reload),
  // the dirty-state guard, and the widened error union (too-large /
  // duplicate / CpOpDialogError).
  const attachmentsController = useAttachmentsDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const attachmentsDialog = attachmentsController.dialog;
  const handleRequestManageAttachments = attachmentsController.open;
  const cancelAttachments = attachmentsController.cancel;
  const setAttachmentsPendingFile = attachmentsController.setPendingFile;
  const setAttachmentsPendingType = attachmentsController.setPendingType;
  const confirmAddAttachment = attachmentsController.confirmAdd;
  const confirmDeleteAttachment = attachmentsController.confirmDelete;
  const confirmReplaceAttachment = attachmentsController.confirmReplace;

  // --- Global Attachments overview (Slice 10K.5) --------------------------
  // Kept as a separate hook from useAttachmentsDialog so the two modals
  // don't fight each other (e.g. "Go to work area…" closes this one and
  // opens the per-work-area one). Delete uses the same IPC path but
  // routes its saving/error state through this hook.
  const globalAttachmentsController = useGlobalAttachmentsDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const globalAttachmentsDialog = globalAttachmentsController.dialog;
  const handleShowGlobalAttachments = globalAttachmentsController.open;
  const cancelGlobalAttachments = globalAttachmentsController.cancel;
  const confirmDeleteAttachmentGlobal =
    globalAttachmentsController.confirmDelete;

  /**
   * "Go to work area…" action in the global overview: close the global
   * modal and open the per-work-area modal so the user can Add /
   * Replace / Delete in the normal context.
   */
  const handleGoToWorkSpecFromGlobal = (workSpecId: number): void => {
    globalAttachmentsController.cancel();
    handleRequestManageAttachments(workSpecId);
  };

  // --- Sidebar-driven attachment actions (Slice 10K.8) -------------------
  //
  // Three entry points, one per action, each opens a small modal and
  // routes through the immediate-persistence envelope like the other
  // attachment ops:
  //   • handleRequestOpenAttachment   → fire-and-forget, no modal
  //   • handleRequestRenameAttachment → RenameAttachmentModal
  //   • handleRequestDeleteAttachment → ConfirmDeleteAttachmentModal
  //   • handleRequestMoveAttachment   → MoveAttachmentModal
  //
  // "Open" just writes a temp file and hands it to the OS default app;
  // nothing is mutated so no dirty-guard / reload is needed.

  const handleRequestOpenAttachment = useCallback(
    async (attachmentId: number): Promise<void> => {
      if (state.kind !== "loaded") return;
      try {
        const result: OpenAttachmentResult = await window.molio.openAttachment({
          path: state.data.path,
          attachmentId,
        });
        if (result.kind !== "ok") {
          // Row vanished, temp-write failed, blocked type, etc. Let the
          // user know and reload if the row is gone so the tree matches disk.
          let message: string;
          if (result.kind === "not-found") {
            message =
              "This attachment no longer exists. The project will reload.";
          } else if (result.kind === "blocked") {
            const ext = result.extension ? `.${result.extension}` : "this type";
            message =
              `For your safety, attachments of ${ext} are not opened ` +
              `automatically (they can run code or be used for phishing). ` +
              `Save the attachment and open it yourself if you trust it.`;
          } else {
            message = `Could not open the attachment: ${result.message}`;
          }
          window.alert(message);
          if (result.kind === "not-found") {
            await reloadAfterCpOp();
          }
        }
      } catch (err) {
        window.alert(
          `Could not open attachment: ${friendlyErrorForDialog(err)}`,
        );
      }
    },
    [reloadAfterCpOp, state],
  );

  const renameAttachmentController = useRenameAttachmentDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const renameAttachmentDialog = renameAttachmentController.dialog;
  const handleRequestRenameAttachment = renameAttachmentController.open;
  const cancelRenameAttachment = renameAttachmentController.cancel;
  const confirmRenameAttachment = renameAttachmentController.confirm;

  const deleteAttachmentController = useDeleteAttachmentDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const deleteAttachmentDialog = deleteAttachmentController.dialog;
  const handleRequestDeleteAttachment = deleteAttachmentController.open;
  const cancelDeleteAttachment = deleteAttachmentController.cancel;
  const confirmDeleteAttachmentSidebar = deleteAttachmentController.confirm;

  const moveAttachmentController = useMoveAttachmentDialog({
    state,
    edits,
    baselineMtimeMs,
    reloadAfterCpOp,
  });
  const moveAttachmentDialog = moveAttachmentController.dialog;
  const handleRequestMoveAttachment = moveAttachmentController.open;
  const cancelMoveAttachment = moveAttachmentController.cancel;
  const confirmMoveAttachment = moveAttachmentController.confirm;

  // --- Import from another moliospec (Slice 6K.3) -----------------------

  /**
   * Click on the "Import…" button on the Project tab. Flow:
   *   1. Dirty guard — if the current file has unsaved edits, we open
   *      the modal pre-erroring with `kind: "dirty"`. The user must
   *      dismiss, save, and try again.
   *   2. File picker — one-off native open dialog, limited to the
   *      moliospec extensions.
   *   3. Read source — slim summary via `readImportSource`. Build
   *      the tree + seed per-item landing defaults.
   */

  const { activeTabId, activeTabKind, activeTabUi, patchActiveTabUi } =
    tabsController;

  // Phase 10 Slice 10A — compute the effective collapsed flag from the
  // two-part sidebar state. The button, ARIA labels and the Sidebar
  // itself all read from this single source of truth.
  const sidebarCollapsed = effectiveSidebarCollapsed(
    sidebarPrefs,
    activeTabKind,
  );

  // When the active tab moves *away* from the Project tab, clear the
  // session-only override so the next entry to the Project tab auto-
  // collapses again. Staying on (or entering) the Project tab is a no-op.
  useEffect(() => {
    setSidebarPrefs((s) => handleActiveTabChange(s, activeTabKind));
  }, [activeTabKind]);

  /**
   * Toggle the Reference panel for the active tab AND persist the new
   * value as the default for future tab opens and app restarts. The
   * per-tab override stays in tabUiStates; the default only drives what
   * a *fresh* tab starts as.
   */
  const toggleRefPanelCollapsed = (): void => {
    const next = !activeTabUi.refPanelCollapsed;
    patchActiveTabUi({ refPanelCollapsed: next });
    refPanelCollapsedDefaultRef.current = next;
    writeRefPanelCollapsed(prefStore(), next);
  };

  /**
   * Close a tab. Tabs are views — edits live on the document, so closing
   * a tab never discards or prompts. Just drop the per-tab UI scratch
   * state so the tabUiStates map doesn't grow forever.
   */
  const handleCloseTab = tabsController.closeTab;

  // Reference/compare actions now come from the `useReferenceCompare` seam
  // above: `loadReference` (always opens the picker, used by the keyboard
  // shortcut) and `toggleReference` (top-bar button: clear when a reference is
  // loaded, otherwise open the picker).

  /**
   * Phase 8 round 2 — Reader mode toggle handler. Settings dialog
   * calls this with the desired next state. We confirm with the
   * user before flipping ON if there are unsaved edits — toggling
   * to Reader mode while edits are pending shouldn't be a way to
   * lose work silently. Toggling OFF is unconditional (going back
   * to editable can't damage anything).
   */
  const handleRequestToggleReaderMode = useCallback(
    (next: boolean): void => {
      if (!next) {
        setReaderMode(false);
        return;
      }
      // next === true. If we have unsaved edits, ask first.
      if (dirty) {
        setReaderModeConfirmOpen(true);
        return;
      }
      setReaderMode(true);
    },
    [dirty],
  );

  /**
   * Slice #41 — wire menu-driven shortcuts (⌘O, ⌘S, ⌘⇧S, ⌘W, ⌘E, ⌘I,
   * ⌘,, ⌘?, ⌘⇧O). Each handler is a thin pass-through into existing
   * controllers. Save / Save-As are no-ops while a save is in flight
   * or before a file is loaded; the controllers themselves guard
   * those cases (`if (state.kind !== "loaded") return`).
   */
  useShortcutHandler({
    // File → New — same "start from scratch" flow as the Welcome screen.
    onNewFile: () => {
      void (async () => {
        const res = await window.molio.createEmptyProject();
        if (res.kind === "ok") void openPath(res.path);
      })();
    },
    onOpen: handleOpen,
    // Phase 8 round 2 — Reader mode silently no-ops Save / Save As /
    // Import. The buttons are also disabled, but the keyboard
    // shortcuts route through this handler so we guard once here.
    onSave: () => {
      if (readerMode) return;
      void save({ force: false });
    },
    onSaveAs: () => {
      if (readerMode) return;
      void saveAs();
    },
    onCloseTab: () => handleCloseTab(tabsController.activeTabId),
    onImport: () => {
      if (readerMode) return;
      void importController.request();
    },
    onExport: exportController.open,
    onSettings: () => setSettingsOpen(true),
    onShortcuts: () => setShortcutsOpen(true),
    onLoadReference: () => {},
    // UX1 — File → Open Recent → [path]. Use the same openPath flow
    // the Welcome screen uses. Failures (file moved/deleted) bubble
    // through the standard save-error banner; the entry stays in the
    // list so the user can right-click it on the Welcome screen to
    // remove it themselves.
    onOpenRecent: (p) => {
      void openPath(p);
    },
    onClearRecent: () => clearRecent(),
    // RELOAD-3 — File → Reload from Disk. Same shared action as the
    // "changed on disk" banner; no-ops when no file is open.
    onReloadFromDisk: requestReload,
    // App menu on macOS, Help elsewhere. The app's own facts are
    // fetched the first time the panel is opened - they cannot change
    // while the app runs, and nobody who never opens About should pay
    // for the round trip.
    onAbout: () => {
      setAboutOpen(true);
      if (!appInfo) void window.molio.getAppInfo().then(setAppInfo);
    },
  });

  // ⌘1–9 jumps to the Nth tab. Renderer-only because tabs are
  // dynamic (we'd otherwise rebuild the Electron menu on every tab
  // change). Out-of-range indices are silently ignored.
  // Slice "Version compare" — preserve scroll position per tab so
  // jumping back to a tab lands where the user left it. Snapshot on
  // outgoing tab + restore on incoming tab via a useEffect that
  // watches `activeTabId`. Falls back to scrollTop=0 for tabs the
  // user hasn't visited yet.
  const { wrapSelectTab } = useTabScrollPersistence({
    activeTabId: tabsController.activeTabId,
    selectTab: tabsController.selectTab,
  });

  useTabSwitchShortcuts((zeroBasedIndex) => {
    const target = tabsController.tabs.tabs[zeroBasedIndex];
    if (!target) return;
    wrapSelectTab(target.id);
  });

  /**
   * Slice "Highlights & formatting" — click-to-jump from the
   * Highlights tab. Switches to the section's owning tab (work-area
   * or BDB) AND publishes a transient `pendingScroll` directive that
   * the destination SectionEditor reads on mount/update to
   * scroll-and-flash the specific run.
   *
   * Wrapped in useCallback so the HighlightsView prop reference stays
   * stable across renders.
   */
  /**
   * Slice "Version compare" — click-to-jump from the Revisions tab.
   * Routes a SectionRevision to its owning tab + sets pendingScroll
   * so the destination SectionEditor scrolls to that section. Falls
   * back gracefully when the section's parent doesn't exist in
   * `current` (e.g. a `kind: "deleted"` revision — the section only
   * lives in the reference).
   */
  const jumpToSectionRevision = useCallback(
    (rev: SectionRevision): void => {
      if (rev.parent.currentId == null) return;
      if (state.kind !== "loaded") return;
      const data = state.data;
      setTabs((s) => {
        const next =
          rev.parent.kind === "workSpec"
            ? openOrFocusTab(s, { kind: "workSpec", id: rev.parent.currentId! })
            : openOrFocusTab(s, { kind: "bdb", id: rev.parent.currentId! });
        // pendingScroll wants a specific run kind. Highlights uses
        // ordinal-of-mark; here we only need to land on the section,
        // so we set the markKind to a sentinel the querySelector can't
        // match — the existing fallback then scrolls the section into
        // view via the `data-section-id` lookup, which is exactly the
        // behaviour we want here. We resolve the destination section by
        // hierarchical path (e.g. "1.2.3") so collisions across nested
        // siblings with the same local sectionNo don't mis-jump.
        setPendingScroll({
          tabId: next.activeTabId,
          sectionId:
            findSectionIdInPayload(data, rev.parent, rev.sectionPath) ?? -1,
          markKind: "__section__",
          ordinal: 0,
        });
        return next;
      });
    },
    [state],
  );

  const jumpToHighlight = useCallback((h: Highlight): void => {
    setTabs((s) => {
      const next =
        h.location.kind === "workSpec"
          ? openOrFocusTab(s, { kind: "workSpec", id: h.location.workSpecId })
          : openOrFocusTab(s, { kind: "bdb", id: h.location.bdbId });
      // The destination tab id is whichever one is now active —
      // could be a freshly-created tab or a re-focused existing one.
      setPendingScroll({
        tabId: next.activeTabId,
        sectionId: h.location.sectionId,
        markKind: h.markKind,
        ordinal: h.markOrdinal,
      });
      return next;
    });
  }, []);

  /**
   * Slice "Highlights & formatting" — consumes the `pendingScroll`
   * directive set by `jumpToHighlight`. Runs once whenever a new
   * directive lands AND the destination tab is active. Looks up the
   * section's DOM by `data-section-id`, finds the Nth `<mark>` /
   * `<span>` of the right kind, scrolls it into view, and adds a
   * brief highlight-flash class so the user can see exactly which
   * run we landed on. Clears itself once consumed.
   *
   * If the destination tab hasn't mounted yet (freshly opened), we
   * retry on a couple of animation frames before giving up. The
   * cap (~5 frames) avoids hanging on a section that was deleted
   * since the highlights list was computed.
   */
  useEffect(() => {
    if (!pendingScroll) return;
    if (tabsController.activeTabId !== pendingScroll.tabId) return;
    let cancelled = false;
    let frames = 0;
    const MAX_FRAMES = 5;

    function tryScroll(): void {
      if (cancelled) return;
      const ps = pendingScroll;
      if (!ps) return;
      const sectionEl = document.querySelector(
        `[data-section-id="${ps.sectionId}"]`,
      );
      if (!sectionEl) {
        // Destination tab hasn't rendered the section yet; wait.
        if (frames++ < MAX_FRAMES) {
          requestAnimationFrame(tryScroll);
          return;
        }
        // Give up — clear so we don't retry forever.
        setPendingScroll(null);
        return;
      }
      const tag = ps.markKind.startsWith("bg-") ? "mark" : "span";
      const candidates = sectionEl.querySelectorAll<HTMLElement>(
        `${tag}.${ps.markKind}`,
      );
      const target = candidates[ps.ordinal] ?? candidates[0];
      if (!target) {
        // The section exists but the run is gone (likely edited
        // away after the highlights list was computed). Scroll the
        // section into view as a graceful fallback.
        sectionEl.scrollIntoView({ block: "center", behavior: "smooth" });
        setPendingScroll(null);
        return;
      }
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add("highlight-flash");
      // Remove the flash class after the animation so re-runs
      // (clicking the same row twice) re-trigger the effect. Keep
      // this slightly longer than the keyframe duration in styles.css
      // so the class survives the entire animation.
      window.setTimeout(() => {
        target.classList.remove("highlight-flash");
      }, 3100);
      setPendingScroll(null);
    }

    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [pendingScroll, tabsController.activeTabId]);

  // Plain "?" (no modifier) also opens the shortcuts cheat sheet —
  // matches the convention many apps use. Suppressed when the focus
  // is on a text input so users can still type "?" into a field.
  // The menu accelerator (⌘? / Ctrl+/) covers the same action via
  // the Help menu and works regardless of focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "?") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        (tgt instanceof HTMLElement && tgt.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setShortcutsOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Edit callbacks handed down to MainPane → SpecView ----

  const editedBodyFor = useCallback(
    (kind: SectionKind, sectionId: number, originalBody: string): string => {
      return getEffectiveBody(edits, kind, sectionId, originalBody);
    },
    [edits],
  );

  const onEditBody = useCallback(
    (
      kind: SectionKind,
      sectionId: number,
      nextBody: string,
      originalBody: string,
    ): void => {
      setEdits((m) =>
        setSectionBody(m, kind, sectionId, nextBody, originalBody),
      );
    },
    [],
  );

  // ---- PFBB child supplement edit callbacks (Slice 10H.7 Commit 5) ----
  //
  // Both callbacks accept the already-built `MergedChildView` so they
  // can resolve a master-section id → child-side row id without
  // re-walking the payload on every keystroke. The view is rebuilt on
  // every render of the child (cheap; ~one pass over ~hundreds of
  // rows).
  const pfbbSupplementFor = useCallback(
    (
      childBdbId: number,
      masterSectionId: number,
      view: MergedChildView,
    ): PfbbChildSupplementSnapshot => {
      const row = view.merged.find(
        (r) => r.masterSection.id === masterSectionId,
      );
      const existingSectionId = row?.supplement?.id ?? null;
      const originalBody = row?.supplement?.body ?? null;
      const effectiveBody = getEffectiveBdbSupplementBody(edits, {
        bdbId: childBdbId,
        pfbbSectionId: masterSectionId,
        existingSectionId,
        originalBody,
      });
      const hasPendingEdit = isBdbSupplementEdited(edits, {
        bdbId: childBdbId,
        pfbbSectionId: masterSectionId,
        existingSectionId,
      });
      return { effectiveBody, existingSectionId, hasPendingEdit };
    },
    [edits],
  );

  const onPfbbSupplementBodyChange = useCallback(
    (
      childBdbId: number,
      view: MergedChildView,
      input: { masterSectionId: number; sectionNo: string; body: string },
    ): void => {
      const row = view.merged.find(
        (r) => r.masterSection.id === input.masterSectionId,
      );
      const existingSectionId = row?.supplement?.id ?? null;
      const originalBody = row?.supplement?.body ?? null;
      setEdits((m) =>
        setBdbSectionSupplement(m, {
          bdbId: childBdbId,
          pfbbSectionId: input.masterSectionId,
          sectionNo: input.sectionNo,
          body: input.body,
          existingSectionId,
          originalBody,
        }),
      );
    },
    [],
  );

  // Slice 10H.11 / #235 — stage a direct delete of a broken
  // supplement row (one whose pfbbSectionId no longer matches a real
  // master section). Surfaced from the PfbbBrokenSupplementsBanner
  // via childContext.
  const onDeletePfbbBrokenSupplement = useCallback(
    (sectionId: number): void => {
      setEdits((m) => stageBdbSectionDelete(m, sectionId));
    },
    [],
  );

  // ---- Slice 10G — Section hierarchy (insert / rename / delete) ----
  // The TOC right-click menu + the three modals it can open (Add
  // subsection / Add sibling after / Rename / Delete) live in
  // ./SectionMenuController.tsx. The controller owns its own state
  // and exposes an imperative `open()` method via the ref. App.tsx
  // forwards the TOC right-click to it.
  const sectionMenuRef = useRef<SectionMenuRef>(null);
  const onSectionContextMenu = useCallback(
    (
      specKind: "workSpec" | "bdb",
      specId: number,
      sectionId: number,
      coords: { x: number; y: number },
    ): void => {
      sectionMenuRef.current?.open(specKind, specId, sectionId, coords);
    },
    [],
  );

  // Slice 10G — compute the "edit-aware" section maps: tombstone-
  // filter any sections (+ their descendants) staged for deletion,
  // and swap in any pending renames so the user sees the new
  // heading in the TOC + in section headers before save. Done at
  // App.tsx level so MainPane + SpecTabView stay unaware of the
  // edit buffer. Inserts are NOT folded in (new rows get disk ids
  // only after save + reload), which matches the 10H.7 precedent.
  //
  // FIX-NameOverlay 2026-05-11 — also fold metadata edits in so
  // the sidebar / tab titles / CP table headers / project card
  // show the user's pending name/title changes BEFORE Save. The
  // existing `mergeSavedEdits` already knows how to overlay
  // project / work-area / BDB / CP metadata; we chain it before
  // the section-hierarchy overlay (the two cover disjoint parts
  // of FilePayload so the order is safe).
  const displayData = useMemo(() => {
    if (state.kind !== "loaded") return null;
    // 1) Metadata + body + CP fields overlay.
    const withMetadata = mergeSavedEdits(state.data, edits);

    // 2) Section-hierarchy overlay (create / rename / delete).
    const hasSectionEdits = Object.values(edits).some(
      (p) =>
        p.kind === "sectionCreate" ||
        p.kind === "sectionRename" ||
        p.kind === "sectionDelete",
    );
    if (!hasSectionEdits) return withMetadata;
    const sectionsByWorkSpec: Record<
      number,
      import("../../shared/ipc.js").SectionData[]
    > = {};
    for (const [wsIdStr, list] of Object.entries(
      withMetadata.sectionsByWorkSpec,
    )) {
      sectionsByWorkSpec[Number(wsIdStr)] = applySectionHierarchyEdits(
        list,
        edits,
        "workSpec",
      );
    }
    const sectionsByBdb: Record<
      number,
      import("../../shared/ipc.js").SectionData[]
    > = {};
    for (const [bdbIdStr, list] of Object.entries(withMetadata.sectionsByBdb)) {
      sectionsByBdb[Number(bdbIdStr)] = applySectionHierarchyEdits(
        list,
        edits,
        "bdb",
      );
    }
    return { ...withMetadata, sectionsByWorkSpec, sectionsByBdb };
  }, [state, edits]);
  // Back-compat alias — older blocks still reference dataForMainPane.
  // Removing the alias would change every call site at once; left in
  // as a one-liner so the diff stays narrow.
  const dataForMainPane = displayData;

  /**
   * UX3-bis — single source of truth for "what changed vs the loaded
   * Version reference". Computed once per (current, reference) pair,
   * shared between the Revisions tab and the TOC change-dots so the
   * two views can never diverge. Null when there's no compare in
   * progress (no reference loaded, or current file isn't ready).
   */
  // Community edition: no version diff (Compare versions is Glasshouse-only).
  const versionRevisions = null;

  // SPLIT-Merge (#248) — set of work-spec ids that are eligible for
  // "fyld fra standard" (i.e. currently have zero sections). Sidebar
  // uses this to gate the context-menu item, and SpecView reads the
  // same condition via `sections.length === 0` inside MainPane. We
  // derive both from the same data source so they stay consistent.
  const fillFromStandardEligible = useMemo<ReadonlySet<number>>(() => {
    if (state.kind !== "loaded") return new Set<number>();
    const data = dataForMainPane ?? state.data;
    const eligible = new Set<number>();
    for (const ws of data.workSpecs) {
      const sections = data.sectionsByWorkSpec[ws.id] ?? [];
      if (sections.length === 0) eligible.add(ws.id);
    }
    return eligible;
  }, [state, dataForMainPane]);

  // Slice 10I.b — edit/add/delete custom_data rows. The renderer
  // owns the base64 encoding so the main process gets a ready-to-
  // bind Buffer through applyEdits; these callbacks just thread
  // the staged patch into the edit buffer. Effective entries
  // (disk + pending) are computed below and passed to the modal.
  const onSetCustomData = useCallback(
    (key: string, valueBase64: string): void => {
      setState((s) => s); // force React to sync before reading disk
      setEdits((m) => {
        // Find disk original from current loaded state; if state isn't
        // "loaded" we're mid-load and the user can't reach this path.
        const diskOriginal =
          state.kind === "loaded"
            ? (state.data.customData.find((e) => e.key === key)?.valueBase64 ??
              null)
            : null;
        return setCustomData(m, {
          key,
          valueBase64,
          originalBase64: diskOriginal,
        });
      });
    },
    [state],
  );
  const onDeleteCustomData = useCallback(
    (key: string): void => {
      setEdits((m) => {
        const hadDiskRow =
          state.kind === "loaded" &&
          state.data.customData.some((e) => e.key === key);
        return deleteCustomDataEdit(m, { key, hadDiskRow });
      });
    },
    [state],
  );
  const onClearCustomDataPending = useCallback((key: string): void => {
    setEdits((m) => clearCustomDataEdit(m, key));
  }, []);

  // Effective custom_data entries for the Edit Project modal — disk
  // rows with any pending edits folded in. Recomputed whenever
  // `edits` or `state.data.customData` changes.
  const effectiveCustomData = useMemo(() => {
    if (state.kind !== "loaded") return [];
    return getEffectiveCustomData(edits, state.data.customData);
  }, [edits, state]);

  // ---- CP edit callbacks (Phase 6 Slice 6H — #40) ----

  /** Effective title for a control plan (patched or original). */
  const editedCpTitleFor = useCallback(
    (controlPlanId: number, originalTitle: string): string =>
      getEffectiveCpTitle(edits, controlPlanId, originalTitle),
    [edits],
  );

  /** Effective value for one cell on a CP row. */
  const editedCpRowCellFor = useCallback(
    (rowId: number, field: CpRowEditableField, originalValue: string): string =>
      getEffectiveCpRowCell(edits, rowId, field, originalValue),
    [edits],
  );

  /** Record a CP title edit (or clear it if reverted to original). */
  const onEditCpTitle = useCallback(
    (controlPlanId: number, newTitle: string, originalTitle: string): void => {
      setEdits((m) => setCpTitle(m, controlPlanId, newTitle, originalTitle));
    },
    [],
  );

  /** 10I-followup gap 3 — stage / clear a CP section header edit. */
  const editedCpHeaderFor = useCallback(
    (headerId: number, field: "header" | "headerNo", original: string) =>
      getEffectiveCpHeaderField(edits, headerId, field, original),
    [edits],
  );
  const onEditCpHeader = useCallback(
    (
      headerId: number,
      field: "header" | "headerNo",
      newValue: string,
      originalValue: string,
    ): void => {
      setEdits((m) =>
        setCpHeaderField(m, headerId, field, newValue, originalValue),
      );
    },
    [],
  );

  /** Record a CP row cell edit (or clear it if reverted to original). */
  const onEditCpRowCell = useCallback(
    (
      rowId: number,
      field: CpRowEditableField,
      newValue: string,
      originalValue: string,
    ): void => {
      setEdits((m) => setCpRowCell(m, rowId, field, newValue, originalValue));
    },
    [],
  );

  // Memoise so TabBar isn't re-rendered when unrelated state changes.
  const dirtyTabIds = useMemo(() => {
    if (state.kind !== "loaded") return EMPTY_SET;
    return buildDirtyTabIds(tabs, state.data, edits);
  }, [tabs, state, edits]);

  /**
   * Slice 6M — resolve the active tab's pending-delete state. Returns
   * the root-cause patch (and its label) so MainPane's placeholder can
   * offer a single Restore button, OR null when the tab is not
   * pending-delete.
   *
   * "Root cause" = the ancestor whose `del:*` patch is directly in the
   * edits map. A BDB can be pending because of a contract patch three
   * levels up; restoring the contract lifts the whole subtree.
   */
  const activeTabPendingDelete = useMemo((): {
    label: string;
    restore: () => void;
  } | null => {
    if (state.kind !== "loaded") return null;
    const target = activeTab(tabs).target;
    const data = state.data;

    const findDirect = (kind: DeleteEntityKind, id: number): boolean =>
      isPendingDelete(edits, kind, id);

    // Walk up from the target to find the nearest ancestor whose
    // delete patch is directly in the map.
    if (target.kind === "workSpec") {
      if (findDirect("workSpec", target.id)) {
        return {
          label: "Restore work area",
          restore: () => handleRestoreDelete("workSpec", target.id),
        };
      }
      const ws = findWorkSpecById(data, target.id);
      const cid = ws
        ? getEffectiveWorkSpecContract(edits, ws.id, ws.contractId)
        : null;
      if (cid !== null && findDirect("contract", cid)) {
        return {
          label: "Restore contract",
          restore: () => handleRestoreDelete("contract", cid),
        };
      }
      return null;
    }
    if (target.kind === "bdb") {
      if (findDirect("bdb", target.id)) {
        return {
          label: "Restore building element specification",
          restore: () => handleRestoreDelete("bdb", target.id),
        };
      }
      const b = findBdbById(data, target.id);
      if (!b || b.workSpecId == null) return null;
      if (findDirect("workSpec", b.workSpecId)) {
        const wsId = b.workSpecId;
        return {
          label: "Restore work area",
          restore: () => handleRestoreDelete("workSpec", wsId),
        };
      }
      const ws = findWorkSpecById(data, b.workSpecId);
      const cid = ws
        ? getEffectiveWorkSpecContract(edits, ws.id, ws.contractId)
        : null;
      if (cid !== null && findDirect("contract", cid)) {
        return {
          label: "Restore contract",
          restore: () => handleRestoreDelete("contract", cid),
        };
      }
      return null;
    }
    if (target.kind === "controlPlan") {
      // FIX-DelCpStrike 2026-05-11. A CP itself can now be
      // pending-delete (buffered). Otherwise we fall through to the
      // cascade check on the owning BDB / work area / contract — the
      // CP tab placeholder follows whatever ancestor is being removed.
      if (findDirect("controlPlan", target.id)) {
        return {
          label: "Restore control plan",
          restore: () => handleRestoreDelete("controlPlan", target.id),
        };
      }
      const cp = findControlPlanById(data, target.id);
      if (!cp) return null;
      // Find a BDB that owns this CP (via design or production slot).
      const owner = data.bdbs.find((b) => b.controlPlanIds.includes(cp.id));
      if (!owner) return null;
      if (findDirect("bdb", owner.id)) {
        return {
          label: "Restore building element specification",
          restore: () => handleRestoreDelete("bdb", owner.id),
        };
      }
      if (owner.workSpecId != null) {
        if (findDirect("workSpec", owner.workSpecId)) {
          const wsId = owner.workSpecId;
          return {
            label: "Restore work area",
            restore: () => handleRestoreDelete("workSpec", wsId),
          };
        }
        const ws = findWorkSpecById(data, owner.workSpecId);
        const cid = ws
          ? getEffectiveWorkSpecContract(edits, ws.id, ws.contractId)
          : null;
        if (cid !== null && findDirect("contract", cid)) {
          return {
            label: "Restore contract",
            restore: () => handleRestoreDelete("contract", cid),
          };
        }
      }
      return null;
    }
    // project — no pending delete applies
    return null;
    // handleRestoreDelete identity is stable enough (it calls setEdits),
    // but we intentionally list it here for correctness.
  }, [state, tabs, edits, handleRestoreDelete]);

  // Task 64 — the title text, computed once because Windows shows it
  // in the title strip and every other platform shows it in the
  // header <h1>. Project name when a file is open, product name on
  // the welcome screen.
  const headerTitle =
    state.kind === "loaded"
      ? (displayData?.project?.name ?? state.data.project?.name)?.trim() ||
        t("header.untitledProject")
      : t("header.appName");

  // Task 64 — on Windows the title moved up into the title strip, so
  // the header keeps only its buttons. Everywhere else the header is
  // unchanged.
  const isWindows = window.molio.platform === "win32";

  return (
    <ReaderModeProvider value={readerMode}>
      <div className="app" {...dragHandlers}>
          {/* Windows only — returns null on macOS and Linux. */}
          <WindowTitleBar
            title={headerTitle}
            dirty={dirty && state.kind === "loaded"}
            filePath={state.kind === "loaded" ? state.data.path : null}
          />
          <header className="app__header">
            <div className="app__header-left">
              {/* Polish pass 2026-04-22 — the sidebar collapse/expand
               *  button used to live here. It's now inside the sidebar
               *  itself (left of the filter input when expanded, top of
               *  the rail when collapsed) so all project-nav controls
               *  cluster in one place. See Sidebar.tsx. */}
              {/* Task 64 — hidden on Windows: the title strip above
               *  already shows this exact string, and repeating it here
               *  is the "product name twice" complaint. */}
              {!isWindows && (
                <h1 className="app__title">
                  {dirty && state.kind === "loaded" && (
                    <span className="app__dirty-dot" aria-hidden="true">
                      ●
                    </span>
                  )}
                  {headerTitle}
                </h1>
              )}
            </div>
            <div className="app__header-meta">
              {/* Filename + schema indicator used to live here. Removed
               *  2026-04-22 — the project name now fills the title slot,
               *  and the filename is visible in the OS window title bar. */}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  className={`btn-compact${compactView ? " is-on" : ""}`}
                  onClick={() => setCompactView((v) => !v)}
                  aria-pressed={compactView}
                  title={
                    compactView
                      ? t("header.compact.on")
                      : t("header.compact.off")
                  }
                >
                  {t("header.compact.label")}
                </button>
              )}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  className={`btn-print-toggle${
                    layoutMode === "print" ? " is-on" : ""
                  }`}
                  onClick={() =>
                    setLayoutMode(layoutMode === "print" ? "web" : "print")
                  }
                  aria-pressed={layoutMode === "print"}
                  aria-label={t("header.printLayout.ariaLabel")}
                  title={
                    layoutMode === "print"
                      ? t("header.printLayout.on")
                      : t("header.printLayout.off")
                  }
                >
                  <FileTextIcon size={16} aria-hidden="true" />
                </button>
              )}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() =>
                    setTabs((s) => openOrFocusTab(s, { kind: "highlights" }))
                  }
                  aria-label={t("header.highlights.label")}
                  title={t("header.highlights.tooltip")}
                >
                  <HighlighterIcon size={16} aria-hidden="true" />
                </button>
              )}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setExportOptionsOpen(true)}
                  aria-label={t("header.exportOptions.label")}
                  title={t("header.exportOptions.tooltip")}
                >
                  <ExportOptionsIcon size={16} aria-hidden="true" />
                </button>
              )}
              {/* Community edition: Compare versions (toggle + Revisions) removed. */}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={exportController.open}
                  disabled={!exportController.hasTargets}
                  aria-label={t("header.export.label")}
                  title={
                    exportController.hasTargets
                      ? t("header.export.ready")
                      : t("header.export.empty")
                  }
                >
                  <PrinterIcon size={16} aria-hidden="true" />
                </button>
              )}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  onClick={() => void handleRequestImport()}
                  title={t("header.import.tooltip")}
                  disabled={readerMode}
                >
                  {t("header.import.label")}
                </button>
              )}
              {state.kind === "loaded" && (
                <button
                  type="button"
                  onClick={() => void save({ force: false })}
                  disabled={!dirty || isSaving}
                  title={
                    dirty ? t("header.save.tooltip") : t("header.save.clean")
                  }
                >
                  {isSaving ? t("common.saving") : t("common.save")}
                </button>
              )}
              <button type="button" onClick={handleOpen}>
                {t("header.openFile.label")}
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setSettingsOpen(true)}
                aria-label={t("header.settings.label")}
                title={t("header.settings.tooltip")}
              >
                <SettingsIcon size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <ReaderModeBanner />

          {/* Community edition: reference banner (Compare versions) removed. */}

          {/* RELOAD-2 — the open file changed on disk under us. */}
          {state.kind === "loaded" && changedOnDisk && (
            <div
              className="disk-change-banner"
              role="status"
              aria-live="polite"
            >
              <span className="disk-change-banner__label">
                {t("diskChange.label")}
              </span>
              <button
                type="button"
                className="disk-change-banner__reload"
                onClick={requestReload}
              >
                {t("diskChange.reload")}
              </button>
              <button
                type="button"
                className="disk-change-banner__dismiss"
                onClick={dismissDiskChange}
                aria-label={t("common.dismissError")}
              >
                <XIcon size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          {state.kind === "loaded" && (
            <TabBar
              tabs={tabs}
              /* FIX-NameOverlay: use the overlay so pending name edits
             show in tab titles before Save. */
              data={displayData ?? state.data}
              dirtyTabIds={dirtyTabIds}
              onSelect={wrapSelectTab}
              onClose={handleCloseTab}
            />
          )}

          {dropError && (
            <div className="drop-error" role="alert">
              <span className="drop-error__message">{dropError}</span>
              <button
                type="button"
                className="drop-error__dismiss"
                onClick={dismissDropError}
                aria-label={t("common.dismissError")}
              >
                ×
              </button>
            </div>
          )}

          <div className="app__body">
            {state.kind === "idle" && (
              <WelcomeScreen
                recentFiles={recentFiles}
                onOpenDialog={() => {
                  void handleOpen();
                }}
                onOpenPath={(p) => {
                  void openPath(p);
                }}
                onRemoveRecent={removeRecent}
                onStartFromScratch={() => {
                  // IMP-API — create a brand-new file. Main shows
                  // the save dialog and copies the bundled blank
                  // template to the chosen path. We open the file
                  // afterwards via the same path that handles every
                  // other open.
                  void (async () => {
                    const res = await window.molio.createEmptyProject();
                    if (res.kind === "ok") {
                      void openPath(res.path);
                    }
                    // cancelled → no-op; error → handled silently for
                    // now (saveDialog failures are rare in practice).
                  })();
                }}
              />
            )}

            {state.kind === "loading" && (
              <div className="app__empty">
                <p>{t("loading.opening", { path: state.path })}</p>
              </div>
            )}

            {state.kind === "error" && (
              <div className="app__empty">
                <pre className="error">
                  {t("loading.errorPrefix")}: {state.message}
                </pre>
              </div>
            )}

            {state.kind === "loaded" && (
              <>
                <Sidebar
                  /* FIX-NameOverlay: use the overlay so pending name
                 edits show in the sidebar tree before Save. */
                  data={displayData ?? state.data}
                  selection={activeTab(tabs).target}
                  onSelect={openTarget}
                  onDuplicateBdb={handleRequestDuplicateBdb}
                  onCreatePfbbChild={handleRequestCreatePfbbChild}
                  onNewControlPlan={handleRequestNewControlPlan}
                  onDeleteControlPlan={handleRequestDeleteControlPlan}
                  onMoveControlPlan={handleRequestMoveControlPlan}
                  onMoveWorkSpecToContract={handleRequestMoveWorkSpec}
                  onDeleteWorkSpec={handleRequestDeleteWorkSpec}
                  onDeleteBdb={handleRequestDeleteBdb}
                  onRequestEditWorkSpec={handleRequestEditWorkSpec}
                  onRequestEditBdb={handleRequestEditBdb}
                  onFillFromStandard={(wsId) => setFillFromStandardWsId(wsId)}
                  fillFromStandardEligible={fillFromStandardEligible}
                  onManageAttachments={handleRequestManageAttachments}
                  onRequestOpenAttachment={(id) =>
                    void handleRequestOpenAttachment(id)
                  }
                  onRequestRenameAttachment={handleRequestRenameAttachment}
                  onRequestDeleteAttachment={handleRequestDeleteAttachment}
                  onRequestMoveAttachment={handleRequestMoveAttachment}
                  onRequestEditCp={handleRequestEditCp}
                  effectiveContractCodeFor={(id, orig) =>
                    getEffectiveContractCode(edits, id, orig)
                  }
                  effectiveContractNameFor={(id, orig) =>
                    getEffectiveContractName(edits, id, orig)
                  }
                  effectiveWorkSpecContractFor={(wid, orig) =>
                    getEffectiveWorkSpecContract(edits, wid, orig)
                  }
                  isContractPendingDelete={(id) =>
                    isPendingDelete(edits, "contract", id)
                  }
                  isVirtualWorkSpec={(id) => {
                    const ws = findWorkSpecById(state.data, id);
                    return ws != null && isVirtualWorkSpecInfo(ws);
                  }}
                  isWorkSpecPendingDelete={(id) => {
                    if (isPendingDelete(edits, "workSpec", id)) return true;
                    const ws = findWorkSpecById(state.data, id);
                    if (!ws) return false;
                    const effContract = getEffectiveWorkSpecContract(
                      edits,
                      ws.id,
                      ws.contractId,
                    );
                    return (
                      effContract !== null &&
                      isPendingDelete(edits, "contract", effContract)
                    );
                  }}
                  isBdbPendingDelete={(id) => {
                    if (isPendingDelete(edits, "bdb", id)) return true;
                    const b = findBdbById(state.data, id);
                    if (!b || b.workSpecId == null) return false;
                    if (isPendingDelete(edits, "workSpec", b.workSpecId))
                      return true;
                    const ws = state.data.workSpecs.find(
                      (w) => w.id === b.workSpecId,
                    );
                    if (!ws) return false;
                    const effContract = getEffectiveWorkSpecContract(
                      edits,
                      ws.id,
                      ws.contractId,
                    );
                    return (
                      effContract !== null &&
                      isPendingDelete(edits, "contract", effContract)
                    );
                  }}
                  isControlPlanPendingDelete={(cpId) => {
                    // FIX-DelCpStrike 2026-05-11. Direct CP delete patch OR
                    // the parent BDB carries a delete patch with
                    // `deleteControlPlans: true`. WA / contract cascades
                    // don't propagate to CPs (those CPs survive as
                    // unlinked plans).
                    if (isPendingDelete(edits, "controlPlan", cpId))
                      return true;
                    const parent = state.data.bdbs.find((b) =>
                      b.controlPlanIds.includes(cpId),
                    );
                    if (!parent) return false;
                    return bdbDeleteIncludesCps(edits, parent.id);
                  }}
                  onRestoreContract={(id) =>
                    handleRestoreDelete("contract", id)
                  }
                  onRestoreWorkSpec={(id) =>
                    handleRestoreDelete("workSpec", id)
                  }
                  onRestoreBdb={(id) => handleRestoreDelete("bdb", id)}
                  onRestoreControlPlan={(id) =>
                    handleRestoreDelete("controlPlan", id)
                  }
                  collapsed={sidebarCollapsed}
                  onToggleCollapsed={() =>
                    setSidebarPrefs((s) =>
                      handleSidebarToggle(s, activeTabKind),
                    )
                  }
                />
                <main className="main-pane">
                  {pfbbOrphanState ? (
                    <>
                      <PfbbMigrationBanner
                        orphanCount={pfbbOrphanState.orphanBdbIds.length}
                        sourceWorkAreaNames={
                          pfbbOrphanState.sourceWorkAreaNames
                        }
                        onMigrate={() => {
                          void confirmMigrateOrphanPfbbMasters();
                        }}
                        onDismiss={dismissPfbbMigrationBanner}
                        isMigrating={pfbbOrphanState.migrating}
                      />
                      {pfbbOrphanState.error ? (
                        <div
                          className="pfbb-migration-banner__error"
                          role="alert"
                        >
                          {pfbbOrphanState.error}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <MainPane
                    data={dataForMainPane ?? state.data}
                    target={activeTab(tabs).target}
                    onFillFromStandard={(wsId) => setFillFromStandardWsId(wsId)}
                    fillFromStandardEligible={fillFromStandardEligible}
                    tocFilter={activeTabUi.filter}
                    onTocFilterChange={(q) => patchActiveTabUi({ filter: q })}
                    tocCollapsedNodeIds={activeTabUi.collapsedNodeIds}
                    onTocCollapsedNodeIdsChange={(next) =>
                      patchActiveTabUi({ collapsedNodeIds: next })
                    }
                    refSubTab={activeTabUi.refSubTab}
                    onRefSubTabChange={(t) =>
                      patchActiveTabUi({ refSubTab: t })
                    }
                    refPanelCollapsed={activeTabUi.refPanelCollapsed}
                    onToggleRefPanelCollapsed={toggleRefPanelCollapsed}
                    compactView={compactView}
                    layoutMode={layoutMode}
                    editedBodyFor={editedBodyFor}
                    onEditBody={onEditBody}
                    pfbbSupplementFor={pfbbSupplementFor}
                    onPfbbSupplementBodyChange={onPfbbSupplementBodyChange}
                    editedCpTitleFor={editedCpTitleFor}
                    onEditCpTitle={onEditCpTitle}
                    editedCpHeaderFor={editedCpHeaderFor}
                    onEditCpHeader={onEditCpHeader}
                    editedCpRowCellFor={editedCpRowCellFor}
                    onEditCpRowCell={onEditCpRowCell}
                    onRequestAddRow={handleRequestAddRow}
                    onRequestAddHeader={handleRequestAddHeader}
                    onRequestDeleteRow={handleRequestDeleteRow}
                    effectiveContractCodeFor={(id, orig) =>
                      getEffectiveContractCode(edits, id, orig)
                    }
                    effectiveContractNameFor={(id, orig) =>
                      getEffectiveContractName(edits, id, orig)
                    }
                    isContractEditedFor={(id) => isContractEdited(edits, id)}
                    // Phase 8 round 2 — Reader mode: every edit-trigger
                    // handler below is replaced with a no-op (or
                    // undefined for optional props) so the modal-opening
                    // flows can't fire. Buttons + menu items are still
                    // clickable; the user gets the banner cue to explain
                    // why nothing happens. View actions (open
                    // attachment, show global, select) stay live.
                    onRequestNewContract={
                      readerMode ? () => {} : handleRequestNewContract
                    }
                    onSeedDefaultContracts={
                      readerMode ? () => {} : handleSeedDefaultContracts
                    }
                    onRequestEditContract={
                      readerMode ? () => {} : handleRequestEditContract
                    }
                    onRequestDeleteContract={
                      readerMode ? () => {} : handleRequestDeleteContract
                    }
                    effectiveProjectField={(field, orig) =>
                      getEffectiveProjectField(edits, field, orig)
                    }
                    isProjectEdited={isProjectEdited(edits)}
                    onRequestEditProject={
                      readerMode ? undefined : handleRequestEditProject
                    }
                    selection={activeTab(tabs).target}
                    onSelect={openTarget}
                    onDuplicateBdb={
                      readerMode ? undefined : handleRequestDuplicateBdb
                    }
                    onCreatePfbbChild={
                      readerMode ? undefined : handleRequestCreatePfbbChild
                    }
                    onNewControlPlan={
                      readerMode ? undefined : handleRequestNewControlPlan
                    }
                    onDeleteControlPlan={
                      readerMode ? undefined : handleRequestDeleteControlPlan
                    }
                    onMoveControlPlan={
                      readerMode ? undefined : handleRequestMoveControlPlan
                    }
                    onMoveWorkSpecToContract={
                      readerMode ? undefined : handleRequestMoveWorkSpec
                    }
                    onDeleteWorkSpec={
                      readerMode ? undefined : handleRequestDeleteWorkSpec
                    }
                    onDeleteBdb={
                      readerMode ? undefined : handleRequestDeleteBdb
                    }
                    onRequestEditWorkSpec={
                      readerMode ? undefined : handleRequestEditWorkSpec
                    }
                    onRequestEditBdb={
                      readerMode ? undefined : handleRequestEditBdb
                    }
                    onManageAttachments={
                      readerMode ? undefined : handleRequestManageAttachments
                    }
                    onShowGlobalAttachments={handleShowGlobalAttachments}
                    onRequestOpenAttachment={(id) =>
                      void handleRequestOpenAttachment(id)
                    }
                    onRequestRenameAttachment={
                      readerMode ? undefined : handleRequestRenameAttachment
                    }
                    onRequestDeleteAttachment={
                      readerMode ? undefined : handleRequestDeleteAttachment
                    }
                    onRequestMoveAttachment={
                      readerMode ? undefined : handleRequestMoveAttachment
                    }
                    onRequestEditCp={
                      readerMode ? undefined : handleRequestEditCp
                    }
                    effectiveWorkSpecContractFor={(wid, orig) =>
                      getEffectiveWorkSpecContract(edits, wid, orig)
                    }
                    isContractPendingDelete={(id) =>
                      isPendingDelete(edits, "contract", id)
                    }
                    isVirtualWorkSpec={(id) => {
                      const ws = findWorkSpecById(state.data, id);
                      return ws != null && isVirtualWorkSpecInfo(ws);
                    }}
                    isWorkSpecPendingDelete={(id) => {
                      if (isPendingDelete(edits, "workSpec", id)) return true;
                      const ws = findWorkSpecById(state.data, id);
                      if (!ws) return false;
                      const effContract = getEffectiveWorkSpecContract(
                        edits,
                        ws.id,
                        ws.contractId,
                      );
                      return (
                        effContract !== null &&
                        isPendingDelete(edits, "contract", effContract)
                      );
                    }}
                    isBdbPendingDelete={(id) => {
                      if (isPendingDelete(edits, "bdb", id)) return true;
                      const b = findBdbById(state.data, id);
                      if (!b || b.workSpecId == null) return false;
                      if (isPendingDelete(edits, "workSpec", b.workSpecId))
                        return true;
                      const ws = state.data.workSpecs.find(
                        (w) => w.id === b.workSpecId,
                      );
                      if (!ws) return false;
                      const effContract = getEffectiveWorkSpecContract(
                        edits,
                        ws.id,
                        ws.contractId,
                      );
                      return (
                        effContract !== null &&
                        isPendingDelete(edits, "contract", effContract)
                      );
                    }}
                    isControlPlanPendingDelete={(cpId) => {
                      if (isPendingDelete(edits, "controlPlan", cpId))
                        return true;
                      const parent = state.data.bdbs.find((b) =>
                        b.controlPlanIds.includes(cpId),
                      );
                      if (!parent) return false;
                      return bdbDeleteIncludesCps(edits, parent.id);
                    }}
                    onRestoreContract={(id) =>
                      handleRestoreDelete("contract", id)
                    }
                    onRestoreWorkSpec={(id) =>
                      handleRestoreDelete("workSpec", id)
                    }
                    onRestoreBdb={(id) => handleRestoreDelete("bdb", id)}
                    onRestoreControlPlan={(id) =>
                      handleRestoreDelete("controlPlan", id)
                    }
                    isPendingDelete={activeTabPendingDelete !== null}
                    pendingDeleteRestoreLabel={activeTabPendingDelete?.label}
                    onRestorePendingDelete={activeTabPendingDelete?.restore}
                    onOpenExport={exportController.open}
                    onDeletePfbbBrokenSupplement={onDeletePfbbBrokenSupplement}
                    onSectionContextMenu={onSectionContextMenu}
                    highlightsView={
                      state.kind === "loaded" ? (
                        <HighlightsView
                          highlights={findHighlights(state.data)}
                          describeLocation={(loc) =>
                            describeHighlightLocation(loc, state.data)
                          }
                          resolveSection={(loc) =>
                            resolveHighlightSection(loc, state.data)
                          }
                          onJumpTo={(h) => jumpToHighlight(h)}
                        />
                      ) : null
                    }
                    revisionsView={null}
                    referenceFile={referenceFile}
                    versionRevisions={versionRevisions}
                  />
                </main>
              </>
            )}
          </div>

          {isDraggingOver && (
            <div className="drop-overlay" aria-hidden="true">
              <div className="drop-overlay__panel">
                <div className="drop-overlay__icon">↓</div>
                <div className="drop-overlay__message">
                  {t("drop.overlay.message")}
                </div>
                <div className="drop-overlay__hint">
                  {t("drop.overlay.hint")}
                </div>
              </div>
            </div>
          )}

          {pendingDrop && (
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-drop-title"
            >
              <div className="modal">
                <h2 id="confirm-drop-title" className="modal__title">
                  {t("drop.confirm.title")}
                </h2>
                <p className="modal__body">
                  {t("drop.confirm.body", { name: pendingDrop.name })}
                </p>
                <div className="modal__actions">
                  <button
                    type="button"
                    className="modal__button"
                    onClick={cancelPendingDrop}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="modal__button modal__button--primary"
                    onClick={confirmPendingDrop}
                    autoFocus
                  >
                    {t("common.open")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {exportController.modalElement}

          {/* Slice 10G — section hierarchy UI. Owns its own state + the
           * 4 modals (Add subsection / Add sibling at end / Rename /
           * Delete cascade with PFBB warning). App.tsx forwards the
           * TOC right-click via the ref. */}
          {state.kind === "loaded" && (
            <SectionMenuController
              ref={sectionMenuRef}
              data={state.data}
              compactView={compactView}
              setCompactView={setCompactView}
              setEdits={setEdits}
            />
          )}

          {pendingConflict && state.kind === "loaded" && (
            <ConflictModal
              filename={basename(state.data.path)}
              onCancel={() => setPendingConflict(null)}
              onReload={() => {
                // Reload in place — keep tabs / scroll, just like the
                // File-menu reload. reloadFromDisk also clears the
                // conflict flag; we close the modal up-front too.
                setPendingConflict(null);
                void reloadFromDisk();
              }}
              onOverwrite={() => {
                setPendingConflict(null);
                void save({ force: true });
              }}
              onMerge={
                reloadMerge.canMerge ? handleMergeFromConflict : undefined
              }
            />
          )}

          {/* RELOAD-3 — discard-confirm before reloading from disk. Only
          shown when the editor has unsaved edits; a clean reload
          skips straight through. */}
          {reloadConfirmOpen && state.kind === "loaded" && (
            <ReloadConfirmModal
              onCancel={cancelReload}
              onConfirm={confirmReload}
              onMerge={reloadMerge.canMerge ? handleMergeFromReload : undefined}
            />
          )}

          {/* Task 1 / M1 — the file we opened was in a pre-01.00.03
          format and has been upgraded in memory. Must be clicked away:
          it tells the user their document changed, that saving writes a
          new file, and (for 01.00.00) what did not survive. */}
          {schemaUpgradeNotice && (
            <SchemaUpgradeModal
              info={schemaUpgradeNotice}
              onClose={() => setSchemaUpgradeNotice(null)}
            />
          )}

          {/* RELOAD-Merge — the 3-way merge dialog. */}
          {reloadMerge.mergeDialog && (
            <ReloadMergeModal
              autoApplied={reloadMerge.mergeDialog.autoApplied}
              conflicts={reloadMerge.mergeDialog.conflicts}
              diskDelta={reloadMerge.mergeDialog.diskDelta}
              onCancel={reloadMerge.cancelMerge}
              onApply={reloadMerge.confirmMerge}
            />
          )}

          {saveError && (
            <div className="drop-error" role="alert">
              <span className="drop-error__message">
                {t("save.error.prefix", { message: saveError })}
              </span>
              <button
                type="button"
                className="drop-error__dismiss"
                onClick={() => setSaveError(null)}
                aria-label={t("common.dismissError")}
              >
                ×
              </button>
            </div>
          )}

          {duplicateBdbDialog && state.kind === "loaded" && (
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="duplicate-bdb-title"
            >
              <div className="modal">
                <h2 id="duplicate-bdb-title" className="modal__title">
                  {t("modal.duplicateBdb.title")}
                </h2>
                <p className="modal__body">
                  {t("modal.duplicateBdb.body", {
                    name: duplicateBdbDialog.bdb.name,
                  })}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmDuplicateBdb();
                  }}
                >
                  <label className="modal__field">
                    <span className="modal__field-label">
                      {t("modal.duplicateBdb.nameLabel")}
                    </span>
                    <input
                      type="text"
                      className="modal__input"
                      value={duplicateBdbDialog.name}
                      onChange={(e) =>
                        duplicateBdbController.setName(e.target.value)
                      }
                      autoFocus
                      // Select all so the user can just type to replace.
                      onFocus={(e) => e.currentTarget.select()}
                      disabled={duplicateBdbDialog.saving}
                      required
                    />
                  </label>
                  <label className="modal__field modal__field--checkbox">
                    <input
                      type="checkbox"
                      checked={duplicateBdbDialog.includeControlPlans}
                      onChange={(e) =>
                        duplicateBdbController.setIncludeControlPlans(
                          e.target.checked,
                        )
                      }
                      disabled={duplicateBdbDialog.saving}
                    />
                    <span className="modal__field-label">
                      {t("modal.duplicateBdb.includeCps.label")}
                    </span>
                  </label>
                  {duplicateBdbDialog.error && (
                    <div
                      className="modal__error"
                      role="alert"
                      aria-live="polite"
                    >
                      {duplicateBdbDialog.error.kind === "dirty" &&
                        t("errors.dirty.full")}
                      {duplicateBdbDialog.error.kind === "conflict" &&
                        t("errors.conflict.full")}
                      {duplicateBdbDialog.error.kind === "missing" &&
                        t("modal.duplicateBdb.error.missing")}
                      {duplicateBdbDialog.error.kind === "other" &&
                        t("modal.duplicateBdb.error.other", {
                          message: duplicateBdbDialog.error.message,
                        })}
                    </div>
                  )}
                  <div className="modal__actions">
                    <button
                      type="button"
                      className="modal__button"
                      onClick={cancelDuplicateBdb}
                      disabled={duplicateBdbDialog.saving}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      className="modal__button modal__button--primary"
                      disabled={
                        duplicateBdbDialog.saving ||
                        duplicateBdbDialog.name.trim().length === 0 ||
                        duplicateBdbDialog.error?.kind === "dirty" ||
                        duplicateBdbDialog.error?.kind === "missing"
                      }
                    >
                      {duplicateBdbDialog.saving
                        ? t("modal.duplicateBdb.confirmingButton")
                        : t("modal.duplicateBdb.confirmButton")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {createPfbbChildDialog &&
            state.kind === "loaded" &&
            (() => {
              /*
               * Slice 10H.5 — Create PFBB child modal.
               *
               * UX: two dependent dropdowns (contract → work area) + a name
               * field. "Contract" is derived entirely from the selected work
               * area; we keep the user in control by showing work areas
               * grouped under their contracts in one select, rather than
               * forcing two picks when the contract is just a grouping.
               *
               * Exclusions:
               *   - the master's own work-spec (a child in the same ws would
               *     collide with the master in "siblings under one work area");
               *   - work-specs pending delete (won't exist after save).
               */
              const masterWsId = createPfbbChildDialog.master.workSpecId;
              // Build (contract label, work-specs[]) tuples, sorted the same
              // way as the Contracts card — code then name, Danish collator.
              const workSpecsByContract = new Map<
                number | null,
                WorkSpecInfo[]
              >();
              for (const ws of state.data.workSpecs) {
                if (ws.id === masterWsId) continue;
                if (isPendingDelete(edits, "workSpec", ws.id)) continue;
                const effContract = getEffectiveWorkSpecContract(
                  edits,
                  ws.id,
                  ws.contractId,
                );
                const list = workSpecsByContract.get(effContract) ?? [];
                list.push(ws);
                workSpecsByContract.set(effContract, list);
              }
              // Sort each list by work-area code+name.
              for (const list of workSpecsByContract.values()) {
                list.sort((a, b) =>
                  compareCodeThenName(
                    a.workAreaCode,
                    a.workAreaName,
                    b.workAreaCode,
                    b.workAreaName,
                  ),
                );
              }
              // Contracts sorted the same way; "[No contract]" group last.
              const contractOrder = [...state.data.contracts]
                .filter((c) => !isPendingDelete(edits, "contract", c.id))
                .sort((a, b) =>
                  compareCodeThenName(
                    a.contractCode,
                    a.contractName,
                    b.contractCode,
                    b.contractName,
                  ),
                );

              return (
                <div
                  className="modal-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="create-pfbb-child-title"
                >
                  <div className="modal">
                    <h2 id="create-pfbb-child-title" className="modal__title">
                      {t("modal.createPfbbChild.title")}
                    </h2>
                    <p className="modal__body">
                      {t("modal.createPfbbChild.body", {
                        name: createPfbbChildDialog.master.name,
                      })}
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void confirmCreatePfbbChild();
                      }}
                    >
                      <label className="modal__field">
                        <span className="modal__field-label">
                          {t("modal.createPfbbChild.targetLabel")}
                        </span>
                        <select
                          className="modal__input"
                          value={createPfbbChildDialog.targetWorkSpecId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            createPfbbChildController.setTargetWorkSpecId(
                              v === "" ? null : Number(v),
                            );
                          }}
                          disabled={createPfbbChildDialog.saving}
                          required
                        >
                          <option value="" disabled>
                            {t("modal.createPfbbChild.targetPlaceholder")}
                          </option>
                          {contractOrder.map((c) => {
                            const list = workSpecsByContract.get(c.id) ?? [];
                            if (list.length === 0) return null;
                            const label =
                              (c.contractCode ? c.contractCode + " - " : "") +
                              (c.contractName ??
                                t("modal.createPfbbChild.unnamedContract"));
                            return (
                              <optgroup key={c.id} label={label}>
                                {list.map((ws) => (
                                  <option key={ws.id} value={ws.id}>
                                    {(ws.workAreaCode
                                      ? ws.workAreaCode + " - "
                                      : "") + ws.workAreaName}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                          {(() => {
                            const list = workSpecsByContract.get(null) ?? [];
                            if (list.length === 0) return null;
                            return (
                              <optgroup
                                label={t(
                                  "modal.createPfbbChild.noContractGroup",
                                )}
                              >
                                {list.map((ws) => (
                                  <option key={ws.id} value={ws.id}>
                                    {(ws.workAreaCode
                                      ? ws.workAreaCode + " - "
                                      : "") + ws.workAreaName}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })()}
                        </select>
                      </label>
                      <label className="modal__field">
                        <span className="modal__field-label">
                          {t("modal.createPfbbChild.nameLabel")}
                        </span>
                        <input
                          type="text"
                          className="modal__input"
                          value={createPfbbChildDialog.name}
                          onChange={(e) =>
                            createPfbbChildController.setName(e.target.value)
                          }
                          onFocus={(e) => e.currentTarget.select()}
                          disabled={createPfbbChildDialog.saving}
                          required
                        />
                      </label>
                      {createPfbbChildDialog.error && (
                        <div
                          className="modal__error"
                          role="alert"
                          aria-live="polite"
                        >
                          {createPfbbChildDialog.error.kind === "dirty" &&
                            t("errors.dirty.full")}
                          {createPfbbChildDialog.error.kind === "conflict" &&
                            t("errors.conflict.full")}
                          {createPfbbChildDialog.error.kind === "missing" &&
                            t("modal.createPfbbChild.error.missing")}
                          {createPfbbChildDialog.error.kind === "other" &&
                            t("modal.createPfbbChild.error.other", {
                              message: createPfbbChildDialog.error.message,
                            })}
                        </div>
                      )}
                      <div className="modal__actions">
                        <button
                          type="button"
                          className="modal__button"
                          onClick={cancelCreatePfbbChild}
                          disabled={createPfbbChildDialog.saving}
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="submit"
                          className="modal__button modal__button--primary"
                          disabled={
                            createPfbbChildDialog.saving ||
                            createPfbbChildDialog.targetWorkSpecId == null ||
                            createPfbbChildDialog.name.trim().length === 0 ||
                            createPfbbChildDialog.error?.kind === "dirty" ||
                            createPfbbChildDialog.error?.kind === "missing"
                          }
                        >
                          {createPfbbChildDialog.saving
                            ? t("modal.createPfbbChild.confirmingButton")
                            : t("modal.createPfbbChild.confirmButton")}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              );
            })()}

          {newCpDialog && state.kind === "loaded" && (
            <NewCpModal
              dialog={newCpDialog}
              allControlPlans={state.data.controlPlans}
              onCancel={cancelNewCp}
              onConfirm={() => void confirmNewCp()}
              onChangeTitle={(title) => newCpController.setTitle(title)}
              onChangeSlot={(slot) => newCpController.setSlot(slot)}
              onChangeMode={(mode) => newCpController.setMode(mode)}
              onChangeSource={(sourceCpId) =>
                newCpController.setSource(sourceCpId)
              }
            />
          )}

          {deleteCpDialog && state.kind === "loaded" && (
            <DeleteCpModal
              dialog={deleteCpDialog}
              onCancel={cancelDeleteCp}
              onConfirm={confirmDeleteCp}
            />
          )}

          {deleteWorkSpecDialog && state.kind === "loaded" && (
            <DeleteTargetModal
              kind="workArea"
              label={
                deleteWorkSpecDialog.workSpec.workAreaCode
                  ? `${deleteWorkSpecDialog.workSpec.workAreaCode} — ${deleteWorkSpecDialog.workSpec.workAreaName}`
                  : deleteWorkSpecDialog.workSpec.workAreaName
              }
              impact={deleteWorkSpecDialog.impact}
              saving={deleteWorkSpecDialog.saving}
              error={deleteWorkSpecDialog.error}
              onCancel={cancelDeleteWorkSpec}
              onConfirm={() => void confirmDeleteWorkSpec()}
            />
          )}

          {deleteBdbDialog && state.kind === "loaded" && (
            <DeleteTargetModal
              kind="bdb"
              label={deleteBdbDialog.bdb.name || "(untitled)"}
              impact={deleteBdbDialog.impact}
              saving={deleteBdbDialog.saving}
              error={deleteBdbDialog.error}
              pfbbChildCount={deleteBdbDialog.pfbbChildCount}
              deleteControlPlans={deleteBdbDialog.deleteControlPlans}
              onToggleDeleteControlPlans={
                deleteBdbController.setDeleteControlPlans
              }
              onCancel={cancelDeleteBdb}
              onConfirm={() => void confirmDeleteBdb()}
            />
          )}

          {deleteRowDialog && state.kind === "loaded" && (
            <DeleteRowModal
              dialog={deleteRowDialog}
              onCancel={cancelDeleteRow}
              onConfirm={() => void confirmDeleteRow()}
            />
          )}

          {newContractDialog && state.kind === "loaded" && (
            <NewContractModal
              dialog={newContractDialog}
              onCancel={cancelNewContract}
              onConfirm={() => void confirmNewContract()}
              onChangeCode={(code) => newContractController.setCode(code)}
              onChangeName={(name) => newContractController.setName(name)}
            />
          )}

          {editContractDialog && state.kind === "loaded" && (
            <EditContractModal
              dialog={editContractDialog}
              onCancel={cancelEditContract}
              onConfirm={confirmEditContract}
              onChangeCode={(code) => editContractController.setCode(code)}
              onChangeName={(name) => editContractController.setName(name)}
            />
          )}

          {editProjectDialog && state.kind === "loaded" && (
            <EditProjectModal
              dialog={editProjectDialog}
              customData={effectiveCustomData}
              onSetCustomData={onSetCustomData}
              onDeleteCustomData={onDeleteCustomData}
              onClearCustomDataPending={onClearCustomDataPending}
              onCancel={cancelEditProject}
              onConfirm={confirmEditProject}
              onChangeName={(name) => editProjectController.patch({ name })}
              onChangeProjectNumber={(projectNumber) =>
                editProjectController.patch({ projectNumber })
              }
              onChangeBuilder={(builder) =>
                editProjectController.patch({ builder })
              }
              onChangeMolioReferencelistDate={(molioReferencelistDate) =>
                editProjectController.patch({ molioReferencelistDate })
              }
            />
          )}

          {editWorkSpecDialog && state.kind === "loaded" && (
            <EditWorkSpecModal
              dialog={editWorkSpecDialog}
              onCancel={cancelEditWorkSpec}
              onConfirm={confirmEditWorkSpec}
              onChangeField={(field, value) => {
                if (field === "workAreaType") {
                  const parsed = Number.parseInt(value, 10);
                  if (Number.isFinite(parsed)) {
                    editWorkSpecController.patch({ workAreaType: parsed });
                  }
                  return;
                }
                editWorkSpecController.patch({ [field]: value });
              }}
            />
          )}

          {editBdbDialog && state.kind === "loaded" && (
            <EditBdbModal
              dialog={editBdbDialog}
              onCancel={cancelEditBdb}
              onConfirm={confirmEditBdb}
              onChangeField={(field, value) =>
                editBdbController.patch({ [field]: value })
              }
              onToggleIsPfbb={(value) =>
                editBdbController.patch({ isPfbb: value })
              }
            />
          )}

          {editCpDialog && state.kind === "loaded" && (
            <EditCpModal
              dialog={editCpDialog}
              onCancel={cancelEditCp}
              onConfirm={confirmEditCp}
              onChangeField={(field, value) =>
                editCpController.patch({ [field]: value })
              }
            />
          )}

          {attachmentsDialog && state.kind === "loaded" && (
            <AttachmentsModal
              dialog={attachmentsDialog}
              rows={state.data.attachments.filter(
                (a) => a.workSpecId === attachmentsDialog.workSpecId,
              )}
              onCancel={cancelAttachments}
              onPickFile={(file) => setAttachmentsPendingFile(file)}
              onChangeType={(t) => setAttachmentsPendingType(t)}
              onConfirmAdd={() => void confirmAddAttachment()}
              onDelete={(id) => void confirmDeleteAttachment(id)}
              onReplace={(id, file) => void confirmReplaceAttachment(id, file)}
            />
          )}

          {globalAttachmentsDialog && state.kind === "loaded" && (
            <GlobalAttachmentsModal
              dialog={globalAttachmentsDialog}
              rows={state.data.attachments}
              workSpecs={state.data.workSpecs}
              contracts={state.data.contracts}
              effectiveContractCodeFor={(id, orig) =>
                getEffectiveContractCode(edits, id, orig)
              }
              effectiveContractNameFor={(id, orig) =>
                getEffectiveContractName(edits, id, orig)
              }
              effectiveWorkSpecContractFor={(wid, orig) =>
                getEffectiveWorkSpecContract(edits, wid, orig)
              }
              onCancel={cancelGlobalAttachments}
              onDelete={(id) => void confirmDeleteAttachmentGlobal(id)}
              onGoToWorkSpec={(wsId) => handleGoToWorkSpecFromGlobal(wsId)}
              onMove={(id) => handleRequestMoveAttachment(id)}
            />
          )}

          {renameAttachmentDialog && state.kind === "loaded" && (
            <RenameAttachmentModal
              dialog={renameAttachmentDialog}
              onCancel={cancelRenameAttachment}
              onConfirm={() => void confirmRenameAttachment()}
              onChangeName={(name) => renameAttachmentController.setName(name)}
            />
          )}

          {deleteAttachmentDialog && state.kind === "loaded" && (
            <ConfirmDeleteAttachmentModal
              dialog={deleteAttachmentDialog}
              onCancel={cancelDeleteAttachment}
              onConfirm={() => void confirmDeleteAttachmentSidebar()}
            />
          )}

          {moveAttachmentDialog && state.kind === "loaded" && (
            <MoveAttachmentModal
              dialog={moveAttachmentDialog}
              allWorkSpecs={state.data.workSpecs}
              allContracts={state.data.contracts}
              onCancel={cancelMoveAttachment}
              onConfirm={() => void confirmMoveAttachment()}
              onChangeFilter={(filter) =>
                moveAttachmentController.setFilter(filter)
              }
              onChangeTarget={(id) => moveAttachmentController.setTarget(id)}
            />
          )}

          {deleteContractDialog && state.kind === "loaded" && (
            <DeleteContractModal
              dialog={deleteContractDialog}
              allContracts={state.data.contracts}
              workSpecs={state.data.workSpecs}
              onCancel={cancelDeleteContract}
              onConfirm={() => void confirmDeleteContract()}
              onConfirmReassign={() => void confirmReassignAndDelete()}
              onChangeTarget={(id) => deleteContractController.setTarget(id)}
            />
          )}

          {moveWorkSpecDialog && state.kind === "loaded" && (
            <MoveWorkSpecModal
              dialog={moveWorkSpecDialog}
              allContracts={state.data.contracts}
              onCancel={cancelMoveWorkSpec}
              onConfirm={confirmMoveWorkSpec}
              onChangeFilter={(filter) =>
                moveWorkSpecController.setFilter(filter)
              }
              onChangeTarget={(id) => moveWorkSpecController.setTarget(id)}
            />
          )}

          {moveCpDialog && state.kind === "loaded" && (
            <MoveControlPlanModal
              dialog={moveCpDialog}
              allBdbs={state.data.bdbs}
              allWorkSpecs={state.data.workSpecs}
              allContracts={state.data.contracts}
              onCancel={cancelMoveCp}
              onConfirm={() => void confirmMoveCp()}
              onChangeFilter={(filter) => moveCpController.setFilter(filter)}
              onChangeTarget={(id) => moveCpController.setTarget(id)}
            />
          )}

          {/* IMP-API — unified source picker. Mounted only when the
           *  user clicked the Import icon AND no existing import is
           *  in flight; once a source is picked we hand off to the
           *  legacy ImportModal below. */}
          {importSourceOpen && !importDialog && state.kind === "loaded" && (
            <ImportSourceModal
              onPickPaths={handleImportSourcePicked}
              onClose={() => setImportSourceOpen(false)}
            />
          )}

          {/* SPLIT-Merge (#248) — fill an empty arbejdsbeskrivelse from a
           *  Molio standard or local moliospec. Mounted when the user
           *  clicks "Indlæs fra standardbeskrivelse" in SpecView's empty
           *  state, OR (later) from a sidebar context menu. */}
          {fillFromStandardWsId != null &&
            state.kind === "loaded" &&
            (() => {
              const ws = state.data.workSpecs.find(
                (w) => w.id === fillFromStandardWsId,
              );
              if (!ws) {
                // Race — target work area is gone (e.g. user deleted it
                // in another window). Drop the modal silently.
                setFillFromStandardWsId(null);
                return null;
              }
              const label = ws.workAreaCode
                ? `${ws.workAreaCode} ${ws.workAreaName}`
                : ws.workAreaName;
              return (
                <FillFromStandardModal
                  targetWorkSpecId={fillFromStandardWsId}
                  targetLabel={label}
                  targetPath={state.data.path}
                  storedMtimeMs={baselineMtimeMs ?? 0}
                  onSuccess={(_mtimeMs, _sectionsCopied) => {
                    setFillFromStandardWsId(null);
                    // Re-read the file so the new sections appear in the
                    // current tab and elsewhere. The fillEmptyWorkSpec
                    // handler already wrote + saveAs'd the target, so
                    // reloadFromDisk picks up the new content. UI is
                    // clean (no buffered edits) by construction — the
                    // user can't have unsaved edits to a work area
                    // that was empty 200ms ago.
                    void reloadFromDisk();
                  }}
                  onClose={() => setFillFromStandardWsId(null)}
                />
              );
            })()}

          {importDialog &&
            state.kind === "loaded" &&
            (() => {
              // Build the view object for the modal. Kept inline and derived
              // every render so the modal always reflects the latest state +
              // gates. The helpers (`canCheckImport`, `canImportGate`,
              // `indexCollisions`) are cheap — no memo needed.
              const collisionIndex = importDialog.precheck
                ? indexCollisions(importDialog.precheck)
                : null;
              const treeReady = importDialog.tree !== null;
              const canCheckNow = treeReady
                ? canCheckImport(importDialog.modalState, importDialog.tree!)
                : false;
              const canImportNow =
                treeReady && importDialog.precheck
                  ? canCheckNow &&
                    canImportGate(
                      importDialog.resolutions,
                      importDialog.precheck,
                    )
                  : false;
              const view: ImportDialogView = {
                sourcePath: importDialog.sourcePath,
                tree: importDialog.tree,
                modalState: importDialog.modalState,
                targetContracts: state.data.contracts,
                targetWorkAreas: state.data.workSpecs,
                collisionIndex,
                resolutions: importDialog.resolutions,
                busy: importDialog.busy,
                error: importDialog.error,
                canCheck: canCheckNow,
                canImport: canImportNow,
                successSummary: importDialog.successSummary,
              };
              return (
                <ImportModal
                  view={view}
                  onCancel={cancelImport}
                  onCheck={onImportCheck}
                  onImport={onImportApply}
                  onToggleWorkArea={onImportToggleWorkArea}
                  onToggleBdb={onImportToggleBdb}
                  onSetLandingContract={onImportSetLandingContract}
                  onSetLandingWorkArea={onImportSetLandingWorkArea}
                  onSetWorkAreaResolution={onImportSetWaResolution}
                  onSetBdbResolution={onImportSetBdbResolution}
                />
              );
            })()}

          {cpOpError && (
            <div className="drop-error" role="alert">
              <span className="drop-error__message">{cpOpError}</span>
              <button
                type="button"
                className="drop-error__dismiss"
                onClick={() => setCpOpError(null)}
                aria-label={t("common.dismissError")}
              >
                ×
              </button>
            </div>
          )}

          {settingsOpen && (
            <SettingsDialog
              onClose={() => {
                setSettingsOpen(false);
              }}
              readerMode={readerMode}
              onRequestToggleReaderMode={handleRequestToggleReaderMode}
            />
          )}
          {readerModeConfirmOpen && (
            <ReaderModeConfirmDialog
              onCancel={() => setReaderModeConfirmOpen(false)}
              onDiscard={() => {
                setEdits({});
                setReaderModeConfirmOpen(false);
                setReaderMode(true);
              }}
              onSave={() => {
                void (async () => {
                  await save({ force: false });
                  setReaderModeConfirmOpen(false);
                  setReaderMode(true);
                })();
              }}
            />
          )}

          {shortcutsOpen && (
            <ShortcutsCheatSheet onClose={() => setShortcutsOpen(false)} />
          )}

          {aboutOpen && (
            <AboutDialog
              info={appInfo}
              updater={appUpdater}
              onClose={() => setAboutOpen(false)}
            />
          )}

          {exportOptionsOpen && (
            <ExportOptionsModal
              hideMarkKinds={exportController.hideMarkKinds}
              setHideMarkKinds={exportController.setHideMarkKinds}
              onClose={() => setExportOptionsOpen(false)}
            />
          )}
        </div>
    </ReaderModeProvider>
  );
}

/**
 * Build the "Work area / BDB / Section" breadcrumb a HighlightsModal
 * row shows under its text snippet. Looks up names from the loaded
 * payload by id; hidden behind a helper because both the work-area
 * and BDB cases share the section formatting at the tail.
 */
/**
 * Slice "Version compare" — find a section's SQLite id inside the
 * current payload by (parent identity + section_no). Used by the
 * Revisions tab's click-to-jump to set the pendingScroll target.
 * Returns null if the parent or its section can't be found in
 * `current` (e.g. a `kind: "deleted"` revision — the section only
 * lives in the reference, not here).
 */
function findSectionIdInPayload(
  data: FilePayload,
  parent: { kind: "workSpec" | "bdb"; currentId: number | null },
  sectionPath: string,
): number | null {
  if (parent.currentId == null) return null;
  const sections =
    parent.kind === "workSpec"
      ? (data.sectionsByWorkSpec[parent.currentId] ?? [])
      : (data.sectionsByBdb[parent.currentId] ?? []);
  // Match by hierarchical path so we land on the right section even
  // when several siblings share the same local `sectionNo` under
  // different parents.
  const paths = computeSectionPaths(sections);
  for (const s of sections) {
    if (paths.get(s.id) === sectionPath) return s.id;
  }
  return null;
}

/**
 * Slice "Version compare" — build the breadcrumb for one revision
 * row. For section / CP-row revisions we use the parent path
 * already on the revision; for attachments we just print the
 * work-area label.
 */
function describeRevisionBreadcrumb(rev: Revision): string {
  if (
    rev.type === "section" ||
    rev.type === "cpRow" ||
    rev.type === "wholeSpec"
  ) {
    if (rev.parent.kind === "bdb" && rev.parent.workAreaLabel) {
      return `${rev.parent.workAreaLabel} / ${rev.parent.label}`;
    }
    return rev.parent.label;
  }
  // Attachment.
  return rev.workAreaLabel;
}

function describeHighlightLocation(
  loc: HighlightLocation,
  data: FilePayload,
): string {
  const sectionText = ` / ${loc.sectionNo}${loc.heading ? `  ${loc.heading}` : ""}`;
  if (loc.kind === "workSpec") {
    const ws = findWorkSpecById(data, loc.workSpecId);
    const name = ws?.workAreaName?.trim() || `#${loc.workSpecId}`;
    return `${name}${sectionText}`;
  }
  const bdb = findBdbById(data, loc.bdbId);
  const wa =
    bdb?.workSpecId != null ? findWorkSpecById(data, bdb.workSpecId) : null;
  const waLabel = wa?.workAreaName?.trim() || "—";
  const bdbLabel = bdb?.name?.trim() || `#${loc.bdbId}`;
  return `${waLabel} / ${bdbLabel}${sectionText}`;
}

/**
 * Look up the section's stored heading + body text for a highlight
 * location. Used by the Section preview modal — null when the data
 * has changed under us (the section was deleted in an unsaved edit
 * since the highlights list was computed).
 */
function resolveHighlightSection(
  loc: HighlightLocation,
  data: FilePayload,
): { heading: string; body: string; sectionNo: number } | null {
  const sections =
    loc.kind === "workSpec"
      ? (data.sectionsByWorkSpec[loc.workSpecId] ?? [])
      : (data.sectionsByBdb[loc.bdbId] ?? []);
  const found = sections.find((s) => s.id === loc.sectionId);
  if (!found) return null;
  return {
    heading: found.heading,
    body: found.body,
    sectionNo: found.sectionNo,
  };
}

/**
 * "New control plan…" modal. Split out so App.tsx's render stays readable
 * — it's five of these dialog blocks already.
 */

/**
 * Shared confirm modal for deleting a work area or a BDB (Slice 6J).
 *
 * The body spells out exactly what will cascade (pulled from the
 * `getDeleteImpact` pre-flight) so the user knows whether they're
 * about to lose 2 sections or 2,000. Attachments are ORPHANED (kept
 * in the file but detached) — we call that out explicitly to avoid
 * surprise when a user later wonders "where did my PDFs go?".
 * Control plans are never deleted by a cascade; they become
 * unlinked plans that still show up in the CP list.
 */

/**
 * Slice 10D — "Edit project" modal. Buffered (no saving state, no IPC);
 * Submit merges the four fields into the edit map, Cancel discards the
 * local draft. `name` and `projectNumber` are schema-required so we
 * block submit if either is empty — the modal guards that, and the
 * host's confirm handler also falls back to the original to be safe.
 *
 * `molioReferencelistDate` is a plain text input: the underlying
 * column is TEXT nullable, so the app doesn't enforce a date format
 * (many existing files store ISO-8601, but some use other formats).
 */

/**
 * Small re-usable accordion for read-only Molio-sourced metadata. The
 * work-area and BDB edit modals both hide these columns behind a "Show
 * locked metadata" toggle — they're important for power users (round-trip
 * debugging, traceability to the Molio registry) but noise for everyone
 * else, and they're never editable here.
 */

/**
 * EditWorkSpecModal — Slice 10E edit surface for work-area rows.
 *
 * Editable fields (10 total): work_area_code, work_area_name (required),
 * work_area_type (enum dropdown), revision, revision_date, issue_date,
 * created_by, created_by_organization, reviewed_by, approved_by.
 *
 * Locked fields (accordion): molio_spec_revision_no + _date — columns the
 * Molio registry owns.
 *
 * The dialog state is held by App.tsx; this component just renders +
 * calls back on every change. Same pattern as EditProjectModal so the
 * edit-map updates happen in one predictable place (confirmEditWorkSpec).
 */

/**
 * EditBdbModal — Slice 10E edit surface for construction-element-spec rows.
 *
 * Editable (9 text + 1 checkbox): name (required), isPfbb, revision,
 * revision_date, issue_date, created_by, created_by_organization,
 * reviewed_by, approved_by.
 *
 * Locked (accordion): Molio registry + control-plan-id columns.
 *
 * Note: `isPfbb` was originally scheduled for Slice 10H (PFBB surface)
 * but the user opted to pull the write forward into 10E during planning —
 * 10H is now read-only badges/tooltips only.
 */

/**
 * Modal for editing control-plan metadata (Slice 10F).
 *
 * Scope: title + revision + revision_date. The Molio `control_plan`
 * schema doesn't have reviewed_by/approved_by/issue_date columns the
 * way work_spec and construction_element_spec do, so this modal is
 * narrower than the Work-area / BDB modals on purpose.
 *
 * Title is required (NOT NULL in the schema). Revision + revision date
 * are both nullable — leave them blank to clear. Date placeholder
 * matches the YYYY-MM-DD convention used across the editor.
 */

/**
 * AttachmentsModal — Slice 10K: manage files attached to a work area.
 * (Molio 2.0: `attachment.work_spec_id` FK is to `work_spec(id)`, i.e.
 * the work area. Not to BDB.)
 *
 * Immediate-persistence: each add / delete / replace saves to disk and
 * reloads the file, so the dialog stays mounted but the row list comes
 * from the freshly-reloaded `FilePayload.attachments`. The host owns the
 * pending-file state (which file the `<input type="file">` picked +
 * which attachment type). Errors come from the shared CP-op error
 * surface plus a dialog-specific `too-large` variant.
 *
 * Deliberate omissions (deferred to 10L):
 *   - No preview / download of existing attachment bytes.
 *   - No per-attachment rename or mime override.
 *   - No drag-drop upload.
 */

/**
 * GlobalAttachmentsModal — Slice 10K.5: project-wide attachments overview.
 *
 * Read-only listing of every attachment in the project, showing the
 * parent work area + its contract so the user can see where each file
 * lives. Two actions per row:
 *
 *   - "Go to work area…" — closes this modal and opens the per-work-area
 *     AttachmentsModal (for Add / Replace / Delete in normal context).
 *   - "Delete" — immediate-persistence delete, same IPC path as the
 *     per-work-area delete. Refuses while there are unsaved edits.
 *
 * Orphaned attachments (workSpecId = null, or pointing at a work area
 * that no longer exists in the reload payload) are rendered with a
 * "(unlinked)" label and have no "Go to work area" action — only Delete.
 *
 * Molio 2.0 compliance: attachments FK to `work_spec(id)`, not BDB.
 */

/**
 * Delete confirm with fallback Reassign stage. Two render variants based
 * on `stage`:
 *
 *   - "confirm"   plain "Delete contract X?" — host calls deleteContract
 *                 when OK is clicked. If it comes back `referenced`,
 *                 host flips the dialog into "reassign" stage.
 *   - "reassign"  lists the referencing work areas + a target picker;
 *                 OK runs the chained save + retry IPC calls.
 */

/**
 * Sidebar right-click → "Move to contract…". Buffered edit.
 *
 * A filter input narrows the list — useful when there are many
 * contracts. The list always includes a "(no contract)" choice at the
 * top so the user can clear the assignment.
 */

/**
 * Sidebar right-click on a CP → "Move to specification…" (Slice 6O.4 — #112).
 *
 * Immediate-persistence: on OK we fire the `moveControlPlan` IPC and reload
 * the file. The target slot (design vs production) isn't a user decision —
 * core picks it from the CP's own `control_plan_type`. We surface that
 * implicitly by disabling BDBs whose matching slot is already filled by
 * some other CP (so the user can't even try a move that would be rejected),
 * and by showing a "Slot already filled" inline error if the server still
 * refuses.
 *
 * Layout: grouped by contract → work area → BDB (Tore's pick). We keep the
 * filter input the user already expects from MoveWorkSpecModal, but it now
 * filters across all three levels — typing a code collapses groups that
 * don't match. Homeless work areas / BDBs get "[No contract]" / "[No work
 * area]" labels consistent with the sidebar buckets.
 */

/**
 * Slice 10K.8 — Rename attachment dialog (sidebar right-click).
 *
 * A single-field text input. Cancel/OK buttons. OK is disabled while
 * saving or when the name is empty (whitespace-only counts as empty).
 * The no-op case (name equal to original) is handled by the caller —
 * we just submit and let them close without an IPC round-trip.
 */

/**
 * Slice 10K.8 — Confirm-delete attachment dialog (sidebar right-click).
 *
 * Mirrors DeleteCpModal. Delete is irreversible from within the editor,
 * so we spell that out.
 */

/**
 * Slice 10K.8 — Move attachment to another work area.
 *
 * Picker grouped by contract → work area, modeled on MoveControlPlanModal.
 * We exclude the current work area from the list (there's no point in
 * "moving" it to where it already lives). Current selection is required
 * before OK is enabled.
 *
 * The schema's UNIQUE(sha1_hash) means "move" is the only meaningful
 * re-parenting operation — linking across work areas isn't possible.
 */

// basename() now lives in fileUtils.ts — imported at the top of the file.
