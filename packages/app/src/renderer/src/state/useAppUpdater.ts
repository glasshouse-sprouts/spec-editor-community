/**
 * The renderer's view of automatic updates.
 *
 * Main owns the state machine (see `main/appUpdater.ts`); this hook
 * mirrors it and offers the two things a user can ask for: check now,
 * and restart into the new version.
 *
 * Deliberately no UI of its own. What this state should look like is a
 * question for whatever shows it - the About panel - and keeping the
 * two apart means a second place can show the same state later without
 * a second subscription.
 */

import { useCallback, useEffect, useState } from "react";

import type { InstallUpdateResult, UpdateState } from "../../../shared/ipc.js";

export interface AppUpdater {
  state: UpdateState;
  /** Check now. Resolves when the check has been kicked off, not when
   *  it has finished - progress arrives through `state`. */
  check: () => Promise<void>;
  /**
   * Restart into the downloaded version. Answers `unsaved` rather than
   * restarting when there are unsaved edits, so the caller can say so;
   * the update installs on the next ordinary quit regardless.
   */
  installNow: () => Promise<InstallUpdateResult>;
}

export function useAppUpdater(): AppUpdater {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    if (typeof window.molio.onUpdateState !== "function") return;
    // Ask for the state as it is now, THEN subscribe. A panel opened
    // halfway through a download would otherwise sit on "idle" until
    // the next progress event - or forever, if the download had
    // already finished.
    void window.molio.getUpdateState().then(setState);
    return window.molio.onUpdateState(setState);
  }, []);

  const check = useCallback(async (): Promise<void> => {
    if (typeof window.molio.checkForUpdates !== "function") return;
    setState(await window.molio.checkForUpdates());
  }, []);

  const installNow = useCallback(async (): Promise<InstallUpdateResult> => {
    if (typeof window.molio.installUpdateNow !== "function") {
      return { kind: "notReady" };
    }
    return window.molio.installUpdateNow();
  }, []);

  return { state, check, installNow };
}
