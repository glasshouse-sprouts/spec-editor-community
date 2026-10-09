/** @vitest-environment jsdom */
/**
 * Task 147 B2.2 - a work area's own type at the top of the editor.
 *
 * Owner 2026-10-09: opening a Fælles beskrivelse showed "Arbejdsbeskrivelse"
 * at the top. The type (work_spec.work_area_type) now decides the label
 * wherever ONE specific work area is shown:
 *
 *   1. MainPane - the header of an open work area
 *   2. AlignedSpecView - the right column, when it is a work area or BDB
 *      (Molio's own content keeps the old label)
 *   3. ReloadMergeModal - each work area the disk added or removed
 *   (refTypes' "Arbejdsbeskrivelse" tab name stays: it names a tab.)
 *
 * The labels are UI text and follow the app language, but by the owner's
 * decision (2026-10-09) the English catalogue uses Molio's own Danish
 * names too - checked in section 4.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

void React;

import type { FilePayload, WorkSpecInfo } from "../src/shared/ipc.ts";
import { MainPane } from "../src/renderer/src/MainPane.tsx";
import { AlignedSpecView } from "../src/renderer/src/AlignedSpecView.tsx";
import { ReloadMergeModal } from "../src/renderer/src/modals/ReloadMergeModal.tsx";
import { computeDiskDelta } from "../src/renderer/src/mergeOnReload.ts";
import {
  WORK_AREA_TYPE_LABELS,
  WORK_AREA_TYPE_UI_KEYS,
  workAreaTypeUiKey,
} from "../src/renderer/src/pdf/documentTypes.ts";
import { getLocale, setLocale } from "../src/renderer/src/i18n/i18n.ts";
import da from "../src/renderer/src/i18n/messages.da.json";
import en from "../src/renderer/src/i18n/messages.en.json";

const TYPES: Array<[number, string]> = [
  [0, "Arbejdsbeskrivelse"],
  [1, "Fælles beskrivelse"],
  [2, "Paradigme for arbejdsbeskrivelse"],
];

const before = getLocale();
beforeEach(() => setLocale("da"));
afterEach(() => {
  cleanup();
  setLocale(before);
});

function makeWorkSpec(workAreaType: number): WorkSpecInfo {
  return {
    id: 10,
    workAreaCode: "S100.01",
    workAreaName: "Fællesbestemmelser",
    workAreaType,
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
    locked: { molioSpecRevisionNo: null, molioSpecRevisionDate: null },
  } as WorkSpecInfo;
}

function makePayload(workAreaType: number): FilePayload {
  return {
    path: "/tmp/test.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [makeWorkSpec(workAreaType)],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: { 10: [] },
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
  } as unknown as FilePayload;
}

function kindLabels(): string[] {
  return Array.from(document.querySelectorAll(".spec-view__kind")).map(
    (el) => el.textContent ?? "",
  );
}

// ---------------------------------------------------------------------------
// 1. MainPane header
// ---------------------------------------------------------------------------

function renderWorkArea(workAreaType: number): void {
  render(
    <MainPane
      data={makePayload(workAreaType)}
      target={{ kind: "workSpec", id: 10 }}
      tocFilter=""
      onTocFilterChange={() => {}}
      tocCollapsedNodeIds={new Set()}
      onTocCollapsedNodeIdsChange={() => {}}
      refSubTab={null}
      onRefSubTabChange={() => {}}
      refPanelCollapsed={true}
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
      selection={{ kind: "workSpec", id: 10 }}
      onSelect={() => {}}
      onDuplicateBdb={() => {}}
      onNewControlPlan={() => {}}
      onDeleteBdb={() => {}}
      onRequestEditBdb={() => {}}
    />,
  );
}

describe("MainPane - the header shows the work area's own type", () => {
  for (const [type, label] of TYPES) {
    it(`type ${type}: "${label}"`, () => {
      renderWorkArea(type);
      expect(kindLabels()).toEqual([label]);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. AlignedSpecView right column (print layout)
// ---------------------------------------------------------------------------

describe("AlignedSpecView - the right column names the right document's kind", () => {
  function renderAligned(rightKindKey?: string): void {
    render(
      <AlignedSpecView
        leftSections={[]}
        rightSections={[]}
        layoutMode="print"
        leftTitle="Venstre"
        leftKind="Bygningsdelsbeskrivelse"
        rightTitle="Højre"
        {...(rightKindKey ? { rightKindKey } : {})}
      />,
    );
  }

  for (const [type, label] of TYPES) {
    it(`a parent work area of type ${type}: "${label}"`, () => {
      renderAligned(workAreaTypeUiKey(type));
      expect(kindLabels()).toEqual(["Bygningsdelsbeskrivelse", label]);
    });
  }

  it("a BDB on the right (version reference) says Bygningsdelsbeskrivelse", () => {
    renderAligned("mainPane.kind.bdb");
    expect(kindLabels()[1]).toBe("Bygningsdelsbeskrivelse");
  });

  it("without a kind (Molio's own content) the old label stays", () => {
    renderAligned();
    expect(kindLabels()[1]).toBe(da["aligned.workAreaKind"]);
  });
});

// ---------------------------------------------------------------------------
// 3. ReloadMergeModal + computeDiskDelta
// ---------------------------------------------------------------------------

describe("ReloadMergeModal - a work area added or removed on disk names its type", () => {
  for (const [type, label] of TYPES) {
    it(`type ${type}: "${label}: ..."`, () => {
      render(
        <ReloadMergeModal
          autoApplied={[]}
          conflicts={[]}
          diskDelta={{
            added: [{ kind: "workArea", name: "Ny", workAreaType: type }],
            removed: [{ kind: "workArea", name: "Gammel", workAreaType: type }],
          }}
          onCancel={() => {}}
          onApply={() => {}}
        />,
      );
      expect(screen.getByText(`${label}: Ny`)).toBeTruthy();
      expect(screen.getByText(`${label}: Gammel`)).toBeTruthy();
    });
  }

  it("computeDiskDelta carries the work area's type", () => {
    const base = makePayload(1);
    const disk = { ...makePayload(1), workSpecs: [] } as FilePayload;
    const d = computeDiskDelta(base, disk);
    expect(d.removed).toEqual([
      { kind: "workArea", name: "Fællesbestemmelser", workAreaType: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. The texts: Molio's names, in both catalogues, same as the PDF
// ---------------------------------------------------------------------------

describe("the type labels", () => {
  it("use the same 0/1/2 mapping and fallback as the PDF", () => {
    for (const [type] of TYPES) {
      expect(WORK_AREA_TYPE_UI_KEYS[type]).toBe(workAreaTypeUiKey(type));
    }
    expect(workAreaTypeUiKey(null)).toBe(WORK_AREA_TYPE_UI_KEYS[0]);
    expect(workAreaTypeUiKey(7)).toBe(WORK_AREA_TYPE_UI_KEYS[0]);
  });

  it("are Molio's own names in Danish AND English (owner 2026-10-09)", () => {
    for (const [type, label] of TYPES) {
      const key = workAreaTypeUiKey(type);
      expect((da as Record<string, string>)[key], key).toBe(label);
      expect((en as Record<string, string>)[key], key).toBe(label);
      expect(WORK_AREA_TYPE_LABELS[type]).toBe(label);
    }
  });

  it("the header shows Molio's name with the app in English too", () => {
    setLocale("en");
    renderWorkArea(1);
    expect(kindLabels()).toEqual(["Fælles beskrivelse"]);
  });
});
