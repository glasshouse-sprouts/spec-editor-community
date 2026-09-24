/**
 * Export card — shown in the Project tab below Contracts.
 *
 * 10H.10-UX simplification (2026-04-24): the card collapses down to a
 * single "Export PDF" button that opens the batch-export modal. The
 * previous single-target dropdown + "Include cover page" / "Compact"
 * checkboxes + single-target button are all gone; those options now
 * live inside the modal (which already mirrored them). One flow, one
 * button.
 *
 * History (kept for context):
 *   - 7.1 introduced the one-target dropdown + single Export button.
 *   - 7.2 added "Include cover page".
 *   - 7.3 added "Compact" + the batch-export modal.
 *   - 10H.10 kept just the modal entry point.
 *
 * `companyName` is still the literal string "Company name" — see
 * Icebox #119 for real storage.
 */

import type {
  AttachmentInfo,
  ContractInfo,
  FilePayload,
} from "../../shared/ipc.js";
import { type ExportTarget as BatchExportTarget } from "./exportTree.js";
import { useT, t as tStatic } from "./i18n/i18n.js";
import {
  findBdbById,
  findControlPlanById,
  findWorkSpecById,
} from "./loaded.js";
import { formatContractLabel } from "./ExportCardLabels.js";
import {
  isInlinableImageMime,
  type AttachmentAppendixEntry,
  type PfbbChildPdfOverlay,
} from "./pdf/buildSpecPdf.js";
import { renderCpPdf, renderSpecPdf } from "./pdf/renderPdf.js";
import { buildMergedChildView } from "./pfbbMergedView.js";
import type { MarkKind } from "./highlights/markKinds.js";
import { stripHighlights } from "./highlights/stripHighlights.js";
import type { VersionCompareEngine } from "./VersionCompareContext.js";
import type { CoverApply, CoverExportContext } from "./coverContext.js";
import type { VersionCompareFormat } from "./compare/versionCompareFormat.js";

// Re-export so existing callers (tests, etc.) that imported
// `formatContractLabel` from this module keep working during the 7.3
// refactor. Prefer `./ExportCardLabels.js` directly in new code.
export { formatContractLabel };

interface Props {
  data: FilePayload;
  /**
   * Called when the user clicks the "Export PDF" button. The parent
   * owns the export modal (so the top-nav printer icon can trigger
   * the same modal) — this card is now just the trigger surface on
   * the Project tab.
   */
  onOpenExport: () => void;
}

/** Literal text used in the PDF footer until Icebox #119 lands. */
const COMPANY_NAME_PLACEHOLDER = "Company name";

/** One row in the "pick what to export" dropdown. */
export type ExportTarget =
  | {
      kind: "workSpec";
      id: number;
      label: string;
      fileBase: string;
      contractLabel: string | null;
    }
  | {
      kind: "bdb";
      id: number;
      label: string;
      fileBase: string;
      parentId: number | null;
      contractLabel: string | null;
    }
  | {
      kind: "cp";
      id: number;
      label: string;
      fileBase: string;
      ownerLabel: string | null;
      contractLabel: string | null;
    };

/**
 * Sanitise a string for use as a filename component. Windows is the
 * strictest of our targets: it disallows `\ / : * ? " < > |` and
 * trailing spaces/dots. We replace runs of any of those with a single
 * underscore and trim.
 */
function toFileBase(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "export";
  return (
    s
      .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "")
      .slice(0, 80) || "export"
  );
}

/**
 * Build the flat list of export targets from the file payload. BDBs
 * are nested under their work area in the dropdown `<optgroup>` below
 * — that's the only place the hierarchy shows up in 7.1.
 */
export function buildTargets(data: FilePayload): ExportTarget[] {
  const contractById = new Map<number, ContractInfo>(
    data.contracts.map((c) => [c.id, c]),
  );
  const out: ExportTarget[] = [];

  // Work area → contract label, used by BDB + CP lookups.
  const contractByWs = new Map<number, string | null>();
  for (const ws of data.workSpecs) {
    const contract =
      ws.contractId != null ? (contractById.get(ws.contractId) ?? null) : null;
    const contractLabel = formatContractLabel(contract);
    contractByWs.set(ws.id, contractLabel);
  }

  for (const ws of data.workSpecs) {
    const name = ws.workAreaName || tStatic("exportCard.unnamedWorkArea");
    const code = ws.workAreaCode ?? "";
    const label = code ? `${code} ${name}` : name;
    out.push({
      kind: "workSpec",
      id: ws.id,
      label,
      fileBase: toFileBase(`Work area ${code || ws.id} ${name}`),
      contractLabel: contractByWs.get(ws.id) ?? null,
    });
  }
  // Map WS id → label so BDB filenames can include their parent code.
  const wsCodeById = new Map<number, string>();
  for (const ws of data.workSpecs) {
    wsCodeById.set(ws.id, ws.workAreaCode ?? "");
  }
  for (const b of data.bdbs) {
    const parentCode =
      b.workSpecId != null ? (wsCodeById.get(b.workSpecId) ?? "") : "";
    const label = b.name || tStatic("exportCard.unnamedBdb");
    const contractLabel =
      b.workSpecId != null ? (contractByWs.get(b.workSpecId) ?? null) : null;
    out.push({
      kind: "bdb",
      id: b.id,
      label: parentCode ? `${parentCode} · ${label}` : label,
      fileBase: toFileBase(`BDB ${parentCode} ${label}`),
      parentId: b.workSpecId,
      contractLabel,
    });
  }
  // CPs need owner info: find the BDB that references them.
  const cpOwnerByCpId = new Map<number, string>();
  const cpContractByCpId = new Map<number, string | null>();
  for (const b of data.bdbs) {
    for (const cpId of b.controlPlanIds) {
      const parentCode =
        b.workSpecId != null ? (wsCodeById.get(b.workSpecId) ?? "") : "";
      const bdbLbl = b.name || `BDB ${b.id}`;
      cpOwnerByCpId.set(
        cpId,
        parentCode ? `${parentCode} · ${bdbLbl}` : bdbLbl,
      );
      cpContractByCpId.set(
        cpId,
        b.workSpecId != null ? (contractByWs.get(b.workSpecId) ?? null) : null,
      );
    }
  }
  for (const cp of data.controlPlans) {
    const owner = cpOwnerByCpId.get(cp.id) ?? null;
    const number = cp.numberText || "";
    const label = `${number ? `${number}  ` : ""}${cp.title || tStatic("exportCard.untitledCp")}${
      owner ? `  —  ${owner}` : ""
    }`;
    out.push({
      kind: "cp",
      id: cp.id,
      label,
      fileBase: toFileBase(`CP ${number} ${cp.title}`),
      ownerLabel: owner,
      contractLabel: cpContractByCpId.get(cp.id) ?? null,
    });
  }
  return out;
}

export function ExportCard({ data, onOpenExport }: Props): JSX.Element {
  // Slice 10H.10-UX — this card is now just a trigger surface. All
  // the state, handlers and modal rendering live in the export
  // controller hook owned by App.tsx so the top-nav printer icon
  // shares the same modal instance. The empty-state fallback still
  // lives here because it's a Project-tab affordance.
  const t = useT();
  const hasTargets = buildTargets(data).length > 0;
  return (
    <section className="export-card" aria-labelledby="export-card-title">
      <div className="export-card__header">
        <h3 id="export-card-title">{t("exportCard.title")}</h3>
      </div>
      {!hasTargets ? (
        <p className="export-card__empty">{t("exportCard.empty")}</p>
      ) : (
        <div className="export-card__body">
          <div className="export-card__actions">
            <button
              type="button"
              className="export-card__button"
              onClick={onOpenExport}
              title={t("exportCard.button.tooltip")}
            >
              {t("exportCard.button.label")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Resolve a `selectionToTargets` entry (`{ kind, id }`) back to the
 * rich target row from `buildTargets` (with `fileBase`, `contractLabel`,
 * `ownerLabel`, etc.). Returns null if the payload no longer contains
 * a matching row — the caller surfaces that as an export error.
 */
export function resolveTarget(
  targets: ExportTarget[],
  bt: BatchExportTarget,
): ExportTarget | null {
  for (const t of targets) {
    if (t.kind === bt.kind && t.id === bt.id) return t;
  }
  return null;
}

export interface BuildOptions {
  includeCoverPage: boolean;
  /**
   * Include a table of contents in spec PDFs (work area / BDB). On by
   * default. CP PDFs have no TOC and ignore this flag. Passed straight
   * through to `buildSpecPdf` / `buildCompositePdf`, which already
   * support it. Optional — omitted means "on" (the builders default
   * to true), so callers that don't care keep the historical output.
   */
  includeToc?: boolean;
  /**
   * When true, spec PDFs drop sections whose body is visually empty
   * (same rule as the editor's Compact view). CPs ignore this flag —
   * they're tables, not prose, so the definition doesn't apply.
   */
  compact: boolean;
  /**
   * Slice "Highlights & formatting" — mark kinds (highlight
   * backgrounds + text colors) the user has chosen to hide on this
   * export via the Export options modal. Empty / omitted = nothing
   * stripped. The set is read once per build and applied to every
   * section body before html-to-pdfmake sees it.
   */
  hideMarkKinds?: ReadonlySet<MarkKind>;
  /**
   * Slice "Version compare PDF" — when set, every spec section's
   * body is rewritten through `htmlDiff(refBody, curBody, …)` BEFORE
   * the PDF builder sees it. The marked HTML carries inline-style
   * spans (`color`, `font-weight`, `text-decoration`) that
   * html-to-pdfmake honours, so the resulting PDF reads as a track-
   * changes view of the current spec relative to the reference.
   *
   * - `reference` is the loaded version reference payload.
   * - `format` is the user's added/deleted/moved colour/style
   *   choices from the Settings dialog (already user-tunable).
   *
   * Section matching is by hierarchical path — same rule used by the
   * on-screen aligned view + Revisions tab. CP and attachment PDFs
   * are unaffected (no body-HTML transform applies to them).
   *
   * Sections that exist ONLY in the reference (deleted from current)
   * are NOT injected into this PDF; the version summary PDF is the
   * place to surface those.
   */
  markChanges?: {
    reference: FilePayload;
    format: VersionCompareFormat;
    /** Injected diff-mark functions. The version-compare engine lives in the
     *  Glasshouse-only seam, so this file never imports it. */
    applyToSections: VersionCompareEngine["applyDiffMarksToSections"];
    applyToPfbbChildSupplements: VersionCompareEngine["applyDiffMarksToPfbbChildSupplements"];
  };
  /**
   * Custom cover (Glasshouse). When set, the built-in auto cover is
   * suppressed and the rendered body PDF is wrapped with the custom
   * front page. Undefined in Community / when no template is active —
   * then the export behaves exactly as before.
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

/** Build the PDF bytes for the given target using the renderer helpers. */
export async function buildBytesFor(
  data: FilePayload,
  target: ExportTarget,
  opts: BuildOptions,
): Promise<Uint8Array> {
  const projectName = data.project?.name ?? null;
  const companyName = COMPANY_NAME_PLACEHOLDER;
  // Custom cover (Glasshouse). When a template is active we suppress the
  // built-in auto cover and wrap the finished body with the custom one.
  // `opts.cover` is undefined in Community → identical to before.
  const includeAutoCover = opts.cover ? false : opts.includeCoverPage;
  const exportDate = new Date().toISOString().slice(0, 10);
  const applyCoverIf = (
    bytes: Uint8Array,
    ctx: CoverExportContext,
  ): Promise<Uint8Array> =>
    opts.cover
      ? opts.cover.apply(opts.cover.active, bytes, ctx)
      : Promise.resolve(bytes);
  // Diff-mark functions: injected via opts when version-compare is active
  // (Glasshouse), identity no-op otherwise. Keeps this file from importing the
  // engine so Community can omit it.
  const applyDiffMarksToSections =
    opts.markChanges?.applyToSections ?? identityDiffSections;
  const applyDiffMarksToPfbbChildSupplements =
    opts.markChanges?.applyToPfbbChildSupplements ?? identityDiffSupplements;

  // Bind the strip helper to the user's chosen mark kinds once per
  // export. Undefined when nothing is hidden — the builder skips the
  // wrap entirely. CP PDFs ignore this since CP cells are plain text.
  const stripBody: ((html: string) => string) | undefined =
    opts.hideMarkKinds && opts.hideMarkKinds.size > 0
      ? (html: string) => stripHighlights(html, opts.hideMarkKinds!)
      : undefined;

  if (target.kind === "workSpec") {
    const ws = findWorkSpecById(data, target.id);
    if (!ws) throw new Error(tStatic("exportCard.error.workAreaNotFound"));
    let sections = data.sectionsByWorkSpec[target.id] ?? [];
    // Slice "Version compare PDF" — when mark-changes is on AND the
    // reference file has a matching work area, rewrite each section's
    // body through htmlDiff before the builder sees it. Match by the
    // same work-area key (workAreaCode-or-name) the on-screen comparer
    // uses; sections inside match by hierarchical path.
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
    // 10L: attachments appendix — work-area PDFs only. Skipped
    // entirely when this work area has no attachments.
    const attachments = await gatherAppendixEntries(
      data.path,
      data.attachments.filter((a) => a.workSpecId === target.id),
    );
    const wsBytes = await renderSpecPdf({
      kind: "workSpec",
      title: ws.workAreaName || tStatic("exportCard.unnamedWorkArea"),
      subtitle: ws.workAreaCode ?? null,
      revision: ws.revision ?? null,
      revisionDate: ws.revisionDate ?? null,
      projectName,
      contractLabel: target.contractLabel,
      // Row 3 of BIPS header: a work area's own name.
      workAreaName: ws.workAreaName ?? null,
      companyName,
      includeCoverPage: includeAutoCover,
      // A custom cover replaces a blank page 1 after rendering, so pdfmake
      // counts it in every page number it writes (Task 173).
      reserveCoverPage: opts.cover != null,
      includeToc: opts.includeToc,
      compact: opts.compact,
      sections,
      attachments: attachments.length > 0 ? attachments : undefined,
      stripBody,
    });
    return applyCoverIf(wsBytes, {
      projectName,
      projectNumber: data.project?.projectNumber ?? null,
      builder: data.project?.builder ?? null,
      dateText: exportDate,
      specTitle: ws.workAreaName || tStatic("exportCard.unnamedWorkArea"),
      revision: ws.revision ?? null,
      revisionDate: ws.revisionDate ?? null,
      contractLabel: target.contractLabel,
      workAreaName: ws.workAreaName ?? null,
    });
  }

  if (target.kind === "bdb") {
    const bdb = findBdbById(data, target.id);
    if (!bdb) throw new Error(tStatic("exportCard.error.bdbNotFound"));
    // Slice 10H.10 — PFBB child export. When this BDB is a child of a
    // PFBB master, the "natural" content is the MERGED view (master
    // headings + bodies, with the child's project-specific supplements
    // stitched in underneath). `sectionsByBdb[childId]` alone is just
    // the supplement rows — useful internally, useless as a standalone
    // deliverable. So we feed the builder the master's sections and
    // hand it an overlay that maps master-section id → supplement body.
    let sections = data.sectionsByBdb[target.id] ?? [];
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
    // Row 3 of BIPS header: a BDB inherits the parent work area's name.
    const parentWa = bdb.workSpecId
      ? findWorkSpecById(data, bdb.workSpecId)
      : null;
    // Slice "Version compare PDF" — body-rewrite. Matched against the
    // reference's BDB by name within the matched parent work area;
    // sections inside match by hierarchical path.
    //
    // Two paths:
    //   1. Regular BDB (no PFBB overlay) — diff sections directly
    //      against the reference BDB's sections.
    //   2. PFBB child BDB — `sections` is the master's section list,
    //      and `pfbbChildOverlay.supplementBodyBySectionId` carries
    //      the child's variable content. Diff each side separately:
    //      master sections against the reference master, and the
    //      supplement overlay against the reference child's supplements
    //      via the dedicated helper that matches by master path.
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
      const refMarked = opts.markChanges; // narrow for closures
      const refChildBdb = findMatchingRefBdb(
        refMarked.reference,
        bdb,
        parentWa ?? null,
      );
      const refMasterBdb =
        refChildBdb?.pfbbId != null
          ? (refMarked.reference.bdbs.find(
              (b) => b.id === refChildBdb.pfbbId,
            ) ?? null)
          : null;
      const refMasterSections = refMasterBdb
        ? (refMarked.reference.sectionsByBdb[refMasterBdb.id] ?? [])
        : [];
      const refChildSections = refChildBdb
        ? (refMarked.reference.sectionsByBdb[refChildBdb.id] ?? [])
        : [];

      // Capture the ORIGINAL master section list before diff marking
      // — we need it to derive the master-section paths the supplement
      // diff helper uses. Once `sections` is rewritten with diff marks
      // its bodies are no longer plain (irrelevant for path lookup,
      // but keep the reference for clarity).
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
    const bdbBytes = await renderSpecPdf({
      kind: "bdb",
      title: bdb.name || tStatic("exportCard.unnamedBdb"),
      subtitle: null,
      revision: bdb.revision ?? null,
      revisionDate: bdb.revisionDate ?? null,
      projectName,
      contractLabel: target.contractLabel,
      workAreaName: parentWa?.workAreaName ?? null,
      companyName,
      includeCoverPage: includeAutoCover,
      // A custom cover replaces a blank page 1 after rendering, so pdfmake
      // counts it in every page number it writes (Task 173).
      reserveCoverPage: opts.cover != null,
      includeToc: opts.includeToc,
      compact: opts.compact,
      sections,
      pfbbChildOverlay,
      stripBody,
    });
    return applyCoverIf(bdbBytes, {
      projectName,
      projectNumber: data.project?.projectNumber ?? null,
      builder: data.project?.builder ?? null,
      dateText: exportDate,
      specTitle: bdb.name || tStatic("exportCard.unnamedBdb"),
      revision: bdb.revision ?? null,
      revisionDate: bdb.revisionDate ?? null,
      contractLabel: target.contractLabel,
      workAreaName: parentWa?.workAreaName ?? null,
    });
  }

  // control plan
  const cp = findControlPlanById(data, target.id);
  if (!cp) throw new Error(tStatic("exportCard.error.cpNotFound"));
  const headers = data.cpHeadersByPlan[target.id] ?? [];
  const rows = data.cpRowsByPlan[target.id] ?? [];
  // Row 3 of BIPS header: a CP inherits the work area that owns its
  // parent BDB. If no BDB references this CP (orphaned CP), or the BDB
  // isn't assigned to a work area, fall through to null → blank cell.
  const owningBdb = data.bdbs.find((b) => b.controlPlanIds.includes(cp.id));
  const cpWa = owningBdb?.workSpecId
    ? findWorkSpecById(data, owningBdb.workSpecId)
    : null;
  const cpBytes = await renderCpPdf({
    numberText: cp.numberText || "",
    title: cp.title || tStatic("exportCard.untitledCp"),
    ownerLabel: target.ownerLabel,
    projectName,
    contractLabel: target.contractLabel,
    workAreaName: cpWa?.workAreaName ?? null,
    companyName,
    includeCoverPage: includeAutoCover,
    reserveCoverPage: opts.cover != null,
    headers,
    rows,
  });
  return applyCoverIf(cpBytes, {
    projectName,
    projectNumber: data.project?.projectNumber ?? null,
    builder: data.project?.builder ?? null,
    dateText: exportDate,
    specTitle: cp.title || tStatic("exportCard.untitledCp"),
    revision: null,
    revisionDate: null,
    contractLabel: target.contractLabel,
    workAreaName: cpWa?.workAreaName ?? null,
  });
}

/* ------------------------------------------------------------------ */
/*  Version-compare matching helpers                                  */
/* ------------------------------------------------------------------ */

/**
 * Find the work area in `reference` that matches `cur` using the
 * same key the on-screen comparer uses: workAreaCode if non-empty,
 * else workAreaName. Returns null if there's no match.
 */
export function findMatchingRefWorkArea(
  reference: FilePayload,
  cur: { workAreaCode: string | null; workAreaName: string | null },
): FilePayload["workSpecs"][number] | null {
  const code = (cur.workAreaCode ?? "").trim();
  const name = (cur.workAreaName ?? "").trim();
  for (const ws of reference.workSpecs) {
    const refCode = (ws.workAreaCode ?? "").trim();
    const refName = (ws.workAreaName ?? "").trim();
    if (code && refCode && code === refCode) return ws;
    if (!code && !refCode && name && refName && name === refName) return ws;
  }
  return null;
}

/**
 * Find the BDB in `reference` that matches `cur` — by name, scoped
 * to the reference's matching parent work area so two BDBs of the
 * same name in different work areas don't collapse.
 */
export function findMatchingRefBdb(
  reference: FilePayload,
  cur: { name: string; workSpecId: number | null },
  curParentWa: {
    workAreaCode: string | null;
    workAreaName: string | null;
  } | null,
): FilePayload["bdbs"][number] | null {
  const refParentWa = curParentWa
    ? findMatchingRefWorkArea(reference, curParentWa)
    : null;
  const want = (cur.name ?? "").trim();
  if (!want) return null;
  for (const b of reference.bdbs) {
    if (refParentWa && b.workSpecId !== refParentWa.id) continue;
    if (!refParentWa && b.workSpecId != null) continue;
    if ((b.name ?? "").trim() === want) return b;
  }
  return null;
}

/**
 * 10L: turn a list of AttachmentInfo into AttachmentAppendixEntry[] for
 * the PDF builder. For inlinable images (PNG / JPEG) we fetch the bytes
 * via IPC and encode them as a `data:` URL so pdfmake can embed them.
 * Non-image attachments return a metadata-only entry — the builder
 * renders a type-icon row for them.
 *
 * If a single image read fails we keep the entry but drop the dataUrl,
 * so the builder falls back to the generic icon instead of blowing up
 * the whole export.
 */
export async function gatherAppendixEntries(
  filePath: string,
  attachments: readonly AttachmentInfo[],
): Promise<AttachmentAppendixEntry[]> {
  const out: AttachmentAppendixEntry[] = [];
  // Cache icon data URLs by "kind" so a project with five PDFs only
  // rasterizes the red-PDF icon once, not five times.
  const iconCache = new Map<string, string>();
  for (const a of attachments) {
    const base: AttachmentAppendixEntry = {
      name: a.name,
      mimeType: a.mimeType,
      byteLength: a.byteLength,
    };
    if (!isInlinableImageMime(a.mimeType)) {
      // Non-image attachment — hand pdfmake a rasterized file-type
      // icon (PNG data URL) so the PDF appendix shows a consistent
      // visual cue for each file kind (PDF, XLS, DOC, …). Fall back
      // to no dataUrl if icon generation fails (e.g. canvas not
      // available in a headless test).
      const kind = fileKindFor(a.mimeType, a.name);
      let iconUrl = iconCache.get(kind);
      if (!iconUrl) {
        try {
          iconUrl = renderFileTypeIconDataUrl(kind);
        } catch {
          iconUrl = undefined;
        }
        if (iconUrl) iconCache.set(kind, iconUrl);
      }
      if (iconUrl) {
        out.push({ ...base, dataUrl: iconUrl });
      } else {
        out.push(base);
      }
      continue;
    }
    // Image — pull bytes and encode.
    try {
      const res = await window.molio.readAttachmentBytes({
        path: filePath,
        attachmentId: a.id,
      });
      if (res.kind === "ok") {
        out.push({ ...base, dataUrl: bytesToDataUrl(res.bytes, res.mimeType) });
      } else {
        // not-found or error — keep the row, drop the thumbnail.
        out.push(base);
      }
    } catch {
      out.push(base);
    }
  }
  return out;
}

/**
 * Classify an attachment into a known file-type "kind" we render a
 * colored icon for. Falls back to "generic" for anything we don't
 * recognise. Uses both mime type and filename extension so office
 * files with the older application/octet-stream upload mime still
 * map correctly.
 */
type FileKind = "pdf" | "doc" | "xls" | "ppt" | "txt" | "zip" | "generic";

function fileKindFor(mime: string, name: string): FileKind {
  const m = (mime || "").toLowerCase();
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (
    m === "application/msword" ||
    m ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "doc" ||
    ext === "docx"
  )
    return "doc";
  if (
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xls" ||
    ext === "xlsx"
  )
    return "xls";
  if (
    m === "application/vnd.ms-powerpoint" ||
    m ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "ppt" ||
    ext === "pptx"
  )
    return "ppt";
  if (m.startsWith("text/") || ext === "txt" || ext === "md") return "txt";
  if (
    m === "application/zip" ||
    m === "application/x-zip-compressed" ||
    ext === "zip"
  )
    return "zip";
  return "generic";
}

/**
 * Paint a square file-type icon onto a hidden <canvas> and return it
 * as a PNG data URL. pdfmake accepts PNG data URLs directly via the
 * `image:` property. Icon design is a solid rounded rectangle with
 * a folded corner + the 3-letter tag (PDF / XLS / DOC / …) centered.
 *
 * Runs in the renderer only — pdfmake rendering itself happens here
 * too, so this is the right place.
 */
function renderFileTypeIconDataUrl(kind: FileKind): string {
  const SIZE = 150; // matches the builder's `fit: [150, 150]` cap
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  const palette: Record<FileKind, { bg: string; fg: string; tag: string }> = {
    pdf: { bg: "#e5484d", fg: "#ffffff", tag: "PDF" },
    doc: { bg: "#2b6cb0", fg: "#ffffff", tag: "DOC" },
    xls: { bg: "#2f855a", fg: "#ffffff", tag: "XLS" },
    ppt: { bg: "#dd6b20", fg: "#ffffff", tag: "PPT" },
    txt: { bg: "#4a5568", fg: "#ffffff", tag: "TXT" },
    zip: { bg: "#805ad5", fg: "#ffffff", tag: "ZIP" },
    generic: { bg: "#718096", fg: "#ffffff", tag: "FIL" },
  };
  const p = palette[kind];

  // Card: a letter-shaped rect with a folded top-right corner.
  const pad = 18;
  const fold = 32;
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(SIZE - pad - fold, pad);
  ctx.lineTo(SIZE - pad, pad + fold);
  ctx.lineTo(SIZE - pad, SIZE - pad);
  ctx.lineTo(pad, SIZE - pad);
  ctx.closePath();
  ctx.fill();

  // Folded-corner triangle (slightly darker shade via alpha).
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.moveTo(SIZE - pad - fold, pad);
  ctx.lineTo(SIZE - pad - fold, pad + fold);
  ctx.lineTo(SIZE - pad, pad + fold);
  ctx.closePath();
  ctx.fill();

  // Tag text: 3-letter kind, bold, centered in the card body.
  ctx.fillStyle = p.fg;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.tag, SIZE / 2, SIZE / 2 + 10);

  return canvas.toDataURL("image/png");
}

/**
 * Build a `data:<mime>;base64,<...>` URL from a Uint8Array. pdfmake
 * accepts these directly as the `image` value.
 */
function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  // btoa expects a binary string. Chunk the array so we don't overflow
  // the call stack on large files (Array.from would allocate one big
  // string; this keeps memory steady).
  let binary = "";
  const chunkSize = 0x8000; // 32KB
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  const b64 = btoa(binary);
  return `data:${mimeType};base64,${b64}`;
}
