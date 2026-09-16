/**
 * Slice 10I.b — edits.ts helpers for file-wide `custom_data` edits.
 *
 * Pure-function tests. No DOM, no IPC. Exercise the set / delete /
 * clear helpers + getEffectiveCustomData and verify the flatten step
 * emits the right EditRequest shape for the save pipeline.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_EDITS,
  clearCustomDataEdit,
  customDataKey,
  deleteCustomDataEdit,
  getEffectiveCustomData,
  setCustomData,
  toEditRequestList,
} from "../src/renderer/src/edits.js";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

describe("setCustomData", () => {
  it("stages a customDataSet patch keyed by `customData:<key>`", () => {
    const m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("bar"),
      originalBase64: null,
    });
    const patch = m[customDataKey("foo")];
    expect(patch).toEqual({
      kind: "customDataSet",
      key: "foo",
      valueBase64: b64("bar"),
    });
  });

  it("replaces a prior set with a newer value", () => {
    let m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("first"),
      originalBase64: null,
    });
    m = setCustomData(m, {
      key: "foo",
      valueBase64: b64("second"),
      originalBase64: null,
    });
    expect(m[customDataKey("foo")]).toMatchObject({
      kind: "customDataSet",
      valueBase64: b64("second"),
    });
  });

  it("drops the pending patch when the typed value matches disk", () => {
    const diskValue = b64("on disk");
    let m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("typed"),
      originalBase64: diskValue,
    });
    expect(m[customDataKey("foo")]).toBeDefined();
    m = setCustomData(m, {
      key: "foo",
      valueBase64: diskValue,
      originalBase64: diskValue,
    });
    expect(m[customDataKey("foo")]).toBeUndefined();
  });

  it("returns the same map when staging an identical set (stable identity)", () => {
    const m1 = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("bar"),
      originalBase64: null,
    });
    const m2 = setCustomData(m1, {
      key: "foo",
      valueBase64: b64("bar"),
      originalBase64: null,
    });
    expect(m2).toBe(m1);
  });
});

describe("deleteCustomDataEdit", () => {
  it("stages a customDataDelete patch when the key has a disk row", () => {
    const m = deleteCustomDataEdit(EMPTY_EDITS, {
      key: "foo",
      hadDiskRow: true,
    });
    expect(m[customDataKey("foo")]).toEqual({
      kind: "customDataDelete",
      key: "foo",
    });
  });

  it("drops a pending set instead of staging delete for never-persisted keys", () => {
    let m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("draft"),
      originalBase64: null,
    });
    m = deleteCustomDataEdit(m, { key: "foo", hadDiskRow: false });
    expect(m[customDataKey("foo")]).toBeUndefined();
  });

  it("is idempotent for an already-staged delete", () => {
    const once = deleteCustomDataEdit(EMPTY_EDITS, {
      key: "foo",
      hadDiskRow: true,
    });
    const twice = deleteCustomDataEdit(once, {
      key: "foo",
      hadDiskRow: true,
    });
    expect(twice).toBe(once);
  });
});

describe("clearCustomDataEdit", () => {
  it("drops the pending patch for the given key", () => {
    const m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("v"),
      originalBase64: null,
    });
    const after = clearCustomDataEdit(m, "foo");
    expect(after[customDataKey("foo")]).toBeUndefined();
  });

  it("is a no-op when no pending patch exists", () => {
    const m = clearCustomDataEdit(EMPTY_EDITS, "foo");
    expect(m).toBe(EMPTY_EDITS);
  });
});

describe("getEffectiveCustomData", () => {
  const disk = [
    { key: "alpha", valueBase64: b64("a"), byteLength: 1 },
    { key: "beta", valueBase64: b64("b"), byteLength: 1 },
  ];

  it("returns disk entries untouched when no edits are pending", () => {
    const effective = getEffectiveCustomData(EMPTY_EDITS, disk);
    expect(effective.map((e) => e.key)).toEqual(["alpha", "beta"]);
    expect(effective.every((e) => e.pendingKind === null)).toBe(true);
  });

  it("folds a pending set over a disk row with pendingKind='set'", () => {
    const m = setCustomData(EMPTY_EDITS, {
      key: "alpha",
      valueBase64: b64("replaced"),
      originalBase64: b64("a"),
    });
    const effective = getEffectiveCustomData(m, disk);
    const alpha = effective.find((e) => e.key === "alpha")!;
    expect(Buffer.from(alpha.valueBase64, "base64").toString("utf8")).toBe(
      "replaced",
    );
    expect(alpha.pendingKind).toBe("set");
  });

  it("adds a pending set to the merged list when the key has no disk row", () => {
    const m = setCustomData(EMPTY_EDITS, {
      key: "gamma",
      valueBase64: b64("new"),
      originalBase64: null,
    });
    const effective = getEffectiveCustomData(m, disk);
    expect(effective.map((e) => e.key).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    const gamma = effective.find((e) => e.key === "gamma")!;
    expect(gamma.pendingKind).toBe("set");
  });

  it("filters out pending deletes from the merged list", () => {
    const m = deleteCustomDataEdit(EMPTY_EDITS, {
      key: "alpha",
      hadDiskRow: true,
    });
    const effective = getEffectiveCustomData(m, disk);
    expect(effective.map((e) => e.key)).toEqual(["beta"]);
  });

  it("sorts the output by key for stable render order", () => {
    const effective = getEffectiveCustomData(EMPTY_EDITS, [
      { key: "zeta", valueBase64: b64("z"), byteLength: 1 },
      { key: "alpha", valueBase64: b64("a"), byteLength: 1 },
      { key: "mango", valueBase64: b64("m"), byteLength: 1 },
    ]);
    expect(effective.map((e) => e.key)).toEqual(["alpha", "mango", "zeta"]);
  });
});

describe("toEditRequestList flatten — custom_data", () => {
  it("emits a customDataSet EditRequest for each pending set", () => {
    const m = setCustomData(EMPTY_EDITS, {
      key: "foo",
      valueBase64: b64("v"),
      originalBase64: null,
    });
    const list = toEditRequestList(m);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      target: "customDataSet",
      key: "foo",
      valueBase64: b64("v"),
    });
  });

  it("emits a customDataDelete EditRequest for each pending delete", () => {
    const m = deleteCustomDataEdit(EMPTY_EDITS, {
      key: "foo",
      hadDiskRow: true,
    });
    const list = toEditRequestList(m);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      target: "customDataDelete",
      key: "foo",
    });
  });
});
