import { describe, it, expect } from "vitest";
import { isContractEmpty } from "../src/renderer/src/emptyNodes.js";
import {
  readHideEmpty,
  writeHideEmpty,
  SIDEBAR_HIDE_EMPTY_KEY,
} from "../src/renderer/src/emptyNodesPrefs.js";

describe("isContractEmpty", () => {
  it("is true for a real contract with no work areas", () => {
    expect(isContractEmpty(5, 0)).toBe(true);
  });

  it("is false for a real contract that has work areas", () => {
    expect(isContractEmpty(5, 1)).toBe(false);
    expect(isContractEmpty(5, 3)).toBe(false);
  });

  it("never treats the [No contract] bucket (null) as empty", () => {
    expect(isContractEmpty(null, 0)).toBe(false);
  });
});

describe("hideEmpty pref round-trip", () => {
  function makeStore() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      _map: m,
    };
  }

  it("defaults to false when nothing is stored", () => {
    expect(readHideEmpty(makeStore())).toBe(false);
  });

  it("round-trips true and false", () => {
    const s = makeStore();
    writeHideEmpty(s, true);
    expect(s._map.get(SIDEBAR_HIDE_EMPTY_KEY)).toBe("true");
    expect(readHideEmpty(s)).toBe(true);
    writeHideEmpty(s, false);
    expect(readHideEmpty(s)).toBe(false);
  });

  it("swallows storage errors on read and write", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeHideEmpty(throwing, true)).not.toThrow();
    expect(readHideEmpty(throwing)).toBe(false);
  });
});
