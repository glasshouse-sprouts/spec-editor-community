/**
 * useRenameAttachmentDialog — slice #233 Session 2 (round 4).
 *
 * Sidebar-driven "Rename attachment" dialog (Slice 10K.8). Opened
 * from a right-click on an attachment row in the project tree.
 * Small text-input modal with immediate persistence: open → rename
 * → reload → close. Dirty-guard mirrors every other attachment op.
 *
 * No-op short-circuit: if the trimmed input matches the original
 * name, we close without calling IPC.
 */

import { useCallback, useState } from "react";

import type {
  FilePayload,
  RenameAttachmentResult,
} from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findAttachmentById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface RenameAttachmentDialogState {
  attachmentId: number;
  /** Original name — used to show "rename X to …". */
  originalName: string;
  /** Current value of the text input (controlled). */
  name: string;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseRenameAttachmentDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseRenameAttachmentDialogResult {
  dialog: RenameAttachmentDialogState | null;
  open: (attachmentId: number) => void;
  cancel: () => void;
  setName: (name: string) => void;
  confirm: () => Promise<void>;
}

export function useRenameAttachmentDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseRenameAttachmentDialogArgs): UseRenameAttachmentDialogResult {
  const [dialog, setDialog] = useState<RenameAttachmentDialogState | null>(
    null,
  );

  const open = useCallback(
    (attachmentId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const att = findAttachmentById(state.data, attachmentId);
      if (!att) return;
      setDialog({
        attachmentId,
        originalName: att.name,
        name: att.name,
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

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const newName = dialog.name.trim();
    if (!newName) return;
    if (newName === dialog.originalName) {
      // Nothing to do — treat as a successful cancel.
      setDialog(null);
      return;
    }
    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const result: RenameAttachmentResult =
        await window.molio.renameAttachment({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          attachmentId: dialog.attachmentId,
          name: newName,
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

  return { dialog, open, cancel, setName, confirm };
}
