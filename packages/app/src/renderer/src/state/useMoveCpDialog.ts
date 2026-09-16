/**
 * useMoveCpDialog — slice #233 Session 2 (round 5).
 *
 * "Move Control Plan to a different BDB" dialog (Slice 6O.4 — #112).
 * Same envelope as duplicate/delete CP. The picker disables BDBs
 * whose target slot is occupied (a design CP can only land in a free
 * design slot, etc.). On `slot-occupied` the dialog stays open with
 * a custom message so the user can pick a different BDB.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findControlPlanById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface MoveCpDialogState {
  controlPlanId: number;
  controlPlanLabel: string;
  /** The CP's type — drives which BDBs are valid targets. */
  cpType: 0 | 1;
  /** Where the CP lives now, so we can pre-select it and detect no-op. */
  originalBdbId: number | null;
  targetBdbId: number | null;
  filter: string;
  saving: boolean;
  error: CpOpDialogError | null;
  slotOccupiedMessage: string | null;
}

export interface UseMoveCpDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: (opts?: {
    focus?: { kind: "controlPlan"; id: number };
  }) => Promise<void>;
}

export interface UseMoveCpDialogResult {
  dialog: MoveCpDialogState | null;
  open: (controlPlanId: number) => void;
  cancel: () => void;
  setFilter: (filter: string) => void;
  setTarget: (bdbId: number | null) => void;
  confirm: () => Promise<void>;
}

export function useMoveCpDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseMoveCpDialogArgs): UseMoveCpDialogResult {
  const [dialog, setDialog] = useState<MoveCpDialogState | null>(null);

  const open = useCallback(
    (controlPlanId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const plan = findControlPlanById(state.data, controlPlanId);
      if (!plan) return;
      // Current home: the BDB whose design-or-production slot points at
      // this CP, if any. Homeless CPs come back as null and the dialog
      // starts unselected.
      const originalBdbId =
        state.data.bdbs.find((b) => b.controlPlanIds.includes(plan.id))?.id ??
        null;
      const cpType: 0 | 1 = plan.controlPlanType === 1 ? 1 : 0;
      const label = plan.title?.trim()
        ? `${plan.numberText?.trim() ? plan.numberText + " " : ""}${plan.title}`
        : `CP #${plan.id}`;
      setDialog({
        controlPlanId: plan.id,
        controlPlanLabel: label,
        cpType,
        originalBdbId,
        targetBdbId: originalBdbId,
        filter: "",
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
        slotOccupiedMessage: null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setFilter = useCallback((filter: string): void => {
    setDialog((d) => (d ? { ...d, filter } : d));
  }, []);

  const setTarget = useCallback((bdbId: number | null): void => {
    // Clear any previous slot-occupied message when the user picks a
    // different BDB — otherwise a stale message lingers across retries.
    setDialog((d) =>
      d ? { ...d, targetBdbId: bdbId, slotOccupiedMessage: null } : d,
    );
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const { controlPlanId, targetBdbId, originalBdbId } = dialog;
    if (targetBdbId == null) return;
    if (targetBdbId === originalBdbId) {
      // No-op — just close.
      setDialog(null);
      return;
    }
    setDialog((d) =>
      d ? { ...d, saving: true, error: null, slotOccupiedMessage: null } : d,
    );
    try {
      const result = await window.molio.moveControlPlan({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        sourceCpId: controlPlanId,
        targetBdbId,
      });
      if (result.kind === "conflict" || result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
        );
        return;
      }
      if (result.kind === "slot-occupied") {
        setDialog((d) =>
          d ? { ...d, saving: false, slotOccupiedMessage: result.message } : d,
        );
        return;
      }
      await reloadAfterCpOp({
        focus: { kind: "controlPlan", id: controlPlanId },
      });
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

  return { dialog, open, cancel, setFilter, setTarget, confirm };
}
