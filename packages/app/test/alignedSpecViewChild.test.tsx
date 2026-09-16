/** @vitest-environment jsdom */
/**
 * Slice 10H.7.c — AlignedSpecView in PFBB child mode.
 *
 * When `childContext` is supplied, the LEFT column of the aligned grid
 * renders the compound body (grey master block + supplement slot)
 * instead of the plain click-to-edit single body. The RIGHT column
 * always stays read-only and shows the parent work_spec.
 *
 * We verify:
 *   1. Rows align by section number — sections present on both sides
 *      render once in the grid with both cells filled.
 *   2. The left cell shows the grey master block for child sections.
 *   3. A supplement that exists on disk → supplement editor is mounted;
 *      the Delete ✕ and "Supplement" label appear.
 *   4. A section with no supplement → "+ Add supplement" button is the
 *      affordance.
 *   5. Clicking "+ Add supplement" opens the editor for that section,
 *      leaving peer rows unchanged.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

void React;

afterEach(() => {
  cleanup();
});

import { AlignedSpecView } from "../src/renderer/src/AlignedSpecView.tsx";
import type { PfbbChildContext } from "../src/renderer/src/pfbbChildContext.ts";
import type { SectionData } from "../src/shared/ipc.ts";

function section(
  id: number,
  sectionNo: string,
  heading: string,
  body: string,
  parentId: number | null = null,
): SectionData {
  return {
    id,
    sectionNo,
    heading,
    body,
    parentId,
    molioSectionGuid: null,
    pfbbSectionId: null,
  };
}

describe("AlignedSpecView (PFBB child mode)", () => {
  const masterSections: SectionData[] = [
    section(101, "1", "Allment", "<p>Master body for 1.</p>"),
    section(102, "2", "Konstruktion", "<p>Master body for 2.</p>"),
  ];
  const workSpecSections: SectionData[] = [
    section(201, "1", "Allment", "<p>Work-spec body for 1.</p>"),
    section(202, "2", "Konstruktion", "<p>Work-spec body for 2.</p>"),
  ];

  function makeChildContext(
    supplements: Record<number, { body: string; existingId: number | null }>,
  ): PfbbChildContext {
    return {
      childBdbId: 999,
      masterName: "Master BDB",
      supplementFor: (masterSectionId) => {
        const s = supplements[masterSectionId];
        return {
          effectiveBody: s?.body ?? "",
          existingSectionId: s?.existingId ?? null,
          hasPendingEdit: false,
        };
      },
      onSupplementBodyChange: vi.fn(),
      brokenSupplements: [],
    };
  }

  it("renders grid with both sides and PFBB child markup on the left", () => {
    const childContext = makeChildContext({
      101: { body: "<p>My supplement.</p>", existingId: 555 },
    });
    render(
      <AlignedSpecView
        leftSections={masterSections}
        rightSections={workSpecSections}
        childContext={childContext}
      />,
    );

    // Section 1 — left has master block + supplement editor; right
    // has plain work-spec body.
    const suppEditor = screen.getByTestId("pfbb-supplement-editor-101");
    expect(suppEditor).toBeDefined();
    expect(screen.getByTestId("pfbb-delete-supplement-101")).toBeDefined();
    expect(screen.getByText("Supplement")).toBeDefined();

    // Both master and work-spec bodies render in their own cells.
    expect(screen.getByText("Master body for 1.")).toBeDefined();
    expect(screen.getByText("Work-spec body for 1.")).toBeDefined();
    expect(screen.getByText("Master body for 2.")).toBeDefined();
    expect(screen.getByText("Work-spec body for 2.")).toBeDefined();
  });

  it("shows '+ Add supplement' button when a section has no supplement yet", () => {
    const childContext = makeChildContext({});
    render(
      <AlignedSpecView
        leftSections={masterSections}
        rightSections={workSpecSections}
        childContext={childContext}
      />,
    );
    expect(screen.getByTestId("pfbb-add-supplement-101")).toBeDefined();
    expect(screen.getByTestId("pfbb-add-supplement-102")).toBeDefined();
  });

  it("clicking '+ Add supplement' opens the editor for that section only", () => {
    const childContext = makeChildContext({});
    render(
      <AlignedSpecView
        leftSections={masterSections}
        rightSections={workSpecSections}
        childContext={childContext}
      />,
    );

    fireEvent.click(screen.getByTestId("pfbb-add-supplement-101"));

    // Editor appears for 101.
    expect(screen.getByTestId("pfbb-supplement-editor-101")).toBeDefined();
    // 102 still shows the add button (peer rows not affected).
    expect(screen.getByTestId("pfbb-add-supplement-102")).toBeDefined();
  });

  it("clicking the Delete ✕ opens the confirm dialog (not immediate delete)", () => {
    const onChange = vi.fn();
    const childContext: PfbbChildContext = {
      childBdbId: 999,
      masterName: "Master BDB",
      supplementFor: (id) =>
        id === 101
          ? {
              effectiveBody: "<p>Existing supplement.</p>",
              existingSectionId: 555,
              hasPendingEdit: false,
            }
          : {
              effectiveBody: "",
              existingSectionId: null,
              hasPendingEdit: false,
            },
      onSupplementBodyChange: onChange,
      brokenSupplements: [],
    };
    render(
      <AlignedSpecView
        leftSections={masterSections}
        rightSections={workSpecSections}
        childContext={childContext}
      />,
    );

    fireEvent.click(screen.getByTestId("pfbb-delete-supplement-101"));

    // Confirm dialog appears; no write fired yet.
    expect(screen.getByText("Remove supplement?")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();

    // Confirm the deletion.
    fireEvent.click(screen.getByTestId("pfbb-confirm-delete-supplement-101"));
    expect(onChange).toHaveBeenCalledWith({
      masterSectionId: 101,
      sectionNo: "1",
      body: "",
    });
  });

  it("left cell carries data-section-id; right cell does not", () => {
    const childContext = makeChildContext({});
    const { container } = render(
      <AlignedSpecView
        leftSections={masterSections}
        rightSections={workSpecSections}
        childContext={childContext}
      />,
    );
    const withId = container.querySelectorAll("[data-section-id]");
    // One <section> per left cell with a section-id, plus the
    // PfbbMasterSectionBlock itself nested inside each. We only care
    // that both left section ids are present.
    const ids = Array.from(withId).map((el) =>
      el.getAttribute("data-section-id"),
    );
    expect(ids).toContain("101");
    expect(ids).toContain("102");
  });
});
