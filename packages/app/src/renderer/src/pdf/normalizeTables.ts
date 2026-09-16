/**
 * Make pdfmake tables safe to render (EXPORT-Hang fix).
 *
 * Why this exists
 * ---------------
 * `html-to-pdfmake` can emit a table whose rows are NOT all the same
 * length, or that contains an `undefined`/`null` cell (a "hole"). When
 * pdfmake tries to measure such a table it throws
 *   "Malformed table row, a cell is undefined."
 * That throw happens inside pdfmake's internal promise chain, so the
 * `getBuffer` callback never fires — the export PROMISE never settles
 * and the whole export FREEZES (see renderPdf.ts / STATUS EXPORT-Hang).
 *
 * What it does
 * ------------
 * Walks the pdfmake content tree and rewrites every table `body` to be
 * rectangular: every row padded to the widest row's length, and every
 * missing / `undefined` / `null` cell replaced with an empty cell
 * (`{ text: "" }`). If the table carries a `widths` array, its length is
 * matched to the column count (padded with `"*"`, or trimmed). Tables
 * that are already well-formed are left untouched.
 *
 * Pure: it only reshapes plain data (no pdfmake runtime, no DOM), so it
 * is unit-tested directly. Mutates the passed tree in place (the tree
 * comes fresh out of html-to-pdfmake) and returns it for chaining.
 */

import type { Content } from "pdfmake/interfaces";

/** Normalize every table in a pdfmake content tree. Returns the same node. */
export function normalizePdfmakeTables<T extends Content>(node: T): T {
  visit(node);
  return node;
}

function visit(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const table = obj.table;
  if (
    table !== null &&
    typeof table === "object" &&
    Array.isArray((table as Record<string, unknown>).body)
  ) {
    rectangularize(table as { body: unknown[]; widths?: unknown });
  }

  // Recurse into every value so tables nested inside stacks, columns,
  // list items or other table cells are reached too. Primitive leaves
  // (strings, numbers) are skipped by the guards at the top of visit().
  for (const key of Object.keys(obj)) {
    visit(obj[key]);
  }
}

function rectangularize(table: { body: unknown[]; widths?: unknown }): void {
  const body = table.body;

  let maxCols = 0;
  for (const row of body) {
    if (Array.isArray(row)) maxCols = Math.max(maxCols, row.length);
  }
  // All rows empty / non-array: nothing sensible to pad to. Leave as-is.
  if (maxCols === 0) return;

  for (let r = 0; r < body.length; r++) {
    let row = body[r];
    if (!Array.isArray(row)) {
      row = [];
      body[r] = row;
    }
    const cells = row as unknown[];
    for (let c = 0; c < maxCols; c++) {
      if (cells[c] === undefined || cells[c] === null) {
        cells[c] = { text: "" };
      }
    }
  }

  // Keep `widths` in step with the column count (pdfmake needs them to
  // match). Pad short with "*" (equal share), trim any extras.
  if (Array.isArray(table.widths)) {
    const widths = table.widths as unknown[];
    while (widths.length < maxCols) widths.push("*");
    if (widths.length > maxCols) widths.length = maxCols;
  }
}
