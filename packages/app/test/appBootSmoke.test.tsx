/** @vitest-environment jsdom */
/**
 * Smoke test: the App component renders in its initial idle state
 * without throwing.
 *
 * Why this exists: a Temporal Dead Zone bug (a `useRef` declared
 * AFTER a hook that reads it during initial render) crashed the
 * Welcome screen with a blank window. The bug shipped silently
 * because no other test mounts the full App component — every other
 * test renders individual subcomponents in isolation.
 *
 * This test is intentionally minimal — it asserts only that App
 * renders something, not WHAT it renders. The goal is to catch
 * top-level boot-time crashes (TDZ errors, missing imports, broken
 * hook order). Stricter rendering tests live with their respective
 * components.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { App } from "../src/renderer/src/App.js";

void React;

beforeEach(() => {
  cleanup();
  // Mock the preload bridge that App effects call into. A mock that
  // returns a no-op cleanup function from `onTriggerSaveAndClose` is
  // enough — the actual IPC plumbing isn't exercised here.
  // @ts-expect-error — synthetic fixture
  globalThis.window.molio = {
    setDirty: vi.fn(),
    onTriggerSaveAndClose: vi.fn(() => () => undefined),
    closeWindow: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    saveFileAs: vi.fn(),
    openFileDialog: vi.fn(),
    onMenuAction: vi.fn(() => () => undefined),
    // RELOAD-2 — file watcher bridge. watchActiveFile fires from a
    // mount effect; onFileChangedOnDisk must return a no-op disposer.
    watchActiveFile: vi.fn(),
    onFileChangedOnDisk: vi.fn(() => () => undefined),
    platform: "darwin",
  };
});

describe("App boot smoke test", () => {
  it("renders without throwing in idle state", () => {
    const result = render(<App />);
    // Not asserting against translated strings here — the goal is
    // just "the tree mounted at all". The `.app` root class is
    // present on every render path.
    expect(result.container.querySelector(".app")).toBeTruthy();
  });
});
