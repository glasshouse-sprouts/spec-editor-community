/**
 * Tests for the 01.00.04 forward migration (Task 1 / M1, slice 2).
 *
 * The bug being fixed: on a file written before schema 01.00.03, every save
 * failed - including after an ordinary text edit - because `applyEdits`
 * prepares statements against the `contracts` table unconditionally and
 * better-sqlite3 compiles a statement as soon as it is prepared. The user
 * could work for hours and only find out at save time.
 *
 * The first test below is therefore the important one: open an old file,
 * edit a paragraph, save, reopen, and see the text. It fails on `main`
 * without the migration.
 */

import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CANONICAL_TABLES,
  CURRENT_DB_VERSION,
  applyEdits,
  compareDbVersion,
  migrateToCurrent,
  openMoliospec,
  parseCoreErrorMessage,
  planMigration,
  readColumns,
  readMoliospec,
  type MoliospecHandle,
} from "../src/index.js";
import { REPO_ROOT, findAllSamples } from "./samples.js";

const samples = findAllSamples();
const BLANK = join(
  REPO_ROOT,
  "packages",
  "app",
  "resources",
  "blank.moliospec",
);

/** Every legacy fixture, oldest first. */
const LEGACY_VERSIONS = ["01.00.00", "01.00.01", "01.00.03"] as const;

function fixture(version: string): string {
  const needle = `synthetic-legacy-${version.replace(/\./g, "-")}`;
  const hit = samples.find((s) => s.label.includes(needle));
  if (!hit) {
    throw new Error(
      `Legacy fixture for ${version} not found. Run: ` +
        `python3 scripts/generate-test-fixtures.py legacy`,
    );
  }
  return hit.path;
}

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "migrate-"));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** A genuine 01.00.04 file to prove current files are left alone. */
function currentSample(): string {
  const hit = samples.find((s) => s.label.toLowerCase().includes("showoff"));
  if (!hit) {
    throw new Error(
      "The 01.00.04 showoff fixture is missing. Run: " +
        "python3 scripts/generate-test-fixtures.py",
    );
  }
  return hit.path;
}

/** Open the shipped blank template read-only on a scratch copy. */
async function openBlankTemplate(name: string): Promise<BetterSqliteDatabase> {
  const path = join(workDir, `blank-${name}.sqlite`);
  await writeFile(path, gunzipSync(await readFile(BLANK)));
  return new Database(path, { readonly: true });
}

/** Schema objects, minus SQLite's own implicit indexes. */
function objectNames(db: BetterSqliteDatabase): string[] {
  const rows = db.prepare("select type, name from sqlite_master").all() as {
    type: string;
    name: string;
  }[];
  return rows
    .filter((r) => !r.name.startsWith("sqlite_autoindex"))
    .map((r) => `${r.type}:${r.name}`)
    .sort();
}

/** Counts that must survive an upgrade untouched. */
function rowCounts(handle: MoliospecHandle): Record<string, number> {
  const file = readMoliospec(handle);
  return {
    workSpecs: file.workSpecs.length,
    workSpecSections: file.workSpecSections.length,
    bdbs: file.constructionElementSpecs.length,
    bdbSections: file.constructionElementSpecSections.length,
    controlPlans: file.controlPlans.length,
    controlPlanSections: file.controlPlanSections.length,
    controlPlanHeaders: file.controlPlanSectionHeaders.length,
    attachments: file.attachments.length,
  };
}

describe("compareDbVersion", () => {
  it("orders versions numerically, not alphabetically", () => {
    expect(compareDbVersion("01.00.00", "01.00.03")).toBeLessThan(0);
    expect(compareDbVersion("01.00.03", "01.00.04")).toBeLessThan(0);
    expect(compareDbVersion("01.00.04", "01.00.04")).toBe(0);
    expect(compareDbVersion("01.00.10", "01.00.09")).toBeGreaterThan(0);
  });

  it("returns null rather than guessing at an unrecognised version", () => {
    expect(compareDbVersion("unknown", "01.00.04")).toBeNull();
    expect(compareDbVersion("", "01.00.04")).toBeNull();
    expect(compareDbVersion("1.0", "01.00.04")).toBeNull();
  });
});

describe("planMigration", () => {
  it("flags 01.00.00 and 01.00.01, leaves 01.00.03 alone", async () => {
    for (const version of LEGACY_VERSIONS) {
      const h = await openMoliospec(fixture(version));
      try {
        const plan = planMigration(h);
        expect(plan.fromVersion).toBe(version);
        expect(plan.toVersion).toBe(CURRENT_DB_VERSION);
        expect(plan.needed).toBe(version !== "01.00.03");
      } finally {
        await h.close();
      }
    }
  });

  it("only warns about control-plan links for 01.00.00", async () => {
    const old = await openMoliospec(fixture("01.00.00"));
    const newer = await openMoliospec(fixture("01.00.01"));
    try {
      expect(planMigration(old).losesControlPlanLinks).toBe(true);
      expect(planMigration(newer).losesControlPlanLinks).toBe(false);
    } finally {
      await old.close();
      await newer.close();
    }
  });

  it("changes nothing", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      const before = await h.sqliteSha256();
      planMigration(h);
      expect(await h.sqliteSha256()).toBe(before);
    } finally {
      await h.close();
    }
  });
});

describe("the original bug: edit an old file, save it, read it back", () => {
  for (const version of [...LEGACY_VERSIONS, "01.00.04"]) {
    it(`works for ${version}`, async () => {
      const source =
        version === "01.00.04" ? currentSample() : fixture(version);
      // 01.00.03 already has the complete current schema, so it is
      // deliberately left alone - including its version stamp. Only a
      // file that actually needed upgrading gets restamped.
      const expectedVersion =
        version === "01.00.03" ? "01.00.03" : CURRENT_DB_VERSION;

      const handle = await openMoliospec(source);
      const target = join(workDir, `edited-${version}.moliospec`);
      const marker = `<p>Redigeret i test ${version}.</p>`;
      try {
        migrateToCurrent(handle);

        // An ordinary body edit - nothing to do with contracts. This is
        // exactly what used to fail.
        const sectionId = readMoliospec(handle).workSpecSections[0]?.id;
        expect(sectionId, "fixture has no work-spec sections").toBeDefined();
        applyEdits(handle, [
          { target: "workSpec", sectionId: sectionId!, body: marker },
        ]);
        await handle.saveAs(target);
      } finally {
        await handle.close();
      }

      const reopened = await openMoliospec(target);
      try {
        const file = readMoliospec(reopened);
        expect(file.dbVersion).toBe(expectedVersion);
        expect(file.workSpecSections.map((s) => s.body)).toContain(marker);
      } finally {
        await reopened.close();
      }
    });
  }
});

describe("migrateToCurrent - the produced file is a real 01.00.04 file", () => {
  for (const version of ["01.00.00", "01.00.01"] as const) {
    describe(version, () => {
      it("ends up with the exact schema of the shipped blank template", async () => {
        const blank = await openBlankTemplate(version);
        const h = await openMoliospec(fixture(version));
        try {
          migrateToCurrent(h);
          expect(objectNames(h.db)).toEqual(objectNames(blank));
          for (const table of Object.keys(CANONICAL_TABLES)) {
            expect(
              readColumns(h.db, table),
              `column mismatch in "${table}" after migrating ${version}`,
            ).toEqual(readColumns(blank, table));
          }
        } finally {
          blank.close();
          await h.close();
        }
      });

      it("stamps the new version and reports what it did", async () => {
        const h = await openMoliospec(fixture(version));
        try {
          const result = migrateToCurrent(h);
          expect(result.migrated).toBe(true);
          expect(result.fromVersion).toBe(version);
          expect(readMoliospec(h).dbVersion).toBe(CURRENT_DB_VERSION);
          expect(result.createdTables).toContain("contracts");
          expect(result.createdTables).toContain("control_type_type");
          expect(result.foreignKeyViolations).toBe(0);
        } finally {
          await h.close();
        }
      });

      it("keeps every row", async () => {
        const h = await openMoliospec(fixture(version));
        try {
          const before = rowCounts(h);
          const bodies = readMoliospec(h).workSpecSections.map((s) => s.body);
          migrateToCurrent(h);
          expect(rowCounts(h)).toEqual(before);
          expect(readMoliospec(h).workSpecSections.map((s) => s.body)).toEqual(
            bodies,
          );
        } finally {
          await h.close();
        }
      });

      it("seeds the lookup tables it had to create", async () => {
        const h = await openMoliospec(fixture(version));
        try {
          migrateToCurrent(h);
          const controlTypes = h.db
            .prepare("select id, control_type, name from control_type_type")
            .all() as { id: number }[];
          expect(controlTypes.length).toBe(4);
          const workAreaTypes = h.db
            .prepare("select id from work_area_type")
            .all();
          expect(workAreaTypes.length).toBe(3);
        } finally {
          await h.close();
        }
      });

      it("is a no-op the second time round", async () => {
        const h = await openMoliospec(fixture(version));
        try {
          migrateToCurrent(h);
          const again = migrateToCurrent(h);
          expect(again.migrated).toBe(false);
          expect(again.fromVersion).toBe(CURRENT_DB_VERSION);
        } finally {
          await h.close();
        }
      });
    });
  }

  it("01.00.00: creates the work_area_type lookup table too", async () => {
    // Easy to miss: 01.00.00 has work_area_type as a COLUMN on work_spec
    // but not as the lookup TABLE the column points at from 01.00.01 on.
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      expect(migrateToCurrent(h).createdTables).toContain("work_area_type");
    } finally {
      await h.close();
    }
  });
});

describe("what was dropped is really gone, not just hidden", () => {
  it("leaves no trace of project_key in the finished file", async () => {
    // A rebuilt table's old rows live on in the file's free space
    // unless the database is vacuumed. The dialog tells the user their
    // control-plan links were not carried over; this is what makes
    // that literally true rather than merely true of what tools show.
    const h = await openMoliospec(fixture("01.00.00"));
    const target = join(workDir, "vacuumed.sqlite");
    try {
      migrateToCurrent(h);
      // Save raw so we inspect the actual SQLite image, not a gzip of it.
      await h.saveAs(target, { gzip: false });
    } finally {
      await h.close();
    }

    const bytes = await readFile(target);
    // `project_key` only ever existed in the pre-01.00.01 schema, so
    // finding the string anywhere in the file means an old page survived.
    expect(bytes.includes("project_key")).toBe(false);
  });

  it("still has the data that was supposed to survive", async () => {
    // The other half of the same claim: vacuuming must not take
    // anything real with it.
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      const before = rowCounts(h);
      migrateToCurrent(h);
      expect(rowCounts(h)).toEqual(before);
      expect(readMoliospec(h).project?.project_number).not.toBe("");
    } finally {
      await h.close();
    }
  });
});

describe("migrateToCurrent - the 01.00.00 column renames", () => {
  it("moves project_key into project_number and drops the old column", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      const before = h.db
        .prepare("select project_key from project limit 1")
        .get() as { project_key: string };
      migrateToCurrent(h);
      const after = readMoliospec(h).project;
      expect(after?.project_number).toBe(before.project_key);
      expect(readColumns(h.db, "project").map((c) => c.name)).not.toContain(
        "project_key",
      );
    } finally {
      await h.close();
    }
  });

  it("moves control_plan.header into number_text and drops the old column", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      const before = h.db
        .prepare("select id, header from control_plan order by id")
        .all() as { id: number; header: string }[];
      migrateToCurrent(h);
      const after = readMoliospec(h).controlPlans;
      expect(after.map((cp) => cp.number_text)).toEqual(
        before.map((cp) => cp.header),
      );
      expect(
        readColumns(h.db, "control_plan").map((c) => c.name),
      ).not.toContain("header");
    } finally {
      await h.close();
    }
  });

  it("leaves no legacy control-plan columns on work_spec", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      migrateToCurrent(h);
      const names = readColumns(h.db, "work_spec").map((c) => c.name);
      expect(names).not.toContain("controlplan_design_id");
      expect(names).not.toContain("controlplan_production_id");
      expect(names).toContain("contract_id");
    } finally {
      await h.close();
    }
  });
});

describe("control-plan links", () => {
  it("01.00.00: drops them rather than guessing, and says how many", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      const result = migrateToCurrent(h);
      // The fixture links one control plan per work area, and WA-01 has
      // two building element specs - which is precisely why guessing is
      // not allowed.
      expect(result.losesControlPlanLinks).toBe(true);
      expect(result.droppedControlPlanLinks).toBe(2);

      const file = readMoliospec(h);
      const stillLinked = file.constructionElementSpecs.filter(
        (b) => b.controlplan_design_id ?? b.controlplan_production_id,
      );
      expect(stillLinked).toEqual([]);
      // The control plans themselves must survive - only the link goes.
      expect(file.controlPlans.length).toBe(2);
      expect(file.controlPlanSections.length).toBe(6);
    } finally {
      await h.close();
    }
  });

  it("01.00.01: keeps them, because they already sit in the right place", async () => {
    const h = await openMoliospec(fixture("01.00.01"));
    try {
      const result = migrateToCurrent(h);
      expect(result.droppedControlPlanLinks).toBe(0);
      const stillLinked = readMoliospec(h).constructionElementSpecs.filter(
        (b) => b.controlplan_design_id ?? b.controlplan_production_id,
      );
      expect(stillLinked.length).toBe(2);
    } finally {
      await h.close();
    }
  });
});

describe("files that are already current are not touched", () => {
  it("01.00.03 keeps its bytes and its version stamp", async () => {
    const h = await openMoliospec(fixture("01.00.03"));
    try {
      const before = await h.sqliteSha256();
      const result = migrateToCurrent(h);
      expect(result.migrated).toBe(false);
      expect(await h.sqliteSha256()).toBe(before);
      expect(readMoliospec(h).dbVersion).toBe("01.00.03");
    } finally {
      await h.close();
    }
  });

  it("a 01.00.04 file keeps its bytes", async () => {
    const h = await openMoliospec(currentSample());
    try {
      const before = await h.sqliteSha256();
      expect(migrateToCurrent(h).migrated).toBe(false);
      expect(await h.sqliteSha256()).toBe(before);
    } finally {
      await h.close();
    }
  });
});

describe("failures are reported as coded errors, never as raw SQLite text", () => {
  it("wraps a broken upgrade in IO_MIGRATION_FAILED", async () => {
    const h = await openMoliospec(fixture("01.00.00"));
    try {
      // Occupy the name the rebuild wants to move work_spec out of the
      // way to, so the very first ALTER TABLE fails. Any failure inside
      // the migration should surface the same way.
      h.db.exec('create table "work_spec__molio_migrate_old" (x integer)');

      let caught: unknown;
      try {
        migrateToCurrent(h);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const parsed = parseCoreErrorMessage((caught as Error).message);
      expect(parsed?.code).toBe("IO_MIGRATION_FAILED");
      expect(parsed?.params.fromVersion).toBe("01.00.00");
      // The dev-facing detail may mention SQLite; the coded head is what
      // the renderer shows, and it never leaks the raw driver message.
      expect((caught as Error).message.startsWith("[MOLIO_ERR:")).toBe(true);
    } finally {
      await h.close();
    }
  });

  it("leaves the file unchanged when the upgrade fails", async () => {
    const h = await openMoliospec(fixture("01.00.01"));
    try {
      h.db.exec('create table "work_spec__molio_migrate_old" (x integer)');
      const counts = rowCounts(h);
      expect(() => migrateToCurrent(h)).toThrow();
      // The transaction rolled back: the data is all still there and the
      // version stamp has not moved.
      expect(rowCounts(h)).toEqual(counts);
      expect(readMoliospec(h).dbVersion).toBe("01.00.01");
    } finally {
      await h.close();
    }
  });
});
