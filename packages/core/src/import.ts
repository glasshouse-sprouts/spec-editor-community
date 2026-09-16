/**
 * Import work areas / BDBs (with their control plans) from one
 * `.moliospec` file into another. Slice 6K.
 *
 * Scope decisions (from user on 2026-04-18):
 *   - Granularity: BDB + workArea cherry-pick. No whole-contract import;
 *     contracts are already modelled as UI groupings, not copyable.
 *   - Attachments: skipped for MVP. Attachments live in a table keyed
 *     by (work_spec_id, attachment_type_id) and can contain large
 *     blobs; we don't yet have a UI for reviewing them during import.
 *   - Collisions: resolved per-item by the caller. We accept a
 *     policy tag ("skip" / "rename" / "overwrite") on each plan item.
 *     "overwrite" is not implemented in this first pass — it requires
 *     cascade-delete semantics that merit their own design round. We
 *     throw a clear error so the UI can fall back to skip/rename.
 *   - Control plans travel with their owning BDB (including headers
 *     and rows). CPs shared between two source BDBs are imported once
 *     and re-linked from both copies in the target.
 *   - Landing spot:
 *       workArea → target `contracts.id` (or null for "[No contract]").
 *       bdb      → target `work_spec.id` (must already exist in target).
 *   - Identity GUIDs (`molio_spec_guid` + its revision on work areas,
 *     `molio_construction_element_spec_guid` + its revision on BDBs)
 *     are CLEARED on import — set to NULL on the target rows. This
 *     matches the rule `duplicateBdb` already enforces. The reason:
 *     these GUIDs identify a row to Molio's registry, and two local
 *     rows claiming the same registry id would later confuse a
 *     reconcile/sync flow (and the DB has no UNIQUE constraint to
 *     stop it). Reference GUIDs (paradigm GUIDs, referenceliste,
 *     section GUIDs) ARE preserved — they point at external content
 *     and keeping them lets the linked UI still work.
 *     Known consequence: if the user later wires Molio-API sync,
 *     imported content will appear as "new" to Molio rather than as
 *     the spec it came from. See icebox task #95 for the research
 *     follow-up.
 *   - Section `parent_id` is remapped to the new section ids (two-pass
 *     insert — same pattern as `duplicateBdb`).
 *   - Overwrite policy (work areas, Option A): the target's existing
 *     `work_spec` row is UPDATEd with the source's field values, the
 *     target's `work_spec_section`s are DELETEd and re-inserted from
 *     source. BDBs already hanging off the target work area are NOT
 *     touched; selected source BDBs get added as new rows alongside
 *     them. BDB-level overwrite is still unimplemented (throws).
 *
 * The import runs inside a single transaction on the TARGET handle. If
 * any step throws, the target is rolled back to its pre-import state.
 * The source handle is only read; we never write to it.
 */

import type { Statement } from "better-sqlite3";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";

type PreparedStatement = Statement<unknown[]>;

/**
 * How to resolve a name/code collision on import.
 *
 *   - `skip` — drop the colliding row entirely (and, for work areas,
 *     its BDBs too).
 *   - `rename` — import the source row under a new code/name, so the
 *     target ends up with both the original AND the source row.
 *   - `overwrite` — only meaningful for work areas. The existing
 *     target work area's metadata is UPDATEd to match the source's
 *     and its sections are wiped + replaced. BDBs already hanging
 *     off the target work area survive; source BDBs are added
 *     alongside them. NOT implemented for BDBs (throws).
 *   - `merge` *(2026-05-11)* — work-area only. The existing target
 *     work area is kept exactly as-is (metadata, sections,
 *     attachments untouched). Source BDBs are imported under the
 *     existing target work area; the source work area's own
 *     metadata / sections are silently dropped. The natural choice
 *     when a user is folding new BDBs into a work area they've
 *     already started annotating.
 */
export type CollisionPolicy = "skip" | "rename" | "overwrite" | "merge";

/** One work area to import. */
export interface WorkAreaImportPlan {
  /** `work_spec.id` in the source file. */
  sourceWorkSpecId: number;
  /**
   * Target contract for the imported work area. `null` → "[No contract]"
   * (i.e. `contract_id` in the target stays NULL).
   */
  targetContractId: number | null;
  /**
   * Which of the source work area's BDBs to bring. `undefined` = all;
   * `[]` = none. IDs that don't belong to `sourceWorkSpecId` are
   * ignored (defensive — the caller should filter).
   */
  includeBdbIds?: number[];
  /** What to do if the target already has this work area. */
  onCollision: CollisionPolicy;
  /** When `onCollision === "rename"`, use this code. `null` clears. */
  renamedCode?: string | null;
  /** When `onCollision === "rename"`, use this name. */
  renamedName?: string;
}

/** One standalone BDB to import (no parent work area selected). */
export interface BdbImportPlan {
  /** `construction_element_spec.id` in the source file. */
  sourceBdbId: number;
  /**
   * Target work area to place the imported BDB under. Must already
   * exist in the target file (the UI lets the user pick from the
   * target's tree).
   */
  targetWorkSpecId: number;
  /** What to do if the target work area already has a BDB with this name. */
  onCollision: CollisionPolicy;
  /** When `onCollision === "rename"`, use this name. */
  renamedName?: string;
}

export interface ImportPlan {
  /**
   * Work areas to import. They land under `targetContractId` in the
   * target. Their BDBs travel along (unless `includeBdbIds` trims them).
   */
  workAreas: WorkAreaImportPlan[];
  /**
   * Standalone BDBs to import. They land under `targetWorkSpecId`
   * (which must already exist in the target).
   */
  bdbs: BdbImportPlan[];
}

/** A colliding target work area that the user must resolve. */
export interface WorkAreaCollision {
  sourceWorkSpecId: number;
  targetWorkSpecId: number;
  /** What about the target row matched the source row. */
  matchedOn: "code" | "name" | "code+name";
  workAreaCode: string | null;
  workAreaName: string;
}

/** A colliding target BDB under the candidate landing work area. */
export interface BdbCollision {
  sourceBdbId: number;
  targetBdbId: number;
  targetWorkSpecId: number;
  name: string;
}

export interface ImportPrecheck {
  workAreaCollisions: WorkAreaCollision[];
  bdbCollisions: BdbCollision[];
}

export interface ImportResult {
  /** source work_spec.id → new target work_spec.id. Skipped items absent. */
  workAreaIdMap: Record<number, number>;
  /** source construction_element_spec.id → new target id. */
  bdbIdMap: Record<number, number>;
  /** source control_plan.id → new target id. Deduped across BDBs. */
  controlPlanIdMap: Record<number, number>;
  /** Totals for a user-visible summary (e.g. "Imported 3 work areas…"). */
  workAreasImported: number;
  bdbsImported: number;
  controlPlansImported: number;
  /** Source ids that were skipped due to "skip" collision policy. */
  skippedWorkAreas: number[];
  skippedBdbs: number[];
}

/**
 * Pure read on both handles. Returns the list of collisions the caller
 * must resolve before `importFromMoliospec` can run cleanly.
 *
 * Collision rules:
 *   - Work area: the target already has a work area with the same
 *     `work_area_code` (when both sides non-null) AND/OR the same
 *     `work_area_name`. We only report a collision when BOTH sides
 *     match under the plan's target contract — a work area of the
 *     same name in a different contract is fine (they're disjoint
 *     buckets from the user's perspective).
 *   - BDB: the candidate target work area already has a BDB with
 *     the same `name`.
 *
 * Skip-policy items DO still report collisions — the UI might want to
 * show them so the user understands what "skip" means. If you want to
 * suppress, filter the return value.
 */
export function getImportPrecheck(
  target: MoliospecHandle,
  source: MoliospecHandle,
  plan: ImportPlan,
): ImportPrecheck {
  const workAreaCollisions: WorkAreaCollision[] = [];
  const bdbCollisions: BdbCollision[] = [];

  const srcDb = source.db;
  const tgtDb = target.db;

  // --- Work area collisions -------------------------------------------------
  for (const ws of plan.workAreas) {
    const src = srcDb
      .prepare(
        "select work_area_code, work_area_name from work_spec where id = ? limit 1",
      )
      .get(ws.sourceWorkSpecId) as
      | { work_area_code: string | null; work_area_name: string }
      | undefined;
    if (!src) continue;

    // Effective proposed values after rename.
    const effectiveCode =
      ws.onCollision === "rename" && ws.renamedCode !== undefined
        ? ws.renamedCode
        : src.work_area_code;
    const effectiveName =
      ws.onCollision === "rename" && ws.renamedName
        ? ws.renamedName
        : src.work_area_name;

    // Find target rows in the same target contract bucket.
    const rows = tgtDb
      .prepare(
        ws.targetContractId === null
          ? "select id, work_area_code, work_area_name from work_spec where contract_id is null"
          : "select id, work_area_code, work_area_name from work_spec where contract_id = ?",
      )
      .all(...(ws.targetContractId === null ? [] : [ws.targetContractId])) as {
      id: number;
      work_area_code: string | null;
      work_area_name: string;
    }[];

    for (const r of rows) {
      const codeMatch =
        effectiveCode !== null &&
        r.work_area_code !== null &&
        effectiveCode === r.work_area_code;
      const nameMatch = effectiveName === r.work_area_name;
      if (codeMatch && nameMatch) {
        workAreaCollisions.push({
          sourceWorkSpecId: ws.sourceWorkSpecId,
          targetWorkSpecId: r.id,
          matchedOn: "code+name",
          workAreaCode: r.work_area_code,
          workAreaName: r.work_area_name,
        });
      } else if (codeMatch) {
        workAreaCollisions.push({
          sourceWorkSpecId: ws.sourceWorkSpecId,
          targetWorkSpecId: r.id,
          matchedOn: "code",
          workAreaCode: r.work_area_code,
          workAreaName: r.work_area_name,
        });
      } else if (nameMatch) {
        workAreaCollisions.push({
          sourceWorkSpecId: ws.sourceWorkSpecId,
          targetWorkSpecId: r.id,
          matchedOn: "name",
          workAreaCode: r.work_area_code,
          workAreaName: r.work_area_name,
        });
      }
    }
  }

  // --- BDB collisions -------------------------------------------------------
  for (const b of plan.bdbs) {
    const src = srcDb
      .prepare(
        "select name from construction_element_spec where id = ? limit 1",
      )
      .get(b.sourceBdbId) as { name: string } | undefined;
    if (!src) continue;

    const effectiveName =
      b.onCollision === "rename" && b.renamedName ? b.renamedName : src.name;

    const rows = tgtDb
      .prepare(
        "select id, name from construction_element_spec where work_spec_id = ?",
      )
      .all(b.targetWorkSpecId) as { id: number; name: string }[];

    for (const r of rows) {
      if (r.name === effectiveName) {
        bdbCollisions.push({
          sourceBdbId: b.sourceBdbId,
          targetBdbId: r.id,
          targetWorkSpecId: b.targetWorkSpecId,
          name: r.name,
        });
      }
    }
  }

  return { workAreaCollisions, bdbCollisions };
}

/**
 * Do the import. Runs inside a single transaction on the target handle.
 *
 * Throws (and rolls back) if:
 *   - any `targetContractId` doesn't exist in the target;
 *   - any `targetWorkSpecId` doesn't exist in the target;
 *   - any source id doesn't exist in the source;
 *   - a BDB-level "overwrite" policy is requested (not yet implemented).
 *
 * The caller should have called `getImportPrecheck` first and asked the
 * user how to resolve any collisions; by the time we run, every item's
 * `onCollision` + rename fields reflect the final decisions.
 */
export function importFromMoliospec(
  target: MoliospecHandle,
  source: MoliospecHandle,
  plan: ImportPlan,
): ImportResult {
  const srcDb = source.db;
  const tgtDb = target.db;

  const workAreaIdMap: Record<number, number> = {};
  const bdbIdMap: Record<number, number> = {};
  const controlPlanIdMap: Record<number, number> = {};
  const skippedWorkAreas: number[] = [];
  const skippedBdbs: number[] = [];

  // Early refusal — we haven't started the transaction yet so a throw
  // here costs nothing. BDB-level overwrite is not implemented yet;
  // work-area overwrite (Option A) is handled inside copyWorkArea below.
  for (const b of plan.bdbs) {
    if (b.onCollision === "overwrite") {
      throw new CoreError(
        "IMPORT_BDB_OVERWRITE_UNSUPPORTED",
        { sourceBdbId: b.sourceBdbId },
        "importFromMoliospec: BDB-level overwrite policy is not yet implemented " +
          `(bdb id=${b.sourceBdbId}). Use skip or rename.`,
      );
    }
  }

  // If the plan touches contracts and the target doesn't have a
  // `contracts` table yet (old schema), create it.
  const usesContracts = plan.workAreas.some((w) => w.targetContractId !== null);
  if (usesContracts) {
    tgtDb.exec(
      "create table if not exists contracts (" +
        "  id            integer primary key," +
        "  contract_code text," +
        "  contract_name text" +
        ")",
    );
  }

  // --- Source-side read statements (outside tx — read-only) -----------------
  const readWorkSpec = srcDb.prepare(
    "select * from work_spec where id = ? limit 1",
  );
  const readWorkSpecSections = srcDb.prepare(
    "select * from work_spec_section where work_spec_id = ? order by id",
  );
  const readBdb = srcDb.prepare(
    "select * from construction_element_spec where id = ? limit 1",
  );
  const readBdbsUnderWs = srcDb.prepare(
    "select id from construction_element_spec where work_spec_id = ? order by id",
  );
  const readBdbSections = srcDb.prepare(
    "select * from construction_element_spec_section where construction_element_spec_id = ? order by id",
  );
  const readControlPlan = srcDb.prepare(
    "select * from control_plan where id = ? limit 1",
  );
  const readCpHeaders = srcDb.prepare(
    "select * from control_plan_section_header where control_plan_id = ? order by id",
  );
  const readCpRows = srcDb.prepare(
    "select * from control_plan_section where control_plan_id = ? order by id",
  );

  // --- Target-side validation + insert statements ---------------------------
  const tgtContractExists = tgtDb.prepare(
    "select 1 from contracts where id = ? limit 1",
  );
  const tgtWorkSpecExists = tgtDb.prepare(
    "select 1 from work_spec where id = ? limit 1",
  );

  // Pre-check referential integrity on the target.
  for (const ws of plan.workAreas) {
    if (ws.targetContractId !== null) {
      const ok = tgtContractExists.get(ws.targetContractId);
      if (!ok) {
        throw new CoreError(
          "IMPORT_TARGET_CONTRACT_MISSING",
          { contractId: ws.targetContractId },
          `importFromMoliospec: target contract id=${ws.targetContractId} does not exist`,
        );
      }
    }
  }
  for (const b of plan.bdbs) {
    const ok = tgtWorkSpecExists.get(b.targetWorkSpecId);
    if (!ok) {
      throw new CoreError(
        "IMPORT_TARGET_WORK_AREA_MISSING",
        { workSpecId: b.targetWorkSpecId },
        `importFromMoliospec: target work area id=${b.targetWorkSpecId} does not exist`,
      );
    }
  }

  // Helper: read collisions once per item so "skip" items never write.
  // We re-run precheck inside the function rather than ask the caller to
  // pass it in — keeps the public API narrow.
  const precheck = getImportPrecheck(target, source, plan);
  const collidingWsIds = new Set(
    precheck.workAreaCollisions.map((c) => c.sourceWorkSpecId),
  );
  const collidingBdbIds = new Set(
    precheck.bdbCollisions.map((c) => c.sourceBdbId),
  );

  // Prepared inserts on the target.
  const insertWorkSpec: PreparedStatement = tgtDb.prepare(
    `insert into work_spec (
      work_area_code, work_area_name,
      created_by_organization, created_by, revision_date, revision,
      reviewed_by, approved_by,
      molio_spec_guid, molio_spec_revision_guid,
      molio_work_spec_paradigm_guid, molio_work_spec_paradigm_revision_guid,
      molio_referencelist_area, work_area_type,
      issue_date, molio_spec_revision_no, molio_spec_revision_date,
      molio_referencelist_area_date, contract_id
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertWorkSpecSection: PreparedStatement = tgtDb.prepare(
    "insert into work_spec_section (" +
      "work_spec_id, section_no, heading, body, molio_section_guid, parent_id" +
      ") values (?, ?, ?, ?, ?, null)",
  );
  const updateWorkSpecSectionParent: PreparedStatement = tgtDb.prepare(
    "update work_spec_section set parent_id = ? where id = ?",
  );
  const insertBdb: PreparedStatement = tgtDb.prepare(
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
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
  );
  const updateBdbCpLinks: PreparedStatement = tgtDb.prepare(
    "update construction_element_spec set " +
      "controlplan_design_id = ?, controlplan_production_id = ? where id = ?",
  );
  const insertBdbSection: PreparedStatement = tgtDb.prepare(
    "insert into construction_element_spec_section (" +
      "construction_element_spec_id, section_no, heading, body, " +
      "molio_section_guid, parent_id, pfbb_section_id" +
      ") values (?, ?, ?, ?, ?, null, ?)",
  );
  const updateBdbSectionParent: PreparedStatement = tgtDb.prepare(
    "update construction_element_spec_section set parent_id = ? where id = ?",
  );
  // PFBB cross-reference fix-ups (resolved in a post-pass — see below).
  const updateBdbPfbbId: PreparedStatement = tgtDb.prepare(
    "update construction_element_spec set pfbb_id = ? where id = ?",
  );
  const updateBdbSectionPfbb: PreparedStatement = tgtDb.prepare(
    "update construction_element_spec_section set pfbb_section_id = ? where id = ?",
  );
  const insertCp: PreparedStatement = tgtDb.prepare(
    "insert into control_plan (revision_date, revision, number_text, title, control_plan_type) " +
      "values (?, ?, ?, ?, ?)",
  );
  const insertCpHeader: PreparedStatement = tgtDb.prepare(
    "insert into control_plan_section_header (header, header_no, control_plan_id) " +
      "values (?, ?, ?)",
  );
  const insertCpRow: PreparedStatement = tgtDb.prepare(
    "insert into control_plan_section (" +
      "header_id, control_plan_id, control_type, section_no, subject, reference, " +
      "method, quantity, time, acceptance_criteria, documentation, " +
      "control_level, sample_level" +
      ") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  // Copy one control plan (header rows + section rows). Deduped via
  // controlPlanIdMap so shared CPs aren't copied twice.
  const copyControlPlan = (sourceCpId: number): number | null => {
    if (controlPlanIdMap[sourceCpId] !== undefined) {
      return controlPlanIdMap[sourceCpId];
    }
    const cp = readControlPlan.get(sourceCpId) as
      | {
          id: number;
          revision_date: string | null;
          revision: string | null;
          number_text: string;
          title: string;
          control_plan_type: number;
        }
      | undefined;
    if (!cp) return null;

    const info = insertCp.run(
      cp.revision_date,
      cp.revision,
      cp.number_text,
      cp.title,
      cp.control_plan_type,
    );
    const newCpId = Number(info.lastInsertRowid);
    controlPlanIdMap[sourceCpId] = newCpId;

    // Headers first so rows can point at the new header ids.
    const headerIdMap: Record<number, number> = {};
    const headers = readCpHeaders.all(sourceCpId) as {
      id: number;
      header: string;
      header_no: string;
      control_plan_id: number;
    }[];
    for (const h of headers) {
      const r = insertCpHeader.run(h.header, h.header_no, newCpId);
      headerIdMap[h.id] = Number(r.lastInsertRowid);
    }

    const rows = readCpRows.all(sourceCpId) as {
      id: number;
      header_id: number;
      control_plan_id: number;
      control_type: number;
      section_no: string;
      subject: string;
      reference: string;
      method: string;
      quantity: string;
      time: string;
      acceptance_criteria: string;
      documentation: string;
      control_level: string;
      sample_level: string;
    }[];
    for (const r of rows) {
      const newHeaderId = headerIdMap[r.header_id];
      // If a row references a header we didn't copy (shouldn't happen
      // because we copy every header in the CP), skip it rather than
      // fail the whole import.
      if (newHeaderId === undefined) continue;
      insertCpRow.run(
        newHeaderId,
        newCpId,
        r.control_type,
        r.section_no,
        r.subject,
        r.reference,
        r.method,
        r.quantity,
        r.time,
        r.acceptance_criteria,
        r.documentation,
        r.control_level,
        r.sample_level,
      );
    }

    return newCpId;
  };

  // --- PFBB link remapping -------------------------------------------------
  // `pfbb_id` and `pfbb_section_id` are row-ids from the SOURCE database:
  //   - pfbb_id          → the master BDB a subscriber points at.
  //   - pfbb_section_id  → the master's section a child supplement points at.
  // Copied verbatim, they'd be dead links in the target — or worse, collide
  // with an unrelated row that happens to share the id and silently show the
  // wrong master's content. We therefore insert these links as NULL during
  // the copy, collect what needs resolving, and remap them in a post-pass
  // once every BDB + section is copied and all id maps are complete. A link
  // whose master isn't part of this import stays NULL (a dead link beats a
  // wrong one).
  const bdbSectionIdMaps = new Map<number, Record<number, number>>();
  const pfbbBdbFixups: { newBdbId: number; sourcePfbbId: number }[] = [];
  const pfbbSectionFixups: {
    newSectionId: number;
    masterSourceBdbId: number;
    sourcePfbbSectionId: number;
  }[] = [];

  // Copy one BDB (row + sections + CPs). Returns the new BDB id or null
  // if skipped. `parentWorkSpecId` is the target work_spec.id to place
  // this BDB under.
  const copyBdb = (
    sourceBdbId: number,
    parentWorkSpecId: number,
    onCollision: CollisionPolicy,
    renamedName: string | undefined,
  ): number | null => {
    const bdb = readBdb.get(sourceBdbId) as Record<string, unknown> | undefined;
    if (!bdb) return null;

    // Per-BDB collision check: is there already a BDB with this name
    // under parentWorkSpecId? If so and policy is "skip", do nothing.
    const effectiveName =
      onCollision === "rename" && renamedName
        ? renamedName
        : (bdb["name"] as string);
    const existing = tgtDb
      .prepare(
        "select 1 from construction_element_spec where work_spec_id = ? and name = ? limit 1",
      )
      .get(parentWorkSpecId, effectiveName);
    if (existing && onCollision === "skip") {
      return null;
    }

    // pfbb_id is a source row-id; inserted NULL here and remapped in the
    // post-pass once bdbIdMap is complete.
    const sourcePfbbId = bdb["pfbb_id"] as number | null;
    const info = insertBdb.run(
      parentWorkSpecId,
      null,
      bdb["is_pfbb"] as number,
      effectiveName,
      bdb["created_by_organization"] as string | null,
      bdb["created_by"] as string | null,
      bdb["revision_date"] as string | null,
      bdb["revision"] as string | null,
      bdb["reviewed_by"] as string | null,
      bdb["approved_by"] as string | null,
      bdb["molio_spec_guid"] as string | null,
      bdb["molio_spec_revision_guid"] as string | null,
      // CP links filled in later, once we've copied the CPs.
      null,
      null,
      bdb["common_controlplan_design_guid"] as string | null,
      bdb["common_controlplan_production_guid"] as string | null,
      // Identity GUIDs cleared on import — see file-header note +
      // icebox task #95. Prevents two local BDBs claiming the same
      // Molio registry id.
      null,
      null,
      bdb["molio_referencelist_area"] as string | null,
      bdb["issue_date"] as string | null,
      bdb["molio_spec_revision_no"] as string | null,
      bdb["molio_spec_revision_date"] as string | null,
      bdb["molio_referencelist_area_date"] as string | null,
      bdb["molio_construction_element_spec_revision_no"] as string | null,
      bdb["molio_construction_element_spec_revision_date"] as string | null,
    );
    const newBdbId = Number(info.lastInsertRowid);
    bdbIdMap[sourceBdbId] = newBdbId;
    // Record the BDB-level PFBB link for the post-pass.
    if (sourcePfbbId != null) {
      pfbbBdbFixups.push({ newBdbId, sourcePfbbId });
    }

    // Sections — two-pass with parent_id remap.
    const sections = readBdbSections.all(sourceBdbId) as {
      id: number;
      section_no: number;
      heading: string;
      body: string | null;
      molio_section_guid: string | null;
      parent_id: number | null;
      pfbb_section_id: number | null;
    }[];
    const sectionIdMap: Record<number, number> = {};
    for (const s of sections) {
      // pfbb_section_id inserted NULL here; remapped in the post-pass via
      // the master BDB's own section map.
      const r = insertBdbSection.run(
        newBdbId,
        s.section_no,
        s.heading,
        s.body ?? "",
        s.molio_section_guid,
        null,
      );
      const newSectionId = Number(r.lastInsertRowid);
      sectionIdMap[s.id] = newSectionId;
      // A child supplement section points at a section in the master BDB
      // (the one referenced by this BDB's pfbb_id). Without a master we
      // can't resolve it, so only record when both ids are present.
      if (s.pfbb_section_id != null && sourcePfbbId != null) {
        pfbbSectionFixups.push({
          newSectionId,
          masterSourceBdbId: sourcePfbbId,
          sourcePfbbSectionId: s.pfbb_section_id,
        });
      }
    }
    for (const s of sections) {
      if (s.parent_id == null) continue;
      const mapped = sectionIdMap[s.parent_id];
      if (mapped == null) continue; // Dangling parent — preserve as null.
      updateBdbSectionParent.run(mapped, sectionIdMap[s.id]);
    }
    // Stash this BDB's source→new section map so subscribers in other
    // BDBs can resolve their pfbb_section_id against it later.
    bdbSectionIdMaps.set(sourceBdbId, sectionIdMap);

    // CPs — parse source link ids, copy CPs, re-link.
    const parseCpId = (raw: unknown): number | null => {
      if (raw == null || raw === "") return null;
      const n = Number.parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : null;
    };
    const srcDesignCp = parseCpId(bdb["controlplan_design_id"]);
    const srcProdCp = parseCpId(bdb["controlplan_production_id"]);
    let newDesignCp: number | null = null;
    let newProdCp: number | null = null;
    if (srcDesignCp !== null) newDesignCp = copyControlPlan(srcDesignCp);
    if (srcProdCp !== null) newProdCp = copyControlPlan(srcProdCp);
    if (newDesignCp !== null || newProdCp !== null) {
      updateBdbCpLinks.run(
        newDesignCp === null ? null : String(newDesignCp),
        newProdCp === null ? null : String(newProdCp),
        newBdbId,
      );
    }

    return newBdbId;
  };

  // Prepared statements for the overwrite branch (Option A).
  const updateWorkSpecRow: PreparedStatement = tgtDb.prepare(
    `update work_spec set
      work_area_code = ?, work_area_name = ?,
      created_by_organization = ?, created_by = ?,
      revision_date = ?, revision = ?,
      reviewed_by = ?, approved_by = ?,
      molio_spec_guid = ?, molio_spec_revision_guid = ?,
      molio_work_spec_paradigm_guid = ?, molio_work_spec_paradigm_revision_guid = ?,
      molio_referencelist_area = ?, work_area_type = ?,
      issue_date = ?, molio_spec_revision_no = ?, molio_spec_revision_date = ?,
      molio_referencelist_area_date = ?, contract_id = ?
    where id = ?`,
  );
  const deleteWorkSpecSections: PreparedStatement = tgtDb.prepare(
    "delete from work_spec_section where work_spec_id = ?",
  );

  // Insert source work_spec_section rows under a given target ws id,
  // handling the two-pass parent_id remap. Used by both the insert
  // (new row) and overwrite (existing row, sections wiped) paths.
  const copyWorkSpecSections = (
    sourceWorkSpecId: number,
    targetWorkSpecId: number,
  ): void => {
    const sections = readWorkSpecSections.all(sourceWorkSpecId) as {
      id: number;
      section_no: number;
      heading: string;
      body: string | null;
      molio_section_guid: string | null;
      parent_id: number | null;
    }[];
    const sectionIdMap: Record<number, number> = {};
    for (const s of sections) {
      const r = insertWorkSpecSection.run(
        targetWorkSpecId,
        s.section_no,
        s.heading,
        s.body ?? "",
        s.molio_section_guid,
      );
      sectionIdMap[s.id] = Number(r.lastInsertRowid);
    }
    for (const s of sections) {
      if (s.parent_id == null) continue;
      const mapped = sectionIdMap[s.parent_id];
      if (mapped == null) continue;
      updateWorkSpecSectionParent.run(mapped, sectionIdMap[s.id]);
    }
  };

  // Look up the colliding target work_spec id for a given source id.
  // Returns the first match from precheck (there is typically at most
  // one, since precheck reports per source ws). Returns null if none.
  const findCollidingTargetWsId = (sourceWsId: number): number | null => {
    const c = precheck.workAreaCollisions.find(
      (x) => x.sourceWorkSpecId === sourceWsId,
    );
    return c ? c.targetWorkSpecId : null;
  };

  // Copy one work area (row + sections + BDBs). Returns the new/reused
  // target ws id or null if skipped.
  const copyWorkArea = (ws: WorkAreaImportPlan): number | null => {
    const collides = collidingWsIds.has(ws.sourceWorkSpecId);

    // "skip" on collision → do nothing, record skipped.
    if (ws.onCollision === "skip" && collides) {
      skippedWorkAreas.push(ws.sourceWorkSpecId);
      return null;
    }
    const row = readWorkSpec.get(ws.sourceWorkSpecId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    const effectiveCode =
      ws.onCollision === "rename" && ws.renamedCode !== undefined
        ? ws.renamedCode
        : (row["work_area_code"] as string | null);
    const effectiveName =
      ws.onCollision === "rename" && ws.renamedName
        ? ws.renamedName
        : (row["work_area_name"] as string);

    let targetWsId: number;

    if (ws.onCollision === "merge" && collides) {
      // 2026-05-11: "merge" policy — reuse the existing target work
      // area as the landing spot for the source's BDBs. Don't touch
      // the target work area's metadata, sections, attachments, or
      // existing BDBs. The source's work-area-level data is dropped
      // (it "loses" — target wins). The BDBs themselves are still
      // copied below in the shared post-block. The natural choice
      // when the user is re-importing a newer spec into a project
      // they've already started annotating.
      const existingId = findCollidingTargetWsId(ws.sourceWorkSpecId);
      if (existingId === null) {
        throw new CoreError(
          "INTERNAL",
          { sourceWorkSpecId: ws.sourceWorkSpecId },
          `importFromMoliospec: merge requested but collision row not ` +
            `found for source ws id=${ws.sourceWorkSpecId}`,
        );
      }
      targetWsId = existingId;
    } else if (ws.onCollision === "overwrite" && collides) {
      // Option A overwrite: reuse the existing target work_spec row,
      // UPDATE its fields from source, DELETE its sections, INSERT
      // source's sections. Existing BDBs under this work area stay.
      const existingId = findCollidingTargetWsId(ws.sourceWorkSpecId);
      if (existingId === null) {
        // Shouldn't happen — collides was true. Fail loud.
        throw new CoreError(
          "INTERNAL",
          { sourceWorkSpecId: ws.sourceWorkSpecId },
          `importFromMoliospec: overwrite requested but collision row not ` +
            `found for source ws id=${ws.sourceWorkSpecId}`,
        );
      }
      updateWorkSpecRow.run(
        effectiveCode,
        effectiveName,
        row["created_by_organization"] as string | null,
        row["created_by"] as string | null,
        row["revision_date"] as string | null,
        row["revision"] as string | null,
        row["reviewed_by"] as string | null,
        row["approved_by"] as string | null,
        // Identity GUIDs cleared on import — see file-header note.
        null,
        null,
        row["molio_work_spec_paradigm_guid"] as string | null,
        row["molio_work_spec_paradigm_revision_guid"] as string | null,
        row["molio_referencelist_area"] as string | null,
        row["work_area_type"] as number,
        row["issue_date"] as string | null,
        row["molio_spec_revision_no"] as string | null,
        row["molio_spec_revision_date"] as string | null,
        row["molio_referencelist_area_date"] as string | null,
        ws.targetContractId,
        existingId,
      );
      deleteWorkSpecSections.run(existingId);
      copyWorkSpecSections(ws.sourceWorkSpecId, existingId);
      targetWsId = existingId;
    } else {
      // Insert new row. Covers: no collision (any policy), or rename
      // policy with a collision.
      const info = insertWorkSpec.run(
        effectiveCode,
        effectiveName,
        row["created_by_organization"] as string | null,
        row["created_by"] as string | null,
        row["revision_date"] as string | null,
        row["revision"] as string | null,
        row["reviewed_by"] as string | null,
        row["approved_by"] as string | null,
        // Identity GUIDs cleared on import — see file-header note +
        // icebox task #95.
        null,
        null,
        row["molio_work_spec_paradigm_guid"] as string | null,
        row["molio_work_spec_paradigm_revision_guid"] as string | null,
        row["molio_referencelist_area"] as string | null,
        row["work_area_type"] as number,
        row["issue_date"] as string | null,
        row["molio_spec_revision_no"] as string | null,
        row["molio_spec_revision_date"] as string | null,
        row["molio_referencelist_area_date"] as string | null,
        ws.targetContractId,
      );
      targetWsId = Number(info.lastInsertRowid);
      copyWorkSpecSections(ws.sourceWorkSpecId, targetWsId);
    }

    workAreaIdMap[ws.sourceWorkSpecId] = targetWsId;

    // BDBs — filter by includeBdbIds if provided.
    const allBdbs = (
      readBdbsUnderWs.all(ws.sourceWorkSpecId) as { id: number }[]
    ).map((r) => r.id);
    const bdbIdsToCopy =
      ws.includeBdbIds === undefined
        ? allBdbs
        : allBdbs.filter((id) => ws.includeBdbIds!.includes(id));
    for (const bId of bdbIdsToCopy) {
      // BDBs under an imported work area inherit a "skip" collision
      // policy for naming (they're a package deal). This matters for
      // the overwrite branch: if a BDB with the same name already
      // exists under the reused target ws, we leave the existing one
      // alone rather than duplicate.
      copyBdb(bId, targetWsId, "skip", undefined);
    }

    return targetWsId;
  };

  // --- Transaction: everything happens atomically on the target. -----------
  const run = tgtDb.transaction((): void => {
    for (const ws of plan.workAreas) {
      copyWorkArea(ws);
    }
    for (const b of plan.bdbs) {
      if (b.onCollision === "skip" && collidingBdbIds.has(b.sourceBdbId)) {
        skippedBdbs.push(b.sourceBdbId);
        continue;
      }
      copyBdb(b.sourceBdbId, b.targetWorkSpecId, b.onCollision, b.renamedName);
    }

    // --- PFBB post-pass: every BDB + section is now copied, so the id
    // maps are complete and cross-references can be resolved safely.
    // pfbb_id: subscriber → master BDB. NULL if the master wasn't imported.
    for (const f of pfbbBdbFixups) {
      const newMasterBdbId = bdbIdMap[f.sourcePfbbId];
      updateBdbPfbbId.run(newMasterBdbId ?? null, f.newBdbId);
    }
    // pfbb_section_id: child supplement → master section, resolved via the
    // master BDB's own section map. NULL if the master (or its section)
    // wasn't imported.
    for (const f of pfbbSectionFixups) {
      const masterSectionMap = bdbSectionIdMaps.get(f.masterSourceBdbId);
      const newMasterSectionId = masterSectionMap?.[f.sourcePfbbSectionId];
      updateBdbSectionPfbb.run(newMasterSectionId ?? null, f.newSectionId);
    }
  });
  run();

  return {
    workAreaIdMap,
    bdbIdMap,
    controlPlanIdMap,
    workAreasImported: Object.keys(workAreaIdMap).length,
    bdbsImported: Object.keys(bdbIdMap).length,
    controlPlansImported: Object.keys(controlPlanIdMap).length,
    skippedWorkAreas,
    skippedBdbs,
  };
}

/* ------------------------------------------------------------------ */
/*  SPLIT-Merge (#248) — fill an EMPTY target work area's sections    */
/*  from a source work area. Surgical alternative to the full         */
/*  importFromMoliospec for the "fill a standard paradigm into an     */
/*  empty shell" use case.                                            */
/* ------------------------------------------------------------------ */

/**
 * Outcome of `fillEmptyWorkSpec`.
 *
 *  - `sectionsCopied` — total number of rows inserted into target's
 *    `work_spec_section` table.
 */
export interface FillEmptyWorkSpecResult {
  sectionsCopied: number;
}

/**
 * Copy ONLY `work_spec_section` rows from `sourceWorkSpecId` (in
 * `source`) into `targetWorkSpecId` (in `target`). Refuses if the
 * target work area already has any sections — this is "fill the
 * empty shell", not a merge or replace.
 *
 * What gets copied (1:1):
 *   - Every row in `work_spec_section` belonging to the source
 *     work area, with their `section_no`, `heading`, `body`,
 *     `molio_section_guid`, and parent/child hierarchy preserved
 *     (two-pass `parent_id` remap, same pattern `duplicate_bdb`
 *     and `importFromMoliospec` use).
 *
 * What does NOT travel:
 *   - The source work area's own `work_spec` row metadata (name,
 *     code, locked Molio GUIDs, dates, contract id). The target
 *     keeps every one of its own fields untouched.
 *   - The source work area's BDBs, control plans, or attachments.
 *     If you want those, use `importFromMoliospec` instead.
 *
 * The entire copy runs inside a single transaction on the TARGET
 * handle. If any step throws, the target is rolled back to its
 * pre-fill state. The source handle is read-only.
 *
 * Throws CoreError with one of:
 *   - `WORKSPEC_NOT_FOUND` — target or source work area missing.
 *   - `FILL_TARGET_NOT_EMPTY` — target already has sections.
 *   - `FILL_SOURCE_EMPTY` — source has no sections; nothing to do.
 */
export function fillEmptyWorkSpec(
  target: MoliospecHandle,
  source: MoliospecHandle,
  targetWorkSpecId: number,
  sourceWorkSpecId: number,
): FillEmptyWorkSpecResult {
  const tgtDb = target.db;
  const srcDb = source.db;

  // 1. Target work area must exist.
  const targetWsRow = tgtDb
    .prepare("select id from work_spec where id = ? limit 1")
    .get(targetWorkSpecId);
  if (!targetWsRow) {
    throw new CoreError(
      "WORKSPEC_NOT_FOUND",
      { side: "target", workSpecId: targetWorkSpecId },
      `fillEmptyWorkSpec: target work_spec id=${targetWorkSpecId} not found.`,
    );
  }

  // 2. Target work area must be empty (0 sections). Refuse loudly
  //    otherwise — this surgical helper is only for the empty-shell
  //    case. Mixing into an already-populated work area is the
  //    `importFromMoliospec` flow's job.
  const existingCount = (
    tgtDb
      .prepare(
        "select count(*) as n from work_spec_section where work_spec_id = ?",
      )
      .get(targetWorkSpecId) as { n: number }
  ).n;
  if (existingCount > 0) {
    throw new CoreError(
      "FILL_TARGET_NOT_EMPTY",
      { workSpecId: targetWorkSpecId, existingSectionCount: existingCount },
      `fillEmptyWorkSpec: target work_spec id=${targetWorkSpecId} already has ${existingCount} sections; refusing to fill.`,
    );
  }

  // 3. Source work area must exist.
  const sourceWsRow = srcDb
    .prepare("select id from work_spec where id = ? limit 1")
    .get(sourceWorkSpecId);
  if (!sourceWsRow) {
    throw new CoreError(
      "WORKSPEC_NOT_FOUND",
      { side: "source", workSpecId: sourceWorkSpecId },
      `fillEmptyWorkSpec: source work_spec id=${sourceWorkSpecId} not found.`,
    );
  }

  // 4. Read the source's sections.
  const sections = srcDb
    .prepare(
      "select id, section_no, heading, body, molio_section_guid, parent_id " +
        "from work_spec_section where work_spec_id = ? order by id",
    )
    .all(sourceWorkSpecId) as Array<{
    id: number;
    section_no: number;
    heading: string;
    body: string | null;
    molio_section_guid: string | null;
    parent_id: number | null;
  }>;
  if (sections.length === 0) {
    throw new CoreError(
      "FILL_SOURCE_EMPTY",
      { workSpecId: sourceWorkSpecId },
      `fillEmptyWorkSpec: source work_spec id=${sourceWorkSpecId} has no sections to copy.`,
    );
  }

  // 5. Two-pass insert with parent_id remap, all inside a single
  //    transaction so partial failures roll back cleanly.
  const insertSection = tgtDb.prepare(
    "insert into work_spec_section (" +
      "work_spec_id, section_no, heading, body, molio_section_guid, parent_id" +
      ") values (?, ?, ?, ?, ?, null)",
  );
  const updateParent = tgtDb.prepare(
    "update work_spec_section set parent_id = ? where id = ?",
  );

  const tx = tgtDb.transaction(() => {
    const idMap: Record<number, number> = {};
    for (const s of sections) {
      const r = insertSection.run(
        targetWorkSpecId,
        s.section_no,
        s.heading,
        s.body ?? "",
        s.molio_section_guid,
      );
      idMap[s.id] = Number(r.lastInsertRowid);
    }
    for (const s of sections) {
      if (s.parent_id == null) continue;
      const mappedParent = idMap[s.parent_id];
      if (mappedParent == null) continue; // orphan parent in source — leave null
      const mappedChild = idMap[s.id];
      if (mappedChild == null) continue;
      updateParent.run(mappedParent, mappedChild);
    }
  });
  tx();

  return { sectionsCopied: sections.length };
}
