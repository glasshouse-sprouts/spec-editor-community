/**
 * Relative-time label used by the Welcome screen's recent-projects list.
 *
 * Input: a Unix-epoch millisecond timestamp (as stored in
 * `RecentFileEntry.openedAt`) and a "now" timestamp for comparison —
 * always injected so tests are deterministic and callers can reuse a
 * single `Date.now()` across a render pass.
 *
 * Output: a short English label. We roll this by hand rather than
 * reaching for `Intl.RelativeTimeFormat` so the breakpoints stay exactly
 * the way we want them, and so the output is a single piece of text we
 * can snapshot in tests without worrying about ICU version drift.
 *
 * Rules:
 *   - Future timestamps (openedAt > now) fall back to "just now" — the
 *     list is about things you opened in the past, so a clock skew of a
 *     few seconds shouldn't show "in 3 seconds".
 *   - < 60 seconds        → "just now"
 *   - < 60 minutes        → "N min ago"         (1 = "1 min ago")
 *   - < 24 hours          → "N h ago"           (1 = "1 h ago")
 *   - < 7 days            → "N days ago"        (1 = "yesterday")
 *   - ≥ 7 days            → absolute date, e.g. "22 Apr 2026"
 *
 * Deliberately NOT localized: the app currently has no locale wiring.
 * When that lands, we can swap the template strings without touching
 * the thresholds.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatTimeAgo(openedAt: number, now: number): string {
  // Clock-skew guard. Treat anything in the future as "just now" so we
  // never show nonsense like "in 3 seconds".
  const delta = Math.max(0, now - openedAt);

  if (delta < MINUTE) return "just now";

  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE);
    return `${minutes} min ago`;
  }

  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return `${hours} h ago`;
  }

  if (delta < WEEK) {
    const days = Math.floor(delta / DAY);
    if (days === 1) return "yesterday";
    return `${days} days ago`;
  }

  // Anything older than a week gets an absolute date. "22 Apr 2026".
  // Built by hand so the format is stable regardless of runtime locale.
  const d = new Date(openedAt);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
