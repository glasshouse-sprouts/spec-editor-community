/**
 * Welcome screen.
 *
 * The landing page the user sees when no file is open (the app's
 * "idle" state — see App.tsx). Gives three ways to get started:
 *
 *   1. A big "Open .moliospec" button that opens the OS file dialog.
 *   2. A visual drop-zone hint on the button itself — the actual
 *      drag-and-drop wiring lives on the root `.app` element in
 *      App.tsx, so dropping anywhere on the window still works; the
 *      hint here is just for discoverability.
 *   3. A list of the last 5 opened projects (newest first). Each row
 *      shows project name, filename and a relative-time label like
 *      "yesterday" or "22 Apr 2026" (see timeAgo.ts). Click to
 *      re-open. Right-click → "Remove from list" drops a stale entry
 *      without touching the file on disk.
 *
 * Missing files: we don't pre-check that a recent entry's file still
 * exists. Clicking a missing file just goes through the normal open
 * pipeline, which surfaces the error the same way a failed manual
 * open would. The user can then right-click → Remove.
 *
 * The UI is in English — the app currently ships without any
 * localization or Danish interface, so every label here is plain
 * English. When localization lands, this is the one spot to swap
 * the strings.
 */

import { useMemo, useState } from "react";

import { basename } from "./fileUtils.js";
import { useT } from "./i18n/i18n.js";
import type { RecentFileEntry } from "./recentFiles.js";
import { formatTimeAgo } from "./timeAgo.js";

interface Props {
  /** The persisted recent-files list (newest first). May be empty on
   *  a brand-new install. */
  recentFiles: RecentFileEntry[];
  /** Open the OS file-picker and load whatever the user chooses. */
  onOpenDialog: () => void;
  /** Open a specific file by absolute path — used when a recent-list
   *  entry is clicked. */
  onOpenPath: (path: string) => void;
  /** Drop the entry from the recent list. Does not touch disk. */
  onRemoveRecent: (path: string) => void;
  /** IMP-API — Start from scratch. Asks where to save, copies the
   *  bundled blank template there, and opens the new file. */
  onStartFromScratch: () => void;
}

/**
 * Right-click menu state. Coordinates are viewport pixels (clientX/Y)
 * so the menu floats over the clicked row. `path` tells us which
 * entry the user right-clicked — we route the Remove action back to
 * the host via onRemoveRecent.
 *
 * null = no menu open.
 */
interface ContextMenuState {
  path: string;
  x: number;
  y: number;
}

export function WelcomeScreen({
  recentFiles,
  onOpenDialog,
  onOpenPath,
  onRemoveRecent,
  onStartFromScratch,
}: Props): JSX.Element {
  const t = useT();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  // Snap "now" once per render of the list so every row uses the same
  // reference point and labels line up. Recomputed whenever the list
  // itself changes (e.g. a new open pushes a fresh entry to the top).
  const now = useMemo(() => Date.now(), [recentFiles]);

  const closeMenu = (): void => setMenu(null);

  return (
    <div className="welcome-screen" onClick={closeMenu}>
      <div className="welcome-screen__inner">
        <h1 className="welcome-screen__title">{t("welcome.title")}</h1>
        <p className="welcome-screen__subtitle">
          {t("welcome.subtitlePrefix")} <code>.moliospec</code>{" "}
          {t("welcome.subtitleSuffix")}
        </p>

        {/*
          The "open zone" acts as both a button and a visual drop
          target. The actual drag-and-drop handlers sit on the root
          element in App.tsx; this div is purely for discoverability —
          dashed outline + explanatory text.
        */}
        <button
          type="button"
          className="welcome-screen__open-zone"
          onClick={onOpenDialog}
        >
          <span className="welcome-screen__open-zone-title">
            {t("welcome.openButton")}
          </span>
          <span className="welcome-screen__open-zone-hint">
            {t("welcome.openHintPrefix")} <code>.moliospec</code>{" "}
            {t("welcome.openHintSuffix")}
          </span>
        </button>

        {/* IMP-API — start a brand-new project from a blank
         *  template. Asks for save location up front, then opens
         *  the new file like any other. Sits right under the open
         *  zone so it's the natural alternative path on this screen. */}
        <button
          type="button"
          className="welcome-screen__scratch"
          onClick={onStartFromScratch}
        >
          {t("welcome.startFromScratch")}
        </button>

        {recentFiles.length > 0 && (
          <section className="welcome-screen__recent">
            <h2 className="welcome-screen__recent-title">
              {t("welcome.recentTitle")}
            </h2>
            <ul className="welcome-screen__recent-list">
              {recentFiles.map((f) => (
                <RecentRow
                  key={f.path}
                  entry={f}
                  now={now}
                  onClick={() => onOpenPath(f.path)}
                  onContextMenu={(x, y) => setMenu({ path: f.path, x, y })}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onRemove={() => {
            onRemoveRecent(menu.path);
            closeMenu();
          }}
          onDismiss={closeMenu}
        />
      )}
    </div>
  );
}

/**
 * One row in the recent list. Two columns:
 *
 *   - Left: project name on top, filename underneath. Full path shows
 *     via the native `title` tooltip on hover.
 *   - Right: relative-time label ("2 h ago", "yesterday", "22 Apr
 *     2026"), muted. Hovering it shows the exact date+time as a
 *     tooltip for users who want the precise timestamp.
 *
 * When the file has no project row (the file format allows it), we
 * fall back to showing the filename in the big slot and nothing in the
 * small slot — the primary label stays consistent with what the user
 * sees in their filesystem.
 */
function RecentRow({
  entry,
  now,
  onClick,
  onContextMenu,
}: {
  entry: RecentFileEntry;
  now: number;
  onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
}): JSX.Element {
  const file = basename(entry.path);
  const hasProjectName = entry.projectName.trim().length > 0;
  const primary = hasProjectName ? entry.projectName : file;
  const secondary = hasProjectName ? file : "";
  const opened = formatTimeAgo(entry.openedAt, now);

  return (
    <li
      className="welcome-screen__recent-row"
      title={entry.path}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <div className="welcome-screen__recent-main">
        <span className="welcome-screen__recent-primary">{primary}</span>
        {secondary && (
          <span className="welcome-screen__recent-secondary">{secondary}</span>
        )}
      </div>
      <span
        className="welcome-screen__recent-opened"
        title={new Date(entry.openedAt).toLocaleString()}
      >
        {opened}
      </span>
    </li>
  );
}

/**
 * Tiny floating context menu used for the "Remove from list" action.
 * Closes on outside click (handled by the backdrop in the parent) and
 * after a successful Remove.
 */
function ContextMenu({
  x,
  y,
  onRemove,
  onDismiss,
}: {
  x: number;
  y: number;
  onRemove: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <div
      className="welcome-screen__context-menu"
      style={{ top: y, left: x }}
      // Stop propagation so clicking an item doesn't also trigger the
      // backdrop onClick that closes the menu before the action fires.
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="welcome-screen__context-menu-item"
        onClick={() => {
          onRemove();
        }}
      >
        {t("welcome.removeFromList")}
      </button>
      <button
        type="button"
        className="welcome-screen__context-menu-item welcome-screen__context-menu-item--dismiss"
        onClick={onDismiss}
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}
