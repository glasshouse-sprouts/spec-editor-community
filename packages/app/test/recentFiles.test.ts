import { describe, expect, it } from "vitest";

import {
  addRecentFile,
  readRecentFiles,
  removeRecentFile,
  RECENT_FILES_KEY,
  RECENT_FILES_MAX,
  writeRecentFiles,
  type KeyValueStore,
  type RecentFileEntry,
} from "../src/renderer/src/recentFiles.js";

/** Map-backed stand-in so tests don't need a real `window.localStorage`. */
function makeStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

/** Small fixture helper so tests read "here's an entry" instead of raw objects. */
function entry(
  path: string,
  projectName: string,
  openedAt: number,
): RecentFileEntry {
  return { path, projectName, openedAt };
}

describe("recentFiles — read / write", () => {
  it("reads an empty list when the key is missing", () => {
    expect(readRecentFiles(makeStore())).toEqual([]);
  });

  it("round-trips a list through JSON", () => {
    const store = makeStore();
    const input: RecentFileEntry[] = [
      entry("/a/b.moliospec", "Project A", 1000),
      entry("/c/d.moliospec", "", 500),
    ];
    writeRecentFiles(store, input);
    expect(readRecentFiles(store)).toEqual(input);
  });

  it("falls back to empty list on malformed JSON", () => {
    const store = makeStore({ [RECENT_FILES_KEY]: "{{not json" });
    expect(readRecentFiles(store)).toEqual([]);
  });

  it("falls back to empty list when the stored value is not an array", () => {
    const store = makeStore({ [RECENT_FILES_KEY]: '{"foo":"bar"}' });
    expect(readRecentFiles(store)).toEqual([]);
  });

  it("drops malformed entries but keeps the good ones", () => {
    // One valid entry, one with missing fields, one with wrong types.
    const mixed = [
      { path: "/ok.moliospec", projectName: "OK", openedAt: 100 },
      { path: "/bad.moliospec" /* missing projectName + openedAt */ },
      { path: 42, projectName: "bad", openedAt: "100" },
    ];
    const store = makeStore({ [RECENT_FILES_KEY]: JSON.stringify(mixed) });
    expect(readRecentFiles(store)).toEqual([entry("/ok.moliospec", "OK", 100)]);
  });

  it("silently ignores storage write failures", () => {
    const store: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => writeRecentFiles(store, [])).not.toThrow();
  });
});

describe("recentFiles — addRecentFile", () => {
  it("adds the first entry to an empty list", () => {
    const result = addRecentFile(
      [],
      { path: "/a.moliospec", projectName: "Alpha" },
      1000,
    );
    expect(result).toEqual([entry("/a.moliospec", "Alpha", 1000)]);
  });

  it("puts the newest entry at the top", () => {
    const start = [entry("/old.moliospec", "Old", 100)];
    const result = addRecentFile(
      start,
      { path: "/new.moliospec", projectName: "New" },
      200,
    );
    expect(result.map((e) => e.path)).toEqual([
      "/new.moliospec",
      "/old.moliospec",
    ]);
  });

  it("dedupes on path — re-opening moves the entry to the top with a fresh timestamp", () => {
    const start: RecentFileEntry[] = [
      entry("/a.moliospec", "A", 100),
      entry("/b.moliospec", "B", 200),
      entry("/c.moliospec", "C", 300),
    ];
    // Re-open /a — it should move back to the top, and /b+/c shift down.
    const result = addRecentFile(
      start,
      { path: "/a.moliospec", projectName: "A (updated)" },
      400,
    );
    expect(result).toEqual([
      entry("/a.moliospec", "A (updated)", 400),
      entry("/b.moliospec", "B", 200),
      entry("/c.moliospec", "C", 300),
    ]);
  });

  it("caps the list at RECENT_FILES_MAX entries", () => {
    // Seed with MAX distinct entries.
    let list: RecentFileEntry[] = [];
    for (let i = 0; i < RECENT_FILES_MAX; i++) {
      list = addRecentFile(
        list,
        { path: `/file-${i}.moliospec`, projectName: `P${i}` },
        1000 + i,
      );
    }
    expect(list).toHaveLength(RECENT_FILES_MAX);

    // One more push: list stays at MAX, oldest falls off.
    const pushed = addRecentFile(
      list,
      { path: "/newest.moliospec", projectName: "Newest" },
      9999,
    );
    expect(pushed).toHaveLength(RECENT_FILES_MAX);
    expect(pushed[0]!.path).toBe("/newest.moliospec");
    // The very first entry we added (file-0) should have been kicked out.
    expect(pushed.map((e) => e.path)).not.toContain("/file-0.moliospec");
  });

  it("does not mutate the input array", () => {
    const start: RecentFileEntry[] = [entry("/a.moliospec", "A", 100)];
    const snapshot = JSON.parse(JSON.stringify(start));
    addRecentFile(start, { path: "/b.moliospec", projectName: "B" }, 200);
    expect(start).toEqual(snapshot);
  });

  it("handles an empty projectName (older files with no project row)", () => {
    const result = addRecentFile(
      [],
      { path: "/no-name.moliospec", projectName: "" },
      1000,
    );
    expect(result).toEqual([entry("/no-name.moliospec", "", 1000)]);
  });

  it("treats paths as case-sensitive (filesystem authority)", () => {
    // On Linux/macOS-case-sensitive volumes, "/A.moliospec" and
    // "/a.moliospec" are distinct files. The helper doesn't second-guess
    // the OS — two paths with different case stay as two entries.
    const start = [entry("/A.moliospec", "Upper", 100)];
    const result = addRecentFile(
      start,
      { path: "/a.moliospec", projectName: "Lower" },
      200,
    );
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.path)).toEqual(["/a.moliospec", "/A.moliospec"]);
  });
});

describe("recentFiles — removeRecentFile", () => {
  it("removes an entry by exact path match", () => {
    const start: RecentFileEntry[] = [
      entry("/a.moliospec", "A", 100),
      entry("/b.moliospec", "B", 200),
    ];
    expect(removeRecentFile(start, "/a.moliospec")).toEqual([
      entry("/b.moliospec", "B", 200),
    ]);
  });

  it("returns a new array when the path is not present (no-op, no throw)", () => {
    const start: RecentFileEntry[] = [entry("/a.moliospec", "A", 100)];
    const result = removeRecentFile(start, "/not-there.moliospec");
    expect(result).toEqual(start);
  });

  it("does not mutate the input array", () => {
    const start: RecentFileEntry[] = [
      entry("/a.moliospec", "A", 100),
      entry("/b.moliospec", "B", 200),
    ];
    const snapshot = JSON.parse(JSON.stringify(start));
    removeRecentFile(start, "/a.moliospec");
    expect(start).toEqual(snapshot);
  });
});
