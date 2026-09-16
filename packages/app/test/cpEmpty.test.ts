import { describe, it, expect } from "vitest";
import {
  cpRowHasContent,
  controlPlanIsEmpty,
  type CpEmptyRow,
} from "../src/shared/cpEmpty.js";

// A fully blank row (every meaningful field empty, control type 0).
function blankRow(over: Partial<CpEmptyRow> = {}): CpEmptyRow {
  return {
    controlType: 0,
    subject: "",
    reference: "",
    method: "",
    quantity: "",
    time: "",
    acceptanceCriteria: "",
    documentation: "",
    controlLevel: "",
    sampleLevel: "",
    ...over,
  };
}

describe("cpRowHasContent", () => {
  it("is false for a fully blank row", () => {
    expect(cpRowHasContent(blankRow())).toBe(false);
  });

  it("is false for whitespace-only text", () => {
    expect(cpRowHasContent(blankRow({ subject: "   " }))).toBe(false);
  });

  it("is true when any meaningful column has text", () => {
    expect(cpRowHasContent(blankRow({ subject: "Beton" }))).toBe(true);
    expect(cpRowHasContent(blankRow({ method: "Visuel" }))).toBe(true);
  });

  it("is true when a control type is selected", () => {
    expect(cpRowHasContent(blankRow({ controlType: 1 }))).toBe(true);
  });

  it("is false for angle-bracket template placeholders", () => {
    expect(cpRowHasContent(blankRow({ subject: "<Emne 1>" }))).toBe(false);
    expect(cpRowHasContent(blankRow({ reference: "<Reference>" }))).toBe(false);
    expect(cpRowHasContent(blankRow({ method: "  <Metode 2>  " }))).toBe(false);
  });
});

describe("controlPlanIsEmpty", () => {
  it("is true when there are no rows", () => {
    expect(controlPlanIsEmpty([])).toBe(true);
  });

  it("is true when every row is a blank skeleton row", () => {
    expect(controlPlanIsEmpty([blankRow(), blankRow()])).toBe(true);
  });

  it("is true when rows only contain template placeholders", () => {
    expect(
      controlPlanIsEmpty([
        blankRow({ subject: "<Emne 1>", method: "<Metode 1>" }),
        blankRow(),
      ]),
    ).toBe(true);
  });

  it("is false when at least one row has content", () => {
    expect(controlPlanIsEmpty([blankRow(), blankRow({ subject: "x" })])).toBe(
      false,
    );
  });
});
