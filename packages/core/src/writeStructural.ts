/**
 * Structural write operations: create work area, delete work area,
 * delete BDB, plus the shared `getDeleteImpact` precheck helper.
 *
 * `createWorkSpec` makes a brand-new, empty work area from scratch
 * (name only; type defaults to Arbejdsbeskrivelse). It is the
 * "build your own structure" counterpart to the import flow, which
 * is the only other way a work area enters a file today. New work
 * areas carry no Molio-registry identity — every `molio_*` GUID is
 * left NULL, marking the content as the author's own rather than
 * something pulled from Molio. Exposed to AI clients via the MCP
 * `create_work_area` tool; not (yet) wired to any editor UI.
 *
 * `getDeleteImpact` is read-only — the renderer calls it to populate
 * the cascade-impact summary in the confirm dialog ("This delete
 * will remove 3 BDBs, 12 sections, and 2 attachments").
 *
 * The actual deletes (`deleteWorkArea`, `deleteBdb`) cascade through
 * sections, control plans (unlinked, not deleted), and attachments
 * (orphaned to `work_spec_id = null` if deleting a work area;
 * preserved as-is when deleting a BDB).
 *
 * Extracted from `write.ts` in slice #233-followup.
 */

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";
import { WorkAreaType } from "./types.js";
import { duplicateBdb } from "./writeBdb.js";

/* ------------------------------------------------------------------ */
/*  Create work area (Skive 1 — custom structures)                     */
/* ------------------------------------------------------------------ */

export interface CreateWorkSpecArgs {
  /**
   * Display name (`work_area_name`). Required. Trimmed before insert;
   * an empty / whitespace-only name is rejected.
   */
  workAreaName: string;
  /**
   * Work area type. Optional — defaults to `Arbejdsbeskrivelse` (0).
   * Per the decision log, name is the only required field; type and
   * code are conveniences for callers that already know them.
   */
  workAreaType?: WorkAreaType;
  /** Optional display code (`work_area_code`), e.g. "S215". */
  workAreaCode?: string | null;
}

export interface CreateWorkSpecResult {
  /** The new work area's id. */
  workSpecId: number;
}

/**
 * Create a new, empty work area (`work_spec` row) from scratch.
 *
 * Only the two NOT NULL columns are set explicitly — `work_area_name`
 * and `work_area_type`. `work_area_code` is set when supplied. Every
 * other column (all the `molio_*` identity GUIDs, `contract_id`,
 * revision fields, …) is left to its schema default of NULL. That is
 * deliberate: a from-scratch work area has no Molio-registry identity
 * and no contract link. Use the separate contract-assignment path if
 * the work area later needs to belong to a contract.
 *
 * The insert runs inside a transaction for consistency with the other
 * write helpers, even though it is a single statement.
 */
export function createWorkSpec(
  handle: MoliospecHandle,
  args: CreateWorkSpecArgs,
): CreateWorkSpecResult {
  const db = handle.db;

  const name = (args.workAreaName ?? "").trim();
  if (name.length === 0) {
    throw new CoreError(
      "WORKSPEC_NAME_EMPTY",
      {},
      "createWorkSpec: work_area_name is empty",
    );
  }

  const type = args.workAreaType ?? WorkAreaType.Arbejdsbeskrivelse;
  if (
    type !== WorkAreaType.Arbejdsbeskrivelse &&
    type !== WorkAreaType.FaellesBeskrivelse &&
    type !== WorkAreaType.ParadigmeForArbejdsbeskrivelse
  ) {
    throw new CoreError(
      "WORKSPEC_INVALID_TYPE",
      { type },
      `createWorkSpec: invalid work_area_type=${String(type)}; must be 0, 1 or 2`,
    );
  }

  const code = args.workAreaCode ?? null;

  const tx = db.transaction((): number => {
    const info = db
      .prepare(
        "insert into work_spec (work_area_name, work_area_type, work_area_code) " +
          "values (?, ?, ?)",
      )
      .run(name, type, code);
    return Number(info.lastInsertRowid);
  });

  return { workSpecId: tx() };
}

/* ------------------------------------------------------------------ */
/*  Duplicate work area (AI duplicate-work-area tool, 2026-06-30)      */
/* ------------------------------------------------------------------ */

export interface DuplicateWorkAreaArgs {
  /** The work area (`work_spec.id`) to copy. */
  workSpecId: number;
  /**
   * Optional name for the copy. When omitted, `<original> (copy)`.
   */
  newName?: string;
  /**
   * Contract (`contracts.id`) to put the copy in, or `null` for none.
   * Defaults to `null` (homeless) — a duplicate does NOT inherit the
   * source's contract unless the caller asks for one explicitly.
   */
  contractId?: number | null;
  /**
   * When true, also clone every BDB hanging off the source work area
   * into the copy, each WITH its control plans (mirrors duplicateBdb's
   * include-control-plans default). When false / omitted, the copy has
   * its own sections but no BDBs.
   */
  includeBdbs?: boolean;
}

export interface DuplicateWorkAreaResult {
  /** The new work area's id. */
  workSpecId: number;
  /** old-section-id → new-section-id map for work_spec_section rows. */
  sectionIdMap: Record<number, number>;
  /** Ids of the BDBs cloned into the copy (empty when includeBdbs off). */
  newBdbIds: number[];
  /** Ids of control plans created while cloning those BDBs. */
  newControlPlanIds: number[];
}

/**
 * Duplicate a work area (`work_spec`) together with its own sections
 * and attachments, and — when asked — its BDBs (each with control
 * plans).
 *
 * Field policy, mirroring duplicateBdb + the import flow:
 *   - Identity GUIDs (`molio_spec_guid` + revision, and the paradigm
 *     GUIDs) are CLEARED to NULL on the copy — it is a new local work
 *     area, not the Molio-registry row it came from.
 *   - `contract_id` is set from `args.contractId` (default null), NOT
 *     copied from the source.
 *   - Sections: every `work_spec_section` row is copied with new ids;
 *     `parent_id` is remapped in a second pass (same two-pass shape as
 *     duplicateBdb).
 *   - Attachments: copied, but `sha1_hash` is set to NULL on each copy.
 *     The column has a UNIQUE constraint, and the copy's content is
 *     byte-identical to the original, so reusing the hash would throw.
 *   - BDBs (optional): each source BDB is cloned via duplicateBdb
 *     (which copies sections + control plans and clears BDB GUIDs),
 *     then repointed onto the new work area. PFBB subscriber links
 *     (`pfbb_id`) are preserved by duplicateBdb, so a copied subscriber
 *     keeps subscribing to the same master.
 *
 * Everything runs inside one transaction, so the file is either fully
 * duplicated or untouched.
 */
export function duplicateWorkArea(
  handle: MoliospecHandle,
  args: DuplicateWorkAreaArgs,
): DuplicateWorkAreaResult {
  const db = handle.db;
  const { workSpecId } = args;

  const src = db
    .prepare("select * from work_spec where id = ? limit 1")
    .get(workSpecId) as Record<string, unknown> | undefined;
  if (!src) {
    throw new CoreError(
      "INTERNAL",
      { workSpecId },
      `duplicateWorkArea: no such work area id=${workSpecId}`,
    );
  }

  const contractId = args.contractId ?? null;
  if (contractId !== null) {
    const hasContractsTable = db
      .prepare(
        "select 1 from sqlite_master where type='table' and name='contracts' limit 1",
      )
      .get();
    const contractExists = hasContractsTable
      ? db
          .prepare("select 1 from contracts where id = ? limit 1")
          .get(contractId)
      : undefined;
    if (!contractExists) {
      throw new CoreError(
        "INTERNAL",
        { contractId },
        `duplicateWorkArea: no such contract id=${contractId}`,
      );
    }
  }

  const originalName = (src["work_area_name"] as string) ?? "Untitled";
  const newName = args.newName ?? `${originalName} (copy)`;
  const includeBdbs = args.includeBdbs ?? false;

  const tx = db.transaction((): DuplicateWorkAreaResult => {
    // 1. The work_spec row. Identity GUIDs cleared, contract from args.
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
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        src["work_area_code"],
        newName,
        src["created_by_organization"],
        src["created_by"],
        src["revision_date"],
        src["revision"],
        src["reviewed_by"],
        src["approved_by"],
        null, // molio_spec_guid
        null, // molio_spec_revision_guid
        null, // molio_work_spec_paradigm_guid
        null, // molio_work_spec_paradigm_revision_guid
        src["molio_referencelist_area"],
        src["work_area_type"],
        src["issue_date"],
        src["molio_spec_revision_no"],
        src["molio_spec_revision_date"],
        src["molio_referencelist_area_date"],
        contractId,
      );
    const newWsId = Number(info.lastInsertRowid);

    // 2. work_spec_section rows — two-pass for the self-referential
    //    parent_id (insert flat, then rewrite parents via an id map).
    const srcSections = db
      .prepare("select * from work_spec_section where work_spec_id = ? order by id")
      .all(workSpecId) as Record<string, unknown>[];
    const insertSection = db.prepare(
      "insert into work_spec_section (" +
        "work_spec_id, section_no, heading, body, molio_section_guid, parent_id" +
        ") values (?, ?, ?, ?, ?, null)",
    );
    const updateSectionParent = db.prepare(
      "update work_spec_section set parent_id = ? where id = ?",
    );
    const sectionIdMap: Record<number, number> = {};
    for (const s of srcSections) {
      const r = insertSection.run(
        newWsId,
        s["section_no"],
        s["heading"],
        s["body"],
        s["molio_section_guid"],
      );
      sectionIdMap[s["id"] as number] = Number(r.lastInsertRowid);
    }
    for (const s of srcSections) {
      const oldParent = s["parent_id"] as number | null;
      if (oldParent != null) {
        const newParent = sectionIdMap[oldParent];
        const newId = sectionIdMap[s["id"] as number];
        if (newParent != null && newId != null) {
          updateSectionParent.run(newParent, newId);
        }
      }
    }

    // 3. Attachments — copy, but NULL the sha1_hash (UNIQUE column;
    //    identical content would otherwise collide).
    const srcAttachments = db
      .prepare(
        "select mime_type, content, name, attachment_type_id " +
          "from attachment where work_spec_id = ?",
      )
      .all(workSpecId) as Record<string, unknown>[];
    const insertAttachment = db.prepare(
      "insert into attachment (" +
        "mime_type, content, name, sha1_hash, work_spec_id, attachment_type_id" +
        ") values (?, ?, ?, null, ?, ?)",
    );
    for (const a of srcAttachments) {
      insertAttachment.run(
        a["mime_type"],
        a["content"],
        a["name"],
        newWsId,
        a["attachment_type_id"],
      );
    }

    // 4. Optionally clone BDBs into the new work area, control plans
    //    included. duplicateBdb clones into the SOURCE area, so we
    //    repoint each clone onto the new work area afterwards.
    const newBdbIds: number[] = [];
    const newControlPlanIds: number[] = [];
    if (includeBdbs) {
      const srcBdbs = db
        .prepare(
          "select id, name from construction_element_spec where work_spec_id = ? order by id",
        )
        .all(workSpecId) as { id: number; name: string }[];
      const repoint = db.prepare(
        "update construction_element_spec set work_spec_id = ? where id = ?",
      );
      for (const b of srcBdbs) {
        // Keep the BDB's own name (the work area is the "copy", not
        // each BDB), so pass newName explicitly to skip the default
        // "(copy)" suffix.
        const dup = duplicateBdb(handle, {
          bdbId: b.id,
          newName: b.name,
          includeControlPlans: true,
        });
        repoint.run(newWsId, dup.newBdbId);
        newBdbIds.push(dup.newBdbId);
        newControlPlanIds.push(...dup.newControlPlanIds);
      }
    }

    return { workSpecId: newWsId, sectionIdMap, newBdbIds, newControlPlanIds };
  });

  return tx();
}

/* ------------------------------------------------------------------ */
/*  Delete work area / BDB (Slice 6J)                                  */
/* ------------------------------------------------------------------ */

/**
 * Summary returned by the delete functions so the UI can show the
 * user what actually happened. Counts are post-delete facts, not
 * pre-flight estimates — compute pre-flight impact with
 * `getDeleteImpact` instead.
 */
export interface DeleteSummary {
  /** BDBs deleted. Always 0 for `deleteBdb(...)` returns (it only
   * deletes the one target — the count 1 is implicit and not worth
   * reporting back). Non-zero only on `deleteWorkArea`. */
  bdbs: number;
  /** Section rows deleted — includes work-area sections AND BDB
   * sections when cascading from a work area. */
  sections: number;
  /** Attachments whose `work_spec_id` was NULL'd. Per design: we
   * leave attachments in the file and just orphan them, so this is
   * a "decoupled" count, not a "deleted" count. */
  attachmentsOrphaned: number;
  /** Control plans that became unlinked because the BDB pointing at
   * them was deleted. CPs themselves are NOT deleted in this case —
   * the user can still see and clean them up via the unlinked-plans
   * bucket. */
  controlPlansUnlinked: number;
  /** Control plans that were hard-deleted (with their headers + rows)
   * because `deleteBdb` was called with `deleteControlPlans: true`.
   * Mutually exclusive with `controlPlansUnlinked` for any given
   * delete call. Always 0 from `deleteWorkArea` (which doesn't yet
   * support the flag). */
  controlPlansDeleted: number;
}

/**
 * Shape returned by `getDeleteImpact` — purely informational, no
 * mutations happen. The UI uses this to render the confirm dialog
 * ("This work area contains 3 BDBs, 12 sections, 2 attachments…").
 *
 * `target` mirrors the function that would be called to perform the
 * actual delete, so the UI can reuse the same argument.
 */
export interface DeleteImpact {
  /** BDBs that would be cascade-deleted. 0 for BDB-target impact. */
  bdbs: number;
  /** Sections that would be cascade-deleted (work-area + all BDBs). */
  sections: number;
  /** Attachments that would be orphaned (work_spec_id → NULL). */
  attachmentsOrphaned: number;
  /** Control plans that would become unlinked (BDB slot links go
   * away but the CPs themselves survive). */
  controlPlansUnlinked: number;
  /** True if the target is "empty" — no cascading side effects.
   * The UI can use this to show a softer confirm copy. */
  isEmpty: boolean;
}

/**
 * Pre-flight: report what would happen if we deleted this work area
 * or BDB. Read-only — no writes, no transaction. Safe to call often
 * (the confirm modal uses it to show counts before the user clicks
 * Delete).
 */
export function getDeleteImpact(
  handle: MoliospecHandle,
  target: { kind: "workArea"; id: number } | { kind: "bdb"; id: number },
): DeleteImpact {
  const db = handle.db;

  if (target.kind === "workArea") {
    const wsId = target.id;
    const exists = db
      .prepare("select 1 from work_spec where id = ? limit 1")
      .get(wsId);
    if (!exists) {
      throw new CoreError(
        "INTERNAL",
        { workSpecId: wsId },
        `getDeleteImpact: no such work area id=${wsId}`,
      );
    }
    const wsSections = (
      db
        .prepare(
          "select count(*) as n from work_spec_section where work_spec_id = ?",
        )
        .get(wsId) as { n: number }
    ).n;
    const bdbRows = db
      .prepare(
        "select id, controlplan_design_id, controlplan_production_id " +
          "from construction_element_spec where work_spec_id = ?",
      )
      .all(wsId) as {
      id: number;
      controlplan_design_id: string | null;
      controlplan_production_id: string | null;
    }[];
    let bdbSections = 0;
    let cpsUnlinked = 0;
    for (const b of bdbRows) {
      const n = (
        db
          .prepare(
            "select count(*) as n from construction_element_spec_section where construction_element_spec_id = ?",
          )
          .get(b.id) as { n: number }
      ).n;
      bdbSections += n;
      if (b.controlplan_design_id != null && b.controlplan_design_id !== "") {
        cpsUnlinked += 1;
      }
      if (
        b.controlplan_production_id != null &&
        b.controlplan_production_id !== ""
      ) {
        cpsUnlinked += 1;
      }
    }
    const attachments = (
      db
        .prepare("select count(*) as n from attachment where work_spec_id = ?")
        .get(wsId) as { n: number }
    ).n;
    return {
      bdbs: bdbRows.length,
      sections: wsSections + bdbSections,
      attachmentsOrphaned: attachments,
      controlPlansUnlinked: cpsUnlinked,
      isEmpty: bdbRows.length === 0 && wsSections === 0 && attachments === 0,
    };
  }

  // target.kind === "bdb"
  const bdbId = target.id;
  const row = db
    .prepare(
      "select controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(bdbId) as
    | {
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      }
    | undefined;
  if (!row) {
    throw new CoreError(
      "INTERNAL",
      { bdbId },
      `getDeleteImpact: no such BDB id=${bdbId}`,
    );
  }
  const sections = (
    db
      .prepare(
        "select count(*) as n from construction_element_spec_section where construction_element_spec_id = ?",
      )
      .get(bdbId) as { n: number }
  ).n;
  let cpsUnlinked = 0;
  if (row.controlplan_design_id != null && row.controlplan_design_id !== "") {
    cpsUnlinked += 1;
  }
  if (
    row.controlplan_production_id != null &&
    row.controlplan_production_id !== ""
  ) {
    cpsUnlinked += 1;
  }
  return {
    bdbs: 0,
    sections,
    attachmentsOrphaned: 0,
    controlPlansUnlinked: cpsUnlinked,
    isEmpty: sections === 0 && cpsUnlinked === 0,
  };
}

export interface DeleteWorkAreaArgs {
  /** `work_spec.id` to delete. */
  id: number;
}

/**
 * Delete a work area and everything that's exclusively its own,
 * atomically. Per the Slice 6J design decisions:
 *
 *   - Work-area sections: cascade-deleted.
 *   - BDBs under this work area: cascade-deleted (rows + their
 *     construction_element_spec_section rows).
 *   - Control plans linked from those BDBs: kept. The BDB row is
 *     what holds the link, so deleting the BDB naturally leaves the
 *     CP as an "unlinked plan". The user sees and manages these
 *     through the sidebar's unlinked-plans bucket.
 *   - Attachments with `work_spec_id = id`: their `work_spec_id`
 *     is NULL'd (orphaned, not deleted). The file keeps the binary
 *     data; a future attachment manager can let the user reassign
 *     or delete them explicitly.
 *
 * Throws if the work_spec doesn't exist.
 */
export function deleteWorkArea(
  handle: MoliospecHandle,
  args: DeleteWorkAreaArgs,
): DeleteSummary {
  const { id } = args;
  const db = handle.db;

  const exists = db
    .prepare("select 1 from work_spec where id = ? limit 1")
    .get(id);
  if (!exists) {
    throw new CoreError(
      "INTERNAL",
      { workSpecId: id },
      `deleteWorkArea: no such work area id=${id}`,
    );
  }

  const tx = db.transaction(() => {
    const bdbRows = db
      .prepare(
        "select id, controlplan_design_id, controlplan_production_id " +
          "from construction_element_spec where work_spec_id = ?",
      )
      .all(id) as {
      id: number;
      controlplan_design_id: string | null;
      controlplan_production_id: string | null;
    }[];

    let sectionsDeleted = 0;
    let cpsUnlinked = 0;
    for (const b of bdbRows) {
      const r = db
        .prepare(
          "delete from construction_element_spec_section where construction_element_spec_id = ?",
        )
        .run(b.id);
      sectionsDeleted += r.changes;
      if (b.controlplan_design_id != null && b.controlplan_design_id !== "") {
        cpsUnlinked += 1;
      }
      if (
        b.controlplan_production_id != null &&
        b.controlplan_production_id !== ""
      ) {
        cpsUnlinked += 1;
      }
    }
    const bdbDel = db
      .prepare("delete from construction_element_spec where work_spec_id = ?")
      .run(id);

    const wsSecDel = db
      .prepare("delete from work_spec_section where work_spec_id = ?")
      .run(id);
    sectionsDeleted += wsSecDel.changes;

    const attDel = db
      .prepare(
        "update attachment set work_spec_id = null where work_spec_id = ?",
      )
      .run(id);

    db.prepare("delete from work_spec where id = ?").run(id);

    return {
      bdbs: bdbDel.changes,
      sections: sectionsDeleted,
      attachmentsOrphaned: attDel.changes,
      controlPlansUnlinked: cpsUnlinked,
      // deleteWorkArea doesn't (yet) support the includeCps flag;
      // its cascade still leaves CPs unlinked rather than deleted.
      controlPlansDeleted: 0,
    } satisfies DeleteSummary;
  });

  return tx();
}

export interface DeleteBdbArgs {
  /** `construction_element_spec.id` to delete. */
  id: number;
  /**
   * When true, also fully delete each attached control plan
   * (`controlplan_design_id` + `controlplan_production_id`) — the
   * CP row, its headers, and all its data rows. When false / omitted,
   * the CPs stay around as unlinked plans (the historical behavior).
   *
   * Default-off at the API level to preserve old callers; the UI's
   * Delete BDB dialog defaults the checkbox to ON.
   */
  deleteControlPlans?: boolean;
}

/**
 * Delete a single BDB and its sections, atomically. By default,
 * control plans linked from the BDB are kept (they become unlinked
 * and show up in the sidebar's unlinked-plans bucket). Pass
 * `deleteControlPlans: true` to also hard-delete each linked CP +
 * its headers + its data rows.
 *
 * Throws if the BDB doesn't exist.
 */
export function deleteBdb(
  handle: MoliospecHandle,
  args: DeleteBdbArgs,
): DeleteSummary {
  const { id } = args;
  const db = handle.db;

  const row = db
    .prepare(
      "select controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(id) as
    | {
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      }
    | undefined;
  if (!row) {
    throw new CoreError(
      "INTERNAL",
      { bdbId: id },
      `deleteBdb: no such BDB id=${id}`,
    );
  }

  // Collect the CP ids upfront — we may need them either to count
  // "unlinked" (default behavior) or to delete them (new flag).
  const linkedCpIds: number[] = [];
  for (const idStr of [
    row.controlplan_design_id,
    row.controlplan_production_id,
  ]) {
    if (idStr == null || idStr === "") continue;
    const n = Number.parseInt(idStr, 10);
    if (Number.isFinite(n)) linkedCpIds.push(n);
  }

  const tx = db.transaction(() => {
    // FIX-DelBdbCps 2026-05-11 — when requested, hard-delete the
    // attached CPs (rows + headers + the CP row itself). Do this
    // BEFORE deleting the BDB so the BDB delete cascade ordering
    // stays predictable; we don't rely on FK behavior since the
    // schema declares none for control_plan FKs.
    let cpsDeleted = 0;
    if (args.deleteControlPlans && linkedCpIds.length > 0) {
      const delRows = db.prepare(
        "delete from control_plan_section where control_plan_id = ?",
      );
      const delHeaders = db.prepare(
        "delete from control_plan_section_header where control_plan_id = ?",
      );
      const delCp = db.prepare("delete from control_plan where id = ?");
      for (const cpId of linkedCpIds) {
        delRows.run(cpId);
        delHeaders.run(cpId);
        const r = delCp.run(cpId);
        if (r.changes > 0) cpsDeleted += 1;
      }
    }

    const secDel = db
      .prepare(
        "delete from construction_element_spec_section where construction_element_spec_id = ?",
      )
      .run(id);
    db.prepare("delete from construction_element_spec where id = ?").run(id);

    // If we deleted the CPs, they're not "unlinked" — they're gone.
    // The summary fields distinguish these two outcomes for the
    // renderer's status banner.
    const cpsUnlinked = args.deleteControlPlans ? 0 : linkedCpIds.length;

    return {
      bdbs: 0,
      sections: secDel.changes,
      attachmentsOrphaned: 0,
      controlPlansUnlinked: cpsUnlinked,
      controlPlansDeleted: cpsDeleted,
    } satisfies DeleteSummary;
  });

  return tx();
}
