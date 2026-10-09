/**
 * Task 184 - keep the section "Gældende dato for referencer: …" in
 * step with the reference-list date (fiksdato).
 *
 * The date lives twice in a .moliospec file: as columns (project, work
 * area, BDB) and as free text in one section of every description. The
 * reader of the finished document only sees the text, and nothing kept
 * the two together - a customer set the date and the PDF still said
 * "<x>". This file decides, for each description, whether that section
 * can be rewritten and what it should say. It does not touch the edit
 * map; App.tsx stages the result as ordinary section-body edits, so
 * they show as pending, can be undone and reach disk on ⌘S.
 *
 * Measured on 34 real .moliospec files (2026-10-08, see Task 184):
 *  - The section cannot be found by number (2.4.1, 2.5, 2.4 ...) or by
 *    `molio_section_guid` (15 different values). It CAN be found by
 *    its text: exactly one section per description starts with
 *    "Gældende dato for referencer".
 *  - "<x>" is Molio's general placeholder and also appears in the next
 *    lines, so it is never searched for.
 *  - In 12 of 66 descriptions the same section continues with more
 *    text ("Udover … er følgende referencer gældende:" and lists, once
 *    with text the user wrote). The owner's decision (2026-10-08):
 *    only the date line is replaced, the rest is kept.
 *
 * Pure: no React, no DOM, no I/O.
 */

import type { FilePayload } from "../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveBdbField,
  getEffectiveBody,
  getEffectiveProjectField,
  getEffectiveWorkSpecField,
  isPendingDelete,
  isSectionTombstoned,
} from "./edits.js";
import { resolveReferencelistDateOnly } from "./referencelistDates.js";

export const REFERENCELIST_DATE_PHRASE = "Gældende dato for referencer";

/** Visible text starts with the phrase, with or without a space before
 *  the colon (Molio writes both). */
const STARTS_WITH_PHRASE = /^Gældende dato for referencer\s*:/;

/** The date line on its own: the phrase, a colon and at most one more
 *  word (the date, "<x>", or a free-text date like "31.11.2023"). */
const DATE_LINE_ONLY = /^Gældende dato for referencer\s*:\s*\S*\s*$/;

/** Block-level tags that end a plain-text date line. */
const BLOCK_START = /<(p|ul|ol|table|h[1-6]|div|blockquote)\b/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  aelig: "æ",
  oslash: "ø",
  aring: "å",
  AElig: "Æ",
  Oslash: "Ø",
  Aring: "Å",
  eacute: "é",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

/** The text a reader sees: tags removed, entities decoded, whitespace
 *  collapsed. */
export function visibleText(html: string | null | undefined): string {
  const noTags = (html ?? "").replace(/<[^>]*>/g, " ");
  return decodeEntities(noTags)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when this section is the "Gældende dato for referencer" one. */
export function isReferencelistDateSection(
  body: string | null | undefined,
): boolean {
  return STARTS_WITH_PHRASE.test(visibleText(body));
}

/** The exact text the date line gets (owner's decision, Task 184). */
export function referencelistDateLine(date: string): string {
  return `<p>${REFERENCELIST_DATE_PHRASE}: ${date}</p>`;
}

/**
 * Replace only the date line at the top of `body`, keeping everything
 * after it. Returns null when the first line holds more than the phrase
 * and one value - then it is not safe to know where the date line ends,
 * and the section is left alone.
 *
 *  - Body starts with `<p>`: the first `<p>…</p>` is the date line.
 *  - Body starts with plain text (Molio writes "Gældende dato for
 *    referencer: <br>\n2022-08-26" without a paragraph): the date line
 *    runs up to the first block-level tag, or the end.
 */
export function replaceReferencelistDateLine(
  body: string,
  date: string,
): string | null {
  const leading = /^\s*/.exec(body)?.[0] ?? "";
  const rest = body.slice(leading.length);
  let lineEnd: number;
  if (/^<p\b/i.test(rest)) {
    const close = rest.search(/<\/p\s*>/i);
    if (close < 0) return null;
    const closeTag = /<\/p\s*>/i.exec(rest.slice(close));
    lineEnd = close + (closeTag ? closeTag[0].length : 0);
  } else {
    const block = rest.search(BLOCK_START);
    lineEnd = block < 0 ? rest.length : block;
  }
  const line = rest.slice(0, lineEnd);
  if (!DATE_LINE_ONLY.test(visibleText(line))) return null;
  return referencelistDateLine(date) + rest.slice(lineEnd);
}

/** One section as the planner needs it. */
export interface DateTextSection {
  id: number;
  /** Effective body: the pending edit if there is one, else disk. */
  body: string;
  /** Body on disk - the edit helpers need it to detect a revert. */
  diskBody: string;
}

/** One description (work area or BDB) as the planner needs it. */
export interface DateTextSpec {
  kind: "workSpec" | "bdb";
  id: number;
  name: string;
  /** The date that applies to it (BDB > work area > project), or null. */
  date: string | null;
  sections: readonly DateTextSection[];
}

export interface DateTextUpdate {
  kind: "workSpec" | "bdb";
  specId: number;
  specName: string;
  sectionId: number;
  date: string;
  newBody: string;
  diskBody: string;
}

export interface DateTextPlan {
  /** Sections that will get a new date line. */
  updates: DateTextUpdate[];
  /** Descriptions with MORE than one matching section - rule 3: not
   *  touched, the user is told which. */
  ambiguous: { kind: "workSpec" | "bdb"; id: number; name: string }[];
  /** Descriptions whose date line holds more than the phrase and one
   *  value, so where it ends is unclear - not touched, user is told. */
  unsafe: { kind: "workSpec" | "bdb"; id: number; name: string }[];
  /** Descriptions whose date line already says the right thing - rule
   *  5: not counted. */
  alreadyCorrect: number;
}

/**
 * Decide what to write. Rules (Task 184):
 *  1. The section is the one whose visible text STARTS with the phrase.
 *  2. Zero matches in a description: nothing is touched.
 *  3. More than one match: nothing is touched, it is reported.
 *  4. No date applies to the description: nothing is touched.
 *  5. Already exactly right: not counted.
 */
export function planReferencelistDateText(
  specs: readonly DateTextSpec[],
): DateTextPlan {
  const plan: DateTextPlan = {
    updates: [],
    ambiguous: [],
    unsafe: [],
    alreadyCorrect: 0,
  };
  for (const spec of specs) {
    const hits = spec.sections.filter((s) =>
      isReferencelistDateSection(s.body),
    );
    if (hits.length === 0) continue;
    const who = { kind: spec.kind, id: spec.id, name: spec.name };
    if (hits.length > 1) {
      plan.ambiguous.push(who);
      continue;
    }
    const hit = hits[0];
    if (spec.date === null || !hit) continue;
    const newBody = replaceReferencelistDateLine(hit.body, spec.date);
    if (newBody === null) {
      plan.unsafe.push(who);
      continue;
    }
    if (newBody === hit.body) {
      plan.alreadyCorrect += 1;
      continue;
    }
    plan.updates.push({
      kind: spec.kind,
      specId: spec.id,
      specName: spec.name,
      sectionId: hit.id,
      date: spec.date,
      newBody,
      diskBody: hit.diskBody,
    });
  }
  return plan;
}

/** Keep only the descriptions whose applicable date differs between two
 *  states - "the descriptions whose date changed" (Task 184, trigger 1). */
export function specsWhoseDateChanged(
  before: readonly DateTextSpec[],
  after: readonly DateTextSpec[],
): DateTextSpec[] {
  const old = new Map(before.map((s) => [`${s.kind}:${s.id}`, s.date]));
  return after.filter((s) => old.get(`${s.kind}:${s.id}`) !== s.date);
}

/**
 * Every description in the file, with its effective sections and the
 * date that applies to it, as seen through `edits`. Calling this with
 * the edit map from before and after a dialog tells which dates changed.
 *
 * Left out on purpose:
 *  - descriptions marked for deletion, and sections marked for deletion;
 *  - PFBB child BDBs: their text comes from the PFBB master and is
 *    updated there, against the master's own date. A child's own rows
 *    are supplements, and those are edited through a different key.
 */
export function buildDateTextSpecs(
  data: FilePayload,
  edits: EditMap,
): DateTextSpec[] {
  const projectDate = getEffectiveProjectField(
    edits,
    "molioReferencelistDate",
    data.project?.moliioReferencelistDate ?? null,
  ) as string | null;
  const wsDate = new Map<number, string | null>();
  for (const ws of data.workSpecs) {
    wsDate.set(
      ws.id,
      getEffectiveWorkSpecField(
        edits,
        ws.id,
        "referencelistAreaDate",
        ws.refs.referencelistAreaDate,
      ) as string | null,
    );
  }
  const sectionsOf = (
    kind: "workSpec" | "bdb",
    rows: ReadonlyArray<{ id: number; body: string | null }>,
  ): DateTextSection[] =>
    rows
      .filter((r) => !isSectionTombstoned(edits, kind, r.id))
      .map((r) => ({
        id: r.id,
        body: getEffectiveBody(edits, kind, r.id, r.body ?? ""),
        diskBody: r.body ?? "",
      }));

  const out: DateTextSpec[] = [];
  for (const ws of data.workSpecs) {
    if (isPendingDelete(edits, "workSpec", ws.id)) continue;
    out.push({
      kind: "workSpec",
      id: ws.id,
      name: ws.workAreaName,
      date: resolveReferencelistDateOnly([wsDate.get(ws.id), projectDate]),
      sections: sectionsOf("workSpec", data.sectionsByWorkSpec[ws.id] ?? []),
    });
  }
  for (const bdb of data.bdbs) {
    if (isPendingDelete(edits, "bdb", bdb.id)) continue;
    if (bdb.pfbbId != null) continue;
    const own = getEffectiveBdbField(
      edits,
      bdb.id,
      "referencelistAreaDate",
      bdb.refs.referencelistAreaDate,
    ) as string | null;
    out.push({
      kind: "bdb",
      id: bdb.id,
      name: bdb.name,
      date: resolveReferencelistDateOnly([
        own,
        bdb.workSpecId != null ? wsDate.get(bdb.workSpecId) : null,
        projectDate,
      ]),
      sections: sectionsOf("bdb", data.sectionsByBdb[bdb.id] ?? []),
    });
  }
  return out;
}
