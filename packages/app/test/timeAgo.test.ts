import { describe, expect, it } from "vitest";

import { formatTimeAgo } from "../src/renderer/src/timeAgo.js";

/** Friendly constants so the test arithmetic reads like English. */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fixed "now" so every test is deterministic: Wed Apr 22 2026 12:00 UTC. */
const NOW = Date.UTC(2026, 3, 22, 12, 0, 0);

describe("timeAgo — near past buckets", () => {
  it("shows 'just now' for the current instant", () => {
    expect(formatTimeAgo(NOW, NOW)).toBe("just now");
  });

  it("shows 'just now' for anything under a minute", () => {
    expect(formatTimeAgo(NOW - 59 * SECOND, NOW)).toBe("just now");
  });

  it("shows minutes once we hit the 1-minute boundary", () => {
    expect(formatTimeAgo(NOW - 1 * MINUTE, NOW)).toBe("1 min ago");
  });

  it("shows N min for things inside the last hour", () => {
    expect(formatTimeAgo(NOW - 30 * MINUTE, NOW)).toBe("30 min ago");
    expect(formatTimeAgo(NOW - 59 * MINUTE, NOW)).toBe("59 min ago");
  });
});

describe("timeAgo — hours bucket", () => {
  it("flips to hours exactly at the 1-hour boundary", () => {
    expect(formatTimeAgo(NOW - 1 * HOUR, NOW)).toBe("1 h ago");
  });

  it("uses hours up to 23 hours", () => {
    expect(formatTimeAgo(NOW - 5 * HOUR, NOW)).toBe("5 h ago");
    expect(formatTimeAgo(NOW - 23 * HOUR, NOW)).toBe("23 h ago");
  });
});

describe("timeAgo — days bucket", () => {
  it("says 'yesterday' for 1 day ago", () => {
    expect(formatTimeAgo(NOW - 1 * DAY, NOW)).toBe("yesterday");
  });

  it("shows N days for 2–6 days", () => {
    expect(formatTimeAgo(NOW - 2 * DAY, NOW)).toBe("2 days ago");
    expect(formatTimeAgo(NOW - 6 * DAY, NOW)).toBe("6 days ago");
  });
});

describe("timeAgo — older dates switch to absolute", () => {
  it("formats 7+ days as an absolute date (day month year)", () => {
    // 10 days before NOW is 2026-04-12.
    const ts = NOW - 10 * DAY;
    expect(formatTimeAgo(ts, NOW)).toBe("12 Apr 2026");
  });

  it("handles a month-crossing date", () => {
    // 45 days before NOW lands in early March 2026.
    const ts = NOW - 45 * DAY;
    const d = new Date(ts);
    // We don't hard-code the day to avoid timezone-induced flakes;
    // assert the format shape and the expected month/year.
    expect(formatTimeAgo(ts, NOW)).toMatch(/^\d{1,2} Mar 2026$/);
    // And the day component matches getDate() exactly.
    expect(formatTimeAgo(ts, NOW)).toContain(`${d.getDate()} Mar 2026`);
  });

  it("formats a very old timestamp without error", () => {
    // Two years back — uses the year component.
    const ts = Date.UTC(2024, 0, 15, 12);
    expect(formatTimeAgo(ts, NOW)).toMatch(/^\d{1,2} Jan 2024$/);
  });
});

describe("timeAgo — future / clock-skew guard", () => {
  it("treats a future timestamp as 'just now' (no 'in 3 seconds')", () => {
    expect(formatTimeAgo(NOW + 10 * SECOND, NOW)).toBe("just now");
    expect(formatTimeAgo(NOW + 1 * DAY, NOW)).toBe("just now");
  });
});
