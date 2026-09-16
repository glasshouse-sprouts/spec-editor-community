/**
 * Slice 10H.7 Commit 2 — edits.ts helpers for PFBB child supplements.
 *
 * Pure-function tests. No DOM, no IPC. Exercise every decision
 * branch in `setBdbSectionSupplement` + the adjoining effective /
 * isEdited / clear helpers, and round-trip through
 * `toEditRequestList` to confirm the flatten step emits the right
 * `EditRequest` shapes.
 */
import { describe, expect, it } from "vitest";

import {
  bdbSectionCreateKey,
  bdbSectionDeleteKey,
  clearBdbSectionSupplementEdit,
  EMPTY_EDITS,
  getEffectiveBdbSupplementBody,
  isBdbSupplementEdited,
  setBdbSectionSupplement,
  stageBdbSectionDelete,
  toEditRequestList,
} from "../src/renderer/src/edits.js";

const child = 7;
const masterSection = 42;
const sectionNo = "1.2";

describe("setBdbSectionSupplement", () => {
  it("stages a create when a new-this-session supplement gets non-empty body", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    expect(m[bdbSectionCreateKey(child, masterSection)]).toEqual({
      kind: "bdbSectionCreate",
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
    });
  });

  it("drops the pending create when a new supplement is cleared to empty", () => {
    const m1 = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    const m2 = setBdbSectionSupplement(m1, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: null,
      originalBody: null,
    });
    expect(bdbSectionCreateKey(child, masterSection) in m2).toBe(false);
  });

  it("stages an upsert (not a second row) when a persisted supplement gets edited", () => {
    // existingSectionId=99 → supplement is already on disk.
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>edit</p>",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    // We still use `bdbSectionCreate` — core treats it as an upsert
    // per its own comment in pfbbWorkSpec.ts.
    expect(m[bdbSectionCreateKey(child, masterSection)]?.kind).toBe(
      "bdbSectionCreate",
    );
  });

  it("stages a delete when a persisted supplement is cleared to empty", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    expect(m[bdbSectionDeleteKey(99)]).toEqual({
      kind: "bdbSectionDelete",
      sectionId: 99,
    });
  });

  it("drops the pending delete if the user types content back in", () => {
    const cleared = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    const retyped = setBdbSectionSupplement(cleared, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>again</p>",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    expect(bdbSectionDeleteKey(99) in retyped).toBe(false);
    expect(retyped[bdbSectionCreateKey(child, masterSection)]?.kind).toBe(
      "bdbSectionCreate",
    );
  });

  it("drops a stale create patch when the typed body matches disk again", () => {
    // Regression guard — the dirty-dot-stays-after-save bug in 10H.7
    // Commit 5. Scenario: the user opens a persisted supplement, TipTap
    // mounts and fires onChange with a slightly-normalised copy of the
    // initial HTML (or the user types + deletes back to disk state).
    // We should NOT leave a stale create patch in the map.
    const staged = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>typed</p>",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    // Confirms we did stage something.
    expect(bdbSectionCreateKey(child, masterSection) in staged).toBe(true);

    // Now the user reverts back to the disk body.
    const reverted = setBdbSectionSupplement(staged, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>disk</p>",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    // Patch should be gone — no dirty dot.
    expect(bdbSectionCreateKey(child, masterSection) in reverted).toBe(false);
    expect(bdbSectionDeleteKey(99) in reverted).toBe(false);
  });

  it("does not stage anything when a new-session editor mounts with null disk and empty body", () => {
    // Covers the "TipTap emits onChange immediately with "" on mount for
    // a brand-new 'Add supplement' editor" case. Empty + no disk means
    // nothing to save.
    const out = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: null,
      originalBody: null,
    });
    expect(out).toBe(EMPTY_EDITS);
  });

  it("returns the same map reference when nothing changed", () => {
    // Writing the same body twice shouldn't churn identity.
    const m1 = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    const m2 = setBdbSectionSupplement(m1, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    expect(m2).toBe(m1);
  });
});

describe("clearBdbSectionSupplementEdit", () => {
  it("drops pending create + delete patches for the given pair", () => {
    // Stage a create…
    let m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    m = clearBdbSectionSupplementEdit(m, {
      bdbId: child,
      pfbbSectionId: masterSection,
      existingSectionId: null,
      originalBody: null,
    });
    expect(bdbSectionCreateKey(child, masterSection) in m).toBe(false);
  });

  it("is a no-op when nothing is staged", () => {
    const out = clearBdbSectionSupplementEdit(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      existingSectionId: null,
      originalBody: null,
    });
    expect(out).toBe(EMPTY_EDITS);
  });
});

describe("getEffectiveBdbSupplementBody", () => {
  it("returns originalBody when no edit is pending", () => {
    expect(
      getEffectiveBdbSupplementBody(EMPTY_EDITS, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: 99,
        originalBody: "<p>disk</p>",
        originalBody: "<p>disk</p>",
      }),
    ).toBe("<p>disk</p>");
  });

  it("returns empty string for an unpopulated null-original", () => {
    expect(
      getEffectiveBdbSupplementBody(EMPTY_EDITS, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: null,
        originalBody: null,
        originalBody: null,
      }),
    ).toBe("");
  });

  it("returns the pending create body when staged", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>staged</p>",
      existingSectionId: null,
      originalBody: null,
    });
    expect(
      getEffectiveBdbSupplementBody(m, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: null,
        originalBody: null,
        originalBody: null,
      }),
    ).toBe("<p>staged</p>");
  });

  it("returns empty string when a persisted supplement is staged for delete", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    expect(
      getEffectiveBdbSupplementBody(m, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: 99,
        originalBody: "<p>disk</p>",
        originalBody: "<p>disk</p>",
      }),
    ).toBe("");
  });
});

describe("isBdbSupplementEdited", () => {
  it("false when no patches exist", () => {
    expect(
      isBdbSupplementEdited(EMPTY_EDITS, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: null,
        originalBody: null,
      }),
    ).toBe(false);
  });

  it("true when a create is pending", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    expect(
      isBdbSupplementEdited(m, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: null,
        originalBody: null,
      }),
    ).toBe(true);
  });

  it("true when a delete is pending", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    expect(
      isBdbSupplementEdited(m, {
        bdbId: child,
        pfbbSectionId: masterSection,
        existingSectionId: 99,
        originalBody: "<p>disk</p>",
      }),
    ).toBe(true);
  });
});

describe("toEditRequestList: 10H.7 supplement flattening", () => {
  it("emits a bdbSectionCreate EditRequest", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    const list = toEditRequestList(m);
    expect(list).toEqual([
      {
        target: "bdbSectionCreate",
        bdbId: child,
        pfbbSectionId: masterSection,
        sectionNo,
        body: "<p>hi</p>",
      },
    ]);
  });

  it("emits a bdbSectionDelete EditRequest when a persisted row is cleared", () => {
    const m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "",
      existingSectionId: 99,
      originalBody: "<p>disk</p>",
    });
    const list = toEditRequestList(m);
    expect(list).toEqual([{ target: "bdbSectionDelete", sectionId: 99 }]);
  });

  it("sorts creates before deletes when both are present in one save", () => {
    // Two different children, one creates, one deletes.
    let m = setBdbSectionSupplement(EMPTY_EDITS, {
      bdbId: child,
      pfbbSectionId: masterSection,
      sectionNo,
      body: "<p>hi</p>",
      existingSectionId: null,
      originalBody: null,
    });
    m = setBdbSectionSupplement(m, {
      bdbId: 8,
      pfbbSectionId: 43,
      sectionNo: "1.3",
      body: "",
      existingSectionId: 100,
      originalBody: "<p>persisted</p>",
    });
    const list = toEditRequestList(m);
    expect(list.map((e) => e.target)).toEqual([
      "bdbSectionCreate",
      "bdbSectionDelete",
    ]);
  });
});

// ---- stageBdbSectionDelete (#235 broken-supplement cleanup) --------

describe("stageBdbSectionDelete", () => {
  it("adds a bdbSectionDelete patch keyed by sectionId", () => {
    const m = stageBdbSectionDelete(EMPTY_EDITS, 555);
    const key = bdbSectionDeleteKey(555);
    expect(m[key]).toEqual({ kind: "bdbSectionDelete", sectionId: 555 });
  });

  it("is idempotent — staging the same delete twice returns the same map", () => {
    const once = stageBdbSectionDelete(EMPTY_EDITS, 42);
    const twice = stageBdbSectionDelete(once, 42);
    expect(twice).toBe(once);
  });

  it("flattens to a single bdbSectionDelete EditRequest", () => {
    const m = stageBdbSectionDelete(EMPTY_EDITS, 77);
    const list = toEditRequestList(m);
    expect(list).toHaveLength(1);
    expect(list[0]!.target).toBe("bdbSectionDelete");
  });
});
