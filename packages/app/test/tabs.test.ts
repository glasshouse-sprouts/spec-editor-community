/**
 * Unit tests for the tab state helpers in renderer/src/tabs.ts.
 *
 * We import the .ts file directly (no renderer build needed) because the
 * module is pure TS — no React, no DOM.
 */

import { describe, expect, it } from "vitest";

import {
  activeTab,
  closeTab,
  initialTabState,
  openOrFocusTab,
  PROJECT_TAB_ID,
  selectTab,
  type TabState,
} from "../src/renderer/src/tabs.js";

describe("initialTabState", () => {
  it("starts with the project tab focused", () => {
    const s = initialTabState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.id).toBe(PROJECT_TAB_ID);
    expect(s.tabs[0]!.target).toEqual({ kind: "project" });
    expect(s.activeTabId).toBe(PROJECT_TAB_ID);
  });
});

describe("openOrFocusTab", () => {
  it("opens a new tab when the target is not already open", () => {
    const s0 = initialTabState();
    const s1 = openOrFocusTab(s0, { kind: "workSpec", id: 42 });
    expect(s1.tabs).toHaveLength(2);
    expect(s1.tabs[1]!.target).toEqual({ kind: "workSpec", id: 42 });
    expect(s1.activeTabId).toBe(s1.tabs[1]!.id);
  });

  it("focuses an existing tab rather than opening a duplicate", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 42 });
    s = openOrFocusTab(s, { kind: "bdb", id: 7 });
    // Now refocus away
    s = selectTab(s, PROJECT_TAB_ID);
    // Reopening workSpec 42 should focus, not duplicate
    const before = s.tabs.length;
    s = openOrFocusTab(s, { kind: "workSpec", id: 42 });
    expect(s.tabs).toHaveLength(before);
    expect(activeTab(s).target).toEqual({ kind: "workSpec", id: 42 });
  });

  it("treats different target kinds as distinct even with the same id", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 });
    s = openOrFocusTab(s, { kind: "bdb", id: 1 });
    expect(s.tabs).toHaveLength(3);
  });

  it("tabs are appended in open order", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 10 });
    s = openOrFocusTab(s, { kind: "bdb", id: 20 });
    s = openOrFocusTab(s, { kind: "controlPlan", id: 30 });
    expect(s.tabs.map((t) => t.target)).toEqual([
      { kind: "project" },
      { kind: "workSpec", id: 10 },
      { kind: "bdb", id: 20 },
      { kind: "controlPlan", id: 30 },
    ]);
  });
});

describe("closeTab", () => {
  it("refuses to close the project tab", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 });
    const after = closeTab(s, PROJECT_TAB_ID);
    expect(after).toEqual(s);
  });

  it("removes the closed tab", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 });
    const specId = s.tabs[1]!.id;
    s = closeTab(s, specId);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.id).toBe(PROJECT_TAB_ID);
  });

  it("when closing the active tab, focus shifts to the left neighbour", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 }); // tab[1]
    s = openOrFocusTab(s, { kind: "bdb", id: 2 }); // tab[2] — now active
    const middleId = s.tabs[1]!.id;
    s = selectTab(s, s.tabs[2]!.id); // explicitly focus tab[2]
    s = closeTab(s, s.tabs[2]!.id); // close active (rightmost)
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabId).toBe(middleId);
  });

  it("when closing a non-active tab, active tab is preserved", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 });
    s = openOrFocusTab(s, { kind: "bdb", id: 2 });
    const active = s.activeTabId;
    const nonActive = s.tabs[1]!.id;
    s = closeTab(s, nonActive);
    expect(s.activeTabId).toBe(active);
  });

  it("no-op if the tab id doesn't exist", () => {
    const s = initialTabState();
    expect(closeTab(s, "tab:does-not-exist")).toEqual(s);
  });
});

describe("selectTab", () => {
  it("switches focus to the given tab", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 1 });
    const specId = s.tabs[1]!.id;
    s = selectTab(s, PROJECT_TAB_ID);
    expect(s.activeTabId).toBe(PROJECT_TAB_ID);
    s = selectTab(s, specId);
    expect(s.activeTabId).toBe(specId);
  });

  it("no-op when the target tab doesn't exist", () => {
    const s = initialTabState();
    expect(selectTab(s, "tab:nope")).toEqual(s);
  });
});

describe("activeTab", () => {
  it("returns the focused tab", () => {
    let s: TabState = initialTabState();
    s = openOrFocusTab(s, { kind: "workSpec", id: 5 });
    expect(activeTab(s).target).toEqual({ kind: "workSpec", id: 5 });
  });

  it("falls back to first tab if activeTabId is somehow stale", () => {
    const s: TabState = {
      tabs: [{ id: PROJECT_TAB_ID, target: { kind: "project" } }],
      activeTabId: "tab:missing",
    };
    expect(activeTab(s).id).toBe(PROJECT_TAB_ID);
  });
});
