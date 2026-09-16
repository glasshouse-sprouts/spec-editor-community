import { describe, expect, it } from "vitest";

import {
  COMPACT_VIEW_KEY,
  readCompactView,
  writeCompactView,
  type KeyValueStore,
} from "../src/renderer/src/compactViewPrefs.js";

/** Tiny Map-backed KeyValueStore stand-in for tests. */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("compactViewPrefs", () => {
  it("defaults to OFF (false) when no value is stored", () => {
    expect(readCompactView(fakeStore())).toBe(false);
  });

  it('reads the flag as ON when stored as "true"', () => {
    const s = fakeStore({ [COMPACT_VIEW_KEY]: "true" });
    expect(readCompactView(s)).toBe(true);
  });

  it("treats any non-'true' value as OFF", () => {
    expect(readCompactView(fakeStore({ [COMPACT_VIEW_KEY]: "false" }))).toBe(
      false,
    );
    expect(readCompactView(fakeStore({ [COMPACT_VIEW_KEY]: "" }))).toBe(false);
    expect(readCompactView(fakeStore({ [COMPACT_VIEW_KEY]: "1" }))).toBe(false);
  });

  it("round-trips through write + read", () => {
    const s = fakeStore();
    writeCompactView(s, true);
    expect(readCompactView(s)).toBe(true);
    writeCompactView(s, false);
    expect(readCompactView(s)).toBe(false);
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
    expect(() => readCompactView(broken)).not.toThrow();
    expect(readCompactView(broken)).toBe(false);
    expect(() => writeCompactView(broken, true)).not.toThrow();
  });
});
