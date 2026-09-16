/** @vitest-environment jsdom */
/**
 * RELOAD-3 — useReloadFromDisk.
 *
 * The hook decides between an immediate reload and a discard-confirm
 * dialog, and runs `onBeforeReload` right before the reload itself.
 * `reload` is the real in-place refresh (it resets the edit buffer,
 * so a reload IS a discard) — here it's a spy.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useReloadFromDisk } from "../src/renderer/src/state/useReloadFromDisk.js";

describe("useReloadFromDisk", () => {
  it("reloads immediately when the editor is clean", () => {
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useReloadFromDisk({ canReload: true, dirty: false, reload }),
    );

    act(() => result.current.requestReload());

    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.confirmOpen).toBe(false);
  });

  it("opens the confirm dialog instead of reloading when dirty", () => {
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useReloadFromDisk({ canReload: true, dirty: true, reload }),
    );

    act(() => result.current.requestReload());

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(true);
  });

  it("confirmReload reloads and closes the dialog", () => {
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useReloadFromDisk({ canReload: true, dirty: true, reload }),
    );

    act(() => result.current.requestReload());
    act(() => result.current.confirmReload());

    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.confirmOpen).toBe(false);
  });

  it("cancelReload closes the dialog without reloading", () => {
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useReloadFromDisk({ canReload: true, dirty: true, reload }),
    );

    act(() => result.current.requestReload());
    act(() => result.current.cancelReload());

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("is a no-op when no file is open (canReload false)", () => {
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useReloadFromDisk({ canReload: false, dirty: false, reload }),
    );

    act(() => result.current.requestReload());

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("runs onBeforeReload right before the reload", () => {
    const calls: string[] = [];
    const reload = vi.fn(() => {
      calls.push("reload");
    });
    const onBeforeReload = vi.fn(() => {
      calls.push("onBeforeReload");
    });
    const { result } = renderHook(() =>
      useReloadFromDisk({
        canReload: true,
        dirty: false,
        reload,
        onBeforeReload,
      }),
    );

    act(() => result.current.requestReload());

    expect(onBeforeReload).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["onBeforeReload", "reload"]);
  });
});
