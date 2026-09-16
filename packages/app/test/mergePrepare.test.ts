/** @vitest-environment jsdom */
/**
 * RELOAD-Merge M2 — tests for the merge plumbing.
 *
 * `canOfferMerge` is pure. `prepareMergePlan` re-reads the disk file
 * via `window.molio.openFile`, so we stub that bridge method and run
 * under jsdom (the sanitiser needs a DOM).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EditRequest,
  FilePayload,
  SectionData,
} from "../src/shared/ipc.js";
import {
  canOfferMerge,
  prepareMergePlan,
} from "../src/renderer/src/mergePrepare.js";

function payload(parts: Partial<FilePayload>): FilePayload {
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
    ...parts,
  } as FilePayload;
}

function section(id: number, body: string): SectionData {
  return {
    id,
    sectionNo: id,
    heading: `Section ${id}`,
    body,
    parentId: null,
    pfbbSectionId: null,
  };
}

describe("canOfferMerge", () => {
  it("is false when there are no edits", () => {
    expect(canOfferMerge([])).toBe(false);
  });

  it("is true for section + metadata edits", () => {
    expect(
      canOfferMerge([
        { target: "bdb", sectionId: 1, body: "x" },
        { target: "bdbMetadata", id: 2, name: "y" },
      ]),
    ).toBe(true);
  });

  it("is false when a structural edit is present", () => {
    expect(
      canOfferMerge([
        { target: "bdb", sectionId: 1, body: "x" },
        { target: "sectionDelete", specKind: "bdb", sectionId: 2 },
      ]),
    ).toBe(false);
    expect(
      canOfferMerge([
        { target: "bdb", sectionId: 1, body: "x" },
        { target: "deleteBdb", id: 2 },
      ]),
    ).toBe(false);
  });
});

describe("prepareMergePlan", () => {
  afterEach(() => {
    // @ts-expect-error — synthetic test bridge
    delete globalThis.window.molio;
  });

  it("re-reads the disk file and computes a merge plan", async () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "A")] } });
    const openFile = vi.fn(async () => disk);
    // @ts-expect-error — synthetic test bridge
    globalThis.window.molio = { openFile };

    const edits: EditRequest[] = [
      { target: "bdb", sectionId: 100, body: "A — mine" },
    ];
    const result = await prepareMergePlan(base, edits);

    expect(openFile).toHaveBeenCalledWith(base.path);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.autoApplied).toHaveLength(1);
      expect(result.diskDelta).toEqual({ added: [], removed: [] });
    }
  });

  it("returns load-error when the disk read throws", async () => {
    const base = payload({});
    // @ts-expect-error — synthetic test bridge
    globalThis.window.molio = {
      openFile: vi.fn(async () => {
        throw new Error("file gone");
      }),
    };
    const result = await prepareMergePlan(base, [
      { target: "bdb", sectionId: 1, body: "x" },
    ]);
    expect(result.kind).toBe("load-error");
    if (result.kind === "load-error") {
      expect(result.message).toContain("file gone");
    }
  });
});
