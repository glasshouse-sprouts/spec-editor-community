/** @vitest-environment jsdom */
/**
 * RELOAD-Merge M5 — tests for the orchestration hook.
 *
 * `useReloadMerge` glues the merge pieces together. We drive it with
 * a stubbed `window.molio.openFile` (the disk re-read) and synthetic
 * base / edits, and assert the dialog state + callbacks.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilePayload, SectionData } from "../src/shared/ipc.js";
import { EMPTY_EDITS, setSectionBody } from "../src/renderer/src/edits.js";
import type { LoadState } from "../src/renderer/src/state/useFileState.js";
import { useReloadMerge } from "../src/renderer/src/state/useReloadMerge.js";

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

function loaded(data: FilePayload): LoadState {
  return { kind: "loaded", data };
}

afterEach(() => {
  // @ts-expect-error — synthetic test bridge
  delete globalThis.window.molio;
});

describe("useReloadMerge", () => {
  it("canMerge reflects whether there are non-structural edits", () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    const edits = setSectionBody(EMPTY_EDITS, "bdb", 100, "mine", "base");

    const withEdits = renderHook(() =>
      useReloadMerge({
        state: loaded(base),
        edits,
        applyMerge: vi.fn(),
        onUnavailable: vi.fn(),
      }),
    );
    expect(withEdits.result.current.canMerge).toBe(true);

    const noEdits = renderHook(() =>
      useReloadMerge({
        state: loaded(base),
        edits: EMPTY_EDITS,
        applyMerge: vi.fn(),
        onUnavailable: vi.fn(),
      }),
    );
    expect(noEdits.result.current.canMerge).toBe(false);
  });

  it("startMerge opens the dialog on an ok plan", async () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    // Disk unchanged → my edit auto-applies, plan is ok.
    const disk = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    // @ts-expect-error — synthetic test bridge
    globalThis.window.molio = { openFile: vi.fn(async () => disk) };
    const edits = setSectionBody(EMPTY_EDITS, "bdb", 100, "mine", "base");

    const { result } = renderHook(() =>
      useReloadMerge({
        state: loaded(base),
        edits,
        applyMerge: vi.fn(),
        onUnavailable: vi.fn(),
      }),
    );

    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.startMerge();
    });
    expect(opened).toBe(true);
    expect(result.current.mergeDialog).not.toBeNull();
    expect(result.current.mergeDialog?.autoApplied).toHaveLength(1);
  });

  it("startMerge reports unavailable + returns false when blocked", async () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    // Disk deleted the section I edited → merge is blocked.
    const disk = payload({ sectionsByBdb: { 5: [] } });
    // @ts-expect-error — synthetic test bridge
    globalThis.window.molio = { openFile: vi.fn(async () => disk) };
    const edits = setSectionBody(EMPTY_EDITS, "bdb", 100, "mine", "base");
    const onUnavailable = vi.fn();

    const { result } = renderHook(() =>
      useReloadMerge({
        state: loaded(base),
        edits,
        applyMerge: vi.fn(),
        onUnavailable,
      }),
    );

    let opened: boolean | undefined;
    await act(async () => {
      opened = await result.current.startMerge();
    });
    expect(opened).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(result.current.mergeDialog).toBeNull();
  });

  it("confirmMerge applies the winners and closes the dialog", async () => {
    const base = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    const disk = payload({ sectionsByBdb: { 5: [section(100, "base")] } });
    // @ts-expect-error — synthetic test bridge
    globalThis.window.molio = { openFile: vi.fn(async () => disk) };
    const edits = setSectionBody(EMPTY_EDITS, "bdb", 100, "mine", "base");
    const applyMerge = vi.fn();

    const { result } = renderHook(() =>
      useReloadMerge({
        state: loaded(base),
        edits,
        applyMerge,
        onUnavailable: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.startMerge();
    });
    act(() => {
      result.current.confirmMerge([]);
    });
    expect(applyMerge).toHaveBeenCalledTimes(1);
    expect(result.current.mergeDialog).toBeNull();
  });
});
