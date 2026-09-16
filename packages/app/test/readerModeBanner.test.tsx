/** @vitest-environment jsdom */
/**
 * Phase 8 round 2 — Reader mode banner.
 *
 * Verifies the banner renders only when the provider has reader
 * mode ON. Uses the same provider/hook the production app wires
 * around its tree, so this exercises the actual integration.
 *
 * The i18n layer here is a top-level singleton (no provider), so
 * we just render the component and let it call `useT()` directly.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ReaderModeProvider } from "../src/renderer/src/readerMode/ReaderModeContext.js";
import { ReaderModeBanner } from "../src/renderer/src/readerMode/ReaderModeBanner.js";

void React;

beforeEach(() => cleanup());

describe("ReaderModeBanner", () => {
  it("renders nothing when reader mode is OFF", () => {
    render(
      <ReaderModeProvider value={false}>
        <ReaderModeBanner />
      </ReaderModeProvider>,
    );
    expect(document.querySelector(".reader-mode-banner")).toBeNull();
  });

  it("renders the banner when reader mode is ON", () => {
    render(
      <ReaderModeProvider value={true}>
        <ReaderModeBanner />
      </ReaderModeProvider>,
    );
    const el = document.querySelector(".reader-mode-banner");
    expect(el).not.toBeNull();
    // The translated text is present somewhere in the banner. We
    // don't pin a specific locale — just check there's visible
    // text (so a missing/empty key would fail).
    expect((el?.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("has role=status so screen readers announce it politely", () => {
    render(
      <ReaderModeProvider value={true}>
        <ReaderModeBanner />
      </ReaderModeProvider>,
    );
    const banner = screen.getByRole("status");
    expect(banner.classList.contains("reader-mode-banner")).toBe(true);
  });
});
