/**
 * useDeleteBdbDialog — slice #233 Session 2 (round 5).
 *
 * "Delete BDB" confirm dialog (Slice 6J — #66 + 10H.8). Two-stage:
 *   1. Open instantly with `impact: null` (modal shows "Loading…").
 *   2. Background `getDeleteImpact` IPC fills in the cascade counts.
 *
 * Confirm doesn't write to disk — Slice 6M moved deletes to the edit
 * buffer. We just `markDelete` the BDB and close. The save-time
 * applyEdits flush handles the actual SQL.
 *
 * PFBB master guard: `pfbbChildCount` is computed at open time; the
 * UI refuses confirm when non-zero (the user has to delete the
 * children first).
 */

import { useCallback, useState } from "react";

import type {
  BdbInfo,
  DeleteImpact,
  FilePayload,
  GetDeleteImpactResult,
} from "../../../shared/ipc.js";
import type { CpOpDialogError } from "../cpOpError.js";
import { type EditMap, isPendingDelete, markDelete } from "../edits.js";
import { findBdbById } from "../loaded.js";
import { countLivePfbbChildren } from "../pfbbMigration.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface DeleteBdbDialogState {
  bdb: BdbInfo;
  impact: DeleteImpact | null;
  /**
   * How many live PFBB children (BDBs with `pfbb_id === bdb.id` AND
   * not already marked for deletion) point at this master. Non-zero
   * ⇒ deleting the master is refused in the UI; the user has to
   * delete the children first. Zero for any non-master BDB.
   */
  pfbbChildCount: number;
  /**
   * FIX-DelBdbCps 2026-05-11. Whether to also hard-delete attached
   * control plans on save. Default ON. The user can uncheck to keep
   * the CPs around as unlinked plans (historical behavior).
   */
  deleteControlPlans: boolean;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDeleteBdbDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseDeleteBdbDialogResult {
  dialog: DeleteBdbDialogState | null;
  open: (bdbId: number) => void;
  cancel: () => void;
  setDeleteControlPlans: (value: boolean) => void;
  confirm: () => void;
}

export function useDeleteBdbDialog({
  state,
  edits,
  setEdits,
}: UseDeleteBdbDialogArgs): UseDeleteBdbDialogResult {
  const [dialog, setDialog] = useState<DeleteBdbDialogState | null>(null);

  const fetchImpact = useCallback(
    async (bdbId: number): Promise<void> => {
      if (state.kind !== "loaded" || !state.data) return;
      try {
        const result: GetDeleteImpactResult =
          await window.molio.getDeleteImpact({
            path: state.data.path,
            target: { kind: "bdb", id: bdbId },
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
    (bdbId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const bdb = findBdbById(state.data, bdbId);
      if (!bdb) return;
      // Slice 10H.8 — count live children that still point at this BDB
      // as master. Children already marked for deletion in the edit
      // buffer don't count — the user has "taken care of them", even
      // though the save hasn't happened yet.
      const pfbbChildCount = countLivePfbbChildren(
        state.data.bdbs,
        bdbId,
        (childId) => isPendingDelete(edits, "bdb", childId),
      );
      setDialog({
        bdb,
        impact: null,
        pfbbChildCount,
        deleteControlPlans: true,
        saving: false,
        error: null,
      });
      void fetchImpact(bdbId);
    },
    [state, edits, fetchImpact],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setDeleteControlPlans = useCallback((value: boolean): void => {
    setDialog((d) => (d ? { ...d, deleteControlPlans: value } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      setEdits((prev) =>
        markDelete(prev, "bdb", d.bdb.id, {
          deleteControlPlans: d.deleteControlPlans,
        }),
      );
      return null;
    });
  }, [setEdits]);

  return { dialog, open, cancel, setDeleteControlPlans, confirm };
}
