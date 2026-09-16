/** @vitest-environment jsdom */
/**
 * Slice 10H.5 — regression guard for the prop-drilling hole.
 *
 * Background
 * ──────────
 * The sidebar-level tests in `sidebarPfbbMenu.test.tsx` mount <Sidebar>
 * directly. They pass, because the Sidebar logic IS correct. But in
 * production the user reported the "Create PFBB child…" item missing
 * from the embedded sidebar inside the Project overview.
 *
 * The cause: MainPane.tsx forwards 20+ callbacks to its inner
 * <ProjectView>, but the `onCreatePfbbChild` handler had been left off
 * that call site. So the embedded Sidebar got `onCreatePfbbChild =
 * undefined` and silently hid the menu item (the Sidebar's own gate
 * correctly refuses to render a dead button with no handler).
 *
 * The rail Sidebar worked all along — App.tsx wires it directly.
 * Unit-testing Sidebar in isolation could NEVER catch this because
 * the bug was in the seam between two OTHER components.
 *
 * What this test does
 * ───────────────────
 * Mounts <MainPane target={{kind:"project"}}> with a synthetic PFBB
 * master BDB and a working `onCreatePfbbChild` spy. Right-clicks the
 * BDB row in the embedded tree and asserts both that the menu item
 * appears AND that clicking it fires the handler with the right id.
 *
 * If someone later refactors MainPane → ProjectView and forgets the
 * new prop again, this test fails loudly with a message pointing at
 * the MainPane→ProjectView forward.
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

afterEach(() => {
  cleanup();
});

void React;

import type { BdbInfo, FilePayload, WorkSpecInfo } from "../src/shared/ipc.ts";
import { MainPane } from "../src/renderer/src/MainPane.tsx";

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

/**
 * MainPane has a very wide props interface. Most of it is irrelevant
 * to the embedded Sidebar's right-click menu, so we fill everything in
 * with no-op stubs. If MainPane ever requires a new non-optional prop,
 * TS will flag this factory and the test will need updating.
 */
function renderProjectView(
  payload: FilePayload,
  onCreatePfbbChild?: (bdbId: number) => void,
): void {
  render(
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
      effectiveContractCodeFor={(_id, o) => o}
      effectiveContractNameFor={(_id, o) => o}
      isContractEditedFor={() => false}
      onRequestNewContract={() => {}}
      onSeedDefaultContracts={() => {}}
      onRequestEditContract={() => {}}
      onRequestDeleteContract={() => {}}
      selection={{ kind: "project" }}
      onSelect={() => {}}
      onDuplicateBdb={() => {}}
      onCreatePfbbChild={onCreatePfbbChild}
      onNewControlPlan={() => {}}
      onDeleteBdb={() => {}}
      onRequestEditBdb={() => {}}
    />,
  );
}

function openContextMenuOn(bdbName: string): void {
  // Same strategy as sidebarPfbbMenu.test.tsx — narrow by className to
  // get the BDB row specifically and not the contract/workArea headers.
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

describe("MainPane project view — embedded sidebar PFBB menu", () => {
  it("forwards onCreatePfbbChild to the embedded Sidebar so the menu item appears", () => {
    const onCreatePfbbChild = vi.fn();
    renderProjectView(
      makePayload([makeBdb({ id: 1, name: "Master BDB", isPfbb: true })]),
      onCreatePfbbChild,
    );

    openContextMenuOn("Master BDB");

    const menu = screen.getByRole("menu", {
      name: "Building element specification actions",
    });
    // If this fails, the MainPane → ProjectView JSX call site in
    // MainPane.tsx is probably missing `onCreatePfbbChild={...}` again.
    // See lines around the <ProjectView ...> that renders on
    // `target.kind === "project"`.
    const item = within(menu).getByText("Create PFBB child…");

    fireEvent.click(item);
    expect(onCreatePfbbChild).toHaveBeenCalledWith(1);
  });

  it("omits the item when the host did not provide onCreatePfbbChild", () => {
    // Belt-and-braces: if the host chooses not to wire it up (say, a
    // read-only viewer), the menu still works without rendering a
    // dead button. Same contract as on the rail Sidebar.
    renderProjectView(
      makePayload([makeBdb({ id: 2, name: "Master BDB", isPfbb: true })]),
      undefined,
    );

    openContextMenuOn("Master BDB");

    const menus = screen.getAllByRole("menu", {
      name: "Building element specification actions",
    });
    for (const menu of menus) {
      expect(within(menu).queryByText("Create PFBB child…")).toBeNull();
    }
  });
});
