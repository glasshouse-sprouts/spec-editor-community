/**
 * useImportDialog — slice #233 Session 2 (round 7).
 *
 * "Import from another moliospec" dialog (Slice 6K.3 — #94).
 * Multi-stage flow:
 *   1. Click Project → Import — dirty guard, then native file picker.
 *   2. Read source — slim summary + tree via `readImportSource`,
 *      seed per-item landing defaults.
 *   3. User toggles work-areas / BDBs / picks landing spots.
 *   4. Click Check — runs `importPrecheck`; collision UI unlocks.
 *   5. User resolves any collisions (skip / overwrite / rename).
 *   6. Click Import — runs `importApply`; on success reload + flip
 *      to a success view inside the modal.
 *
 * State is one fat object so all the cascade rules live in one place
 * and the modal is a pure controlled view (see importPlan.ts for the
 * helpers and ImportModal.tsx for the view).
 */

import { useCallback, useState } from "react";

import type {
  FilePayload,
  ImportApplyResult,
  ImportPrecheckDTO,
  ImportPrecheckResult,
  ImportSourceSummary,
  ImportSummary,
  ReadImportSourceResult,
} from "../../../shared/ipc.js";
import type { WorkAreaContractMapRow } from "../../../shared/defaultsCsv.js";
import { type EditMap, hasEdits } from "../edits.js";
import type { ImportDialogError } from "../ImportModal.js";
import {
  type BdbResolution,
  buildImportPlan,
  buildSourceTree,
  pickLandingContract,
  defaultResolutions,
  defaultWorkAreaForStandaloneBdb,
  emptyModalState,
  type ImportModalState,
  setLandingContract,
  setLandingWorkArea,
  type SourceTree,
  type SourceTreeWorkAreaNode,
  toggleBdb as togglePlanBdb,
  toggleWorkArea as togglePlanWorkArea,
  type WorkAreaResolution,
} from "../importPlan.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface ImportDialogState {
  sourcePath: string;
  summary: ImportSourceSummary | null;
  tree: SourceTree | null;
  /** #250 — work-area-code -> contract-code mapping (default CSV), fetched
   *  when the dialog opens. Used to pre-select a landing contract. */
  mapping: WorkAreaContractMapRow[];
  modalState: ImportModalState;
  precheck: ImportPrecheckDTO | null;
  resolutions: {
    workAreas: Map<number, WorkAreaResolution>;
    bdbs: Map<number, BdbResolution>;
  };
  busy: null | "loading" | "checking" | "applying";
  error: ImportDialogError | null;
  /** Set on successful apply; modal flips to success view. */
  successSummary: ImportSummary | null;
}

export interface UseImportDialogArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  reloadAfterCpOp: () => Promise<void>;
}

export interface UseImportDialogResult {
  dialog: ImportDialogState | null;
  /** Open: dirty-guard → native file picker → readImportSource. */
  request: () => Promise<void>;
  /** IMP-API — same flow as `request()` but with the source path
   *  already known (drop-zone, Browse Molio download). Skips the
   *  native file picker. */
  requestWithPath: (sourcePath: string) => Promise<void>;
  cancel: () => void;
  toggleWorkArea: (wa: SourceTreeWorkAreaNode, checked: boolean) => void;
  toggleBdb: (bdbId: number, checked: boolean) => void;
  setLandingContractFor: (
    sourceWsId: number,
    targetContractId: number | null,
  ) => void;
  setLandingWorkAreaFor: (sourceBdbId: number, targetWsId: number) => void;
  setWaResolution: (sourceWsId: number, r: WorkAreaResolution) => void;
  setBdbResolution: (sourceBdbId: number, r: BdbResolution) => void;
  /** Run importPrecheck. */
  check: () => Promise<void>;
  /** Run importApply (assumes precheck has been run). */
  apply: () => Promise<void>;
}

export function useImportDialog({
  state,
  edits,
  baselineMtimeMs,
  reloadAfterCpOp,
}: UseImportDialogArgs): UseImportDialogResult {
  const [dialog, setDialog] = useState<ImportDialogState | null>(null);

  /**
   * Internal: open the import dialog for a known source path.
   * Both `request()` (dialog-driven) and `requestWithPath()`
   * (drop-zone / Browse Molio) fall through here.
   */
  const openWithPath = useCallback(
    async (sourcePath: string): Promise<void> => {
      if (state.kind !== "loaded" || !state.data) return;
      if (hasEdits(edits)) {
        setDialog({
          sourcePath: "",
          summary: null,
          tree: null,
          mapping: [],
          modalState: emptyModalState(),
          precheck: null,
          resolutions: { workAreas: new Map(), bdbs: new Map() },
          busy: null,
          error: { kind: "dirty" },
          successSummary: null,
        });
        return;
      }
      setDialog({
        sourcePath,
        summary: null,
        tree: null,
        mapping: [],
        modalState: emptyModalState(),
        precheck: null,
        resolutions: { workAreas: new Map(), bdbs: new Map() },
        busy: "loading",
        error: null,
        successSummary: null,
      });
      try {
        const result: ReadImportSourceResult =
          await window.molio.readImportSource({ sourcePath });
        if (result.kind === "missing") {
          setDialog((d) =>
            d ? { ...d, busy: null, error: { kind: "source-missing" } } : d,
          );
          return;
        }
        const tree = buildSourceTree(result.summary);
        // #250 — fetch the user's work-area -> contract mapping so the
        // landing pre-select can use it. Optional; ignore failures.
        let mapping: WorkAreaContractMapRow[] = [];
        try {
          mapping = await window.molio.getContractWorkAreaMapping();
        } catch {
          /* no mapping available — fall back to source-contract match */
        }
        setDialog((d) =>
          d ? { ...d, summary: result.summary, tree, mapping, busy: null } : d,
        );
      } catch (err) {
        setDialog((d) =>
          d
            ? {
                ...d,
                busy: null,
                error: {
                  kind: "other",
                  message: friendlyErrorForDialog(err),
                },
              }
            : d,
        );
      }
    },
    [state, edits],
  );

  const request = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (hasEdits(edits)) {
      // Open the modal pre-erroring with `kind: "dirty"` so the user
      // sees what's wrong without having to hunt the dialog state.
      setDialog({
        sourcePath: "",
        summary: null,
        tree: null,
        mapping: [],
        modalState: emptyModalState(),
        precheck: null,
        resolutions: { workAreas: new Map(), bdbs: new Map() },
        busy: null,
        error: { kind: "dirty" },
        successSummary: null,
      });
      return;
    }
    const sourcePath = await window.molio.openFileDialog();
    if (!sourcePath) return;
    await openWithPath(sourcePath);
  }, [state, edits, openWithPath]);

  const requestWithPath = useCallback(
    (sourcePath: string): Promise<void> => openWithPath(sourcePath),
    [openWithPath],
  );

  const cancel = useCallback((): void => setDialog(null), []);

  const toggleWorkArea = useCallback(
    (wa: SourceTreeWorkAreaNode, checked: boolean): void => {
      setDialog((d) => {
        if (!d || !d.summary) return d;
        let nextModal = togglePlanWorkArea(d.modalState, wa, checked);
        // Seed a landing-contract default the first time a work area is
        // checked. The user can override — we don't stomp a previous
        // manual pick, so only seed when absent.
        if (checked && !nextModal.landingContract.has(wa.id)) {
          const src = d.summary.workAreas.find((w) => w.id === wa.id);
          const targetContracts =
            state.kind === "loaded" && state.data ? state.data.contracts : [];
          const defaultContract = pickLandingContract({
            workAreaCode: src?.workAreaCode ?? null,
            mapping: d.mapping,
            sourceContractId: src?.contractId ?? null,
            sourceContracts: d.summary.contracts,
            targetContracts,
          });
          nextModal = setLandingContract(nextModal, wa.id, defaultContract);
        }
        return { ...d, modalState: nextModal };
      });
    },
    [state],
  );

  const toggleBdb = useCallback(
    (bdbId: number, checked: boolean): void => {
      setDialog((d) => {
        if (!d || !d.tree || !d.summary) return d;
        let nextModal = togglePlanBdb(d.modalState, bdbId, checked);
        const isStandalone = d.tree.standaloneBdbs.some((b) => b.id === bdbId);
        if (checked && isStandalone && !nextModal.landingWorkArea.has(bdbId)) {
          const targetWorkSpecs =
            state.kind === "loaded" && state.data ? state.data.workSpecs : [];
          const def = defaultWorkAreaForStandaloneBdb(targetWorkSpecs);
          if (def !== null) {
            nextModal = setLandingWorkArea(nextModal, bdbId, def);
          }
        }
        return { ...d, modalState: nextModal };
      });
    },
    [state],
  );

  const setLandingContractFor = useCallback(
    (sourceWsId: number, targetContractId: number | null): void => {
      setDialog((d) =>
        d
          ? {
              ...d,
              modalState: setLandingContract(
                d.modalState,
                sourceWsId,
                targetContractId,
              ),
            }
          : d,
      );
    },
    [],
  );

  const setLandingWorkAreaFor = useCallback(
    (sourceBdbId: number, targetWsId: number): void => {
      setDialog((d) =>
        d
          ? {
              ...d,
              modalState: setLandingWorkArea(
                d.modalState,
                sourceBdbId,
                targetWsId,
              ),
            }
          : d,
      );
    },
    [],
  );

  const setWaResolution = useCallback(
    (sourceWsId: number, r: WorkAreaResolution): void => {
      setDialog((d) => {
        if (!d) return d;
        const next = new Map(d.resolutions.workAreas);
        next.set(sourceWsId, r);
        return { ...d, resolutions: { ...d.resolutions, workAreas: next } };
      });
    },
    [],
  );

  const setBdbResolution = useCallback(
    (sourceBdbId: number, r: BdbResolution): void => {
      setDialog((d) => {
        if (!d) return d;
        const next = new Map(d.resolutions.bdbs);
        next.set(sourceBdbId, r);
        return { ...d, resolutions: { ...d.resolutions, bdbs: next } };
      });
    },
    [],
  );

  const check = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog || !dialog.tree) return;
    if (dialog.busy !== null) return;

    const plan = buildImportPlan(dialog.modalState, dialog.tree);
    setDialog((d) => (d ? { ...d, busy: "checking", error: null } : d));

    try {
      const result: ImportPrecheckResult = await window.molio.importPrecheck({
        sourcePath: dialog.sourcePath,
        targetPath: state.data.path,
        plan,
      });
      if (result.kind === "missing") {
        setDialog((d) =>
          d
            ? {
                ...d,
                busy: null,
                error:
                  result.which === "source"
                    ? { kind: "source-missing" }
                    : { kind: "target-missing" },
              }
            : d,
        );
        return;
      }
      const defaults = defaultResolutions(result.precheck);
      setDialog((d) =>
        d
          ? {
              ...d,
              busy: null,
              precheck: result.precheck,
              resolutions: defaults,
              error: null,
            }
          : d,
      );
    } catch (err) {
      setDialog((d) =>
        d
          ? {
              ...d,
              busy: null,
              error: {
                kind: "other",
                message: friendlyErrorForDialog(err),
              },
            }
          : d,
      );
    }
  }, [dialog, state]);

  const apply = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!dialog || !dialog.tree || !dialog.precheck) return;
    if (dialog.busy !== null) return;
    // Defence-in-depth: the Project button's dirty guard should already
    // have blocked, but the user could've edited between opening the
    // modal and clicking Import.
    if (hasEdits(edits)) {
      setDialog((d) => (d ? { ...d, error: { kind: "dirty" } } : d));
      return;
    }

    const plan = buildImportPlan(
      dialog.modalState,
      dialog.tree,
      dialog.resolutions,
    );

    setDialog((d) => (d ? { ...d, busy: "applying", error: null } : d));

    try {
      const result: ImportApplyResult = await window.molio.importApply({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        sourcePath: dialog.sourcePath,
        plan,
      });
      if (result.kind === "conflict") {
        setDialog((d) =>
          d ? { ...d, busy: null, error: { kind: "conflict" } } : d,
        );
        return;
      }
      if (result.kind === "missing") {
        setDialog((d) =>
          d ? { ...d, busy: null, error: { kind: "target-missing" } } : d,
        );
        return;
      }
      if (result.kind === "source-missing") {
        setDialog((d) =>
          d ? { ...d, busy: null, error: { kind: "source-missing" } } : d,
        );
        return;
      }
      // Success — reload the file so the sidebar + tabs pick up the new
      // work areas / BDBs. Keep the modal open and flip to the success
      // view so the user sees what actually happened.
      await reloadAfterCpOp();
      setDialog((d) =>
        d ? { ...d, busy: null, successSummary: result.summary } : d,
      );
    } catch (err) {
      setDialog((d) =>
        d
          ? {
              ...d,
              busy: null,
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
    request,
    requestWithPath,
    cancel,
    toggleWorkArea,
    toggleBdb,
    setLandingContractFor,
    setLandingWorkAreaFor,
    setWaResolution,
    setBdbResolution,
    check,
    apply,
  };
}
