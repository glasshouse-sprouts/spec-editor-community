/**
 * Card 188 - the pure text rule behind "Gældende dato for referencer: …"
 * (task 184), shared with the MCP server.
 *
 * The editor keeps that section in step with the reference-list date
 * (fiksdato); see the long note in the renderer's
 * `packages/app/src/renderer/src/referencelistDateText.ts` for how the
 * section is found and why only its first line is replaced. The MCP
 * server writes the date too (`update_project_metadata`) and must
 * follow the same rule, but cannot import the renderer, and the
 * renderer cannot import core. So the functions from
 * `REFERENCELIST_DATE_PHRASE` to `specsWhoseDateChanged` exist twice,
 * word for word; a test runs both over the same texts and requires the
 * same answer (`packages/mcp-server/test/referencelistDateTextParity.test.ts`).
 *
 * What is only here: `buildDateTextSpecsFromFile`, which reads the
 * descriptions straight from a `MoliospecFile` (the MCP server has no
 * edit map), with the date resolved by core's own rule.
 *
 * Pure: no I/O.
 */

import { resolveReferencelistDate } from "./referencelistDate.js";
import type { MoliospecFile } from "./types.js";

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
 * Every description in the file with its sections and the date that
 * applies to it, when the project date is `projectDate`. Calling it
 * with the old and the new project date tells which dates changed.
 *
 * Mirrors the renderer's `buildDateTextSpecs` without the edit map:
 * PFBB child BDBs are left out (their text is the master's, updated
 * against the master's date).
 */
export function buildDateTextSpecsFromFile(
  data: MoliospecFile,
  projectDate: string | null,
): DateTextSpec[] {
  const dateOf = (
    bdbDate: string | null,
    wsDate: string | null,
  ): string | null =>
    resolveReferencelistDate([
      { source: "bdb", value: bdbDate },
      { source: "workArea", value: wsDate },
      { source: "project", value: projectDate },
    ]).date;
  const toSections = (
    rows: ReadonlyArray<{ id: number; body: string | null }>,
  ): DateTextSection[] =>
    rows.map((r) => ({ id: r.id, body: r.body ?? "", diskBody: r.body ?? "" }));

  const wsDate = new Map(
    data.workSpecs.map((ws) => [ws.id, ws.molio_referencelist_area_date]),
  );
  const out: DateTextSpec[] = [];
  for (const ws of data.workSpecs) {
    out.push({
      kind: "workSpec",
      id: ws.id,
      name: ws.work_area_name,
      date: dateOf(null, ws.molio_referencelist_area_date),
      sections: toSections(
        data.workSpecSections.filter((s) => s.work_spec_id === ws.id),
      ),
    });
  }
  for (const bdb of data.constructionElementSpecs) {
    if (bdb.pfbb_id != null) continue;
    out.push({
      kind: "bdb",
      id: bdb.id,
      name: bdb.name,
      date: dateOf(
        bdb.molio_referencelist_area_date,
        bdb.work_spec_id != null
          ? (wsDate.get(bdb.work_spec_id) ?? null)
          : null,
      ),
      sections: toSections(
        data.constructionElementSpecSections.filter(
          (s) => s.construction_element_spec_id === bdb.id,
        ),
      ),
    });
  }
  return out;
}
