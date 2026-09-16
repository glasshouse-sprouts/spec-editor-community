/**
 * useEditContractDialog — slice #233 Session 2 (round 6).
 *
 * Per-row "Edit contract…" dialog (Slice 6I — #65). Buffered edit
 * (no IPC, no reload). On confirm we flush both fields through
 * `setContractCode` / `setContractName`; the helpers short-circuit
 * when a value reverts to its original, so no-op touches don't
 * dirty the edit map.
 *
 * Pre-fills with the effective values (so a previously-buffered
 * edit is shown for further editing).
 */

import { useCallback, useState } from "react";

import type { ContractInfo, FilePayload } from "../../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveContractCode,
  getEffectiveContractName,
  setContractCode,
  setContractName,
} from "../edits.js";
import { findContractById } from "../loaded.js";

/** Normalise the free-text input to what the DB expects. Blank → null. */
function normaliseContractText(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export interface EditContractDialogState {
  contract: ContractInfo;
  /** Current text in the inputs. `""` is allowed — on submit we
   *  normalise blank → null to match the schema's nullable columns. */
  code: string;
  name: string;
}

export interface UseEditContractDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseEditContractDialogResult {
  dialog: EditContractDialogState | null;
  open: (contractId: number) => void;
  cancel: () => void;
  setCode: (code: string) => void;
  setName: (name: string) => void;
  confirm: () => void;
}

export function useEditContractDialog({
  state,
  edits,
  setEdits,
}: UseEditContractDialogArgs): UseEditContractDialogResult {
  const [dialog, setDialog] = useState<EditContractDialogState | null>(null);

  const open = useCallback(
    (contractId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const contract = findContractById(state.data, contractId);
      if (!contract) return;
      const effectiveCode = getEffectiveContractCode(
        edits,
        contract.id,
        contract.contractCode,
      );
      const effectiveName = getEffectiveContractName(
        edits,
        contract.id,
        contract.contractName,
      );
      setDialog({
        contract,
        code: effectiveCode ?? "",
        name: effectiveName ?? "",
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setCode = useCallback((code: string): void => {
    setDialog((d) => (d ? { ...d, code } : d));
  }, []);

  const setName = useCallback((name: string): void => {
    setDialog((d) => (d ? { ...d, name } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      const { contract, code, name } = d;
      const newCode = normaliseContractText(code);
      const newName = normaliseContractText(name);
      setEdits((m) => {
        let next = m;
        next = setContractCode(
          next,
          contract.id,
          newCode,
          contract.contractCode,
        );
        next = setContractName(
          next,
          contract.id,
          newName,
          contract.contractName,
        );
        return next;
      });
      return null;
    });
  }, [setEdits]);

  return { dialog, open, cancel, setCode, setName, confirm };
}
