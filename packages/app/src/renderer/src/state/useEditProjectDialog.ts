/**
 * useEditProjectDialog — slice #233 Session 2.
 *
 * Buffered "Edit project metadata" dialog state + handlers. The
 * dialog state holds the originals (captured from the effective
 * snapshot at open time) plus the user's currently-edited values.
 * On confirm we flush all four fields through `setProjectField`;
 * identical values short-circuit inside the helper so no-op
 * touches don't dirty the edit map.
 *
 * Pattern target: this is the simplest of the four metadata-edit
 * dialogs (project / workSpec / bdb / cp). Extracting it first
 * validates the shape; the other three follow if/when the
 * structural refactor goes that way.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveProjectField,
  setProjectField,
} from "../edits.js";

export interface EditProjectDialogState {
  projectGuid: string;
  originalName: string;
  originalProjectNumber: string;
  originalBuilder: string | null;
  originalMolioReferencelistDate: string | null;
  name: string;
  projectNumber: string;
  builder: string;
  molioReferencelistDate: string;
}

export interface UseEditProjectDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseEditProjectDialogResult {
  /** Null when no dialog is open; otherwise the full dialog state. */
  dialog: EditProjectDialogState | null;
  /** Updater for inline-typed fields. The modal's `onChangeField`
   *  callback wires straight into this. */
  patch: (patch: Partial<EditProjectDialogState>) => void;
  /** Open the dialog, prefilling from the project's effective values. */
  open: () => void;
  /** Cancel without saving. */
  cancel: () => void;
  /** Flush all four fields through `setProjectField` and close. */
  confirm: () => void;
}

export function useEditProjectDialog({
  state,
  edits,
  setEdits,
}: UseEditProjectDialogArgs): UseEditProjectDialogResult {
  const [dialog, setDialog] = useState<EditProjectDialogState | null>(null);

  const open = useCallback((): void => {
    if (state.kind !== "loaded" || !state.data) return;
    const p = state.data.project;
    if (!p) return;
    const effectiveName =
      getEffectiveProjectField(edits, "name", p.name) ?? p.name;
    const effectiveNumber =
      getEffectiveProjectField(edits, "projectNumber", p.projectNumber) ??
      p.projectNumber;
    const effectiveBuilder = getEffectiveProjectField(
      edits,
      "builder",
      p.builder ?? null,
    );
    const effectiveRefDate = getEffectiveProjectField(
      edits,
      "molioReferencelistDate",
      p.moliioReferencelistDate ?? null,
    );
    setDialog({
      projectGuid: p.projectGuid,
      originalName: p.name,
      originalProjectNumber: p.projectNumber,
      originalBuilder: p.builder ?? null,
      originalMolioReferencelistDate: p.moliioReferencelistDate ?? null,
      name: effectiveName,
      projectNumber: effectiveNumber,
      builder: effectiveBuilder ?? "",
      molioReferencelistDate: effectiveRefDate ?? "",
    });
  }, [state, edits]);

  const cancel = useCallback((): void => setDialog(null), []);

  const patch = useCallback((p: Partial<EditProjectDialogState>): void => {
    setDialog((d) => (d ? { ...d, ...p } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      // NOT NULL fields: fall back to original if cleared.
      const nextName =
        d.name.trim().length === 0 ? d.originalName : d.name.trim();
      const nextNumber =
        d.projectNumber.trim().length === 0
          ? d.originalProjectNumber
          : d.projectNumber.trim();
      // Nullable fields: blank → null.
      const nextBuilder =
        d.builder.trim().length === 0 ? null : d.builder.trim();
      const nextRefDate =
        d.molioReferencelistDate.trim().length === 0
          ? null
          : d.molioReferencelistDate.trim();
      setEdits((m) => {
        let next = m;
        next = setProjectField(
          next,
          d.projectGuid,
          "name",
          nextName,
          d.originalName,
        );
        next = setProjectField(
          next,
          d.projectGuid,
          "projectNumber",
          nextNumber,
          d.originalProjectNumber,
        );
        next = setProjectField(
          next,
          d.projectGuid,
          "builder",
          nextBuilder,
          d.originalBuilder,
        );
        next = setProjectField(
          next,
          d.projectGuid,
          "molioReferencelistDate",
          nextRefDate,
          d.originalMolioReferencelistDate,
        );
        return next;
      });
      return null;
    });
  }, [setEdits]);

  return { dialog, patch, open, cancel, confirm };
}
