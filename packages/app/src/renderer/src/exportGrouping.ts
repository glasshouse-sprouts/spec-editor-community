/**
 * Grouping helper for PDF export.
 *
 * Takes the modal's check-state tree + a `groupBy` mode and returns a
 * flat list of "PDF job plans" — one per output file. The executor
 * (useExportController) walks these in order, building each PDF via
 * either `buildSpecPdf` (single-spec mode) or `buildCompositePdf`
 * (one of the new composite modes).
 *
 * Why a separate "plan" data structure rather than emitting bytes
 * directly:
 *   - The plan is pure-data and trivially testable (no PDF runtime).
 *   - Some chapters need their attachments loaded from disk, which
 *     is async — the plan keeps the IO concerns out of the routing
 *     logic.
 *   - The same plan shape will be reused for the moliospec export
 *     slice that ships next.
 *
 * Grouping semantics (confirmed with Tore 2026-05-11):
 *   - `perSpec`   — current default. One PDF per checked work area
 *     and one per checked BDB. Matches today's behaviour exactly.
 *   - `perWorkArea` — one PDF per work area that has any descendant
 *     selected. Each PDF contains the work area's own intro
 *     sections + every selected BDB under it. If a WA is checked
 *     standalone (no checked BDBs) we still emit a PDF with just
 *     the WA chapter.
 *   - `perContract` — one PDF per contract with any descendant
 *     selected. Each PDF contains every WA chapter (if its WA had
 *     descendants selected) plus the BDBs under it.
 *   - `perProject`  — one PDF for the whole project, with chapters
 *     for every selected piece.
 *
 * Control plans are the exception to all four modes (Task 109,
 * Tore 2026-09-09): a checked control plan ALWAYS becomes its own
 * standalone PDF, never a chapter inside a composite. A control
 * schedule is a self-contained document in practice — it gets sent
 * around and filled in on its own — and it is rendered landscape
 * (`pdf/pdfChrome.ts`), so it cannot simply be dropped into a
 * portrait composite. `buildControlPlanJobs` owns that rule, and all
 * four modes call it, so the next mode added inherits it.
 *
 * Filenames (defaults):
 *   - Always prefixed with the project name.
 *   - Per spec: `<project>_<spec name>.pdf`
 *   - Per WA:   `<project>_<WA code-name>.pdf`
 *   - Per ctr:  `<project>_<contract code-name>.pdf`
 *   - Per proj: `<project>.pdf`
 *
 * Filename collision resolution (the WA / contract names can clash
 * across contracts in a project) is left to the executor via the
 * shared `dedupeFileBases` helper.
 */
import type { FilePayload } from "../../shared/ipc.js";
import type {
  ExportSelection,
  ExportTree,
  ExportTreeContractGroup,
  ExportTreeWorkAreaNode,
} from "./exportTree.js";

/** How the export modal groups output files. */
export type ExportGroupBy =
  | "perSpec"
  | "perWorkArea"
  | "perContract"
  | "perProject";

/** One chapter inside a composite PDF, identified by its source target. */
export interface CompositeChapterPlan {
  kind: "workSpec" | "bdb";
  /** work_spec.id or construction_element_spec.id, depending on `kind`. */
  targetId: number;
  /** Display title for the chapter heading. */
  title: string;
  /** Optional subtitle (e.g. WA code, BDB revision). */
  subtitle: string | null;
}

/**
 * One output file the user will get. Discriminated union: `single`
 * hands off to `buildSpecPdf` (the existing per-target path);
 * `composite` hands off to `buildCompositePdf`.
 */
export type PdfExportJob =
  | {
      kind: "single";
      filename: string;
      target:
        | { kind: "workSpec"; id: number }
        | { kind: "bdb"; id: number }
        | { kind: "cp"; id: number };
      contractLabel: string | null;
    }
  | {
      kind: "composite";
      filename: string;
      cover: {
        title: string;
        subtitle: string | null;
        contractLabel: string | null;
      };
      chapters: CompositeChapterPlan[];
    };

export interface BuildPdfExportJobsArgs {
  data: FilePayload;
  tree: ExportTree;
  selection: ExportSelection;
  groupBy: ExportGroupBy;
}

/**
 * Strip path-illegal characters from a filename segment + normalise
 * fancy dashes to a plain ASCII hyphen.
 *
 * Two passes:
 *   1. Path-illegal characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`,
 *      `>`, `|`) and the ASCII control range → `_`.
 *   2. Em-dash `—` (U+2014), en-dash `–` (U+2013), minus sign `−`
 *      (U+2212), horizontal bar `―` (U+2015) and figure dash `‒`
 *      (U+2012) → regular hyphen `-`. Spaces around the dash are
 *      preserved (so " — " becomes " - "), which keeps filenames
 *      readable.
 *
 * Tore's call (2026-05-13): filenames should use only ASCII dashes.
 * Some downstream tooling (Windows-side PDF batch processors, email
 * attachments through SMTP gateways that mangle non-ASCII) chokes on
 * em-dashes; mapping every fancy dash to `-` sidesteps the problem
 * for both PDF and Word.
 *
 * Without this, a BDB or work area named "Foo/Bar" produces
 * `Foo/Bar.pdf` which the OS interprets as "Bar.pdf inside folder
 * Foo" — and the write fails because the directory doesn't exist.
 *
 * Exported so the Word export (`useDocxExport`) can use exactly the
 * same rule — guarantees PDF and Word filenames for the same spec
 * are identical except for the `.pdf` / `.docx` extension.
 */
export function sanitiseFilePart(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[‒–—―−]/g, "-");
}

/**
 * Build the list of PDF jobs for the current selection + groupBy.
 *
 * Pure: same input → same output. Doesn't touch disk, doesn't render
 * PDFs. The executor takes this list and produces the actual files.
 */
export function buildPdfExportJobs(
  args: BuildPdfExportJobsArgs,
): PdfExportJob[] {
  const { data, tree, selection, groupBy } = args;
  const projectName = sanitiseFilePart(
    (data.project?.name ?? "").trim() || "Project",
  );

  if (groupBy === "perSpec") {
    return buildPerSpecJobs(tree, selection, projectName);
  }
  if (groupBy === "perWorkArea") {
    return buildPerWorkAreaJobs(tree, selection, projectName);
  }
  if (groupBy === "perContract") {
    return buildPerContractJobs(tree, selection, projectName);
  }
  return buildPerProjectJobs(tree, selection, projectName);
}

// ---------------------------------------------------------------------------
// Per spec — the legacy / default mode. One PDF per checked WA + one per
// checked BDB. Preserves the current export behaviour exactly so the
// "perSpec" default change is purely additive UI.
// ---------------------------------------------------------------------------

function buildPerSpecJobs(
  tree: ExportTree,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob[] {
  const jobs: PdfExportJob[] = [];
  for (const group of tree.contractGroups) {
    for (const wa of group.workAreas) {
      if (sel.workAreas.has(wa.id)) {
        jobs.push({
          kind: "single",
          filename: `${projectName}_${sanitiseFilePart(wa.label)}.pdf`,
          target: { kind: "workSpec", id: wa.id },
          contractLabel: group.label,
        });
      }
      for (const b of wa.bdbs) {
        if (sel.bdbs.has(b.id)) {
          jobs.push({
            kind: "single",
            filename: `${projectName}_${sanitiseFilePart(b.label)}.pdf`,
            target: { kind: "bdb", id: b.id },
            contractLabel: group.label,
          });
        }
      }
    }
  }
  for (const b of tree.standaloneBdbs) {
    if (sel.bdbs.has(b.id)) {
      jobs.push({
        kind: "single",
        filename: `${projectName}_${sanitiseFilePart(b.label)}.pdf`,
        target: { kind: "bdb", id: b.id },
        contractLabel: null,
      });
    }
  }
  jobs.push(...buildControlPlanJobs(tree, sel, projectName));
  return jobs;
}

// ---------------------------------------------------------------------------
// Control plans — one standalone PDF per checked CP, in EVERY grouping
// mode. See the note at the top of the file for why they never become
// chapters. Kept as a single helper so the rule lives in one place.
// ---------------------------------------------------------------------------

/**
 * One `single` job per checked control plan, in tree order (which is
 * payload order — the same order the modal lists them in).
 *
 * `contractLabel` is resolved through the CP's owning BDB: the tree
 * already recorded which BDB references the CP (`owningBdbId`), and
 * that BDB sits under exactly one contract group. A homeless CP (no
 * BDB references it) gets `null`, which the PDF builder already
 * handles by leaving the BIPS header cell blank.
 *
 * Filenames follow the same `<project>_<label>.pdf` shape as the other
 * single jobs. Two control plans with the same title therefore produce
 * the same filename here; `dedupeFileBases` in the executor resolves
 * that, exactly as it does for two identically named work areas.
 */
function buildControlPlanJobs(
  tree: ExportTree,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob[] {
  if (sel.cps.size === 0) return [];
  // BDB id → the label of the contract group its work area sits in.
  // Built from the tree so the label matches what the sibling BDB and
  // work-area jobs carry (including the synthetic "[No contract]"
  // bucket).
  const contractByBdbId = new Map<number, string>();
  for (const group of tree.contractGroups) {
    for (const wa of group.workAreas) {
      for (const b of wa.bdbs) contractByBdbId.set(b.id, group.label);
    }
  }
  const jobs: PdfExportJob[] = [];
  for (const cp of tree.controlPlans) {
    if (!sel.cps.has(cp.id)) continue;
    jobs.push({
      kind: "single",
      filename: `${projectName}_${sanitiseFilePart(cp.label)}.pdf`,
      target: { kind: "cp", id: cp.id },
      contractLabel:
        cp.owningBdbId != null
          ? (contractByBdbId.get(cp.owningBdbId) ?? null)
          : null,
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Per work area — one composite PDF per WA that has any descendant
// selected. Chapter order: WA's own intro sections (always — even
// when only BDBs were checked), then each selected BDB.
// ---------------------------------------------------------------------------

function buildPerWorkAreaJobs(
  tree: ExportTree,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob[] {
  const jobs: PdfExportJob[] = [];
  for (const group of tree.contractGroups) {
    for (const wa of group.workAreas) {
      const job = buildWorkAreaCompositeJob(wa, group, sel, projectName);
      if (job) jobs.push(job);
    }
  }
  jobs.push(...buildControlPlanJobs(tree, sel, projectName));
  return jobs;
}

/**
 * Builds one "per WA" composite job, or `null` when nothing inside
 * the work area is selected (the WA itself OR any of its BDBs).
 */
function buildWorkAreaCompositeJob(
  wa: ExportTreeWorkAreaNode,
  group: ExportTreeContractGroup,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob | null {
  const checkedBdbs = wa.bdbs.filter((b) => sel.bdbs.has(b.id));
  if (!sel.workAreas.has(wa.id) && checkedBdbs.length === 0) return null;

  // WA intro chapter is always present when the WA has descendants
  // in scope — even if the user only checked BDBs (Tore: "work_Area
  // content and contained BDB"). The chapter still appears with just
  // its heading + (no sections) placeholder when the WA has zero
  // sections of its own — the user sees "this WA had no intro text".
  const chapters: CompositeChapterPlan[] = [];
  chapters.push({
    kind: "workSpec",
    targetId: wa.id,
    title: wa.label,
    subtitle: null,
  });
  for (const b of checkedBdbs) {
    chapters.push({
      kind: "bdb",
      targetId: b.id,
      title: b.label,
      subtitle: null,
    });
  }

  return {
    kind: "composite",
    filename: `${projectName}_${sanitiseFilePart(wa.label)}.pdf`,
    cover: {
      title: wa.label,
      subtitle: group.label,
      contractLabel: group.label,
    },
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Per contract — one composite PDF per contract that has any
// descendant selected. Chapters in WA order; each WA contributes its
// own intro chapter + every selected BDB.
// ---------------------------------------------------------------------------

function buildPerContractJobs(
  tree: ExportTree,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob[] {
  const jobs: PdfExportJob[] = [];
  for (const group of tree.contractGroups) {
    const chapters: CompositeChapterPlan[] = [];
    for (const wa of group.workAreas) {
      const checkedBdbs = wa.bdbs.filter((b) => sel.bdbs.has(b.id));
      const waInScope = sel.workAreas.has(wa.id) || checkedBdbs.length > 0;
      if (!waInScope) continue;
      chapters.push({
        kind: "workSpec",
        targetId: wa.id,
        title: wa.label,
        subtitle: null,
      });
      for (const b of checkedBdbs) {
        chapters.push({
          kind: "bdb",
          targetId: b.id,
          title: b.label,
          subtitle: null,
        });
      }
    }
    if (chapters.length === 0) continue;
    jobs.push({
      kind: "composite",
      filename: `${projectName}_${sanitiseFilePart(group.label)}.pdf`,
      cover: {
        title: group.label,
        subtitle: null,
        contractLabel: group.label,
      },
      chapters,
    });
  }
  jobs.push(...buildControlPlanJobs(tree, sel, projectName));
  return jobs;
}

// ---------------------------------------------------------------------------
// Whole project — one composite PDF that walks every contract group
// the same way `perContract` does internally, but concatenated into a
// single output file.
// ---------------------------------------------------------------------------

function buildPerProjectJobs(
  tree: ExportTree,
  sel: ExportSelection,
  projectName: string,
): PdfExportJob[] {
  const chapters: CompositeChapterPlan[] = [];
  for (const group of tree.contractGroups) {
    for (const wa of group.workAreas) {
      const checkedBdbs = wa.bdbs.filter((b) => sel.bdbs.has(b.id));
      const waInScope = sel.workAreas.has(wa.id) || checkedBdbs.length > 0;
      if (!waInScope) continue;
      chapters.push({
        kind: "workSpec",
        targetId: wa.id,
        title: wa.label,
        subtitle: null,
      });
      for (const b of checkedBdbs) {
        chapters.push({
          kind: "bdb",
          targetId: b.id,
          title: b.label,
          subtitle: null,
        });
      }
    }
  }
  // Standalone BDBs (no work area) get appended at the tail.
  for (const b of tree.standaloneBdbs) {
    if (!sel.bdbs.has(b.id)) continue;
    chapters.push({
      kind: "bdb",
      targetId: b.id,
      title: b.label,
      subtitle: null,
    });
  }
  // Control plans stay outside the project-wide composite (see the
  // note at the top of the file) — they are appended as their own
  // files next to it. A selection of ONLY control plans therefore
  // produces no composite at all, just the CP files.
  const cpJobs = buildControlPlanJobs(tree, sel, projectName);
  if (chapters.length === 0) return cpJobs;
  return [
    {
      kind: "composite",
      filename: `${projectName}.pdf`,
      cover: {
        title: projectName,
        subtitle: null,
        contractLabel: null,
      },
      chapters,
    },
    ...cpJobs,
  ];
}
