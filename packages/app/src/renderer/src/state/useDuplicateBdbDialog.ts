/**
 * useDuplicateBdbDialog — slice #233 Session 2 (round 5).
 *
 * "Duplicate BDB" rename dialog (Slice 10E.dup). Buffered name
 * input + immediate-persistence IPC. On success the file is reloaded
 * and the new BDB opens as a fresh tab. On error, the dialog stays
 * open with the typed error so the user can retry without losing
 * their input.
 *
 * Pre-fills the rename input with `nextDuplicateName(...)` against
 * the current work-area's BDB names so collisions are avoided.
 *
 * Dirty guard: refuses while the edit map is non-empty (the op
 * writes to disk and a reload would discard pending edits).
 */

import { useCallback, useState } from "react";

import type {
  BdbInfo,
  DuplicateBdbResult,
  FilePayload,
} from "../../../shared/ipc.js";
import { nextDuplicateName } from "../bdbDuplicateName.js";
import type { CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findBdbById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface DuplicateBdbDialogState {
  bdb: BdbInfo;
  name: string;
  /**
   * Whether to also deep-copy the source BDB's attached control
   * plans into independent copies linked to the new BDB. Default
   * ON so the most-common expectation ("I want my own copy")
   * happens automatically. Unchecking falls back to the historical
   * behaviour (new BDB has empty CP slots).
   */
  includeControlPlans: boolean;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDuplicateBdbDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  /**
   * Reload the file after a write op. The duplicate flow uses the
   * `focus` arg to pop the newly-created BDB into a fresh tab.
   */
  reloadAfterCpOp: (opts?: {
    focus?: { kind: "bdb"; id: number };
  }) => Promise<void>;
}

export interface UseDuplicateBdbDialogResult {
  dialog: DuplicateBdbDialogState | null;
  open: (bdbId: number) => void;
  cancel: () => void;
  setName: (name: string) => void;
  setIncludeControlPlans: (include: boolean) => void;
  confirm: () => Promise<void>;
}

export function useDuplicateBdbDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseDuplicateBdbDialogArgs): UseDuplicateBdbDialogResult {
  const [dialog, setDialog] = useState<DuplicateBdbDialogState | null>(null);

  const open = useCallback(
    (bdbId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const bdb = findBdbById(state.data, bdbId);
      if (!bdb) return;
      // Only same-work-area siblings count for collision purposes — BDB
      // names are expected to be unique within their parent work-area.
      const siblings = state.data.bdbs
        .filter((b) => b.workSpecId === bdb.workSpecId)
        .map((b) => b.name);
      const defaultName = nextDuplicateName(bdb.name, siblings);
      setDialog({
        bdb,
        name: defaultName,
        // Default ON — matches user expectation for "duplicate"
        // (most users want a fully independent copy).
        includeControlPlans: true,
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

  const setIncludeControlPlans = useCallback((include: boolean): void => {
    setDialog((d) => (d ? { ...d, includeControlPlans: include } : d));
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const requestedName = dialog.name.trim();
    if (!requestedName) return;

    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: DuplicateBdbResult = await window.molio.duplicateBdb({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        bdbId: dialog.bdb.id,
        newName: requestedName,
        includeControlPlans: dialog.includeControlPlans,
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
      // Success — reload only. We deliberately do NOT auto-open
      // the new BDB as a tab: per user feedback 2026-05-11,
      // staying on the project overview after a duplicate is
      // expected. The user can click the duplicate in the
      // sidebar tree if they want to open it.
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

  return { dialog, open, cancel, setName, setIncludeControlPlans, confirm };
}
