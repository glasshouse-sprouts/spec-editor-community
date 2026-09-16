import { describe, it, expect } from "vitest";
import { pickLandingContract } from "../src/renderer/src/importPlan.js";
import type { ContractInfo } from "../src/shared/ipc.js";

const c = (id: number, code: string | null, name = ""): ContractInfo => ({
  id,
  contractCode: code,
  contractName: name,
});

const target = [c(10, "E02", "Murer"), c(11, "E15", "El")];
const mapping = [{ workAreaCode: "MURER", contractCode: "E02" }];

describe("pickLandingContract", () => {
  it("lands via the mapping when the mapped contract exists", () => {
    expect(
      pickLandingContract({
        workAreaCode: "MURER",
        mapping,
        sourceContractId: null,
        sourceContracts: [],
        targetContracts: target,
      }),
    ).toBe(10);
  });

  it("matches the work-area code case-insensitively", () => {
    expect(
      pickLandingContract({
        workAreaCode: "murer",
        mapping,
        sourceContractId: null,
        sourceContracts: [],
        targetContracts: target,
      }),
    ).toBe(10);
  });

  it("falls back (null) when nothing matches", () => {
    expect(
      pickLandingContract({
        workAreaCode: "UNKNOWN",
        mapping,
        sourceContractId: null,
        sourceContracts: [],
        targetContracts: target,
      }),
    ).toBe(null);
  });

  it("falls back when the mapped contract is absent in the target", () => {
    expect(
      pickLandingContract({
        workAreaCode: "MURER",
        mapping: [{ workAreaCode: "MURER", contractCode: "E99" }],
        sourceContractId: null,
        sourceContracts: [],
        targetContracts: target,
      }),
    ).toBe(null);
  });

  it("falls back to the source-contract match when there is no code", () => {
    expect(
      pickLandingContract({
        workAreaCode: null,
        mapping,
        sourceContractId: 1,
        sourceContracts: [c(1, "E02", "Murer")],
        targetContracts: target,
      }),
    ).toBe(10);
  });
});
