/** @vitest-environment jsdom */
/**
 * Task 111 - the contracts list on the project page ("Entrepriser")
 * sorts like the tree in the Sidebar.
 *
 * Before the fix the list was rendered in creation order: one call site
 * that was missed when sorting was centralised in sortHelpers.ts
 * (Slice 10B). These tests fail if the sort disappears again.
 *
 * Covered:
 *   - code order, with "E2" before "E10" (numeric collation)
 *   - rows without a code sink to the bottom
 *   - Danish letters: Æ, Ø, Å sort after Z
 *   - an UNSAVED rename re-sorts at once (effective values, not stored)
 *   - the divider sits between rows, never above the top row
 */

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

void React;

import type { ContractInfo, FilePayload } from "../src/shared/ipc.ts";
import { MainPane } from "../src/renderer/src/MainPane.tsx";

function contract(
  id: number,
  code: string | null,
  name: string | null,
): ContractInfo {
  return { id, contractCode: code, contractName: name };
}

function makePayload(contracts: ContractInfo[]): FilePayload {
  return {
    path: "/tmp/test.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [],
    bdbs: [],
    controlPlans: [],
    contracts,
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
  };
}

/** Same no-op prop factory as mainPaneProjectView.test.tsx. */
function renderProjectView(
  payload: FilePayload,
  overrides: {
    code?: (id: number, o: string | null) => string | null;
    name?: (id: number, o: string | null) => string | null;
  } = {},
): HTMLElement {
  const { container } = render(
    <MainPane
      data={payload}
      target={{ kind: "project" }}
      tocFilter=""
      onTocFilterChange={() => {}}
      tocCollapsedNodeIds={new Set()}
      onTocCollapsedNodeIdsChange={() => {}}
      refSubTab={null}
      onRefSubTabChange={() => {}}
      refPanelCollapsed={false}
      onToggleRefPanelCollapsed={() => {}}
      compactView={false}
      layoutMode="web"
      editedBodyFor={(_k, _id, b) => b}
      onEditBody={() => {}}
      editedCpTitleFor={(_id, t) => t}
      onEditCpTitle={() => {}}
      editedCpRowCellFor={(_id, _f, v) => v}
      onEditCpRowCell={() => {}}
      onRequestAddRow={() => {}}
      onRequestDeleteRow={() => {}}
      effectiveContractCodeFor={overrides.code ?? ((_id, o) => o)}
      effectiveContractNameFor={overrides.name ?? ((_id, o) => o)}
      isContractEditedFor={() => false}
      onRequestNewContract={() => {}}
      onSeedDefaultContracts={() => {}}
      onRequestEditContract={() => {}}
      onRequestDeleteContract={() => {}}
      selection={{ kind: "project" }}
      onSelect={() => {}}
      onDuplicateBdb={() => {}}
      onNewControlPlan={() => {}}
      onDeleteBdb={() => {}}
      onRequestEditBdb={() => {}}
    />,
  );
  return container;
}

function cardLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".contracts-card__list .contracts-card__label"),
  ).map((el) => el.textContent ?? "");
}

describe("ContractsCard sort order (Task 111)", () => {
  it("sorts by code, not creation order, with E2 before E10", () => {
    const c = renderProjectView(
      makePayload([
        contract(1, "E04", "Tag"),
        contract(2, "E10", "Maler"),
        contract(3, "E01", "Jord"),
        contract(4, "E2", "Beton"),
      ]),
    );
    expect(cardLabels(c)).toEqual([
      "E01 - Jord",
      "E2 - Beton",
      "E04 - Tag",
      "E10 - Maler",
    ]);
  });

  it("puts contracts without a code at the bottom, and Æ/Ø/Å after Z", () => {
    const c = renderProjectView(
      makePayload([
        contract(1, null, "Ærø"),
        contract(2, "E02", "Facade"),
        contract(3, null, "Zink"),
        contract(4, null, "Åbning"),
        contract(5, "E01", "Jord"),
        contract(6, null, "Øvrigt"),
      ]),
    );
    expect(cardLabels(c)).toEqual([
      "E01 - Jord",
      "E02 - Facade",
      "Zink",
      "Ærø",
      "Øvrigt",
      "Åbning",
    ]);
  });

  it("sorts on the effective (unsaved) code and name, not the stored ones", () => {
    const payload = makePayload([
      contract(1, "E01", "Jord"),
      contract(2, "E02", "Facade"),
      contract(3, "E04", "Tag"),
    ]);
    // Buffered, unsaved edit: contract 3 gets code "E00".
    const c = renderProjectView(payload, {
      code: (id, o) => (id === 3 ? "E00" : o),
    });
    expect(cardLabels(c)).toEqual(["E00 - Tag", "E01 - Jord", "E02 - Facade"]);
    cleanup();
    // Buffered, unsaved edit of a codeless contract's NAME moves it too.
    const c2 = renderProjectView(
      makePayload([contract(1, null, "Beta"), contract(2, null, "Gamma")]),
      { name: (id, o) => (id === 2 ? "Alfa" : o) },
    );
    expect(cardLabels(c2)).toEqual(["Alfa", "Beta"]);
  });

  it("draws the divider between rows, never above the top row", () => {
    const c = renderProjectView(
      makePayload([
        contract(1, "E04", "Tag"),
        contract(2, "E01", "Jord"),
        contract(3, "E02", "Facade"),
      ]),
    );
    const rows = Array.from(
      c.querySelectorAll(".contracts-card__list .contracts-card__row"),
    );
    expect(rows).toHaveLength(3);
    const hasDivider = rows.map(
      (r) => r.querySelector(".contracts-card__divider") !== null,
    );
    // The top row is E01 (created second) - it must not get a divider.
    expect(rows[0].textContent).toContain("E01 - Jord");
    expect(hasDivider).toEqual([false, true, true]);
  });
});
