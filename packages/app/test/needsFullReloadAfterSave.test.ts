/**
 * Tests for the save-flow's "fast merge vs. full reload" predicate.
 *
 * Lives next to its module because the rules are easy to forget and
 * the failure mode is subtle: a save that should have reloaded but
 * took the fast path silently leaves zombie rows in the UI (deleted
 * on disk, still visible in memory). FIX-Zombie 2026-05-11 added
 * the container deletes; this test guards them.
 */
import { describe, expect, it } from "vitest";

import type { EditRequest } from "../src/shared/ipc.js";
import { needsFullReloadAfterSave } from "../src/renderer/src/state/needsFullReloadAfterSave.js";

describe("needsFullReloadAfterSave", () => {
  it("returns false for an empty edit batch", () => {
    expect(needsFullReloadAfterSave([])).toBe(false);
  });

  it("returns false for a plain section body edit (fast path)", () => {
    const edits: EditRequest[] = [
      { target: "workSpec", sectionId: 1, body: "<p>hi</p>" },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(false);
  });

  it("returns false for CP row + title edits (fast path)", () => {
    const edits: EditRequest[] = [
      {
        target: "cpRow",
        rowId: 5,
        field: "subject",
        value: "New subject",
      },
      { target: "cpTitle", controlPlanId: 3, title: "New title" },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(false);
  });

  it("returns true for deleteContract (FIX-Zombie 2026-05-11)", () => {
    const edits: EditRequest[] = [{ target: "deleteContract", id: 1 }];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for deleteWorkArea (FIX-Zombie 2026-05-11)", () => {
    const edits: EditRequest[] = [{ target: "deleteWorkArea", id: 1 }];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for deleteBdb (FIX-Zombie 2026-05-11)", () => {
    const edits: EditRequest[] = [{ target: "deleteBdb", id: 1 }];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true when a delete is mixed in with other edits", () => {
    // Realistic scenario: user fixes a typo in one section AND
    // marks a BDB for deletion before saving.
    const edits: EditRequest[] = [
      { target: "workSpec", sectionId: 1, body: "<p>fixed</p>" },
      { target: "deleteBdb", id: 99 },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for section hierarchy edits", () => {
    const edits: EditRequest[] = [
      {
        target: "sectionCreate",
        specKind: "workSpec",
        specId: 1,
        parentId: null,
        heading: "New section",
        sectionNo: 1,
      },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for PFBB child supplement creates", () => {
    const edits: EditRequest[] = [
      {
        target: "bdbSectionCreate",
        bdbId: 1,
        pfbbSectionId: 10,
        sectionNo: "1.2",
        body: "<p>supplement</p>",
      },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for custom_data writes", () => {
    const edits: EditRequest[] = [
      { target: "customDataSet", key: "foo", valueBase64: "YmFy" },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });

  it("returns true for cpHeaderUpdate", () => {
    const edits: EditRequest[] = [
      { target: "cpHeaderUpdate", headerId: 7, header: "Updated heading" },
    ];
    expect(needsFullReloadAfterSave(edits)).toBe(true);
  });
});
