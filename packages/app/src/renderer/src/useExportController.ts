/**
 * Export controller hook — shared state + UI for the Export-PDFs modal.
 *
 * Slice 10H.10-UX — hoisted out of `ExportCard` so the top-nav printer
 * icon and the Project-tab "Export PDF" button can share one modal
 * instance. Call the hook ONCE at app root; render its `modalElement`
 * somewhere above every potential trigger, and call `open()` from any
 * trigger to show it.
 *
 * Kept deliberately small — this module only owns the modal's state
 * machinery and IPC orchestration. The tree + PDF builders still live
 * in `ExportCard.tsx` / `pdf/buildSpecPdf.ts` and are re-exported
 * through the thin helpers this hook imports.
 */

import { createElement, useMemo, useState, type ReactElement } from "react";

import type { FilePayload, SavePdfBatchItem } from "../../shared/ipc.js";
import { dedupeFileBases } from "../../shared/pdfExportUtils.js";
import {
  BatchExportModal,
  type BatchExportStatus,
} from "./BatchExportModal.js";
import { useVersionCompareEngine } from "./VersionCompareContext.js";
import { useCoverEngine, type CoverActiveTemplate } from "./coverContext.js";
import { readCompactView } from "./compactViewPrefs.js";
import { prefStore } from "./prefs.js";
import type { VersionCompareFormat } from "./compare/versionCompareFormat.js";
import { buildBytesFor, buildTargets, resolveTarget } from "./ExportCard.js";
import { buildBytesForCompositeJob } from "./executeCompositeExport.js";
import {
  buildPdfExportJobs,
  type ExportGroupBy,
  type PdfExportJob,
} from "./exportGrouping.js";
import {
  buildExportTree,
  emptySelection,
  isEmptySelection,
  type ExportSelection,
} from "./exportTree.js";
import type { MarkKind } from "./highlights/markKinds.js";
import { friendlyErrorForDialog } from "./i18n/friendlyError.js";
import { t as tStatic } from "./i18n/i18n.js";
import { renderVersionSummaryPdf } from "./pdf/renderPdf.js";

/** Strip a trailing `.pdf` from a filename so it's safe to feed to
 *  the IPC layer's `fileBase` parameter (the platform appends `.pdf`
 *  itself). The grouping helper produces filenames with the extension
 *  already on. */
function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

export interface ExportController {
  /** Open the modal. Resets selection + status on every invocation so
   *  the dialog always starts in a predictable clean state. */
  open: () => void;
  /**
   * Programmatically close the modal. The PDF flow lets the user
   * close manually via the Cancel/Close button after a success
   * (so they can see the "X written" status). The Word flow
   * (DOCX-4) doesn't have an equivalent in-modal status line yet,
   * so the host calls this from its onExportDocx wrapper to dismiss
   * the modal as soon as the OS save dialog returns.
   */
  close: () => void;
  /** Rendered modal element; `null` while the modal is closed. Mount
   *  this somewhere near the app root (before any page content that
   *  might unmount, to keep the in-flight write safe). */
  modalElement: ReactElement | null;
  /** True when the payload contains at least one exportable target.
   *  Callers use it to decide whether to enable their trigger button. */
  hasTargets: boolean;
  /**
   * Mark kinds the user has chosen to strip from PDF output via the
   * Export options modal. Empty by default — nothing hidden. The
   * caller (App.tsx) renders the Export options modal with this set
   * + `setHideMarkKinds`; the build path passes the set into the PDF
   * builder, which strips them from each section body via
   * `stripHighlights` before handing the body to html-to-pdfmake.
   */
  hideMarkKinds: ReadonlySet<MarkKind>;
  setHideMarkKinds: (next: ReadonlySet<MarkKind>) => void;
}

export function useExportController(
  data: FilePayload | null,
  /**
   * Optional version-compare context. When both `referenceFile` and
   * `versionFormat` are non-null, the modal exposes the
   * "Mark version changes" + "Include summary report" checkboxes
   * (off by default). When null, those options are hidden — same
   * behaviour as before this slice.
   */
  referenceFile: FilePayload | null = null,
  versionFormat: VersionCompareFormat | null = null,
  /**
   * DOCX-4 / DOCX-WA / DOCX-CP — optional handler for the modal's
   * "Word" button. When supplied, the modal renders the button next
   * to "Export PDFs" and calls this with the user's spec selection
   * (BDBs AND/OR work areas AND/OR control plans, mixed in one list)
   * + the current modal options (compact toggle today; more in
   * future). When omitted the button is hidden. Passed through
   * opaquely; the modal handles the click + enabled-state logic.
   */
  onExportDocx?: (
    refs: ReadonlyArray<
      | { kind: "bdb"; id: number }
      | { kind: "workSpec"; id: number }
      | { kind: "cp"; id: number }
    >,
    opts: { compact: boolean; includeToc: boolean },
  ) => void,
): ExportController {
  // Include-cover-page persists across opens so the user's preferred
  // setting isn't reset each time they hit the button. Compact is
  // re-seeded from the app's general Compact-view toggle on every open
  // (COMPACT-Sync) — see openModal; the initial value here is just a
  // placeholder until the first open.
  const [includeCoverPage, setIncludeCoverPage] = useState(true);
  const [compact, setCompact] = useState(false);
  // Table of contents on by default (matches the historical export
  // behaviour). Persists across opens like includeCoverPage. Feeds the
  // PDF builders (includeToc) and picks the with-/no-TOC Word template.
  const [includeToc, setIncludeToc] = useState(true);
  // Hide-on-export options for 6L.1 formatting marks (highlight
  // backgrounds + text colors). Set via the Export options modal.
  // Empty default = nothing hidden.
  const [hideMarkKinds, setHideMarkKinds] = useState<ReadonlySet<MarkKind>>(
    () => new Set<MarkKind>(),
  );
  // Version-compare flags. Both default off — see slice intake: the
  // user opts in even when a reference is loaded.
  const [markChanges, setMarkChanges] = useState(false);
  const [includeSummary, setIncludeSummary] = useState(false);
  // Version-compare engine (Glasshouse-only; no-op default in Community).
  // Used for the version summary diff + injected into the diff-mark export.
  const versionEngine = useVersionCompareEngine();
  // Custom-cover engine (Glasshouse-only; no-op default in Community).
  // Resolved once per export, then injected into each job's build opts.
  const coverEngine = useCoverEngine();

  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<ExportSelection>(() =>
    emptySelection(),
  );
  // 2026-05-12. PDF grouping mode. Default 'perSpec' = today's behaviour
  // (one PDF per checked work area / BDB). Persisted across opens so
  // the user's choice sticks until they change it.
  const [groupBy, setGroupBy] = useState<ExportGroupBy>("perSpec");
  const [status, setStatus] = useState<BatchExportStatus>({ kind: "idle" });

  const targets = useMemo(
    () => (data != null ? buildTargets(data) : []),
    [data],
  );
  const hasTargets = targets.length > 0;
  const tree = useMemo(
    () =>
      data != null
        ? buildExportTree(data)
        : { contractGroups: [], standaloneBdbs: [], controlPlans: [] },
    [data],
  );

  const openModal = (): void => {
    setStatus({ kind: "idle" });
    setSelection(emptySelection());
    // COMPACT-Sync: the export "Compact" checkbox follows the app's
    // general Compact-view toggle. Read its current (persisted) value on
    // every open so the dialog starts in step with the UI; the user can
    // still override it for this one export.
    setCompact(readCompactView(prefStore()));
    // Version-compare flags reset to off on every open. Same policy as
    // selection: the user opts in fresh each time. If they want sticky
    // state, that's a follow-up.
    setMarkChanges(false);
    setIncludeSummary(false);
    setOpen(true);
  };
  const closeModal = (): void => {
    setOpen(false);
  };

  /**
   * Render one job (single-spec or composite) to PDF bytes. Throws on
   * failure so the caller can catch and append to `buildErrors`.
   */
  const renderOneJob = async (
    job: PdfExportJob,
    coverActive: CoverActiveTemplate | null,
  ): Promise<Uint8Array> => {
    if (data == null) throw new Error("No file open.");
    const sharedOpts = {
      includeCoverPage,
      compact,
      includeToc,
      hideMarkKinds,
      markChanges:
        markChanges && referenceFile && versionFormat
          ? {
              reference: referenceFile,
              format: versionFormat,
              applyToSections: versionEngine.applyDiffMarksToSections,
              applyToPfbbChildSupplements:
                versionEngine.applyDiffMarksToPfbbChildSupplements,
            }
          : undefined,
      // Custom cover (Glasshouse). Undefined unless the engine resolved
      // an active template for this project — Community always undefined.
      cover: coverActive
        ? { active: coverActive, apply: coverEngine.applyCover }
        : undefined,
    };
    if (job.kind === "single") {
      const row = resolveTarget(targets, job.target);
      if (!row) {
        throw new Error("Target not found in current file payload.");
      }
      return buildBytesFor(data, row, sharedOpts);
    }
    return buildBytesForCompositeJob(data, job, sharedOpts);
  };

  const handleExport = async (): Promise<void> => {
    if (data == null) return;
    // Resolve the active custom cover once for the whole export
    // (Glasshouse-only; always null in Community → no change).
    const coverActive = await coverEngine.resolveActiveTemplate({
      moliospecPath: data.path,
      projectGuid: data.project?.projectGuid ?? null,
    });
    // 2026-05-12. The job planner is the single source of truth for
    // "what files will we produce." It honours `groupBy` — perSpec
    // returns one single-job per checked target (today's behaviour);
    // the three composite modes return one composite job per scope.
    const jobs = buildPdfExportJobs({
      data,
      tree,
      selection,
      groupBy,
    });
    // Allow proceeding with no per-target selections IF the user has
    // turned on the summary PDF — that on its own is a valid export.
    const wantSummary = includeSummary && referenceFile != null;
    if (jobs.length === 0 && !wantSummary) {
      // Task 109. Until 2026-09-09 this was a bare `return`, and that
      // is why a control-plan-only selection looked like a dead
      // button: the planner skipped control plans, the job list came
      // back empty, and the export gave up without a word. The planner
      // knows about control plans now, so an empty list with something
      // ticked should no longer be reachable — which is exactly why it
      // has to say so. Next time a kind of tick drops out of the
      // planner it should take two minutes to spot, not half a day.
      //
      // Nothing ticked at all is still a legitimate silent no-op: the
      // export button is disabled in that state, so there is nothing
      // to explain.
      if (!isEmptySelection(selection)) {
        setStatus({
          kind: "error",
          message: tStatic("modal.batchExport.error.nothingToExport"),
        });
      }
      return;
    }

    // 2026-05-12 (Tore): close the modal after every export path,
    // matching the Word flow. The OS save dialog already gave the
    // user confirmation; keeping the modal open after a successful
    // save is just noise. We wrap the whole pipeline in try/finally
    // so cancel + error paths close too.
    try {
      setStatus({ kind: "building", done: 0, total: jobs.length });
      const items: SavePdfBatchItem[] = [];
      const buildErrors: Array<{ fileBase: string; message: string }> = [];
      // De-dupe per-job filenames (an example collision: two contracts
      // each containing a work area called "S240.01 — Vinduer" would
      // produce two jobs with identical filenames in perWorkArea mode).
      const fileBases = jobs.map((j) => stripPdfExt(j.filename));
      const dedupedBases = dedupeFileBases(fileBases);
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!;
        const fileBase = dedupedBases[i] ?? fileBases[i] ?? "export";
        try {
          const bytes = await renderOneJob(job, coverActive);
          items.push({ fileBase, bytes });
        } catch (err) {
          const message = friendlyErrorForDialog(err);
          buildErrors.push({ fileBase, message });
        }
        setStatus({
          kind: "building",
          done: i + 1,
          total: jobs.length,
        });
      }
      // Append the version summary PDF when requested. Built last so a
      // build failure here doesn't kill the rest of the batch — we
      // collect any error into `buildErrors` and let the user see what
      // saved successfully.
      if (includeSummary && referenceFile && data) {
        try {
          const revisions = versionEngine.compareVersions(data, referenceFile);
          const summaryBytes = await renderVersionSummaryPdf({
            projectName: data.project?.name ?? null,
            referenceLabel:
              referenceFile.path.split(/[/\\]/).pop() ?? referenceFile.path,
            companyName: "Company name",
            includeCoverPage,
            revisions,
            strings: {
              documentTitle: tStatic("versionSummary.documentTitle"),
              referenceLabel: tStatic("versionSummary.referenceLabel"),
              noChangesText: tStatic("versionSummary.noChanges"),
              sectionsHeader: tStatic("versionSummary.sectionsHeader"),
              cpRowsHeader: tStatic("versionSummary.cpRowsHeader"),
              attachmentsHeader: tStatic("versionSummary.attachmentsHeader"),
              kindLabel: {
                added: tStatic("versionSummary.kind.added"),
                deleted: tStatic("versionSummary.kind.deleted"),
                modified: tStatic("versionSummary.kind.modified"),
              },
              wholeSpecCount: (count) =>
                tStatic("versionSummary.wholeSpecCount", { count }),
              cpSlotLabel: {
                design: tStatic("versionSummary.cpSlot.design"),
                production: tStatic("versionSummary.cpSlot.production"),
              },
            },
          });
          const projectFileBase =
            (data.project?.name ?? "project").trim().replace(/\s+/g, "-") ||
            "project";
          items.push({
            fileBase: `${projectFileBase}-version-summary`,
            bytes: summaryBytes,
          });
        } catch (err) {
          const message = friendlyErrorForDialog(err);
          buildErrors.push({ fileBase: "version-summary", message });
        }
      }

      if (items.length === 0) {
        setStatus({
          kind: "error",
          message:
            buildErrors[0]?.message ??
            "Could not build any of the selected PDFs.",
        });
        return;
      }
      setStatus({ kind: "writing" });
      // One-PDF shortcut: let the user pick both folder AND filename via
      // the normal Save-As dialog. Feels much more natural than the
      // folder-picker path when you're exporting a single thing.
      if (items.length === 1) {
        const only = items[0]!;
        const single = await window.molio.savePdf({
          suggestedFileName: `${only.fileBase}.pdf`,
          bytes: only.bytes,
        });
        if (single.kind === "saved") {
          setStatus({
            kind: "saved",
            directory: single.path.replace(/[/\\][^/\\]+$/, ""),
            writtenCount: 1,
            errors: buildErrors,
          });
        } else if (single.kind === "cancelled") {
          setStatus({ kind: "cancelled" });
        } else {
          setStatus({ kind: "error", message: single.message });
        }
        return;
      }
      const result = await window.molio.savePdfBatch({
        dialogTitle: "Choose a folder for the PDFs",
        items,
      });
      if (result.kind === "saved") {
        setStatus({
          kind: "saved",
          directory: result.directory,
          writtenCount: result.written.length,
          errors: [...buildErrors, ...result.errors],
        });
      } else if (result.kind === "cancelled") {
        setStatus({ kind: "cancelled" });
      } else {
        setStatus({ kind: "error", message: result.message });
      }
    } finally {
      // Always close — see comment at the top of handleExport.
      closeModal();
    }
  };

  const modalElement = open
    ? createElement(BatchExportModal, {
        tree,
        selection,
        onSelectionChange: setSelection,
        includeCoverPage,
        onIncludeCoverPageChange: setIncludeCoverPage,
        compact,
        onCompactChange: setCompact,
        includeToc,
        onIncludeTocChange: setIncludeToc,
        groupBy,
        onGroupByChange: setGroupBy,
        // Version-compare options — only shown when a reference is
        // loaded AND we have a format. Both flags default off.
        referenceLoaded: referenceFile != null && versionFormat != null,
        markChanges,
        onMarkChangesChange: setMarkChanges,
        includeSummary,
        onIncludeSummaryChange: setIncludeSummary,
        onCancel: closeModal,
        onExport: () => {
          void handleExport();
        },
        onExportDocx,
        status,
      })
    : null;

  return {
    open: openModal,
    close: closeModal,
    modalElement,
    hasTargets,
    hideMarkKinds,
    setHideMarkKinds,
  };
}
