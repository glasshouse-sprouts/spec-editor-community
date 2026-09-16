/**
 * useEditCpDialog — slice #233 Session 2.
 *
 * Buffered "Edit control-plan metadata" dialog state + handlers.
 * Narrower than the BDB/WorkSpec versions because the Molio
 * `control_plan` schema only has `title` + `revision` +
 * `revision_date` + `number_text` as writable columns. Title routes
 * through the existing `setCpTitle` path on confirm; the rest go
 * through `setCpField`.
 */

import { useCallback, useState } from "react";

import type { FilePayload } from "../../../shared/ipc.js";
import {
  type EditMap,
  getEffectiveCpField,
  getEffectiveCpTitle,
  setCpField,
  setCpTitle,
} from "../edits.js";
import { findControlPlanById } from "../loaded.js";

export interface EditCpDialogState {
  id: number;
  originalTitle: string;
  originalRevision: string | null;
  originalRevisionDate: string | null;
  /** 10I-followup gap 2 — disk value of `number_text`. NOT NULL
   *  in the schema, so it's always a string (possibly empty). */
  originalNumberText: string;
  title: string;
  numberText: string;
  revision: string;
  revisionDate: string;
}

export interface UseEditCpDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  setEdits: (updater: (m: EditMap) => EditMap) => void;
}

export interface UseEditCpDialogResult {
  dialog: EditCpDialogState | null;
  patch: (patch: Partial<EditCpDialogState>) => void;
  open: (controlPlanId: number) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useEditCpDialog({
  state,
  edits,
  setEdits,
}: UseEditCpDialogArgs): UseEditCpDialogResult {
  const [dialog, setDialog] = useState<EditCpDialogState | null>(null);

  const open = useCallback(
    (controlPlanId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const cp = findControlPlanById(state.data, controlPlanId);
      if (!cp) return;

      const effTitle = getEffectiveCpTitle(edits, cp.id, cp.title);
      const effRevision = getEffectiveCpField(
        edits,
        cp.id,
        "revision",
        cp.revision,
      );
      const effRevisionDate = getEffectiveCpField(
        edits,
        cp.id,
        "revisionDate",
        cp.revisionDate,
      );
      // 10I-followup gap 2 — number_text. NOT NULL in schema, so we
      // pass an empty string for the original when null/undefined.
      const originalNumberText = cp.numberText ?? "";
      const effNumberText = getEffectiveCpField(
        edits,
        cp.id,
        "numberText",
        originalNumberText,
      );

      setDialog({
        id: cp.id,
        originalTitle: cp.title,
        originalRevision: cp.revision,
        originalRevisionDate: cp.revisionDate,
        originalNumberText,
        title: effTitle,
        numberText: effNumberText ?? "",
        revision: effRevision ?? "",
        revisionDate: effRevisionDate ?? "",
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const patch = useCallback((p: Partial<EditCpDialogState>): void => {
    setDialog((d) => (d ? { ...d, ...p } : d));
  }, []);

  const confirm = useCallback((): void => {
    setDialog((d) => {
      if (!d) return d;
      const nextTitle =
        d.title.trim().length === 0 ? d.originalTitle : d.title.trim();
      const blankToNull = (s: string): string | null =>
        s.trim().length === 0 ? null : s.trim();
      setEdits((m) => {
        let next = m;
        // Title goes through the existing cpTitle variant (same path the
        // inline table-header editor uses) so there's only one patch per
        // column.
        next = setCpTitle(next, d.id, nextTitle, d.originalTitle);
        next = setCpField(
          next,
          d.id,
          "revision",
          blankToNull(d.revision),
          d.originalRevision,
        );
        next = setCpField(
          next,
          d.id,
          "revisionDate",
          blankToNull(d.revisionDate),
          d.originalRevisionDate,
        );
        // 10I-followup gap 2 — `number_text` is NOT NULL, so we
        // never null-clear here; setCpField + the flatten step
        // emit "" as the cleared value.
        next = setCpField(
          next,
          d.id,
          "numberText",
          d.numberText,
          d.originalNumberText,
        );
        return next;
      });
      return null;
    });
  }, [setEdits]);

  return { dialog, patch, open, cancel, confirm };
}
