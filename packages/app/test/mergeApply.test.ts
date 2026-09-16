/**
 * RELOAD-Merge M4 — tests for buildMergedEditMap.
 *
 * Folds winning merge units into an EditMap; we verify the result by
 * flattening it back with `toEditRequestList`.
 */
import { describe, expect, it } from "vitest";

import type { EditRequest, FilePayload } from "../src/shared/ipc.js";
import { hasEdits, toEditRequestList } from "../src/renderer/src/edits.js";
import {
  buildMergedEditMap,
  withMergedValue,
} from "../src/renderer/src/mergeApply.js";
import type { MergeUnit } from "../src/renderer/src/mergeOnReload.js";

function emptyPayload(): FilePayload {
  return {
    path: "/x.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
    customData: [],
  } as FilePayload;
}

let seq = 0;
function unit(
  edit: MergeUnit["edit"],
  theirs: string,
  kind: MergeUnit["kind"] = "sectionBody",
): MergeUnit {
  return {
    key: `k${seq++}`,
    kind,
    label: "L",
    base: "",
    mine: "",
    theirs,
    edit,
  };
}

describe("buildMergedEditMap", () => {
  it("returns an empty map for no winners", () => {
    expect(hasEdits(buildMergedEditMap([], emptyPayload()))).toBe(false);
  });

  it("folds a section-body winner into a body edit", () => {
    const winners = [unit({ target: "bdb", sectionId: 100, body: "A2" }, "A")];
    const list = toEditRequestList(buildMergedEditMap(winners, emptyPayload()));
    expect(list).toEqual([{ target: "bdb", sectionId: 100, body: "A2" }]);
  });

  it("folds a CP-title winner", () => {
    const winners = [
      unit(
        { target: "cpTitle", controlPlanId: 9, title: "New title" },
        "Old title",
        "cpTitle",
      ),
    ];
    const list = toEditRequestList(buildMergedEditMap(winners, emptyPayload()));
    expect(list).toEqual([
      { target: "cpTitle", controlPlanId: 9, title: "New title" },
    ]);
  });

  it("accumulates per-field metadata winners into one entity edit", () => {
    const winners = [
      unit(
        { target: "bdbMetadata", id: 5, name: "New name" },
        "Old name",
        "metaField",
      ),
      unit({ target: "bdbMetadata", id: 5, revision: "r2" }, "r1", "metaField"),
    ];
    const list = toEditRequestList(buildMergedEditMap(winners, emptyPayload()));
    const bdbMeta = list.filter(
      (e): e is Extract<EditRequest, { target: "bdbMetadata" }> =>
        e.target === "bdbMetadata",
    );
    expect(bdbMeta).toHaveLength(1);
    expect(bdbMeta[0]!.id).toBe(5);
    expect(bdbMeta[0]!.name).toBe("New name");
    expect(bdbMeta[0]!.revision).toBe("r2");
  });
});

describe("withMergedValue", () => {
  it("replaces a section body", () => {
    const u = unit({ target: "bdb", sectionId: 7, body: "old" }, "disk");
    const r = withMergedValue(u, "<p>merged</p>");
    expect(r.edit).toEqual({
      target: "bdb",
      sectionId: 7,
      body: "<p>merged</p>",
    });
    expect(r.mine).toBe("<p>merged</p>");
  });

  it("replaces a metadata field value", () => {
    const u = unit(
      { target: "bdbMetadata", id: 3, revision: "old" },
      "disk",
      "metaField",
    );
    const r = withMergedValue(u, "new-rev");
    expect(r.edit).toEqual({
      target: "bdbMetadata",
      id: 3,
      revision: "new-rev",
    });
  });

  it("replaces a CP title", () => {
    const u = unit(
      { target: "cpTitle", controlPlanId: 9, title: "old" },
      "disk",
      "cpTitle",
    );
    const r = withMergedValue(u, "New title");
    expect(r.edit).toEqual({
      target: "cpTitle",
      controlPlanId: 9,
      title: "New title",
    });
  });
});
