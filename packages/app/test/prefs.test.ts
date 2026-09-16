/** @vitest-environment jsdom */
/**
 * PREFS — renderer-side IpcKeyValueStore.
 *
 * Verifies the three-mode `prefStore()` factory:
 *   1. With `window.molio.prefs` present → IpcKeyValueStore that
 *      reads from the cached snapshot and writes via the bridge.
 *   2. Without bridge but with jsdom-shimmed window.localStorage →
 *      uses localStorage directly (preserves test patterns from
 *      before the migration).
 *   3. (Implicit — covered in prefs.ts; not asserted here because
 *      the renderer always has a window.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prefStore } from "../src/renderer/src/prefs.js";

interface MutableWindow {
  molio?: {
    prefs?: {
      initial: Record<string, string>;
      set: (k: string, v: string) => Promise<void>;
      delete: (k: string) => Promise<void>;
    };
  };
}

function resetSingleton(): void {
  // The store is a module-level singleton; resetting between tests
  // means re-importing the module. vitest's module cache makes that
  // tedious; the simplest workaround is exposing window.molio
  // BEFORE the first prefStore() call, which we ensure with
  // beforeEach + dynamic import via vi.resetModules().
  vi.resetModules();
}

beforeEach(() => {
  resetSingleton();
  delete (window as MutableWindow).molio;
  window.localStorage.clear();
});
afterEach(() => {
  delete (window as MutableWindow).molio;
  window.localStorage.clear();
});

describe("prefStore — IPC mode", () => {
  it("reads from the preload snapshot and writes via the bridge", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    (window as MutableWindow).molio = {
      prefs: {
        initial: {
          "molio.locale": "en",
          "molio2.recentFiles": "[]",
        },
        set,
        delete: del,
      },
    };
    const { prefStore: ps } = await import("../src/renderer/src/prefs.js");
    const store = ps();

    // Read from snapshot
    expect(store.getItem("molio.locale")).toBe("en");
    expect(store.getItem("missing")).toBeNull();

    // Write reflects locally + calls bridge
    store.setItem("molio.locale", "da");
    expect(store.getItem("molio.locale")).toBe("da");
    expect(set).toHaveBeenCalledWith("molio.locale", "da");

    // Delete clears local cache + calls bridge
    store.removeItem?.("molio.locale");
    expect(store.getItem("molio.locale")).toBeNull();
    expect(del).toHaveBeenCalledWith("molio.locale");
  });
});

describe("prefStore — localStorage fallback (test env without bridge)", () => {
  it("uses window.localStorage when window.molio.prefs is missing", async () => {
    const { prefStore: ps } = await import("../src/renderer/src/prefs.js");
    const store = ps();

    // localStorage is shimmed by jsdom — verify we got that path
    // by setting a value through the store and reading it back
    // out of localStorage directly.
    store.setItem("seeded", "yes");
    expect(window.localStorage.getItem("seeded")).toBe("yes");

    // And vice versa — values seeded directly into localStorage are
    // visible to the store.
    window.localStorage.setItem("manual", "ok");
    expect(store.getItem("manual")).toBe("ok");
  });
});
