import { describe, expect, it } from "vitest";

import {
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  writeSidebarCollapsed,
  type KeyValueStore,
} from "../src/renderer/src/sidebarPrefs.js";

/** Tiny Map-backed KeyValueStore stand-in for tests. */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("sidebarPrefs", () => {
  it("defaults to expanded (false) when no value is stored", () => {
    expect(readSidebarCollapsed(fakeStore())).toBe(false);
  });

  it('reads the collapsed flag when stored as "true"', () => {
    const s = fakeStore({ [SIDEBAR_COLLAPSED_KEY]: "true" });
    expect(readSidebarCollapsed(s)).toBe(true);
  });

  it("treats any non-'true' value as expanded", () => {
    expect(
      readSidebarCollapsed(fakeStore({ [SIDEBAR_COLLAPSED_KEY]: "false" })),
    ).toBe(false);
    expect(
      readSidebarCollapsed(fakeStore({ [SIDEBAR_COLLAPSED_KEY]: "" })),
    ).toBe(false);
    expect(
      readSidebarCollapsed(fakeStore({ [SIDEBAR_COLLAPSED_KEY]: "1" })),
    ).toBe(false);
  });

  it("round-trips through write + read", () => {
    const s = fakeStore();
    writeSidebarCollapsed(s, true);
    expect(readSidebarCollapsed(s)).toBe(true);
    writeSidebarCollapsed(s, false);
    expect(readSidebarCollapsed(s)).toBe(false);
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
    expect(() => readSidebarCollapsed(broken)).not.toThrow();
    expect(readSidebarCollapsed(broken)).toBe(false);
    expect(() => writeSidebarCollapsed(broken, true)).not.toThrow();
  });
});
