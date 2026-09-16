/** @vitest-environment jsdom */
/**
 * Slice 10H.6d — right-click lock on the virtual PFBB work_spec.
 *
 * For the work_spec identified as virtual (matched via the
 * `isVirtualWorkSpec` Sidebar prop), every mutating action
 * ("Edit metadata…", "Attachments…", "Move to contract…",
 * "Delete work area…") must be hidden. A single inert info
 * item reading "Virtual PFBB container — locked" takes their
 * place. Regular work_specs still show all actions wired by
 * the host.
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

import type { FilePayload, WorkSpecInfo } from "../src/shared/ipc.ts";
import { Sidebar } from "../src/renderer/src/Sidebar.tsx";

function makeWorkSpec(
  overrides: Partial<WorkSpecInfo> & { id: number },
): WorkSpecInfo {
  return {
    workAreaCode: "S100.01",
    workAreaName: "Regular work area",
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
    ...overrides,
  };
}

function makePayload(workSpecs: WorkSpecInfo[]): FilePayload {
  return {
    path: "/tmp/test.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs,
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: Object.fromEntries(workSpecs.map((w) => [w.id, []])),
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
  };
}

function renderSidebar(args: {
  workSpecs: WorkSpecInfo[];
  isVirtualWorkSpec?: (workSpecId: number) => boolean;
}): {
  onRequestEditWorkSpec: ReturnType<typeof vi.fn>;
  onManageAttachments: ReturnType<typeof vi.fn>;
  onMoveWorkSpecToContract: ReturnType<typeof vi.fn>;
  onDeleteWorkSpec: ReturnType<typeof vi.fn>;
} {
  const onRequestEditWorkSpec = vi.fn();
  const onManageAttachments = vi.fn();
  const onMoveWorkSpecToContract = vi.fn();
  const onDeleteWorkSpec = vi.fn();
  render(
    <Sidebar
      data={makePayload(args.workSpecs)}
      selection={{ kind: "project" }}
      onSelect={() => {}}
      onRequestEditWorkSpec={onRequestEditWorkSpec}
      onManageAttachments={onManageAttachments}
      onMoveWorkSpecToContract={onMoveWorkSpecToContract}
      onDeleteWorkSpec={onDeleteWorkSpec}
      isVirtualWorkSpec={args.isVirtualWorkSpec}
    />,
  );
  return {
    onRequestEditWorkSpec,
    onManageAttachments,
    onMoveWorkSpecToContract,
    onDeleteWorkSpec,
  };
}

function rightClickWorkSpec(label: string): void {
  const candidates = screen.getAllByTitle(label) as HTMLElement[];
  const row = candidates.find((el) => {
    const cls = el.className;
    // Work-area rows share the `tree-node` class; skip contract-header rows.
    return (
      (cls === "tree-node" || cls === "tree-node is-selected") &&
      el.tagName === "BUTTON"
    );
  });
  if (!row) {
    throw new Error(
      `No work-area row found with title="${label}". ` +
        `Candidates: ${candidates.map((c) => `"${c.className}"`).join(", ")}`,
    );
  }
  fireEvent.contextMenu(row);
}

describe("Sidebar: virtual PFBB work_spec lock (Slice 10H.6d)", () => {
  const virtualWs = makeWorkSpec({
    id: 999,
    workAreaCode: "S999.01",
    workAreaName: "Projektfælles bygningsdelsbeskrivelser",
  });
  const regularWs = makeWorkSpec({
    id: 10,
    workAreaCode: "S100.01",
    workAreaName: "Regular area",
  });

  it("hides every action on the virtual row and shows the locked-info item", () => {
    renderSidebar({
      workSpecs: [virtualWs, regularWs],
      isVirtualWorkSpec: (id) => id === 999,
    });

    rightClickWorkSpec("Projektfælles bygningsdelsbeskrivelser");

    const menu = screen.getByRole("menu", { name: "Work area actions" });
    expect(within(menu).queryByText("Edit metadata…")).toBeNull();
    expect(within(menu).queryByText("Attachments…")).toBeNull();
    expect(within(menu).queryByText("Move to contract…")).toBeNull();
    expect(within(menu).queryByText("Delete work area…")).toBeNull();
    expect(within(menu).getByTestId("ws-context-virtual-locked")).toBeDefined();
  });

  it("still shows the full action list on a regular work_spec", () => {
    renderSidebar({
      workSpecs: [virtualWs, regularWs],
      isVirtualWorkSpec: (id) => id === 999,
    });

    rightClickWorkSpec("Regular area");

    const menu = screen.getByRole("menu", { name: "Work area actions" });
    expect(within(menu).getByText("Edit metadata…")).toBeDefined();
    expect(within(menu).getByText("Attachments…")).toBeDefined();
    expect(within(menu).getByText("Move to contract…")).toBeDefined();
    expect(within(menu).getByText("Delete work area…")).toBeDefined();
    expect(within(menu).queryByTestId("ws-context-virtual-locked")).toBeNull();
  });

  it("treats all rows as regular when no isVirtualWorkSpec prop is passed", () => {
    // Legacy callers / tests that don't wire the prop should see no
    // change in behaviour — including on a row that *looks* virtual.
    renderSidebar({ workSpecs: [virtualWs] });

    rightClickWorkSpec("Projektfælles bygningsdelsbeskrivelser");

    const menu = screen.getByRole("menu", { name: "Work area actions" });
    expect(within(menu).getByText("Edit metadata…")).toBeDefined();
    expect(within(menu).queryByTestId("ws-context-virtual-locked")).toBeNull();
  });
});
