/**
 * Slice #41 — central shortcut dispatcher.
 *
 * Smoke-tests the discriminated-union switch in `dispatchMenuAction`
 * to make sure every `MenuAction.kind` routes to the matching
 * handler. The hook itself (`useShortcutHandler`) is a thin
 * subscription wrapper; not testing that here keeps the test free of
 * a JSDOM mount and makes the failure mode obvious — if a new action
 * is added but the dispatcher forgot it, this test catches it as a
 * compile-time exhaustiveness check OR a missing-call assertion.
 */
import { describe, expect, it, vi } from "vitest";

import {
  dispatchMenuAction,
  type ShortcutHandlers,
} from "../src/renderer/src/state/useShortcutHandler.js";

function makeHandlers(): ShortcutHandlers {
  return {
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onCloseTab: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onSettings: vi.fn(),
    onShortcuts: vi.fn(),
    onLoadReference: vi.fn(),
    onOpenRecent: vi.fn(),
    onClearRecent: vi.fn(),
    onReloadFromDisk: vi.fn(),
  };
}

describe("dispatchMenuAction", () => {
  const cases: Array<
    [Parameters<typeof dispatchMenuAction>[0], keyof ShortcutHandlers]
  > = [
    [{ kind: "open" }, "onOpen"],
    [{ kind: "save" }, "onSave"],
    [{ kind: "saveAs" }, "onSaveAs"],
    [{ kind: "closeTab" }, "onCloseTab"],
    [{ kind: "import" }, "onImport"],
    [{ kind: "export" }, "onExport"],
    [{ kind: "settings" }, "onSettings"],
    [{ kind: "shortcuts" }, "onShortcuts"],
    [{ kind: "loadReference" }, "onLoadReference"],
    [{ kind: "openRecent", path: "/tmp/foo.moliospec" }, "onOpenRecent"],
    [{ kind: "clearRecent" }, "onClearRecent"],
    [{ kind: "reloadFromDisk" }, "onReloadFromDisk"],
  ];

  for (const [action, expectedKey] of cases) {
    it(`routes ${action.kind} → ${expectedKey}`, () => {
      const h = makeHandlers();
      dispatchMenuAction(action, h);
      const fn = h[expectedKey] as ReturnType<typeof vi.fn>;
      expect(fn).toHaveBeenCalledTimes(1);
      // Every other handler should not have fired.
      for (const k of Object.keys(h) as (keyof ShortcutHandlers)[]) {
        if (k === expectedKey) continue;
        expect(h[k]).not.toHaveBeenCalled();
      }
    });
  }

  // UX1 — openRecent must forward the path argument so the renderer
  // can route it to openPath().
  it("openRecent forwards the path to onOpenRecent", () => {
    const h = makeHandlers();
    dispatchMenuAction(
      { kind: "openRecent", path: "/Users/me/Specs/foo.moliospec" },
      h,
    );
    expect(h.onOpenRecent).toHaveBeenCalledWith(
      "/Users/me/Specs/foo.moliospec",
    );
  });
});
