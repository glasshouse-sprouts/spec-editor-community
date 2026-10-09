/**
 * Fiksdato → `versionDate` for Molio's reference-list lookup (Task 155).
 *
 * Why this file exists
 * --------------------
 * A .moliospec file can carry a "fiksdato" (reference-list date) on
 * three levels: the project, the work area and the BDB. Molio's rule
 * (slides 13.08, slide 3; "Structure and relations for reference
 * lists", 2026-04-07) is: use the newest reference list published ON
 * or BEFORE that date, never one published after it. The lookup
 * endpoint takes a `versionDate` query parameter to express that.
 *
 * Two decisions are baked in here, both the project owner's
 * (2026-10-02):
 *
 *  1. A date covers the WHOLE day. A list published on the date
 *     itself is included.
 *  2. The date is a DANISH calendar date (Europe/Copenhagen), so it
 *     is sent as the last millisecond of that day in Danish local
 *     time, expressed in UTC — `2024-11-20` becomes
 *     `2024-11-20T22:59:59.999Z` in winter and `…T21:59:59.999Z` in
 *     summer. The offset is computed from the IANA zone, never
 *     hard-coded, so both DST switch days are right.
 *
 * Measured against PRD on 2026-10-05 (revision
 * 008290E3-A597-4B02-ABDB-8CD84C1BE70C):
 *   - no versionDate            → R02.01, 2026-05-20  (today's newest)
 *   - 2024-11-20T22:59:59.999Z  → R02.00, 2024-11-18
 *   - 2026-05-19T21:59:59.999Z  → R02.00, 2024-11-18
 *   - 2026-05-20T21:59:59.999Z  → R02.01, 2026-05-20  (day boundary holds)
 *   - a date before every list  → HTTP 404 with a readable `detail`
 *
 * The end-of-day form is also the safe one: the Danish end of day in
 * UTC always lands at 21:59 or 22:59 on the SAME calendar day, so a
 * server that compares on date alone still gets the intended day.
 *
 * Pure: no I/O, no Electron, no Molio API import.
 *
 * Who may import this
 * -------------------
 * Main and the MCP server, both of which already depend on core.
 * NOT the renderer: any renderer import of `@molio2-editor/core`
 * drags better-sqlite3 into the web bundle and blanks the window
 * (see the note in `renderer/src/pfbbMigration.ts`). The renderer
 * therefore sends the RAW field value over IPC and main converts it;
 * a renderer-side date check needs its own small helper under
 * `app/src/shared/`.
 *
 * It sits outside `molio-api/` because it is not API client code -
 * no endpoint, no key, no HTTP. A side effect worth knowing: the
 * Community export strips `molio-api/` wholesale, so this file ships
 * to Community and must be listed in the export manifest.
 */

/** Which level a reference-list date came from. */
export type ReferencelistDateSource = "project" | "workArea" | "bdb";

/** One level's stored value, in the order the rule consults them. */
export interface ReferencelistDateCandidate {
  source: ReferencelistDateSource;
  /** The raw column value. Null, undefined and blank all mean "inherit". */
  value: string | null | undefined;
}

export interface ReferencelistDateResolution {
  /** The date that applies, `YYYY-MM-DD`, or null when no level set one. */
  date: string | null;
  /** `date` as the last millisecond of that Danish day, in RFC 3339
   *  UTC. Null when `date` is null — the caller then omits the
   *  parameter and Molio returns its most-current list. */
  versionDate: string | null;
  /** Which level `date` came from. Null when `date` is null. */
  source: ReferencelistDateSource | null;
  /** Levels whose stored value could not be read as `YYYY-MM-DD`.
   *  They are treated as blank (so the next level applies), but the
   *  UI warns about them rather than hiding the problem. */
  invalid: ReferencelistDateSource[];
}

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const DANISH_ZONE = "Europe/Copenhagen";

/**
 * Reads an instant's Danish wall clock and returns it as if that
 * wall clock were UTC. `wallClockAsUtc(t) - t` is therefore the
 * zone's offset at `t`. Second precision — the formatter has no
 * milliseconds.
 */
const danishParts = new Intl.DateTimeFormat("en-US", {
  timeZone: DANISH_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wallClockAsUtc(instantMs: number): number {
  const parts = danishParts.formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : NaN;
  };
  return Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
    0,
  );
}

/**
 * True when `value` is a real calendar date written exactly as
 * `YYYY-MM-DD`. `2026-02-30` is rejected — the pattern alone would
 * accept it.
 */
export function isIsoDateOnly(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_ONLY.exec(value.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * `2024-11-20` → `"2024-11-20T22:59:59.999Z"`: the last millisecond
 * of that Danish day. Returns null for anything that is not a real
 * `YYYY-MM-DD` date.
 */
export function danishDayEndToVersionDate(
  value: string | null | undefined,
): string | null {
  if (!isIsoDateOnly(value)) return null;
  const m = ISO_DATE_ONLY.exec((value as string).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // The wall clock we are aiming for, expressed as if it were UTC.
  const targetWall = Date.UTC(year, month - 1, day, 23, 59, 59, 0);

  // Two passes: the first offset is read at the wrong instant (it is
  // off by the offset itself), the second at a candidate that is
  // already within an hour or two of the answer. 23:59 is never a
  // DST transition hour in this zone, so the second pass settles it.
  let instant = targetWall - (wallClockAsUtc(targetWall) - targetWall);
  instant = targetWall - (wallClockAsUtc(instant) - instant);

  // Self-check: the instant must actually read back as that wall
  // clock. If a future zone change ever broke the two-pass
  // assumption, we would rather send no date than a wrong one.
  if (wallClockAsUtc(instant) !== targetWall) return null;

  return new Date(instant + 999).toISOString();
}

/**
 * Applies the owner's rule 4 (2026-10-02): BDB > work area >
 * project. Pass the candidates in that order; the first level with a
 * usable value wins, a blank level inherits from the next one, and
 * an unreadable value is treated as blank but reported in `invalid`.
 */
export function resolveReferencelistDate(
  candidates: readonly ReferencelistDateCandidate[],
): ReferencelistDateResolution {
  const invalid: ReferencelistDateSource[] = [];
  for (const candidate of candidates) {
    const raw =
      typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (raw === "") continue;
    if (!isIsoDateOnly(raw)) {
      invalid.push(candidate.source);
      continue;
    }
    const versionDate = danishDayEndToVersionDate(raw);
    if (versionDate === null) {
      invalid.push(candidate.source);
      continue;
    }
    return { date: raw, versionDate, source: candidate.source, invalid };
  }
  return { date: null, versionDate: null, source: null, invalid };
}
