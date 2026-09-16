/**
 * Slice "Version compare PDF" — version-summary builder.
 *
 * Takes the `Revision[]` produced by `compareVersions(current,
 * reference)` and produces a single self-contained pdfmake doc
 * definition listing every revision, grouped by spec (work area or
 * BDB) and ordered by hierarchical path. The output is meant as a
 * **printable mirror of the on-screen Revisions tab** — same shape,
 * same grouping, same ordering, no detailed diff content.
 *
 * Pure builder: no DOM, no I/O. Tests instantiate the doc-def
 * directly and assert on its shape. The renderer wrapper lives in
 * `renderPdf.ts` next to `renderSpecPdf` / `renderCpPdf`.
 *
 * Layout
 * ------
 * - **Cover page** (optional) — same `makeCover` chrome the spec PDF
 *   uses, so the document feels visually consistent with the
 *   per-spec exports it accompanies. Title is the user's project
 *   name; subtitle is the localized "Version summary" label.
 * - **Body** — a flat run of "spec sections", each a heading row
 *   followed by the revisions belonging to that spec (sections + CP
 *   rows + attachments interleaved per the same comparator the
 *   on-screen tab uses).
 *
 * Things this builder DELIBERATELY does NOT do
 * --------------------------------------------
 * - No detailed diff content (no before/after bodies, no segment
 *   spans). The full track-changes view is the marked spec PDF —
 *   this is the index.
 * - No clickable jump-links from a row into the corresponding spec
 *   PDF. Those PDFs are separate files; cross-PDF links are out of
 *   scope for v1.
 */

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import type {
  AttachmentRevision,
  CpRowRevision,
  Revision,
  RevisionParent,
  SectionRevision,
  WholeSpecRevision,
} from "../compare/compareTypes.js";
import { comparePathNumeric } from "../compare/sectionPath.js";
import {
  makeCover,
  makeFooter,
  makeHeader,
  STANDARD_PAGE_MARGINS_PT,
  type PdfChromeArgs,
} from "./pdfChrome.js";

/** Arguments the builder needs to produce a doc-def. */
export interface BuildVersionSummaryArgs {
  /** Project name for the cover + the running header. */
  projectName: string | null;
  /** Reference file's display name (e.g. "WIP …moliospec"), shown
   *  on the cover so the reader knows what was being compared. */
  referenceLabel: string | null;
  /** Company-name placeholder, threaded through the chrome. */
  companyName: string;
  /** Footer date — defaults to today's ISO if not supplied. */
  dateText?: string | null;
  /** When false, skip the cover page and start at the summary list.
   *  Default true to match the spec PDFs. */
  includeCoverPage?: boolean;
  /** The full revision list, as produced by `compareVersions`. */
  revisions: ReadonlyArray<Revision>;
  /**
   * Localized strings — the builder is i18n-blind so callers feed
   * the labels in. Lets tests use English literals without booting
   * the i18n catalogs.
   */
  strings: SummaryStrings;
}

/** All localized strings the builder uses. */
export interface SummaryStrings {
  /** Page title shown on the cover + body heading. */
  documentTitle: string;
  /** "Reference file:" label on the cover. */
  referenceLabel: string;
  /** "No changes" empty state. */
  noChangesText: string;
  /** "Sections" sub-heading for the section-revision block. */
  sectionsHeader: string;
  /** "Control plan rows" sub-heading. */
  cpRowsHeader: string;
  /** "Attachments" sub-heading. */
  attachmentsHeader: string;
  /** Map a `RevisionKind` to its display label ("Added", etc.). */
  kindLabel: Record<"added" | "deleted" | "modified", string>;
  /** "Sections in spec: N" sentence for whole-spec revisions. */
  wholeSpecCount: (count: number) => string;
  /** Map `slot` to display label (design / production). */
  cpSlotLabel: Record<"design" | "production", string>;
}

/** Pure builder. */
export function buildVersionSummaryPdf(
  args: BuildVersionSummaryArgs,
): TDocumentDefinitions {
  const {
    projectName,
    referenceLabel,
    companyName,
    dateText,
    includeCoverPage = true,
    revisions,
    strings,
  } = args;

  const chromeArgs: PdfChromeArgs = {
    projectName: projectName ?? null,
    workAreaName: null,
    documentLabel: strings.documentTitle,
    companyName,
    dateText: dateText ?? todayISO(),
    revisionDateText: null,
  };

  const content: Content[] = [];

  if (includeCoverPage) {
    content.push(
      ...makeCover({
        ...chromeArgs,
        title: projectName ?? strings.documentTitle,
        subtitle: strings.documentTitle,
        revision: null,
        revisionDate: null,
        contractLabel: referenceLabel
          ? `${strings.referenceLabel} ${referenceLabel}`
          : null,
      }),
    );
  }

  // Body title — mirrors the spec PDFs' "title" line above the
  // section content.
  content.push({ text: strings.documentTitle, style: "title" });
  if (referenceLabel) {
    content.push({
      text: `${strings.referenceLabel} ${referenceLabel}`,
      style: "subtitle",
    });
  }

  if (revisions.length === 0) {
    content.push({
      text: strings.noChangesText,
      style: "empty",
      italics: true,
    });
  } else {
    appendGroupedRevisions(content, revisions, strings);
  }

  return {
    pageSize: "A4",
    pageMargins: STANDARD_PAGE_MARGINS_PT,
    header: makeHeader(chromeArgs, undefined, includeCoverPage),
    footer: makeFooter(chromeArgs, undefined, includeCoverPage),
    content,
    defaultStyle: { fontSize: 10 },
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 12, color: "#555", margin: [0, 0, 0, 18] },
      specHeading: {
        fontSize: 14,
        bold: true,
        margin: [0, 14, 0, 4],
      },
      specSubHeading: {
        fontSize: 9,
        color: "#555",
        margin: [0, 0, 0, 6],
      },
      groupSubHeader: {
        fontSize: 9,
        color: "#777",
        bold: true,
        margin: [0, 4, 0, 2],
      },
      revisionRow: {
        fontSize: 10,
        margin: [12, 0, 0, 2],
      },
      revisionRowKind: {
        fontSize: 8,
        bold: true,
      },
      empty: { fontSize: 10, color: "#888" },
    },
    info: {
      title: strings.documentTitle,
      creator: "Spec Editor Community",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Grouping + per-spec layout                                        */
/* ------------------------------------------------------------------ */

interface SpecGroup {
  /** Stable group key — `parent.key` for section/cpRow/wholeSpec; for
   *  attachment revisions we synthesise from `workAreaKey`. */
  key: string;
  label: string;
  parentLabel: string | null;
  wholeSpec: WholeSpecRevision | null;
  sections: SectionRevision[];
  cpRows: CpRowRevision[];
  attachments: AttachmentRevision[];
}

/**
 * Build per-spec groups in the same insertion order as the on-screen
 * Revisions tab (compareVersions emits work areas first, BDBs nested
 * under, attachments at the tail). Within each group we sort the
 * three revision lists with the same comparator the tab uses.
 */
function buildSpecGroups(revisions: ReadonlyArray<Revision>): SpecGroup[] {
  const byKey = new Map<string, SpecGroup>();
  function ensure(
    key: string,
    label: string,
    parentLabel: string | null,
  ): SpecGroup {
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        label,
        parentLabel,
        wholeSpec: null,
        sections: [],
        cpRows: [],
        attachments: [],
      };
      byKey.set(key, g);
    }
    return g;
  }
  function info(p: RevisionParent): {
    key: string;
    label: string;
    parentLabel: string | null;
  } {
    return {
      key: p.key,
      label: p.label,
      parentLabel: p.kind === "bdb" ? (p.workAreaLabel ?? null) : null,
    };
  }
  for (const r of revisions) {
    if (r.type === "wholeSpec") {
      const i = info(r.parent);
      ensure(i.key, i.label, i.parentLabel).wholeSpec = r;
      continue;
    }
    if (r.type === "section") {
      const i = info(r.parent);
      ensure(i.key, i.label, i.parentLabel).sections.push(r);
      continue;
    }
    if (r.type === "cpRow") {
      const i = info(r.parent);
      ensure(i.key, i.label, i.parentLabel).cpRows.push(r);
      continue;
    }
    // Attachment — group under its work area.
    const k = `wa::${r.workAreaKey}::attachments`;
    ensure(k, r.workAreaLabel, null).attachments.push(r);
  }
  // Sort each group's lists in display order. Sections + CP rows by
  // hierarchical path; attachments alphabetically.
  for (const g of byKey.values()) {
    g.sections.sort((a, b) => comparePathNumeric(a.sectionPath, b.sectionPath));
    g.cpRows.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot === "design" ? -1 : 1;
      return comparePathNumeric(a.sectionNo, b.sectionNo);
    });
    g.attachments.sort((a, b) => a.name.localeCompare(b.name));
  }
  return Array.from(byKey.values());
}

/** Append the grouped revision content to the running `content` array. */
function appendGroupedRevisions(
  content: Content[],
  revisions: ReadonlyArray<Revision>,
  strings: SummaryStrings,
): void {
  const groups = buildSpecGroups(revisions);
  for (const g of groups) {
    // Spec heading row.
    if (g.parentLabel) {
      content.push({ text: g.parentLabel, style: "specSubHeading" });
    }
    content.push({ text: g.label, style: "specHeading" });

    // Whole-spec collapse — render as a single line, no children.
    if (g.wholeSpec) {
      const kindLbl = strings.kindLabel[g.wholeSpec.kind];
      const countSentence = strings.wholeSpecCount(g.wholeSpec.sectionCount);
      content.push({
        text: [
          { text: kindLbl, style: "revisionRowKind" },
          "  ",
          { text: countSentence },
        ],
        style: "revisionRow",
      });
      continue;
    }

    if (g.sections.length > 0) {
      content.push({ text: strings.sectionsHeader, style: "groupSubHeader" });
      for (const sec of g.sections) {
        content.push(renderSectionRow(sec, strings));
      }
    }
    if (g.cpRows.length > 0) {
      content.push({ text: strings.cpRowsHeader, style: "groupSubHeader" });
      for (const row of g.cpRows) {
        content.push(renderCpRow(row, strings));
      }
    }
    if (g.attachments.length > 0) {
      content.push({
        text: strings.attachmentsHeader,
        style: "groupSubHeader",
      });
      for (const att of g.attachments) {
        content.push(renderAttachmentRow(att, strings));
      }
    }
  }
}

function renderSectionRow(
  rev: SectionRevision,
  strings: SummaryStrings,
): Content {
  const kindLbl = strings.kindLabel[rev.kind];
  const text = rev.heading
    ? `${rev.sectionPath}  ${rev.heading}`
    : rev.sectionPath;
  return {
    text: [
      { text: kindLbl, style: "revisionRowKind", color: kindColor(rev.kind) },
      "  ",
      { text },
    ],
    style: "revisionRow",
  };
}

function renderCpRow(rev: CpRowRevision, strings: SummaryStrings): Content {
  const kindLbl = strings.kindLabel[rev.kind];
  const slotLbl = strings.cpSlotLabel[rev.slot];
  const text = `${slotLbl}  ·  ${rev.sectionNo}`;
  return {
    text: [
      { text: kindLbl, style: "revisionRowKind", color: kindColor(rev.kind) },
      "  ",
      { text },
    ],
    style: "revisionRow",
  };
}

function renderAttachmentRow(
  rev: AttachmentRevision,
  strings: SummaryStrings,
): Content {
  const kindLbl = strings.kindLabel[rev.kind];
  return {
    text: [
      { text: kindLbl, style: "revisionRowKind", color: kindColor(rev.kind) },
      "  ",
      { text: rev.name },
    ],
    style: "revisionRow",
  };
}

/**
 * Subtle colour cue for kind pills. Mirrors the on-screen
 * RevisionsView KindPill colours (green / red / blue) so the printed
 * version reads consistently with the live tab.
 */
function kindColor(kind: "added" | "deleted" | "modified"): string {
  if (kind === "added") return "#16a34a";
  if (kind === "deleted") return "#dc2626";
  return "#2563eb";
}

/** Today's date as ISO (YYYY-MM-DD). Same helper used by buildSpecPdf. */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
