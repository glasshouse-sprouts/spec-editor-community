/** @vitest-environment jsdom */
/**
 * Slice #41 — ⌘1–9 / Ctrl+1–9 tab-switch listener.
 *
 * Verifies the renderer-side keydown listener:
 *
 *   - Fires `onSelect(N-1)` when ⌘N (or Ctrl+N) is pressed for N=1..9.
 *   - Doesn't fire on plain "1" (no modifier).
 *   - Doesn't fire when typing in an input/textarea.
 *   - Doesn't fire with Shift or Alt added (those collide with native
 *     shortcuts on some platforms).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { useTabSwitchShortcuts } from "../src/renderer/src/state/useTabSwitchShortcuts.js";

afterEach(() => {
  cleanup();
});

void React;

function Probe({ onSelect }: { onSelect: (idx: number) => void }): JSX.Element {
  useTabSwitchShortcuts(onSelect);
  return (
    <div>
      <input data-testid="text-input" />
    </div>
  );
}

function fireMetaKey(opts: {
  key: string;
  code: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  target?: HTMLElement;
}): void {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    code: opts.code,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) {
    opts.target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
}

describe("useTabSwitchShortcuts", () => {
  it("fires for ⌘1 → onSelect(0)", () => {
    const onSelect = vi.fn();
    render(<Probe onSelect={onSelect} />);
    fireMetaKey({ key: "1", code: "Digit1", meta: true });
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("fires for Ctrl+9 → onSelect(8)", () => {
    const onSelect = vi.fn();
    render(<Probe onSelect={onSelect} />);
    fireMetaKey({ key: "9", code: "Digit9", ctrl: true });
    expect(onSelect).toHaveBeenCalledWith(8);
  });

  it("does NOT fire on plain '1' (no modifier)", () => {
    const onSelect = vi.fn();
    render(<Probe onSelect={onSelect} />);
    fireMetaKey({ key: "1", code: "Digit1" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does NOT fire with Shift modifier", () => {
    const onSelect = vi.fn();
    render(<Probe onSelect={onSelect} />);
    fireMetaKey({ key: "1", code: "Digit1", meta: true, shift: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does NOT fire when focus is in an input field", () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(<Probe onSelect={onSelect} />);
    const input = getByTestId("text-input") as HTMLInputElement;
    input.focus();
    // The listener inspects e.target, not document.activeElement, so
    // we need the input to be the event target. fireEvent picks up
    // the focused element.
    fireEvent.keyDown(input, {
      key: "1",
      code: "Digit1",
      metaKey: true,
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
