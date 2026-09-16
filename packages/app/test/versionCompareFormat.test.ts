/** @vitest-environment jsdom */
/**
 * Slice "Version compare" — versionCompareFormat persistence.
 *
 * Verifies the localStorage round-trip + tolerant fallback behaviour
 * the read helper guarantees (missing → defaults; corrupt JSON →
 * defaults; partial shape → merged with defaults).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VERSION_COMPARE_FORMAT,
  readStoredFormat,
  setVersionCompareFormat,
  patchVersionCompareFormat,
  resetVersionCompareFormat,
  getVersionCompareFormat,
} from "../src/renderer/src/compare/versionCompareFormat.js";

const STORAGE_KEY = "molio.versionCompareFormat";

beforeEach(() => {
  window.localStorage.clear();
  // Reset module state to defaults each test so order doesn't leak.
  resetVersionCompareFormat();
});
afterEach(() => {
  window.localStorage.clear();
  resetVersionCompareFormat();
});

describe("readStoredFormat", () => {
  it("returns defaults when localStorage is empty", () => {
    expect(readStoredFormat()).toEqual(DEFAULT_VERSION_COMPARE_FORMAT);
  });

  it("returns defaults when JSON is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "{ not json }");
    expect(readStoredFormat()).toEqual(DEFAULT_VERSION_COMPARE_FORMAT);
  });

  it("merges a partial shape onto the defaults", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        added: { color: "#ff0000" },
      }),
    );
    const got = readStoredFormat();
    // The override applies.
    expect(got.added.color).toBe("#ff0000");
    // The other axes keep their default values.
    expect(got.added.bold).toBe(DEFAULT_VERSION_COMPARE_FORMAT.added.bold);
    // Other kinds untouched.
    expect(got.deleted).toEqual(DEFAULT_VERSION_COMPARE_FORMAT.deleted);
    expect(got.moved).toEqual(DEFAULT_VERSION_COMPARE_FORMAT.moved);
  });

  it("accepts null colors as 'no override'", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        added: { color: null, background: null },
      }),
    );
    const got = readStoredFormat();
    expect(got.added.color).toBeNull();
    expect(got.added.background).toBeNull();
  });
});

describe("setVersionCompareFormat / patchVersionCompareFormat", () => {
  it("persists a full replacement to localStorage", () => {
    setVersionCompareFormat({
      ...DEFAULT_VERSION_COMPARE_FORMAT,
      added: {
        bold: false,
        italic: true,
        strikethrough: false,
        underline: true,
        color: "#000",
        background: "#fff",
      },
    });
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.added.italic).toBe(true);
    expect(parsed.added.underline).toBe(true);
  });

  it("patch updates only the named kind + axes", () => {
    patchVersionCompareFormat("deleted", { underline: true });
    const got = getVersionCompareFormat();
    expect(got.deleted.underline).toBe(true);
    expect(got.deleted.strikethrough).toBe(
      DEFAULT_VERSION_COMPARE_FORMAT.deleted.strikethrough,
    );
    expect(got.added).toEqual(DEFAULT_VERSION_COMPARE_FORMAT.added);
    expect(got.moved).toEqual(DEFAULT_VERSION_COMPARE_FORMAT.moved);
  });

  it("resetVersionCompareFormat drops persisted overrides", () => {
    patchVersionCompareFormat("added", { color: "#abcdef" });
    expect(getVersionCompareFormat().added.color).toBe("#abcdef");
    resetVersionCompareFormat();
    expect(getVersionCompareFormat()).toEqual(DEFAULT_VERSION_COMPARE_FORMAT);
  });
});

describe("defaults sanity", () => {
  it("added is bold green; deleted is red strikethrough; moved is italic blue", () => {
    expect(DEFAULT_VERSION_COMPARE_FORMAT.added.bold).toBe(true);
    expect(DEFAULT_VERSION_COMPARE_FORMAT.added.color).toMatch(/^#16a34a$/i);
    expect(DEFAULT_VERSION_COMPARE_FORMAT.deleted.strikethrough).toBe(true);
    expect(DEFAULT_VERSION_COMPARE_FORMAT.deleted.color).toMatch(/^#dc2626$/i);
    expect(DEFAULT_VERSION_COMPARE_FORMAT.moved.italic).toBe(true);
    expect(DEFAULT_VERSION_COMPARE_FORMAT.moved.color).toMatch(/^#2563eb$/i);
  });
});
