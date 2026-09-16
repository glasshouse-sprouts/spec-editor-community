/**
 * useAttachmentsDialog — slice #233 Session 2 (round 4).
 *
 * Work-area-level "Manage attachments" dialog. Immediate-persistence
 * flow: open → pick a file → IPC → reload-on-success. The dialog
 * stays open after each op so the user can add/replace/delete several
 * in a row.
 *
 * Dirty-state guard: reloading the file discards buffered edits, so
 * we refuse to run any attachment op while the edit map is non-empty
 * — same bar as NewCp / NewContract / MoveCp.
 *
 * Error union widens the shared `CpOpDialogError` with two
 * attachment-specific variants:
 *   - `too-large`  — pre-IPC size guard or main-process rejection.
 *   - `duplicate`  — Molio stores attachments content-addressed
 *                    (UNIQUE sha1), so re-uploading the same bytes
 *                    surfaces the existing row's name + work area.
 */

import { useCallback, useState } from "react";

import type {
  AddAttachmentResult,
  DeleteAttachmentResult,
  FilePayload,
  ReplaceAttachmentResult,
} from "../../../shared/ipc.js";
import { MAX_ATTACHMENT_BYTES } from "../../../shared/ipc.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findWorkSpecById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export type AttachmentsDialogError =
  | CpOpDialogError
  | { kind: "too-large"; maxBytes: number; actualBytes: number }
  | {
      kind: "duplicate";
      existingName: string;
      existingWorkSpecLabel: string;
    };

export interface AttachmentsDialogState {
  workSpecId: number;
  workSpecLabel: string;
  pending: {
    file: File;
    attachmentTypeId: 1 | 2;
  } | null;
  saving: boolean;
  error: AttachmentsDialogError | null;
}

export interface UseAttachmentsDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseAttachmentsDialogResult {
  dialog: AttachmentsDialogState | null;
  open: (workSpecId: number) => void;
  cancel: () => void;
  setPendingFile: (file: File | null, attachmentTypeId?: 1 | 2) => void;
  setPendingType: (attachmentTypeId: 1 | 2) => void;
  confirmAdd: () => Promise<void>;
  confirmDelete: (attachmentId: number) => Promise<void>;
  confirmReplace: (attachmentId: number, file: File) => Promise<void>;
}

export function useAttachmentsDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseAttachmentsDialogArgs): UseAttachmentsDialogResult {
  const [dialog, setDialog] = useState<AttachmentsDialogState | null>(null);

  const open = useCallback(
    (workSpecId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const ws = findWorkSpecById(state.data, workSpecId);
      if (!ws) return;
      const label = ws.workAreaCode
        ? `${ws.workAreaCode} – ${ws.workAreaName}`
        : ws.workAreaName;
      setDialog({
        workSpecId,
        workSpecLabel: label,
        pending: null,
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setPendingFile = useCallback(
    (file: File | null, attachmentTypeId: 1 | 2 = 1): void => {
      setDialog((d) =>
        d
          ? {
              ...d,
              pending: file ? { file, attachmentTypeId } : null,
              error: null,
            }
          : d,
      );
    },
    [],
  );

  const setPendingType = useCallback((attachmentTypeId: 1 | 2): void => {
    setDialog((d) =>
      d && d.pending
        ? { ...d, pending: { ...d.pending, attachmentTypeId } }
        : d,
    );
  }, []);

  const confirmAdd = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (!dialog.pending) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const { file, attachmentTypeId } = dialog.pending;
    // Client-side size guard so we don't pay for a 500 MB IPC round-trip
    // only to be rejected by the main process.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setDialog((d) =>
        d
          ? {
              ...d,
              error: {
                kind: "too-large",
                maxBytes: MAX_ATTACHMENT_BYTES,
                actualBytes: file.size,
              },
            }
          : d,
      );
      return;
    }
    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const result: AddAttachmentResult = await window.molio.addAttachment({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        workSpecId: dialog.workSpecId,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        content: buf,
        attachmentTypeId,
      });
      if (result.kind === "too-large") {
        setDialog((d) =>
          d
            ? {
                ...d,
                saving: false,
                error: {
                  kind: "too-large",
                  maxBytes: result.maxBytes,
                  actualBytes: result.actualBytes,
                },
              }
            : d,
        );
        return;
      }
      if (result.kind === "duplicate") {
        // Molio stores attachments content-addressed (UNIQUE sha1).
        // Resolve the existing row's work-area label so the user
        // knows exactly where the twin lives.
        const existing = result.existing;
        const ws =
          state.kind === "loaded" && state.data
            ? findWorkSpecById(state.data, existing.workSpecId)
            : undefined;
        const wsLabel = ws
          ? ws.workAreaCode
            ? `${ws.workAreaCode} – ${ws.workAreaName}`
            : ws.workAreaName
          : `work area #${existing.workSpecId}`;
        setDialog((d) =>
          d
            ? {
                ...d,
                saving: false,
                error: {
                  kind: "duplicate",
                  existingName: existing.name,
                  existingWorkSpecLabel: wsLabel,
                },
              }
            : d,
        );
        return;
      }
      if (result.kind === "conflict" || result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
        );
        return;
      }
      await reloadAfterCpOp();
      setDialog((d) =>
        d ? { ...d, pending: null, saving: false, error: null } : d,
      );
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

  const confirmDelete = useCallback(
    async (attachmentId: number): Promise<void> => {
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
            attachmentId,
          });
        if (result.kind === "not-found") {
          // Row vanished under us — reload to sync UI.
          await reloadAfterCpOp();
          setDialog((d) => (d ? { ...d, saving: false, error: null } : d));
          return;
        }
        if (result.kind === "conflict" || result.kind === "missing") {
          setDialog((d) =>
            d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
          );
          return;
        }
        await reloadAfterCpOp();
        setDialog((d) => (d ? { ...d, saving: false, error: null } : d));
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
    },
    [dialog, state, edits, baselineMtimeMs, reloadAfterCpOp],
  );

  const confirmReplace = useCallback(
    async (attachmentId: number, file: File): Promise<void> => {
      if (state.kind !== "loaded" || !state.data) return;
      if (!dialog) return;
      if (dialog.saving) return;
      if (hasEdits(edits)) {
        setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setDialog((d) =>
          d
            ? {
                ...d,
                error: {
                  kind: "too-large",
                  maxBytes: MAX_ATTACHMENT_BYTES,
                  actualBytes: file.size,
                },
              }
            : d,
        );
        return;
      }
      setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const result: ReplaceAttachmentResult =
          await window.molio.replaceAttachment({
            path: state.data.path,
            storedMtimeMs: baselineMtimeMs,
            force: false,
            attachmentId,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            content: buf,
          });
        if (result.kind === "too-large") {
          setDialog((d) =>
            d
              ? {
                  ...d,
                  saving: false,
                  error: {
                    kind: "too-large",
                    maxBytes: result.maxBytes,
                    actualBytes: result.actualBytes,
                  },
                }
              : d,
          );
          return;
        }
        if (result.kind === "not-found") {
          await reloadAfterCpOp();
          setDialog((d) => (d ? { ...d, saving: false, error: null } : d));
          return;
        }
        if (result.kind === "conflict" || result.kind === "missing") {
          setDialog((d) =>
            d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
          );
          return;
        }
        await reloadAfterCpOp();
        setDialog((d) => (d ? { ...d, saving: false, error: null } : d));
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
    },
    [dialog, state, edits, baselineMtimeMs, reloadAfterCpOp],
  );

  return {
    dialog,
    open,
    cancel,
    setPendingFile,
    setPendingType,
    confirmAdd,
    confirmDelete,
    confirmReplace,
  };
}
