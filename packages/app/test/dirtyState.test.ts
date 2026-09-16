import { describe, expect, it } from "vitest";

import {
  anyDirty,
  detectConflict,
  isTabDirty,
  pruneDirtyMap,
  setTabDirty,
} from "../src/renderer/src/dirtyState.js";

describe("setTabDirty", () => {
  it("marks a tab dirty", () => {
    const out = setTabDirty({}, "tab:1", true);
    expect(out).toEqual({ "tab:1": true });
  });

  it("clearing an already-clean tab is a no-op (same reference)", () => {
    const in_ = { "tab:1": true } as const;
    const out = setTabDirty(in_, "tab:2", false);
    expect(out).toBe(in_);
  });

  it("marking an already-dirty tab dirty is a no-op (same reference)", () => {
    const in_ = { "tab:1": true } as const;
    const out = setTabDirty(in_, "tab:1", true);
    expect(out).toBe(in_);
  });

  it("clearing a dirty tab removes it", () => {
    const out = setTabDirty({ "tab:1": true, "tab:2": true }, "tab:1", false);
    expect(out).toEqual({ "tab:2": true });
  });
});

describe("anyDirty / isTabDirty", () => {
  it("false for an empty map", () => {
    expect(anyDirty({})).toBe(false);
  });

  it("true when at least one tab is dirty", () => {
    expect(anyDirty({ "tab:1": true })).toBe(true);
  });

  it("isTabDirty reflects membership", () => {
    expect(isTabDirty({ "tab:1": true }, "tab:1")).toBe(true);
    expect(isTabDirty({ "tab:1": true }, "tab:2")).toBe(false);
  });
});

describe("pruneDirtyMap", () => {
  it("drops keys not in keepSet", () => {
    const out = pruneDirtyMap(
      { "tab:1": true, "tab:2": true },
      new Set(["tab:1"]),
    );
    expect(out).toEqual({ "tab:1": true });
  });

  it("returns the same reference when nothing is dropped", () => {
    const in_ = { "tab:1": true, "tab:2": true };
    const out = pruneDirtyMap(in_, new Set(["tab:1", "tab:2"]));
    expect(out).toBe(in_);
  });

  it("returns {} when nothing is kept", () => {
    expect(pruneDirtyMap({ "tab:1": true }, new Set())).toEqual({});
  });
});

describe("detectConflict", () => {
  it("clean when stored matches current", () => {
    expect(detectConflict(1700000000000, 1700000000000)).toBe("clean");
  });

  it("conflict when current mtime is newer", () => {
    expect(detectConflict(1700000000000, 1700000000001)).toBe("conflict");
  });

  it("conflict when current mtime is older (unusual but still a mismatch)", () => {
    expect(detectConflict(1700000000000, 1699999999000)).toBe("conflict");
  });

  it("missing when current mtime is null", () => {
    expect(detectConflict(1700000000000, null)).toBe("missing");
  });
});
