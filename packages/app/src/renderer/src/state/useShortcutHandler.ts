/**
 * Slice #41 — central dispatch for menu-driven actions.
 *
 * The Electron main process owns every standard accelerator (⌘O, ⌘S,
 * ⌘W, ⌘E, ⌘I, ⌘⇧S, ⌘,, ⌘?). Each menu item's `click` handler sends a
 * typed `MenuAction` over IPC; this hook subscribes once at the top of
 * the renderer and routes each action to the matching in-app handler.
 *
 * Why centralise this here rather than scatter `window.molio.onXyz`
 * subscriptions across the modal hooks:
 *
 *   - Single source of truth for what the menu can do. Adding a new
 *     shortcut means adding one branch here + one menu item in main.
 *
 *   - Avoids ordering bugs. With multiple subscribers to the same IPC
 *     channel, action handling becomes order-dependent on which hook
 *     mounted first; the central hook collapses that into one
 *     dispatcher with explicit precedence.
 *
 *   - Easy to test. We feed actions in via the `dispatch` export below
 *     (used by tests) without depending on `window.molio`.
 */

import { useEffect, useRef } from "react";

import type { MenuAction } from "../../../shared/ipc.js";

/**
 * Action handlers the App provides to the dispatcher. Every field is
 * called for the matching `MenuAction.kind`. Handlers may be no-ops
 * when the action doesn't apply (e.g. `save` when there's no file
 * open) — the dispatcher itself never decides "is this action
 * available right now"; it forwards every action and the handler
 * decides whether to act.
 */
export interface ShortcutHandlers {
  /** File → New: create a brand-new blank file (start from scratch). */
  onNewFile: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  /**
   * Slice "Version compare" — load a second `.moliospec` as the
   * read-only reference the current project is compared against.
   */
  onLoadReference: () => void;
  /**
   * UX1 — File → Open Recent → [path]. The renderer routes this
   * through the same `openPath()` flow the Welcome screen uses.
   */
  onOpenRecent: (path: string) => void;
  /**
   * UX1 — File → Open Recent → Clear Menu. Clears the recent-files
   * list. The persisted PREFS write triggers a menu rebuild.
   */
  onClearRecent: () => void;
  /**
   * RELOAD-3 — File → Reload from Disk. Re-reads the open file,
   * discarding in-memory edits (with a confirm dialog when dirty).
   */
  onReloadFromDisk: () => void;
  /** Open the About panel (app menu on macOS, Help elsewhere). */
  onAbout: () => void;
}

/**
 * Resolve a `MenuAction` to its handler and call it. Exposed
 * separately from the React subscription so unit tests can drive it
 * without mounting a component.
 */
export function dispatchMenuAction(
  action: MenuAction,
  handlers: ShortcutHandlers,
): void {
  switch (action.kind) {
    case "newFile":
      handlers.onNewFile();
      return;
    case "open":
      handlers.onOpen();
      return;
    case "save":
      handlers.onSave();
      return;
    case "saveAs":
      handlers.onSaveAs();
      return;
    case "closeTab":
      handlers.onCloseTab();
      return;
    case "import":
      handlers.onImport();
      return;
    case "export":
      handlers.onExport();
      return;
    case "settings":
      handlers.onSettings();
      return;
    case "shortcuts":
      handlers.onShortcuts();
      return;
    case "loadReference":
      handlers.onLoadReference();
      return;
    case "openRecent":
      handlers.onOpenRecent(action.path);
      return;
    case "clearRecent":
      handlers.onClearRecent();
      return;
    case "reloadFromDisk":
      handlers.onReloadFromDisk();
      return;
    case "about":
      handlers.onAbout();
      return;
  }
}

/**
 * Mount the IPC subscription. Re-subscribes whenever any handler
 * identity changes; the bridge returns a disposer so leftover
 * listeners get cleaned up. App-level callers should memoise their
 * handlers to avoid churning the subscription on every render — but
 * even without that the cost is one `ipcRenderer.on/off` round-trip
 * per render, which is fine.
 */
export function useShortcutHandler(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const dispose = window.molio.onMenuAction((action) =>
      dispatchMenuAction(action, handlers),
    );
    return dispose;
  }, [handlers]);

  // Task 83 — double-clicking a .moliospec in Finder or Explorer
  // starts the app with the file's path. Main holds on to it; we
  // collect it here, once, now that this hook is mounted and able to
  // act on the answer.
  //
  // We ask rather than being told on purpose: main used to push the
  // path when the page finished loading, which on Windows happened
  // before this subscription existed, so the file never opened and
  // nothing said why. `handlersRef` keeps the request out of the
  // effect above, so it fires once per mount rather than on every
  // handler change.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (typeof window.molio.takePendingOpenPath !== "function") return;
    void (async () => {
      const path = await window.molio.takePendingOpenPath();
      if (path) handlersRef.current.onOpenRecent(path);
    })();
  }, []);
}
