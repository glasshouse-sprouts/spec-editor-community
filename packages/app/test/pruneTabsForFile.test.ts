/**
 * pruneTabsForFile — drops tabs pointing at specs that no longer
 * exist in the FilePayload. Bug FIX-Tab (2026-05-11): tabs for
 * a deleted work area / BDB / CP used to stay open and show
 * "no BDB" / "no work area" errors after a save that deleted
 * their target.
 */
import { describe, expect, it } from "vitest";

import {
  PROJECT_TAB_ID,
  pruneTabsForFile,
  type TabState,
} from "../src/renderer/src/tabs.js";

const ALL_VALID = {
  workSpecs: new Set([1, 2, 3]),
  bdbs: new Set([10, 20, 30]),
  controlPlans: new Set([100, 200]),
};

const NO_VALID = {
  workSpecs: new Set<number>(),
  bdbs: new Set<number>(),
  controlPlans: new Set<number>(),
};

function tabs(...t: Array<TabState["tabs"][number]>): TabState["tabs"] {
  return t;
}

describe("pruneTabsForFile", () => {
  it("returns the same state when every tab is still valid", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:1", target: { kind: "workSpec", id: 1 } },
        { id: "tab:2", target: { kind: "bdb", id: 20 } },
      ),
      activeTabId: "tab:2",
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out).toBe(state); // same reference — no work done
  });

  it("drops a workSpec tab when the work area is gone", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:99", target: { kind: "workSpec", id: 99 } },
      ),
      activeTabId: PROJECT_TAB_ID,
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0]?.id).toBe(PROJECT_TAB_ID);
  });

  it("drops a BDB tab when the BDB is gone", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:bdb-99", target: { kind: "bdb", id: 99 } },
      ),
      activeTabId: PROJECT_TAB_ID,
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out.tabs.find((t) => t.target.kind === "bdb")).toBeUndefined();
  });

  it("drops a controlPlan tab when the CP is gone", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:cp-99", target: { kind: "controlPlan", id: 99 } },
      ),
      activeTabId: PROJECT_TAB_ID,
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(
      out.tabs.find((t) => t.target.kind === "controlPlan"),
    ).toBeUndefined();
  });

  it("falls back to the project tab when the active tab is dropped", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:1", target: { kind: "workSpec", id: 1 } },
        { id: "tab:99", target: { kind: "workSpec", id: 99 } },
      ),
      activeTabId: "tab:99",
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out.activeTabId).toBe(PROJECT_TAB_ID);
    expect(out.tabs).toHaveLength(2);
  });

  it("keeps the active tab when it survives the prune", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:1", target: { kind: "workSpec", id: 1 } },
        { id: "tab:gone", target: { kind: "bdb", id: 999 } },
      ),
      activeTabId: "tab:1",
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out.activeTabId).toBe("tab:1");
  });

  it("never drops singleton tabs (project, highlights, revisions)", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:highlights", target: { kind: "highlights" } },
        { id: "tab:revisions", target: { kind: "revisions" } },
      ),
      activeTabId: "tab:highlights",
    };
    const out = pruneTabsForFile(state, NO_VALID);
    expect(out).toBe(state);
  });

  it("drops several tabs in one pass", () => {
    const state: TabState = {
      tabs: tabs(
        { id: PROJECT_TAB_ID, target: { kind: "project" } },
        { id: "tab:a", target: { kind: "workSpec", id: 99 } },
        { id: "tab:b", target: { kind: "bdb", id: 99 } },
        { id: "tab:c", target: { kind: "controlPlan", id: 99 } },
        { id: "tab:d", target: { kind: "workSpec", id: 1 } },
      ),
      activeTabId: "tab:a",
    };
    const out = pruneTabsForFile(state, ALL_VALID);
    expect(out.tabs.map((t) => t.id)).toEqual([PROJECT_TAB_ID, "tab:d"]);
    expect(out.activeTabId).toBe(PROJECT_TAB_ID);
  });
});
