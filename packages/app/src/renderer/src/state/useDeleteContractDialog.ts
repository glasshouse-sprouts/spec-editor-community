/**
 * useDeleteContractDialog — slice #233 Session 2 (round 5).
 *
 * "Delete contract" with reassign-fallback flow. Two stages drive
 * the dialog body:
 *
 *   - "confirm"  — plain "Delete contract X?" prompt. Used when no
 *                  work areas reference this contract.
 *   - "reassign" — the contract still has work-area references; the
 *                  user must pick a target contract before the delete
 *                  can go in. We buffer one `workSpecContract` patch
 *                  per referrer plus a `deleteContract` patch for the
 *                  contract itself in the same edit map. Save applies
 *                  them together (updates before deletes inside the
 *                  same SQL transaction).
 *
 * Slice 6M: confirm doesn't write to disk. Both stages buffer edits
 * via the edit map and close. The save-time applyEdits flush handles
 * the actual SQL.
 */

import { useCallback, useState } from "react";

import type { ContractInfo, FilePayload } from "../../../shared/ipc.js";
import type { CpOpDialogError } from "../cpOpError.js";
import {
  type EditMap,
  getEffectiveWorkSpecContract,
  isPendingDelete,
  markDelete,
  setWorkSpecContract,
} from "../edits.js";
import { findContractById, findWorkSpecById } from "../loaded.js";

export interface DeleteContractDialogState {
  contract: ContractInfo;
  stage: "confirm" | "reassign";
  /** Populated when stage === "reassign". */
  referencedWorkSpecIds: number[];
  /** Picker selection during "reassign". `null` = move to "no contract". */
  targetContractId: number | null;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDeleteContractDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseDeleteContractDialogResult {
  dialog: DeleteContractDialogState | null;
  open: (contractId: number) => void;
  cancel: () => void;
  setTarget: (contractId: number | null) => void;
  confirm: () => void;
  confirmReassign: () => void;
}

export function useDeleteContractDialog({
  state,
  edits,
  setEdits,
}: UseDeleteContractDialogArgs): UseDeleteContractDialogResult {
  const [dialog, setDialog] = useState<DeleteContractDialogState | null>(null);

  const open = useCallback(
    (contractId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const contract = findContractById(state.data, contractId);
      if (!contract) return;
      // Effective references: any work area whose effective contract_id
      // (after pending wsContract edits) still points at the contract
      // being deleted AND the work area itself isn't also being deleted.
      const referencedWorkSpecIds = state.data.workSpecs
        .filter((w) => {
          const eff = getEffectiveWorkSpecContract(edits, w.id, w.contractId);
          return (
            eff === contractId && !isPendingDelete(edits, "workSpec", w.id)
          );
        })
        .map((w) => w.id);
      if (referencedWorkSpecIds.length > 0) {
        // Start in reassign mode — the user must resolve the references
        // before the buffered delete can go in.
        const fallback =
          state.data.contracts.find(
            (c) =>
              c.id !== contractId && !isPendingDelete(edits, "contract", c.id),
          ) ?? null;
        setDialog({
          contract,
          stage: "reassign",
          referencedWorkSpecIds,
          targetContractId: fallback ? fallback.id : null,
          saving: false,
          error: null,
        });
        return;
      }
      setDialog({
        contract,
        stage: "confirm",
        referencedWorkSpecIds: [],
        targetContractId: null,
        saving: false,
        error: null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setTarget = useCallback((contractId: number | null): void => {
    setDialog((d) => (d ? { ...d, targetContractId: contractId } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      setEdits((prev) => markDelete(prev, "contract", d.contract.id));
      return null;
    });
  }, [setEdits]);

  const confirmReassign = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      if (d.stage !== "reassign") return d;
      if (state.kind !== "loaded" || !state.data) return d;
      const { contract, referencedWorkSpecIds, targetContractId } = d;
      if (referencedWorkSpecIds.length === 0) return d;
      setEdits((prev) => {
        let next = prev;
        for (const workSpecId of referencedWorkSpecIds) {
          const data = state.data;
          if (!data) continue;
          const original =
            findWorkSpecById(data, workSpecId)?.contractId ?? null;
          next = setWorkSpecContract(
            next,
            workSpecId,
            targetContractId,
            original,
          );
        }
        next = markDelete(next, "contract", contract.id);
        return next;
      });
      return null;
    });
  }, [state, setEdits]);

  return { dialog, open, cancel, setTarget, confirm, confirmReassign };
}
