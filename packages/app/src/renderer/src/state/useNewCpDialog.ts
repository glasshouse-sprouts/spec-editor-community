/**
 * useNewCpDialog — slice #233 Session 2 (round 5).
 *
 * "New control plan…" dialog. Opened from the sidebar right-click on
 * a BDB. Two modes share one dialog:
 *   - "blank":     create an empty CP via createControlPlan IPC.
 *   - "duplicate": deep-clone an existing CP via duplicateControlPlan
 *                  IPC. (#107 — 6N.3.)
 *
 * Subtle behavior we keep here so the JSX stays small:
 *   - `titleTouched` tracks manual edits so we don't clobber the
 *     user's input when auto-prefilling from a source CP.
 *   - Mode switch resets the source selection and clears any
 *     auto-prefilled title so the two flows don't bleed.
 *   - Picking a source CP prefills the title (when untouched) and
 *     nudges the slot to the source's own slot if free on the
 *     target BDB.
 */

import { useCallback, useState } from "react";

import type {
  BdbInfo,
  CreateCpResult,
  DuplicateCpResult,
  FilePayload,
} from "../../../shared/ipc.js";
import { availableSlots, hasFreeSlot } from "../cpSlots.js";
import { classifyCpOpError, type CpOpDialogError } from "../cpOpError.js";
import { type EditMap, hasEdits } from "../edits.js";
import { findBdbById, findControlPlanById } from "../loaded.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface NewCpDialogState {
  bdb: BdbInfo;
  slot: "design" | "production";
  title: string;
  mode: "blank" | "duplicate";
  /** Selected source CP id when mode === "duplicate". */
  sourceCpId: number | null;
  /** Tracks manual title edits so auto-prefill doesn't clobber them. */
  titleTouched: boolean;
  saving: boolean;
  error: CpOpDialogError | null;
}

export interface UseNewCpDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: (opts?: {
    focus?: { kind: "controlPlan"; id: number };
  }) => Promise<void>;
}

export interface UseNewCpDialogResult {
  dialog: NewCpDialogState | null;
  open: (bdbId: number) => void;
  cancel: () => void;
  setTitle: (title: string) => void;
  setSlot: (slot: "design" | "production") => void;
  setMode: (mode: "blank" | "duplicate") => void;
  setSource: (sourceCpId: number | null) => void;
  confirm: () => Promise<void>;
}

export function useNewCpDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseNewCpDialogArgs): UseNewCpDialogResult {
  const [dialog, setDialog] = useState<NewCpDialogState | null>(null);

  const open = useCallback(
    (bdbId: number): void => {
      if (state.kind !== "loaded" || !state.data) return;
      const bdb = findBdbById(state.data, bdbId);
      if (!bdb) return;
      // Sidebar hides the menu item when both slots are taken; this
      // is belt & braces in case the call comes from another path.
      if (!hasFreeSlot(bdb)) return;
      const slots = availableSlots(bdb);
      const slot: "design" | "production" = slots.design
        ? "design"
        : "production";
      setDialog({
        bdb,
        slot,
        title: "",
        mode: "blank",
        sourceCpId: null,
        titleTouched: false,
        saving: false,
        error: hasEdits(edits) ? { kind: "dirty" } : null,
      });
    },
    [state, edits],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const setTitle = useCallback((title: string): void => {
    setDialog((d) => (d ? { ...d, title, titleTouched: true } : d));
  }, []);

  const setSlot = useCallback((slot: "design" | "production"): void => {
    setDialog((d) => (d ? { ...d, slot } : d));
  }, []);

  const setMode = useCallback((mode: "blank" | "duplicate"): void => {
    setDialog((d) => {
      if (!d) return d;
      // Switching mode resets the source selection and clears any
      // auto-prefilled title so the two flows don't bleed into each
      // other.
      if (mode === d.mode) return d;
      return {
        ...d,
        mode,
        sourceCpId: null,
        title: d.titleTouched ? d.title : "",
      };
    });
  }, []);

  const setSource = useCallback(
    (sourceCpId: number | null): void => {
      setDialog((d) => {
        if (!d) return d;
        // When the user picks a source CP (and hasn't typed their own
        // title yet) prefill Title with the source's title so it's
        // obvious what will happen. They can still edit.
        const src =
          sourceCpId != null && state.kind === "loaded" && state.data
            ? findControlPlanById(state.data, sourceCpId)
            : undefined;
        const nextTitle = !d.titleTouched && src ? src.title : d.title;
        // Nudge the slot to match the source CP's own type when that
        // slot is still free on the target BDB.
        const slotFromSource: "design" | "production" | null = src
          ? src.controlPlanType === 0
            ? "design"
            : src.controlPlanType === 1
              ? "production"
              : null
          : null;
        const free = availableSlots(d.bdb);
        const nextSlot: "design" | "production" =
          slotFromSource && free[slotFromSource] ? slotFromSource : d.slot;
        return { ...d, sourceCpId, title: nextTitle, slot: nextSlot };
      });
    },
    [state],
  );

  const confirm = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog) return;
    if (dialog.saving) return;
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }
    const title = dialog.title.trim();
    if (!title) return;
    if (dialog.mode === "duplicate" && dialog.sourceCpId == null) return;

    setDialog((d) => (d ? { ...d, saving: true, error: null } : d));
    try {
      let result: CreateCpResult | DuplicateCpResult;
      if (dialog.mode === "duplicate" && dialog.sourceCpId != null) {
        result = await window.molio.duplicateControlPlan({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          sourceCpId: dialog.sourceCpId,
          bdbId: dialog.bdb.id,
          slot: dialog.slot,
          title,
        });
      } else {
        result = await window.molio.createControlPlan({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
          bdbId: dialog.bdb.id,
          slot: dialog.slot,
          title,
        });
      }
      if (result.kind === "conflict" || result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, saving: false, error: classifyCpOpError(result) } : d,
        );
        return;
      }
      await reloadAfterCpOp({
        focus: { kind: "controlPlan", id: result.controlPlanId },
      });
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

  return {
    dialog,
    open,
    cancel,
    setTitle,
    setSlot,
    setMode,
    setSource,
    confirm,
  };
}
