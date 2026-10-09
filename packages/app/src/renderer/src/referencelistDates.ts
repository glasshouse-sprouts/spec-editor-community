/**
 * Task 155, phase C - renderer-side helpers for the reference-list
 * date (fiksdato).
 *
 * Why this is here and not in `@molio2-editor/core`
 * -------------------------------------------------
 * Core owns the real rule - `isIsoDateOnly`,
 * `danishDayEndToVersionDate` and `resolveReferencelistDate` live in
 * `core/src/referencelistDate.ts`, and main uses them for the actual
 * lookup. The renderer cannot import core: it drags in better-sqlite3
 * and blanks the window (see the note in `pfbbMigration.ts`). So the
 * one predicate the modals need is mirrored here, exactly as
 * `pfbbMigration.ts` mirrors `isVirtualWorkSpec`.
 *
 * The copy is kept honest by a test that runs BOTH implementations
 * over the same inputs and requires the same answer
 * (`test/referencelistDates.test.ts`). If the rule ever changes in
 * core, that test fails here.
 */

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `value` is a real calendar date written exactly as
 * `YYYY-MM-DD`. Mirror of core's `isIsoDateOnly`.
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
 * True when a stored value is present but cannot be read as a date.
 * The modals use it to decide between a date picker and a plain text
 * box: an unreadable value must stay VISIBLE and editable rather than
 * disappear into an `<input type="date">` that cannot display it.
 */
export function isUnreadableDate(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  if (value.trim() === "") return false;
  return !isIsoDateOnly(value);
}

/* ------------------------------------------------------------------ */
/*  Rule 5 - cascading a changed project date                         */
/* ------------------------------------------------------------------ */

/** One work area or BDB that carries its own reference-list date. */
export interface ReferencelistDateRow {
  kind: "workSpec" | "bdb";
  id: number;
  /** For the dialog's wording; not used by the rule itself. */
  name: string;
  /** The row's own `molio_referencelist_area_date`, effective value -
   *  what the user would see. This is what the rule compares. */
  date: string | null;
  /**
   * The same column as it stands ON DISK. Not used by the rule; the
   * caller needs it when staging the cascade, because the edit
   * helpers treat "equals the original" as a revert and drop the
   * patch. Handing them the effective value instead of the stored one
   * could therefore drop an edit the user meant to keep.
   */
  diskDate: string | null;
}

/**
 * Who would be affected if the project's reference-list date changed
 * to `newProjectDate`.
 *
 * The owner's rule 5 (2026-10-02): rows with a date of their OWN that
 * differs from the new project date are the ones worth asking about.
 * Rows with a blank date inherit, so they follow the new project date
 * automatically and are never listed. A row that already equals the
 * new date needs no change either.
 *
 * Comparison is on the trimmed stored text, not on parsed dates: a
 * row holding free text is different from the new date in any reading
 * of it, and offering to overwrite it is exactly right.
 */
export function findReferencelistDateCascade(
  rows: readonly ReferencelistDateRow[],
  newProjectDate: string | null,
): ReferencelistDateRow[] {
  const target = (newProjectDate ?? "").trim();
  return rows.filter((r) => {
    const own = (r.date ?? "").trim();
    if (own === "") return false; // inherits already
    return own !== target;
  });
}

/* ------------------------------------------------------------------ */
/*  Rule 4 - which date applies to one description (Task 184)         */
/* ------------------------------------------------------------------ */

/**
 * The date that applies to one work area or BDB, after the owner's
 * rule 4 (2026-10-02): BDB > work area > project. Pass the levels in
 * that order; the first readable `YYYY-MM-DD` wins, a blank level
 * inherits from the next, and an unreadable value is skipped.
 *
 * Mirror of the `date` half of core's `resolveReferencelistDate` (the
 * renderer cannot import core - see the top of this file). The
 * `versionDate` half is main's business and is not needed here. The
 * test in `test/referencelistDates.test.ts` runs both over the same
 * inputs and requires the same date.
 */
export function resolveReferencelistDateOnly(
  levels: ReadonlyArray<string | null | undefined>,
): string | null {
  for (const value of levels) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw === "") continue;
    if (!isIsoDateOnly(raw)) continue;
    return raw;
  }
  return null;
}
