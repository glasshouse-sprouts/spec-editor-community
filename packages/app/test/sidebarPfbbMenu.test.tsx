/** @vitest-environment jsdom */
/**
 * Slice 10H.5 — right-click menu regression.
 *
 * Locks down that when a BDB is a PFBB master (`isPfbb: true`) the
 * right-click menu exposes "Create PFBB child…". This path had ZERO
 * coverage before, and the user reported the item was missing even
 * when the master pill was visible — so this test exists specifically
 * to reproduce that gap.
 *
 * What's tested:
 *  - For a PFBB master BDB, the menu shows "Create PFBB child…" AND
 *    clicking it calls the `onCreatePfbbChild(bdbId)` handler.
 *  - For a regular BDB, the menu does NOT show that item.
 *  - For a PFBB child (pfbbId != null, isPfbb false), the item is
 *    ALSO hidden — children can't spawn further children.
 *
 * The test mounts Sidebar with a minimal FilePayload and fires a
 * contextmenu event on the BDB row's button. It then asserts against
 * the menu DOM. React Testing Library handles state updates so we can
 * observe the menu that `setContextMenu` reveals.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  cleanup,
} from "@testing-library/react";

// Explicit cleanup — vitest's auto-cleanup only kicks in when the
// `@testing-library/jest-dom` import is picked up in a setup file.
// Mounting Sidebar leaves a fixed-position context menu in document.body
// that would otherwise leak between tests and cause "multiple elements"
// errors further down.
afterEach(() => {
  cleanup();
});

// React must be in scope because the JSX transform compiles to
// React.createElement for this test file.
void React;

import type { BdbInfo, FilePayload, WorkSpecInfo } from "../src/shared/ipc.ts";
import { Sidebar } from "../src/renderer/src/Sidebar.tsx";

function makeBdb(
  overrides: Partial<BdbInfo> & Pick<BdbInfo, "id" | "name">,
): BdbInfo {
  return {
    workSpecId: 10,
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

function makeWorkSpec(): WorkSpecInfo {
  return {
    id: 10,
    workAreaCode: "S100.01",
    workAreaName: "Test work area",
    workAreaType: 0,
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

function makePayload(bdbs: BdbInfo[]): FilePayload {
  return {
    path: "/tmp/test.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [makeWorkSpec()],
    bdbs,
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: { 10: [] },
    sectionsByBdb: Object.fromEntries(bdbs.map((b) => [b.id, []])),
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
  };
}

function renderSidebar(
  bdbs: BdbInfo[],
  onCreatePfbbChild?: (bdbId: number) => void,
): void {
  render(
    <Sidebar
      data={makePayload(bdbs)}
      selection={{ kind: "project" }}
      onSelect={() => {}}
      onRequestEditBdb={() => {}}
      onNewControlPlan={() => {}}
      onDuplicateBdb={() => {}}
      onDeleteBdb={() => {}}
      onCreatePfbbChild={onCreatePfbbChild}
    />,
  );
}

function openContextMenuOn(bdbName: string): void {
  // The BDB row is a <button class="tree-node" title="<bdb.name>">. Several
  // OTHER nodes (contract header "[No contract]", work-area row, etc.) also
  // carry a `title` attribute, so `getByTitle` alone is ambiguous when a
  // BDB and a contract happen to share a label. Narrow to buttons whose
  // classList is exactly the BDB shape (`tree-node` or
  // `tree-node is-selected`) — the contract header uses
  // `tree-node--contract-header` which excludes it, and the rail icon
  // buttons don't have a `title` equal to the BDB name anyway.
  const candidates = screen.getAllByTitle(bdbName) as HTMLElement[];
  const row = candidates.find((el) => {
    const cls = el.className;
    return cls === "tree-node" || cls === "tree-node is-selected";
  });
  if (!row) {
    throw new Error(
      `No BDB row button found with title="${bdbName}". ` +
        `Candidates: ${candidates.map((c) => `"${c.className}"`).join(", ")}`,
    );
  }
  fireEvent.contextMenu(row);
}

describe("Sidebar right-click menu — Create PFBB child", () => {
  it("shows 'Create PFBB child…' for a PFBB master", () => {
    const onCreatePfbbChild = vi.fn();
    renderSidebar(
      [makeBdb({ id: 1, name: "Master BDB", isPfbb: true })],
      onCreatePfbbChild,
    );

    openContextMenuOn("Master BDB");

    const menu = screen.getByRole("menu", {
      name: "Building element specification actions",
    });
    // Sanity: the standard items ARE there (matches what the user reports seeing).
    expect(within(menu).getByText("Edit metadata…")).toBeDefined();
    expect(within(menu).getByText("New control plan…")).toBeDefined();
    expect(
      within(menu).getByText("Duplicate building element specification…"),
    ).toBeDefined();
    expect(
      within(menu).getByText("Delete building element specification…"),
    ).toBeDefined();

    // The one under test: must appear for a PFBB master.
    const item = within(menu).getByText("Create PFBB child…");
    fireEvent.click(item);
    expect(onCreatePfbbChild).toHaveBeenCalledWith(1);
  });

  it("hides 'Create PFBB child…' for a regular BDB", () => {
    renderSidebar([makeBdb({ id: 2, name: "Regular BDB" })], () => {});

    openContextMenuOn("Regular BDB");

    const menu = screen.getByRole("menu", {
      name: "Building element specification actions",
    });
    expect(within(menu).queryByText("Create PFBB child…")).toBeNull();
  });

  it("hides 'Create PFBB child…' for a PFBB child (subscriber)", () => {
    // A child has pfbbId set and isPfbb false. Only masters spawn children.
    renderSidebar(
      [
        makeBdb({ id: 3, name: "Master BDB", isPfbb: true }),
        makeBdb({ id: 4, name: "Child BDB", pfbbId: 3 }),
      ],
      () => {},
    );

    openContextMenuOn("Child BDB");

    // Only one BDB-actions menu is visible at a time (setContextMenu
    // returns a single target). Use getAllByRole for resilience if the
    // sidebar ever renders the menu in both the expanded tree and an
    // embedded surface in the same mount.
    const menus = screen.getAllByRole("menu", {
      name: "Building element specification actions",
    });
    for (const menu of menus) {
      expect(within(menu).queryByText("Create PFBB child…")).toBeNull();
    }
  });

  it("hides the item when the host did not wire up onCreatePfbbChild", () => {
    // Same master BDB, but no handler — the menu must gracefully omit
    // the item rather than render a dead button.
    //
    // This scenario was the ACTUAL cause of a production bug: the
    // embedded Sidebar in the Project overview was mounted without
    // `onCreatePfbbChild` because MainPane.tsx forgot to forward the
    // prop to ProjectView. The rail Sidebar worked fine because App.tsx
    // wired it directly. See the sibling `mainPaneProjectView.test.tsx`
    // for the integration-level regression guard.
    renderSidebar([makeBdb({ id: 1, name: "Master BDB", isPfbb: true })]);

    openContextMenuOn("Master BDB");

    const menus = screen.getAllByRole("menu", {
      name: "Building element specification actions",
    });
    for (const menu of menus) {
      expect(within(menu).queryByText("Create PFBB child…")).toBeNull();
    }
  });
});
