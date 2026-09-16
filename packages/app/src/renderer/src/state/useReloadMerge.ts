/**
 * RELOAD-Merge M5 — orchestration hook for the merge flow.
 *
 * Ties the merge pieces together:
 *   - `canMerge`     — should a "Merge…" option be offered at all
 *                      (a file is loaded + edits are non-structural).
 *   - `startMerge()` — re-read the disk file, compute the plan; on
 *                      success open the merge dialog and resolve
 *                      `true`; otherwise surface a short message and
 *                      resolve `false` (caller keeps its own modal).
 *   - `mergeDialog`  — the plan for the open dialog, or null.
 *   - `confirmMerge` / `cancelMerge` — apply / dismiss.
 *
 * The hook never reloads or saves directly — applying a merge goes
 * through `applyMerge` (useFileState M4), which leaves the result as
 * unsaved edits for the user to review and Save.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import { type EditMap, toEditRequestList } from "../edits.js";
import { useT } from "../i18n/i18n.js";
import type { DiskDelta, MergeConflict, MergeUnit } from "../mergeOnReload.js";
import { canOfferMerge, prepareMergePlan } from "../mergePrepare.js";
import type { LoadState } from "./useFileState.js";

interface MergeDialogState {
  autoApplied: MergeUnit[];
  conflicts: MergeConflict[];
  diskDelta: DiskDelta;
  disk: FilePayload;
}

export interface UseReloadMergeArgs {
  state: LoadState;
  edits: EditMap;
  /** M4 — adopt the disk version + load the merged edits. */
  applyMerge: (winners: MergeUnit[], disk: FilePayload) => void;
  /** Surface a short message when the merge can't run. */
  onUnavailable: (message: string) => void;
}

export interface UseReloadMergeResult {
  /** Whether a "Merge…" option should be shown at all. */
  canMerge: boolean;
  /**
   * Run the merge flow. Resolves `true` when the merge dialog opened
   * (the caller should then close its own modal); `false` otherwise
   * — a message has already been surfaced via `onUnavailable`.
   */
  startMerge: () => Promise<boolean>;
  /** The plan for the open merge dialog, or null when closed. */
  mergeDialog: MergeDialogState | null;
  /** Apply the resolved merge + close the dialog. */
  confirmMerge: (winners: MergeUnit[]) => void;
  /** Close the merge dialog without applying. */
  cancelMerge: () => void;
}

export function useReloadMerge({
  state,
  edits,
  applyMerge,
  onUnavailable,
}: UseReloadMergeArgs): UseReloadMergeResult {
  const t = useT();
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState | null>(null);

  const canMerge =
    state.kind === "loaded" && canOfferMerge(toEditRequestList(edits));

  const startMerge = useCallback(async (): Promise<boolean> => {
    if (state.kind !== "loaded") return false;
    const result = await prepareMergePlan(state.data, toEditRequestList(edits));
    if (result.kind === "ok") {
      setMergeDialog({
        autoApplied: result.autoApplied,
        conflicts: result.conflicts,
        diskDelta: result.diskDelta,
        disk: result.disk,
      });
      return true;
    }
    // blocked (structural collision) or load-error → not mergeable.
    onUnavailable(t("mergeModal.unavailable"));
    return false;
  }, [state, edits, onUnavailable, t]);

  const confirmMerge = useCallback(
    (winners: MergeUnit[]): void => {
      if (mergeDialog) applyMerge(winners, mergeDialog.disk);
      setMergeDialog(null);
    },
    [mergeDialog, applyMerge],
  );

  const cancelMerge = useCallback((): void => setMergeDialog(null), []);

  return { canMerge, startMerge, mergeDialog, confirmMerge, cancelMerge };
}
