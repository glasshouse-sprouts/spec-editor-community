/**
 * Renderer-side pure helpers for the "orphan PFBB master" migration
 * (Slice 10H.6b).
 *
 * Background
 * ──────────
 * By Molio convention every `is_pfbb=1` master must sit in the virtual
 * work_spec called "Projektfælles bygningsdelsbeskrivelser" (code
 * `S999.01`). Legacy files created before we enforced that — or edited
 * by hand — may have masters attached to regular work areas. Those are
 * "orphan masters".
 *
 * This module is 100% pure computation against the already-loaded
 * FilePayload: no IPC, no DB access, no React. It tells the banner
 * whether there's anything to offer the user, and names the work areas
 * involved so the banner can be specific ("masters found in 'Beton' and
 * 'Tag'") rather than generic.
 *
 * The actual move happens server-side via `migrateOrphanPfbbMasters` in
 * core — this module only detects.
 */

import type { BdbInfo, FilePayload, WorkSpecInfo } from "../../shared/ipc.js";

// NOTE: we intentionally do NOT import from `@molio2-editor/core` here.
// The renderer process must stay isolated from core because core pulls
// in Node-only modules (`better-sqlite3`, `fs/promises`, `crypto`, …)
// that Vite can't bundle for the browser. Any renderer import from
// `@molio2-editor/core` drags the whole graph in and blanks the window.
// The predicate below is the tiny string-equality subset of core's
// `isVirtualWorkSpec` — kept in sync by matching tests in this package
// and in `packages/core/test/pfbbWorkSpec.test.ts`.
const VIRTUAL_WORK_SPEC_NAME = "Projektfælles bygningsdelsbeskrivelser";
const VIRTUAL_WORK_SPEC_CODE = "S999.01";

function nameMatches(name: string | null | undefined): boolean {
  if (name == null) return false;
  return (
    name.trim().toLocaleLowerCase() ===
    VIRTUAL_WORK_SPEC_NAME.toLocaleLowerCase()
  );
}

function codeMatches(code: string | null | undefined): boolean {
  if (code == null) return false;
  return (
    code.trim().toLocaleLowerCase() ===
    VIRTUAL_WORK_SPEC_CODE.toLocaleLowerCase()
  );
}

/**
 * Which work areas contain at least one orphan PFBB master, and which
 * BDB ids are the orphans. Empty arrays mean "no migration needed".
 */
export interface OrphanPfbbDetection {
  /** BDB ids with `is_pfbb=1` that currently live in a non-virtual work_spec. */
  orphanBdbIds: number[];
  /**
   * Names of the distinct work areas the orphans live in — sorted,
   * de-duplicated, suitable for a banner like "in work area(s): X, Y".
   * Only populated when `orphanBdbIds.length > 0`.
   */
  sourceWorkAreaNames: string[];
}

/**
 * Scan a loaded payload and report which PFBB masters are NOT in the
 * virtual work_spec. Returns empty arrays for "clean" projects.
 *
 * Matching rules (same as core `isVirtualWorkSpec`):
 *  - case-insensitive, trimmed
 *  - match if EITHER name `Projektfælles bygningsdelsbeskrivelser` OR
 *    code `S999.01`
 *
 * Subscribers (`pfbbId != null`) are never reported — they legitimately
 * point at real work areas.
 *
 * Pure function; deterministic output, order stable (ids sorted, names
 * sorted by Danish locale).
 */
export function findOrphanPfbbMasters(
  payload: Pick<FilePayload, "bdbs" | "workSpecs">,
): OrphanPfbbDetection {
  const virtualIds = new Set<number>();
  for (const ws of payload.workSpecs) {
    if (isVirtualWorkSpecInfo(ws)) virtualIds.add(ws.id);
  }

  const orphanIds: number[] = [];
  const sourceWsIds = new Set<number>();
  for (const b of payload.bdbs) {
    if (!isOrphanMaster(b, virtualIds)) continue;
    orphanIds.push(b.id);
    if (b.workSpecId != null) sourceWsIds.add(b.workSpecId);
  }

  if (orphanIds.length === 0) {
    return { orphanBdbIds: [], sourceWorkAreaNames: [] };
  }

  const names = payload.workSpecs
    .filter((ws) => sourceWsIds.has(ws.id))
    .map((ws) => ws.workAreaName)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const unique = Array.from(new Set(names));
  unique.sort((a, b) => a.localeCompare(b, "da"));

  orphanIds.sort((a, b) => a - b);
  return { orphanBdbIds: orphanIds, sourceWorkAreaNames: unique };
}

/**
 * Turn `sourceWorkAreaNames` into a banner-friendly string.
 *  - 0 names → empty string (banner omits the list entirely)
 *  - 1..3 names → "'A'", "'A' and 'B'", "'A', 'B', and 'C'"
 *  - 4+ names → "'A', 'B', 'C', and N more"
 *
 * Kept pure + exported so the banner UI doesn't have to invent its own
 * truncation rule — and so we can unit-test the edge cases.
 */
export function summarizeSourceWorkAreaNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `'${names[0]}'`;
  if (names.length === 2) return `'${names[0]}' and '${names[1]}'`;
  if (names.length === 3) {
    return `'${names[0]}', '${names[1]}', and '${names[2]}'`;
  }
  // 4+ → show first three, then the overflow count.
  const overflow = names.length - 3;
  return `'${names[0]}', '${names[1]}', '${names[2]}', and ${overflow} more`;
}

/**
 * True if this WorkSpecInfo is the virtual PFBB container. Matches on
 * name OR code, case-insensitive + trimmed. Intentionally a local copy
 * of core's `isVirtualWorkSpec` — see the note at the top of this file
 * on why the renderer doesn't import from core.
 */
export function isVirtualWorkSpecInfo(ws: WorkSpecInfo): boolean {
  return nameMatches(ws.workAreaName) || codeMatches(ws.workAreaCode);
}

/**
 * Slice 10H.6c — decide what the EditBdbModal should show for a given
 * is_pfbb checkbox state.
 *
 *  - `kind: "info"`     — the user just flipped is_pfbb ON and the BDB
 *                         is still in a regular work_spec. Saving will
 *                         move it into the virtual row. We show a
 *                         neutral info line; Save is allowed.
 *  - `kind: "block"`    — the user just flipped is_pfbb OFF on a BDB
 *                         that currently lives in the virtual row. A
 *                         non-PFBB BDB doesn't belong there, so we
 *                         refuse Save and ask the user to move it
 *                         to a regular work area first.
 *  - `kind: "none"`     — no change, already-virtual, or any other
 *                         combination that needs no UI affordance.
 *
 * Pure function; no React, no DOM. Exported so both the modal and
 * tests can use the same logic.
 */
export type PfbbToggleHint =
  | { kind: "none" }
  | { kind: "info" }
  | { kind: "block" };

export function computePfbbToggleHint(input: {
  /** `is_pfbb` value when the dialog opened (0 or 1). */
  originalIsPfbb: number;
  /** Current checkbox state after possible toggles. */
  isPfbb: boolean;
  /** Whether the BDB's work_spec at dialog-open was the virtual row. */
  currentWorkSpecIsVirtual: boolean;
}): PfbbToggleHint {
  const wasPfbb = input.originalIsPfbb === 1;
  const willBePfbb = input.isPfbb;
  if (!wasPfbb && willBePfbb && !input.currentWorkSpecIsVirtual) {
    return { kind: "info" };
  }
  if (wasPfbb && !willBePfbb && input.currentWorkSpecIsVirtual) {
    return { kind: "block" };
  }
  return { kind: "none" };
}

/**
 * Slice 10H.8 — count the live PFBB children of a BDB. "Live" means:
 * the child row exists in the payload AND it isn't already marked for
 * deletion in the current edit buffer. The delete dialog uses this to
 * refuse deleting a master while children are still pointing at it.
 *
 * Pure function. `isAlreadyPendingDelete` is passed in so this helper
 * stays free of the edit-map dependency — the caller wires the real
 * predicate (`isPendingDelete(edits, "bdb", id)`) in the renderer,
 * while tests can pass a trivial mock.
 */
export function countLivePfbbChildren(
  bdbs: readonly Pick<BdbInfo, "id" | "pfbbId">[],
  masterId: number,
  isAlreadyPendingDelete: (childId: number) => boolean,
): number {
  let count = 0;
  for (const b of bdbs) {
    if (b.pfbbId === masterId && !isAlreadyPendingDelete(b.id)) {
      count++;
    }
  }
  return count;
}

/**
 * A BDB qualifies as "orphan master" when:
 *  - `isPfbb` is true (it's a PFBB row), AND
 *  - `pfbbId` is null (it's a master, not a subscriber), AND
 *  - its `workSpecId` is not in the virtual set
 *    (either unassigned, or pointing at a regular work area).
 */
function isOrphanMaster(b: BdbInfo, virtualIds: Set<number>): boolean {
  if (!b.isPfbb) return false;
  if (b.pfbbId != null) return false;
  if (b.workSpecId == null) return true;
  return !virtualIds.has(b.workSpecId);
}
