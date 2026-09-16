/**
 * Per-tab scroll-position persistence.
 *
 * Why this exists
 * ---------------
 * MainPane unmounts the previous tab's content when the active tab
 * changes (we don't keep all tabs mounted — too expensive once the
 * spec/BDB editors hold many TipTap instances). That means scrollTop
 * is lost. This hook brings it back: snapshot the active tab's scroll
 * before switching, restore it on the destination tab once its DOM
 * is in place.
 *
 * History
 * -------
 *   - VE0b (2026-04-26): first version — single hardcoded selector
 *     `.main-pane__scroll`. Covered the simple list-style tabs
 *     (Highlights, Revisions, control plan).
 *   - UX2 (2026-04-27): extended to ALL scroll containers Tore
 *     reported as "resetting to top" — namely the spec edit tab
 *     (`.spec-content`, the long sections list), and the Project
 *     tab's two side-by-side independently scrolling columns
 *     (`.project-overview__tree` + `.project-overview__cards`).
 *     Within-session only — no persistence across app restarts.
 *
 * How it works
 * ------------
 * For each tab id we keep a map of `selector → scrollTop`. The hook
 * listens for scroll events at the document level (capture phase),
 * and on each event records the scrollTop of the firing element
 * under whichever known selector it matches. When the active tab
 * changes, we snapshot every currently-mounted scroll container for
 * the OUTGOING tab once more (belt-and-braces in case the user
 * switched fast), then on the next animation frame restore every
 * known position for the INCOMING tab.
 *
 * Selector list
 * -------------
 * The list of supported selectors is hardcoded. Adding a new
 * scrollable surface to a tab means adding it here. Keeping the
 * list small (and explicit) is intentional: it stops the hook from
 * snapshotting random sub-scrollers like dropdown menus or modal
 * bodies that don't belong to the tab.
 *
 * API
 * ---
 * Returns a `wrapSelectTab` helper. Wherever the app today calls
 * `tabsController.selectTab(id)`, route through `wrapSelectTab(id)`
 * instead. The wrapper does the snapshot, calls selectTab, then
 * schedules the restore for the next animation frame (so the new
 * tab's DOM is mounted by then).
 *
 * The destination scroll is also restored when the active tab id
 * changes via paths that *don't* go through wrapSelectTab — e.g.
 * `setTabs(s => openOrFocusTab(s, …))` — by a useEffect watching
 * `activeTabId`. That covers the click-to-jump flows the Highlights
 * and Revisions tabs use.
 */

import { useCallback, useEffect, useRef } from "react";

/**
 * Every scroll container we want to remember the position of, by
 * tab. Order doesn't matter; we walk the list at snapshot/restore
 * time and apply whichever ones are currently in the DOM.
 *
 *  - `.main-pane__scroll`         simple list-style tabs (Highlights,
 *                                  Revisions, control plan).
 *  - `.spec-content`              spec / BDB edit tabs in standard
 *                                  layout — the long sections list.
 *                                  Primary "I scroll, then switch
 *                                  tab, come back, I'm at the top"
 *                                  case.
 *  - `.aligned`                   spec / BDB edit tabs in aligned
 *                                  layout (Version-compare, Basis,
 *                                  Instruction, Paradigm).
 *                                  AlignedSpecView's outer scroller.
 *  - `.project-overview__tree`    Project tab left column.
 *  - `.project-overview__cards`   Project tab right column.
 */
const SCROLL_SELECTORS = [
  ".main-pane__scroll",
  ".spec-content",
  ".aligned",
  ".project-overview__tree",
  ".project-overview__cards",
] as const;
type ScrollSelector = (typeof SCROLL_SELECTORS)[number];

/** Per-tab map of selector → scrollTop. */
type TabPositions = Partial<Record<ScrollSelector, number>>;

export interface TabScrollPersistence {
  /**
   * Replacement for `tabsController.selectTab(id)`. Calls the
   * underlying setter after snapshotting the current tab's scroll.
   */
  wrapSelectTab: (id: string) => void;
}

/**
 * Test-friendly internals. The component-level useTabScrollPersistence
 * hook below is the public API.
 */
export const __TEST__ = {
  SCROLL_SELECTORS,
};

export function useTabScrollPersistence(args: {
  activeTabId: string;
  selectTab: (id: string) => void;
}): TabScrollPersistence {
  // Map of tabId → (selector → scrollTop). Plain ref — we don't need
  // React to re-render when scroll positions change.
  const positionsRef = useRef<Record<string, TabPositions>>({});
  const lastActiveRef = useRef<string>(args.activeTabId);
  // Cancellation token. When the hook unmounts (or in tests, when
  // the host component remounts), in-flight retry rAFs check this
  // flag and bail. Without it, a retry loop scheduled by the
  // previous instance can fire after a new instance has mounted
  // and write into the new instance's DOM. Production won't hit
  // that since the hook lives the app's lifetime, but it makes
  // the unit-tested behaviour deterministic.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Look up which known selector the given element matches. */
  const matchSelector = useCallback(
    (el: HTMLElement | null): ScrollSelector | null => {
      if (!el) return null;
      for (const sel of SCROLL_SELECTORS) {
        if (el.matches(sel)) return sel;
      }
      return null;
    },
    [],
  );

  /** Walk every known selector currently in the DOM and snapshot its
   *  scrollTop into the given tab's position map. */
  const snapshotTab = useCallback((tabId: string): void => {
    const tabMap: TabPositions = positionsRef.current[tabId] ?? {};
    for (const sel of SCROLL_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) tabMap[sel] = el.scrollTop;
    }
    positionsRef.current[tabId] = tabMap;
  }, []);

  /**
   * Restore every saved scrollTop for the given tab onto whichever
   *  matching scroll container is currently in the DOM. Selectors
   *  with no saved value default to 0 (top) — callers expect the
   *  destination to start fresh if there's no memory of it.
   *
   * Why this is wrapped in a retry loop (UX2-bis, 2026-04-27):
   * a single rAF often fires BEFORE the destination tab's content
   * has fully painted. At that point the scroll container's
   * scrollHeight is still small (or zero), so assigning
   * `el.scrollTop = 500` silently clamps to whatever the page
   * actually allows — usually 0. The user then sees the tab "reset
   * to the top" even though we recorded a perfectly good position.
   *
   * Retry strategy: try once on this rAF. If a position we wanted
   * didn't stick (because the page clamped), schedule another rAF
   * and try again. Cap at ~30 frames (≈500 ms at 60 Hz) so a tab
   * whose content really is shorter now doesn't loop forever.
   */
  const restoreTab = useCallback((tabId: string): void => {
    const tabMap: TabPositions = positionsRef.current[tabId] ?? {};
    // Once a selector hits its target we mark it done so the retry
    // loop stops touching it. Without this we'd keep re-asserting
    // and could fight the user if they scroll the destination tab
    // themselves while we're still polling.
    const done = new Set<ScrollSelector>();

    function attempt(remaining: number, isFirst: boolean): void {
      if (!aliveRef.current) return;
      let needRetry = false;
      for (const sel of SCROLL_SELECTORS) {
        if (done.has(sel)) continue;
        const target = tabMap[sel];
        if (target == null || target <= 0) {
          done.add(sel);
          continue;
        }
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) {
          // Container not in the DOM yet — keep retrying so we
          // catch the moment it mounts.
          needRetry = true;
          continue;
        }
        // First attempt: always assign. The element's current
        // scrollTop may be a residual value (e.g. an in-place
        // re-render of the same DOM node), so we can't trust it
        // as a "user already scrolled" signal yet.
        // Subsequent attempts: only re-assign if we got clamped on
        // the previous frame (scrollTop < target). Once we've
        // achieved scrollTop ≥ target we stop touching this
        // selector — anything different from now on is the user.
        if (isFirst || el.scrollTop < target - 1) {
          el.scrollTop = target;
        }
        if (el.scrollTop >= target - 1) {
          done.add(sel);
        } else {
          needRetry = true;
        }
      }
      if (needRetry && remaining > 0) {
        requestAnimationFrame(() => attempt(remaining - 1, false));
      }
    }

    requestAnimationFrame(() => attempt(30, true));
  }, []);

  // Snapshot whenever the user scrolls. Listening at document level
  // is overkill — but it's the simplest way to catch scroll events
  // from any of our supported containers without each component
  // having to wire up its own onScroll handler. We filter by the
  // known selector list below.
  useEffect(() => {
    function onScroll(e: Event): void {
      const target = e.target as HTMLElement | null;
      const sel = matchSelector(target);
      if (!sel || !target) return;
      const tabMap: TabPositions = positionsRef.current[args.activeTabId] ?? {};
      tabMap[sel] = target.scrollTop;
      positionsRef.current[args.activeTabId] = tabMap;
    }
    document.addEventListener("scroll", onScroll, { capture: true });
    return () =>
      document.removeEventListener("scroll", onScroll, { capture: true });
  }, [args.activeTabId, matchSelector]);

  // When the active tab changes, restore the saved scrollTop on the
  // newly-mounted scroll container(s). `restoreTab` schedules its
  // own first rAF (and additional ones if the destination DOM
  // hasn't painted yet) — see comment on restoreTab for the retry
  // logic.
  useEffect(() => {
    const prev = lastActiveRef.current;
    if (prev === args.activeTabId) return;
    // Save the prev tab's scroll one more time as a safety net (in
    // case the user switched fast and onScroll didn't fire).
    snapshotTab(prev);
    lastActiveRef.current = args.activeTabId;
    restoreTab(args.activeTabId);
  }, [args.activeTabId, snapshotTab, restoreTab]);

  const wrapSelectTab = useCallback(
    (id: string): void => {
      // Snapshot before the switch so we don't race the unmount.
      snapshotTab(args.activeTabId);
      args.selectTab(id);
    },
    [args, snapshotTab],
  );

  return { wrapSelectTab };
}
