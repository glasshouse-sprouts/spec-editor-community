/**
 * useDeleteAttachmentDialog — slice #233 Session 2 (round 4).
 *
 * Sidebar/global "Confirm delete attachment" dialog (Slice 10K.8).
 * Kept separate from the inline delete inside `AttachmentsModal` /
 * `GlobalAttachmentsModal` so the sidebar right-click can surface a
 * clean confirmation prompt without needing either modal to be open.
 *
 * Simplest of the 5 attachment hooks — confirm prompt + delete IPC
 * + reload-or-error.
 */

import { useCallback, useState } from "react";

import type {
  DeleteAttachmentResult,
  FilePayload,
} from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findAttachmentById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface DeleteAttachmentDialogState {
  attachmentId: number;
  attachmentName: string;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseDeleteAttachmentDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseDeleteAttachmentDialogResult {
  dialog: DeleteAttachmentDialogState | null;
  open: (attachmentId: number) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export function useDeleteAttachmentDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseDeleteAttachmentDialogArgs): UseDeleteAttachmentDialogResult {
  const [dialog, setDialog] = useState<DeleteAttachmentDialogState | null>(
    null,
  );

  const open = useCallback(
    (attachmentId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const att = findAttachmentById(state.data, attachmentId);
      if (!att) return;
      setDialog({
        attachmentId,
        attachmentName: att.name,
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
      const result: DeleteAttachmentResult =
        await window.molio.deleteAttachment({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          attachmentId: dialog.attachmentId,
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

  return { dialog, open, cancel, confirm };
}
