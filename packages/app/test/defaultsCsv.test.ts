import { describe, it, expect } from "vitest";
import {
  parseContractsCsv,
  parseWorkAreaMapCsv,
} from "../src/shared/defaultsCsv.js";

describe("parseContractsCsv", () => {
  it("parses code,name rows and skips header / comments / blanks", () => {
    const text = [
      "# a comment",
      "code,name",
      "E00,BYGGEPLADS",
      "",
      "E02,MURERARBEJDE",
    ].join("\n");
    const { rows, skipped } = parseContractsCsv(text);
    expect(rows).toEqual([
      { code: "E00", name: "BYGGEPLADS" },
      { code: "E02", name: "MURERARBEJDE" },
    ]);
    expect(skipped).toHaveLength(0);
  });

  it("keeps commas inside the name", () => {
    const { rows } = parseContractsCsv("E09,SANERING, NEDRIVNING");
    expect(rows).toEqual([{ code: "E09", name: "SANERING, NEDRIVNING" }]);
  });

  it("skips rows with no code and reports them", () => {
    const { rows, skipped } = parseContractsCsv(",NoCode\nE01,OK");
    expect(rows).toEqual([{ code: "E01", name: "OK" }]);
    expect(skipped).toHaveLength(1);
  });

  it("keeps the first of a duplicate code and reports the rest", () => {
    const { rows, skipped } = parseContractsCsv("E02,First\nE02,Second");
    expect(rows).toEqual([{ code: "E02", name: "First" }]);
    expect(skipped).toHaveLength(1);
  });
});

describe("parseWorkAreaMapCsv", () => {
  it("parses code,contract rows and ignores a note column + header", () => {
    const text = [
      "molio_workarea_code,contract_code,note",
      "MURER,E02,Murerarbejde",
      "EL,E15",
    ].join("\n");
    const { rows, skipped } = parseWorkAreaMapCsv(text);
    expect(rows).toEqual([
      { workAreaCode: "MURER", contractCode: "E02" },
      { workAreaCode: "EL", contractCode: "E15" },
    ]);
    expect(skipped).toHaveLength(0);
  });

  it("skips incomplete rows (missing contract code)", () => {
    const { rows, skipped } = parseWorkAreaMapCsv("ONLYCODE\nEL,E15");
    expect(rows).toEqual([{ workAreaCode: "EL", contractCode: "E15" }]);
    expect(skipped).toHaveLength(1);
  });

  it("keeps the first of a duplicate work-area code", () => {
    const { rows, skipped } = parseWorkAreaMapCsv("MURER,E02\nMURER,E03");
    expect(rows).toEqual([{ workAreaCode: "MURER", contractCode: "E02" }]);
    expect(skipped).toHaveLength(1);
  });
});
