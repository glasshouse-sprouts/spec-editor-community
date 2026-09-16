import { describe, expect, it } from "vitest";

import type {
  ControlPlanHeaderData,
  ControlPlanRowData,
} from "../src/shared/ipc.js";
import {
  controlTypeBadge,
  controlTypeClass,
  controlTypeLabel,
  groupRowsByHeader,
  nextHeaderNo,
} from "../src/renderer/src/controlPlanView.js";

/** Build a minimal row with just the fields the helpers care about. */
function row(partial: Partial<ControlPlanRowData>): ControlPlanRowData {
  return {
    id: 0,
    headerId: 0,
    controlType: 0,
    sectionNo: "",
    subject: "",
    reference: "",
    method: "",
    quantity: "",
    time: "",
    acceptanceCriteria: "",
    documentation: "",
    controlLevel: "",
    sampleLevel: "",
    ...partial,
  };
}

function hdr(
  id: number,
  headerNo: string,
  header = `H${id}`,
): ControlPlanHeaderData {
  return { id, headerNo, header };
}

describe("groupRowsByHeader", () => {
  it("buckets rows under the matching header in header order", () => {
    const headers = [hdr(1, "1", "Udførelse"), hdr(2, "2", "Kvalitet")];
    const rows = [
      row({ id: 10, headerId: 1, sectionNo: "1.1" }),
      row({ id: 11, headerId: 2, sectionNo: "2.1" }),
      row({ id: 12, headerId: 1, sectionNo: "1.2" }),
    ];
    const groups = groupRowsByHeader(headers, rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.header.id).toBe(1);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual([10, 12]);
    expect(groups[1]!.header.id).toBe(2);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual([11]);
  });

  it("includes empty headers with no rows", () => {
    const headers = [hdr(1, "1"), hdr(2, "2")];
    const rows = [row({ id: 10, headerId: 1 })];
    const groups = groupRowsByHeader(headers, rows);
    expect(groups[1]!.rows).toEqual([]);
  });

  it("collects orphan rows into a trailing '(no header)' group", () => {
    const headers = [hdr(1, "1")];
    const rows = [
      row({ id: 10, headerId: 1 }),
      row({ id: 99, headerId: 404, sectionNo: "?" }),
    ];
    const groups = groupRowsByHeader(headers, rows);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.header.id).toBe(-1);
    expect(groups[1]!.header.header).toBe("(no header)");
    expect(groups[1]!.rows.map((r) => r.id)).toEqual([99]);
  });

  it("does not add the orphan group when everything resolves", () => {
    const headers = [hdr(1, "1")];
    const rows = [row({ id: 10, headerId: 1 })];
    const groups = groupRowsByHeader(headers, rows);
    expect(groups).toHaveLength(1);
  });

  it("preserves the input row order inside each group (no internal sort)", () => {
    // Main process pre-sorts by sectionNo; the helper must not re-order.
    const headers = [hdr(1, "1")];
    const rows = [
      row({ id: 10, headerId: 1, sectionNo: "1.3" }),
      row({ id: 11, headerId: 1, sectionNo: "1.1" }),
      row({ id: 12, headerId: 1, sectionNo: "1.2" }),
    ];
    expect(
      groupRowsByHeader(headers, rows)[0]!.rows.map((r) => r.sectionNo),
    ).toEqual(["1.3", "1.1", "1.2"]);
  });
});

describe("controlTypeBadge", () => {
  it("returns E/U/T for the three selected types", () => {
    expect(controlTypeBadge(1)).toBe("E");
    expect(controlTypeBadge(2)).toBe("U");
    expect(controlTypeBadge(3)).toBe("T");
  });

  it("returns an em-dash for 'not selected' and unknown values", () => {
    expect(controlTypeBadge(0)).toBe("—");
    expect(controlTypeBadge(42)).toBe("—");
  });
});

describe("controlTypeLabel", () => {
  it("gives a human label per type", () => {
    expect(controlTypeLabel(1)).toMatch(/Egenkontrol/);
    expect(controlTypeLabel(2)).toMatch(/Uafh/);
    expect(controlTypeLabel(3)).toMatch(/Tredjepart/);
  });
  it("falls back to 'Not selected' for 0 and unknown", () => {
    expect(controlTypeLabel(0)).toBe("Not selected");
    expect(controlTypeLabel(99)).toBe("Not selected");
  });
});

describe("controlTypeClass", () => {
  it("returns a distinct class per type", () => {
    const classes = [1, 2, 3].map(controlTypeClass);
    expect(new Set(classes).size).toBe(3);
  });
  it("returns the 'none' class for 0 and unknown", () => {
    expect(controlTypeClass(0)).toBe("cp-pill--none");
    expect(controlTypeClass(99)).toBe("cp-pill--none");
  });
});

describe("nextHeaderNo (Task 89 — Add section)", () => {
  /** Minimal header — only `headerNo` matters to this helper. */
  const h = (headerNo: string): ControlPlanHeaderData => ({
    id: 0,
    header: "",
    headerNo,
  });

  it("starts at 1 for a plan with no sections", () => {
    expect(nextHeaderNo([])).toBe("1");
  });

  it("appends after the highest existing number", () => {
    expect(nextHeaderNo([h("1")])).toBe("2");
    expect(nextHeaderNo([h("1"), h("2")])).toBe("3");
  });

  it("uses the highest number, not the last one in the list", () => {
    expect(nextHeaderNo([h("3"), h("1")])).toBe("4");
  });

  it("reads the leading integer of a dotted number", () => {
    expect(nextHeaderNo([h("1"), h("2.1")])).toBe("3");
  });

  it("ignores non-numeric and blank section numbers", () => {
    expect(nextHeaderNo([h("A"), h(""), h("  ")])).toBe("1");
    expect(nextHeaderNo([h("A"), h("2")])).toBe("3");
  });

  it("returns a string — header_no is TEXT in the schema", () => {
    expect(typeof nextHeaderNo([h("1")])).toBe("string");
  });
});
