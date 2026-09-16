/**
 * useCreatePfbbChildDialog — slice #233 Session 2 (round 5).
 *
 * "Create PFBB child" dialog (Slice 10H.5 — #218). Opened from the
 * sidebar right-click on a master BDB (`isPfbb === true`). The
 * child gets a new `construction_element_spec` row in the chosen
 * work-spec, `pfbb_id` pointing at the master, and an empty body.
 *
 * Dirty guard mirrors duplicateBdb. On success the file is reloaded
 * and the new child opens as a fresh tab.
 */

import { useCallback, useState } from "react";

import type {
  BdbInfo,
  CreatePfbbChildResult,
  FilePayload,
} from "../../../shared/ipc.js";
import type { CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findBdbById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface CreatePfbbChildDialogState {
  master: BdbInfo;
  /** Null until the user picks a work-area. */
  targetWorkSpecId: number | null;
  name: string;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseCreatePfbbChildDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: (opts?: {
    focus?: { kind: "bdb"; id: number };
  }) => Promise<void>;
}

export interface UseCreatePfbbChildDialogResult {
  dialog: CreatePfbbChildDialogState | null;
  open: (bdbId: number) => void;
  cancel: () => void;
  setName: (name: string) => void;
  setTargetWorkSpecId: (id: number | null) => void;
  confirm: () => Promise<void>;
}

export function useCreatePfbbChildDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseCreatePfbbChildDialogArgs): UseCreatePfbbChildDialogResult {
  const [dialog, setDialog] = useState<CreatePfbbChildDialogState | null>(null);

  const open = useCallback(
    (bdbId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const master = findBdbById(state.data, bdbId);
      if (!master || !master.isPfbb) return;
      setDialog({
        master,
        targetWorkSpecId: null,
        name: master.name,
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setName = useCallback((name: string): void => {
    setDialog((d) => (d ? { ...d, name } : d));
  }, []);

  const setTargetWorkSpecId = useCallback((id: number | null): void => {
    setDialog((d) => (d ? { ...d, targetWorkSpecId: id } : d));
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (dialog.targetWorkSpecId == null) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const requestedName = dialog.name.trim();
    if (!requestedName) return;

    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: CreatePfbbChildResult = await window.molio.createPfbbChild({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        masterId: dialog.master.id,
        targetWorkSpecId: dialog.targetWorkSpecId,
        name: requestedName,
      });
      if (result.kind === "conflict") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: { kind: "conflict" } } : d,
        );
        return;
      }
      if (result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: { kind: "missing" } } : d,
        );
        return;
      }
      await reloadAfterCpOp({ focus: { kind: "bdb", id: result.newBdbId } });
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

  return { dialog, open, cancel, setName, setTargetWorkSpecId, confirm };
}
