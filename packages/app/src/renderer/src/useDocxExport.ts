/**
 * Word-export controller hook — DOCX-4.
 *
 * Symmetric to `useExportController` for the PDF side, but much
 * simpler because Word export is per-spec only (no groupBy / no
 * cover-page toggle / no version compare in Phase A).
 *
 * As of DOCX-WA this hook accepts BOTH bdb specs AND work-area
 * (work_spec) specs in the same call. The caller passes a flat
 * array of `DocxSpecRef`. Behaviour:
 *   - one ref  → one Save-As dialog (free-form filename)
 *   - 2+ refs  → one folder picker, then main writes the batch
 *
 * Lifetime
 * --------
 * Mounted once at App root alongside the PDF controller. Exposes
 * `exportSpecs(refs)` which:
 *   1. Builds a `.docx` for each ref sequentially.
 *   2. Pops the OS save dialog (single-file or folder).
 *   3. Returns a summary the caller can render as a status banner.
 *
 * Phase A keeps it minimal — no progress UI in the modal yet; if a
 * build or write fails we surface the error in the returned summary
 * and the caller decides what to show.
 *
 * Task 151: the caller used to throw that summary away (`.finally()`
 * never sees the value), so a failed Word export looked exactly like
 * "nothing happened". `docxSummaryToStatus` below turns the summary
 * into the export modal's status line; App.tsx shows it and keeps the
 * modal open unless the export was a clean success.
 */

import { useCallback } from "react";

import type {
  BdbInfo,
  ControlPlanInfo,
  FilePayload,
  WorkSpecInfo,
} from "../../shared/ipc.js";
import { sanitiseFilePart } from "./exportGrouping.js";
import {
  buildSpecDocx,
  BdbDocxBuildError,
  type DocxSpecRef,
} from "./word/buildBdbDocx.js";
import type { BatchExportStatus } from "./BatchExportModal.js";

/** One built spec along with the metadata we need to surface errors
 *  and to build the suggested filename. */
interface BuiltSpec {
  ref: DocxSpecRef;
  label: string;
  bytes: Uint8Array;
}

export interface DocxExportSummary {
  /** Files that landed on disk (full paths returned by main). */
  written: string[];
  /** Specs that failed to build or save, with a user-readable reason. */
  errors: Array<{ ref: DocxSpecRef; label: string; message: string }>;
  /** True when the user cancelled the OS save dialog for at least
   *  one spec. Not an error — just informational. */
  cancelled: boolean;
}

/**
 * Task 151 — what the export modal should show after a Word export.
 *
 * Returns `null` for a clean success (every requested file written,
 * nothing failed, nothing cancelled): the caller closes the modal, as
 * it always has. Every other outcome returns a status and the modal
 * stays open so the user can read it:
 *   - some written, some failed  → "saved" with the per-file errors
 *   - nothing written, failures  → "error" naming each failed spec
 *   - nothing written, cancelled → "cancelled"
 *   - nothing written, no reason → "error" (should not happen; it
 *     used to be the silent case, so it must never be silent again)
 *
 * Pure so it can be unit-tested without React or Electron.
 */
export function docxSummaryToStatus(
  summary: DocxExportSummary,
  t: (key: string, vars?: Record<string, string | number>) => string,
): BatchExportStatus | null {
  const { written, errors, cancelled } = summary;
  if (written.length > 0 && errors.length === 0) return null;
  if (written.length > 0) {
    return {
      kind: "saved",
      format: "docx",
      directory: written[0]!.replace(/[/\\][^/\\]+$/, ""),
      writtenCount: written.length,
      errors: errors.map((e) => ({ fileBase: e.label, message: e.message })),
    };
  }
  if (errors.length > 0) {
    return {
      kind: "error",
      message: errors.map((e) => `${e.label}: ${e.message}`).join("; "),
    };
  }
  if (cancelled) return { kind: "cancelled" };
  return {
    kind: "error",
    message: t("modal.batchExport.error.docxNothingWritten"),
  };
}

export interface DocxExportController {
  /**
   * Build a `.docx` for each spec (BDB or work area) and prompt the
   * user to save it. Returns a summary on completion.
   *
   * `compact` mirrors the PDF flag — when true, hides empty sections
   * and any ancestors that have no surviving descendants.
   * `includeToc` (default true) picks the with-/no-TOC Word template.
   */
  exportSpecs(
    refs: readonly DocxSpecRef[],
    opts?: { compact?: boolean; includeToc?: boolean },
  ): Promise<DocxExportSummary>;
  /**
   * Backward-compat wrapper that takes plain BDB ids. Equivalent to
   * `exportSpecs(ids.map(id => ({ kind: "bdb", id })))`.
   */
  exportBdbs(
    bdbIds: readonly number[],
    opts?: { compact?: boolean; includeToc?: boolean },
  ): Promise<DocxExportSummary>;
}

/** Human label for a spec — used as the filename middle part AND
 *  as the error-message identifier. Pulls directly from the loaded
 *  payload so the formatting matches the sidebar / tabs. */
function labelForRef(data: FilePayload, ref: DocxSpecRef): string {
  if (ref.kind === "bdb") {
    const bdb: BdbInfo | undefined = data.bdbs.find((b) => b.id === ref.id);
    return bdb?.name?.trim() || `BDB ${ref.id}`;
  }
  if (ref.kind === "workSpec") {
    const wa: WorkSpecInfo | undefined = data.workSpecs.find(
      (w) => w.id === ref.id,
    );
    if (!wa) return `Arbejdsbeskrivelse ${ref.id}`;
    const code = wa.workAreaCode?.trim();
    const name = wa.workAreaName?.trim() || `Arbejdsbeskrivelse ${ref.id}`;
    return code ? `${code} ${name}` : name;
  }
  // Control plan — DOCX-CP. Filename uses "<numberText> <title>"
  // when both present; falls back to whichever is set.
  const cp: ControlPlanInfo | undefined = data.controlPlans.find(
    (c) => c.id === ref.id,
  );
  if (!cp) return `Kontrolplan ${ref.id}`;
  const num = cp.numberText?.trim();
  const title = cp.title?.trim();
  if (num && title) return `${num} ${title}`;
  return num || title || `Kontrolplan ${ref.id}`;
}

export function useDocxExport(data: FilePayload | null): DocxExportController {
  const exportSpecs = useCallback(
    async (
      refs: readonly DocxSpecRef[],
      opts: { compact?: boolean; includeToc?: boolean } = {},
    ): Promise<DocxExportSummary> => {
      const compact = opts.compact === true;
      // Default true — the TOC is on unless the caller turns it off.
      const includeToc = opts.includeToc !== false;
      const summary: DocxExportSummary = {
        written: [],
        errors: [],
        cancelled: false,
      };
      if (!data || refs.length === 0) {
        return summary;
      }
      const projectName = (data.project?.name ?? "Project").trim() || "Project";
      const safeProject = sanitiseFilePart(projectName);

      // Task 151: every ticked spec is built - empty control plans
      // included. Until 2026-09-24 this filtered out control plans
      // with no filled-in rows ("DOCX-CP-EmptySkip") without a word,
      // on the grounds that the PDF export did the same. It no longer
      // does: since Task 109 the PDF export writes a file for every
      // ticked control plan, empty or not. So the same tick gave a
      // PDF and no Word file. A control plan the user ticked is now
      // exported in Word too - title, metadata, group headings and an
      // empty table, which is what the user asked for and can see.
      // The MCP Word path (useMcpExportBridge) still skips empty
      // plans on purpose: there an AI exports in bulk and blank
      // documents are noise.

      // Build every .docx FIRST so we can decide between the single-
      // file Save dialog (1 spec) and the folder picker (2+ specs).
      // Build errors are collected here; the dialog flow then runs
      // against the surviving items.
      const built: BuiltSpec[] = [];
      for (const ref of refs) {
        const label = labelForRef(data, ref);
        try {
          const bytes = buildSpecDocx({ data, spec: ref, compact, includeToc });
          built.push({ ref, label, bytes });
        } catch (err) {
          const message =
            err instanceof BdbDocxBuildError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          summary.errors.push({ ref, label, message });
        }
      }
      if (built.length === 0) return summary;

      // Filename format: `<projectName>_<label>.docx`. Uses the same
      // `sanitiseFilePart` as the PDF batch export so a given spec
      // produces an identical filename for both exports (only the
      // extension differs).
      const fileBaseFor = (b: BuiltSpec): string =>
        `${safeProject}_${sanitiseFilePart(b.label)}`;

      // One-file shortcut — same UX policy the PDF export uses: a
      // single file goes through the normal Save-As dialog so the
      // user can name it freely. Two-or-more goes through the
      // folder picker so the user picks a destination once.
      if (built.length === 1) {
        const only = built[0]!;
        const suggested = `${fileBaseFor(only)}.docx`;
        const result = await window.molio.saveDocx({
          suggestedFileName: suggested,
          bytes: only.bytes,
        });
        if (result.kind === "saved") summary.written.push(result.path);
        else if (result.kind === "cancelled") summary.cancelled = true;
        else
          summary.errors.push({
            ref: only.ref,
            label: only.label,
            message: result.message,
          });
        return summary;
      }

      // Multi-file path — ONE folder picker, then main writes the
      // batch with collision-safe filenames (same dedupe-against-
      // disk helper the PDF batch uses).
      const items = built.map((b) => ({
        fileBase: fileBaseFor(b),
        bytes: b.bytes,
      }));
      const result = await window.molio.saveDocxBatch({
        dialogTitle: "Vælg en mappe til Word-dokumenterne",
        items,
      });
      if (result.kind === "saved") {
        summary.written.push(...result.written);
        for (const e of result.errors) {
          // Map fileBase back to the spec so the error carries a
          // useful identifier. Falls back to the raw fileBase if we
          // can't find a match (shouldn't happen — we built items
          // from `built` so every fileBase corresponds 1:1).
          const found = built.find((b) => fileBaseFor(b) === e.fileBase);
          summary.errors.push({
            ref: found?.ref ?? { kind: "bdb", id: -1 },
            label: found?.label ?? e.fileBase,
            message: e.message,
          });
        }
      } else if (result.kind === "cancelled") {
        summary.cancelled = true;
      } else {
        summary.errors.push({
          ref: { kind: "bdb", id: -1 },
          label: "(batch)",
          message: result.message,
        });
      }
      return summary;
    },
    [data],
  );

  const exportBdbs = useCallback(
    (
      bdbIds: readonly number[],
      opts?: { compact?: boolean; includeToc?: boolean },
    ): Promise<DocxExportSummary> => {
      const refs: DocxSpecRef[] = bdbIds.map((id) => ({ kind: "bdb", id }));
      return exportSpecs(refs, opts);
    },
    [exportSpecs],
  );

  return { exportSpecs, exportBdbs };
}
