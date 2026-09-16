/**
 * Drift guard: `schema.ts` must describe the same 01.00.04 schema that the
 * app's blank template actually contains.
 *
 * Why bother
 * ==========
 * The migration builds tables from the DDL in `schema.ts`. If that DDL and
 * `packages/app/resources/blank.moliospec` ever disagree, the app would
 * produce two different kinds of "01.00.04" file depending on whether the
 * project was created new or upgraded from an old format - and nothing
 * would notice until Molio's own tools rejected one of them.
 *
 * This test pins them together in both directions.
 *
 * Cosmetic differences in DDL *text* are ignored on purpose. Molio's own
 * files carry the same tables with quoted identifiers because they passed
 * through a GUI tool at some point. What matters is the shape SQLite ends
 * up with: names, order, types, nullability, defaults, keys.
 */

import Database from "better-sqlite3";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  CANONICAL_TABLES,
  CANONICAL_TABLE_EXTRAS,
  applyCanonicalSchema,
  readColumns,
} from "../src/index.js";
import { REPO_ROOT } from "./samples.js";

const BLANK = join(
  REPO_ROOT,
  "packages",
  "app",
  "resources",
  "blank.moliospec",
);

let workDir = "";

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** Open the shipped blank template on a scratch copy. */
function openBlank(): Database.Database {
  workDir ||= mkdtempSync(join(tmpdir(), "schema-drift-"));
  const path = join(workDir, "blank.sqlite");
  writeFileSync(path, gunzipSync(readFileSync(BLANK)));
  return new Database(path, { readonly: true });
}

/** Build a fresh database from the canonical DDL in `schema.ts`. */
function buildCanonical(): Database.Database {
  const db = new Database(":memory:");
  applyCanonicalSchema(db);
  return db;
}

/** Every schema object except SQLite's own implicit indexes. */
function objectNames(db: Database.Database): string[] {
  const rows = db.prepare("select type, name from sqlite_master").all() as {
    type: string;
    name: string;
  }[];
  return rows
    .filter((r) => !r.name.startsWith("sqlite_autoindex"))
    .map((r) => `${r.type}:${r.name}`)
    .sort();
}

describe("canonical schema matches the shipped blank template", () => {
  it("has exactly the same tables, indexes, triggers and views", () => {
    const blank = openBlank();
    const canonical = buildCanonical();
    try {
      expect(objectNames(canonical)).toEqual(objectNames(blank));
    } finally {
      blank.close();
      canonical.close();
    }
  });

  it("has identical columns in every table, order included", () => {
    const blank = openBlank();
    const canonical = buildCanonical();
    try {
      for (const table of Object.keys(CANONICAL_TABLES)) {
        expect(
          readColumns(canonical, table),
          `column mismatch in "${table}"`,
        ).toEqual(readColumns(blank, table));
      }
    } finally {
      blank.close();
      canonical.close();
    }
  });

  it("agrees with the template on the lookup-table contents", () => {
    const blank = openBlank();
    const canonical = buildCanonical();
    try {
      for (const table of [
        "work_area_type",
        "control_type_type",
        "attachment_type",
      ]) {
        const a = canonical.prepare(`select * from ${table} order by id`).all();
        const b = blank.prepare(`select * from ${table} order by id`).all();
        expect(a, `lookup rows differ in "${table}"`).toEqual(b);
      }
    } finally {
      blank.close();
      canonical.close();
    }
  });

  it("names every index, trigger and view it declares", () => {
    // The migration looks these up by name to decide what to recreate
    // after a table rebuild, so a wrong name would silently skip one.
    const canonical = buildCanonical();
    try {
      for (const extras of Object.values(CANONICAL_TABLE_EXTRAS)) {
        for (const extra of extras) {
          const found = canonical
            .prepare("select 1 from sqlite_master where name = ? limit 1")
            .get(extra.name);
          expect(found, `no schema object named "${extra.name}"`).toBeTruthy();
        }
      }
    } finally {
      canonical.close();
    }
  });
});
