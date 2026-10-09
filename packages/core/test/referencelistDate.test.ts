/**
 * Task 155 - the fiksdato conversion.
 *
 * The whole point of this function is that it must be right on four
 * days a year nobody tests by hand: the two DST switch days and the
 * days either side of them. The expected values below are not copied
 * from the implementation - they are what the Europe/Copenhagen
 * offset is on those dates (+01:00 in winter, +02:00 in summer), so
 * a wrong implementation cannot make them pass.
 */
import { describe, expect, it } from "vitest";

import {
  danishDayEndToVersionDate,
  isIsoDateOnly,
  resolveReferencelistDate,
} from "../src/referencelistDate.js";

describe("danishDayEndToVersionDate", () => {
  it("sends the last millisecond of a winter day (UTC+1)", () => {
    // 2024-11-20 23:59:59.999 Danish time = 22:59:59.999Z.
    // This is the baseline date on task card 155.
    expect(danishDayEndToVersionDate("2024-11-20")).toBe(
      "2024-11-20T22:59:59.999Z",
    );
  });

  it("sends the last millisecond of a summer day (UTC+2)", () => {
    expect(danishDayEndToVersionDate("2026-05-20")).toBe(
      "2026-05-20T21:59:59.999Z",
    );
  });

  it("gets the spring switch day right (clocks go forward 2026-03-29)", () => {
    // The switch happens at 02:00 local, so by 23:59 the day is
    // already on summer time: UTC+2.
    expect(danishDayEndToVersionDate("2026-03-28")).toBe(
      "2026-03-28T22:59:59.999Z",
    );
    expect(danishDayEndToVersionDate("2026-03-29")).toBe(
      "2026-03-29T21:59:59.999Z",
    );
  });

  it("gets the autumn switch day right (clocks go back 2026-10-25)", () => {
    // The switch happens at 03:00 local, so by 23:59 the day is
    // already back on winter time: UTC+1.
    expect(danishDayEndToVersionDate("2026-10-24")).toBe(
      "2026-10-24T21:59:59.999Z",
    );
    expect(danishDayEndToVersionDate("2026-10-25")).toBe(
      "2026-10-25T22:59:59.999Z",
    );
  });

  it("always lands on the same calendar day in UTC", () => {
    // Why this matters: if the server compares on date alone rather
    // than on the timestamp, the UTC date must still be the Danish
    // date. One day per month across a year is enough to catch a
    // sign error or an off-by-one-day offset.
    for (let month = 1; month <= 12; month++) {
      const day = `2026-${String(month).padStart(2, "0")}-15`;
      const out = danishDayEndToVersionDate(day);
      expect(out?.slice(0, 10)).toBe(day);
    }
  });

  it("treats an unusable value as no date at all", () => {
    expect(danishDayEndToVersionDate(null)).toBeNull();
    expect(danishDayEndToVersionDate(undefined)).toBeNull();
    expect(danishDayEndToVersionDate("")).toBeNull();
    expect(danishDayEndToVersionDate("   ")).toBeNull();
    // Free text: the project field was never validated before Task 155.
    expect(danishDayEndToVersionDate("20. november 2024")).toBeNull();
    expect(danishDayEndToVersionDate("20-11-2024")).toBeNull();
    expect(danishDayEndToVersionDate("2024/11/20")).toBeNull();
    // A full timestamp is NOT accepted: the field holds a date, and
    // silently keeping someone's clock time would change which list
    // the lookup returns.
    expect(danishDayEndToVersionDate("2024-11-20T10:00:00Z")).toBeNull();
    // Shaped like a date, but not a day that exists.
    expect(danishDayEndToVersionDate("2026-02-30")).toBeNull();
    expect(danishDayEndToVersionDate("2026-13-01")).toBeNull();
    expect(danishDayEndToVersionDate("2026-00-10")).toBeNull();
  });

  it("accepts surrounding whitespace", () => {
    expect(danishDayEndToVersionDate("  2024-11-20  ")).toBe(
      "2024-11-20T22:59:59.999Z",
    );
  });
});

describe("isIsoDateOnly", () => {
  it("accepts real YYYY-MM-DD dates and nothing else", () => {
    expect(isIsoDateOnly("2026-05-20")).toBe(true);
    expect(isIsoDateOnly("2024-02-29")).toBe(true); // leap year
    expect(isIsoDateOnly("2025-02-29")).toBe(false); // not a leap year
    expect(isIsoDateOnly("2026-5-20")).toBe(false);
    expect(isIsoDateOnly("")).toBe(false);
    expect(isIsoDateOnly(null)).toBe(false);
  });
});

describe("resolveReferencelistDate", () => {
  it("returns no date when every level is blank", () => {
    expect(
      resolveReferencelistDate([
        { source: "bdb", value: null },
        { source: "workArea", value: "" },
        { source: "project", value: undefined },
      ]),
    ).toEqual({
      date: null,
      versionDate: null,
      source: null,
      invalid: [],
    });
  });

  it("uses the project date when it is the only one set", () => {
    // Phase B's situation, and the real one: the area-level column is
    // NULL in all 240 files measured on 2026-10-02.
    expect(
      resolveReferencelistDate([{ source: "project", value: "2024-11-20" }]),
    ).toEqual({
      date: "2024-11-20",
      versionDate: "2024-11-20T22:59:59.999Z",
      source: "project",
      invalid: [],
    });
  });

  it("lets the first level in the list win", () => {
    const out = resolveReferencelistDate([
      { source: "bdb", value: "2026-05-20" },
      { source: "workArea", value: "2025-01-01" },
      { source: "project", value: "2024-11-20" },
    ]);
    expect(out.date).toBe("2026-05-20");
    expect(out.source).toBe("bdb");
  });

  it("inherits past a blank level", () => {
    const out = resolveReferencelistDate([
      { source: "bdb", value: "   " },
      { source: "workArea", value: "2025-01-01" },
      { source: "project", value: "2024-11-20" },
    ]);
    expect(out.date).toBe("2025-01-01");
    expect(out.source).toBe("workArea");
  });

  it("treats an unreadable level as blank but reports it", () => {
    // "Treated as empty" is the owner's standard choice, and empty
    // means inherit - so the level below applies. The level is named
    // in `invalid` so the UI can warn instead of hiding the problem.
    const out = resolveReferencelistDate([
      { source: "bdb", value: "20. maj 2026" },
      { source: "project", value: "2024-11-20" },
    ]);
    expect(out.date).toBe("2024-11-20");
    expect(out.source).toBe("project");
    expect(out.invalid).toEqual(["bdb"]);
  });

  it("reports an unreadable value even when no level has a usable one", () => {
    const out = resolveReferencelistDate([
      { source: "project", value: "ikke sat" },
    ]);
    expect(out.date).toBeNull();
    expect(out.versionDate).toBeNull();
    expect(out.invalid).toEqual(["project"]);
  });

  /**
   * Task 155 phase C, self-check C1 - every combination of
   * blank/filled across the three levels, as a table. Eight rows, so
   * nothing is left to the reader's imagination about which level
   * wins and what a blank level does.
   *
   * The dates differ per level on purpose: if the rule ever read the
   * wrong level, `source` alone would not catch it, but the date
   * would.
   */
  it("picks the right level for all eight blank/filled combinations", () => {
    const BDB = "2026-05-20";
    const WS = "2025-01-01";
    const PROJ = "2024-11-20";
    const cases: Array<{
      bdb: string | null;
      workArea: string | null;
      project: string | null;
      date: string | null;
      source: "bdb" | "workArea" | "project" | null;
    }> = [
      { bdb: BDB, workArea: WS, project: PROJ, date: BDB, source: "bdb" },
      { bdb: BDB, workArea: WS, project: null, date: BDB, source: "bdb" },
      { bdb: BDB, workArea: null, project: PROJ, date: BDB, source: "bdb" },
      { bdb: BDB, workArea: null, project: null, date: BDB, source: "bdb" },
      {
        bdb: null,
        workArea: WS,
        project: PROJ,
        date: WS,
        source: "workArea",
      },
      { bdb: null, workArea: WS, project: null, date: WS, source: "workArea" },
      {
        bdb: null,
        workArea: null,
        project: PROJ,
        date: PROJ,
        source: "project",
      },
      { bdb: null, workArea: null, project: null, date: null, source: null },
    ];
    for (const c of cases) {
      const out = resolveReferencelistDate([
        { source: "bdb", value: c.bdb },
        { source: "workArea", value: c.workArea },
        { source: "project", value: c.project },
      ]);
      expect({ date: out.date, source: out.source }).toEqual({
        date: c.date,
        source: c.source,
      });
      // And the converted value follows the winning level, or is
      // absent when no level set one.
      if (c.date === null) {
        expect(out.versionDate).toBeNull();
      } else {
        expect(out.versionDate).toBe(danishDayEndToVersionDate(c.date));
      }
    }
  });
});
