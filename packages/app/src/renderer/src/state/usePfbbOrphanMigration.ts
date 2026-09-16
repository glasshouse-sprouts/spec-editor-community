/**
 * usePfbbOrphanMigration — slice #233 Session 2.
 *
 * Detects PFBB-master BDBs that live outside the virtual
 * "Projektfælles bygningsdelsbeskrivelser" work area on file open
 * (or after reload) and surfaces an offer-to-migrate banner. The
 * hook owns:
 *   - the orphan-detection state (counts + source work-area names)
 *   - the dismiss-for-this-session preference
 *   - the IPC migration call + post-migration reload
 *
 * Detection runs whenever the loaded payload changes. Dismissal is
 * scoped to `sessionStorage` keyed by file path — a fresh window
 * shows the banner again, but the same window doesn't keep nagging
 * after the user clicked "Not now".
 */

import { useCallback, useEffect, useState } from "react";

import type {
  FilePayload,
  MigrateOrphanPfbbMastersResult,
} from "../../../shared/ipc.js";
import { hasEdits, type EditMap } from "../edits.js";
import { findOrphanPfbbMasters } from "../pfbbMigration.js";
import {
  isPfbbMigrationDismissed,
  setPfbbMigrationDismissed,
} from "../pfbbMigrationPrefs.js";
import { friendlyErrorForDialog } from "../i18n/friendlyError.js";

export interface PfbbOrphanState {
  orphanBdbIds: number[];
  sourceWorkAreaNames: string[];
  migrating: boolean;
  error: string | null;
}

export interface UsePfbbOrphanMigrationArgs {
  state: { kind: string; data?: FilePayload };
  edits: EditMap;
  baselineMtimeMs: number;
  /** Called with the freshly-reloaded payload after a successful
   *  migration. Caller updates its loaded-file state from this. */
  onReloadComplete: (data: FilePayload, mtimeMs: number) => void;
  /** Reset the edit buffer after the file reload. */
  resetEdits: () => void;
  /** Sanitise the raw IPC payload before handing it to
   *  `onReloadComplete`. Threaded in because the helper currently
   *  lives in App.tsx; can be lifted later. */
  sanitizeLoadedFile: (raw: FilePayload) => FilePayload;
}

export interface UsePfbbOrphanMigrationResult {
  /** Null when there's nothing to migrate or the user dismissed the
   *  banner; otherwise the banner state (counts + status). */
  pfbbOrphanState: PfbbOrphanState | null;
  /** User clicked "Move them now". */
  onMigrate: () => Promise<void>;
  /** User clicked "Not now" — dismiss for this session. */
  onDismiss: () => void;
}

export function usePfbbOrphanMigration({
  state,
  edits,
  baselineMtimeMs,
  onReloadComplete,
  resetEdits,
  sanitizeLoadedFile,
}: UsePfbbOrphanMigrationArgs): UsePfbbOrphanMigrationResult {
  const [pfbbOrphanState, setPfbbOrphanState] =
    useState<PfbbOrphanState | null>(null);

  // Detection effect — runs on any payload identity change.
  useEffect(() => {
    if (state.kind !== "loaded" || !state.data) {
      setPfbbOrphanState(null);
      return;
    }
    const path = state.data.path;
    const store = window.sessionStorage;
    if (isPfbbMigrationDismissed(store, path)) {
      setPfbbOrphanState(null);
      return;
    }
    const det = findOrphanPfbbMasters({
      bdbs: state.data.bdbs,
      workSpecs: state.data.workSpecs,
    });
    if (det.orphanBdbIds.length === 0) {
      setPfbbOrphanState(null);
      return;
    }
    setPfbbOrphanState({
      orphanBdbIds: det.orphanBdbIds,
      sourceWorkAreaNames: det.sourceWorkAreaNames,
      migrating: false,
      error: null,
    });
    // Only re-run on payload identity changes (open / save / reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const onMigrate = useCallback(async (): Promise<void> => {
    if (state.kind !== "loaded" || !state.data) return;
    if (!pfbbOrphanState || pfbbOrphanState.migrating) return;
    // Mirrors the createPfbbChild guard: the IPC path reloads the
    // file, which would silently drop any in-memory edits. Surface
    // the block rather than destroying work.
    if (hasEdits(edits)) {
      setPfbbOrphanState((s) =>
        s
          ? {
              ...s,
              error: "Save or discard your current edits before migrating.",
            }
          : s,
      );
      return;
    }
    setPfbbOrphanState((s) => (s ? { ...s, migrating: true, error: null } : s));
    try {
      const result: MigrateOrphanPfbbMastersResult =
        await window.molio.migrateOrphanPfbbMasters({
          path: state.data.path,
          storedMtimeMs: baselineMtimeMs,
          force: false,
        });
      if (result.kind === "conflict") {
        setPfbbOrphanState((s) =>
          s
            ? {
                ...s,
                migrating: false,
                error: "The file was modified on disk. Reload and try again.",
              }
            : s,
        );
        return;
      }
      if (result.kind === "missing") {
        setPfbbOrphanState((s) =>
          s
            ? {
                ...s,
                migrating: false,
                error: "The file is no longer available.",
              }
            : s,
        );
        return;
      }
      // Success — reload so sidebar / tabs / banner reflect the move.
      const raw = await window.molio.openFile(state.data.path);
      const data = sanitizeLoadedFile(raw);
      onReloadComplete(data, data.mtimeMs);
      resetEdits();
      // Detection effect resets pfbbOrphanState to null on the new payload.
    } catch (err) {
      setPfbbOrphanState((s) =>
        s
          ? {
              ...s,
              migrating: false,
              error: friendlyErrorForDialog(err),
            }
          : s,
      );
    }
  }, [
    baselineMtimeMs,
    edits,
    pfbbOrphanState,
    state,
    onReloadComplete,
    resetEdits,
    sanitizeLoadedFile,
  ]);

  const onDismiss = useCallback((): void => {
    if (state.kind !== "loaded" || !state.data) return;
    setPfbbMigrationDismissed(window.sessionStorage, state.data.path);
    setPfbbOrphanState(null);
  }, [state]);

  return { pfbbOrphanState, onMigrate, onDismiss };
}
