/**
 * Slice 10H.1 — pill badge tests.
 *
 * Locks in the rendering rules for the two sidebar pill helpers:
 *
 *   PfbbPill         — master ("PFBB") vs child ("↪ PFBB") vs nothing
 *   WorkAreaTypePill — Fælles / Paradigme / nothing (for work_area_type
 *                      1, 2, 0 respectively)
 *
 * Uses renderToStaticMarkup — the pills are pure JSX (no state, no
 * effects) so there's no need to mount a real DOM.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// React import above is required because vitest does not run a JSX
// runtime transform for this test — the `<Pill />` syntax compiles to
// `React.createElement(...)` and needs `React` in scope.
void React;

import type { BdbInfo, WorkSpecInfo } from "../src/shared/ipc.ts";
// Import .tsx source directly — see sibling test for rationale.
import { PfbbPill, WorkAreaTypePill } from "../src/renderer/src/Sidebar.tsx";

function makeBdb(overrides: Partial<BdbInfo>): BdbInfo {
  // Minimal BdbInfo stub — only the fields the pill reads matter.
  // Other required fields are filled with neutral defaults so the type
  // stays honest but nothing else interferes with the test.
  return {
    id: 1,
    name: "test",
    workSpecId: null,
    isPfbb: false,
    pfbbId: null,
    revision: null,
    revisionDate: null,
    controlPlanIds: [],
    refs: {
      basisGuid: null,
      basisRevisionGuid: null,
      paradigmGuid: null,
      paradigmRevisionGuid: null,
      referencelistArea: null,
      referencelistAreaDate: null,
    },
    createdBy: null,
    createdByOrganization: null,
    issueDate: null,
    reviewedBy: null,
    approvedBy: null,
    locked: {
      molioSpecRevisionNo: null,
      molioSpecRevisionDate: null,
      controlplanDesignId: null,
      controlplanProductionId: null,
      commonControlplanDesignGuid: null,
      commonControlplanProductionGuid: null,
      molioConstructionElementSpecGuid: null,
      molioConstructionElementSpecRevisionGuid: null,
      molioConstructionElementSpecRevisionNo: null,
      molioConstructionElementSpecRevisionDate: null,
    },
    ...overrides,
  };
}

function makeWorkSpec(type: number): WorkSpecInfo {
  return {
    id: 1,
    workAreaCode: "S100.01",
    workAreaName: "test",
    workAreaType: type,
    revision: null,
    revisionDate: null,
    contractId: null,
    refs: {
      basisGuid: null,
      basisRevisionGuid: null,
      paradigmGuid: null,
      paradigmRevisionGuid: null,
      referencelistArea: null,
      referencelistAreaDate: null,
    },
    createdBy: null,
    createdByOrganization: null,
    issueDate: null,
    reviewedBy: null,
    approvedBy: null,
    locked: {
      molioSpecRevisionNo: null,
      molioSpecRevisionDate: null,
    },
  };
}

describe("PfbbPill", () => {
  it("renders a 'PFBB' master chip when isPfbb is true", () => {
    const markup = renderToStaticMarkup(
      <PfbbPill bdb={makeBdb({ isPfbb: true })} />,
    );
    expect(markup).toContain("pill--master");
    expect(markup).toContain("PFBB");
    // Child glyph must NOT appear on master chips.
    expect(markup).not.toContain("↪");
  });

  it("renders a '↪ PFBB' child chip when pfbbId is set", () => {
    const markup = renderToStaticMarkup(
      <PfbbPill bdb={makeBdb({ pfbbId: 42 })} />,
    );
    expect(markup).toContain("pill--child");
    expect(markup).toContain("↪ PFBB");
  });

  it("prefers master over child when the data is inconsistent", () => {
    // Schema convention: is_pfbb and pfbb_id are mutually exclusive.
    // If both are set we surface the master pill so the mis-shape is
    // visible rather than silently rendering a child chip.
    const markup = renderToStaticMarkup(
      <PfbbPill bdb={makeBdb({ isPfbb: true, pfbbId: 99 })} />,
    );
    expect(markup).toContain("pill--master");
    expect(markup).not.toContain("pill--child");
  });

  it("renders nothing for a regular BDB", () => {
    const markup = renderToStaticMarkup(<PfbbPill bdb={makeBdb({})} />);
    expect(markup).toBe("");
  });
});

describe("WorkAreaTypePill", () => {
  it("renders nothing for work_area_type = 0 (default arbejdsbeskrivelse)", () => {
    const markup = renderToStaticMarkup(
      <WorkAreaTypePill workSpec={makeWorkSpec(0)} />,
    );
    expect(markup).toBe("");
  });

  it("renders a 'Fælles' chip for work_area_type = 1", () => {
    const markup = renderToStaticMarkup(
      <WorkAreaTypePill workSpec={makeWorkSpec(1)} />,
    );
    expect(markup).toContain("pill--faelles");
    expect(markup).toContain("Fælles");
  });

  it("renders a 'Paradigme' chip for work_area_type = 2", () => {
    const markup = renderToStaticMarkup(
      <WorkAreaTypePill workSpec={makeWorkSpec(2)} />,
    );
    expect(markup).toContain("pill--paradigme");
    expect(markup).toContain("Paradigme");
  });
});
