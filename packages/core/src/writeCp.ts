/**
 * Control-plan lifecycle write operations: create, duplicate, move,
 * delete, plus add/delete row, add/delete header.
 *
 * These don't fit the per-cell UPDATE shape that `applyEdits`
 * dispatches, so they're separate top-level functions invoked
 * directly via dedicated IPC channels (see main/handlers/cp.ts).
 *
 * Extracted from `write.ts` in slice #233-followup.
 */

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";

/* ------------------------------------------------------------------ */
/*  Control plan lifecycle operations                                  */
/* ------------------------------------------------------------------ */

/**
 * Which BDB column this new CP is linked to. Schema note:
 * `controlplan_design_id` / `controlplan_production_id` on the BDB row
 * are TEXT columns, so we stringify the new CP's integer id when
 * setting them. `control_plan_type` on the CP itself is 0 (design) or
 * 1 (production) per the schema comments.
 */
export type CpSlot = "design" | "production";

export interface CreateControlPlanArgs {
  /** The BDB that owns this new CP. */
  bdbId: number;
  /** Which slot on the BDB to fill — design or production. */
  slot: CpSlot;
  /** Display title for the new CP. */
  title: string;
  /** Display number — often a work_area code like "2.5". Optional; if
   *  omitted, we use an empty string (the schema requires NOT NULL). */
  numberText?: string;
  /** Seed the new CP with one default header + one empty row so the
   *  user has a visible starting point. Default: true. */
  seedRow?: boolean;
}

export interface CreateControlPlanResult {
  controlPlanId: number;
  /** The header row created alongside the CP when `seedRow` is true. */
  headerId: number | null;
  /** The data row created alongside the CP when `seedRow` is true. */
  rowId: number | null;
}

/**
 * Create a new control plan, link it to a BDB's design or production
 * slot, and (by default) seed it with a single empty header + row so
 * the user sees a visible, editable starting structure.
 *
 * Throws if the BDB doesn't exist or the slot column is already set —
 * we refuse to silently overwrite a link because that would orphan an
 * existing CP.
 */
export function createControlPlan(
  handle: MoliospecHandle,
  args: CreateControlPlanArgs,
): CreateControlPlanResult {
  const { bdbId, slot, title, numberText = "", seedRow = true } = args;
  const db = handle.db;

  const bdb = db
    .prepare(
      "select id, controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(bdbId) as
    | {
        id: number;
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      }
    | undefined;
  if (!bdb) {
    throw new CoreError(
      "INTERNAL",
      { bdbId },
      `createControlPlan: no such BDB id=${bdbId}`,
    );
  }

  const slotCol =
    slot === "design" ? "controlplan_design_id" : "controlplan_production_id";
  const existing =
    slot === "design"
      ? bdb.controlplan_design_id
      : bdb.controlplan_production_id;
  if (existing !== null && existing !== "") {
    throw new CoreError(
      "CP_SLOT_OCCUPIED",
      { bdbId, slot },
      `createControlPlan: BDB ${bdbId} already has a ${slot} control plan (id=${existing}). ` +
        `Delete it first or choose the other slot.`,
    );
  }

  // Schema: control_plan_type = 0 design, 1 production.
  const cpType = slot === "design" ? 0 : 1;

  const tx = db.transaction(() => {
    const cpInfo = db
      .prepare(
        "insert into control_plan (number_text, title, control_plan_type) values (?, ?, ?)",
      )
      .run(numberText, title, cpType);
    const cpId = Number(cpInfo.lastInsertRowid);

    // Link the BDB slot. Note: the schema stores these as TEXT.
    db.prepare(
      `update construction_element_spec set ${slotCol} = ? where id = ?`,
    ).run(String(cpId), bdbId);

    let headerId: number | null = null;
    let rowId: number | null = null;
    if (seedRow) {
      const headerInfo = db
        .prepare(
          "insert into control_plan_section_header (header, header_no, control_plan_id) values (?, ?, ?)",
        )
        .run("", "1", cpId);
      headerId = Number(headerInfo.lastInsertRowid);
      const rowInfo = db
        .prepare(
          "insert into control_plan_section (header_id, control_plan_id, control_type, section_no) values (?, ?, 0, ?)",
        )
        .run(headerId, cpId, "1.1");
      rowId = Number(rowInfo.lastInsertRowid);
    }

    return { controlPlanId: cpId, headerId, rowId };
  });

  return tx();
}

/* ------------------------------------------------------------------ */
/*  Duplicate control plan (Slice 6N.1 — #105)                         */
/* ------------------------------------------------------------------ */

export interface DuplicateControlPlanArgs {
  /** The CP to clone. Can live under any BDB in the project. */
  sourceCpId: number;
  /** The BDB that will own the new CP. May differ from the source's. */
  bdbId: number;
  /** Which slot on `bdbId` to fill. The new CP's `control_plan_type`
   *  follows the slot (0=design, 1=production) — the caller's explicit
   *  choice, not whatever the source CP happened to be. */
  slot: CpSlot;
  /** Display title for the new CP. Required — the UI defaults it to
   *  "Copy of <source title>" but the user can edit before confirming. */
  title: string;
  /** Display number (e.g. "2.5"). Defaults to the source CP's own
   *  number_text when omitted. */
  numberText?: string;
}

export interface DuplicateControlPlanResult {
  newControlPlanId: number;
  /** How many header rows were cloned. */
  clonedHeaderCount: number;
  /** How many section rows (data rows) were cloned. */
  clonedRowCount: number;
  /** Source header id → new header id. */
  headerIdMap: Record<number, number>;
  /** Source row id → new row id. */
  rowIdMap: Record<number, number>;
}

/**
 * Duplicate a control plan end-to-end: new `control_plan` row, cloned
 * `control_plan_section_header` rows, cloned `control_plan_section`
 * rows, and a fresh link from the target BDB's chosen slot to the
 * new CP. Full deep copy — the two CPs share no database state after
 * this returns, so editing one doesn't affect the other.
 *
 * Behaviour notes:
 *
 *   - The new CP's `control_plan_type` comes from the caller's `slot`
 *     argument, not the source. Callers decide Design vs Production
 *     in the UI; the source CP's type is just a hint.
 *   - `revision` and `revision_date` are copied verbatim — the copy
 *     starts from the same content, so preserving the recorded
 *     revision matches user expectation. Users can edit via cell
 *     editing afterwards.
 *   - Header `header_no` and row `section_no` are also copied
 *     verbatim. If this creates a visual "1.1, 1.2" collision with
 *     another CP in the same BDB, that's still valid per the schema
 *     — the numbering is just a display label.
 *   - Refuses to overwrite an already-filled slot on the target BDB
 *     (same defence as createControlPlan). The UI pre-filters the
 *     slot picker, so this is just belt-and-braces.
 *
 * All inserts run inside one transaction so the file is either fully
 * duplicated or untouched.
 */
export function duplicateControlPlan(
  handle: MoliospecHandle,
  args: DuplicateControlPlanArgs,
): DuplicateControlPlanResult {
  const { sourceCpId, bdbId, slot, title } = args;
  const db = handle.db;

  // 1. Validate source CP.
  const source = db
    .prepare(
      "select id, number_text, revision, revision_date " +
        "from control_plan where id = ? limit 1",
    )
    .get(sourceCpId) as
    | {
        id: number;
        number_text: string;
        revision: string | null;
        revision_date: string | null;
      }
    | undefined;
  if (!source) {
    throw new CoreError(
      "INTERNAL",
      { sourceCpId },
      `duplicateControlPlan: no such source CP id=${sourceCpId}`,
    );
  }

  // 2. Validate target BDB + the chosen slot is free.
  const bdb = db
    .prepare(
      "select id, controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(bdbId) as
    | {
        id: number;
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      }
    | undefined;
  if (!bdb) {
    throw new CoreError(
      "INTERNAL",
      { bdbId },
      `duplicateControlPlan: no such BDB id=${bdbId}`,
    );
  }
  const slotCol =
    slot === "design" ? "controlplan_design_id" : "controlplan_production_id";
  const existing =
    slot === "design"
      ? bdb.controlplan_design_id
      : bdb.controlplan_production_id;
  if (existing !== null && existing !== "") {
    throw new CoreError(
      "CP_SLOT_OCCUPIED",
      { bdbId, slot },
      `duplicateControlPlan: BDB ${bdbId} already has a ${slot} ` +
        `control plan (id=${existing}). Delete it first or choose ` +
        `the other slot.`,
    );
  }

  const numberText = args.numberText ?? source.number_text;
  // Schema: control_plan_type = 0 design, 1 production.
  const cpType = slot === "design" ? 0 : 1;

  const tx = db.transaction(() => {
    // Insert the new control_plan row.
    const cpInfo = db
      .prepare(
        "insert into control_plan " +
          "(number_text, title, control_plan_type, revision, revision_date) " +
          "values (?, ?, ?, ?, ?)",
      )
      .run(numberText, title, cpType, source.revision, source.revision_date);
    const newCpId = Number(cpInfo.lastInsertRowid);

    // Clone headers — one row per source header, mapping old id → new id
    // so the section-row loop below can rewrite header_id correctly.
    const headers = db
      .prepare(
        "select id, header, header_no from control_plan_section_header " +
          "where control_plan_id = ? order by id",
      )
      .all(sourceCpId) as {
      id: number;
      header: string;
      header_no: string;
    }[];

    const headerIdMap: Record<number, number> = {};
    const insertHeader = db.prepare(
      "insert into control_plan_section_header " +
        "(header, header_no, control_plan_id) values (?, ?, ?)",
    );
    for (const h of headers) {
      const info = insertHeader.run(h.header, h.header_no, newCpId);
      headerIdMap[h.id] = Number(info.lastInsertRowid);
    }

    // Clone section rows — all visible columns, with header_id remapped
    // to the cloned header. A source row whose header id isn't in the
    // map means the file has a dangling reference; we fail loudly so
    // the caller doesn't silently lose data.
    const rows = db
      .prepare(
        "select id, header_id, control_type, section_no, subject, " +
          "reference, method, quantity, time, acceptance_criteria, " +
          "documentation, control_level, sample_level " +
          "from control_plan_section where control_plan_id = ? order by id",
      )
      .all(sourceCpId) as {
      id: number;
      header_id: number;
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

    const rowIdMap: Record<number, number> = {};
    const insertRow = db.prepare(
      "insert into control_plan_section " +
        "(header_id, control_plan_id, control_type, section_no, subject, " +
        "reference, method, quantity, time, acceptance_criteria, " +
        "documentation, control_level, sample_level) " +
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of rows) {
      const newHeaderId = headerIdMap[r.header_id];
      if (newHeaderId == null) {
        throw new CoreError(
          "INTERNAL",
          { sourceCpId, rowId: r.id, headerId: r.header_id },
          `duplicateControlPlan: source CP ${sourceCpId} has a row ` +
            `(id=${r.id}) referencing an unknown header id=${r.header_id}`,
        );
      }
      const info = insertRow.run(
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
      rowIdMap[r.id] = Number(info.lastInsertRowid);
    }

    // Link the target BDB's slot to the new CP. Schema stores as TEXT.
    db.prepare(
      `update construction_element_spec set ${slotCol} = ? where id = ?`,
    ).run(String(newCpId), bdbId);

    return {
      newControlPlanId: newCpId,
      clonedHeaderCount: headers.length,
      clonedRowCount: rows.length,
      headerIdMap,
      rowIdMap,
    };
  });

  return tx();
}

/* ------------------------------------------------------------------ */
/*  Move control plan to a BDB (Slice 6O.3 — #111)                     */
/* ------------------------------------------------------------------ */

export interface MoveControlPlanArgs {
  /** The control plan to reassign. */
  sourceCpId: number;
  /** The BDB that will own the CP after the move. */
  targetBdbId: number;
}

export interface MoveControlPlanResult {
  /** Which slot on the target BDB received the CP. Driven by the CP's
   *  own `control_plan_type` (0 = design, 1 = production). */
  slot: CpSlot;
  /** The BDB the CP used to live under, if any. Null when the CP was
   *  homeless (no BDB referenced it) before the move. Useful for the
   *  UI to know what to re-render / re-focus. */
  previousBdbId: number | null;
  /** Which slot on `previousBdbId` used to hold this CP. Null when
   *  `previousBdbId` is null. Same design/production discriminator. */
  previousSlot: CpSlot | null;
}

/**
 * Reassign an existing control plan to a different BDB. Sibling of
 * `duplicateControlPlan` but without the cloning — a move just rewrites
 * the BDB slot columns so the same CP row now lives under a new owner.
 *
 * Slot choice is NOT a caller decision: we use the CP's own
 * `control_plan_type` (0 = design, 1 = production) to pick the
 * target slot. If the target BDB's matching slot is already filled by
 * *another* CP, we refuse (Tore's UX call per the 6O design thread —
 * users would rather see an explicit error than a silent swap).
 *
 * Homeless CPs (not referenced by any BDB) can be moved the same way;
 * `previousBdbId` just comes back null.
 *
 * The "only one slot per CP" invariant is defended on both sides:
 *
 *   - We scan every BDB's two slot columns for references to this CP
 *     and clear them before linking the target. That handles the
 *     hypothetical "shared CP" file (see the icebox note #103) without
 *     the UI having to know.
 *   - No-op self-move (CP already at `targetBdbId` in its matching
 *     slot) returns `{ previousBdbId: targetBdbId, ... }` and touches
 *     no rows. Callers that care about the dirty flag should check
 *     `previousBdbId === targetBdbId` before marking dirty.
 *
 * Everything runs inside one transaction so the file is either fully
 * moved or untouched.
 */
export function moveControlPlan(
  handle: MoliospecHandle,
  args: MoveControlPlanArgs,
): MoveControlPlanResult {
  const { sourceCpId, targetBdbId } = args;
  const db = handle.db;

  // 1. Validate source CP and read its type so we know which slot to
  //    fill on the target.
  const source = db
    .prepare(
      "select id, control_plan_type from control_plan where id = ? limit 1",
    )
    .get(sourceCpId) as { id: number; control_plan_type: number } | undefined;
  if (!source) {
    throw new CoreError(
      "INTERNAL",
      { sourceCpId },
      `moveControlPlan: no such source CP id=${sourceCpId}`,
    );
  }
  const slot: CpSlot =
    source.control_plan_type === 0
      ? "design"
      : source.control_plan_type === 1
        ? "production"
        : (() => {
            throw new CoreError(
              "INTERNAL",
              { sourceCpId, controlPlanType: source.control_plan_type },
              `moveControlPlan: CP ${sourceCpId} has unknown ` +
                `control_plan_type=${source.control_plan_type} ` +
                `(expected 0=design or 1=production)`,
            );
          })();
  const slotCol =
    slot === "design" ? "controlplan_design_id" : "controlplan_production_id";

  // 2. Validate target BDB exists, and the slot we need on it is free
  //    (or already points at this very CP, in which case it's a no-op).
  const target = db
    .prepare(
      "select id, controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec where id = ? limit 1",
    )
    .get(targetBdbId) as
    | {
        id: number;
        controlplan_design_id: string | null;
        controlplan_production_id: string | null;
      }
    | undefined;
  if (!target) {
    throw new CoreError(
      "INTERNAL",
      { targetBdbId },
      `moveControlPlan: no such target BDB id=${targetBdbId}`,
    );
  }
  const existingOnTarget =
    slot === "design"
      ? target.controlplan_design_id
      : target.controlplan_production_id;
  const alreadyHere =
    existingOnTarget !== null &&
    existingOnTarget !== "" &&
    Number(existingOnTarget) === sourceCpId;
  if (!alreadyHere && existingOnTarget !== null && existingOnTarget !== "") {
    throw new CoreError(
      "CP_SLOT_OCCUPIED",
      { bdbId: targetBdbId, slot },
      `moveControlPlan: BDB ${targetBdbId} already has a ${slot} ` +
        `control plan (id=${existingOnTarget}). Delete or move it first.`,
    );
  }

  // 3. Find the current home(s) of the source CP and clear them. We
  //    scan both columns across every BDB so a hypothetical "shared"
  //    reference still resolves cleanly.
  const holders = db
    .prepare(
      "select id, controlplan_design_id, controlplan_production_id " +
        "from construction_element_spec " +
        "where controlplan_design_id = ? or controlplan_production_id = ?",
    )
    .all(String(sourceCpId), String(sourceCpId)) as {
    id: number;
    controlplan_design_id: string | null;
    controlplan_production_id: string | null;
  }[];

  // Pick the first non-target holder as "previous" for the return value.
  // (The invariant says there's at most one; if the file violated it,
  // we still report one deterministic previous id.)
  let previousBdbId: number | null = null;
  let previousSlot: CpSlot | null = null;
  for (const h of holders) {
    if (h.id === targetBdbId && alreadyHere) continue;
    if (Number(h.controlplan_design_id) === sourceCpId) {
      previousBdbId = h.id;
      previousSlot = "design";
      break;
    }
    if (Number(h.controlplan_production_id) === sourceCpId) {
      previousBdbId = h.id;
      previousSlot = "production";
      break;
    }
  }

  if (alreadyHere) {
    // Target already owns us in the right slot — nothing to write.
    return { slot, previousBdbId: targetBdbId, previousSlot: slot };
  }

  const tx = db.transaction(() => {
    // Clear every old reference. Two UPDATEs so we don't need fancy
    // CASE WHEN — SQLite handles the no-op match just fine.
    const clearDesign = db.prepare(
      "update construction_element_spec set controlplan_design_id = null " +
        "where controlplan_design_id = ?",
    );
    const clearProd = db.prepare(
      "update construction_element_spec set controlplan_production_id = null " +
        "where controlplan_production_id = ?",
    );
    clearDesign.run(String(sourceCpId));
    clearProd.run(String(sourceCpId));

    // Link the target BDB's matching slot.
    db.prepare(
      `update construction_element_spec set ${slotCol} = ? where id = ?`,
    ).run(String(sourceCpId), targetBdbId);
  });
  tx();

  return { slot, previousBdbId, previousSlot };
}

/**
 * Delete a control plan and cascade-clean its section rows + headers.
 * Also NULLs out any BDB column (design or production) pointing at this
 * CP so the file never contains a dangling reference.
 *
 * The schema doesn't declare ON DELETE CASCADE on the foreign keys, so
 * we do it explicitly here.
 */
export function deleteControlPlan(
  handle: MoliospecHandle,
  controlPlanId: number,
): void {
  const db = handle.db;

  const cp = db
    .prepare("select 1 from control_plan where id = ? limit 1")
    .get(controlPlanId);
  if (!cp) {
    throw new CoreError(
      "INTERNAL",
      { controlPlanId },
      `deleteControlPlan: no such control plan id=${controlPlanId}`,
    );
  }

  const tx = db.transaction(() => {
    db.prepare(
      "delete from control_plan_section where control_plan_id = ?",
    ).run(controlPlanId);
    db.prepare(
      "delete from control_plan_section_header where control_plan_id = ?",
    ).run(controlPlanId);
    db.prepare("delete from control_plan where id = ?").run(controlPlanId);
    // NULL out any BDB that pointed at this CP via its text-typed id
    // columns. Match on String(id) — the schema stores the link as TEXT.
    const idText = String(controlPlanId);
    db.prepare(
      "update construction_element_spec set controlplan_design_id = null where controlplan_design_id = ?",
    ).run(idText);
    db.prepare(
      "update construction_element_spec set controlplan_production_id = null where controlplan_production_id = ?",
    ).run(idText);
  });
  tx();
}

export interface AddControlPlanRowArgs {
  controlPlanId: number;
  /** Existing header id within this CP that the new row belongs under. */
  headerId: number;
  /** Section number to display in the Nr. column (e.g. "1.2"). Optional. */
  sectionNo?: string;
}

/**
 * Add one empty row to a control plan under an existing header. Returns
 * the new row's id.
 *
 * The new row is created with all text fields empty and `control_type`
 * = 0 (Ikke angivet). The UI lets the user fill cells in via normal
 * cell editing (`applyEdits` with target: "cpRow").
 */
export function addControlPlanRow(
  handle: MoliospecHandle,
  args: AddControlPlanRowArgs,
): number {
  const { controlPlanId, headerId, sectionNo = "" } = args;
  const db = handle.db;

  const header = db
    .prepare(
      "select control_plan_id from control_plan_section_header where id = ? limit 1",
    )
    .get(headerId) as { control_plan_id: number } | undefined;
  if (!header) {
    throw new CoreError(
      "INTERNAL",
      { headerId },
      `addControlPlanRow: no such header id=${headerId}`,
    );
  }
  if (header.control_plan_id !== controlPlanId) {
    throw new CoreError(
      "INTERNAL",
      { headerId, controlPlanId, actualCpId: header.control_plan_id },
      `addControlPlanRow: header ${headerId} belongs to CP ` +
        `${header.control_plan_id}, not ${controlPlanId}`,
    );
  }
  const info = db
    .prepare(
      "insert into control_plan_section (header_id, control_plan_id, control_type, section_no) values (?, ?, 0, ?)",
    )
    .run(headerId, controlPlanId, sectionNo);
  return Number(info.lastInsertRowid);
}

/** Delete a single control-plan row. */
export function deleteControlPlanRow(
  handle: MoliospecHandle,
  rowId: number,
): void {
  const db = handle.db;
  const info = db
    .prepare("delete from control_plan_section where id = ?")
    .run(rowId);
  if (info.changes === 0) {
    throw new CoreError(
      "INTERNAL",
      { rowId },
      `deleteControlPlanRow: no such row id=${rowId}`,
    );
  }
}

export interface AddControlPlanHeaderArgs {
  controlPlanId: number;
  header: string;
  headerNo: string;
}

/** Add a new group header to a control plan. Returns its id. */
export function addControlPlanHeader(
  handle: MoliospecHandle,
  args: AddControlPlanHeaderArgs,
): number {
  const { controlPlanId, header, headerNo } = args;
  const db = handle.db;
  const cp = db
    .prepare("select 1 from control_plan where id = ? limit 1")
    .get(controlPlanId);
  if (!cp) {
    throw new CoreError(
      "INTERNAL",
      { controlPlanId },
      `addControlPlanHeader: no such control plan id=${controlPlanId}`,
    );
  }
  const info = db
    .prepare(
      "insert into control_plan_section_header (header, header_no, control_plan_id) values (?, ?, ?)",
    )
    .run(header, headerNo, controlPlanId);
  return Number(info.lastInsertRowid);
}

/**
 * Delete a control-plan header and cascade-delete its rows. The schema
 * doesn't declare ON DELETE CASCADE so we clean both tables ourselves.
 */
export function deleteControlPlanHeader(
  handle: MoliospecHandle,
  headerId: number,
): void {
  const db = handle.db;
  const tx = db.transaction(() => {
    db.prepare("delete from control_plan_section where header_id = ?").run(
      headerId,
    );
    const info = db
      .prepare("delete from control_plan_section_header where id = ?")
      .run(headerId);
    if (info.changes === 0) {
      throw new CoreError(
        "INTERNAL",
        { headerId },
        `deleteControlPlanHeader: no such header id=${headerId}`,
      );
    }
  });
  tx();
}
