/**
 * useDeleteWorkSpecDialog — slice #233 Session 2 (round 5).
 *
 * "Delete work area" confirm dialog (Slice 6J — #66). Two-stage:
 *   1. Open instantly with `impact: null` (modal shows "Loading…").
 *   2. Background `getDeleteImpact` IPC fills in the cascade counts.
 *
 * Confirm doesn't write to disk — Slice 6M moved deletes to the edit
 * buffer. We just `markDelete` the work-spec and close. The
 * save-time applyEdits flush handles the actual SQL.
 */

import { useCallback, useState } from "react";

import type {
  DeleteImpact,
  FilePayload,
  GetDeleteImpactResult,
  WorkSpecInfo,
} from "../../../shared/ipc.js";
import type { CpOpDialogError } from "../cpOpError.js";
import { type EditMap, markDelete } from "../edits.js";
import { findWorkSpecById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface DeleteWorkSpecDialogState {
  workSpec: WorkSpecInfo;
  impact: DeleteImpact | null;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDeleteWorkSpecDialogArgs {
  state: { kind: string; data?: FilePayload };
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseDeleteWorkSpecDialogResult {
  dialog: DeleteWorkSpecDialogState | null;
  open: (workSpecId: number) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useDeleteWorkSpecDialog({
  state,
  setEdits,
}: UseDeleteWorkSpecDialogArgs): UseDeleteWorkSpecDialogResult {
  const [dialog, setDialog] = useState<DeleteWorkSpecDialogState | null>(null);

  const fetchImpact = useCallback(
    async (workSpecId: number): Promise<void> => {
      if (state.kind !== "loaded" || !state.data) return;
      try {
        const result: GetDeleteImpactResult =
          await window.molio.getDeleteImpact({
            path: state.data.path,
            target: { kind: "workArea", id: workSpecId },
          });
        if (result.kind === "missing") {
          setDialog((d) => (d ? { ...d, error: { kind: "missing" } } : d));
          return;
        }
        setDialog((d) => (d ? { ...d, impact: result.impact } : d));
      } catch (err) {
        setDialog((d) =>
          d
            ? {
                ...d,
                error: {
                  kind: "other",
                  message: friendlyErrorForDialog(err),
                },
              }
            : d,
        );
      }
    },
    [state],
  );

  const open = useCallback(
    (workSpecId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const workSpec = findWorkSpecById(state.data, workSpecId);
      if (!workSpec) return;
      setDialog({
        workSpec,
        impact: null,
        saving: false,
        error: null,
      });
      void fetchImpact(workSpecId);
    },
    [state, fetchImpact],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      setEdits((prev) => markDelete(prev, "workSpec", d.workSpec.id));
      return null;
    });
  }, [setEdits]);

  return { dialog, open, cancel, confirm };
}
