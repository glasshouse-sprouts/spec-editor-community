/**
 * Tests for the pure edit-map helpers. DOM-free — no jsdom needed.
 *
 * Coverage:
 *   - editKey / cpTitleKey / cpRowKey key format
 *   - Section-body edits (original Slice 6B surface)
 *   - CP-title edits
 *   - CP-row-cell edits
 *   - toEditRequestList: flattening + deterministic sort
 *   - toSectionEditList: back-compat filter
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_EDITS,
  clearContractEdit,
  clearCpRowCellEdit,
  clearCpTitleEdit,
  clearSectionEdit,
  clearWorkSpecContractEdit,
  contractKey,
  cpRowKey,
  cpTitleKey,
  editCount,
  editKey,
  getEffectiveBody,
  getEffectiveContractCode,
  getEffectiveContractName,
  getEffectiveCpRowCell,
  getEffectiveCpTitle,
  getEffectiveWorkSpecContract,
  hasEdits,
  isAnyCpRowCellEdited,
  isContractEdited,
  isCpRowCellEdited,
  isCpTitleEdited,
  isSectionEdited,
  isWorkSpecContractEdited,
  clearProjectEdit,
  clearWorkSpecMetadataEdit,
  clearBdbMetadataEdit,
  clearCpMetadataEdit,
  getEffectiveProjectField,
  getEffectiveWorkSpecField,
  getEffectiveBdbField,
  getEffectiveCpField,
  isProjectEdited,
  isWorkSpecMetadataEdited,
  isBdbMetadataEdited,
  isCpMetadataEdited,
  setContractCode,
  setContractName,
  setCpRowCell,
  setCpTitle,
  setProjectField,
  setWorkSpecField,
  setBdbField,
  setCpField,
  setSectionBody,
  setWorkSpecContract,
  toEditRequestList,
  toSectionEditList,
  workSpecContractKey,
} from "../src/renderer/src/edits.js";

describe("key helpers", () => {
  it("editKey scopes by kind to prevent id collisions", () => {
    expect(editKey("workSpec", 1)).toBe("workSpec:1");
    expect(editKey("bdb", 1)).toBe("bdb:1");
    expect(editKey("workSpec", 1)).not.toBe(editKey("bdb", 1));
  });

  it("cpTitleKey + cpRowKey are distinct from section keys and each other", () => {
    expect(cpTitleKey(1)).toBe("cpTitle:1");
    expect(cpRowKey(1, "subject")).toBe("cpRow:1:subject");
    expect(cpTitleKey(1)).not.toBe(editKey("workSpec", 1));
    expect(cpTitleKey(1)).not.toBe(cpRowKey(1, "subject"));
  });
});

// ── Section bodies ────────────────────────────────────────────────

describe("setSectionBody", () => {
  it("adds a patch when new body differs from original", () => {
    const next = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>B</p>",
      "<p>A</p>",
    );
    expect(hasEdits(next)).toBe(true);
    expect(editCount(next)).toBe(1);
    expect(isSectionEdited(next, "workSpec", 1)).toBe(true);
  });

  it("removes the patch when the user reverts to original", () => {
    const added = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>B</p>",
      "<p>A</p>",
    );
    const reverted = setSectionBody(
      added,
      "workSpec",
      1,
      "<p>A</p>",
      "<p>A</p>",
    );
    expect(hasEdits(reverted)).toBe(false);
    expect(isSectionEdited(reverted, "workSpec", 1)).toBe(false);
  });

  it("returns the same reference when the patch is unchanged", () => {
    const added = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>B</p>",
      "<p>A</p>",
    );
    const again = setSectionBody(added, "workSpec", 1, "<p>B</p>", "<p>A</p>");
    expect(again).toBe(added);
  });

  it("returns the same reference when clearing an already-clean section", () => {
    const again = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>A</p>",
      "<p>A</p>",
    );
    expect(again).toBe(EMPTY_EDITS);
  });

  it("keeps work-spec and BDB patches separate", () => {
    let m = setSectionBody(EMPTY_EDITS, "workSpec", 5, "<p>WS</p>", "");
    m = setSectionBody(m, "bdb", 5, "<p>BDB</p>", "");
    expect(editCount(m)).toBe(2);
    expect(getEffectiveBody(m, "workSpec", 5, "")).toBe("<p>WS</p>");
    expect(getEffectiveBody(m, "bdb", 5, "")).toBe("<p>BDB</p>");
  });
});

describe("clearSectionEdit", () => {
  it("removes the patch if present", () => {
    const added = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>B</p>",
      "<p>A</p>",
    );
    const cleared = clearSectionEdit(added, "workSpec", 1);
    expect(hasEdits(cleared)).toBe(false);
  });

  it("returns the same reference if nothing to clear", () => {
    const same = clearSectionEdit(EMPTY_EDITS, "workSpec", 99);
    expect(same).toBe(EMPTY_EDITS);
  });
});

describe("getEffectiveBody", () => {
  it("returns the original when no patch exists", () => {
    expect(getEffectiveBody(EMPTY_EDITS, "workSpec", 1, "<p>A</p>")).toBe(
      "<p>A</p>",
    );
  });

  it("returns the patched body when present", () => {
    const added = setSectionBody(
      EMPTY_EDITS,
      "workSpec",
      1,
      "<p>B</p>",
      "<p>A</p>",
    );
    expect(getEffectiveBody(added, "workSpec", 1, "<p>A</p>")).toBe("<p>B</p>");
  });

  it("ignores a CP patch that happens to sit on the same numeric id", () => {
    // cpTitle:1 and workSpec:1 must never collide.
    const m = setCpTitle(EMPTY_EDITS, 1, "Renamed", "Original");
    expect(getEffectiveBody(m, "workSpec", 1, "<p>WS</p>")).toBe("<p>WS</p>");
  });
});

// ── CP title ──────────────────────────────────────────────────────

describe("setCpTitle", () => {
  it("adds a patch when title changes", () => {
    const next = setCpTitle(EMPTY_EDITS, 1, "New title", "Old");
    expect(hasEdits(next)).toBe(true);
    expect(isCpTitleEdited(next, 1)).toBe(true);
  });

  it("removes the patch when reverting to original", () => {
    const added = setCpTitle(EMPTY_EDITS, 1, "New", "Old");
    const reverted = setCpTitle(added, 1, "Old", "Old");
    expect(hasEdits(reverted)).toBe(false);
  });

  it("returns the same reference when nothing changed", () => {
    const added = setCpTitle(EMPTY_EDITS, 1, "New", "Old");
    const again = setCpTitle(added, 1, "New", "Old");
    expect(again).toBe(added);
  });

  it("scopes by control-plan id", () => {
    let m = setCpTitle(EMPTY_EDITS, 1, "A", "");
    m = setCpTitle(m, 2, "B", "");
    expect(getEffectiveCpTitle(m, 1, "")).toBe("A");
    expect(getEffectiveCpTitle(m, 2, "")).toBe("B");
    expect(editCount(m)).toBe(2);
  });
});

describe("clearCpTitleEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setCpTitle(EMPTY_EDITS, 1, "New", "Old");
    expect(hasEdits(clearCpTitleEdit(added, 1))).toBe(false);
    expect(clearCpTitleEdit(EMPTY_EDITS, 99)).toBe(EMPTY_EDITS);
  });
});

describe("getEffectiveCpTitle", () => {
  it("returns original if no patch, patched value otherwise", () => {
    expect(getEffectiveCpTitle(EMPTY_EDITS, 1, "Plan A")).toBe("Plan A");
    const m = setCpTitle(EMPTY_EDITS, 1, "Plan A — v2", "Plan A");
    expect(getEffectiveCpTitle(m, 1, "Plan A")).toBe("Plan A — v2");
  });
});

// ── CP row cells ──────────────────────────────────────────────────

describe("setCpRowCell", () => {
  it("adds a patch for a single cell", () => {
    const m = setCpRowCell(EMPTY_EDITS, 42, "subject", "New", "Old");
    expect(isCpRowCellEdited(m, 42, "subject")).toBe(true);
    expect(isCpRowCellEdited(m, 42, "method")).toBe(false);
  });

  it("removes the patch when reverted", () => {
    const m = setCpRowCell(EMPTY_EDITS, 42, "subject", "New", "Old");
    const reverted = setCpRowCell(m, 42, "subject", "Old", "Old");
    expect(hasEdits(reverted)).toBe(false);
  });

  it("keeps different cells on the same row independent", () => {
    let m = setCpRowCell(EMPTY_EDITS, 42, "subject", "S1", "");
    m = setCpRowCell(m, 42, "method", "M1", "");
    expect(editCount(m)).toBe(2);
    expect(getEffectiveCpRowCell(m, 42, "subject", "")).toBe("S1");
    expect(getEffectiveCpRowCell(m, 42, "method", "")).toBe("M1");
  });

  it("isAnyCpRowCellEdited picks up any cell on the row", () => {
    const m = setCpRowCell(EMPTY_EDITS, 42, "subject", "S1", "");
    expect(isAnyCpRowCellEdited(m, 42)).toBe(true);
    expect(isAnyCpRowCellEdited(m, 43)).toBe(false);
  });

  it("returns same reference when unchanged", () => {
    const a = setCpRowCell(EMPTY_EDITS, 42, "subject", "S1", "");
    const b = setCpRowCell(a, 42, "subject", "S1", "");
    expect(b).toBe(a);
  });
});

describe("clearCpRowCellEdit", () => {
  it("drops one cell while leaving sibling cells alone", () => {
    let m = setCpRowCell(EMPTY_EDITS, 42, "subject", "S1", "");
    m = setCpRowCell(m, 42, "method", "M1", "");
    const cleared = clearCpRowCellEdit(m, 42, "subject");
    expect(isCpRowCellEdited(cleared, 42, "subject")).toBe(false);
    expect(isCpRowCellEdited(cleared, 42, "method")).toBe(true);
  });
});

// ── Flattening ────────────────────────────────────────────────────

describe("toEditRequestList", () => {
  it("returns an empty array for empty map", () => {
    expect(toEditRequestList(EMPTY_EDITS)).toEqual([]);
  });

  it("emits every kind and sorts deterministically", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setCpRowCell(m, 7, "subject", "Row-7-subj", "");
    m = setCpTitle(m, 2, "CP-2", "");
    m = setSectionBody(m, "bdb", 5, "<p>b5</p>", "");
    m = setSectionBody(m, "workSpec", 3, "<p>w3</p>", "");
    m = setCpRowCell(m, 7, "method", "Row-7-meth", "");
    m = setCpTitle(m, 1, "CP-1", "");

    expect(toEditRequestList(m)).toEqual([
      { target: "workSpec", sectionId: 3, body: "<p>w3</p>" },
      { target: "bdb", sectionId: 5, body: "<p>b5</p>" },
      { target: "cpTitle", controlPlanId: 1, title: "CP-1" },
      { target: "cpTitle", controlPlanId: 2, title: "CP-2" },
      { target: "cpRow", rowId: 7, field: "method", value: "Row-7-meth" },
      { target: "cpRow", rowId: 7, field: "subject", value: "Row-7-subj" },
    ]);
  });
});

describe("toSectionEditList (back-compat)", () => {
  it("still only emits section-body edits", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setCpTitle(m, 2, "CP-2", "");
    m = setCpRowCell(m, 7, "subject", "x", "");
    m = setSectionBody(m, "workSpec", 1, "<p>a</p>", "");
    expect(toSectionEditList(m)).toEqual([
      { target: "workSpec", sectionId: 1, body: "<p>a</p>" },
    ]);
  });
});

// ── Contracts (rename) ────────────────────────────────────────────

describe("contract key + scoping", () => {
  it("contractKey is distinct from section / CP keys", () => {
    expect(contractKey(1)).toBe("contract:1");
    expect(contractKey(1)).not.toBe(editKey("workSpec", 1));
    expect(contractKey(1)).not.toBe(cpTitleKey(1));
  });
});

describe("setContractCode / setContractName", () => {
  it("adds a patch for a code change", () => {
    const m = setContractCode(EMPTY_EDITS, 1, "E22", "E21");
    expect(hasEdits(m)).toBe(true);
    expect(isContractEdited(m, 1)).toBe(true);
    expect(getEffectiveContractCode(m, 1, "E21")).toBe("E22");
    expect(getEffectiveContractName(m, 1, "Old name")).toBe("Old name");
  });

  it("adds a patch for a name change", () => {
    const m = setContractName(EMPTY_EDITS, 1, "New name", "Old name");
    expect(isContractEdited(m, 1)).toBe(true);
    expect(getEffectiveContractName(m, 1, "Old name")).toBe("New name");
  });

  it("merges code + name edits into a single patch", () => {
    let m = setContractCode(EMPTY_EDITS, 1, "E22", "E21");
    m = setContractName(m, 1, "Renamed", "Original");
    expect(editCount(m)).toBe(1);
    expect(getEffectiveContractCode(m, 1, "E21")).toBe("E22");
    expect(getEffectiveContractName(m, 1, "Original")).toBe("Renamed");
  });

  it("setting code does not lose an earlier name edit (merge test)", () => {
    let m = setContractName(EMPTY_EDITS, 1, "Renamed", "Original");
    m = setContractCode(m, 1, "E22", "E21");
    expect(getEffectiveContractName(m, 1, "Original")).toBe("Renamed");
    expect(getEffectiveContractCode(m, 1, "E21")).toBe("E22");
  });

  it("reverting every field drops the patch entirely", () => {
    let m = setContractCode(EMPTY_EDITS, 1, "E22", "E21");
    m = setContractName(m, 1, "Renamed", "Original");
    m = setContractCode(m, 1, "E21", "E21"); // revert code
    expect(isContractEdited(m, 1)).toBe(true); // still has name edit
    m = setContractName(m, 1, "Original", "Original"); // revert name
    expect(hasEdits(m)).toBe(false);
  });

  it("accepts null as 'clear this column' (distinct from undefined)", () => {
    const m = setContractCode(EMPTY_EDITS, 1, null, "E21");
    expect(getEffectiveContractCode(m, 1, "E21")).toBe(null);
  });

  it("returns same reference when the new value matches the current patch", () => {
    const a = setContractCode(EMPTY_EDITS, 1, "E22", "E21");
    const b = setContractCode(a, 1, "E22", "E21");
    expect(b).toBe(a);
  });

  it("scopes by contract id", () => {
    let m = setContractCode(EMPTY_EDITS, 1, "C1", "");
    m = setContractCode(m, 2, "C2", "");
    expect(getEffectiveContractCode(m, 1, "")).toBe("C1");
    expect(getEffectiveContractCode(m, 2, "")).toBe("C2");
    expect(editCount(m)).toBe(2);
  });
});

describe("clearContractEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setContractCode(EMPTY_EDITS, 1, "E22", "E21");
    expect(hasEdits(clearContractEdit(added, 1))).toBe(false);
    expect(clearContractEdit(EMPTY_EDITS, 99)).toBe(EMPTY_EDITS);
  });
});

// ── Work area → contract ──────────────────────────────────────────

describe("setWorkSpecContract", () => {
  it("workSpecContractKey is distinct from other keys", () => {
    expect(workSpecContractKey(1)).toBe("wsContract:1");
    expect(workSpecContractKey(1)).not.toBe(editKey("workSpec", 1));
  });

  it("adds a patch when the contract id changes", () => {
    const m = setWorkSpecContract(EMPTY_EDITS, 42, 7, 3);
    expect(isWorkSpecContractEdited(m, 42)).toBe(true);
    expect(getEffectiveWorkSpecContract(m, 42, 3)).toBe(7);
  });

  it("stores null as a valid new value (clear the link)", () => {
    const m = setWorkSpecContract(EMPTY_EDITS, 42, null, 7);
    expect(getEffectiveWorkSpecContract(m, 42, 7)).toBe(null);
  });

  it("drops the patch when reverted to the original", () => {
    const m = setWorkSpecContract(EMPTY_EDITS, 42, 7, 3);
    const reverted = setWorkSpecContract(m, 42, 3, 3);
    expect(hasEdits(reverted)).toBe(false);
  });

  it("returns the same reference when unchanged", () => {
    const a = setWorkSpecContract(EMPTY_EDITS, 42, 7, 3);
    const b = setWorkSpecContract(a, 42, 7, 3);
    expect(b).toBe(a);
  });

  it("getEffective returns the original when no patch exists", () => {
    expect(getEffectiveWorkSpecContract(EMPTY_EDITS, 99, 7)).toBe(7);
    expect(getEffectiveWorkSpecContract(EMPTY_EDITS, 99, null)).toBe(null);
  });
});

describe("clearWorkSpecContractEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setWorkSpecContract(EMPTY_EDITS, 42, 7, 3);
    expect(hasEdits(clearWorkSpecContractEdit(added, 42))).toBe(false);
    expect(clearWorkSpecContractEdit(EMPTY_EDITS, 99)).toBe(EMPTY_EDITS);
  });
});

// ── Flattening for contracts + wsContract ─────────────────────────

describe("toEditRequestList with contract + wsContract edits", () => {
  it("emits contractRename with only touched fields", () => {
    // Only name changed → contractCode should be absent in the request.
    const m = setContractName(EMPTY_EDITS, 5, "Only name", "Old");
    expect(toEditRequestList(m)).toEqual([
      { target: "contractRename", id: 5, contractName: "Only name" },
    ]);
  });

  it("emits contractRename with both fields when both are touched", () => {
    let m = setContractCode(EMPTY_EDITS, 5, "E22", "E21");
    m = setContractName(m, 5, "Renamed", "Old");
    expect(toEditRequestList(m)).toEqual([
      {
        target: "contractRename",
        id: 5,
        contractCode: "E22",
        contractName: "Renamed",
      },
    ]);
  });

  it("emits workSpecContract with null when clearing the link", () => {
    const m = setWorkSpecContract(EMPTY_EDITS, 42, null, 7);
    expect(toEditRequestList(m)).toEqual([
      { target: "workSpecContract", workSpecId: 42, contractId: null },
    ]);
  });

  it("sorts contract edits after section + CP edits, each kind by id", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setWorkSpecContract(m, 42, 7, 3);
    m = setContractName(m, 9, "B9", "Old");
    m = setContractName(m, 1, "B1", "Old");
    m = setWorkSpecContract(m, 11, null, 7);
    m = setSectionBody(m, "workSpec", 1, "<p>w1</p>", "");

    expect(toEditRequestList(m)).toEqual([
      { target: "workSpec", sectionId: 1, body: "<p>w1</p>" },
      { target: "contractRename", id: 1, contractName: "B1" },
      { target: "contractRename", id: 9, contractName: "B9" },
      { target: "workSpecContract", workSpecId: 11, contractId: null },
      { target: "workSpecContract", workSpecId: 42, contractId: 7 },
    ]);
  });
});

// ── Project metadata edits (Slice 10D) ─────────────────────────────

describe("setProjectField", () => {
  const GUID = "proj-guid-0001";

  it("adds a patch when a field changes", () => {
    const m = setProjectField(EMPTY_EDITS, GUID, "name", "New name", "Old");
    expect(isProjectEdited(m)).toBe(true);
    expect(getEffectiveProjectField(m, "name", "Old")).toBe("New name");
  });

  it("drops the patch when the only changed field reverts to the original", () => {
    let m = setProjectField(EMPTY_EDITS, GUID, "name", "New", "Old");
    m = setProjectField(m, GUID, "name", "Old", "Old");
    expect(isProjectEdited(m)).toBe(false);
  });

  it("keeps the patch when one field reverts but another is still touched", () => {
    let m = setProjectField(EMPTY_EDITS, GUID, "name", "New", "Old");
    m = setProjectField(m, GUID, "projectNumber", "P-2", "P-1");
    m = setProjectField(m, GUID, "name", "Old", "Old");
    expect(isProjectEdited(m)).toBe(true);
    // `name` reverted → effective is the original; `projectNumber` still edited.
    expect(getEffectiveProjectField(m, "name", "Old")).toBe("Old");
    expect(getEffectiveProjectField(m, "projectNumber", "P-1")).toBe("P-2");
  });

  it("supports nullable fields: null clears, blank is stored verbatim", () => {
    let m = setProjectField(EMPTY_EDITS, GUID, "builder", null, "Acme");
    expect(getEffectiveProjectField(m, "builder", "Acme")).toBeNull();
    m = setProjectField(m, GUID, "molioReferencelistDate", "2024-11-15", null);
    expect(getEffectiveProjectField(m, "molioReferencelistDate", null)).toBe(
      "2024-11-15",
    );
  });

  it("returns the same map reference when nothing changed", () => {
    const m = setProjectField(EMPTY_EDITS, GUID, "name", "Old", "Old");
    expect(m).toBe(EMPTY_EDITS);
  });

  it("getEffectiveProjectField returns the original when no patch exists", () => {
    expect(getEffectiveProjectField(EMPTY_EDITS, "name", "Whatever")).toBe(
      "Whatever",
    );
    expect(getEffectiveProjectField(EMPTY_EDITS, "builder", null)).toBeNull();
  });
});

describe("clearProjectEdit", () => {
  const GUID = "proj-guid-0002";

  it("drops the patch if present, same reference otherwise", () => {
    const added = setProjectField(EMPTY_EDITS, GUID, "name", "New", "Old");
    expect(isProjectEdited(clearProjectEdit(added))).toBe(false);
    expect(clearProjectEdit(EMPTY_EDITS)).toBe(EMPTY_EDITS);
  });
});

describe("toEditRequestList with project edits", () => {
  const GUID = "proj-guid-0003";

  it("emits one `project` request per save with only touched fields", () => {
    let m = setProjectField(EMPTY_EDITS, GUID, "name", "New", "Old");
    m = setProjectField(m, GUID, "builder", null, "Acme");
    expect(toEditRequestList(m)).toEqual([
      {
        target: "project",
        projectGuid: GUID,
        name: "New",
        builder: null,
      },
    ]);
  });

  it("emits all four fields when all are touched", () => {
    let m = setProjectField(EMPTY_EDITS, GUID, "name", "N", "ON");
    m = setProjectField(m, GUID, "projectNumber", "P-2", "P-1");
    m = setProjectField(m, GUID, "builder", "B2", "B1");
    m = setProjectField(m, GUID, "molioReferencelistDate", "2025-01-01", null);
    expect(toEditRequestList(m)).toEqual([
      {
        target: "project",
        projectGuid: GUID,
        name: "N",
        projectNumber: "P-2",
        builder: "B2",
        molioReferencelistDate: "2025-01-01",
      },
    ]);
  });

  it("sorts project edits after contract edits", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setProjectField(m, GUID, "name", "N", "ON");
    m = setContractName(m, 1, "C1", "OC1");
    m = setSectionBody(m, "workSpec", 1, "<p>w1</p>", "");

    const list = toEditRequestList(m);
    expect(list.map((e) => e.target)).toEqual([
      "workSpec",
      "contractRename",
      "project",
    ]);
  });
});

// ── Work-area metadata edits (Slice 10E) ───────────────────────────

describe("setWorkSpecField", () => {
  it("adds a patch when a field changes", () => {
    const m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "New", "Old");
    expect(isWorkSpecMetadataEdited(m, 12)).toBe(true);
    expect(getEffectiveWorkSpecField(m, 12, "workAreaName", "Old")).toBe("New");
  });

  it("drops the patch when the only changed field reverts to the original", () => {
    let m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "New", "Old");
    m = setWorkSpecField(m, 12, "workAreaName", "Old", "Old");
    expect(isWorkSpecMetadataEdited(m, 12)).toBe(false);
  });

  it("keeps the patch when one field reverts but another is still touched", () => {
    let m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "New", "Old");
    m = setWorkSpecField(m, 12, "revision", "B", "A");
    m = setWorkSpecField(m, 12, "workAreaName", "Old", "Old");
    expect(isWorkSpecMetadataEdited(m, 12)).toBe(true);
    expect(getEffectiveWorkSpecField(m, 12, "workAreaName", "Old")).toBe("Old");
    expect(getEffectiveWorkSpecField(m, 12, "revision", "A")).toBe("B");
  });

  it("supports nullable fields: null clears, strings are stored verbatim", () => {
    let m = setWorkSpecField(EMPTY_EDITS, 12, "createdBy", null, "Alice");
    expect(getEffectiveWorkSpecField(m, 12, "createdBy", "Alice")).toBeNull();
    m = setWorkSpecField(m, 12, "revisionDate", "2025-04-22", null);
    expect(getEffectiveWorkSpecField(m, 12, "revisionDate", null)).toBe(
      "2025-04-22",
    );
  });

  it("accepts plain numbers for workAreaType (enum switch)", () => {
    const m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaType", 1, 0);
    expect(getEffectiveWorkSpecField(m, 12, "workAreaType", 0)).toBe(1);
  });

  it("coerces string numbers for workAreaType (native <select value> path)", () => {
    const m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaType", "2", 0);
    expect(getEffectiveWorkSpecField(m, 12, "workAreaType", 0)).toBe(2);
  });

  it("returns the same map reference when nothing changed", () => {
    const m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "Old", "Old");
    expect(m).toBe(EMPTY_EDITS);
  });

  it("getEffectiveWorkSpecField returns the original when no patch exists", () => {
    expect(
      getEffectiveWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "X"),
    ).toBe("X");
    expect(
      getEffectiveWorkSpecField(EMPTY_EDITS, 12, "createdBy", null),
    ).toBeNull();
  });

  it("scopes patches by id (two work-areas don't collide)", () => {
    let m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "W12", "Old");
    m = setWorkSpecField(m, 13, "workAreaName", "W13", "Old");
    expect(isWorkSpecMetadataEdited(m, 12)).toBe(true);
    expect(isWorkSpecMetadataEdited(m, 13)).toBe(true);
    expect(getEffectiveWorkSpecField(m, 12, "workAreaName", "Old")).toBe("W12");
    expect(getEffectiveWorkSpecField(m, 13, "workAreaName", "Old")).toBe("W13");
  });
});

describe("clearWorkSpecMetadataEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "N", "O");
    expect(isWorkSpecMetadataEdited(clearWorkSpecMetadataEdit(added, 12))).toBe(
      false,
    );
    expect(clearWorkSpecMetadataEdit(EMPTY_EDITS, 12)).toBe(EMPTY_EDITS);
  });
});

// ── BDB metadata edits (Slice 10E) ─────────────────────────────────

describe("setBdbField", () => {
  it("adds a patch when a field changes", () => {
    const m = setBdbField(EMPTY_EDITS, 45, "name", "New", "Old");
    expect(isBdbMetadataEdited(m, 45)).toBe(true);
    expect(getEffectiveBdbField(m, 45, "name", "Old")).toBe("New");
  });

  it("drops the patch when the only changed field reverts to the original", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "name", "New", "Old");
    m = setBdbField(m, 45, "name", "Old", "Old");
    expect(isBdbMetadataEdited(m, 45)).toBe(false);
  });

  it("keeps the patch when one field reverts but another is still touched", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "name", "New", "Old");
    m = setBdbField(m, 45, "isPfbb", 1, 0);
    m = setBdbField(m, 45, "name", "Old", "Old");
    expect(isBdbMetadataEdited(m, 45)).toBe(true);
    expect(getEffectiveBdbField(m, 45, "name", "Old")).toBe("Old");
    expect(getEffectiveBdbField(m, 45, "isPfbb", 0)).toBe(1);
  });

  it("supports nullable fields: null clears, strings are stored verbatim", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "createdBy", null, "Alice");
    expect(getEffectiveBdbField(m, 45, "createdBy", "Alice")).toBeNull();
    m = setBdbField(m, 45, "approvedBy", "Bob", null);
    expect(getEffectiveBdbField(m, 45, "approvedBy", null)).toBe("Bob");
  });

  it("toggles isPfbb as a 0/1 number", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "isPfbb", 1, 0);
    expect(getEffectiveBdbField(m, 45, "isPfbb", 0)).toBe(1);
    // Toggling back to the original drops the patch.
    m = setBdbField(m, 45, "isPfbb", 0, 0);
    expect(isBdbMetadataEdited(m, 45)).toBe(false);
  });

  it("returns the same map reference when nothing changed", () => {
    const m = setBdbField(EMPTY_EDITS, 45, "name", "Old", "Old");
    expect(m).toBe(EMPTY_EDITS);
  });

  it("getEffectiveBdbField returns the original when no patch exists", () => {
    expect(getEffectiveBdbField(EMPTY_EDITS, 45, "name", "X")).toBe("X");
    expect(getEffectiveBdbField(EMPTY_EDITS, 45, "createdBy", null)).toBeNull();
  });

  it("scopes patches by id (two BDBs don't collide)", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "name", "B45", "Old");
    m = setBdbField(m, 46, "name", "B46", "Old");
    expect(isBdbMetadataEdited(m, 45)).toBe(true);
    expect(isBdbMetadataEdited(m, 46)).toBe(true);
  });
});

describe("clearBdbMetadataEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setBdbField(EMPTY_EDITS, 45, "name", "N", "O");
    expect(isBdbMetadataEdited(clearBdbMetadataEdit(added, 45), 45)).toBe(
      false,
    );
    expect(clearBdbMetadataEdit(EMPTY_EDITS, 45)).toBe(EMPTY_EDITS);
  });
});

// ── Flattening for workSpec/bdb metadata ──────────────────────────

describe("toEditRequestList with workSpec/bdb metadata edits", () => {
  it("emits workSpecMetadata with only touched fields", () => {
    let m = setWorkSpecField(EMPTY_EDITS, 12, "workAreaName", "New", "Old");
    m = setWorkSpecField(m, 12, "createdBy", null, "Alice");
    expect(toEditRequestList(m)).toEqual([
      {
        target: "workSpecMetadata",
        id: 12,
        workAreaName: "New",
        createdBy: null,
      },
    ]);
  });

  it("emits workSpecMetadata with every editable field when all are touched", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setWorkSpecField(m, 12, "workAreaCode", "WA-2", "WA-1");
    m = setWorkSpecField(m, 12, "workAreaName", "N2", "N1");
    m = setWorkSpecField(m, 12, "workAreaType", 1, 0);
    m = setWorkSpecField(m, 12, "createdBy", "Alice", null);
    m = setWorkSpecField(m, 12, "createdByOrganization", "Acme", null);
    m = setWorkSpecField(m, 12, "revision", "B", "A");
    m = setWorkSpecField(m, 12, "revisionDate", "2025-04-22", null);
    m = setWorkSpecField(m, 12, "issueDate", "2025-04-23", null);
    m = setWorkSpecField(m, 12, "reviewedBy", "Bob", null);
    m = setWorkSpecField(m, 12, "approvedBy", "Carol", null);

    expect(toEditRequestList(m)).toEqual([
      {
        target: "workSpecMetadata",
        id: 12,
        workAreaCode: "WA-2",
        workAreaName: "N2",
        workAreaType: 1,
        createdBy: "Alice",
        createdByOrganization: "Acme",
        revision: "B",
        revisionDate: "2025-04-22",
        issueDate: "2025-04-23",
        reviewedBy: "Bob",
        approvedBy: "Carol",
      },
    ]);
  });

  it("emits bdbMetadata with only touched fields (incl. isPfbb)", () => {
    let m = setBdbField(EMPTY_EDITS, 45, "name", "New", "Old");
    m = setBdbField(m, 45, "isPfbb", 1, 0);
    expect(toEditRequestList(m)).toEqual([
      {
        target: "bdbMetadata",
        id: 45,
        name: "New",
        isPfbb: 1,
      },
    ]);
  });

  it("emits bdbMetadata with every editable field when all are touched", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    m = setBdbField(m, 45, "name", "N2", "N1");
    m = setBdbField(m, 45, "isPfbb", 1, 0);
    m = setBdbField(m, 45, "createdBy", "Alice", null);
    m = setBdbField(m, 45, "createdByOrganization", "Acme", null);
    m = setBdbField(m, 45, "revision", "B", "A");
    m = setBdbField(m, 45, "revisionDate", "2025-04-22", null);
    m = setBdbField(m, 45, "issueDate", "2025-04-23", null);
    m = setBdbField(m, 45, "reviewedBy", "Bob", null);
    m = setBdbField(m, 45, "approvedBy", "Carol", null);

    expect(toEditRequestList(m)).toEqual([
      {
        target: "bdbMetadata",
        id: 45,
        name: "N2",
        isPfbb: 1,
        createdBy: "Alice",
        createdByOrganization: "Acme",
        revision: "B",
        revisionDate: "2025-04-22",
        issueDate: "2025-04-23",
        reviewedBy: "Bob",
        approvedBy: "Carol",
      },
    ]);
  });

  it("sorts work-area metadata after project, BDB metadata after work-area, each kind by id", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    // Intentionally scrambled insertion order.
    m = setBdbField(m, 46, "name", "B46", "Old");
    m = setWorkSpecField(m, 13, "workAreaName", "W13", "Old");
    m = setBdbField(m, 45, "name", "B45", "Old");
    m = setWorkSpecField(m, 12, "workAreaName", "W12", "Old");
    m = setProjectField(m, "proj-guid", "name", "P", "Old");
    m = setContractName(m, 1, "C1", "Old");
    m = setSectionBody(m, "workSpec", 1, "<p>w1</p>", "");

    expect(toEditRequestList(m).map((e) => e.target)).toEqual([
      "workSpec",
      "contractRename",
      "project",
      "workSpecMetadata",
      "workSpecMetadata",
      "bdbMetadata",
      "bdbMetadata",
    ]);

    // And within each kind the ids are ascending.
    const wsIds = toEditRequestList(m)
      .filter((e) => e.target === "workSpecMetadata")
      .map((e) => (e as { id: number }).id);
    const bdbIds = toEditRequestList(m)
      .filter((e) => e.target === "bdbMetadata")
      .map((e) => (e as { id: number }).id);
    expect(wsIds).toEqual([12, 13]);
    expect(bdbIds).toEqual([45, 46]);
  });
});

// ── CP metadata edits (Slice 10F) ──────────────────────────────────

describe("setCpField", () => {
  it("adds a patch when a field changes", () => {
    const m = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    expect(isCpMetadataEdited(m, 9)).toBe(true);
    expect(getEffectiveCpField(m, 9, "revision", "A")).toBe("B");
  });

  it("drops the patch when the only changed field reverts to the original", () => {
    let m = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    m = setCpField(m, 9, "revision", "A", "A");
    expect(isCpMetadataEdited(m, 9)).toBe(false);
  });

  it("keeps the patch when one field reverts but another is still touched", () => {
    let m = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    m = setCpField(m, 9, "revisionDate", "2026-04-22", null);
    m = setCpField(m, 9, "revision", "A", "A");
    expect(isCpMetadataEdited(m, 9)).toBe(true);
    expect(getEffectiveCpField(m, 9, "revision", "A")).toBe("A");
    expect(getEffectiveCpField(m, 9, "revisionDate", null)).toBe("2026-04-22");
  });

  it("supports nullable fields: null clears, strings are stored verbatim", () => {
    let m = setCpField(EMPTY_EDITS, 9, "revisionDate", null, "2025-01-01");
    expect(getEffectiveCpField(m, 9, "revisionDate", "2025-01-01")).toBeNull();
    m = setCpField(m, 9, "revision", "C", null);
    expect(getEffectiveCpField(m, 9, "revision", null)).toBe("C");
  });

  it("returns the same map reference when nothing changed", () => {
    const m = setCpField(EMPTY_EDITS, 9, "revision", "A", "A");
    expect(m).toBe(EMPTY_EDITS);
  });

  it("getEffectiveCpField returns the original when no patch exists", () => {
    expect(getEffectiveCpField(EMPTY_EDITS, 9, "revision", "A")).toBe("A");
    expect(
      getEffectiveCpField(EMPTY_EDITS, 9, "revisionDate", null),
    ).toBeNull();
  });

  it("scopes patches by id (two control plans don't collide)", () => {
    let m = setCpField(EMPTY_EDITS, 9, "revision", "A", null);
    m = setCpField(m, 10, "revision", "B", null);
    expect(isCpMetadataEdited(m, 9)).toBe(true);
    expect(isCpMetadataEdited(m, 10)).toBe(true);
  });
});

describe("clearCpMetadataEdit", () => {
  it("drops the patch if present, same reference otherwise", () => {
    const added = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    expect(isCpMetadataEdited(clearCpMetadataEdit(added, 9), 9)).toBe(false);
    expect(clearCpMetadataEdit(EMPTY_EDITS, 9)).toBe(EMPTY_EDITS);
  });
});

describe("toEditRequestList with CP metadata edits", () => {
  it("emits cpMetadata with only touched fields", () => {
    const m = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    expect(toEditRequestList(m)).toEqual([
      { target: "cpMetadata", id: 9, revision: "B" },
    ]);
  });

  it("emits cpMetadata with both fields when both are touched", () => {
    let m = setCpField(EMPTY_EDITS, 9, "revision", "B", "A");
    m = setCpField(m, 9, "revisionDate", "2026-04-22", null);
    expect(toEditRequestList(m)).toEqual([
      {
        target: "cpMetadata",
        id: 9,
        revision: "B",
        revisionDate: "2026-04-22",
      },
    ]);
  });

  it("sorts cpMetadata after bdbMetadata, each kind by id", () => {
    let m: ReturnType<typeof setSectionBody> = EMPTY_EDITS;
    // Intentionally scrambled insertion order.
    m = setCpField(m, 10, "revision", "B", "A");
    m = setBdbField(m, 45, "name", "B45", "Old");
    m = setCpField(m, 9, "revision", "B", "A");
    m = setWorkSpecField(m, 12, "workAreaName", "W12", "Old");

    expect(toEditRequestList(m).map((e) => e.target)).toEqual([
      "workSpecMetadata",
      "bdbMetadata",
      "cpMetadata",
      "cpMetadata",
    ]);

    const cpIds = toEditRequestList(m)
      .filter((e) => e.target === "cpMetadata")
      .map((e) => (e as { id: number }).id);
    expect(cpIds).toEqual([9, 10]);
  });
});
