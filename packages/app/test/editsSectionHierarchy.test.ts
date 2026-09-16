/**
 * Slice 10G — edits.ts helpers for section hierarchy (create /
 * rename / delete).
 *
 * Pure-function tests. No DOM, no IPC. Verifies:
 *   - stageSectionCreate appends a new patch with a unique local id
 *   - stageSectionRename drops when heading === original
 *   - stageSectionDelete replaces any pending rename on the same id
 *   - dropSectionCreate removes the right patch by local id
 *   - getEffectiveSectionHeading honours a pending rename
 *   - stagedSectionDeleteIds collects only delete patches for the
 *     matching specKind
 *   - toEditRequestList emits the right EditRequest shapes
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_EDITS,
  dropSectionCreate,
  getEffectiveSectionHeading,
  isSectionTombstoned,
  sectionCreateKey,
  sectionDeleteKey,
  sectionRenameKey,
  stageSectionCreate,
  stageSectionDelete,
  stageSectionRename,
  stagedSectionDeleteIds,
  toEditRequestList,
  type EditPatch,
} from "../src/renderer/src/edits.js";

describe("stageSectionCreate", () => {
  it("adds a patch with a unique local id each call", () => {
    let m = stageSectionCreate(EMPTY_EDITS, {
      specKind: "bdb",
      specId: 5,
      parentId: null,
      insertAfterSectionNo: null,
      heading: "A",
    });
    m = stageSectionCreate(m, {
      specKind: "bdb",
      specId: 5,
      parentId: null,
      insertAfterSectionNo: null,
      heading: "B",
    });
    const creates = Object.values(m).filter(
      (p): p is Extract<EditPatch, { kind: "sectionCreate" }> =>
        p.kind === "sectionCreate",
    );
    expect(creates).toHaveLength(2);
    expect(creates[0]!.localId).not.toBe(creates[1]!.localId);
  });
});

describe("stageSectionRename", () => {
  it("stages a rename patch keyed by (specKind, sectionId)", () => {
    const m = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
      heading: "New heading",
      originalHeading: "Old heading",
    });
    expect(m[sectionRenameKey("bdb", 42)]).toEqual({
      kind: "sectionRename",
      specKind: "bdb",
      sectionId: 42,
      heading: "New heading",
    });
  });

  it("drops the patch when heading matches original", () => {
    let m = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
      heading: "Staged",
      originalHeading: "Original",
    });
    expect(m[sectionRenameKey("bdb", 42)]).toBeDefined();
    m = stageSectionRename(m, {
      specKind: "bdb",
      sectionId: 42,
      heading: "Original",
      originalHeading: "Original",
    });
    expect(m[sectionRenameKey("bdb", 42)]).toBeUndefined();
  });

  it("returns same map when staging an identical rename (stable identity)", () => {
    const m1 = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
      heading: "X",
      originalHeading: "original",
    });
    const m2 = stageSectionRename(m1, {
      specKind: "bdb",
      sectionId: 42,
      heading: "X",
      originalHeading: "original",
    });
    expect(m2).toBe(m1);
  });
});

describe("stageSectionDelete", () => {
  it("stages a delete patch and removes any pending rename on the same id", () => {
    let m = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
      heading: "Typed",
      originalHeading: "Disk",
    });
    expect(m[sectionRenameKey("bdb", 42)]).toBeDefined();
    m = stageSectionDelete(m, { specKind: "bdb", sectionId: 42 });
    expect(m[sectionDeleteKey("bdb", 42)]).toEqual({
      kind: "sectionDelete",
      specKind: "bdb",
      sectionId: 42,
    });
    expect(m[sectionRenameKey("bdb", 42)]).toBeUndefined();
  });

  it("is idempotent on a second call", () => {
    const once = stageSectionDelete(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
    });
    const twice = stageSectionDelete(once, {
      specKind: "bdb",
      sectionId: 42,
    });
    expect(twice).toBe(once);
  });
});

describe("dropSectionCreate", () => {
  it("removes the patch for the given local id", () => {
    const m = stageSectionCreate(EMPTY_EDITS, {
      specKind: "bdb",
      specId: 1,
      parentId: null,
      insertAfterSectionNo: null,
      heading: "A",
    });
    const creates = Object.values(m).filter(
      (p): p is Extract<EditPatch, { kind: "sectionCreate" }> =>
        p.kind === "sectionCreate",
    );
    expect(creates).toHaveLength(1);
    const after = dropSectionCreate(m, creates[0]!.localId);
    expect(after[sectionCreateKey(creates[0]!.localId)]).toBeUndefined();
  });
});

describe("isSectionTombstoned + getEffectiveSectionHeading", () => {
  it("tombstone flag is set after a stageSectionDelete", () => {
    const m = stageSectionDelete(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
    });
    expect(isSectionTombstoned(m, "bdb", 42)).toBe(true);
    expect(isSectionTombstoned(m, "workSpec", 42)).toBe(false);
  });

  it("effective heading honours a pending rename and falls back to original", () => {
    const m = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 42,
      heading: "New",
      originalHeading: "Disk",
    });
    expect(getEffectiveSectionHeading(m, "bdb", 42, "Disk")).toBe("New");
    expect(getEffectiveSectionHeading(m, "bdb", 99, "Untouched")).toBe(
      "Untouched",
    );
  });
});

describe("stagedSectionDeleteIds", () => {
  it("returns only delete ids for the matching specKind", () => {
    let m = stageSectionDelete(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 1,
    });
    m = stageSectionDelete(m, { specKind: "bdb", sectionId: 2 });
    m = stageSectionDelete(m, { specKind: "workSpec", sectionId: 99 });
    const bdbIds = stagedSectionDeleteIds(m, "bdb");
    expect(Array.from(bdbIds).sort()).toEqual([1, 2]);
    const wsIds = stagedSectionDeleteIds(m, "workSpec");
    expect(Array.from(wsIds)).toEqual([99]);
  });
});

describe("toEditRequestList flatten — section hierarchy", () => {
  it("emits sectionCreate / sectionRename / sectionDelete in the expected order", () => {
    let m: ReturnType<typeof stageSectionCreate> = EMPTY_EDITS;
    m = stageSectionCreate(m, {
      specKind: "bdb",
      specId: 1,
      parentId: null,
      insertAfterSectionNo: null,
      heading: "New",
    });
    m = stageSectionRename(m, {
      specKind: "bdb",
      sectionId: 100,
      heading: "Renamed",
      originalHeading: "Old",
    });
    m = stageSectionDelete(m, { specKind: "bdb", sectionId: 200 });
    const list = toEditRequestList(m);
    const targets = list.map((e) => e.target);
    // TARGET_ORDER puts delete < rename < create within the bucket.
    expect(targets).toEqual([
      "sectionDelete",
      "sectionRename",
      "sectionCreate",
    ]);
  });
});
