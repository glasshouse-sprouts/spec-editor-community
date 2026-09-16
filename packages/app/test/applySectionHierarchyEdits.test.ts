/**
 * Slice 10G — applySectionHierarchyEdits unit tests.
 *
 * Covers:
 *   - No-edits fast path: input array returned with new object
 *     references (heading passed through getEffectiveSectionHeading,
 *     which is a no-op when no rename is pending).
 *   - Rename: heading swapped for staged value.
 *   - Delete (leaf): single section disappears.
 *   - Delete cascades: descendants disappear too.
 *   - specKind filter: a staged delete on the other kind doesn't
 *     leak across.
 */
import { describe, expect, it } from "vitest";

import type { SectionData } from "../src/shared/ipc.ts";
import { applySectionHierarchyEdits } from "../src/renderer/src/applySectionHierarchyEdits.ts";
import {
  EMPTY_EDITS,
  stageSectionDelete,
  stageSectionRename,
} from "../src/renderer/src/edits.ts";

function s(
  id: number,
  parentId: number | null,
  sectionNo: number,
  heading: string,
): SectionData {
  return {
    id,
    parentId,
    sectionNo,
    heading,
    body: "",
    pfbbSectionId: null,
    molioSectionGuid: null,
  };
}

describe("applySectionHierarchyEdits", () => {
  const sections: SectionData[] = [
    s(1, null, 1, "Alpha"),
    s(2, 1, 1, "Alpha-child"),
    s(3, 2, 1, "Alpha-grandchild"),
    s(4, null, 2, "Beta"),
    s(5, 4, 1, "Beta-child"),
  ];

  it("returns sections unchanged when no edits are staged", () => {
    const out = applySectionHierarchyEdits(sections, EMPTY_EDITS, "bdb");
    expect(out).toHaveLength(sections.length);
    expect(out.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("applies a staged rename to the effective heading", () => {
    const edits = stageSectionRename(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 4,
      heading: "Beta renamed",
      originalHeading: "Beta",
    });
    const out = applySectionHierarchyEdits(sections, edits, "bdb");
    expect(out.find((x) => x.id === 4)!.heading).toBe("Beta renamed");
    // Other rows untouched.
    expect(out.find((x) => x.id === 1)!.heading).toBe("Alpha");
  });

  it("tombstones a leaf section and leaves the rest alone", () => {
    const edits = stageSectionDelete(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 5,
    });
    const out = applySectionHierarchyEdits(sections, edits, "bdb");
    expect(out.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it("cascade-tombstones descendants when a non-leaf is deleted", () => {
    const edits = stageSectionDelete(EMPTY_EDITS, {
      specKind: "bdb",
      sectionId: 1,
    });
    const out = applySectionHierarchyEdits(sections, edits, "bdb");
    expect(out.map((x) => x.id)).toEqual([4, 5]);
  });

  it("ignores staged deletes for the other specKind", () => {
    const edits = stageSectionDelete(EMPTY_EDITS, {
      specKind: "workSpec",
      sectionId: 1,
    });
    const out = applySectionHierarchyEdits(sections, edits, "bdb");
    expect(out.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
