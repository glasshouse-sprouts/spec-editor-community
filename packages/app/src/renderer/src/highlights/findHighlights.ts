/**
 * Walk a `FilePayload` and collect every formatting run (highlight
 * background or text color) the user has applied across every section
 * body in the project. Pure function: no I/O, no DOM mutation.
 *
 * Slice "Highlights & formatting" — used by the inspection modal in
 * the top header. Output drives the grouped list (one section per
 * mark kind) and the click-to-jump action.
 *
 * Implementation notes
 * --------------------
 * - Bodies are HTML strings already DOMPurified at load time
 *   (see `sanitizeLoadedFile.ts`), so we only have to look for the
 *   eight whitelisted classes — the sanitizer guarantees nothing else
 *   carries a class attribute. Still, we defensively guard against
 *   bodies that DOMPurify hasn't seen yet (e.g. test fixtures or a
 *   future code path) by querying tag + class together.
 * - The browser DOMParser builds a real DOM; we walk it once per
 *   section body. For typical projects (a few hundred sections, a
 *   few KB each) this is millisecond-level work and fine to run on
 *   every modal open. We don't memoise — the modal opens infrequently
 *   and the state recomputes cleanly when the payload changes.
 * - Section text content is captured fully; the modal truncates for
 *   display. Storing the full string lets us add features like
 *   "search within this list" later without rescanning.
 */

import type { FilePayload, SectionData } from "../../../shared/ipc.js";

import { ALL_MARK_KINDS, type MarkKind } from "./markKinds.js";

/**
 * Where a found highlight lives. The discriminator picks which of the
 * tree levels owns the section — we need both because work-area
 * sections and BDB sections live in disjoint id-spaces and the click-
 * to-jump handler routes to a different tab kind for each.
 */
export type HighlightLocation =
  | {
      kind: "workSpec";
      workSpecId: number;
      sectionId: number;
      sectionNo: number;
      heading: string;
    }
  | {
      kind: "bdb";
      bdbId: number;
      sectionId: number;
      sectionNo: number;
      heading: string;
    };

/**
 * One found run of a 6L.1 mark on a section body. `text` is the full
 * inner text of the run; the modal truncates it for the row label.
 *
 * `markOrdinal` is the 0-based index of *this* run among all runs of
 * the same `markKind` inside the same section, in document order.
 * The Highlights tab uses it as a stable scroll target — "go to the
 * 3rd yellow highlight in section 1.2" — without needing per-run
 * DOM ids on the body HTML.
 */
export interface Highlight {
  markKind: MarkKind;
  text: string;
  markOrdinal: number;
  location: HighlightLocation;
}

const KIND_SET: ReadonlySet<MarkKind> = new Set(ALL_MARK_KINDS);

/**
 * Top-level entry point. Walks every section in the payload and
 * returns every formatting run as a flat list. Order:
 *   1. Work-area sections (per work_spec, in id order)
 *   2. BDB sections (per BDB, in id order)
 * Within each section, marks appear in document order.
 */
export function findHighlights(data: FilePayload): Highlight[] {
  const out: Highlight[] = [];
  // Stable iteration: numeric sort on the keys so the modal list is
  // deterministic across renders (Object.entries gives insertion
  // order, which is *usually* numeric for these maps but not
  // guaranteed by the JSON-load path).
  const wsIds = Object.keys(data.sectionsByWorkSpec)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  for (const wsId of wsIds) {
    const sections = data.sectionsByWorkSpec[wsId] ?? [];
    for (const sec of sections) {
      collectFromBody(
        sec.body,
        {
          kind: "workSpec",
          workSpecId: wsId,
          sectionId: sec.id,
          sectionNo: sec.sectionNo,
          heading: sec.heading,
        },
        out,
      );
    }
  }
  const bdbIds = Object.keys(data.sectionsByBdb)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  for (const bdbId of bdbIds) {
    const sections = data.sectionsByBdb[bdbId] ?? [];
    for (const sec of sections) {
      collectFromBody(
        sec.body,
        {
          kind: "bdb",
          bdbId,
          sectionId: sec.id,
          sectionNo: sec.sectionNo,
          heading: sec.heading,
        },
        out,
      );
    }
  }
  return out;
}

/**
 * Scan one section body for `<mark class="bg-…">` and
 * `<span class="tc-…">` runs and push them into `out`.
 *
 * Exported for testing — the caller usually goes through
 * `findHighlights`.
 */
export function collectFromBody(
  body: string | null | undefined,
  location: HighlightLocation,
  out: Highlight[],
): void {
  if (!body) return;
  // Tiny optimisation — most bodies don't carry any mark/span class.
  // Skip the parse cost when neither prefix appears.
  if (!body.includes("bg-") && !body.includes("tc-")) return;

  // Wrap the body so the DOM has a single root we can iterate.
  const doc = new DOMParser().parseFromString(
    `<div>${body}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild;
  if (!root) return;

  // Per-section, per-kind running counter so each push knows its
  // ordinal in document order. The Highlights tab needs this so the
  // "go to that specific run" path can locate the Nth bg-yellow
  // (etc.) without us having to stamp dom ids on the body HTML.
  const ordinals: Partial<Record<MarkKind, number>> = {};
  // querySelectorAll with class selectors is exactly what we need;
  // it walks in document order.
  const marks = root.querySelectorAll<HTMLElement>("mark[class], span[class]");
  for (const el of Array.from(marks)) {
    // Class can carry only one of our eight values per element (the
    // sanitizer enforces this), but we defensively scan all tokens.
    for (const tok of Array.from(el.classList)) {
      if (!KIND_SET.has(tok as MarkKind)) continue;
      const tag = el.tagName.toLowerCase();
      // Backgrounds live on <mark>, text colors on <span>. Drop
      // mismatches (defence against future schema drift).
      if (tag === "mark" && !tok.startsWith("bg-")) continue;
      if (tag === "span" && !tok.startsWith("tc-")) continue;
      const kind = tok as MarkKind;
      const ord = ordinals[kind] ?? 0;
      ordinals[kind] = ord + 1;
      out.push({
        markKind: kind,
        text: el.textContent ?? "",
        markOrdinal: ord,
        location: { ...location },
      });
      break; // Only one whitelisted kind per element.
    }
  }
}

/**
 * Truncate a highlight's text for display in a list row. Keeps the
 * full word boundary on the right so the cut is visually clean.
 * Hard cap defaults to 80 chars.
 */
export function truncateForDisplay(text: string, max = 80): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  // Try to cut on the last space before the cap so we don't slice
  // mid-word. Fall back to a hard cut if the only space is past max.
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${head}…`;
}
