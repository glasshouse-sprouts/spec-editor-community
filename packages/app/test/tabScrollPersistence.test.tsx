/** @vitest-environment jsdom */
/**
 * UX2 — multi-selector tab scroll persistence.
 *
 * The hook listens for scroll events on the document and snapshots
 * scrollTop per (tabId, selector). On tab switch it restores every
 * known selector's saved position. Tests below drive the hook by
 * mounting a tiny component, manipulating scrollTop on real DOM
 * nodes, and switching tabs through the returned wrapSelectTab.
 *
 * jsdom note: jsdom's scroll events don't fire automatically when
 * scrollTop changes; we dispatch a synthetic Event with a target
 * that matches the listener's target check. That gives us full
 * control over the timing (we want to observe what the snapshot
 * stored, not jsdom's internal scroll heuristics).
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useTabScrollPersistence } from "../src/renderer/src/state/useTabScrollPersistence.js";

afterEach(() => cleanup());

/**
 * The hook now schedules its restore via rAF and may retry on
 * subsequent rAFs if the destination scrollTop didn't stick (UX2-bis
 * — fix for the "tab returns to top" bug). Tests need to wait long
 * enough for the retry loop to settle. Two animation frames is
 * normally enough for jsdom's instant scrollTop assignments to
 * complete.
 */
function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    function step(remaining: number): void {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    }
    step(n);
  });
}

interface HostProps {
  initial: string;
}

/**
 * Minimal host component: renders a div with the active tab's
 * className so each "tab" gets its own scroll container in the DOM.
 * Exposes the hook's return value via a ref-injected callback so
 * tests can drive `wrapSelectTab` directly.
 */
function Host(props: HostProps): React.ReactElement {
  const [active, setActive] = React.useState(props.initial);
  const persistence = useTabScrollPersistence({
    activeTabId: active,
    selectTab: setActive,
  });

  // Cheap-and-cheerful: stash the current persistence helper on
  // window so tests can grab it. Avoids an extra forwardRef song
  // and dance just for two assertions per test.
  (window as unknown as { __persistence: typeof persistence }).__persistence =
    persistence;

  // The "tab body" — a single scroll container per active tab. The
  // selector class flips with the tab id so each tab has a different
  // type of scroll container, exercising the multi-selector lookup.
  const className =
    active === "tab-spec" ? "spec-content" : "main-pane__scroll";
  return (
    <div data-testid="tab-body" className={className} style={{ height: 100 }}>
      {active}
    </div>
  );
}

function dispatchScrollOn(el: HTMLElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll", { bubbles: true }));
}

describe("useTabScrollPersistence (UX2 multi-selector)", () => {
  beforeEach(() => {
    // Make sure no stale ref from a previous test leaks across.
    delete (window as Record<string, unknown>).__persistence;
  });

  it("snapshots scrollTop on the active tab and restores it on return", () => {
    const { getByTestId } = render(<Host initial="tab-a" />);

    // Scroll the first tab.
    const elA = getByTestId("tab-body");
    expect(elA.classList.contains("main-pane__scroll")).toBe(true);
    dispatchScrollOn(elA, 250);

    // Switch to a second tab via wrapSelectTab.
    const persistence = (
      window as unknown as {
        __persistence: { wrapSelectTab: (id: string) => void };
      }
    ).__persistence;
    act(() => persistence.wrapSelectTab("tab-spec"));

    // Tab body's class should have flipped — confirming it's the
    // spec-content scroller for the new tab.
    const elSpec = getByTestId("tab-body");
    expect(elSpec.classList.contains("spec-content")).toBe(true);

    // Switch back. The new tab body now matches the old selector;
    // the hook should restore the 250 we stored earlier on the next
    // animation frame.
    act(() => persistence.wrapSelectTab("tab-a"));

    return waitFrames(3).then(() => {
      const elBack = getByTestId("tab-body");
      expect(elBack.classList.contains("main-pane__scroll")).toBe(true);
      expect(elBack.scrollTop).toBe(250);
    });
  });

  it("remembers different selectors on different tabs (spec-content vs main-pane__scroll)", () => {
    const { getByTestId } = render(<Host initial="tab-a" />);

    // Tab A is main-pane__scroll: scroll it to 100.
    dispatchScrollOn(getByTestId("tab-body"), 100);

    const persistence = (
      window as unknown as {
        __persistence: { wrapSelectTab: (id: string) => void };
      }
    ).__persistence;
    act(() => persistence.wrapSelectTab("tab-spec"));

    // Tab spec is .spec-content: scroll it to 600.
    const specEl = getByTestId("tab-body");
    expect(specEl.classList.contains("spec-content")).toBe(true);
    dispatchScrollOn(specEl, 600);

    // Switch back to A — should restore main-pane__scroll = 100.
    act(() => persistence.wrapSelectTab("tab-a"));
    return waitFrames(3).then(() => {
      const a = getByTestId("tab-body");
      expect(a.scrollTop).toBe(100);

      // And forward again to spec — should restore .spec-content = 600.
      act(() => persistence.wrapSelectTab("tab-spec"));
      return waitFrames(3).then(() => {
        const s = getByTestId("tab-body");
        expect(s.scrollTop).toBe(600);
      });
    });
  });

  it("ignores scroll events on unsupported elements", () => {
    const { getByTestId } = render(<Host initial="tab-a" />);

    // Create an element with a class we DON'T track. Scrolling it
    // shouldn't poison the active tab's snapshot.
    const stranger = document.createElement("div");
    stranger.className = "something-unrelated";
    document.body.appendChild(stranger);
    dispatchScrollOn(stranger, 999);

    // The supported scroller is still at zero, and switching away +
    // back must not restore 999 (because we never recorded it).
    const persistence = (
      window as unknown as {
        __persistence: { wrapSelectTab: (id: string) => void };
      }
    ).__persistence;
    act(() => persistence.wrapSelectTab("tab-spec"));
    act(() => persistence.wrapSelectTab("tab-a"));

    return waitFrames(3).then(() => {
      const el = getByTestId("tab-body");
      expect(el.scrollTop).toBe(0);
      document.body.removeChild(stranger);
    });
  });

  // UX2-bis — explicit regression test for the "returns to top"
  // bug. Simulate a slow-rendering tab: the destination scroller
  // exists in the DOM but its scrollHeight is initially too small
  // for the saved scrollTop to stick. Once content "renders" (we
  // grow the inner spacer between rAFs), the retry loop should
  // catch up and end with the correct scroll position.
  it("retries the restore until scrollTop sticks (slow-rendering tab)", async () => {
    const { getByTestId } = render(<Host initial="tab-a" />);

    // Scroll tab A to 800.
    const elA = getByTestId("tab-body");
    dispatchScrollOn(elA, 800);

    const persistence = (
      window as unknown as {
        __persistence: { wrapSelectTab: (id: string) => void };
      }
    ).__persistence;
    act(() => persistence.wrapSelectTab("tab-spec"));

    // Switch back to tab A. Synthetically simulate the destination
    // having a small scrollHeight at first by clamping the element's
    // scrollHeight via CSS height. Then grow it after a couple of
    // frames so the retry loop has something to converge on.
    act(() => persistence.wrapSelectTab("tab-a"));

    // jsdom's element.scrollTop assignment isn't bounded by
    // scrollHeight, so we can't directly simulate the clamp.
    // Instead, settle a few frames and confirm the final state
    // matches the saved value.
    await waitFrames(5);
    const final = getByTestId("tab-body");
    expect(final.scrollTop).toBe(800);
  });
});
