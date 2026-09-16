import { describe, expect, it } from "vitest";

import type { ContractInfo, WorkSpecInfo } from "../src/shared/ipc.js";
import {
  groupWorkSpecsByContract,
  sidebarContractLabel,
} from "../src/renderer/src/Sidebar.js";

/** Minimal factory so each test can describe the rows it cares about. */
function ws(
  id: number,
  workAreaCode: string | null,
  workAreaName: string,
  contractId: number | null,
): WorkSpecInfo {
  return {
    id,
    workAreaCode,
    workAreaName,
    contractId,
  } as WorkSpecInfo;
}
function c(id: number, code: string | null, name: string | null): ContractInfo {
  return { id, contractCode: code, contractName: name };
}

/** Default pass-throughs — use raw data. */
const raw = {
  getEffectiveCode: (x: ContractInfo) => x.contractCode,
  getEffectiveName: (x: ContractInfo) => x.contractName,
  getEffectiveContractId: (x: WorkSpecInfo) => x.contractId,
};

describe("sidebarContractLabel", () => {
  it("joins code and name with ' - '", () => {
    expect(sidebarContractLabel("E00", "Generelle beskrivelser")).toBe(
      "E00 - Generelle beskrivelser",
    );
  });

  it("shows only the non-blank half when one is missing", () => {
    expect(sidebarContractLabel("E00", null)).toBe("E00");
    expect(sidebarContractLabel(null, "Kun navn")).toBe("Kun navn");
    expect(sidebarContractLabel("  ", "Kun navn")).toBe("Kun navn");
  });

  it("falls back to a placeholder when both are blank", () => {
    expect(sidebarContractLabel(null, null)).toBe("(unnamed contract)");
    expect(sidebarContractLabel("", "   ")).toBe("(unnamed contract)");
  });
});

describe("groupWorkSpecsByContract", () => {
  it("groups work areas under their contract and sorts groups by code", () => {
    const contracts = [c(10, "E02", "Later"), c(20, "E01", "Earlier")];
    const workSpecs = [
      ws(1, "BI 3", "Three", 10),
      ws(2, "BI 1", "One", 20),
      ws(3, "BI 2", "Two", 20),
    ];
    const groups = groupWorkSpecsByContract({ contracts, workSpecs, ...raw });
    // Ordered by contract code: E01 before E02
    expect(groups.map((g) => g.contractId)).toEqual([20, 10]);
    // Work areas within a group sort by workAreaCode natural-asc
    expect(groups[0].workSpecs.map((w) => w.workAreaCode)).toEqual([
      "BI 1",
      "BI 2",
    ]);
    expect(groups[1].workSpecs.map((w) => w.workAreaCode)).toEqual(["BI 3"]);
  });

  it("builds each group's label via sidebarContractLabel", () => {
    const contracts = [c(1, "E00", "Generelle beskrivelser")];
    const groups = groupWorkSpecsByContract({
      contracts,
      workSpecs: [],
      ...raw,
    });
    expect(groups[0].label).toBe("E00 - Generelle beskrivelser");
    expect(groups[0].code).toBe("E00");
  });

  it("puts the 'no contract' bucket last, and only when it has rows", () => {
    const contracts = [c(1, "E00", "A"), c(2, "E01", "B")];
    const withNone = groupWorkSpecsByContract({
      contracts,
      workSpecs: [ws(1, "A", "a", null)],
      ...raw,
    });
    expect(withNone[withNone.length - 1].contractId).toBeNull();
    expect(withNone[withNone.length - 1].label).toBe("[No contract]");

    const withoutNone = groupWorkSpecsByContract({
      contracts,
      workSpecs: [ws(1, "A", "a", 1)],
      ...raw,
    });
    expect(withoutNone.every((g) => g.contractId !== null)).toBe(true);
  });

  it("keeps empty contract groups visible", () => {
    const contracts = [c(1, "E00", "A"), c(2, "E01", "B")];
    const groups = groupWorkSpecsByContract({
      contracts,
      workSpecs: [ws(1, "A", "a", 1)], // only E00 has assignments
      ...raw,
    });
    const e01 = groups.find((g) => g.contractId === 2);
    expect(e01).toBeDefined();
    expect(e01!.workSpecs).toEqual([]);
  });

  it("reflects effective reassignment (buffered edit)", () => {
    const contracts = [c(1, "E00", "A"), c(2, "E01", "B")];
    const workSpecs = [ws(1, "A", "a", 1)];
    // Buffer says: move work spec #1 from contract 1 → contract 2.
    const groups = groupWorkSpecsByContract({
      contracts,
      workSpecs,
      ...raw,
      getEffectiveContractId: (w) => (w.id === 1 ? 2 : w.contractId),
    });
    const e00 = groups.find((g) => g.contractId === 1);
    const e01 = groups.find((g) => g.contractId === 2);
    expect(e00!.workSpecs).toEqual([]);
    expect(e01!.workSpecs.map((w) => w.id)).toEqual([1]);
  });

  it("reflects effective contract rename (buffered edit)", () => {
    const contracts = [c(1, "E00", "Original")];
    // Buffer says: rename contract 1 to "Renamed".
    const groups = groupWorkSpecsByContract({
      contracts,
      workSpecs: [],
      ...raw,
      getEffectiveName: () => "Renamed",
    });
    expect(groups[0].label).toBe("E00 - Renamed");
  });

  it("keeps orphaned contract IDs visible", () => {
    // Work spec assigned to contract id 999 which no longer exists in
    // the contracts list — should still render under a synthetic group
    // so the user can see + fix it.
    const groups = groupWorkSpecsByContract({
      contracts: [c(1, "E00", "A")],
      workSpecs: [ws(1, "A", "a", 999)],
      ...raw,
    });
    const orphan = groups.find((g) => g.contractId === 999);
    expect(orphan).toBeDefined();
    expect(orphan!.label).toMatch(/unknown contract/i);
  });

  it("sorts contracts without codes to the bottom, then tie-breaks by name", () => {
    const contracts = [
      c(1, null, "Zebra"),
      c(2, "E00", "A"),
      c(3, null, "Alpha"),
    ];
    const groups = groupWorkSpecsByContract({
      contracts,
      workSpecs: [],
      ...raw,
    });
    expect(groups.map((g) => g.contractId)).toEqual([2, 3, 1]);
  });
});
