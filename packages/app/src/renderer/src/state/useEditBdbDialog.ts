/**
 * useEditBdbDialog — slice #233 Session 2.
 *
 * Buffered "Edit BDB metadata" dialog state + handlers. Same shape
 * as `useEditWorkSpecDialog` plus the `isPfbb` toggle and a richer
 * locked block.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import { type EditMap, getEffectiveBdbField, setBdbField } from "../edits.js";
import { findBdbById } from "../loaded.js";
import { isVirtualWorkSpecInfo } from "../pfbbMigration.js";

export interface EditBdbDialogState {
  id: number;
  originalName: string;
  originalIsPfbb: number;
  currentWorkSpecIsVirtual: boolean;
  isPfbbChild: boolean;
  originalRevision: string | null;
  originalRevisionDate: string | null;
  originalIssueDate: string | null;
  originalCreatedBy: string | null;
  originalCreatedByOrganization: string | null;
  originalReviewedBy: string | null;
  originalApprovedBy: string | null;
  name: string;
  isPfbb: boolean;
  revision: string;
  revisionDate: string;
  issueDate: string;
  createdBy: string;
  createdByOrganization: string;
  reviewedBy: string;
  approvedBy: string;
  locked: {
    molioSpecRevisionNo: string | null;
    molioSpecRevisionDate: string | null;
    controlplanDesignId: string | null;
    controlplanProductionId: string | null;
    commonControlplanDesignGuid: string | null;
    commonControlplanProductionGuid: string | null;
    molioConstructionElementSpecGuid: string | null;
    molioConstructionElementSpecRevisionGuid: string | null;
    molioConstructionElementSpecRevisionNo: string | null;
    molioConstructionElementSpecRevisionDate: string | null;
    /** MAPI6-F — schema-level Molio reference GUIDs surfaced
     *  read-only. Sourced from `BdbInfo.refs`. */
    molioSpecGuid: string | null;
    molioSpecRevisionGuid: string | null;
    referencelistArea: string | null;
    referencelistAreaDate: string | null;
  };
}

export interface UseEditBdbDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseEditBdbDialogResult {
  dialog: EditBdbDialogState | null;
  patch: (patch: Partial<EditBdbDialogState>) => void;
  open: (bdbId: number) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useEditBdbDialog({
  state,
  edits,
  setEdits,
}: UseEditBdbDialogArgs): UseEditBdbDialogResult {
  const [dialog, setDialog] = useState<EditBdbDialogState | null>(null);

  const open = useCallback(
    (bdbId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const b = findBdbById(state.data, bdbId);
      if (!b) return;
      const effStr = (
        field: Parameters<typeof getEffectiveBdbField>[2],
        orig: string | null,
      ): string | null =>
        getEffectiveBdbField(edits, b.id, field, orig) as string | null;
      const effNum = (
        field: Parameters<typeof getEffectiveBdbField>[2],
        orig: number,
      ): number => getEffectiveBdbField(edits, b.id, field, orig) as number;
      const originalIsPfbbNum = b.isPfbb ? 1 : 0;
      const effIsPfbb = effNum("isPfbb", originalIsPfbbNum);
      const currentWs = state.data.workSpecs.find((w) => w.id === b.workSpecId);
      const currentWorkSpecIsVirtual =
        currentWs != null && isVirtualWorkSpecInfo(currentWs);
      setDialog({
        id: b.id,
        originalName: b.name,
        originalIsPfbb: originalIsPfbbNum,
        currentWorkSpecIsVirtual,
        isPfbbChild: b.pfbbId != null,
        originalRevision: b.revision,
        originalRevisionDate: b.revisionDate,
        originalIssueDate: b.issueDate,
        originalCreatedBy: b.createdBy,
        originalCreatedByOrganization: b.createdByOrganization,
        originalReviewedBy: b.reviewedBy,
        originalApprovedBy: b.approvedBy,
        name: (effStr("name", b.name) as string) ?? b.name,
        isPfbb: effIsPfbb === 1,
        revision: effStr("revision", b.revision) ?? "",
        revisionDate: effStr("revisionDate", b.revisionDate) ?? "",
        issueDate: effStr("issueDate", b.issueDate) ?? "",
        createdBy: effStr("createdBy", b.createdBy) ?? "",
        createdByOrganization:
          effStr("createdByOrganization", b.createdByOrganization) ?? "",
        reviewedBy: effStr("reviewedBy", b.reviewedBy) ?? "",
        approvedBy: effStr("approvedBy", b.approvedBy) ?? "",
        locked: {
          molioSpecRevisionNo: b.locked.molioSpecRevisionNo,
          molioSpecRevisionDate: b.locked.molioSpecRevisionDate,
          controlplanDesignId: b.locked.controlplanDesignId,
          controlplanProductionId: b.locked.controlplanProductionId,
          commonControlplanDesignGuid: b.locked.commonControlplanDesignGuid,
          commonControlplanProductionGuid:
            b.locked.commonControlplanProductionGuid,
          molioConstructionElementSpecGuid:
            b.locked.molioConstructionElementSpecGuid,
          molioConstructionElementSpecRevisionGuid:
            b.locked.molioConstructionElementSpecRevisionGuid,
          molioConstructionElementSpecRevisionNo:
            b.locked.molioConstructionElementSpecRevisionNo,
          molioConstructionElementSpecRevisionDate:
            b.locked.molioConstructionElementSpecRevisionDate,
          molioSpecGuid: b.refs.basisGuid,
          molioSpecRevisionGuid: b.refs.basisRevisionGuid,
          referencelistArea: b.refs.referencelistArea,
          referencelistAreaDate: b.refs.referencelistAreaDate,
        },
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const patch = useCallback((p: Partial<EditBdbDialogState>): void => {
    setDialog((d) => (d ? { ...d, ...p } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      const nextName =
        d.name.trim().length === 0 ? d.originalName : d.name.trim();
      const blankToNull = (s: string): string | null =>
        s.trim().length === 0 ? null : s.trim();
      setEdits((m) => {
        let next = m;
        next = setBdbField(next, d.id, "name", nextName, d.originalName);
        next = setBdbField(
          next,
          d.id,
          "isPfbb",
          d.isPfbb ? 1 : 0,
          d.originalIsPfbb,
        );
        next = setBdbField(
          next,
          d.id,
          "revision",
          blankToNull(d.revision),
          d.originalRevision,
        );
        next = setBdbField(
          next,
          d.id,
          "revisionDate",
          blankToNull(d.revisionDate),
          d.originalRevisionDate,
        );
        next = setBdbField(
          next,
          d.id,
          "issueDate",
          blankToNull(d.issueDate),
          d.originalIssueDate,
        );
        next = setBdbField(
          next,
          d.id,
          "createdBy",
          blankToNull(d.createdBy),
          d.originalCreatedBy,
        );
        next = setBdbField(
          next,
          d.id,
          "createdByOrganization",
          blankToNull(d.createdByOrganization),
          d.originalCreatedByOrganization,
        );
        next = setBdbField(
          next,
          d.id,
          "reviewedBy",
          blankToNull(d.reviewedBy),
          d.originalReviewedBy,
        );
        next = setBdbField(
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
