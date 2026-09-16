/** @vitest-environment jsdom */
/**
 * Slice 10H.11 / #235 — PfbbBrokenSupplementsBanner tests.
 *
 * Verifies:
 *   - Zero broken rows → component renders nothing (returns null).
 *   - Non-zero → banner shows the count, collapsed by default.
 *   - Click the summary → list expands with one row per broken entry
 *     showing label + reason.
 *   - Delete on a row requires a two-click confirm; the second click
 *     fires `onDeleteBroken(sectionId)` exactly once.
 *   - Reason string distinguishes "no master link" (null
 *     pfbbSectionId) vs. "master section #N no longer exists".
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

void React;

afterEach(() => {
  cleanup();
});

import { PfbbBrokenSupplementsBanner } from "../src/renderer/src/PfbbBrokenSupplementsBanner.tsx";
import type { SectionData } from "../src/shared/ipc.ts";

function s(
  id: number,
  sectionNo: string | null,
  heading: string | null,
  pfbbSectionId: number | null,
): SectionData {
  return {
    id,
    parentId: null,
    sectionNo,
    heading,
    body: "",
    pfbbSectionId,
    molioSectionGuid: null,
  };
}

describe("PfbbBrokenSupplementsBanner", () => {
  it("renders nothing when there are no broken rows", () => {
    const { container } = render(
      <PfbbBrokenSupplementsBanner broken={[]} onDeleteBroken={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the count and stays collapsed on first render", () => {
    render(
      <PfbbBrokenSupplementsBanner
        broken={[s(1, "1.2", "Foo", 99), s(2, "1.3", "Bar", null)]}
        onDeleteBroken={() => {}}
      />,
    );
    expect(screen.getByText(/2 broken supplements/)).toBeDefined();
    // List is NOT rendered while collapsed.
    expect(screen.queryByTestId("pfbb-broken-row-1")).toBeNull();
  });

  it("expands on click to show one row per broken entry with reason", () => {
    render(
      <PfbbBrokenSupplementsBanner
        broken={[s(1, "1.2", "Foo", 99), s(2, "1.3", "Bar", null)]}
        onDeleteBroken={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("pfbb-broken-banner-toggle"));
    expect(screen.getByTestId("pfbb-broken-row-1")).toBeDefined();
    expect(screen.getByTestId("pfbb-broken-row-2")).toBeDefined();
    // Each reason string reflects the cause.
    expect(
      screen.getByText(/Master section #99 no longer exists/),
    ).toBeDefined();
    expect(screen.getByText(/No master link/)).toBeDefined();
  });

  it("requires a two-click confirm to fire onDeleteBroken", () => {
    const onDelete = vi.fn();
    render(
      <PfbbBrokenSupplementsBanner
        broken={[s(42, "2.5", "Orphan", 999)]}
        onDeleteBroken={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("pfbb-broken-banner-toggle"));
    // First click = reveal confirm buttons. No call yet.
    fireEvent.click(screen.getByTestId("pfbb-broken-delete-42"));
    expect(onDelete).not.toHaveBeenCalled();
    // Second click = confirm. Fires once with the row id.
    fireEvent.click(screen.getByTestId("pfbb-broken-confirm-delete-42"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(42);
  });

  it("singular label when there's exactly one broken row", () => {
    render(
      <PfbbBrokenSupplementsBanner
        broken={[s(1, "1.2", "Only one", 77)]}
        onDeleteBroken={() => {}}
      />,
    );
    expect(screen.getByText(/1 broken supplement — click/)).toBeDefined();
  });
});
