import { describe, expect, it } from "vitest";

import {
  readRefPanelCollapsed,
  REF_PANEL_COLLAPSED_KEY,
  writeRefPanelCollapsed,
  type KeyValueStore,
} from "../src/renderer/src/refPanelPrefs.js";

/** Tiny Map-backed KeyValueStore stand-in for tests. */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("refPanelPrefs", () => {
  it("defaults to expanded (false) when no value is stored", () => {
    expect(readRefPanelCollapsed(fakeStore())).toBe(false);
  });

  it('reads the collapsed flag when stored as "true"', () => {
    const s = fakeStore({ [REF_PANEL_COLLAPSED_KEY]: "true" });
    expect(readRefPanelCollapsed(s)).toBe(true);
  });

  it("treats any non-'true' value as expanded", () => {
    expect(
      readRefPanelCollapsed(fakeStore({ [REF_PANEL_COLLAPSED_KEY]: "false" })),
    ).toBe(false);
    expect(
      readRefPanelCollapsed(fakeStore({ [REF_PANEL_COLLAPSED_KEY]: "" })),
    ).toBe(false);
    expect(
      readRefPanelCollapsed(fakeStore({ [REF_PANEL_COLLAPSED_KEY]: "1" })),
    ).toBe(false);
  });

  it("round-trips through write + read", () => {
    const s = fakeStore();
    writeRefPanelCollapsed(s, true);
    expect(readRefPanelCollapsed(s)).toBe(true);
    writeRefPanelCollapsed(s, false);
    expect(readRefPanelCollapsed(s)).toBe(false);
  });

  it("swallows storage errors gracefully", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
    };
    // Should NOT throw — UI would otherwise crash when localStorage is
    // disabled (incognito, sandboxed contexts).
    expect(() => readRefPanelCollapsed(broken)).not.toThrow();
    expect(readRefPanelCollapsed(broken)).toBe(false);
    expect(() => writeRefPanelCollapsed(broken, true)).not.toThrow();
  });

  it("does not collide with the sidebar-collapsed key", () => {
    // Regression guard: if someone ever copy-pastes the sidebar key into
    // this module we want the tests to catch it immediately.
    expect(REF_PANEL_COLLAPSED_KEY).toBe("molio2.refPanel.collapsed");
    expect(REF_PANEL_COLLAPSED_KEY).not.toBe("molio2.sidebar.collapsed");
  });
});
