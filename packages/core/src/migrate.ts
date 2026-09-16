/**
 * Forward migration of older Molio files to schema 01.00.04.
 *
 * The problem this solves
 * ======================
 * Files written before schema 01.00.03 are missing tables and columns the
 * write path assumes exist. `applyEdits` prepares statements against
 * `contracts` unconditionally, and better-sqlite3 compiles a statement the
 * moment it is prepared — so on a file without that table *every* save
 * failed, even after an ordinary text edit. The user could work for hours
 * and only find out at save time.
 *
 * The approach
 * ============
 * The app never edits the user's file directly: opening decompresses into a
 * temp copy and works there. So the migration runs on that temp copy right
 * after opening. From then on the rest of the program sees an ordinary
 * 01.00.04 project and nothing downstream has to know about old formats.
 * The user's original file is untouched until they choose "Save as".
 *
 * That last part is not optional. The caller must force "Save as" for a
 * migrated file: the conversion is irreversible, and the atomic-save work
 * (H1) protects against a crash corrupting a file, not against a conversion
 * that succeeds and loses something.
 *
 * Rebuild, not patch
 * ==================
 * Tables are rebuilt from `schema.ts`'s canonical DDL rather than patched
 * with `alter table add column`. Patching appends new columns at the end,
 * cannot drop the columns that 01.00.00 has and 01.00.04 does not, and
 * leaves nullability as it was. Rebuilding produces a file that matches a
 * genuine 01.00.04 file exactly, which is the only version of "done" we can
 * actually verify.
 *
 * What is deliberately NOT carried over
 * ====================================
 * In 01.00.00 a control plan is attached to the work area; from 01.00.01 on
 * it is attached to the building element specification. When a work area
 * holds more than one building element specification there is no correct
 * answer to which one inherits the link, and a guess files the user's data
 * in the wrong place. So the links are dropped and left unattached, the
 * count is reported back, and the caller tells the user. Decision by the
 * author, 2026-08-10.
 *
 * And "dropped" means dropped: the migration ends with a VACUUM, so the
 * old rows do not survive in the file's free space. Without it the
 * finished file still contains the very data the dialog says was left
 * behind — invisible to every tool, but there.
 */

import Database from "better-sqlite3";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";
import { readDbVersion } from "./read.js";
import {
  CANONICAL_SEEDS,
  CANONICAL_TABLES,
  CANONICAL_TABLE_EXTRAS,
  CURRENT_DB_VERSION,
  OLDEST_CURRENT_SCHEMA_VERSION,
  columnsMatch,
  readColumns,
  seedLookupTable,
  type CanonicalColumn,
} from "./schema.js";

/** Suffix used for the old table during a rebuild. Never persists. */
const REBUILD_SUFFIX = "__molio_migrate_old";

/**
 * Columns that were renamed between versions.
 *
 * Keyed by table, then by the *current* column name, listing candidate
 * source columns in priority order. Only candidates that actually exist in
 * the file being migrated are used, so the same map works for every old
 * version.
 */
const RENAMED_COLUMNS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  // 01.00.00 called it project_key.
  project: { project_number: ["project_number", "project_key"] },
  // 01.00.00 called it header.
  control_plan: { number_text: ["number_text", "header"] },
};

/**
 * Columns that hold a control-plan link on the work area. Present only in
 * 01.00.00; the rebuild drops them because they are not part of the current
 * `work_spec`. Listed here so we can count what we are about to discard.
 */
const LEGACY_WORK_SPEC_CP_COLUMNS = [
  "controlplan_design_id",
  "controlplan_production_id",
];

export interface MigrationPlan {
  /** True when this file has to be upgraded before it can be written to. */
  needed: boolean;
  /** The version stamp found in the file (or "unknown"). */
  fromVersion: string;
  /** What it will be stamped as afterwards. */
  toVersion: string;
  /**
   * True when the file is 01.00.00-shaped, i.e. control-plan links live on
   * the work area and will not survive. The caller must say so in the
   * dialog it shows the user.
   */
  losesControlPlanLinks: boolean;
}

export interface MigrationResult extends MigrationPlan {
  /** False when nothing was done (file already current). */
  migrated: boolean;
  /** Tables that did not exist and were created. */
  createdTables: string[];
  /** Tables whose columns differed and were rebuilt. */
  rebuiltTables: string[];
  /** How many work areas had a control-plan link that was discarded. */
  droppedControlPlanLinks: number;
  /**
   * Foreign-key violations left in the file afterwards. Normally 0. A
   * non-zero count means the source file already had rows pointing at
   * things that are not there; migration reports rather than hides it.
   */
  foreignKeyViolations: number;
}

/* ------------------------------------------------------------------ */
/*  Version comparison                                                 */
/* ------------------------------------------------------------------ */

/**
 * Compare two "NN.NN.NN" version strings. Returns a negative number when
 * `a` is older, 0 when equal, positive when newer, and `null` when either
 * side is not a version we recognise.
 */
export function compareDbVersion(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/* ------------------------------------------------------------------ */
/*  Planning                                                           */
/* ------------------------------------------------------------------ */

/**
 * Decide whether an opened file needs upgrading, without changing anything.
 *
 * The decision is made on the version stamp, not on the schema, and that is
 * deliberate: a file that says it is current is treated as current. (Molio
 * has shipped at least one 01.00.04 file whose schema is not quite complete;
 * quietly rewriting a file the user considers current would be a surprise,
 * and that case is tracked separately.)
 *
 * A file whose version we cannot parse is left alone. We do not convert
 * something we cannot identify.
 */
export function planMigration(handle: MoliospecHandle): MigrationPlan {
  const fromVersion = readDbVersion(handle);
  const cmp = compareDbVersion(fromVersion, OLDEST_CURRENT_SCHEMA_VERSION);
  const needed = cmp !== null && cmp < 0;
  return {
    needed,
    fromVersion,
    toVersion: CURRENT_DB_VERSION,
    losesControlPlanLinks: needed && hasLegacyWorkSpecCpColumns(handle),
  };
}

function hasLegacyWorkSpecCpColumns(handle: MoliospecHandle): boolean {
  const names = new Set(readColumns(handle.db, "work_spec").map((c) => c.name));
  return LEGACY_WORK_SPEC_CP_COLUMNS.some((c) => names.has(c));
}

/* ------------------------------------------------------------------ */
/*  Canonical reference (built once, in memory)                        */
/* ------------------------------------------------------------------ */

let canonicalColumnCache: Record<string, CanonicalColumn[]> | null = null;

/**
 * The column signature of every canonical table, derived by actually
 * building the schema in an in-memory database. Deriving it beats keeping a
 * hand-written table in sync with the DDL right next to it.
 */
export function getCanonicalColumns(): Record<string, CanonicalColumn[]> {
  if (canonicalColumnCache) return canonicalColumnCache;
  const mem = new Database(":memory:");
  try {
    for (const ddl of Object.values(CANONICAL_TABLES)) mem.exec(ddl);
    const out: Record<string, CanonicalColumn[]> = {};
    for (const table of Object.keys(CANONICAL_TABLES)) {
      out[table] = readColumns(mem, table);
    }
    canonicalColumnCache = out;
    return out;
  } finally {
    mem.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Migration                                                          */
/* ------------------------------------------------------------------ */

/**
 * Upgrade an opened file to 01.00.04, in place on the handle's temp copy.
 *
 * Returns without touching anything when the file is already current, so
 * this is safe (and cheap) to call on every open.
 *
 * Everything runs in one transaction: either the whole upgrade lands or
 * none of it does. A failure leaves the temp copy as it was and raises a
 * coded error — no raw SQLite text ever reaches the user interface.
 */
export function migrateToCurrent(handle: MoliospecHandle): MigrationResult {
  const plan = planMigration(handle);
  const idle: MigrationResult = {
    ...plan,
    migrated: false,
    createdTables: [],
    rebuiltTables: [],
    droppedControlPlanLinks: 0,
    foreignKeyViolations: 0,
  };
  if (!plan.needed) return idle;

  const db = handle.db;
  const createdTables: string[] = [];
  const rebuiltTables: string[] = [];
  // Assigned inside the try below. The catch always rethrows, so by the
  // time this is read it is always set.
  let droppedControlPlanLinks: number;

  // Rebuilding a referenced table means dropping and recreating it, which
  // foreign-key enforcement would refuse mid-way. `legacy_alter_table`
  // stops SQLite from "helpfully" rewriting other objects' references to
  // the table while we rename it out of the way.
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    droppedControlPlanLinks = countDiscardedControlPlanLinks(db);

    const existing = listTables(db);
    const canonical = getCanonicalColumns();

    db.transaction(() => {
      for (const table of Object.keys(CANONICAL_TABLES)) {
        if (!existing.has(table)) {
          createTable(db, table);
          createdTables.push(table);
          continue;
        }
        const want = canonical[table] ?? [];
        if (!columnsMatch(readColumns(db, table), want)) {
          rebuildTable(db, table, want);
          rebuiltTables.push(table);
        }
      }
      db.prepare("update project set db_version = ?").run(CURRENT_DB_VERSION);
    })();

    // Reclaim the pages the rebuilds left behind. Not housekeeping: a
    // rebuilt table's old rows stay in the file's free space, so without
    // this a converted 01.00.00 file still literally contains
    // `project_key` and the control-plan links we just told the user we
    // were not carrying over. Measured on Molio's own samples, it also
    // takes 10-30% off the finished file.
    //
    // Must run outside the transaction — SQLite refuses VACUUM inside
    // one. A failure here is worth surfacing rather than swallowing: the
    // temp copy is disposable, so the user loses nothing by being told
    // the upgrade did not complete.
    db.exec("vacuum");
  } catch (err) {
    throw new CoreError(
      "IO_MIGRATION_FAILED",
      { fromVersion: plan.fromVersion, toVersion: plan.toVersion },
      `migrateToCurrent: upgrading from ${plan.fromVersion} failed: ` +
        String(err),
    );
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  return {
    ...plan,
    migrated: true,
    createdTables,
    rebuiltTables,
    droppedControlPlanLinks,
    foreignKeyViolations: (db.pragma("foreign_key_check") as unknown[]).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function listTables(db: MoliospecHandle["db"]): Set<string> {
  const rows = db
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * How many work areas carry a control-plan link that this migration will
 * discard. Counted before anything is rebuilt, because the columns holding
 * the answer are about to disappear.
 */
function countDiscardedControlPlanLinks(db: MoliospecHandle["db"]): number {
  const names = new Set(readColumns(db, "work_spec").map((c) => c.name));
  const present = LEGACY_WORK_SPEC_CP_COLUMNS.filter((c) => names.has(c));
  if (present.length === 0) return 0;
  const where = present.map((c) => `"${c}" is not null`).join(" or ");
  const row = db
    .prepare(`select count(*) as n from work_spec where ${where}`)
    .get() as { n: number };
  return row.n;
}

/** Create one canonical table plus its indexes/triggers/views and seeds. */
function createTable(db: MoliospecHandle["db"], table: string): void {
  const ddl = CANONICAL_TABLES[table];
  if (!ddl) throw new Error(`no canonical DDL for table ${table}`);
  db.exec(ddl);
  if (CANONICAL_SEEDS[table]) seedLookupTable(db, table);
  restoreExtras(db, table);
}

/**
 * Recreate the indexes, triggers and views belonging to a table — but only
 * the ones that are actually missing.
 *
 * Dropping a table takes its indexes and triggers with it; views survive.
 * Blindly re-running every statement would therefore fail on "view already
 * exists", so we check first.
 */
function restoreExtras(db: MoliospecHandle["db"], table: string): void {
  const extras = CANONICAL_TABLE_EXTRAS[table] ?? [];
  if (extras.length === 0) return;
  const exists = db.prepare(
    "select 1 from sqlite_master where name = ? limit 1",
  );
  for (const extra of extras) {
    if (!exists.get(extra.name)) db.exec(extra.ddl);
  }
}

/**
 * Replace a table with one built from the canonical DDL, carrying the old
 * rows across.
 *
 * Order matters: the old table has to be dropped before the indexes and
 * triggers are recreated, because they follow the table through the rename
 * and their names would otherwise collide.
 */
function rebuildTable(
  db: MoliospecHandle["db"],
  table: string,
  want: readonly CanonicalColumn[],
): void {
  const ddl = CANONICAL_TABLES[table];
  if (!ddl) throw new Error(`no canonical DDL for table ${table}`);

  const have = new Set(readColumns(db, table).map((c) => c.name));
  const targets = want.map((c) => `"${c.name}"`);
  const sources = want.map((c) => sourceExpression(table, c, have));
  const old = `${table}${REBUILD_SUFFIX}`;

  db.exec(`alter table "${table}" rename to "${old}"`);
  db.exec(ddl);
  db.exec(
    `insert into "${table}" (${targets.join(", ")}) ` +
      `select ${sources.join(", ")} from "${old}"`,
  );
  db.exec(`drop table "${old}"`);
  restoreExtras(db, table);
  if (CANONICAL_SEEDS[table]) seedLookupTable(db, table);
}

/**
 * The SQL expression that fills one canonical column from the old table.
 *
 * Three cases:
 *   - the column exists under its own name  -> use it;
 *   - it exists under an older name         -> use that (see RENAMED_COLUMNS);
 *   - it did not exist at all               -> null.
 *
 * A column that is `not null` in the current schema but empty or absent in
 * the old file gets a neutral value rather than failing the whole upgrade.
 * An old file that a user has been working in for years is more valuable
 * than a strict reading of a constraint Molio added later.
 */
function sourceExpression(
  table: string,
  column: CanonicalColumn,
  have: ReadonlySet<string>,
): string {
  const candidates = (
    RENAMED_COLUMNS[table]?.[column.name] ?? [column.name]
  ).filter((c) => have.has(c));

  let expr =
    candidates.length === 0
      ? "null"
      : candidates.length === 1
        ? `"${candidates[0]}"`
        : `coalesce(${candidates.map((c) => `"${c}"`).join(", ")})`;

  if (column.notNull) expr = `coalesce(${expr}, ${neutralValue(column)})`;
  return expr;
}

/** A harmless stand-in for a `not null` column with nothing to put in it. */
function neutralValue(column: CanonicalColumn): string {
  const type = column.type.toLowerCase();
  if (type.includes("int")) return "0";
  if (type.includes("blob")) return "zeroblob(0)";
  if (type.includes("real") || type.includes("floa") || type.includes("doub")) {
    return "0.0";
  }
  return "''";
}
