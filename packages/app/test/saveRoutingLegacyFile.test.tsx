/** @vitest-environment jsdom */
/**
 * Task 1 / M1 - Save must become "Save as" for an upgraded old file.
 *
 * A file written before schema 01.00.03 is upgraded to 01.00.04 when it
 * is opened. That conversion cannot be undone, and the file on disk is
 * the user's only copy of the old format, so it must never be written
 * back over itself. These tests pin the routing that guarantees that.
 *
 * There are two independent guards and both are covered here:
 *   1. the renderer sees `schemaUpgrade` on the payload and calls
 *      Save As instead of Save;
 *   2. the main process refuses an in-place save of an old file with
 *      `needsSaveAs`, in case the renderer's state is out of date.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FilePayload,
  SaveFileAsResult,
  SaveFileResult,
  SchemaUpgradeInfo,
} from "../src/shared/ipc.js";
import { useFileState } from "../src/renderer/src/state/useFileState.js";

const UPGRADED: SchemaUpgradeInfo = {
  fromVersion: "01.00.00",
  toVersion: "01.00.04",
  losesControlPlanLinks: true,
  droppedControlPlanLinks: 2,
};

function payload(parts: Partial<FilePayload> = {}): FilePayload {
  return {
    path: "/gammelt-projekt.sqlite",
    dbVersion: "01.00.04",
    schemaUpgrade: null,
    mtimeMs: 1,
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

const saveFile = vi.fn<(...args: unknown[]) => Promise<SaveFileResult>>();
const saveFileAs = vi.fn<(...args: unknown[]) => Promise<SaveFileAsResult>>();

beforeEach(() => {
  saveFile.mockReset();
  saveFileAs.mockReset();
  saveFile.mockResolvedValue({ kind: "saved", mtimeMs: 2 });
  saveFileAs.mockResolvedValue({
    kind: "ok",
    path: "/nyt-projekt.moliospec",
    mtimeMs: 3,
  });
  (window as unknown as { molio: unknown }).molio = {
    saveFile,
    saveFileAs,
    openFile: vi.fn(),
    openFileDialog: vi.fn(),
    setDirty: vi.fn(),
    closeWindow: vi.fn(),
    onTriggerSaveAndClose: vi.fn(() => () => undefined),
  };
});

afterEach(() => {
  window.localStorage.clear();
});

/** Mount the hook with a file already loaded. */
function mountWith(data: FilePayload) {
  const hook = renderHook(() => useFileState({}));
  act(() => {
    hook.result.current.setState({ kind: "loaded", data });
  });
  return hook;
}

describe("Save on an upgraded old file", () => {
  it("goes to Save As instead of overwriting the original", async () => {
    const hook = mountWith(payload({ schemaUpgrade: UPGRADED }));

    await act(async () => {
      await hook.result.current.save({ force: false });
    });

    expect(saveFileAs).toHaveBeenCalledTimes(1);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("suggests a .moliospec name even when the old file was a .sqlite", async () => {
    const hook = mountWith(
      payload({ path: "/a/Projekt 2021.sqlite", schemaUpgrade: UPGRADED }),
    );

    await act(async () => {
      await hook.result.current.save({ force: false });
    });

    expect(saveFileAs).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "/a/Projekt 2021.sqlite",
        suggestedName: "Projekt 2021.moliospec",
      }),
    );
  });

  it("stops routing to Save As once the file has been saved anew", async () => {
    const hook = mountWith(payload({ schemaUpgrade: UPGRADED }));

    await act(async () => {
      await hook.result.current.save({ force: false });
    });
    await waitFor(() => {
      const s = hook.result.current.state;
      expect(s.kind === "loaded" && s.data.path).toBe("/nyt-projekt.moliospec");
    });

    // The file on disk is 01.00.04 now, so an ordinary save is correct.
    await act(async () => {
      await hook.result.current.save({ force: false });
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFileAs).toHaveBeenCalledTimes(1);
  });
});

describe("Save on an ordinary file", () => {
  it("saves in place, as before", async () => {
    const hook = mountWith(payload());

    await act(async () => {
      await hook.result.current.save({ force: false });
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFileAs).not.toHaveBeenCalled();
  });
});

describe("when the main process refuses the in-place save", () => {
  it("falls back to Save As", async () => {
    // Renderer state says the file is ordinary - this is the case where
    // only the main-process guard stands between the user and an
    // overwritten original.
    saveFile.mockResolvedValueOnce({
      kind: "needsSaveAs",
      fromVersion: "01.00.01",
    });
    const hook = mountWith(payload());

    await act(async () => {
      await hook.result.current.save({ force: false });
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFileAs).toHaveBeenCalledTimes(1);
  });
});
