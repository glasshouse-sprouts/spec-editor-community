/**
 * Slice 10H.6a — tests for the virtual PFBB work_spec helpers.
 *
 * Two layers of testing:
 *   1. Pure `isVirtualWorkSpec` matcher — no DB, covers match-by-name,
 *      match-by-code, mismatches, casing, trimming, nulls.
 *   2. `ensureVirtualWorkSpec` + `findVirtualWorkSpecId` — round-tripped
 *      against the real Molio PFBB sample (which already has
 *      `S999.01`), and against a modified copy where we delete the
 *      virtual row to verify create-on-demand.
 *
 * Style note: mirrors `createPfbbChild.test.ts` — relies on
 * `findAllSamples` + a temp workDir, so we never mutate the source
 * sample file.
 */

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  VIRTUAL_WORK_SPEC_CODE,
  VIRTUAL_WORK_SPEC_NAME,
  ensureVirtualWorkSpec,
  findVirtualWorkSpecId,
  isVirtualWorkSpec,
  migrateOrphanPfbbMasters,
  moveBdbToVirtualWorkSpec,
  openMoliospec,
  readMoliospec,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const pfbbSample =
  samples.find(
    (s) =>
      s.label.includes("Version 01.00.04") &&
      s.label.toLowerCase().includes("projektf"),
  ) ?? samples.find((s) => s.label.toLowerCase().includes("projektf"));

/* ------------------------------------------------------------------ */
/*  1. Pure matcher                                                    */
/* ------------------------------------------------------------------ */

describe("isVirtualWorkSpec (pure)", () => {
  it("matches on canonical name", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: VIRTUAL_WORK_SPEC_NAME,
        work_area_code: null,
      }),
    ).toBe(true);
  });

  it("matches on canonical code", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: "Something else entirely",
        work_area_code: VIRTUAL_WORK_SPEC_CODE,
      }),
    ).toBe(true);
  });

  it("matches on both", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: VIRTUAL_WORK_SPEC_NAME,
        work_area_code: VIRTUAL_WORK_SPEC_CODE,
      }),
    ).toBe(true);
  });

  it("is case-insensitive on both fields", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: VIRTUAL_WORK_SPEC_NAME.toUpperCase(),
        work_area_code: null,
      }),
    ).toBe(true);
    expect(
      isVirtualWorkSpec({
        work_area_name: "x",
        work_area_code: VIRTUAL_WORK_SPEC_CODE.toLowerCase(),
      }),
    ).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: `  ${VIRTUAL_WORK_SPEC_NAME}   `,
        work_area_code: null,
      }),
    ).toBe(true);
  });

  it("does not match unrelated work_specs", () => {
    expect(
      isVirtualWorkSpec({
        work_area_name: "Fast inventar",
        work_area_code: "S245.01",
      }),
    ).toBe(false);
  });

  it("handles null/empty gracefully", () => {
    expect(
      isVirtualWorkSpec({ work_area_name: "", work_area_code: null }),
    ).toBe(false);
  });

  it("substring match should NOT count (guards against false positives)", () => {
    // A regular work_area that happens to contain "projektfælles"
    // as part of a longer name must NOT be treated as virtual.
    expect(
      isVirtualWorkSpec({
        work_area_name: "Projektfælles bygningsdelsbeskrivelser (KOPI)",
        work_area_code: null,
      }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  2. DB-backed helpers (uses the real Molio PFBB sample)             */
/* ------------------------------------------------------------------ */

describe("ensureVirtualWorkSpec / findVirtualWorkSpecId", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-virtual-workspec-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("finds the virtual work_spec in the PFBB sample without creating", async () => {
    if (!pfbbSample) return;
    const h = await openMoliospec(pfbbSample.path);
    try {
      const existingId = findVirtualWorkSpecId(h.db);
      expect(existingId).not.toBeNull();

      // Sanity: the row we found actually matches our convention.
      const file = readMoliospec(h);
      const ws = file.workSpecs.find((w) => w.id === existingId);
      expect(ws).toBeDefined();
      expect(isVirtualWorkSpec(ws!)).toBe(true);

      // ensureVirtualWorkSpec must be a no-op here.
      const ensured = ensureVirtualWorkSpec(h);
      expect(ensured.created).toBe(false);
      expect(ensured.workSpecId).toBe(existingId);

      // Row count of "virtual" work_specs still 1.
      const matches = file.workSpecs.filter(isVirtualWorkSpec);
      expect(matches.length).toBe(1);
    } finally {
      await h.close();
    }
  });

  it("creates the virtual work_spec when missing and is idempotent on second call", async () => {
    if (!pfbbSample) return;

    // Copy the sample to our temp workDir so we can mutate it.
    const copyPath = join(workDir, "stripped.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      // Re-point every PFBB master onto some other (real) work_spec
      // so we can drop the virtual row without breaking FKs on our
      // read. We just need the virtual row gone for the test.
      const virtualId = findVirtualWorkSpecId(h.db);
      expect(virtualId).not.toBeNull();

      const otherWs = h.db
        .prepare("select id from work_spec where id <> ? limit 1")
        .get(virtualId) as { id: number } | undefined;
      expect(otherWs).toBeDefined();

      h.db
        .prepare(
          "update construction_element_spec set work_spec_id = ? where work_spec_id = ?",
        )
        .run(otherWs!.id, virtualId);
      h.db
        .prepare("delete from work_spec_section where work_spec_id = ?")
        .run(virtualId);
      h.db.prepare("delete from work_spec where id = ?").run(virtualId);

      // Now the virtual row is truly gone.
      expect(findVirtualWorkSpecId(h.db)).toBeNull();

      // First call: creates.
      const first = ensureVirtualWorkSpec(h);
      expect(first.created).toBe(true);
      expect(first.workSpecId).toBeGreaterThan(0);

      // Reread to confirm the persisted row matches our convention.
      const file = readMoliospec(h);
      const created = file.workSpecs.find((w) => w.id === first.workSpecId);
      expect(created).toBeDefined();
      expect(created!.work_area_name).toBe(VIRTUAL_WORK_SPEC_NAME);
      expect(created!.work_area_code).toBe(VIRTUAL_WORK_SPEC_CODE);
      expect(created!.work_area_type).toBe(0);
      expect(created!.contract_id).toBeNull();
      expect(created!.molio_spec_guid).toBeNull();

      // Second call: no-op.
      const second = ensureVirtualWorkSpec(h);
      expect(second.created).toBe(false);
      expect(second.workSpecId).toBe(first.workSpecId);

      // Still exactly one match.
      const reread = readMoliospec(h);
      expect(reread.workSpecs.filter(isVirtualWorkSpec).length).toBe(1);
    } finally {
      await h.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  3. migrateOrphanPfbbMasters                                        */
/* ------------------------------------------------------------------ */

describe("migrateOrphanPfbbMasters", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-pfbb-migrate-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("is a no-op when every PFBB master already lives in the virtual work_spec", async () => {
    if (!pfbbSample) return;
    // The Molio sample is already well-formed.
    const h = await openMoliospec(pfbbSample.path);
    try {
      const result = migrateOrphanPfbbMasters(h);
      expect(result.movedCount).toBe(0);
      expect(result.movedBdbIds).toEqual([]);
      expect(result.createdVirtual).toBe(false);
    } finally {
      await h.close();
    }
  });

  it("moves orphan masters into the virtual work_spec and is idempotent", async () => {
    if (!pfbbSample) return;

    const copyPath = join(workDir, "orphaned.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      // Forge the "broken" state: take every PFBB master and point it at
      // some non-virtual work_spec. That's the exact shape the bug we're
      // fixing would leave behind (e.g. a user promoted a regular BDB
      // to is_pfbb=1 without moving it).
      const virtualIdBefore = findVirtualWorkSpecId(h.db);
      expect(virtualIdBefore).not.toBeNull();
      const otherWs = h.db
        .prepare("select id from work_spec where id <> ? limit 1")
        .get(virtualIdBefore) as { id: number } | undefined;
      expect(otherWs).toBeDefined();

      const mastersBefore = h.db
        .prepare("select id from construction_element_spec where is_pfbb = 1")
        .all() as { id: number }[];
      expect(mastersBefore.length).toBeGreaterThan(0);

      for (const m of mastersBefore) {
        h.db
          .prepare(
            "update construction_element_spec set work_spec_id = ? where id = ?",
          )
          .run(otherWs!.id, m.id);
      }

      // Sanity: readMoliospec now shows all masters in the wrong work_spec.
      const file = readMoliospec(h);
      for (const b of file.constructionElementSpecs) {
        if (b.is_pfbb === 1) {
          expect(b.work_spec_id).toBe(otherWs!.id);
        }
      }

      // Migrate.
      const result = migrateOrphanPfbbMasters(h);
      expect(result.movedCount).toBe(mastersBefore.length);
      expect(new Set(result.movedBdbIds)).toEqual(
        new Set(mastersBefore.map((m) => m.id)),
      );
      expect(result.createdVirtual).toBe(false); // already existed
      expect(result.virtualWorkSpecId).toBe(virtualIdBefore);

      // Every master now in the virtual work_spec.
      const after = readMoliospec(h);
      for (const b of after.constructionElementSpecs) {
        if (b.is_pfbb === 1) {
          expect(b.work_spec_id).toBe(virtualIdBefore);
        }
      }

      // Subscribers untouched (still in their real work_spec).
      const subscribers = after.constructionElementSpecs.filter(
        (b) => b.pfbb_id != null,
      );
      for (const s of subscribers) {
        expect(s.work_spec_id).not.toBe(virtualIdBefore);
      }

      // Idempotent: second call moves nothing.
      const again = migrateOrphanPfbbMasters(h);
      expect(again.movedCount).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("creates the virtual work_spec on the fly if missing AND there are orphans", async () => {
    if (!pfbbSample) return;

    const copyPath = join(workDir, "no-virtual.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      // Remove the virtual row (and its sections) and reassign masters
      // to a real work_spec — mimic a legacy file that never had the
      // "Projektfælles" container.
      const virtualIdBefore = findVirtualWorkSpecId(h.db);
      expect(virtualIdBefore).not.toBeNull();
      const otherWs = h.db
        .prepare("select id from work_spec where id <> ? limit 1")
        .get(virtualIdBefore) as { id: number } | undefined;
      expect(otherWs).toBeDefined();

      h.db
        .prepare(
          "update construction_element_spec set work_spec_id = ? where work_spec_id = ?",
        )
        .run(otherWs!.id, virtualIdBefore);
      h.db
        .prepare("delete from work_spec_section where work_spec_id = ?")
        .run(virtualIdBefore);
      h.db.prepare("delete from work_spec where id = ?").run(virtualIdBefore);
      expect(findVirtualWorkSpecId(h.db)).toBeNull();

      const result = migrateOrphanPfbbMasters(h);
      expect(result.createdVirtual).toBe(true);
      expect(result.movedCount).toBeGreaterThan(0);
      // The virtual row now exists at the returned id.
      expect(findVirtualWorkSpecId(h.db)).toBe(result.virtualWorkSpecId);
    } finally {
      await h.close();
    }
  });

  it("does NOT create the virtual work_spec when there are no masters at all", async () => {
    if (!pfbbSample) return;

    const copyPath = join(workDir, "no-masters.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      // Flip every master to regular BDB + drop the virtual row.
      const virtualId = findVirtualWorkSpecId(h.db);
      expect(virtualId).not.toBeNull();
      const otherWs = h.db
        .prepare("select id from work_spec where id <> ? limit 1")
        .get(virtualId) as { id: number } | undefined;

      // Also clear pfbb_id on subscribers so we don't leave dangling FKs.
      h.db
        .prepare(
          "update construction_element_spec set pfbb_id = null where pfbb_id is not null",
        )
        .run();
      h.db
        .prepare(
          "update construction_element_spec set is_pfbb = 0, work_spec_id = ? where is_pfbb = 1",
        )
        .run(otherWs!.id);
      h.db
        .prepare("delete from work_spec_section where work_spec_id = ?")
        .run(virtualId);
      h.db.prepare("delete from work_spec where id = ?").run(virtualId);

      const result = migrateOrphanPfbbMasters(h);
      expect(result.movedCount).toBe(0);
      expect(result.createdVirtual).toBe(false);
      // Virtual row should still be absent — no PFBBs means no need.
      expect(findVirtualWorkSpecId(h.db)).toBeNull();
    } finally {
      await h.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  4. Targeted single-BDB move (Slice 10H.6c)                         */
/* ------------------------------------------------------------------ */

describe("moveBdbToVirtualWorkSpec", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-pfbb-move-one-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("moves a BDB into the virtual work_spec when virtual already exists", async () => {
    if (!pfbbSample) return;
    const copyPath = join(workDir, "one-to-virtual.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      const virtualId = findVirtualWorkSpecId(h.db);
      expect(virtualId).not.toBeNull();

      // Pick a non-PFBB BDB in a regular work_spec, flip is_pfbb=1 by
      // hand (we're testing just the move, not the applyEdits path).
      const victim = h.db
        .prepare(
          "select id, work_spec_id from construction_element_spec where is_pfbb = 0 limit 1",
        )
        .get() as { id: number; work_spec_id: number } | undefined;
      expect(victim).toBeDefined();
      expect(victim!.work_spec_id).not.toBe(virtualId);

      const r = moveBdbToVirtualWorkSpec(h, victim!.id);
      expect(r.moved).toBe(true);
      expect(r.createdVirtual).toBe(false);
      expect(r.virtualWorkSpecId).toBe(virtualId);

      const after = h.db
        .prepare(
          "select work_spec_id from construction_element_spec where id = ?",
        )
        .get(victim!.id) as { work_spec_id: number };
      expect(after.work_spec_id).toBe(virtualId);
    } finally {
      await h.close();
    }
  });

  it("is idempotent — calling twice on the same BDB moves only once", async () => {
    if (!pfbbSample) return;
    const copyPath = join(workDir, "idempotent.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      const victim = h.db
        .prepare(
          "select id from construction_element_spec where is_pfbb = 0 limit 1",
        )
        .get() as { id: number };

      const r1 = moveBdbToVirtualWorkSpec(h, victim.id);
      expect(r1.moved).toBe(true);
      const r2 = moveBdbToVirtualWorkSpec(h, victim.id);
      expect(r2.moved).toBe(false);
      expect(r2.virtualWorkSpecId).toBe(r1.virtualWorkSpecId);
    } finally {
      await h.close();
    }
  });

  it("creates the virtual work_spec on the fly if missing", async () => {
    if (!pfbbSample) return;
    const copyPath = join(workDir, "create-virtual.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      // Remove the virtual row (and reassign masters to a regular WS
      // + clear pfbb_id so we can delete the virtual row safely).
      const virtualId = findVirtualWorkSpecId(h.db);
      expect(virtualId).not.toBeNull();
      const otherWs = h.db
        .prepare("select id from work_spec where id <> ? limit 1")
        .get(virtualId) as { id: number };
      h.db
        .prepare(
          "update construction_element_spec set pfbb_id = null where pfbb_id is not null",
        )
        .run();
      h.db
        .prepare(
          "update construction_element_spec set work_spec_id = ? where work_spec_id = ?",
        )
        .run(otherWs.id, virtualId);
      h.db
        .prepare("delete from work_spec_section where work_spec_id = ?")
        .run(virtualId);
      h.db.prepare("delete from work_spec where id = ?").run(virtualId);

      expect(findVirtualWorkSpecId(h.db)).toBeNull();

      const victim = h.db
        .prepare(
          "select id from construction_element_spec where is_pfbb = 0 limit 1",
        )
        .get() as { id: number };

      const r = moveBdbToVirtualWorkSpec(h, victim.id);
      expect(r.moved).toBe(true);
      expect(r.createdVirtual).toBe(true);
      expect(findVirtualWorkSpecId(h.db)).toBe(r.virtualWorkSpecId);
    } finally {
      await h.close();
    }
  });

  it("throws for an unknown BDB id", async () => {
    if (!pfbbSample) return;
    const copyPath = join(workDir, "unknown-id.moliospec");
    await copyFile(pfbbSample.path, copyPath);

    const h = await openMoliospec(copyPath);
    try {
      expect(() => moveBdbToVirtualWorkSpec(h, 999999)).toThrow(
        /no such construction_element_spec/,
      );
    } finally {
      await h.close();
    }
  });
});
