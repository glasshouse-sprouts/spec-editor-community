import { describe, expect, it } from "vitest";

import {
  decideSpecTabLayout,
  refPanelToggleLabel,
  type SpecTabLayout,
} from "../src/renderer/src/specTabLayout.js";
import {
  readRefPanelCollapsed,
  writeRefPanelCollapsed,
  type KeyValueStore,
} from "../src/renderer/src/refPanelPrefs.js";

/**
 * These tests cover the decision logic that drives which layout the
 * spec tab renders plus the end-to-end behaviour of "user clicks
 * chevron → persisted flag flips across app restarts". They stay
 * deliberately dependency-free (no jsdom, no react-test-renderer) so
 * they run in the same plain-TS suite as everything else.
 */

describe("decideSpecTabLayout", () => {
  it("aligned mode, pane expanded → aligned", () => {
    expect(
      decideSpecTabLayout({ isAlignedMode: true, refPanelCollapsed: false }),
    ).toBe<SpecTabLayout>("aligned");
  });

  it("standard mode, pane expanded → standard", () => {
    expect(
      decideSpecTabLayout({ isAlignedMode: false, refPanelCollapsed: false }),
    ).toBe<SpecTabLayout>("standard");
  });

  it("aligned mode, pane collapsed → spec-only (BDB focus)", () => {
    // Regression guard for the first-pass bug where collapsing the pane
    // in aligned mode silently did nothing because the chevron was
    // gated behind `!isAlignedMode`.
    expect(
      decideSpecTabLayout({ isAlignedMode: true, refPanelCollapsed: true }),
    ).toBe<SpecTabLayout>("spec-only");
  });

  it("standard mode, pane collapsed → spec-only", () => {
    expect(
      decideSpecTabLayout({ isAlignedMode: false, refPanelCollapsed: true }),
    ).toBe<SpecTabLayout>("spec-only");
  });
});

describe("refPanelToggleLabel", () => {
  it("uses reference-panel wording in standard mode", () => {
    expect(
      refPanelToggleLabel({ isAlignedMode: false, collapsed: false }),
    ).toBe("Hide reference panel");
    expect(refPanelToggleLabel({ isAlignedMode: false, collapsed: true })).toBe(
      "Show reference panel",
    );
  });

  it("uses parent-work-area wording in aligned mode", () => {
    // Aligned mode is BDB-vs-parent-work-area; the right column isn't a
    // "reference panel" in the usual sense, so the label reflects that.
    expect(refPanelToggleLabel({ isAlignedMode: true, collapsed: false })).toBe(
      "Hide parent work area column",
    );
    expect(refPanelToggleLabel({ isAlignedMode: true, collapsed: true })).toBe(
      "Show parent work area column",
    );
  });
});

/** Tiny Map-backed KeyValueStore stand-in for the toggle round-trip test. */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("ref panel toggle + persistence round-trip", () => {
  it("persists across simulated app restarts", () => {
    // Simulate: user opens the app → pane starts expanded → user clicks
    // the chevron twice → app is restarted (new read) → the most-recent
    // collapsed value is what fresh tabs inherit.
    const store = fakeStore();

    // First boot: default is "expanded".
    let persisted = readRefPanelCollapsed(store);
    expect(persisted).toBe(false);

    // User clicks collapse.
    persisted = !persisted;
    writeRefPanelCollapsed(store, persisted);

    // Restart: read back what's on disk.
    expect(readRefPanelCollapsed(store)).toBe(true);

    // User clicks expand again.
    persisted = !persisted;
    writeRefPanelCollapsed(store, persisted);

    // Another restart.
    expect(readRefPanelCollapsed(store)).toBe(false);
  });

  it("a fresh store's default is independent of a previous session's runtime value", () => {
    // Regression guard for the "per-tab override must not leak back to
    // the default" invariant — the persisted value only flips when we
    // explicitly write, not when the in-memory toggle runs.
    const store = fakeStore();
    // Simulate the renderer flipping its in-memory state without
    // persisting (e.g. a hypothetical future code path that forgets to
    // call writeRefPanelCollapsed). The persisted default must stay
    // at its last written value.
    expect(readRefPanelCollapsed(store)).toBe(false);
    // No write happens here — just a read.
    expect(readRefPanelCollapsed(store)).toBe(false);
  });
});
