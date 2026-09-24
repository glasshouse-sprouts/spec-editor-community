/**
 * Shared date/time formatting for anything a HUMAN reads (Task 144).
 *
 * Before this helper the only date formatting in the renderer was
 * `new Date(...).toLocaleString()` inline in WelcomeScreen.tsx, and the
 * project overview printed the raw database strings - so the user saw
 * "2026-09-18T13:15:45.896Z". That is the same situation sorting was in
 * before sortHelpers.ts: every call site rolling its own, and the
 * visible result quietly different depending on where you looked.
 *
 * Scope note: these helpers are for the SCREEN. Dates written INTO a
 * file - an export another tool reads, or anything stored back in the
 * .moliospec - must keep their machine format and must not go through
 * here.
 *
 * ---------------------------------------------------------------
 * The two timestamp shapes that actually occur in a .moliospec
 * ---------------------------------------------------------------
 *
 * Measured 2026-09-21 across every .moliospec in the repo:
 *
 *   1. Written by this app, via
 *      `strftime('%Y-%m-%dT%H:%M:%fZ','now')` in core:
 *          "2026-09-18T13:15:45.896Z"        - UTC, explicit Z
 *
 *   2. Written by Molio's own system (the captured API download
 *      fixture, created_by_system = "Molio"):
 *          "2026-04-10 10:00:06.8455715"     - space separator,
 *          seven-digit fraction, and NO timezone at all
 *
 * Shape 2 carries no offset, so there is nothing to convert FROM.
 * Converting it anyway would mean guessing an offset and shifting the
 * clock by two hours on a guess, so the wall clock is shown as it
 * stands. Shape 1 is a real instant and is converted to Danish time.
 * This is a deliberate choice and is written on Task 144; if Molio
 * confirms their timestamps are UTC, the naive branch should convert
 * instead, and only this file changes.
 */

/** The one timezone the app displays in. */
const DISPLAY_TIME_ZONE = "Europe/Copenhagen";

/**
 * Accepts the ISO-8601-ish shapes above and nothing else:
 * date, optional time (separated by "T" or a space), optional
 * fractional seconds, optional zone designator.
 */
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

interface ParsedStamp {
  /** Calendar date + clock as it should be DISPLAYED, already in Danish time. */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** False when the source string carried a date only, with no clock at all. */
  hasTime: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Zone designator -> offset in minutes east of UTC. "Z" is 0. */
function zoneOffsetMinutes(zone: string): number {
  if (zone.toUpperCase() === "Z") return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  return sign * (hours * 60 + minutes);
}

/**
 * Render an instant in Danish time. Uses formatToParts rather than a
 * locale string so the output is exactly the fields we asked for,
 * whatever the user's own locale happens to be.
 */
function partsInDisplayZone(epochMs: number): ParsedStamp | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : NaN;
  };
  const out: ParsedStamp = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    hasTime: true,
  };
  return Number.isFinite(out.year) && Number.isFinite(out.hour) ? out : null;
}

/**
 * Parse one of the accepted shapes into the fields to display.
 * Returns null for empty, malformed or impossible values - the call
 * site then keeps whatever placeholder it already shows, rather than
 * printing "Invalid Date".
 */
function parseStamp(value: string | null | undefined): ParsedStamp | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const m = TIMESTAMP_RE.exec(trimmed);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hasTime = m[4] !== undefined;
  const hour = hasTime ? Number(m[4]) : 0;
  const minute = hasTime ? Number(m[5]) : 0;
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  // Only the first three fraction digits are milliseconds; Molio's
  // .NET timestamps carry seven. The rest is below our resolution.
  const ms = m[7] !== undefined ? Number(`0.${m[7]}`) * 1000 : 0;
  const zone = m[8];

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Rejects impossible calendar dates such as 2026-02-30, which the
  // regex alone is happy with.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  if (zone === undefined) {
    // No offset in the source: show the wall clock as written.
    return { year, month, day, hour, minute, hasTime };
  }

  const epochMs = asUtc - zoneOffsetMinutes(zone) * 60_000;
  const converted = partsInDisplayZone(epochMs);
  if (!converted) return null;
  return { ...converted, hasTime };
}

/**
 * "2026-09-18T13:15:45.896Z" -> "2026-09-18 - 15:15"
 *
 * Danish time, no seconds, no milliseconds, no Z. A value that carries
 * a date but no clock comes back as a plain date rather than with an
 * invented "00:00". Returns null when the value is missing or cannot be
 * read.
 */
export function formatTimestamp(
  value: string | null | undefined,
): string | null {
  const p = parseStamp(value);
  if (!p) return null;
  const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  if (!p.hasTime) return date;
  return `${date} - ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * "2026-09-18T13:15:45.896Z" -> "2026-09-18"
 *
 * The Danish calendar day, with no clock. Note that converting to
 * Danish time can move the day: 2026-09-18T23:30:00Z is 2026-09-19 in
 * Copenhagen. Returns null when the value is missing or cannot be read.
 */
export function formatDate(value: string | null | undefined): string | null {
  const p = parseStamp(value);
  if (!p) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
