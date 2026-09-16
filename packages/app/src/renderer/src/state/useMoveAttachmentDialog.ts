/**
 * useMoveAttachmentDialog — slice #233 Session 2 (round 4).
 *
 * "Move attachment to another work area" dialog (Slice 10K.8). The
 * Molio schema keeps UNIQUE(sha1_hash), so we can't "link" an
 * attachment to multiple work areas — only move. Picker layout
 * mirrors `MoveWorkSpecModal` so the two feel like siblings.
 * Invoked from both the sidebar right-click and the Global
 * Attachments modal "Move…" row button.
 *
 * Patch helpers (`setFilter` / `setTarget`) keep the JSX wiring small
 * — same shape as the metadata-edit dialogs' `patch` callback.
 */

import { useCallback, useState } from "react";

import type { FilePayload, MoveAttachmentResult } from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findAttachmentById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface MoveAttachmentDialogState {
  attachmentId: number;
  attachmentName: string;
  /** Current parent work_spec id — used to diff + disable as target. */
  currentWorkSpecId: number;
  /** Free-text filter over the work-area picker list. */
  filter: string;
  /** Currently-selected target work_spec id (null until user picks). */
  targetWorkSpecId: number | null;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseMoveAttachmentDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseMoveAttachmentDialogResult {
  dialog: MoveAttachmentDialogState | null;
  open: (attachmentId: number) => void;
  cancel: () => void;
  setFilter: (filter: string) => void;
  setTarget: (workSpecId: number | null) => void;
  confirm: () => Promise<void>;
}

export function useMoveAttachmentDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseMoveAttachmentDialogArgs): UseMoveAttachmentDialogResult {
  const [dialog, setDialog] = useState<MoveAttachmentDialogState | null>(null);

  const open = useCallback(
    (attachmentId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const att = findAttachmentById(state.data, attachmentId);
      if (!att) return;
      setDialog({
        attachmentId,
        attachmentName: att.name,
        currentWorkSpecId: att.workSpecId,
        filter: "",
        targetWorkSpecId: null,
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setFilter = useCallback((filter: string): void => {
    setDialog((d) => (d ? { ...d, filter } : d));
  }, []);

  const setTarget = useCallback((workSpecId: number | null): void => {
    setDialog((d) => (d ? { ...d, targetWorkSpecId: workSpecId } : d));
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const target = dialog.targetWorkSpecId;
    if (target == null) return;
    if (target === dialog.currentWorkSpecId) {
      // No-op move.
      setDialog(null);
      return;
    }
    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: MoveAttachmentResult = await window.molio.moveAttachment({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        attachmentId: dialog.attachmentId,
        newWorkSpecId: target,
      });
      if (result.kind === "not-found") {
        await reloadAfterCpOp();
        setDialog(null);
        return;
      }
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

  return { dialog, open, cancel, setFilter, setTarget, confirm };
}
