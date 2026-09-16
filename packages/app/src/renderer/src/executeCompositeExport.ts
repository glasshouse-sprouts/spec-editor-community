/**
 * Composite-PDF executor.
 *
 * Companion to the existing single-spec executor (`buildBytesFor` in
 * ExportCard.tsx). Takes one composite `PdfExportJob` — a list of
 * chapter targets + cover info — and produces final PDF bytes.
 *
 * The per-chapter section + attachment + PFBB-overlay + diff-marks
 * logic is intentionally a focused subset of `buildBytesFor`'s
 * workSpec / bdb branches; we deliberately keep the existing
 * single-spec path untouched so the well-tested perSpec mode is
 * zero-risk. Some local duplication is the price of that safety —
 * marked with `// MIRROR-OF-buildBytesFor` comments so a future
 * DRY pass can lift the shared bits.
 *
 * Composite jobs never contain control-plan chapters (CPs aren't
 * part of the "per WA / per contract / whole project" groupings),
 * so we only handle workSpec + bdb here.
 */
import type { FilePayload, SectionData } from "../../shared/ipc.js";
import type { VersionCompareEngine } from "./VersionCompareContext.js";
import type { CoverApply } from "./coverContext.js";
import type { VersionCompareFormat } from "./compare/versionCompareFormat.js";
import type { PdfExportJob, CompositeChapterPlan } from "./exportGrouping.js";
import type { MarkKind } from "./highlights/markKinds.js";
import { stripHighlights } from "./highlights/stripHighlights.js";
import {
  type AttachmentAppendixEntry,
  type PfbbChildPdfOverlay,
  type SpecKind,
} from "./pdf/buildSpecPdf.js";
import { type CompositePdfChapter } from "./pdf/buildCompositePdf.js";
import { t as tStatic } from "./i18n/i18n.js";
import {
  findBdbById,
  findControlPlanById as _findControlPlanByIdUnused,
  findWorkSpecById,
} from "./loaded.js";
import { buildMergedChildView } from "./pfbbMergedView.js";
import { renderCompositePdf } from "./pdf/renderPdf.js";
// MIRROR-OF-buildBytesFor — these matching helpers are re-exported
// from ExportCard so they're already battle-tested. Keeps the
// composite path on the same matcher rules as the single-spec path.
import { findMatchingRefBdb, findMatchingRefWorkArea } from "./ExportCard.js";

// Local copy of the helper from ExportCard — kept here so this file
// has zero dependency on ExportCard's IPC-specific image loader.
// MIRROR-OF-buildBytesFor for the WA attachments path.
import { gatherAppendixEntries } from "./ExportCard.js";

const COMPANY_NAME_PLACEHOLDER = "Company name";

export interface CompositeBuildOptions {
  includeCoverPage: boolean;
  compact: boolean;
  /** Include the unified table of contents. Optional — omitted means
   *  "on" (the builder defaults to true). */
  includeToc?: boolean;
  hideMarkKinds?: ReadonlySet<MarkKind>;
  markChanges?: {
    reference: FilePayload;
    format: VersionCompareFormat;
    /** Injected diff-mark functions. The version-compare engine lives in the
     *  Glasshouse-only seam, so this file never imports it. */
    applyToSections: VersionCompareEngine["applyDiffMarksToSections"];
    applyToPfbbChildSupplements: VersionCompareEngine["applyDiffMarksToPfbbChildSupplements"];
  };
  /**
   * Custom cover (Glasshouse). When set, the composite's built-in auto
   * cover is suppressed and the finished PDF is wrapped with the custom
   * front page. Undefined in Community / when no template is active.
   */
  cover?: CoverApply;
}

// Identity fallbacks for the injected diff-mark functions. Only used as the
// no-op when version-compare is inactive (markChanges undefined). The real
// functions are injected via opts.markChanges (the Glasshouse engine seam).
const identityDiffSections: VersionCompareEngine["applyDiffMarksToSections"] = (
  current,
) => current.slice();
const identityDiffSupplements: VersionCompareEngine["applyDiffMarksToPfbbChildSupplements"] =
  (args) => ({ ...args.supplementBodyBySectionId });

/**
 * Build the PDF bytes for one composite export job.
 */
export async function buildBytesForCompositeJob(
  data: FilePayload,
  job: Extract<PdfExportJob, { kind: "composite" }>,
  opts: CompositeBuildOptions,
): Promise<Uint8Array> {
  const projectName = data.project?.name ?? null;

  const stripBody: ((html: string) => string) | undefined =
    opts.hideMarkKinds && opts.hideMarkKinds.size > 0
      ? (html: string) => stripHighlights(html, opts.hideMarkKinds!)
      : undefined;

  const chapters: CompositePdfChapter[] = [];
  for (const plan of job.chapters) {
    const ch = await prepareCompositeChapter(data, plan, opts);
    chapters.push(ch);
  }

  // Custom cover (Glasshouse): suppress the auto cover and wrap below.
  const includeAutoCover = opts.cover ? false : opts.includeCoverPage;
  const renderArgs: Parameters<typeof renderCompositePdf>[0] = {
    cover: {
      title: job.cover.title,
      subtitle: job.cover.subtitle ?? null,
      projectName,
      contractLabel: job.cover.contractLabel,
      companyName: COMPANY_NAME_PLACEHOLDER,
    },
    chapters,
    includeCoverPage: includeAutoCover,
    // A custom cover is prepended below — shift page numbers by 1 so they
    // count it (matching the built-in cover's numbering).
    pageNumberOffset: opts.cover ? 1 : 0,
    includeToc: opts.includeToc,
    compact: opts.compact,
  };
  if (stripBody) renderArgs.stripBody = stripBody;
  const bytes = await renderCompositePdf(renderArgs);
  if (!opts.cover) return bytes;
  return opts.cover.apply(opts.cover.active, bytes, {
    projectName,
    projectNumber: data.project?.projectNumber ?? null,
    builder: data.project?.builder ?? null,
    dateText: new Date().toISOString().slice(0, 10),
    specTitle: job.cover.title,
    revision: null,
    revisionDate: null,
    contractLabel: job.cover.contractLabel ?? null,
    workAreaName: null,
  });
}

/**
 * Per-chapter section + attachment + PFBB-overlay + diff-marks prep.
 * Returns the chapter shape `buildCompositePdf` consumes directly.
 *
 * MIRROR-OF-buildBytesFor: the workSpec branch mirrors
 * ExportCard.tsx's workSpec branch; the bdb branch mirrors the bdb
 * branch including the regular-vs-PFBB-child diff handling.
 */
async function prepareCompositeChapter(
  data: FilePayload,
  plan: CompositeChapterPlan,
  opts: CompositeBuildOptions,
): Promise<CompositePdfChapter> {
  if (plan.kind === "workSpec") {
    return prepareWorkAreaChapter(data, plan, opts);
  }
  return prepareBdbChapter(data, plan, opts);
}

async function prepareWorkAreaChapter(
  data: FilePayload,
  plan: CompositeChapterPlan,
  opts: CompositeBuildOptions,
): Promise<CompositePdfChapter> {
  const applyDiffMarksToSections =
    opts.markChanges?.applyToSections ?? identityDiffSections;
  const ws = findWorkSpecById(data, plan.targetId);
  if (!ws) {
    throw new Error(tStatic("exportCard.error.workAreaNotFound"));
  }
  let sections: SectionData[] = data.sectionsByWorkSpec[plan.targetId] ?? [];
  if (opts.markChanges) {
    const refWs = findMatchingRefWorkArea(opts.markChanges.reference, ws);
    const refSections = refWs
      ? (opts.markChanges.reference.sectionsByWorkSpec[refWs.id] ?? [])
      : [];
    sections = applyDiffMarksToSections(
      sections,
      refSections,
      opts.markChanges.format.added,
      opts.markChanges.format.deleted,
    );
  }
  const attachments = await gatherAppendixEntries(
    data.path,
    data.attachments.filter((a) => a.workSpecId === plan.targetId),
  );

  const chapter: CompositePdfChapter = {
    kind: "workSpec" as SpecKind,
    title: plan.title,
    subtitle: plan.subtitle ?? ws.workAreaCode ?? null,
    revision: ws.revision ?? null,
    revisionDate: ws.revisionDate ?? null,
    sections,
  };
  if (attachments.length > 0) chapter.attachments = attachments;
  return chapter;
}

async function prepareBdbChapter(
  data: FilePayload,
  plan: CompositeChapterPlan,
  opts: CompositeBuildOptions,
): Promise<CompositePdfChapter> {
  const applyDiffMarksToSections =
    opts.markChanges?.applyToSections ?? identityDiffSections;
  const applyDiffMarksToPfbbChildSupplements =
    opts.markChanges?.applyToPfbbChildSupplements ?? identityDiffSupplements;
  const bdb = findBdbById(data, plan.targetId);
  if (!bdb) {
    throw new Error(tStatic("exportCard.error.bdbNotFound"));
  }
  let sections: SectionData[] = data.sectionsByBdb[plan.targetId] ?? [];
  let pfbbChildOverlay: PfbbChildPdfOverlay | undefined;

  if (bdb.pfbbId != null) {
    const master = findBdbById(data, bdb.pfbbId);
    const masterSections =
      master != null ? (data.sectionsByBdb[master.id] ?? []) : [];
    const childSections = data.sectionsByBdb[bdb.id] ?? [];
    const { merged } = buildMergedChildView({
      masterSections,
      childSections,
    });
    const supplementBodyBySectionId: Record<number, string> = {};
    for (const row of merged) {
      if (row.supplement != null) {
        supplementBodyBySectionId[row.masterSection.id] =
          row.supplement.body ?? "";
      }
    }
    sections = masterSections;
    pfbbChildOverlay = {
      masterName: master?.name || tStatic("exportCard.unnamedMaster"),
      supplementBodyBySectionId,
    };
  }

  const parentWa = bdb.workSpecId
    ? findWorkSpecById(data, bdb.workSpecId)
    : null;

  if (opts.markChanges && pfbbChildOverlay == null) {
    const refBdb = findMatchingRefBdb(
      opts.markChanges.reference,
      bdb,
      parentWa ?? null,
    );
    const refSections = refBdb
      ? (opts.markChanges.reference.sectionsByBdb[refBdb.id] ?? [])
      : [];
    sections = applyDiffMarksToSections(
      sections,
      refSections,
      opts.markChanges.format.added,
      opts.markChanges.format.deleted,
    );
  } else if (opts.markChanges && pfbbChildOverlay != null) {
    const refMarked = opts.markChanges;
    const refChildBdb = findMatchingRefBdb(
      refMarked.reference,
      bdb,
      parentWa ?? null,
    );
    const refMasterBdb =
      refChildBdb?.pfbbId != null
        ? (refMarked.reference.bdbs.find((b) => b.id === refChildBdb.pfbbId) ??
          null)
        : null;
    const refMasterSections = refMasterBdb
      ? (refMarked.reference.sectionsByBdb[refMasterBdb.id] ?? [])
      : [];
    const refChildSections = refChildBdb
      ? (refMarked.reference.sectionsByBdb[refChildBdb.id] ?? [])
      : [];
    const originalMasterSections = sections;
    sections = applyDiffMarksToSections(
      sections,
      refMasterSections,
      refMarked.format.added,
      refMarked.format.deleted,
    );
    const newSupplementMap = applyDiffMarksToPfbbChildSupplements({
      supplementBodyBySectionId: pfbbChildOverlay.supplementBodyBySectionId,
      currentMasterSections: originalMasterSections,
      referenceMasterSections: refMasterSections,
      referenceChildSections: refChildSections,
      addedFormat: refMarked.format.added,
      deletedFormat: refMarked.format.deleted,
    });
    pfbbChildOverlay = {
      ...pfbbChildOverlay,
      supplementBodyBySectionId: newSupplementMap,
    };
  }

  const chapter: CompositePdfChapter = {
    kind: "bdb" as SpecKind,
    title: plan.title,
    subtitle: plan.subtitle ?? null,
    revision: bdb.revision ?? null,
    revisionDate: bdb.revisionDate ?? null,
    sections,
  };
  if (pfbbChildOverlay) chapter.pfbbChildOverlay = pfbbChildOverlay;
  // Suppress unused-import warning for the CP helper — kept in
  // case a future iteration needs it.
  void _findControlPlanByIdUnused;
  void ({} as AttachmentAppendixEntry);
  return chapter;
}
