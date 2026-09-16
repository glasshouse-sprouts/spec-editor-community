/**
 * useFileState — slice #233 Session 2 (round 9, the heart of App).
 *
 * Owns the file-lifecycle and edit-buffer state cluster:
 *   - `state`            — open / loading / loaded / error
 *   - `edits`            — buffered edit map (NOT persisted to disk
 *                          until Save)
 *   - `baselineMtimeMs`  — for conflict detection on save
 *   - `pendingConflict`  — drives the conflict modal
 *   - `saveError`        — banner for non-conflict save failures
 *   - `isSaving`         — "Saving…" indicator + double-click guard
 *   - `recentFiles`      — Welcome screen list (persisted in
 *                          localStorage)
 *
 * Multi-step actions:
 *   - `openPath(path)`         — open a file from disk; fires
 *                                `onFileLoaded` after the new state
 *                                lands so callers can reset tabs +
 *                                clear the drop-error banner.
 *   - `handleOpen()`           — file-picker variant of openPath.
 *   - `save({ force })`        — save current edits, with the
 *                                post-save merge / reload split
 *                                (see body comments).
 *
 * Internal effects:
 *   - Recent-files persistence (writes to localStorage on change).
 *   - Dirty tracking (`window.molio.setDirty`) so main can prompt on
 *     window close.
 *   - Window title (file name + dirty dot).
 *   - Save-error auto-dismiss after 6 s.
 *   - ⌘S / Ctrl+S keyboard listener.
 *   - Save-and-close handshake with main.
 */

import { useCallback, useEffect, useState } from "react";

import type {
  EditRequest,
  FilePayload,
  SaveFileAsResult,
  SaveFileResult,
} from "../../../shared/ipc.js";
import {
  type EditMap,
  EMPTY_EDITS,
  hasEdits,
  toEditRequestList,
} from "../edits.js";
import { basename, suggestUpgradedName } from "../fileUtils.js";
import { buildMergedEditMap } from "../mergeApply.js";
import type { MergeUnit } from "../mergeOnReload.js";
import { mergeSavedEdits } from "../mergeSavedEdits.js";
import { needsFullReloadAfterSave } from "./needsFullReloadAfterSave.js";
import { prefStore } from "../prefs.js";
import {
  addRecentFile,
  readRecentFiles,
  type RecentFileEntry,
  removeRecentFile,
  writeRecentFiles,
} from "../recentFiles.js";
import { sanitizeBody } from "../sanitizeBody.js";
import { sanitizeLoadedFile } from "../sanitizeLoadedFile.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";
import { t } from "../i18n/i18n.js";

export type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "loaded"; data: FilePayload }
  | { kind: "error"; message: string };

export interface UseFileStateArgs {
  /**
   * Called from inside `openPath` once a fresh file has loaded into
   * state. Used by the App to reset tabs + clear the drop-error
   * banner — concerns that don't belong to the file state itself.
   * Not called when a save folds edits back into state (a save is
   * not a "new file" event).
   */
  onFileLoaded?: (data: FilePayload) => void;
}

export interface UseFileStateResult {
  state: LoadState;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  edits: EditMap;
  setEdits: React.Dispatch<React.SetStateAction<EditMap>>;
  baselineMtimeMs: number;
  setBaselineMtimeMs: React.Dispatch<React.SetStateAction<number>>;
  pendingConflict: { currentMtimeMs: number } | null;
  setPendingConflict: React.Dispatch<
    React.SetStateAction<{ currentMtimeMs: number } | null>
  >;
  saveError: string | null;
  setSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  isSaving: boolean;
  recentFiles: RecentFileEntry[];
  /** Drop a recent-files entry (e.g. user dismisses it from the
   *  Welcome screen). */
  removeRecent: (path: string) => void;
  /** UX1 — Wipe the entire recent-files list. Backs the
   *  File → Open Recent → Clear Menu item. */
  clearRecent: () => void;
  /** Derived: are there any buffered edits? */
  dirty: boolean;
  /**
   * Open a file from disk. Manages the loading → loaded transition,
   * resets edit state, records a recent-files entry on success.
   */
  openPath: (path: string) => Promise<void>;
  /** File-picker variant of `openPath`. */
  handleOpen: () => Promise<void>;
  /** Save current edits to disk. `force: true` resolves a conflict. */
  save: (opts: { force: boolean }) => Promise<void>;
  /**
   * Save As — write current edits to a user-chosen path. On success
   * the loaded payload's `path` is updated and the file becomes the
   * new save target. Cancellation (user dismisses the OS dialog) is
   * a silent no-op. Slice #41.
   */
  saveAs: () => Promise<void>;
  /**
   * RELOAD-3 — re-read the open file from disk *in place*. Unlike
   * `openPath`, this does NOT fire `onFileLoaded`, so the editor's
   * UI state survives: open tabs, active tab, scroll positions and
   * any loaded version reference all stay put. It only swaps the
   * file content and resets the edit buffer (a reload IS a discard).
   * No-op when no file is open.
   */
  reloadFromDisk: () => Promise<void>;
  /**
   * RELOAD-Merge M4 — adopt the disk version (`disk`) as the new
   * base and load the merge's surviving edits into the buffer, so
   * the merged result shows as unsaved edits to review and Save.
   * Never writes to disk itself.
   */
  applyMerge: (winners: MergeUnit[], disk: FilePayload) => void;
}

export function useFileState({
  onFileLoaded,
}: UseFileStateArgs): UseFileStateResult {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [edits, setEdits] = useState<EditMap>(EMPTY_EDITS);
  const [baselineMtimeMs, setBaselineMtimeMs] = useState<number>(0);
  const [pendingConflict, setPendingConflict] = useState<{
    currentMtimeMs: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Recent-projects list for the Welcome screen. Persisted via the
  // shared prefs store (PREFS, 2026-04-27 — replaces a direct
  // localStorage dependency that was getting wiped between dev
  // sessions on macOS). We seed state from the store on mount;
  // every time the list changes, the effect below writes it back.
  // See task #161.
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() =>
    readRecentFiles(prefStore()),
  );
  useEffect(() => {
    writeRecentFiles(prefStore(), recentFiles);
  }, [recentFiles]);

  const dirty = hasEdits(edits);

  // Tell main about the dirty state so its window-close handler can
  // prompt the user.
  useEffect(() => {
    window.molio.setDirty(dirty);
  }, [dirty]);

  // Window title reflects file name + dirty dot.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.kind !== "loaded") {
      document.title = "Spec Editor Community";
      return;
    }
    const name = basename(state.data.path);
    document.title = `${dirty ? "● " : ""}${name} — Spec Editor Community`;
  }, [state, dirty]);

  // Dismiss save errors after a short delay.
  useEffect(() => {
    if (!saveError) return;
    const id = window.setTimeout(() => setSaveError(null), 6000);
    return () => window.clearTimeout(id);
  }, [saveError]);

  const openPath = useCallback(
    async (path: string): Promise<void> => {
      try {
        setState({ kind: "loading", path });
        const raw = await window.molio.openFile(path);
        const data = sanitizeLoadedFile(raw);
        setState({ kind: "loaded", data });
        // New file loaded → no edits, and baseline mtime comes from
        // the payload. Any old save error / conflict dialog is stale
        // too.
        setEdits(EMPTY_EDITS);
        setBaselineMtimeMs(data.mtimeMs);
        setPendingConflict(null);
        setSaveError(null);
        // Record this successful open on the Welcome screen's recent
        // list (task #161). Every caller of openPath — handleOpen,
        // the drop handlers, the Welcome screen's own row click — is
        // a user-initiated action, so it's safe to record here
        // unconditionally. Saves fold edits back into state without
        // calling openPath, so there's no double-record from the
        // save path.
        setRecentFiles((prev) =>
          addRecentFile(prev, {
            path: data.path,
            projectName: data.project?.name ?? "",
          }),
        );
        onFileLoaded?.(data);
      } catch (err) {
        setState({
          kind: "error",
          message: friendlyErrorForDialog(err),
        });
      }
    },
    [onFileLoaded],
  );

  const handleOpen = useCallback(async (): Promise<void> => {
    const path = await window.molio.openFileDialog();
    if (!path) return;
    await openPath(path);
  }, [openPath]);

  const removeRecent = useCallback((path: string): void => {
    setRecentFiles((prev) => removeRecentFile(prev, path));
  }, []);

  /** UX1 — wipe the recent-files list. The persistence effect
   *  above will sync the empty array through to PREFS, which
   *  triggers a menu rebuild on the main side. */
  const clearRecent = useCallback((): void => {
    setRecentFiles([]);
  }, []);

  /**
   * The body of Save As, without the busy-flag bookkeeping.
   *
   * Split out because `save` has to be able to fall back to Save As
   * (see below) while already holding the busy flag — calling the
   * guarded `saveAs` from inside `save` would just bounce off its own
   * guard. Whoever calls this owns `isSaving`.
   */
  const runSaveAs = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded") return;
    const outgoing: EditRequest[] = toEditRequestList(edits).map((e) =>
      e.target === "workSpec" || e.target === "bdb"
        ? { ...e, body: sanitizeBody(e.body) }
        : e,
    );
    const result: SaveFileAsResult = await window.molio.saveFileAs({
      sourcePath: state.data.path,
      // An upgraded file goes out as a `.moliospec` whatever the old
      // one was called - Molio's older samples are often plain
      // `.sqlite`, and what we write now is a gzipped 01.00.04 file.
      suggestedName: state.data.schemaUpgrade
        ? suggestUpgradedName(state.data.path)
        : basename(state.data.path),
      edits: outgoing,
    });
    if (result.kind === "cancelled") return;
    // Switch the loaded payload onto the new path. For most
    // edits we can fold them into the existing payload via
    // mergeSavedEdits (fast path). For edits that need a fresh
    // disk read (see needsFullReloadAfterSave for the list —
    // includes container deletes after FIX-Zombie 2026-05-11),
    // we re-open the file at the new path so the renderer
    // doesn't show stale rows.
    setBaselineMtimeMs(result.mtimeMs);
    // Whatever path we take below, the file now on disk is a current
    // 01.00.04 file, so the upgrade notice no longer applies and Save
    // stops routing to Save As. (The reload path gets this for free —
    // main reports no upgrade for a file that did not need one.)
    const merged = (s: LoadState): LoadState =>
      s.kind === "loaded"
        ? {
            kind: "loaded",
            data: {
              ...mergeSavedEdits(s.data, edits),
              path: result.path,
              mtimeMs: result.mtimeMs,
              schemaUpgrade: null,
            },
          }
        : s;
    if (needsFullReloadAfterSave(outgoing)) {
      try {
        const raw = await window.molio.openFile(result.path);
        const data = sanitizeLoadedFile(raw);
        setState({ kind: "loaded", data });
        setBaselineMtimeMs(data.mtimeMs);
      } catch (reloadErr) {
        // Fall back to the merge path; the file is correct on
        // disk at the new path either way.
        console.error("[saveAs] post-save reload failed:", reloadErr);
        setState(merged);
      }
    } else {
      setState(merged);
    }
    setEdits(EMPTY_EDITS);
    setRecentFiles((prev) =>
      addRecentFile(prev, {
        path: result.path,
        projectName: state.data.project?.name ?? "",
      }),
    );
    setPendingConflict(null);
  }, [state, edits]);

  /**
   * Save As — write the current edits to a user-chosen path.
   *
   * Slice #41. The renderer asks main to show a save dialog and
   * write to whatever destination the user picks; on success we
   * switch the in-memory tab to the new path and clear the dirty
   * buffer (the saved edits now live on the new file). The original
   * source file is left untouched.
   *
   * Cancellation (user dismisses the OS dialog) is a silent no-op —
   * no error banner, no state change.
   */
  const saveAs = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded") return;
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await runSaveAs();
    } catch (err) {
      setSaveError(friendlyErrorForDialog(err));
    } finally {
      setIsSaving(false);
    }
  }, [state, isSaving, runSaveAs]);

  /**
   * Perform the save round-trip. Called from ⌘S and from the conflict
   * dialog's "Overwrite" button.
   *
   * Edits are:
   *   - sanitized one more time on the way out (hard fence),
   *   - shipped in the IPC request as a SectionEdit[] for main to
   *     pass to core.applyEdits,
   *   - cleared from the in-memory map only after main confirms a
   *     successful write.
   *
   * A file that was upgraded from an older schema on open never takes
   * this path: Save becomes Save As, so the original is left as the
   * user's copy of the old format. The conversion cannot be undone,
   * and the atomic-save work only protects against a crash - not
   * against a conversion that succeeds and loses something. Task 1 / M1.
   */
  const save = useCallback(
    async ({ force }: { force: boolean }): Promise<void> => {
      if (state.kind !== "loaded") return;
      if (isSaving) return;
      setIsSaving(true);
      setSaveError(null);
      try {
        if (state.data.schemaUpgrade) {
          await runSaveAs();
          return;
        }
        // Sanitize section bodies one more time on the way out. CP
        // title and cell edits are plain text — no HTML story to
        // fence.
        const outgoing: EditRequest[] = toEditRequestList(edits).map((e) =>
          e.target === "workSpec" || e.target === "bdb"
            ? { ...e, body: sanitizeBody(e.body) }
            : e,
        );
        const result: SaveFileResult = await window.molio.saveFile({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force,
          edits: outgoing,
        });
        if (result.kind === "saved") {
          setBaselineMtimeMs(result.mtimeMs);
          // Slice 10H.7.b follow-up — PFBB child supplement edits
          // require a full file reload because `mergeSavedEdits`
          // doesn't know how to fold `bdbSectionCreate` /
          // `bdbSectionDelete` patches into `sectionsByBdb`, and a
          // successful `bdbSectionCreate` inserts a new row with a
          // disk-assigned id we can't guess client-side. Without
          // this reload, the in-memory payload stays stale after
          // save: the editor still has the typed text visible but
          // `supplementFor(id)` returns `existingSectionId: null`,
          // and any subsequent TipTap onUpdate re-stages a phantom
          // `bdbSectionCreate` patch → the dirty dot returns.
          // Every other edit kind still uses the fast merge path.
          // Slice 10I.b — custom_data edits join the reload bucket
          // for the same reason: `mergeSavedEdits` doesn't know
          // about the `customData` array on FilePayload, and the
          // Debug accordion needs to see up-to-date disk state
          // after a save.
          // Decide between fast-merge and full-reload paths. The
          // rules + rationale live in needsFullReloadAfterSave —
          // see that file's docstring for the canonical list.
          if (needsFullReloadAfterSave(outgoing)) {
            try {
              const raw = await window.molio.openFile(state.data.path);
              const data = sanitizeLoadedFile(raw);
              setState({ kind: "loaded", data });
              setBaselineMtimeMs(data.mtimeMs);
            } catch (reloadErr) {
              // Fall back to the merge path if reload fails for any
              // reason; the file is saved correctly on disk either
              // way, so we just accept a slightly-stale UI.
              console.error("[save] post-supplement reload failed:", reloadErr);
              setState((s) =>
                s.kind === "loaded"
                  ? { kind: "loaded", data: mergeSavedEdits(s.data, edits) }
                  : s,
              );
            }
          } else {
            // Fast path: fold the sanitized bodies into FilePayload
            // so the UI reflects the saved state without a reload.
            setState((s) =>
              s.kind === "loaded"
                ? { kind: "loaded", data: mergeSavedEdits(s.data, edits) }
                : s,
            );
          }
          setEdits(EMPTY_EDITS);
          setPendingConflict(null);
        } else if (result.kind === "conflict") {
          setPendingConflict({ currentMtimeMs: result.currentMtimeMs });
        } else if (result.kind === "needsSaveAs") {
          // Backstop. The check at the top of this function normally
          // catches it; main refuses as well so an old file cannot be
          // overwritten even if the renderer's state is out of date.
          await runSaveAs();
        } else {
          setSaveError(
            "The file no longer exists at its original location. Use Open file… to pick a new location.",
          );
        }
      } catch (err) {
        setSaveError(friendlyErrorForDialog(err));
      } finally {
        setIsSaving(false);
      }
    },
    [state, isSaving, baselineMtimeMs, edits, runSaveAs],
  );

  /**
   * RELOAD-3 — re-read the open file from disk, in place.
   *
   * Deliberately different from `openPath`:
   *   - Stays in the `loaded` state the whole time (no `loading`
   *     flash), so the editor view never unmounts — scroll positions
   *     in the DOM survive.
   *   - Does NOT call `onFileLoaded`, so tabs / active tab / version
   *     reference are kept. (The FIX-Tab effect in App still prunes
   *     any tab whose target spec genuinely no longer exists in the
   *     fresh content.)
   *
   * Resets the edit buffer — reloading discards unsaved edits. The
   * caller (useReloadFromDisk) is responsible for confirming that
   * with the user first when the buffer is dirty.
   */
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded") return;
    const path = state.data.path;
    try {
      const raw = await window.molio.openFile(path);
      const data = sanitizeLoadedFile(raw);
      setState({ kind: "loaded", data });
      setEdits(EMPTY_EDITS);
      setBaselineMtimeMs(data.mtimeMs);
      setPendingConflict(null);
      setSaveError(null);
    } catch (err) {
      // Keep the current content on screen and surface the failure
      // in the transient banner — better than blanking the editor.
      setSaveError(friendlyErrorForDialog(err));
    }
  }, [state]);

  /**
   * RELOAD-Merge M4 — apply a resolved merge. `disk` (already loaded
   * + sanitised when the plan was prepared) becomes the new base;
   * the winning units become the edit buffer. The merged result is
   * left as unsaved edits — the user reviews it and Saves. Nothing
   * is written to disk here.
   */
  const applyMerge = useCallback(
    (winners: MergeUnit[], disk: FilePayload): void => {
      setState({ kind: "loaded", data: disk });
      setEdits(buildMergedEditMap(winners, disk));
      setBaselineMtimeMs(disk.mtimeMs);
      setPendingConflict(null);
      setSaveError(null);
    },
    [],
  );

  // ⌘S / Ctrl+S used to live as a manual window keydown here. As of
  // Slice #41 it lives as a File menu accelerator; the menu fires a
  // `MenuAction` that App.tsx routes to `save({ force: false })`.
  // The manual listener was removed to avoid double-fires now that
  // the accelerator is owned by the OS-level menu.

  /**
   * The save half of the two handshakes main can start: "save, then
   * close the window" and "save, then open this other file" (Task 83).
   *
   * Returns true only when the bytes actually reached disk. Every
   * other outcome — conflict, old-format file that needs Save As, a
   * file that moved, a thrown error — leaves the user where they are
   * with the matching banner or modal, and the caller must NOT go on
   * with whatever it wanted to do afterwards. Losing edits to a
   * follow-up action is exactly what these handshakes exist to
   * prevent.
   */
  const runHandshakeSave = useCallback(async (): Promise<boolean> => {
    if (state.kind !== "loaded") return false;
    try {
      const outgoing: EditRequest[] = toEditRequestList(edits).map((e) =>
        e.target === "workSpec" || e.target === "bdb"
          ? { ...e, body: sanitizeBody(e.body) }
          : e,
      );
      const result = await window.molio.saveFile({
        path: state.data.path,
        storedMtimeMs: baselineMtimeMs,
        force: false,
        edits: outgoing,
      });
      if (result.kind === "saved") {
        setBaselineMtimeMs(result.mtimeMs);
        setState((s) =>
          s.kind === "loaded"
            ? { kind: "loaded", data: mergeSavedEdits(s.data, edits) }
            : s,
        );
        setEdits(EMPTY_EDITS);
        setPendingConflict(null);
        return true;
      }
      if (result.kind === "conflict") {
        setPendingConflict({ currentMtimeMs: result.currentMtimeMs });
      } else if (result.kind === "needsSaveAs") {
        // We stop here on purpose. This file is in an old format and
        // has to be saved under a new name, which needs a dialog the
        // user has to answer - not something to do in the middle of
        // closing a window or opening another file.
        setSaveError(t("errors.savefile.needsSaveAs"));
      } else {
        setSaveError(
          "The file no longer exists at its original location. Use Open file… to pick a new location.",
        );
      }
      return false;
    } catch (err) {
      setSaveError(friendlyErrorForDialog(err));
      return false;
    }
  }, [state, baselineMtimeMs, edits]);

  // Save-then-close handshake with main.
  useEffect(() => {
    return window.molio.onTriggerSaveAndClose(() => {
      void (async () => {
        if (state.kind !== "loaded") {
          window.molio.closeWindow();
          return;
        }
        if (await runHandshakeSave()) window.molio.closeWindow();
      })();
    });
  }, [state, runHandshakeSave]);

  // Task 83 — save-then-open handshake with main. Same shape as the
  // one above: the user double-clicked a .moliospec in Finder or
  // Explorer while holding unsaved edits, and picked Save in main's
  // dialog. Nothing is opened unless the save actually landed.
  useEffect(() => {
    if (typeof window.molio.onTriggerSaveAndOpen !== "function") return;
    return window.molio.onTriggerSaveAndOpen((path: string) => {
      void (async () => {
        if (state.kind !== "loaded") {
          await openPath(path);
          return;
        }
        if (await runHandshakeSave()) await openPath(path);
      })();
    });
  }, [state, runHandshakeSave, openPath]);

  return {
    state,
    setState,
    edits,
    setEdits,
    baselineMtimeMs,
    setBaselineMtimeMs,
    pendingConflict,
    setPendingConflict,
    saveError,
    setSaveError,
    isSaving,
    recentFiles,
    removeRecent,
    clearRecent,
    dirty,
    openPath,
    handleOpen,
    save,
    saveAs,
    reloadFromDisk,
    applyMerge,
  };
}
