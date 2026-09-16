/** @vitest-environment jsdom */
/**
 * Task 1 / M1 - the notice shown after an old file has been upgraded.
 *
 * What is worth pinning here is not the markup but the promises the
 * dialog makes to the user, because code elsewhere has to keep them:
 * the original file is untouched, saving writes a new file, and
 * control-plan links are mentioned exactly when they are affected.
 *
 * Locale note: test/setup.ts pins the suite to English, so the Danish
 * copy is exercised explicitly where it matters and reset afterwards.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SchemaUpgradeInfo } from "../src/shared/ipc.js";
import { setLocale } from "../src/renderer/src/i18n/i18n.js";
import { SchemaUpgradeModal } from "../src/renderer/src/modals/SchemaUpgradeModal.js";

// The test build uses the classic JSX runtime — React must be in scope.
void React;

function info(parts: Partial<SchemaUpgradeInfo> = {}): SchemaUpgradeInfo {
  return {
    fromVersion: "01.00.01",
    toVersion: "01.00.04",
    losesControlPlanLinks: false,
    droppedControlPlanLinks: 0,
    ...parts,
  };
}

/** Render the dialog and return everything it says, as one string. */
function textOf(parts: Partial<SchemaUpgradeInfo> = {}): string {
  render(<SchemaUpgradeModal info={info(parts)} onClose={() => undefined} />);
  return screen.getByRole("dialog").textContent ?? "";
}

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("SchemaUpgradeModal", () => {
  it("names both versions so the user can see what changed", () => {
    const text = textOf();
    expect(text).toContain("01.00.01");
    expect(text).toContain("01.00.04");
  });

  it("promises the original file is left alone", () => {
    // The wording may be edited; the promise may not quietly disappear.
    expect(textOf()).toMatch(/original file/i);
  });

  it("says saving produces a new file", () => {
    expect(textOf()).toMatch(/new file/i);
  });

  it("says nothing about control plans for a 01.00.01 file", () => {
    expect(textOf()).not.toMatch(/control plan/i);
  });

  it("reports how many control-plan links were dropped", () => {
    const text = textOf({
      fromVersion: "01.00.00",
      losesControlPlanLinks: true,
      droppedControlPlanLinks: 2,
    });
    expect(text).toMatch(/control plan/i);
    expect(text).toContain("2");
  });

  it("uses the singular when exactly one link was dropped", () => {
    const text = textOf({
      fromVersion: "01.00.00",
      losesControlPlanLinks: true,
      droppedControlPlanLinks: 1,
    });
    expect(text).toMatch(/One link/);
  });

  it("reassures rather than warns when the file had no links", () => {
    const text = textOf({
      fromVersion: "01.00.00",
      losesControlPlanLinks: true,
      droppedControlPlanLinks: 0,
    });
    expect(text).toMatch(/nothing is lost/i);
  });

  it("has one way out, and it works", () => {
    const onClose = vi.fn();
    render(<SchemaUpgradeModal info={info()} onClose={onClose} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape like the other dialogs", () => {
    const onClose = vi.fn();
    render(<SchemaUpgradeModal info={info()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has real Danish copy, not English with a translated button", () => {
    setLocale("da");
    const text = textOf({
      fromVersion: "01.00.00",
      losesControlPlanLinks: true,
      droppedControlPlanLinks: 2,
    });
    expect(text).toMatch(/ældre format/);
    expect(text).toMatch(/oprindelige fil/);
    expect(text).toMatch(/kontrolplaner/i);
    expect(text).not.toMatch(/older format/i);
  });
});
