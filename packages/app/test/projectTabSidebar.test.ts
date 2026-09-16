import { describe, expect, it } from "vitest";

import {
  effectiveSidebarCollapsed,
  handleActiveTabChange,
  handleSidebarToggle,
  initialSidebarPrefState,
  type SidebarPrefState,
} from "../src/renderer/src/projectTabSidebar.js";

/** Build a state for a test — expressive without the `null` boilerplate. */
function state(
  userPreference: boolean,
  projectTabOverride: boolean | null = null,
): SidebarPrefState {
  return { userPreference, projectTabOverride };
}

describe("projectTabSidebar", () => {
  describe("effectiveSidebarCollapsed", () => {
    it("on the Project tab without an override: auto-collapses (true)", () => {
      expect(effectiveSidebarCollapsed(state(false), "project")).toBe(true);
      expect(effectiveSidebarCollapsed(state(true), "project")).toBe(true);
    });

    it("on the Project tab with an override: honours the override", () => {
      expect(effectiveSidebarCollapsed(state(false, false), "project")).toBe(
        false,
      );
      expect(effectiveSidebarCollapsed(state(false, true), "project")).toBe(
        true,
      );
      expect(effectiveSidebarCollapsed(state(true, false), "project")).toBe(
        false,
      );
    });

    it("on any other tab: returns the user preference", () => {
      for (const kind of ["workSpec", "bdb", "controlPlan"] as const) {
        expect(effectiveSidebarCollapsed(state(false), kind)).toBe(false);
        expect(effectiveSidebarCollapsed(state(true), kind)).toBe(true);
      }
    });

    it("on any other tab: ignores any lingering override value", () => {
      // Override should have been cleared by the tab-change handler, but
      // even if something goes wrong we must still fall back to the user
      // preference when the active tab isn't the Project tab.
      expect(effectiveSidebarCollapsed(state(false, true), "workSpec")).toBe(
        false,
      );
      expect(effectiveSidebarCollapsed(state(true, false), "bdb")).toBe(true);
    });
  });

  describe("handleSidebarToggle", () => {
    it("on the Project tab, first toggle expands (override = false)", () => {
      // Default effective is auto-collapsed (true); flip → false.
      const next = handleSidebarToggle(state(false), "project");
      expect(next.userPreference).toBe(false); // preference untouched
      expect(next.projectTabOverride).toBe(false);
    });

    it("on the Project tab, second toggle collapses again (override = true)", () => {
      const once = handleSidebarToggle(state(false), "project");
      const twice = handleSidebarToggle(once, "project");
      expect(twice.userPreference).toBe(false);
      expect(twice.projectTabOverride).toBe(true);
    });

    it("on the Project tab, toggle never touches the user preference", () => {
      const s = state(true); // user preference: collapsed
      const next = handleSidebarToggle(s, "project");
      expect(next.userPreference).toBe(true); // still collapsed preference
      // Effective was true (auto-collapsed), flip to false.
      expect(next.projectTabOverride).toBe(false);
    });

    it("on a spec tab, toggle flips the user preference", () => {
      const next = handleSidebarToggle(state(false), "workSpec");
      expect(next.userPreference).toBe(true);
      expect(next.projectTabOverride).toBe(null);
    });

    it("on a spec tab, toggle never touches the override", () => {
      // Rare but possible: a stale override lingers. Toggling off-project
      // should leave it alone (the tab-change handler is what clears it).
      const next = handleSidebarToggle(state(false, true), "controlPlan");
      expect(next.userPreference).toBe(true);
      expect(next.projectTabOverride).toBe(true);
    });
  });

  describe("handleActiveTabChange", () => {
    it("leaving the Project tab clears a set override", () => {
      const next = handleActiveTabChange(state(false, false), "workSpec");
      expect(next.projectTabOverride).toBe(null);
      expect(next.userPreference).toBe(false);
    });

    it("switching between non-Project tabs is a no-op when no override is set", () => {
      const s = state(true);
      expect(handleActiveTabChange(s, "bdb")).toBe(s); // referential identity
    });

    it("switching to the Project tab never clears anything", () => {
      const s = state(false, true);
      expect(handleActiveTabChange(s, "project")).toBe(s);
    });

    it("already-null override + non-Project tab is a no-op", () => {
      const s = state(true, null);
      expect(handleActiveTabChange(s, "workSpec")).toBe(s);
    });
  });

  describe("end-to-end flow", () => {
    it("realistic session: land on Project → expand → jump to spec → come back", () => {
      // User preference = expanded (false). First render: on Project tab.
      let s = initialSidebarPrefState(false);
      expect(effectiveSidebarCollapsed(s, "project")).toBe(true); // auto-collapsed

      // User hits the toggle → expand override.
      s = handleSidebarToggle(s, "project");
      expect(effectiveSidebarCollapsed(s, "project")).toBe(false);

      // User clicks a BDB → new active tab = "bdb".
      s = handleActiveTabChange(s, "bdb");
      expect(effectiveSidebarCollapsed(s, "bdb")).toBe(false); // user preference wins
      expect(s.projectTabOverride).toBe(null); // override cleared

      // User navigates back to the Project tab.
      // No state change yet (tab-change to "project" doesn't clear anything).
      s = handleActiveTabChange(s, "project");
      // Auto-collapse again — the "expand" gesture didn't stick.
      expect(effectiveSidebarCollapsed(s, "project")).toBe(true);
    });

    it("user preference survives Project-tab toggling", () => {
      // User preference = collapsed (true). They spend all session on the
      // Project tab, toggle open/closed a bunch — preference stays collapsed.
      let s = initialSidebarPrefState(true);
      for (let i = 0; i < 5; i++) {
        s = handleSidebarToggle(s, "project");
      }
      expect(s.userPreference).toBe(true);

      // When they finally leave the Project tab, the sidebar reflects their
      // (unchanged) collapsed preference.
      s = handleActiveTabChange(s, "workSpec");
      expect(effectiveSidebarCollapsed(s, "workSpec")).toBe(true);
    });
  });
});
