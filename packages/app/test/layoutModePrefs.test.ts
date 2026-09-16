import { describe, expect, it } from "vitest";

import {
  LAYOUT_MODE_KEY,
  readLayoutMode,
  writeLayoutMode,
  type KeyValueStore,
} from "../src/renderer/src/layoutModePrefs.js";

/** Tiny Map-backed KeyValueStore stand-in for tests. */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("layoutModePrefs", () => {
  it('defaults to "web" when no value is stored', () => {
    expect(readLayoutMode(fakeStore())).toBe("web");
  });

  it('reads "print" when stored as "print"', () => {
    const s = fakeStore({ [LAYOUT_MODE_KEY]: "print" });
    expect(readLayoutMode(s)).toBe("print");
  });

  it('reads "web" when stored as "web"', () => {
    const s = fakeStore({ [LAYOUT_MODE_KEY]: "web" });
    expect(readLayoutMode(s)).toBe("web");
  });

  it('treats any other value as "web"', () => {
    expect(readLayoutMode(fakeStore({ [LAYOUT_MODE_KEY]: "" }))).toBe("web");
    expect(readLayoutMode(fakeStore({ [LAYOUT_MODE_KEY]: "PRINT" }))).toBe(
      "web",
    );
    expect(readLayoutMode(fakeStore({ [LAYOUT_MODE_KEY]: "true" }))).toBe(
      "web",
    );
  });

  it("round-trips through write + read", () => {
    const s = fakeStore();
    writeLayoutMode(s, "print");
    expect(readLayoutMode(s)).toBe("print");
    writeLayoutMode(s, "web");
    expect(readLayoutMode(s)).toBe("web");
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
    expect(() => readLayoutMode(broken)).not.toThrow();
    expect(readLayoutMode(broken)).toBe("web");
    expect(() => writeLayoutMode(broken, "print")).not.toThrow();
  });
});
