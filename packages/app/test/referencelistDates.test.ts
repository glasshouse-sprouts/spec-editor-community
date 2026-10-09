/**
 * Task 155 phase C - the renderer-side date helpers.
 *
 * Two jobs:
 *
 *  1. Self-check C2: the condition for the "should they get the new
 *     date too?" dialog. The dialog costs the user attention, so it
 *     must appear exactly when there is a decision to make and never
 *     otherwise.
 *  2. Keep the mirrored `isIsoDateOnly` honest. The renderer cannot
 *     import `@molio2-editor/core`, so the predicate exists twice;
 *     the last test here runs BOTH over the same inputs and requires
 *     the same answer. App tests run in Node, so importing core here
 *     is fine - it is only the renderer BUNDLE that must not.
 */
import {
  isIsoDateOnly as coreIsIsoDateOnly,
  resolveReferencelistDate as coreResolveReferencelistDate,
} from "@molio2-editor/core";
import { describe, expect, it } from "vitest";

import {
  findReferencelistDateCascade,
  isIsoDateOnly,
  isUnreadableDate,
  resolveReferencelistDateOnly,
  type ReferencelistDateRow,
} from "../src/renderer/src/referencelistDates.js";

function row(
  kind: "workSpec" | "bdb",
  id: number,
  date: string | null,
  /** Defaults to the same value - the rule ignores it either way. */
  diskDate: string | null = date,
): ReferencelistDateRow {
  return { kind, id, name: `${kind} ${id}`, date, diskDate };
}

describe("findReferencelistDateCascade", () => {
  it("asks about nothing when no row has its own date", () => {
    // The real state of every file measured on 2026-10-02: the
    // area-level column is NULL in all 240 of them. So this is the
    // case that must stay silent.
    const rows = [
      row("workSpec", 1, null),
      row("workSpec", 2, ""),
      row("bdb", 10, "   "),
    ];
    expect(findReferencelistDateCascade(rows, "2026-06-01")).toEqual([]);
  });

  it("asks about nothing when every own date already equals the new one", () => {
    const rows = [
      row("workSpec", 1, "2026-06-01"),
      row("bdb", 10, "2026-06-01"),
    ];
    expect(findReferencelistDateCascade(rows, "2026-06-01")).toEqual([]);
  });

  it("asks about the rows whose own date differs", () => {
    const rows = [
      row("workSpec", 1, "2024-11-20"), // differs -> asked about
      row("workSpec", 2, null), // inherits -> never asked about
      row("bdb", 10, "2026-06-01"), // already the new date
      row("bdb", 11, "2025-01-01"), // differs -> asked about
    ];
    const out = findReferencelistDateCascade(rows, "2026-06-01");
    expect(out.map((r) => [r.kind, r.id])).toEqual([
      ["workSpec", 1],
      ["bdb", 11],
    ]);
  });

  it("asks about rows with their own date when the project date is cleared", () => {
    // Clearing the project date is still a change: a row holding its
    // own date keeps overriding nothing in particular, and the user
    // should get the choice to clear those too.
    const rows = [row("workSpec", 1, "2024-11-20"), row("bdb", 10, null)];
    const out = findReferencelistDateCascade(rows, null);
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it("counts free text as different from any date", () => {
    // A row holding "20. november 2024" is not on the new date in any
    // reading of it, so offering to replace it is right.
    const rows = [row("bdb", 10, "20. november 2024")];
    expect(findReferencelistDateCascade(rows, "2026-06-01")).toHaveLength(1);
  });

  it("ignores surrounding whitespace on both sides of the comparison", () => {
    const rows = [row("workSpec", 1, "  2026-06-01  ")];
    expect(findReferencelistDateCascade(rows, "2026-06-01")).toEqual([]);
  });

  it("judges by the effective date, and carries the disk value along", () => {
    // A staged-but-unsaved date is what the user sees, so it is what
    // decides. The disk value rides along untouched, because staging
    // the cascade needs it: the edit helpers read "equals the
    // original" as a revert.
    const rows = [row("bdb", 10, "2025-01-01", null)];
    const out = findReferencelistDateCascade(rows, "2026-06-01");
    expect(out).toHaveLength(1);
    expect(out[0]?.date).toBe("2025-01-01");
    expect(out[0]?.diskDate).toBeNull();
  });
});

describe("isUnreadableDate", () => {
  it("is true only for a value that is present and not a date", () => {
    expect(isUnreadableDate("20. november 2024")).toBe(true);
    expect(isUnreadableDate("2026-02-30")).toBe(true);
    // Blank is not "unreadable" - it means inherit, and the field
    // shows a date picker rather than a warning.
    expect(isUnreadableDate("")).toBe(false);
    expect(isUnreadableDate("   ")).toBe(false);
    expect(isUnreadableDate(null)).toBe(false);
    expect(isUnreadableDate("2024-11-20")).toBe(false);
  });
});

describe("isIsoDateOnly stays in step with core's copy", () => {
  it("gives the same answer as core for every input we can think of", () => {
    const inputs = [
      "2024-11-20",
      "2026-05-20",
      "2024-02-29",
      "2025-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
      "2026-1-01",
      "2026-01-1",
      "  2024-11-20  ",
      "2024-11-20T10:00:00Z",
      "20-11-2024",
      "2024/11/20",
      "20. november 2024",
      "",
      "   ",
      "ikke sat",
      "0001-01-01",
      "9999-12-31",
    ];
    for (const value of inputs) {
      expect([value, isIsoDateOnly(value)]).toEqual([
        value,
        coreIsIsoDateOnly(value),
      ]);
    }
    expect(isIsoDateOnly(null)).toBe(coreIsIsoDateOnly(null));
    expect(isIsoDateOnly(undefined)).toBe(coreIsIsoDateOnly(undefined));
  });
});

describe("resolveReferencelistDateOnly mirrors core (Task 184)", () => {
  const cases: Array<[string | null, string | null, string | null]> = [
    ["2024-03-03", "2025-06-01", "2026-01-01"], // BDB wins
    [null, "2025-06-01", "2026-01-01"], // work area wins
    ["", "  ", "2026-01-01"], // blanks inherit
    [null, null, null], // nothing anywhere
    ["31.11.2023", null, "2026-01-01"], // unreadable is skipped
    ["2026-02-30", "2025-06-01", null], // not a real date
    [" 2024-03-03 ", null, null], // trimmed
  ];
  for (const [bdb, wa, project] of cases) {
    it(`same date as core for [${bdb}, ${wa}, ${project}]`, () => {
      const core = coreResolveReferencelistDate([
        { source: "bdb", value: bdb },
        { source: "workArea", value: wa },
        { source: "project", value: project },
      ]);
      expect(resolveReferencelistDateOnly([bdb, wa, project])).toBe(core.date);
    });
  }
});
