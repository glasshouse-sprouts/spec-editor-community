/**
 * useDeleteCpDialog — slice #233 Session 2 (round 5).
 *
 * "Delete control plan" confirm dialog. FIX-DelCpStrike 2026-05-11
 * converted this from an immediate IPC delete (which reloaded the
 * file and closed the tab) to a *buffered* delete — same pattern as
 * BDB / work-area / contract deletes:
 *
 *   1. Dialog open → just look up the CP for display.
 *   2. Confirm → stage `markDelete(map, "controlPlan", id)` in the
 *      edit buffer. The sidebar shows strikethrough + offers Restore.
 *   3. Save → core's applyEdits cascades rows + headers + CP + NULLs
 *      the parent BDB's slot column.
 *
 * No dirty-state guard, no IPC, no reload. The dialog's `saving` and
 * `error` fields are kept for shape compatibility with the modal
 * component (both are always inert now).
 */

import { useCallback, useState } from "react";

import type { ControlPlanInfo, FilePayload } from "../../../shared/ipc.js";
import type { CpOpDialogError } from "../cpOpError.js";
import { type EditMap, markDelete } from "../edits.js";
import { findControlPlanById } from "../loaded.js";

export interface DeleteCpDialogState {
  plan: ControlPlanInfo;
  /** Always false — buffered delete completes synchronously. Kept to
   *  match the shared DeleteCpModal prop shape. */
  saving: boolean;
  /** Always null — no IPC means no transient errors. Kept for shape. */
  error: CpOpDialogError | null;
}

export interface UseDeleteCpDialogArgs {
  state: { kind: string; data?: FilePayload };
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseDeleteCpDialogResult {
  dialog: DeleteCpDialogState | null;
  open: (controlPlanId: number) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useDeleteCpDialog({
  state,
  setEdits,
}: UseDeleteCpDialogArgs): UseDeleteCpDialogResult {
  const [dialog, setDialog] = useState<DeleteCpDialogState | null>(null);

  const open = useCallback(
    (controlPlanId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const plan = findControlPlanById(state.data, controlPlanId);
      if (!plan) return;
      setDialog({ plan, saving: false, error: null });
    },
    [state],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      setEdits((prev) => markDelete(prev, "controlPlan", d.plan.id));
      return null;
    });
  }, [setEdits]);

  return { dialog, open, cancel, confirm };
}
