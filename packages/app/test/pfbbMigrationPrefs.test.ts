import { describe, expect, it } from "vitest";

import {
  clearPfbbMigrationDismissed,
  isPfbbMigrationDismissed,
  setPfbbMigrationDismissed,
  type KeyValueStore,
} from "../src/renderer/src/pfbbMigrationPrefs.js";

/**
 * Map-backed KeyValueStore stand-in for tests. Mirrors the pattern used
 * in compactViewPrefs.test.ts — keeps tests independent of jsdom's
 * localStorage.
 */
function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("pfbbMigrationPrefs", () => {
  const PATH_A = "/Users/tore/projects/a.moliospec";
  const PATH_B = "/Users/tore/projects/b.moliospec";

  it("defaults to NOT dismissed on an empty store", () => {
    expect(isPfbbMigrationDismissed(fakeStore(), PATH_A)).toBe(false);
  });

  it("round-trips set → is dismissed → clear", () => {
    const s = fakeStore();
    setPfbbMigrationDismissed(s, PATH_A);
    expect(isPfbbMigrationDismissed(s, PATH_A)).toBe(true);
    clearPfbbMigrationDismissed(s, PATH_A);
    expect(isPfbbMigrationDismissed(s, PATH_A)).toBe(false);
  });

  it("dismissal is scoped per project path", () => {
    // Project A is dismissed, Project B is not — they must not bleed
    // into each other.
    const s = fakeStore();
    setPfbbMigrationDismissed(s, PATH_A);
    expect(isPfbbMigrationDismissed(s, PATH_A)).toBe(true);
    expect(isPfbbMigrationDismissed(s, PATH_B)).toBe(false);
  });

  it("clearing one project doesn't affect another", () => {
    const s = fakeStore();
    setPfbbMigrationDismissed(s, PATH_A);
    setPfbbMigrationDismissed(s, PATH_B);
    clearPfbbMigrationDismissed(s, PATH_A);
    expect(isPfbbMigrationDismissed(s, PATH_A)).toBe(false);
    expect(isPfbbMigrationDismissed(s, PATH_B)).toBe(true);
  });

  it("swallows storage errors gracefully", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
      removeItem: () => {
        throw new Error("boom");
      },
    };
    expect(() => isPfbbMigrationDismissed(broken, PATH_A)).not.toThrow();
    expect(isPfbbMigrationDismissed(broken, PATH_A)).toBe(false);
    expect(() => setPfbbMigrationDismissed(broken, PATH_A)).not.toThrow();
    expect(() => clearPfbbMigrationDismissed(broken, PATH_A)).not.toThrow();
  });
});
