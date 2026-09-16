/**
 * RELOAD-Merge M2 — plumbing between the merge brain and the UI.
 *
 * Two pieces:
 *  - `canOfferMerge` — the cheap gate. Decides whether a "Merge…"
 *    option should even appear, WITHOUT re-reading the disk file:
 *    there must be buffered edits and none may be structural.
 *  - `prepareMergePlan` — re-reads the open file from disk and runs
 *    the merge brain (`computeMergePlan`) against it. The plan it
 *    returns may still be `blocked` — e.g. the disk deleted a
 *    section the user edited — even when `canOfferMerge` was true.
 */

import type { EditRequest, FilePayload } from "../../shared/ipc.js";
import {
  computeMergePlan,
  editsContainStructural,
  type DiskDelta,
  type MergeBlocker,
  type MergeConflict,
  type MergeUnit,
} from "./mergeOnReload.js";
import { sanitizeLoadedFile } from "./sanitizeLoadedFile.js";

/**
 * Cheap pre-check — no disk read. True when a Merge is worth
 * offering: there are buffered edits and none of them is structural.
 * Used to decide whether the "Merge…" option is shown at all.
 */
export function canOfferMerge(edits: EditRequest[]): boolean {
  return edits.length > 0 && !editsContainStructural(edits);
}

/**
 * Result of {@link prepareMergePlan}. Flat union — `kind` is:
 *  - "ok"         — mergeable; carries the plan plus the `disk`
 *                   payload (M4 adopts it as the new base, so the
 *                   apply step never has to re-read or race).
 *  - "blocked"    — fall back to discard / overwrite.
 *  - "load-error" — the disk file couldn't be re-read.
 */
export type PreparedMerge =
  | {
      kind: "ok";
      autoApplied: MergeUnit[];
      conflicts: MergeConflict[];
      /** Top-level entities the disk added/removed — informational. */
      diskDelta: DiskDelta;
      disk: FilePayload;
    }
  | { kind: "blocked"; blockers: MergeBlocker[] }
  | { kind: "load-error"; message: string };

/**
 * Re-read the currently-open file from disk and compute the 3-way
 * merge plan: `base` (what the editor loaded) + `edits` (buffered)
 * against the disk version.
 *
 * The disk file is sanitised the same way `base` was on load, so
 * section-body comparisons are apples-to-apples.
 */
export async function prepareMergePlan(
  base: FilePayload,
  edits: EditRequest[],
): Promise<PreparedMerge> {
  try {
    const raw = await window.molio.openFile(base.path);
    const disk = sanitizeLoadedFile(raw);
    const plan = computeMergePlan(base, edits, disk);
    if (plan.kind === "ok") {
      return {
        kind: "ok",
        autoApplied: plan.autoApplied,
        conflicts: plan.conflicts,
        diskDelta: plan.diskDelta,
        disk,
      };
    }
    return plan; // blocked
  } catch (err) {
    return {
      kind: "load-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
