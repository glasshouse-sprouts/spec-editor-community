import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatTimestamp,
} from "../src/renderer/src/dateHelpers.js";

/**
 * Task 144. The two shapes that actually occur in a .moliospec are
 * covered first, then the edges: summer/winter time, the day rolling
 * over at the offset, and everything that must NOT become
 * "Invalid Date".
 */
describe("formatTimestamp", () => {
  it("formats an app-written UTC timestamp in Danish time", () => {
    // Written by core's strftime('%Y-%m-%dT%H:%M:%fZ','now').
    // 13:15 UTC in September is 15:15 in Copenhagen.
    expect(formatTimestamp("2026-09-18T13:15:45.896Z")).toBe(
      "2026-09-18 - 15:15",
    );
  });

  it("drops seconds and milliseconds without rounding the minute", () => {
    expect(formatTimestamp("2026-09-18T13:15:59.999Z")).toBe(
      "2026-09-18 - 15:15",
    );
  });

  describe("summer time", () => {
    it("uses +01:00 in January", () => {
      expect(formatTimestamp("2026-01-15T23:30:00Z")).toBe(
        "2026-01-16 - 00:30",
      );
    });

    it("uses +02:00 in July", () => {
      expect(formatTimestamp("2026-07-15T23:30:00Z")).toBe(
        "2026-07-16 - 01:30",
      );
    });

    it("moves the calendar day when the offset crosses midnight", () => {
      // Same wall clock in UTC, two different Danish dates.
      expect(formatTimestamp("2026-01-15T22:30:00Z")).toBe(
        "2026-01-15 - 23:30",
      );
      expect(formatTimestamp("2026-07-15T22:30:00Z")).toBe(
        "2026-07-16 - 00:30",
      );
    });
  });

  describe("timestamps with no timezone in them", () => {
    // Molio's own files, e.g. created_by_system = "Molio":
    // "2026-04-10 10:00:06.8455715". There is no offset to convert
    // from, so the wall clock is shown as written rather than shifted
    // by a guessed two hours. See the note in dateHelpers.ts.
    it("shows a Molio timestamp's wall clock unchanged", () => {
      expect(formatTimestamp("2026-04-10 10:00:06.8455715")).toBe(
        "2026-04-10 - 10:00",
      );
    });

    it("accepts the same shape with a T separator", () => {
      expect(formatTimestamp("2026-04-10T10:00:06")).toBe("2026-04-10 - 10:00");
    });
  });

  it("accepts an explicit numeric offset", () => {
    expect(formatTimestamp("2026-07-15T23:30:00+00:00")).toBe(
      "2026-07-16 - 01:30",
    );
    expect(formatTimestamp("2026-07-16T03:30:00+04:00")).toBe(
      "2026-07-16 - 01:30",
    );
  });

  it("returns a plain date when the value has no clock at all", () => {
    // No "00:00" is invented for a value that never had a time.
    expect(formatTimestamp("2026-12-01")).toBe("2026-12-01");
  });

  describe("values that must not produce Invalid Date", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
      ["free text", "engang i foraaret"],
      ["a partial date", "2026-09"],
      ["an impossible calendar date", "2026-02-30T10:00:00Z"],
      ["an impossible month", "2026-13-01T10:00:00Z"],
      ["an impossible clock", "2026-09-18T25:00:00Z"],
    ])("returns null for %s", (_label, value) => {
      expect(formatTimestamp(value as string | null | undefined)).toBeNull();
    });
  });
});

describe("formatDate", () => {
  it("returns the Danish calendar day for an instant", () => {
    expect(formatDate("2026-09-18T13:15:45.896Z")).toBe("2026-09-18");
  });

  it("uses the Danish day, not the UTC day, across midnight", () => {
    expect(formatDate("2026-07-15T23:30:00Z")).toBe("2026-07-16");
  });

  it("passes a plain date through", () => {
    expect(formatDate("2026-12-01")).toBe("2026-12-01");
  });

  it("returns null for an unusable value", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate("not a date")).toBeNull();
  });
});
