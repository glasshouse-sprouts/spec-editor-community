/**
 * Tests for cpSlots — pure helpers behind the "New control plan…" slot
 * picker and the "Delete row" confirm-if-populated gate.
 */

import { describe, expect, it } from "vitest";

import type { BdbInfo, ControlPlanRowData } from "../src/shared/ipc.js";
import {
  availableSlots,
  hasFreeSlot,
  rowHasContent,
} from "../src/renderer/src/cpSlots.js";

function makeBdb(controlPlanIds: number[]): BdbInfo {
  return {
    id: 1,
    name: "B",
    workSpecId: null,
    isPfbb: false,
    revision: null,
    revisionDate: null,
    controlPlanIds,
    refs: {
      basisGuid: null,
      basisRevisionGuid: null,
      paradigmGuid: null,
      paradigmRevisionGuid: null,
      referencelistArea: null,
      referencelistAreaDate: null,
    },
  };
}

function makeRow(over: Partial<ControlPlanRowData> = {}): ControlPlanRowData {
  return {
    id: 1,
    headerId: 1,
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
    ...over,
  };
}

describe("availableSlots", () => {
  it("both slots free when BDB has no CPs", () => {
    expect(availableSlots(makeBdb([]))).toEqual({
      design: true,
      production: true,
    });
  });

  it("design filled, production free when only one CP (design)", () => {
    expect(availableSlots(makeBdb([10]))).toEqual({
      design: false,
      production: true,
    });
  });

  it("both filled when two CPs", () => {
    expect(availableSlots(makeBdb([10, 20]))).toEqual({
      design: false,
      production: false,
    });
  });
});

describe("hasFreeSlot", () => {
  it("true if any slot free", () => {
    expect(hasFreeSlot(makeBdb([]))).toBe(true);
    expect(hasFreeSlot(makeBdb([1]))).toBe(true);
  });
  it("false if both full", () => {
    expect(hasFreeSlot(makeBdb([1, 2]))).toBe(false);
  });
});

describe("rowHasContent", () => {
  it("blank row = no content", () => {
    expect(rowHasContent(makeRow())).toBe(false);
  });

  it("any non-empty text column counts as content", () => {
    expect(rowHasContent(makeRow({ subject: "something" }))).toBe(true);
    expect(rowHasContent(makeRow({ acceptanceCriteria: "x" }))).toBe(true);
  });

  it("whitespace alone doesn't count", () => {
    expect(rowHasContent(makeRow({ subject: "   " }))).toBe(false);
  });

  it("a non-zero controlType counts as content", () => {
    expect(rowHasContent(makeRow({ controlType: 1 }))).toBe(true);
    expect(rowHasContent(makeRow({ controlType: 3 }))).toBe(true);
  });

  it("controlType 0 alone doesn't count", () => {
    expect(rowHasContent(makeRow({ controlType: 0 }))).toBe(false);
  });
});
