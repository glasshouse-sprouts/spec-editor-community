/** @vitest-environment jsdom */
/**
 * Slice 10H.7 Commit 3 — PfbbMasterSectionBlock rendering tests.
 *
 * The block is presentational (no state, no effects). We assert:
 *  - the section number + heading render as expected
 *  - non-empty body HTML is sanitised then injected via
 *    dangerouslySetInnerHTML
 *  - empty / null body falls through to the "(no master content)"
 *    placeholder
 *  - the block carries the read-only tooltip + the masterSectionId
 *    data attribute the enclosing merged view will use
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

void React;

afterEach(() => {
  cleanup();
});

import { PfbbMasterSectionBlock } from "../src/renderer/src/PfbbMasterSectionBlock.tsx";

describe("PfbbMasterSectionBlock", () => {
  it("renders the section number, heading, and sanitised body", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo="1.2.3"
        heading="Fundamenter"
        body="<p>Use 25 mm plaster.</p>"
        masterSectionId={42}
      />,
    );
    expect(screen.getByText("1.2.3")).toBeDefined();
    expect(screen.getByText("Fundamenter")).toBeDefined();
    const body = screen.getByTestId("pfbb-master-section-block-body");
    expect(body.innerHTML).toBe("<p>Use 25 mm plaster.</p>");
  });

  it("shows the '(no master content)' placeholder when body is empty", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo="1.2"
        heading="Beton"
        body=""
        masterSectionId={7}
      />,
    );
    expect(screen.getByTestId("pfbb-master-section-block-empty")).toBeDefined();
    expect(screen.queryByTestId("pfbb-master-section-block-body")).toBeNull();
  });

  it("shows the placeholder when body is null", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo="1.2"
        heading="Beton"
        body={null}
        masterSectionId={7}
      />,
    );
    expect(screen.getByTestId("pfbb-master-section-block-empty")).toBeDefined();
  });

  it("omits the section number and heading when both are absent", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo={null}
        heading={null}
        body="<p>body</p>"
        masterSectionId={9}
      />,
    );
    const block = screen.getByTestId("pfbb-master-section-block");
    // Header region is present but has no text
    const header = block.querySelector(".master-section-block__header");
    expect(header?.textContent).toBe("");
  });

  it("strips disallowed HTML (e.g. <script>) via sanitizeBody", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo="1.1"
        heading="Safe"
        body='<p>ok</p><script>alert("xss")</script>'
        masterSectionId={11}
      />,
    );
    const body = screen.getByTestId("pfbb-master-section-block-body");
    expect(body.innerHTML).toContain("<p>ok</p>");
    expect(body.innerHTML).not.toContain("<script>");
    expect(body.innerHTML).not.toContain("alert");
  });

  it("carries masterSectionId as a data attribute and a read-only tooltip", () => {
    render(
      <PfbbMasterSectionBlock
        sectionNo="1"
        heading="h"
        body="<p>b</p>"
        masterSectionId={123}
      />,
    );
    const block = screen.getByTestId("pfbb-master-section-block");
    expect(block.getAttribute("data-master-section-id")).toBe("123");
    expect(block.getAttribute("title") ?? "").toMatch(
      /text lives on the master/i,
    );
    expect(block.getAttribute("aria-label") ?? "").toMatch(/master section/i);
  });
});
