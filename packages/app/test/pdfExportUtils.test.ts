/**
 * Tests for shared/pdfExportUtils — collision-safe filename helpers
 * used on both sides of the batch-export IPC boundary (Phase 7.3).
 */

import { describe, expect, it } from "vitest";

import {
  dedupeAgainstDisk,
  dedupeFileBases,
} from "../src/shared/pdfExportUtils.js";

describe("dedupeFileBases", () => {
  it("leaves non-colliding names alone", () => {
    expect(dedupeFileBases(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("suffixes duplicates with -1, -2, …", () => {
    expect(dedupeFileBases(["A", "B", "A", "A"])).toEqual([
      "A",
      "B",
      "A-1",
      "A-2",
    ]);
  });

  it("preserves input order", () => {
    expect(dedupeFileBases(["b", "a", "b", "a"])).toEqual([
      "b",
      "a",
      "b-1",
      "a-1",
    ]);
  });

  it("coerces empty strings to 'export'", () => {
    expect(dedupeFileBases(["", "", "A"])).toEqual(["export", "export-1", "A"]);
  });

  it("skips suffix slots that are already taken within the batch", () => {
    // The user already has "A-1" named explicitly; the second "A" should
    // jump to "A-2" so it doesn't clobber the earlier entry.
    expect(dedupeFileBases(["A", "A-1", "A"])).toEqual(["A", "A-1", "A-2"]);
  });
});

describe("dedupeAgainstDisk", () => {
  it("treats disk names as if they came first", () => {
    const onDisk = new Set(["Report", "Summary"]);
    expect(dedupeAgainstDisk(["Report", "Note"], onDisk)).toEqual([
      "Report-1",
      "Note",
    ]);
  });

  it("keeps bumping when suffixes also exist on disk", () => {
    const onDisk = new Set(["A", "A-1", "A-2"]);
    expect(dedupeAgainstDisk(["A", "A"], onDisk)).toEqual(["A-3", "A-4"]);
  });

  it("dedupes inside the batch + against disk together", () => {
    const onDisk = new Set(["A"]);
    // First "A" collides with disk → A-1. Second "A" must not clobber A-1.
    expect(dedupeAgainstDisk(["A", "A"], onDisk)).toEqual(["A-1", "A-2"]);
  });

  it("empty disk is equivalent to dedupeFileBases", () => {
    const names = ["A", "B", "A", "A"];
    expect(dedupeAgainstDisk(names, new Set())).toEqual(dedupeFileBases(names));
  });

  it("coerces empty strings to 'export' just like the base helper", () => {
    const onDisk = new Set(["export"]);
    expect(dedupeAgainstDisk(["", ""], onDisk)).toEqual([
      "export-1",
      "export-2",
    ]);
  });
});
