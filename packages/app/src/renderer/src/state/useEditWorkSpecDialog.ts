/**
 * useEditWorkSpecDialog — slice #233 Session 2 (third metadata
 * edit dialog after project + bdb).
 *
 * Buffered "Edit work area metadata" dialog state + handlers.
 * Same shape as `useEditProjectDialog` but with 10 editable
 * fields (workArea code/name/type, revision, revisionDate,
 * issueDate, createdBy, createdByOrganization, reviewedBy,
 * approvedBy) plus a read-only `locked` block for the
 * Molio-supplied revision metadata.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveWorkSpecField,
  setWorkSpecField,
} from "../edits.js";
import { findWorkSpecById } from "../loaded.js";

export interface EditWorkSpecDialogState {
  id: number;
  originalWorkAreaCode: string | null;
  originalWorkAreaName: string;
  originalWorkAreaType: number;
  originalRevision: string | null;
  originalRevisionDate: string | null;
  originalIssueDate: string | null;
  originalCreatedBy: string | null;
  originalCreatedByOrganization: string | null;
  originalReviewedBy: string | null;
  originalApprovedBy: string | null;
  // Form values (always strings for <input> bindings).
  workAreaCode: string;
  workAreaName: string;
  workAreaType: number;
  revision: string;
  revisionDate: string;
  issueDate: string;
  createdBy: string;
  createdByOrganization: string;
  reviewedBy: string;
  approvedBy: string;
  // Locked (read-only).
  locked: {
    molioSpecRevisionNo: string | null;
    molioSpecRevisionDate: string | null;
    /** MAPI6-F — schema-level Molio reference GUIDs surfaced
     *  read-only so the user can see (and copy) the IDs the spec
     *  is bound to in Molio's catalogue. Sourced from
     *  `WorkSpecInfo.refs`. */
    molioSpecGuid: string | null;
    molioSpecRevisionGuid: string | null;
    paradigmGuid: string | null;
    paradigmRevisionGuid: string | null;
    referencelistArea: string | null;
    referencelistAreaDate: string | null;
  };
}

export interface UseEditWorkSpecDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseEditWorkSpecDialogResult {
  dialog: EditWorkSpecDialogState | null;
  patch: (patch: Partial<EditWorkSpecDialogState>) => void;
  open: (workSpecId: number) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useEditWorkSpecDialog({
  state,
  edits,
  setEdits,
}: UseEditWorkSpecDialogArgs): UseEditWorkSpecDialogResult {
  const [dialog, setDialog] = useState<EditWorkSpecDialogState | null>(null);

  const open = useCallback(
    (workSpecId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const ws = findWorkSpecById(state.data, workSpecId);
      if (!ws) return;
      const effStr = (
        field: Parameters<typeof getEffectiveWorkSpecField>[2],
        orig: string | null,
      ): string | null =>
        getEffectiveWorkSpecField(edits, ws.id, field, orig) as string | null;
      const effNum = (
        field: Parameters<typeof getEffectiveWorkSpecField>[2],
        orig: number,
      ): number =>
        getEffectiveWorkSpecField(edits, ws.id, field, orig) as number;
      setDialog({
        id: ws.id,
        originalWorkAreaCode: ws.workAreaCode,
        originalWorkAreaName: ws.workAreaName,
        originalWorkAreaType: ws.workAreaType,
        originalRevision: ws.revision,
        originalRevisionDate: ws.revisionDate,
        originalIssueDate: ws.issueDate,
        originalCreatedBy: ws.createdBy,
        originalCreatedByOrganization: ws.createdByOrganization,
        originalReviewedBy: ws.reviewedBy,
        originalApprovedBy: ws.approvedBy,
        workAreaCode: effStr("workAreaCode", ws.workAreaCode) ?? "",
        workAreaName:
          (effStr("workAreaName", ws.workAreaName) as string) ??
          ws.workAreaName,
        workAreaType: effNum("workAreaType", ws.workAreaType),
        revision: effStr("revision", ws.revision) ?? "",
        revisionDate: effStr("revisionDate", ws.revisionDate) ?? "",
        issueDate: effStr("issueDate", ws.issueDate) ?? "",
        createdBy: effStr("createdBy", ws.createdBy) ?? "",
        createdByOrganization:
          effStr("createdByOrganization", ws.createdByOrganization) ?? "",
        reviewedBy: effStr("reviewedBy", ws.reviewedBy) ?? "",
        approvedBy: effStr("approvedBy", ws.approvedBy) ?? "",
        locked: {
          molioSpecRevisionNo: ws.locked.molioSpecRevisionNo,
          molioSpecRevisionDate: ws.locked.molioSpecRevisionDate,
          molioSpecGuid: ws.refs.basisGuid,
          molioSpecRevisionGuid: ws.refs.basisRevisionGuid,
          paradigmGuid: ws.refs.paradigmGuid,
          paradigmRevisionGuid: ws.refs.paradigmRevisionGuid,
          referencelistArea: ws.refs.referencelistArea,
          referencelistAreaDate: ws.refs.referencelistAreaDate,
        },
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const patch = useCallback((p: Partial<EditWorkSpecDialogState>): void => {
    setDialog((d) => (d ? { ...d, ...p } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      // NOT NULL: workAreaName falls back to original if blanked.
      // The type enum is always a valid number (0/1/2) — no fallback.
      const nextName =
        d.workAreaName.trim().length === 0
          ? d.originalWorkAreaName
          : d.workAreaName.trim();
      const blankToNull = (s: string): string | null =>
        s.trim().length === 0 ? null : s.trim();
      setEdits((m) => {
        let next = m;
        next = setWorkSpecField(
          next,
          d.id,
          "workAreaCode",
          blankToNull(d.workAreaCode),
          d.originalWorkAreaCode,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "workAreaName",
          nextName,
          d.originalWorkAreaName,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "workAreaType",
          d.workAreaType,
          d.originalWorkAreaType,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "revision",
          blankToNull(d.revision),
          d.originalRevision,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "revisionDate",
          blankToNull(d.revisionDate),
          d.originalRevisionDate,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "issueDate",
          blankToNull(d.issueDate),
          d.originalIssueDate,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "createdBy",
          blankToNull(d.createdBy),
          d.originalCreatedBy,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "createdByOrganization",
          blankToNull(d.createdByOrganization),
          d.originalCreatedByOrganization,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "reviewedBy",
          blankToNull(d.reviewedBy),
          d.originalReviewedBy,
        );
        next = setWorkSpecField(
          next,
          d.id,
          "approvedBy",
          blankToNull(d.approvedBy),
          d.originalApprovedBy,
        );
        return next;
      });
      return null;
    });
  }, [setEdits]);

  return { dialog, patch, open, cancel, confirm };
}
