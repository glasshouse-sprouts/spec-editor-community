/**
 * useMoveWorkSpecDialog — slice #233 Session 2 (round 5).
 *
 * "Move work area to a different contract" dialog. Right-click on a
 * work area in the sidebar → "Move to contract…". Buffered edit via
 * `setWorkSpecContract`; ⌘S persists. No IPC, no reload — pure
 * edit-buffer flow.
 *
 * Pre-selects whatever the effective assignment is now (original or
 * already-buffered edit) so the dialog reflects the user's current
 * intent.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveWorkSpecContract,
  setWorkSpecContract,
} from "../edits.js";
import { findWorkSpecById } from "../loaded.js";

export interface MoveWorkSpecDialogState {
  workSpecId: number;
  /** Displayed in the dialog header. */
  workSpecLabel: string;
  /** Original contract id, to diff against the user's pick. */
  originalContractId: number | null;
  filter: string;
  /** `null` = no contract (clear the link). */
  targetContractId: number | null;
}

export interface UseMoveWorkSpecDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseMoveWorkSpecDialogResult {
  dialog: MoveWorkSpecDialogState | null;
  open: (workSpecId: number) => void;
  cancel: () => void;
  setFilter: (filter: string) => void;
  setTarget: (contractId: number | null) => void;
  confirm: () => void;
}

export function useMoveWorkSpecDialog({
  state,
  edits,
  setEdits,
}: UseMoveWorkSpecDialogArgs): UseMoveWorkSpecDialogResult {
  const [dialog, setDialog] = useState<MoveWorkSpecDialogState | null>(null);

  const open = useCallback(
    (workSpecId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const ws = findWorkSpecById(state.data, workSpecId);
      if (!ws) return;
      const label = ws.workAreaCode
        ? `${ws.workAreaCode} — ${ws.workAreaName}`
        : ws.workAreaName;
      const effective = getEffectiveWorkSpecContract(
        edits,
        ws.id,
        ws.contractId,
      );
      setDialog({
        workSpecId: ws.id,
        workSpecLabel: label,
        originalContractId: ws.contractId,
        filter: "",
        targetContractId: effective,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setFilter = useCallback((filter: string): void => {
    setDialog((d) => (d ? { ...d, filter } : d));
  }, []);

  const setTarget = useCallback((contractId: number | null): void => {
    setDialog((d) => (d ? { ...d, targetContractId: contractId } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      const { workSpecId, originalContractId, targetContractId } = d;
      setEdits((m) =>
        setWorkSpecContract(
          m,
          workSpecId,
          targetContractId,
          originalContractId,
        ),
      );
      return null;
    });
  }, [setEdits]);

  return { dialog, open, cancel, setFilter, setTarget, confirm };
}
