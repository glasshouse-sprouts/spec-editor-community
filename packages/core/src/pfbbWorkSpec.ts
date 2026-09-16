/**
 * Virtual "Projektfælles bygningsdelsbeskrivelser" work_spec helpers
 * (Slice 10H.6a).
 *
 * Background
 * ──────────
 * Every PFBB master needs a `work_spec_id`. By Molio convention, every
 * project that has PFBBs carries one extra `work_spec` row named
 * "Projektfælles bygningsdelsbeskrivelser" (code `S999.01`,
 * `work_area_type = 0`) — and every PFBB master's `work_spec_id`
 * points at it. Subscribers point at their real work areas.
 *
 * The SQLite schema does NOT mark this row in any special way. It's
 * identified purely by name/code convention, so the helpers here have
 * to go by string matching. The sample file from Molio uses:
 *
 *     work_area_name = "Projektfælles bygningsdelsbeskrivelser"
 *     work_area_code = "S999.01"
 *     work_area_type = 0
 *     contract_id    = NULL
 *
 * Detection is deliberately forgiving — case-insensitive, trimmed,
 * matches by name OR code — so a file that was hand-edited with a
 * slightly off casing still counts as "already has the virtual
 * work_spec, don't create a second one".
 *
 * These helpers never throw on missing data: "virtual work_spec not
 * present" returns `null` / a "created: true" result. Callers decide
 * whether that is an error or a create-on-demand trigger.
 */

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";
import type { WorkSpec } from "./types.js";

/**
 * Canonical display name. Creating a new virtual row uses this string
 * verbatim; detection is case-insensitive so imported files don't have
 * to match it byte-for-byte.
 */
export const VIRTUAL_WORK_SPEC_NAME = "Projektfælles bygningsdelsbeskrivelser";

/**
 * Canonical work area code. `S999.01` is what Molio's own sample file
 * uses. We write this when creating a new virtual row.
 */
export const VIRTUAL_WORK_SPEC_CODE = "S999.01";

/**
 * True if the given work_spec is the virtual PFBB container.
 *
 * Match rule: case-insensitive, trimmed, matches if EITHER the name
 * equals `VIRTUAL_WORK_SPEC_NAME` OR the code equals
 * `VIRTUAL_WORK_SPEC_CODE`. Matches on either field separately — a
 * file that only sets one of them still counts. That's defensive:
 * older imports may have lost one or the other.
 *
 * Pure function, no DB access.
 */
export function isVirtualWorkSpec(
  ws: Pick<WorkSpec, "work_area_name" | "work_area_code">,
): boolean {
  return nameMatches(ws.work_area_name) || codeMatches(ws.work_area_code);
}

function nameMatches(name: string | null | undefined): boolean {
  if (name == null) return false;
  return (
    name.trim().toLocaleLowerCase() ===
    VIRTUAL_WORK_SPEC_NAME.toLocaleLowerCase()
  );
}

function codeMatches(code: string | null | undefined): boolean {
  if (code == null) return false;
  return (
    code.trim().toLocaleLowerCase() ===
    VIRTUAL_WORK_SPEC_CODE.toLocaleLowerCase()
  );
}

/**
 * Find the virtual work_spec's id in this database. Returns `null` if
 * no row matches the name/code convention. Does not create.
 *
 * If two rows match (shouldn't happen in a well-formed file), returns
 * the lowest id — deterministic, and matches what
 * `ensureVirtualWorkSpec` does (it picks the existing one rather than
 * making a second).
 */
export function findVirtualWorkSpecId(db: BetterSqliteDatabase): number | null {
  const rows = db
    .prepare(
      "select id, work_area_code, work_area_name from work_spec " +
        "order by id asc",
    )
    .all() as {
    id: number;
    work_area_code: string | null;
    work_area_name: string;
  }[];
  for (const r of rows) {
    if (nameMatches(r.work_area_name) || codeMatches(r.work_area_code)) {
      return r.id;
    }
  }
  return null;
}

/**
 * Result from `ensureVirtualWorkSpec`.
 */
export interface EnsureVirtualWorkSpecResult {
  /** The virtual work_spec row's id. */
  workSpecId: number;
  /** `true` if we just inserted it; `false` if it already existed. */
  created: boolean;
}

/**
 * Idempotent: returns the virtual work_spec's id, creating it if
 * missing. Safe to call before every PFBB master insertion.
 *
 * The insert sets `work_area_type = 0` and `contract_id = null` per
 * the Molio convention. All GUID / paradigm / revision fields are
 * `null`: the virtual row is a grouping container, not a spec.
 *
 * Runs in its own transaction so the read-then-write is atomic — two
 * concurrent calls can't both miss the check and insert two rows.
 * (In practice better-sqlite3 is single-threaded per connection, but
 * the transaction also rolls back cleanly if the insert fails for
 * some other reason.)
 */
export function ensureVirtualWorkSpec(
  handleOrDb: MoliospecHandle | BetterSqliteDatabase,
): EnsureVirtualWorkSpecResult {
  const db = isHandle(handleOrDb) ? handleOrDb.db : handleOrDb;

  const tx = db.transaction(() => {
    const existing = findVirtualWorkSpecId(db);
    if (existing != null) {
      return { workSpecId: existing, created: false };
    }
    const info = db
      .prepare(
        `insert into work_spec (
          work_area_code, work_area_name,
          created_by_organization, created_by, revision_date, revision,
          reviewed_by, approved_by,
          molio_spec_guid, molio_spec_revision_guid,
          molio_work_spec_paradigm_guid, molio_work_spec_paradigm_revision_guid,
          molio_referencelist_area, work_area_type,
          issue_date, molio_spec_revision_no, molio_spec_revision_date,
          molio_referencelist_area_date, contract_id
        ) values (
          ?, ?,
          null, null, null, null,
          null, null,
          null, null,
          null, null,
          null, 0,
          null, null, null,
          null, null
        )`,
      )
      .run(VIRTUAL_WORK_SPEC_CODE, VIRTUAL_WORK_SPEC_NAME);
    return { workSpecId: Number(info.lastInsertRowid), created: true };
  });
  return tx();
}

function isHandle(
  x: MoliospecHandle | BetterSqliteDatabase,
): x is MoliospecHandle {
  return (
    typeof x === "object" &&
    x != null &&
    "db" in x &&
    typeof (x as MoliospecHandle).db === "object"
  );
}

/* ------------------------------------------------------------------ */
/*  Migration: move orphan PFBB masters to the virtual work_spec      */
/*  (Slice 10H.6b)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Result from `migrateOrphanPfbbMasters`. `movedCount` is the number of
 * masters that were NOT already in the virtual work_spec before the
 * call. `virtualWorkSpecId` is the id of the virtual row (either
 * pre-existing or freshly created by this call — see `createdVirtual`).
 */
export interface MigrateOrphanPfbbMastersResult {
  /** The virtual work_spec id after the call. */
  virtualWorkSpecId: number;
  /** `true` if we created the virtual row as part of this migration. */
  createdVirtual: boolean;
  /** BDB ids whose `work_spec_id` was changed to the virtual row. */
  movedBdbIds: number[];
  /** Convenience: `movedBdbIds.length`. */
  movedCount: number;
}
/**
 * Scan every BDB with `is_pfbb = 1` and re-point its `work_spec_id` at
 * the virtual "Projektfælles" work_spec. Subscribers are left alone.
 *
 * If the virtual work_spec is missing AND there are masters to move,
 * it is created (via `ensureVirtualWorkSpec`). If there are no orphan
 * masters to move, the virtual row is NOT created — a clean project
 * without PFBBs stays clean.
 *
 * Everything runs inside a single transaction. Partial migration is
 * not possible: either every orphan moves or nothing changes.
 *
 * Idempotent: calling again after a successful migration returns
 * `movedCount: 0`.
 *
 * Sections and pfbb_id wiring are untouched — only `work_spec_id`
 * changes. This is safe because sections belong to the BDB row, not
 * to the work_spec, and subscribers point at the master by `pfbb_id`,
 * not by work_spec.
 */
export function migrateOrphanPfbbMasters(
  handleOrDb: MoliospecHandle | BetterSqliteDatabase,
): MigrateOrphanPfbbMastersResult {
  const db = isHandle(handleOrDb) ? handleOrDb.db : handleOrDb;

  const tx = db.transaction(() => {
    // First, do we even have orphans? A masters-count query that also
    // excludes the already-virtual ones (if any) tells us.
    const existingVirtualId = findVirtualWorkSpecId(db);

    // Collect orphan masters: is_pfbb=1 AND (no virtual yet OR work_spec_id != virtual).
    const orphans = (
      existingVirtualId == null
        ? (db
            .prepare(
              "select id from construction_element_spec where is_pfbb = 1",
            )
            .all() as { id: number }[])
        : (db
            .prepare(
              "select id from construction_element_spec " +
                "where is_pfbb = 1 and (work_spec_id is null or work_spec_id <> ?)",
            )
            .all(existingVirtualId) as { id: number }[])
    ).map((r) => r.id);

    if (orphans.length === 0) {
      return {
        virtualWorkSpecId: existingVirtualId ?? -1,
        createdVirtual: false,
        movedBdbIds: [],
        movedCount: 0,
      };
    }

    // We have orphans → we need a virtual row. Create if missing.
    const ensured = ensureVirtualWorkSpec(db);

    const stmt = db.prepare(
      "update construction_element_spec set work_spec_id = ? where id = ?",
    );
    for (const id of orphans) {
      stmt.run(ensured.workSpecId, id);
    }

    return {
      virtualWorkSpecId: ensured.workSpecId,
      createdVirtual: ensured.created,
      movedBdbIds: orphans,
      movedCount: orphans.length,
    };
  });
  const result = tx();
  // If we returned early with no orphans but also no virtual row,
  // `virtualWorkSpecId` was `-1`. That's a sentinel: callers that need
  // the id should call `ensureVirtualWorkSpec` directly. Most callers
  // only care about `movedCount`.
  return result;
}

/* ------------------------------------------------------------------ */
/*  Targeted move: a single BDB into the virtual work_spec             */
/*  (Slice 10H.6c)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Result from `moveBdbToVirtualWorkSpec`.
 */
export interface MoveBdbToVirtualWorkSpecResult {
  /** The virtual work_spec's id after the call. */
  virtualWorkSpecId: number;
  /** `true` if the BDB's `work_spec_id` actually changed. */
  moved: boolean;
  /** `true` if this call created the virtual row. */
  createdVirtual: boolean;
}

/**
 * Move a single BDB (construction_element_spec row) into the virtual
 * PFBB work_spec. Used by Slice 10H.6c: when the user flips `is_pfbb`
 * from 0 to 1 in the edit dialog, the save pipeline calls this to put
 * that BDB where Molio convention expects PFBB masters to live.
 *
 * Idempotent — if the BDB is already in the virtual row, returns
 * `moved: false` and nothing changes. If the virtual row doesn't
 * exist yet, it is created (same policy as `migrateOrphanPfbbMasters`).
 *
 * Does NOT touch `is_pfbb` itself — that's applyEdits's job. This only
 * repoints `work_spec_id`. If the target BDB is a subscriber
 * (`pfbb_id != null`) the move still happens; 10H.6c only calls this
 * for non-subscribers but the function is deliberately non-judgemental
 * so other callers (tests, future writers) can use it.
 *
 * Throws for an unknown BDB id — the save pipeline should never hit
 * that path, so it's a real bug, not a user error.
 */
export function moveBdbToVirtualWorkSpec(
  handleOrDb: MoliospecHandle | BetterSqliteDatabase,
  bdbId: number,
): MoveBdbToVirtualWorkSpecResult {
  const db = isHandle(handleOrDb) ? handleOrDb.db : handleOrDb;

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        "select work_spec_id from construction_element_spec where id = ?",
      )
      .get(bdbId) as { work_spec_id: number | null } | undefined;
    if (row == null) {
      throw new CoreError(
        "INTERNAL",
        { bdbId },
        `moveBdbToVirtualWorkSpec: no such construction_element_spec id=${bdbId}`,
      );
    }

    const ensured = ensureVirtualWorkSpec(db);
    if (row.work_spec_id === ensured.workSpecId) {
      return {
        virtualWorkSpecId: ensured.workSpecId,
        moved: false,
        createdVirtual: ensured.created,
      };
    }
    db.prepare(
      "update construction_element_spec set work_spec_id = ? where id = ?",
    ).run(ensured.workSpecId, bdbId);
    return {
      virtualWorkSpecId: ensured.workSpecId,
      moved: true,
      createdVirtual: ensured.created,
    };
  });
  return tx();
}
