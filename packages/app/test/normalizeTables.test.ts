/**
 * Tests for normalizePdfmakeTables (EXPORT-Hang fix). Pure data reshaping
 * — no pdfmake runtime, no DOM.
 */

import { describe, expect, it } from "vitest";

import { normalizePdfmakeTables } from "../src/renderer/src/pdf/normalizeTables.js";

// The helper takes pdfmake Content; tests use loose shapes, so cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const norm = (n: any): any => normalizePdfmakeTables(n);

const EMPTY = { text: "" };

describe("normalizePdfmakeTables — ragged + holes", () => {
  it("pads a short row to the widest row's length", () => {
    const node = norm({ table: { body: [[{ text: "a" }, { text: "b" }], [{ text: "c" }]] } });
    expect(node.table.body).toEqual([
      [{ text: "a" }, { text: "b" }],
      [{ text: "c" }, EMPTY],
    ]);
  });

  it("fills an undefined cell (the reported 'cell is undefined' case)", () => {
    const node = norm({ table: { body: [[{ text: "a" }, { text: "b" }], [{ text: "c" }, undefined]] } });
    expect(node.table.body[1][1]).toEqual(EMPTY);
  });

  it("fills a null cell", () => {
    const node = norm({ table: { body: [[{ text: "a" }], [null]] } });
    expect(node.table.body[1][0]).toEqual(EMPTY);
  });

  it("replaces a non-array row with a padded empty row", () => {
    const node = norm({ table: { body: [[{ text: "a" }, { text: "b" }], undefined] } });
    expect(node.table.body[1]).toEqual([EMPTY, EMPTY]);
  });
});

describe("normalizePdfmakeTables — nesting", () => {
  it("normalizes a table inside a stack", () => {
    const node = norm({ stack: [{ table: { body: [[{ text: "a" }, { text: "b" }], [{ text: "c" }]] } }] });
    expect(node.stack[0].table.body[1]).toEqual([{ text: "c" }, EMPTY]);
  });

  it("normalizes a table nested inside a table cell", () => {
    const inner = { table: { body: [[{ text: "x" }, { text: "y" }], [{ text: "z" }]] } };
    const node = norm({ table: { body: [[inner, { text: "b" }]] } });
    expect(node.table.body[0][0].table.body[1]).toEqual([{ text: "z" }, EMPTY]);
  });

  it("normalizes tables inside a top-level content array", () => {
    const node = norm([{ text: "hi" }, { table: { body: [[{ text: "a" }, { text: "b" }], [{ text: "c" }]] } }]);
    expect(node[1].table.body[1]).toEqual([{ text: "c" }, EMPTY]);
  });
});

describe("normalizePdfmakeTables — widths", () => {
  it("pads widths to the column count with '*'", () => {
    const node = norm({ table: { widths: [10], body: [[{ text: "a" }, { text: "b" }], [{ text: "c" }]] } });
    expect(node.table.widths).toEqual([10, "*"]);
  });

  it("trims extra widths to the column count", () => {
    const node = norm({ table: { widths: [10, 20, 30], body: [[{ text: "a" }, { text: "b" }]] } });
    expect(node.table.widths).toEqual([10, 20]);
  });
});

describe("normalizePdfmakeTables — leaves things alone", () => {
  it("preserves string and number cells", () => {
    const node = norm({ table: { body: [["a", 1], ["b"]] } });
    expect(node.table.body).toEqual([["a", 1], ["b", EMPTY]]);
  });

  it("does not touch a well-formed table", () => {
    const body = [[{ text: "a" }, { text: "b" }], [{ text: "c" }, { text: "d" }]];
    const node = norm({ table: { widths: ["*", "*"], body } });
    expect(node.table.body).toEqual([[{ text: "a" }, { text: "b" }], [{ text: "c" }, { text: "d" }]]);
    expect(node.table.widths).toEqual(["*", "*"]);
  });

  it("returns non-table content unchanged", () => {
    expect(norm({ text: "hello" })).toEqual({ text: "hello" });
    expect(norm("plain string")).toEqual("plain string");
  });

  it("returns the same node reference (mutates in place)", () => {
    const node = { table: { body: [[{ text: "a" }]] } };
    expect(normalizePdfmakeTables(node as never)).toBe(node);
  });
});
