/**
 * useGlobalAttachmentsDialog — slice #233 Session 2 (round 4).
 *
 * Project-wide "Attachments" overview dialog (Slice 10K.5). Read-only
 * list of every attachment in the project plus per-row Delete + a
 * "Go to work area…" action that closes this modal and opens the
 * per-work-area `AttachmentsModal` (so the user can Add / Replace
 * with full context).
 *
 * Delete uses the same IPC path as the per-work-area delete but
 * routes its saving/error state through this hook's dialog. The
 * dirty-state guard mirrors the per-work-area modal.
 */

import { useCallback, useState } from "react";

import type { DeleteAttachmentResult } from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface GlobalAttachmentsDialogState {
  saving: boolean;
  /** ID of the row currently being deleted, for row-level disable. */
  savingId: number | null;
  error: CpOpDialogError | null;
}

export interface UseGlobalAttachmentsDialogArgs {
  state: { kind: string; data?: { path: string } };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseGlobalAttachmentsDialogResult {
  dialog: GlobalAttachmentsDialogState | null;
  open: () => void;
  cancel: () => void;
  confirmDelete: (attachmentId: number) => Promise<void>;
}

export function useGlobalAttachmentsDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseGlobalAttachmentsDialogArgs): UseGlobalAttachmentsDialogResult {
  const [dialog, setDialog] = useState<GlobalAttachmentsDialogState | null>(
    null,
  );

  const open = useCallback((): void => {
    if (state.kind !== "loaded") return;
    setDialog({
      saving: false,
      savingId: null,
      error: hasEdits(edits) ? { kind: "dirty" } : null,
    });
  }, [state, edits]);

  const cancel = useCallback((): void => setDialog(null), []);

  const confirmDelete = useCallback(
    async (attachmentId: number): Promise<void> => {
      if (state.kind !== "loaded" || !state.data) return;
      if (!dialog) return;
      if (dialog.saving) return;
      if (hasEdits(edits)) {
        setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
        return;
      }
      setDialog((d) =>
        d ? { ...d, saving: true, savingId: attachmentId, error: null } : d,
      );
      try {
        const result: DeleteAttachmentResult =
          await window.molio.deleteAttachment({
            path: state.data.path,
            storedMtimeMs: baselineMtimeMs,
            force: false,
            attachmentId,
          });
        if (result.kind === "not-found") {
          // Row vanished under us — reload to sync UI.
          await reloadAfterCpOp();
          setDialog((d) =>
            d ? { ...d, saving: false, savingId: null, error: null } : d,
          );
          return;
        }
        if (result.kind === "conflict" || result.kind === "missing") {
          setDialog((d) =>
            d
              ? {
                  ...d,
                  saving: false,
                  savingId: null,
                  error: classifyCpOpError(result),
                }
              : d,
          );
          return;
        }
        await reloadAfterCpOp();
        setDialog((d) =>
          d ? { ...d, saving: false, savingId: null, error: null } : d,
        );
      } catch (err) {
        setDialog((d) =>
          d
            ? {
                ...d,
                saving: false,
                savingId: null,
                error: {
                  kind: "other",
                  message: friendlyErrorForDialog(err),
                },
              }
            : d,
        );
      }
    },
    [dialog, state, edits, baselineMtimeMs, reloadAfterCpOp],
  );

  return { dialog, open, cancel, confirmDelete };
}
