/**
 * BDB-level write operations: create BDB, duplicate BDB, create PFBB
 * child.
 *
 * `createBdb` — create a brand-new, empty, ordinary BDB from scratch
 * under an existing work area (Skive 2, custom structures). No Molio
 * identity, no control plans, zero sections.
 *
 * `duplicateBdb` — clone a construction_element_spec row plus its
 * sections into the same work area. New BDB id; section ids
 * regenerate.
 *
 * `createPfbbChild` — create a "subscriber" BDB linked to a master
 * via `pfbb_id`. Used by the PFBB inheritance flow (Slice 10H).
 *
 * Extracted from `write.ts` in slice #233-followup.
 */

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";
import { duplicateControlPlan } from "./writeCp.js";

/* ------------------------------------------------------------------ */
/*  Create BDB from scratch (Skive 2 — custom structures)              */
/* ------------------------------------------------------------------ */

export interface CreateBdbArgs {
  /** The work area (work_spec) the new BDB belongs to. Must exist. */
  workSpecId: number;
  /**
   * Display name (`name`, NOT NULL). Required. Trimmed before insert;
   * an empty / whitespace-only name is rejected. Must be unique within
   * the target work area (case-sensitive) — Molio identifies BDBs by
   * name at the work-area level, matching `createPfbbChild`.
   */
  name: string;
}

export interface CreateBdbResult {
  /** The new BDB's id. */
  bdbId: number;
}

/**
 * Create a new, EMPTY, ordinary BDB (construction_element_spec) from
 * scratch under an existing work area.
 *
 * "Ordinary" = `is_pfbb = 0`, `pfbb_id = NULL`: a normal project BDB,
 * not a project-wide (PFBB) master or subscriber. Every `molio_*`
 * identity GUID and both control-plan slots are left NULL — a
 * from-scratch BDB has no Molio-registry identity and no attached
 * control plans, and starts with zero sections. Sections and control
 * plans are added afterwards with the dedicated tools.
 *
 * Only the two NOT NULL columns we care about are set explicitly
 * (`work_spec_id`, `name`); `is_pfbb` is set to 0 for clarity even
 * though the schema already defaults it. Everything else defaults to
 * NULL.
 *
 * Validation: name non-empty after trimming; the target work area
 * exists; no existing BDB in that work area already has the same
 * trimmed name (case-sensitive).
 *
 * The insert runs inside a transaction for consistency with the other
 * write helpers.
 */
export function createBdb(
  handle: MoliospecHandle,
  args: CreateBdbArgs,
): CreateBdbResult {
  const db = handle.db;
  const { workSpecId } = args;

  const name = (args.name ?? "").trim();
  if (name.length === 0) {
    throw new CoreError("BDB_NAME_EMPTY", {}, "createBdb: name is empty");
  }

  const workSpec = db
    .prepare("select id from work_spec where id = ? limit 1")
    .get(workSpecId) as { id: number } | undefined;
  if (!workSpec) {
    throw new CoreError(
      "WORKSPEC_NOT_FOUND",
      { workSpecId },
      `createBdb: no such work_spec id=${workSpecId}`,
    );
  }

  const dup = db
    .prepare(
      "select id from construction_element_spec " +
        "where work_spec_id = ? and name = ? limit 1",
    )
    .get(workSpecId, name) as { id: number } | undefined;
  if (dup) {
    throw new CoreError(
      "BDB_DUPLICATE_NAME",
      { name, workSpecId },
      `createBdb: a BDB named "${name}" already exists in work_spec id=${workSpecId}`,
    );
  }

  const tx = db.transaction((): number => {
    const info = db
      .prepare(
        "insert into construction_element_spec (work_spec_id, is_pfbb, name) " +
          "values (?, 0, ?)",
      )
      .run(workSpecId, name);
    return Number(info.lastInsertRowid);
  });

  return { bdbId: tx() };
}

/* ------------------------------------------------------------------ */
/*  BDB duplication                                                    */
/* ------------------------------------------------------------------ */

export interface DuplicateBdbArgs {
  /** The BDB to copy. */
  bdbId: number;
  /**
   * Optional explicit new name. If omitted, we use `<original> (copy)`.
   * The UI lets the user pick a name up-front; the default keeps this
   * function usable from tests and scripts without ceremony.
   */
  newName?: string;
  /**
   * When true, also deep-copy each attached control plan (design and
   * production slots) and link the new CPs to the duplicate BDB. The
   * new CPs reuse the source's title, number_text, revision, and rows
   * — the user can rename or edit afterwards. When false / omitted,
   * the new BDB has NULL CP slots (the pre-2026-05-11 behavior).
   *
   * Always copies; never shares. If the caller wants the new BDB to
   * point at the SAME CP rows as the original ("common control plan"
   * pattern), they must do that as a separate edit — this flag
   * deliberately makes the safer choice the default.
   */
  includeControlPlans?: boolean;
}

export interface DuplicateBdbResult {
  /** The new BDB's id. */
  newBdbId: number;
  /**
   * Old-section-id → new-section-id mapping. Useful for the caller if it
   * needs to update any other tables (currently just sections, but this
   * keeps the API extension-friendly).
   */
  sectionIdMap: Record<number, number>;
  /**
   * When `includeControlPlans` was true, the ids of the newly-created
   * control plans (one per slot the source had filled). Empty array
   * when the flag was off or the source had no CPs. Mostly diagnostic;
   * the UI doesn't need them since it reloads the file after duplicate.
   */
  newControlPlanIds: number[];
}

/**
 * Duplicate a construction_element_spec (BDB) together with all its
 * sections. Per user spec as of 2026-04-18:
 *
 *   - Attachments: NOT copied. (The attachment table FKs work_spec, not
 *     BDB — so there's nothing to copy here anyway.)
 *   - References (basis / referenceliste): copied as-is. The duplicate
 *     points at the same Molio source content.
 *   - Identity GUIDs (molio_construction_element_spec_guid and its
 *     revision GUID): cleared to NULL on the copy. The duplicate is a
 *     new BDB in this project, not known to Molio's registry.
 *   - Control-plan links (controlplan_design_id / _production_id +
 *     common_controlplan_*_guid): cleared to NULL. A copy should NOT
 *     silently share a CP with the original, and copying a CP is a
 *     bigger decision (we'd have to ask the user, at minimum).
 *   - Sections: every construction_element_spec_section row is copied
 *     with new primary keys. The self-referential `parent_id` is
 *     rewritten to point at the new ids via an id map.
 *
 * All inserts run inside a single transaction so the file is either
 * fully duplicated or untouched.
 */
export function duplicateBdb(
  handle: MoliospecHandle,
  args: DuplicateBdbArgs,
): DuplicateBdbResult {
  const { bdbId } = args;
  const db = handle.db;

  const bdb = db
    .prepare("select * from construction_element_spec where id = ? limit 1")
    .get(bdbId) as Record<string, unknown> | undefined;
  if (!bdb) {
    throw new CoreError(
      "INTERNAL",
      { bdbId },
      `duplicateBdb: no such BDB id=${bdbId}`,
    );
  }

  const originalName = (bdb["name"] as string) ?? "Untitled";
  const newName = args.newName ?? `${originalName} (copy)`;

  const tx = db.transaction(() => {
    // Insert the copy. We explicitly list every column so future schema
    // additions (e.g. a new nullable field) fail loudly here rather
    // than silently leaving the new column unset — better to notice
    // early than to ship a half-copied BDB.
    const info = db
      .prepare(
        `insert into construction_element_spec (
          work_spec_id, pfbb_id, is_pfbb, name,
          created_by_organization, created_by, revision_date, revision,
          reviewed_by, approved_by,
          molio_spec_guid, molio_spec_revision_guid,
          controlplan_design_id, controlplan_production_id,
          common_controlplan_design_guid, common_controlplan_production_guid,
          molio_construction_element_spec_guid,
          molio_construction_element_spec_revision_guid,
          molio_referencelist_area, issue_date,
          molio_spec_revision_no, molio_spec_revision_date,
          molio_referencelist_area_date,
          molio_construction_element_spec_revision_no,
          molio_construction_element_spec_revision_date
        ) values (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          null, null,
          null, null,
          null, null,
          ?, ?,
          ?, ?,
          ?,
          ?, ?
        )`,
      )
      .run(
        bdb["work_spec_id"] as number | null,
        bdb["pfbb_id"] as number | null,
        bdb["is_pfbb"] as number,
        newName,
        bdb["created_by_organization"] as string | null,
        bdb["created_by"] as string | null,
        bdb["revision_date"] as string | null,
        bdb["revision"] as string | null,
        bdb["reviewed_by"] as string | null,
        bdb["approved_by"] as string | null,
        bdb["molio_spec_guid"] as string | null,
        bdb["molio_spec_revision_guid"] as string | null,
        bdb["molio_referencelist_area"] as string | null,
        bdb["issue_date"] as string | null,
        bdb["molio_spec_revision_no"] as string | null,
        bdb["molio_spec_revision_date"] as string | null,
        bdb["molio_referencelist_area_date"] as string | null,
        bdb["molio_construction_element_spec_revision_no"] as string | null,
        bdb["molio_construction_element_spec_revision_date"] as string | null,
      );
    const newBdbId = Number(info.lastInsertRowid);

    // Copy sections. parent_id is self-referential — we do a two-pass
    // insert so we always know the remapped parent id before writing.
    //
    // Pass 1: insert rows with parent_id = null, collect the mapping.
    const sections = db
      .prepare(
        "select id, section_no, heading, body, molio_section_guid, parent_id, pfbb_section_id " +
          "from construction_element_spec_section where construction_element_spec_id = ? order by id",
      )
      .all(bdbId) as {
      id: number;
      section_no: number;
      heading: string;
      body: string | null;
      molio_section_guid: string | null;
      parent_id: number | null;
      pfbb_section_id: number | null;
    }[];

    const sectionIdMap: Record<number, number> = {};
    const insertSection = db.prepare(
      "insert into construction_element_spec_section (" +
        "construction_element_spec_id, section_no, heading, body, molio_section_guid, parent_id, pfbb_section_id" +
        ") values (?, ?, ?, ?, ?, null, ?)",
    );
    for (const s of sections) {
      const r = insertSection.run(
        newBdbId,
        s.section_no,
        s.heading,
        s.body ?? "",
        s.molio_section_guid,
        s.pfbb_section_id,
      );
      sectionIdMap[s.id] = Number(r.lastInsertRowid);
    }

    // Pass 2: patch parent_id now that every row has a known new id.
    const updateParent = db.prepare(
      "update construction_element_spec_section set parent_id = ? where id = ?",
    );
    for (const s of sections) {
      if (s.parent_id == null) continue;
      const mapped = sectionIdMap[s.parent_id];
      if (mapped == null) {
        // Dangling parent in the source file — preserve the dangle by
        // leaving parent_id null rather than pointing at an unrelated row.
        continue;
      }
      updateParent.run(mapped, sectionIdMap[s.id]);
    }

    // Optionally also duplicate the attached control plans. Each
    // non-null slot id on the SOURCE BDB becomes a fresh CP linked
    // to the new BDB on the same slot. We delegate to
    // `duplicateControlPlan` (in writeCp.ts) for the per-CP deep
    // copy — it knows about headers, rows, the slot column, and
    // already runs inside its own transaction (nested → SAVEPOINT,
    // safe in better-sqlite3).
    const newControlPlanIds: number[] = [];
    if (args.includeControlPlans) {
      const slotPairs: Array<{
        idStr: string | null;
        slot: "design" | "production";
      }> = [
        {
          idStr: bdb["controlplan_design_id"] as string | null,
          slot: "design",
        },
        {
          idStr: bdb["controlplan_production_id"] as string | null,
          slot: "production",
        },
      ];
      for (const { idStr, slot } of slotPairs) {
        if (idStr == null || idStr === "") continue;
        const sourceCpId = Number.parseInt(idStr, 10);
        if (!Number.isFinite(sourceCpId)) continue;
        const sourceTitle = db
          .prepare("select title from control_plan where id = ? limit 1")
          .get(sourceCpId) as { title: string } | undefined;
        if (!sourceTitle) continue;
        const res = duplicateControlPlan(handle, {
          sourceCpId,
          bdbId: newBdbId,
          slot,
          // Same title — disambiguation comes from the BDB name +
          // the slot. Users can rename via the CP table header
          // after the duplicate lands.
          title: sourceTitle.title,
        });
        newControlPlanIds.push(res.newControlPlanId);
      }
    }

    return { newBdbId, sectionIdMap, newControlPlanIds };
  });

  return tx();
}

/* ------------------------------------------------------------------ */
/*  PFBB — create child (Slice 10H.3)                                  */
/* ------------------------------------------------------------------ */

export interface CreatePfbbChildArgs {
  /**
   * The PFBB master to subscribe to. Must be a row in
   * `construction_element_spec` with `is_pfbb = 1` and `pfbb_id` null.
   */
  masterId: number;
  /**
   * The work_spec the new child should belong to. Must NOT be the same
   * work_spec the master lives in (the virtual "Projektfælles"
   * bucket) — children live in real work areas.
   */
  targetWorkSpecId: number;
  /**
   * The child's display name. Required. Leading/trailing whitespace is
   * trimmed; an empty name (including whitespace-only) is rejected. The
   * user is expected to pick a meaningful name in the UI dialog.
   */
  name: string;
}

export interface CreatePfbbChildResult {
  /** The id of the newly-inserted child BDB. */
  newBdbId: number;
}

/**
 * Create a "child" (subscriber) BDB that points at a PFBB master.
 *
 * Schema mechanics (see `pfbb_investigation.md` §1–§3):
 *
 *   - A child is a normal row in `construction_element_spec` with
 *     `is_pfbb = 0` and `pfbb_id` set to the master's id.
 *   - Children do NOT copy the master's sections. They only store
 *     supplement sections later, via `pfbb_section_id`. So this writer
 *     inserts exactly one row and no sections.
 *   - The child inherits the master's `molio_spec_guid` /
 *     `molio_spec_revision_guid`. Molio convention says a subscriber
 *     must use the same basic specification as its master.
 *   - All other fields (GUIDs, control-plan links, revision metadata,
 *     created_by / approved_by, dates, etc.) are set to NULL. The child
 *     is a fresh BDB in this project, not in Molio's registry, and must
 *     not silently share a CP with its master.
 *
 * Validation (fail fast — throws on any violation):
 *
 *   1. Master exists.
 *   2. Master is actually a PFBB master (`is_pfbb = 1`).
 *   3. Master is not itself a subscriber (`pfbb_id IS NULL` — no chains).
 *   4. Target work_spec exists.
 *   5. Target work_spec is NOT the master's work_spec (children live in
 *      real work areas, not in the virtual Projektfælles bucket).
 *   6. Name is non-empty after trimming.
 *   7. No existing BDB in the target work_spec has the same trimmed
 *      name (case-sensitive, matches Molio's own uniqueness expectation
 *      at the work-area level).
 *
 * The IPC layer (10H.4) and the modal (10H.5) are expected to do a
 * friendlier check before calling this — these throws are the safety
 * net, not the primary UI affordance.
 */
export function createPfbbChild(
  handle: MoliospecHandle,
  args: CreatePfbbChildArgs,
): CreatePfbbChildResult {
  const { masterId, targetWorkSpecId } = args;
  const db = handle.db;

  const trimmedName = (args.name ?? "").trim();
  if (trimmedName.length === 0) {
    throw new CoreError(
      "PFBB_NAME_EMPTY",
      {},
      "createPfbbChild: name is empty",
    );
  }

  const master = db
    .prepare(
      "select id, work_spec_id, is_pfbb, pfbb_id, " +
        "molio_spec_guid, molio_spec_revision_guid " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(masterId) as
    | {
        id: number;
        work_spec_id: number | null;
        is_pfbb: number;
        pfbb_id: number | null;
        molio_spec_guid: string | null;
        molio_spec_revision_guid: string | null;
      }
    | undefined;
  if (!master) {
    throw new CoreError(
      "INTERNAL",
      { masterId },
      `createPfbbChild: no such BDB id=${masterId}`,
    );
  }
  if (master.is_pfbb !== 1) {
    throw new CoreError(
      "INTERNAL",
      { masterId, isPfbb: master.is_pfbb },
      `createPfbbChild: BDB id=${masterId} is not a PFBB master (is_pfbb=${master.is_pfbb})`,
    );
  }
  if (master.pfbb_id != null) {
    // PFBB → PFBB chains are forbidden by the Molio doc, and here we
    // also protect against any subscriber being promoted to a "master"
    // by mistake. Belt and braces.
    throw new CoreError(
      "INTERNAL",
      { masterId, pfbbId: master.pfbb_id },
      `createPfbbChild: BDB id=${masterId} is itself a subscriber (pfbb_id=${master.pfbb_id}); PFBB chains are not allowed`,
    );
  }

  const workSpec = db
    .prepare("select id from work_spec where id = ? limit 1")
    .get(targetWorkSpecId) as { id: number } | undefined;
  if (!workSpec) {
    throw new CoreError(
      "INTERNAL",
      { targetWorkSpecId },
      `createPfbbChild: no such work_spec id=${targetWorkSpecId}`,
    );
  }
  if (master.work_spec_id === targetWorkSpecId) {
    throw new CoreError(
      "PFBB_INVALID_TARGET",
      { targetWorkSpecId },
      `createPfbbChild: target work_spec id=${targetWorkSpecId} is the master's own work_spec; children must live in a real work area`,
    );
  }

  // Name uniqueness inside the target work_spec. Case-sensitive.
  const dup = db
    .prepare(
      "select id from construction_element_spec " +
        "where work_spec_id = ? and name = ? limit 1",
    )
    .get(targetWorkSpecId, trimmedName) as { id: number } | undefined;
  if (dup) {
    throw new CoreError(
      "PFBB_DUPLICATE_NAME",
      { name: trimmedName, targetWorkSpecId },
      `createPfbbChild: a BDB named "${trimmedName}" already exists in work_spec id=${targetWorkSpecId}`,
    );
  }

  const tx = db.transaction(() => {
    // Every column listed explicitly — same rationale as duplicateBdb:
    // a future schema column addition should fail loudly here, not
    // silently leave something unset.
    const info = db
      .prepare(
        `insert into construction_element_spec (
          work_spec_id, pfbb_id, is_pfbb, name,
          created_by_organization, created_by, revision_date, revision,
          reviewed_by, approved_by,
          molio_spec_guid, molio_spec_revision_guid,
          controlplan_design_id, controlplan_production_id,
          common_controlplan_design_guid, common_controlplan_production_guid,
          molio_construction_element_spec_guid,
          molio_construction_element_spec_revision_guid,
          molio_referencelist_area, issue_date,
          molio_spec_revision_no, molio_spec_revision_date,
          molio_referencelist_area_date,
          molio_construction_element_spec_revision_no,
          molio_construction_element_spec_revision_date
        ) values (
          ?, ?, 0, ?,
          null, null, null, null,
          null, null,
          ?, ?,
          null, null,
          null, null,
          null, null,
          null, null,
          null, null,
          null,
          null, null
        )`,
      )
      .run(
        targetWorkSpecId,
        masterId,
        trimmedName,
        master.molio_spec_guid,
        master.molio_spec_revision_guid,
      );
    return { newBdbId: Number(info.lastInsertRowid) };
  });
  return tx();
}
