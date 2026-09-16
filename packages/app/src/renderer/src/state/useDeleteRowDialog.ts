/**
 * useDeleteRowDialog — slice #233 Session 2 (round 5).
 *
 * "Delete control-plan row" confirm dialog. Populated-row detection
 * uses `rowHasContent` from cpSlots — we still confirm even for
 * blank rows, but with softer wording. `hasContent` is precomputed
 * when the dialog opens so we don't have to re-look it up each
 * render.
 *
 * Immediate-persistence flow: open → confirm → IPC → reload.
 */

import { useCallback, useState } from "react";

import type {
  ControlPlanRowData,
  DeleteCpRowResult,
  FilePayload,
} from "../../../shared/ipc.js";
import { rowHasContent } from "../cpSlots.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface DeleteRowDialogState {
  row: ControlPlanRowData;
  hasContent: boolean;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDeleteRowDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseDeleteRowDialogResult {
  dialog: DeleteRowDialogState | null;
  open: (row: ControlPlanRowData) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export function useDeleteRowDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseDeleteRowDialogArgs): UseDeleteRowDialogResult {
  const [dialog, setDialog] = useState<DeleteRowDialogState | null>(null);

  const open = useCallback(
    (row: ControlPlanRowData): void => {
      if (state.kind !== "loaded") return;
      setDialog({
        row,
        hasContent: rowHasContent(row),
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: DeleteCpRowResult = await window.molio.deleteControlPlanRow(
        {
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          rowId: dialog.row.id,
        },
      );
      if (result.kind === "conflict" || result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
        );
        return;
      }
      await reloadAfterCpOp();
      setDialog(null);
    } catch (err) {
      setDialog((d) =>
        d
          ? {
              ...d,
              saving: false,
              error: {
                kind: "other",
                message: friendlyErrorForDialog(err),
              },
            }
          : d,
      );
    }
  }, [dialog, state, edits, baselineMtimeMs, reloadAfterCpOp]);

  return { dialog, open, cancel, confirm };
}
