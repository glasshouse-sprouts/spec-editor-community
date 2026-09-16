/**
 * Windows title strip (Task 64).
 *
 * WHAT THIS IS, in plain terms
 * ---------------------------
 * On Windows the app used to stack three rows above the content: the
 * operating system's title bar, the native menu row (File / Edit /
 * View / Window / Help), and the app's own header with the buttons.
 * macOS only has two, because the menu sits in the system menu bar
 * and costs the window nothing.
 *
 * The main process now asks Windows to hand us the title strip and
 * keep drawing only minimise / maximise / close on the right (see
 * `titleBarOverlay` in `main/index.ts`). This component fills the
 * rest of that strip: a hamburger on the left that opens the app
 * menu, and the project name centred in the middle.
 *
 * Windows therefore goes from three rows to two, and the product
 * name no longer appears twice on the welcome screen.
 *
 * RENDERS ON WINDOWS ONLY. On macOS and Linux this component returns
 * `null` and nothing about those builds changes.
 *
 * CENTRING
 * --------
 * The window buttons occupy roughly 138 px on the right at 100 %
 * scaling, so centring against the full window width puts the title
 * visibly off-centre. `navigator.windowControlsOverlay` gives us the
 * exact rectangle that is NOT covered by those buttons, and fires
 * `geometrychange` when it moves (maximise, restore, DPI change).
 * We centre inside that rectangle and re-measure on the event.
 *
 * That API only exists when `titleBarOverlay` is set, and only in
 * Chromium on Windows. When it is missing we fall back to plain CSS
 * centring, which is a few pixels off but never broken.
 *
 * DRAGGING
 * --------
 * `-webkit-app-region: drag` on the strip makes it behave like a
 * real title bar (drag, double-click to maximise, snap to edges).
 * Everything clickable inside it needs `no-drag`, or the click is
 * swallowed by the drag region. Two consequences that are expected,
 * not bugs: text in a drag region cannot be selected, and a file
 * dropped onto the strip itself is ignored (drop it on the content
 * below instead).
 */

import { useEffect, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";

import { useT } from "./i18n/i18n.js";

/**
 * The slice of `navigator.windowControlsOverlay` we use. Not in the
 * DOM lib typings, so we describe it here rather than casting to
 * `any` at each call site.
 */
type WindowControlsOverlay = {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: "geometrychange", listener: () => void): void;
  removeEventListener(type: "geometrychange", listener: () => void): void;
};

function getOverlay(): WindowControlsOverlay | null {
  const nav = navigator as Navigator & {
    windowControlsOverlay?: WindowControlsOverlay;
  };
  return nav.windowControlsOverlay ?? null;
}

export type WindowTitleBarProps = {
  /** Text shown centred in the strip. Usually the project name. */
  title: string;
  /** Show the unsaved-changes dot before the title. */
  dirty: boolean;
  /**
   * Absolute path of the open file, or null. Shown as the strip's
   * tooltip so the filename is still reachable now that the OS title
   * bar no longer displays it.
   */
  filePath: string | null;
};

export function WindowTitleBar({
  title,
  dirty,
  filePath,
}: WindowTitleBarProps): React.JSX.Element | null {
  const t = useT();

  // Width in px of the area not covered by the window buttons, or
  // null when the API is unavailable (then CSS handles centring).
  const [titlebarWidth, setTitlebarWidth] = useState<number | null>(null);

  useEffect(() => {
    const overlay = getOverlay();
    if (!overlay) return;

    const measure = (): void => {
      const rect = overlay.getTitlebarAreaRect();
      // A zero-width rect means the overlay is momentarily hidden
      // (it happens during a maximise animation). Keep the last good
      // value rather than collapsing the title to nothing.
      if (rect.width > 0) setTitlebarWidth(rect.width);
    };

    measure();
    overlay.addEventListener("geometrychange", measure);
    return () => {
      overlay.removeEventListener("geometrychange", measure);
    };
  }, []);

  if (window.molio.platform !== "win32") return null;

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Anchor the popup at the button's bottom-left corner so it
    // drops straight down from the hamburger, the way a menu opened
    // from the native menu row would.
    const rect = event.currentTarget.getBoundingClientRect();
    window.molio.popupAppMenu({ x: rect.left, y: rect.bottom });
  };

  return (
    <div
      className="win-titlebar"
      // Only set when we could measure. Unset falls through to the
      // CSS fallback, which centres against the whole strip.
      style={
        titlebarWidth != null
          ? ({
              "--win-titlebar-area": `${titlebarWidth}px`,
            } as React.CSSProperties)
          : undefined
      }
      title={filePath ?? undefined}
    >
      <button
        type="button"
        className="win-titlebar__menu"
        onClick={openMenu}
        aria-label={t("titleBar.menu.label")}
        title={t("titleBar.menu.tooltip")}
      >
        <MenuIcon size={16} aria-hidden="true" />
      </button>
      <div className="win-titlebar__title">
        {dirty && (
          <span className="app__dirty-dot" aria-hidden="true">
            ●
          </span>
        )}
        <span className="win-titlebar__title-text">{title}</span>
      </div>
    </div>
  );
}

export default WindowTitleBar;
