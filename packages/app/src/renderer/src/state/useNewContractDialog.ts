/**
 * useNewContractDialog — slice #233 Session 2 (round 6).
 *
 * "+ New contract…" dialog (Slice 6I — #65). Immediate-persistence:
 * open → createContract IPC → reload. Same dirty-state guard as the
 * other CP-op flows.
 *
 * Validation: at least one of `code` or `name` must be non-blank.
 * A contract with neither is useless and leaves an orphan row in
 * the picker.
 */

import { useCallback, useState } from "react";

import type { CreateContractResult, FilePayload } from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

/** Normalise the free-text input to what the DB expects. Blank → null. */
function normaliseContractText(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export interface NewContractDialogState {
  code: string;
  name: string;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseNewContractDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseNewContractDialogResult {
  dialog: NewContractDialogState | null;
  open: () => void;
  cancel: () => void;
  setCode: (code: string) => void;
  setName: (name: string) => void;
  confirm: () => Promise<void>;
}

export function useNewContractDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseNewContractDialogArgs): UseNewContractDialogResult {
  const [dialog, setDialog] = useState<NewContractDialogState | null>(null);

  const open = useCallback((): void => {
    if (state.kind !== "loaded") return;
    setDialog({
      code: "",
      name: "",
      saving: false,
      error: hasEdits(edits) ? { kind: "dirty" } : null,
    });
  }, [state, edits]);

  const cancel = useCallback((): void => setDialog(null), []);

  const setCode = useCallback((code: string): void => {
    setDialog((d) => (d ? { ...d, code } : d));
  }, []);

  const setName = useCallback((name: string): void => {
    setDialog((d) => (d ? { ...d, name } : d));
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    // Require at least one of code or name — a contract with neither is
    // useless and leaves an orphan row in the picker.
    const code = normaliseContractText(dialog.code);
    const name = normaliseContractText(dialog.name);
    if (code === null && name === null) return;

    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: CreateContractResult = await window.molio.createContract({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        contractCode: code,
        contractName: name,
      });
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

  return { dialog, open, cancel, setCode, setName, confirm };
}
