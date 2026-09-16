/**
 * Writer: apply in-memory edits back to the SQLite database inside a
 * `MoliospecHandle`, inside a single transaction.
 *
 * Scope as of Slice 6D kick-off:
 *   - Section body edits on `work_spec_section` and
 *     `construction_element_spec_section` (existing).
 *   - Control plan row cell edits on `control_plan_section` (new).
 *   - Control plan title edits on `control_plan` (new).
 *   - Whole-CP operations: create, delete, add/delete row, add/delete
 *     header. These are exposed as separate functions (not through
 *     applyEdits) because they change more than one row and don't fit
 *     the UPDATE-only shape.
 */

import type { Statement } from "better-sqlite3";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";

/**
 * Local alias for a prepared statement we don't need to strongly type at
 * the call site. `Statement<unknown[]>` lets `.run(...args)` accept any
 * number of bind parameters; the default generic on `prepare` erases to
 * `[]`, which would force zero-argument `.run()` calls and break every
 * parameterised UPDATE we use here.
 */
type PreparedStatement = Statement<unknown[]>;

/**
 * One edit: replace a single value on an existing row. The `target`
 * discriminator tells us which table to write to and which column.
 *
 * Keeping the discriminated shape means we can fail loudly on unknown
 * targets (the compiler forces every `case` to be handled) and the
 * caller never has to guess which of several overloaded methods to
 * call.
 */
export type Edit =
  | { target: "workSpec"; sectionId: number; body: string }
  | { target: "bdb"; sectionId: number; body: string }
  | {
      target: "cpRow";
      rowId: number;
      /** The control_plan_section column to update. */
      field: CpRowEditableField;
      /** New value. For `controlType` pass a number 0..3 stringified
       *  by the caller — see applyEdits for how it's coerced. */
      value: string;
    }
  | { target: "cpTitle"; controlPlanId: number; title: string }
  // Contract operations (Slice 6I). Create / delete are exposed as
  // their own functions (see below) because they touch multiple rows;
  // renames and work-area reassignments fit the one-cell UPDATE shape
  // and live here.
  | {
      target: "contractRename";
      /** `contracts.id` of the contract to update. */
      id: number;
      /** New code (nullable). Pass `undefined` to leave unchanged. */
      contractCode?: string | null;
      /** New name (nullable). Pass `undefined` to leave unchanged. */
      contractName?: string | null;
    }
  | {
      target: "workSpecContract";
      workSpecId: number;
      /** `contracts.id` to assign, or `null` to clear the link. */
      contractId: number | null;
    }
  // Move a BDB into a different work area (Slice: AI move-BDB tool,
  // 2026-06-30). One-cell UPDATE on construction_element_spec.work_spec_id,
  // so it fits here next to workSpecContract. Validation that the target
  // is sensible (e.g. don't move a PFBB master) lives in the calling
  // tool — this edit is deliberately non-judgemental, matching
  // moveBdbToVirtualWorkSpec.
  | {
      target: "bdbWorkArea";
      /** `construction_element_spec.id` of the BDB to move. */
      bdbId: number;
      /** `work_spec.id` to move the BDB into. */
      workSpecId: number;
    }
  // Buffered container deletes (Slice 6M). The renderer marks a
  // container for deletion in its edit buffer; the delete actually
  // runs here, inside the same save transaction as any body/title
  // updates. Order is handled by `applyEdits`: all updates run
  // first, then BDB deletes, then work-area deletes, then contract
  // deletes. This lets the user reassign a work area's contract
  // AND delete its previous contract in a single save.
  | { target: "deleteContract"; id: number }
  | { target: "deleteWorkArea"; id: number }
  | {
      target: "deleteBdb";
      id: number;
      /**
       * When true, hard-delete each attached control plan (rows +
       * headers + CP row) alongside the BDB. When false / omitted
       * the CPs survive as unlinked plans (historical behaviour).
       * Flag added FIX-DelBdbCps 2026-05-11.
       */
      deleteControlPlans?: boolean;
    }
  /**
   * FIX-DelCpStrike 2026-05-11. Buffered control-plan delete — the
   * renderer now marks CPs for delete instead of calling the
   * standalone `deleteControlPlan` function (which still exists for
   * tests / one-shot ops). Same cascade as that function: rows +
   * headers + CP row, then NULLs the BDB slot column.
   */
  | { target: "deleteControlPlan"; id: number }
  // Project metadata (Slice 10D). There is always at most one row in
  // the `project` table; we still address it by `project_guid` (the
  // PK) so the UPDATE is explicit and would no-op cleanly if the
  // file happens to be project-less. Each nullable field mirrors the
  // contract-rename pattern: `undefined` means "don't touch", `null`
  // clears the column. `name` and `projectNumber` are NOT NULL in
  // the Molio schema, so their patch values are always plain strings.
  | {
      target: "project";
      /** project_guid of the row to update. */
      projectGuid: string;
      name?: string;
      projectNumber?: string;
      builder?: string | null;
      molioReferencelistDate?: string | null;
    }
  // Work-area metadata (Slice 10E). Address by work_spec row `id`.
  // Every patch field follows the 10D pattern: `undefined` = leave
  // alone, `null` = clear (for nullable columns). `workAreaName` is
  // NOT NULL so it's always a plain string when present. The other
  // NOT NULL column is `workAreaType` (integer enum 0..2), also plain
  // when present. Any successful change to a work_spec row bumps
  // `project.modified_date` — same policy as the project variant.
  //
  // The `contract_id` column is intentionally not on this shape: it's
  // already editable via the existing `workSpecContract` variant
  // triggered by the sidebar's "Move to contract…" action, and we
  // didn't want two ways to edit the same column with different
  // mental models.
  | {
      target: "workSpecMetadata";
      /** work_spec.id of the row to update. */
      id: number;
      workAreaCode?: string | null;
      workAreaName?: string;
      workAreaType?: number;
      createdBy?: string | null;
      createdByOrganization?: string | null;
      revision?: string | null;
      revisionDate?: string | null;
      issueDate?: string | null;
      reviewedBy?: string | null;
      approvedBy?: string | null;
    }
  // BDB (construction_element_spec) metadata (Slice 10E). Same patch
  // shape rules as `workSpecMetadata`. `name` is NOT NULL. `isPfbb`
  // is stored as an integer 0/1 in the schema so we accept a number
  // (not a boolean) to keep the core-layer types thin. The `work_spec_id`
  // column is edited via the existing "Move to specification…" action
  // and is not part of this shape, for the same two-ways-to-edit
  // argument as `workSpecMetadata`.
  | {
      target: "bdbMetadata";
      /** construction_element_spec.id of the row to update. */
      id: number;
      name?: string;
      isPfbb?: number;
      createdBy?: string | null;
      createdByOrganization?: string | null;
      revision?: string | null;
      revisionDate?: string | null;
      issueDate?: string | null;
      reviewedBy?: string | null;
      approvedBy?: string | null;
    }
  // Control-plan metadata (Slice 10F). Only `revision` and
  // `revision_date` are supported here — the Molio 2.0 schema's
  // `control_plan` table has no reviewed_by / approved_by / issue_date
  // columns. `title` stays on the existing `cpTitle` variant so inline
  // table-header edits keep their dedicated slot. Same patch rules as
  // every other *Metadata variant: `undefined`=leave alone,
  // `null`=clear (both columns are nullable in the schema).
  | {
      target: "cpMetadata";
      /** control_plan.id of the row to update. */
      id: number;
      revision?: string | null;
      revisionDate?: string | null;
      /**
       * Slice 10I-followup (#71 audit gap 2) — `control_plan.number_text`
       * is editable here. NOT NULL in the schema; we accept a plain
       * string. Use empty string to clear.
       */
      numberText?: string;
    }
  /**
   * Slice 10I-followup (#71 audit gap 3) — update the heading row of
   * a control_plan_section_header. Both columns are NOT NULL in the
   * schema (defaults to empty string), so values are plain strings;
   * `undefined` = leave alone. Caller is responsible for `headerNo`
   * being a valid string per Molio convention (e.g. "1", "1.1") —
   * we don't enforce a numeric format.
   */
  | {
      target: "cpHeaderUpdate";
      /** control_plan_section_header.id of the row. */
      headerId: number;
      header?: string;
      headerNo?: string;
    }
  // PFBB child supplement — create (Slice 10H.7). The renderer stages
  // this when the user clicks "Add supplement" on a grey master block
  // in the child BDB view and types something. At apply time we INSERT
  // a new `construction_element_spec_section` row on the child BDB
  // whose `pfbb_section_id` points back at the master section being
  // supplemented.
  //
  // Idempotent: if a child row already exists with the same
  // `(construction_element_spec_id = bdbId, pfbb_section_id = pfbbSectionId)`
  // pair, we UPDATE its body instead of inserting a duplicate. This
  // defends against double-clicks on the "Add supplement" button and
  // against concurrent edits that produce two stacked creates.
  //
  // `sectionNo` is copied from the master section so the child's row
  // sorts into the same place in the TOC. `body` is the sanitised
  // HTML the user typed; `""` is allowed (empty supplement) but the
  // renderer should buffer a `bdbSectionDelete` instead when the user
  // clears to empty — see Slice 10H.7 rule 5.
  | {
      target: "bdbSectionCreate";
      /** construction_element_spec.id of the child BDB. */
      bdbId: number;
      /** The master's construction_element_spec_section.id being supplemented. */
      pfbbSectionId: number;
      /** Copy of the master section's section_no (e.g. "1.2.3"). */
      sectionNo: string;
      /** Initial body HTML (may be empty). */
      body: string;
    }
  // PFBB child supplement — delete (Slice 10H.7). The renderer stages
  // this when the user clears a supplement to empty, or explicitly
  // removes it. Removes one `construction_element_spec_section` row
  // by id. Unknown ids throw — a delete for a row that's already gone
  // is a renderer bug worth surfacing.
  | {
      target: "bdbSectionDelete";
      /** construction_element_spec_section.id of the supplement to remove. */
      sectionId: number;
    }
  // File-wide `custom_data` key/value upsert (Slice 10I.b). Primary
  // key on the table is `key`, so we use `INSERT OR REPLACE` —
  // atomically creates or overwrites the entry. `valueBase64` is
  // base64-encoded bytes (the underlying column is BLOB); main
  // decodes to a Buffer before binding.
  | {
      target: "customDataSet";
      /** Row key — primary key of the `custom_data` table. */
      key: string;
      /** Base64-encoded value bytes. Empty string is legal (zero-byte BLOB). */
      valueBase64: string;
    }
  // File-wide `custom_data` key delete (Slice 10I.b). Idempotent —
  // deleting a key that isn't there is a no-op at the SQL level.
  | {
      target: "customDataDelete";
      key: string;
    }
  // Section hierarchy — insert (Slice 10G). Create a new section
  // under the given parent (`parentId: null` for a root-level
  // section). The new row's `section_no` is computed from
  // `insertAfterSectionNo` + renumbering: any sibling with
  // `section_no > insertAfterSectionNo` is shifted up by one, and
  // the new row takes `insertAfterSectionNo + 1`. Passing `null`
  // for `insertAfterSectionNo` appends — the new row gets
  // `max(sibling section_no) + 1`, no renumbering needed.
  //
  // The renderer is allowed to stage multiple creates in the same
  // save; order matters only within a single parent (they're all
  // resolved against the post-renumbered sibling set as they run).
  | {
      target: "sectionCreate";
      /** Which table the section belongs to. */
      specKind: "workSpec" | "bdb";
      /** work_spec.id or construction_element_spec.id of the owner. */
      specId: number;
      /**
       * Parent section id. `null` → root-level section under the
       * spec's own tree.
       */
      parentId: number | null;
      /**
       * Sibling section_no to insert after. `null` → append as last
       * child (no renumbering needed). When non-null, every sibling
       * with `section_no > insertAfterSectionNo` is renumbered +1
       * and the new row lands at `insertAfterSectionNo + 1`.
       */
      insertAfterSectionNo: number | null;
      heading: string;
    }
  // Section hierarchy — rename (Slice 10G). Update the heading
  // column on a section row. `specKind` is stamped so we know
  // which table; core throws if the id doesn't exist there.
  | {
      target: "sectionRename";
      specKind: "workSpec" | "bdb";
      sectionId: number;
      heading: string;
    }
  // Section hierarchy — delete (Slice 10G). Removes the section
  // AND ALL its descendants. No sibling renumbering — gaps in
  // section_no are tolerated by the TOC (which sorts ascending),
  // so a post-delete set of siblings numbered [1, 3, 4] reads
  // fine. Users who want contiguous numbers can rename manually
  // or we ship a "tidy numbering" action later.
  | {
      target: "sectionDelete";
      specKind: "workSpec" | "bdb";
      sectionId: number;
    };

/**
 * Backward-compatible alias for the old two-target edit shape. Kept so
 * existing app code and tests keep compiling while we migrate callers
 * over to the broader `Edit` union.
 */
export type SectionBodyEdit = Extract<Edit, { target: "workSpec" | "bdb" }>;

/** control_plan_section columns the UI is allowed to edit. */
export type CpRowEditableField =
  | "controlType"
  | "sectionNo"
  | "subject"
  | "reference"
  | "method"
  | "quantity"
  | "time"
  | "acceptanceCriteria"
  | "documentation"
  | "controlLevel"
  | "sampleLevel";

/** Internal map: camelCase field on the IPC type → snake_case column. */
const CP_ROW_COLUMN_BY_FIELD: Record<CpRowEditableField, string> = {
  controlType: "control_type",
  sectionNo: "section_no",
  subject: "subject",
  reference: "reference",
  method: "method",
  quantity: "quantity",
  time: "time",
  acceptanceCriteria: "acceptance_criteria",
  documentation: "documentation",
  controlLevel: "control_level",
  sampleLevel: "sample_level",
};

export interface ApplyEditsResult {
  /** How many rows were updated in total across every table touched. */
  updated: number;
}

/**
 * Apply a batch of edits to the handle's open database.
 *
 * All UPDATE statements run inside a single transaction: either they all
 * commit or none do. The caller typically follows this with
 * `handle.saveAs(targetPath)` to persist the new state to disk.
 *
 * Throws if any edit references a row id that does not exist in the
 * corresponding table — the caller should treat this as a bug, not a
 * user error.
 */
export function applyEdits(
  handle: MoliospecHandle,
  edits: readonly Edit[],
): ApplyEditsResult {
  if (edits.length === 0) return { updated: 0 };

  const db = handle.db;

  // If any edit targets contracts and the table hasn't been created yet
  // (older schema), create it now. This is a lazy in-place upgrade: we
  // never touch contract-related tables on files that don't need them.
  const touchesContracts = edits.some(
    (e) =>
      e.target === "contractRename" ||
      e.target === "workSpecContract" ||
      e.target === "deleteContract",
  );
  if (touchesContracts) ensureContractsTable(db);

  // Pre-check existence so we can fail before starting the transaction.
  const workSpecExists = db.prepare(
    "select 1 from work_spec_section where id = ? limit 1",
  );
  const bdbExists = db.prepare(
    "select 1 from construction_element_spec_section where id = ? limit 1",
  );
  const cpRowExists = db.prepare(
    "select 1 from control_plan_section where id = ? limit 1",
  );
  const cpExists = db.prepare(
    "select 1 from control_plan where id = ? limit 1",
  );
  const cpHeaderExists = db.prepare(
    "select 1 from control_plan_section_header where id = ? limit 1",
  );
  const workSpecRowExists = db.prepare(
    "select 1 from work_spec where id = ? limit 1",
  );
  const contractExists = db.prepare(
    "select 1 from contracts where id = ? limit 1",
  );
  const bdbRowExists = db.prepare(
    "select 1 from construction_element_spec where id = ? limit 1",
  );
  const projectExists = db.prepare(
    "select 1 from project where project_guid = ? limit 1",
  );
  // Collect the ids of containers about to be deleted so we can relax
  // the pre-check for updates that target their children: those rows
  // still exist right now (the delete hasn't run yet), so the normal
  // SELECT finds them — no special handling needed. The set is only
  // used to give better error messages below.
  for (const e of edits) {
    let ok: unknown;
    switch (e.target) {
      case "workSpec":
        ok = workSpecExists.get(e.sectionId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such workSpec section id=${e.sectionId}`,
          );
        break;
      case "bdb":
        ok = bdbExists.get(e.sectionId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such bdb section id=${e.sectionId}`,
          );
        break;
      case "cpRow":
        ok = cpRowExists.get(e.rowId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such CP row id=${e.rowId}`,
          );
        break;
      case "cpTitle":
        ok = cpExists.get(e.controlPlanId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such control plan id=${e.controlPlanId}`,
          );
        break;
      case "contractRename":
        ok = contractExists.get(e.id);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such contract id=${e.id}`,
          );
        break;
      case "workSpecContract":
        ok = workSpecRowExists.get(e.workSpecId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such work area id=${e.workSpecId}`,
          );
        if (e.contractId !== null) {
          ok = contractExists.get(e.contractId);
          if (!ok)
            throw new CoreError(
              "INTERNAL",
              {},
              `applyEdits: no such contract id=${e.contractId}`,
            );
        }
        break;
      case "bdbWorkArea":
        ok = bdbRowExists.get(e.bdbId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such BDB id=${e.bdbId}`,
          );
        ok = workSpecRowExists.get(e.workSpecId);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such work area id=${e.workSpecId}`,
          );
        break;
      case "deleteContract":
        ok = contractExists.get(e.id);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such contract id=${e.id}`,
          );
        break;
      case "deleteWorkArea":
        ok = workSpecRowExists.get(e.id);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such work area id=${e.id}`,
          );
        break;
      case "deleteBdb":
        ok = bdbRowExists.get(e.id);
        if (!ok)
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such BDB id=${e.id}`,
          );
        break;
      case "project":
        ok = projectExists.get(e.projectGuid);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such project with guid=${e.projectGuid}`,
          );
        }
        break;
      case "workSpecMetadata":
        ok = workSpecRowExists.get(e.id);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such work area id=${e.id}`,
          );
        }
        break;
      case "bdbMetadata":
        ok = bdbRowExists.get(e.id);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such BDB id=${e.id}`,
          );
        }
        break;
      case "cpMetadata":
        ok = cpExists.get(e.id);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such control plan id=${e.id}`,
          );
        }
        break;
      case "cpHeaderUpdate":
        ok = cpHeaderExists.get(e.headerId);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such control plan section header id=${e.headerId}`,
          );
        }
        break;
      case "bdbSectionCreate":
        // Check the child BDB row exists.
        ok = bdbRowExists.get(e.bdbId);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such BDB id=${e.bdbId}`,
          );
        }
        // Check the referenced master section exists. We don't check
        // that the master section actually belongs to a PFBB master —
        // the pfbb_section_id column has no FK in the schema anyway
        // (see pfbb_investigation.md §4) and a looser check lets the
        // renderer stage a supplement even if the data is slightly
        // inconsistent.
        ok = bdbExists.get(e.pfbbSectionId);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such master section id=${e.pfbbSectionId}`,
          );
        }
        break;
      case "bdbSectionDelete":
        ok = bdbExists.get(e.sectionId);
        if (!ok) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such bdb section id=${e.sectionId}`,
          );
        }
        break;
      // custom_data upsert/delete — no pre-existence check. The
      // custom_data table has `key` as PK, and `INSERT OR REPLACE`
      // treats a missing row as a create, a present row as an
      // overwrite. Delete is idempotent — it's fine for the row to
      // already be gone.
      case "customDataSet":
      case "customDataDelete":
        break;
      // Section hierarchy (Slice 10G) — verify parent identifiers
      // exist before we run the transaction. Insert: the owning
      // spec must exist; parent (when non-null) must exist in the
      // matching section table. Rename/Delete: the section must
      // exist in the matching table.
      case "sectionCreate": {
        const specCheck =
          e.specKind === "workSpec"
            ? workSpecRowExists.get(e.specId)
            : bdbRowExists.get(e.specId);
        if (!specCheck) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such ${e.specKind} id=${e.specId}`,
          );
        }
        if (e.parentId != null) {
          const parentCheck =
            e.specKind === "workSpec"
              ? workSpecExists.get(e.parentId)
              : bdbExists.get(e.parentId);
          if (!parentCheck) {
            throw new CoreError(
              "INTERNAL",
              {},
              `applyEdits: sectionCreate — no such parent section id=${e.parentId}`,
            );
          }
        }
        break;
      }
      case "sectionRename":
      case "sectionDelete": {
        const sectionCheck =
          e.specKind === "workSpec"
            ? workSpecExists.get(e.sectionId)
            : bdbExists.get(e.sectionId);
        if (!sectionCheck) {
          throw new CoreError(
            "INTERNAL",
            {},
            `applyEdits: no such ${e.specKind} section id=${e.sectionId}`,
          );
        }
        break;
      }
    }
  }

  const updateWorkSpec = db.prepare(
    "update work_spec_section set body = ? where id = ?",
  );
  const updateBdb = db.prepare(
    "update construction_element_spec_section set body = ? where id = ?",
  );
  // Slice 10H.7 — PFBB child supplement statements. See the Edit union
  // definition for the design rationale.
  const findExistingSupplement = db.prepare(
    "select id from construction_element_spec_section " +
      "where construction_element_spec_id = ? and pfbb_section_id = ? limit 1",
  );
  // Slice 10H.7 — heading is NOT NULL in the schema, so we write "" for
  // supplement rows: the master's section heading is what users see in
  // the child view, the child's supplement row only carries a body.
  const insertBdbSection = db.prepare(
    "insert into construction_element_spec_section (" +
      "construction_element_spec_id, section_no, heading, body, " +
      "molio_section_guid, parent_id, pfbb_section_id" +
      ") values (?, ?, '', ?, null, null, ?)",
  );
  const deleteBdbSectionById = db.prepare(
    "delete from construction_element_spec_section where id = ?",
  );
  // Slice 10I.b — `custom_data` upsert / delete. Primary key on the
  // table is `key`, so INSERT OR REPLACE is safe.
  const upsertCustomData = db.prepare(
    "insert or replace into custom_data (key, value) values (?, ?)",
  );
  const deleteCustomData = db.prepare("delete from custom_data where key = ?");

  // Slice 10G — section hierarchy insert / rename / delete. Work-area
  // and BDB sections live in different tables with matching shapes,
  // so we prepare one statement per table and pick at call time.
  const maxWsSiblingNo = db.prepare(
    "select coalesce(max(section_no), 0) as maxNo " +
      "from work_spec_section " +
      "where work_spec_id = ? and " +
      "(parent_id is ? or parent_id = ?)",
  );
  const maxBdbSiblingNo = db.prepare(
    "select coalesce(max(section_no), 0) as maxNo " +
      "from construction_element_spec_section " +
      "where construction_element_spec_id = ? and " +
      "(parent_id is ? or parent_id = ?)",
  );
  const shiftWsSiblings = db.prepare(
    "update work_spec_section set section_no = section_no + 1 " +
      "where work_spec_id = ? and " +
      "(parent_id is ? or parent_id = ?) and section_no > ?",
  );
  const shiftBdbSiblings = db.prepare(
    "update construction_element_spec_section set section_no = section_no + 1 " +
      "where construction_element_spec_id = ? and " +
      "(parent_id is ? or parent_id = ?) and section_no > ?",
  );
  const insertWsSection = db.prepare(
    "insert into work_spec_section (" +
      "work_spec_id, parent_id, section_no, heading, body, molio_section_guid" +
      ") values (?, ?, ?, ?, '', null)",
  );
  const insertBdbSectionHierarchy = db.prepare(
    "insert into construction_element_spec_section (" +
      "construction_element_spec_id, parent_id, section_no, heading, body, " +
      "molio_section_guid, pfbb_section_id" +
      ") values (?, ?, ?, ?, '', null, null)",
  );
  const renameWsSection = db.prepare(
    "update work_spec_section set heading = ? where id = ?",
  );
  const renameBdbSection = db.prepare(
    "update construction_element_spec_section set heading = ? where id = ?",
  );
  // Cascade-delete helper: a recursive CTE walks the subtree rooted
  // at the given section, collecting ids into a tmp set, then one
  // DELETE removes them all. SQLite honors CTE deletes inline.
  const cascadeDeleteWs = db.prepare(
    "with recursive tree(id) as (" +
      "  select id from work_spec_section where id = ?" +
      "  union all" +
      "  select c.id from work_spec_section c join tree on c.parent_id = tree.id" +
      ") delete from work_spec_section where id in (select id from tree)",
  );
  const cascadeDeleteBdb = db.prepare(
    "with recursive tree(id) as (" +
      "  select id from construction_element_spec_section where id = ?" +
      "  union all" +
      "  select c.id from construction_element_spec_section c " +
      "   join tree on c.parent_id = tree.id" +
      ") delete from construction_element_spec_section where id in (select id from tree)",
  );
  const updateCpTitle = db.prepare(
    "update control_plan set title = ? where id = ?",
  );
  // CP row updates are per-column. We prepare lazily (on first use of a
  // given field) and cache, rather than eagerly preparing all 11 up front.
  //
  // Why lazy: some older .moliospec files predate the
  // `control_plan_section.control_type` column. better-sqlite3 validates a
  // statement against the schema at prepare() time, so eagerly preparing the
  // control_type UPDATE threw "no such column" on those files — breaking
  // EVERY edit, even ones unrelated to control plans. Preparing on demand
  // means a missing column only matters if you actually edit that field;
  // everything else keeps working. The column name comes from the fixed
  // internal CP_ROW_COLUMN_BY_FIELD allowlist, so the interpolation is safe.
  const cpRowStmtCache = new Map<CpRowEditableField, PreparedStatement>();
  const getCpRowStmt = (field: CpRowEditableField): PreparedStatement => {
    const cached = cpRowStmtCache.get(field);
    if (cached) return cached;
    const column = CP_ROW_COLUMN_BY_FIELD[field];
    const stmt = db.prepare(
      `update control_plan_section set ${column} = ? where id = ?`,
    );
    cpRowStmtCache.set(field, stmt);
    return stmt;
  };

  // Contract-side statements — only used if an edit touches contracts.
  // Prepared lazily so the statement doesn't trip on files where the
  // `contracts` table still doesn't exist (we'd have created it above
  // if any edit touched it).
  const updateContractCode = touchesContracts
    ? db.prepare("update contracts set contract_code = ? where id = ?")
    : null;
  const updateContractName = touchesContracts
    ? db.prepare("update contracts set contract_name = ? where id = ?")
    : null;
  const updateWorkSpecContract = db.prepare(
    "update work_spec set contract_id = ? where id = ?",
  );
  const updateBdbWorkArea = db.prepare(
    "update construction_element_spec set work_spec_id = ? where id = ?",
  );

  // Project metadata (Slice 10D). One prepared statement per writable
  // column — same pattern as `CP_ROW_COLUMN_BY_FIELD` above. We also
  // touch `modified_date` to reflect that project metadata has been
  // edited; SQLite's strftime gives us a stable ISO-8601-ish string.
  const updateProjectName = db.prepare(
    "update project set name = ? where project_guid = ?",
  );
  const updateProjectNumber = db.prepare(
    "update project set project_number = ? where project_guid = ?",
  );
  const updateProjectBuilder = db.prepare(
    "update project set builder = ? where project_guid = ?",
  );
  const updateProjectReferencelistDate = db.prepare(
    "update project set molio_referencelist_date = ? where project_guid = ?",
  );
  const touchProjectModifiedDate = db.prepare(
    "update project set modified_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') " +
      "where project_guid = ?",
  );

  // Work-area metadata (Slice 10E). One prepared statement per
  // writable column — same pattern as `CP_ROW_COLUMN_BY_FIELD`.
  const updateWorkSpecCode = db.prepare(
    "update work_spec set work_area_code = ? where id = ?",
  );
  const updateWorkSpecName = db.prepare(
    "update work_spec set work_area_name = ? where id = ?",
  );
  const updateWorkSpecType = db.prepare(
    "update work_spec set work_area_type = ? where id = ?",
  );
  const updateWorkSpecCreatedBy = db.prepare(
    "update work_spec set created_by = ? where id = ?",
  );
  const updateWorkSpecCreatedByOrg = db.prepare(
    "update work_spec set created_by_organization = ? where id = ?",
  );
  const updateWorkSpecRevision = db.prepare(
    "update work_spec set revision = ? where id = ?",
  );
  const updateWorkSpecRevisionDate = db.prepare(
    "update work_spec set revision_date = ? where id = ?",
  );
  const updateWorkSpecIssueDate = db.prepare(
    "update work_spec set issue_date = ? where id = ?",
  );
  const updateWorkSpecReviewedBy = db.prepare(
    "update work_spec set reviewed_by = ? where id = ?",
  );
  const updateWorkSpecApprovedBy = db.prepare(
    "update work_spec set approved_by = ? where id = ?",
  );

  // BDB metadata (Slice 10E). One prepared statement per writable
  // column.
  const updateBdbName = db.prepare(
    "update construction_element_spec set name = ? where id = ?",
  );
  const updateBdbIsPfbb = db.prepare(
    "update construction_element_spec set is_pfbb = ? where id = ?",
  );
  const updateBdbCreatedBy = db.prepare(
    "update construction_element_spec set created_by = ? where id = ?",
  );
  const updateBdbCreatedByOrg = db.prepare(
    "update construction_element_spec set created_by_organization = ? where id = ?",
  );
  const updateBdbRevision = db.prepare(
    "update construction_element_spec set revision = ? where id = ?",
  );
  const updateBdbRevisionDate = db.prepare(
    "update construction_element_spec set revision_date = ? where id = ?",
  );
  const updateBdbIssueDate = db.prepare(
    "update construction_element_spec set issue_date = ? where id = ?",
  );
  const updateBdbReviewedBy = db.prepare(
    "update construction_element_spec set reviewed_by = ? where id = ?",
  );
  const updateBdbApprovedBy = db.prepare(
    "update construction_element_spec set approved_by = ? where id = ?",
  );

  // Control-plan metadata (Slice 10F). Only the two nullable revision
  // columns get a write slot here; `title` is handled by the existing
  // `cpTitle` variant so inline table-header editing doesn't fight
  // the modal over the same slot.
  const updateCpRevision = db.prepare(
    "update control_plan set revision = ? where id = ?",
  );
  const updateCpRevisionDate = db.prepare(
    "update control_plan set revision_date = ? where id = ?",
  );
  // Slice 10I-followup audit gap 2 — number_text. NOT NULL in
  // schema; we accept a plain string (empty allowed for "clear").
  const updateCpNumberText = db.prepare(
    "update control_plan set number_text = ? where id = ?",
  );
  // Slice 10I-followup audit gap 3 — section header text/no.
  const updateCpHeaderText = db.prepare(
    "update control_plan_section_header set header = ? where id = ?",
  );
  const updateCpHeaderNo = db.prepare(
    "update control_plan_section_header set header_no = ? where id = ?",
  );

  // 10E work/BDB edits also bump project.modified_date. There is at
  // most one project row per file; this UPDATE runs over whatever is
  // there (zero or one row) and never breaks on files without a
  // project.
  const touchProjectModifiedDateAny = db.prepare(
    "update project set modified_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  );

  // Delete-time prepared statements. Prepared once per call so the
  // transaction doesn't re-parse SQL on repeated deletes (e.g. the
  // user marks 5 BDBs for deletion in one session).
  const deleteBdbSections = db.prepare(
    "delete from construction_element_spec_section where construction_element_spec_id = ?",
  );
  const deleteBdbsUnderWorkSpec = db.prepare(
    "delete from construction_element_spec where work_spec_id = ?",
  );
  const deleteBdbSectionsUnderWorkSpec = db.prepare(
    "delete from construction_element_spec_section " +
      "where construction_element_spec_id in " +
      "(select id from construction_element_spec where work_spec_id = ?)",
  );
  const deleteWorkSpecSections = db.prepare(
    "delete from work_spec_section where work_spec_id = ?",
  );
  const orphanAttachments = db.prepare(
    "update attachment set work_spec_id = null where work_spec_id = ?",
  );
  const deleteBdbRow = db.prepare(
    "delete from construction_element_spec where id = ?",
  );
  // FIX-DelBdbCps 2026-05-11 — extra statements used when a
  // `deleteBdb` edit asks to also hard-delete attached CPs.
  const lookupBdbCpSlots = db.prepare(
    "select controlplan_design_id, controlplan_production_id " +
      "from construction_element_spec where id = ? limit 1",
  );
  const deleteCpRows = db.prepare(
    "delete from control_plan_section where control_plan_id = ?",
  );
  const deleteCpHeaders = db.prepare(
    "delete from control_plan_section_header where control_plan_id = ?",
  );
  const deleteCpRow = db.prepare("delete from control_plan where id = ?");
  const deleteWorkSpecRow = db.prepare("delete from work_spec where id = ?");
  const deleteContractRow = touchesContracts
    ? db.prepare("delete from contracts where id = ?")
    : null;
  const workSpecsOnContract = db.prepare(
    "select id from work_spec where contract_id = ?",
  );
  // Tolerant "does this row still exist?" checks. Used for the delete
  // variants so that a pending delete whose target was already
  // cascaded away by an earlier delete in the same transaction is
  // silently skipped (instead of throwing "no such row").
  const bdbStillExists = db.prepare(
    "select 1 from construction_element_spec where id = ? limit 1",
  );
  const workSpecStillExists = db.prepare(
    "select 1 from work_spec where id = ? limit 1",
  );
  const contractStillExists = db.prepare(
    "select 1 from contracts where id = ? limit 1",
  );
  // FIX-DelCpStrike 2026-05-11 — buffered CP delete plumbing. NULL
  // the BDB slot columns that reference this CP before removing rows,
  // mirroring the standalone `deleteControlPlan` function.
  const cpStillExists = db.prepare(
    "select 1 from control_plan where id = ? limit 1",
  );
  const clearCpDesignSlot = db.prepare(
    "update construction_element_spec set controlplan_design_id = null where controlplan_design_id = ?",
  );
  const clearCpProductionSlot = db.prepare(
    "update construction_element_spec set controlplan_production_id = null where controlplan_production_id = ?",
  );

  // Partition edits by phase so the transaction body runs them in the
  // order described above (updates → BDB deletes → workArea deletes →
  // contract deletes). Within each phase, original order is preserved.
  const updates: Edit[] = [];
  const controlPlanDeletes: Array<
    Extract<Edit, { target: "deleteControlPlan" }>
  > = [];
  const bdbDeletes: Array<Extract<Edit, { target: "deleteBdb" }>> = [];
  const workAreaDeletes: Array<Extract<Edit, { target: "deleteWorkArea" }>> =
    [];
  const contractDeletes: Array<Extract<Edit, { target: "deleteContract" }>> =
    [];
  for (const e of edits) {
    switch (e.target) {
      case "deleteControlPlan":
        controlPlanDeletes.push(e);
        break;
      case "deleteBdb":
        bdbDeletes.push(e);
        break;
      case "deleteWorkArea":
        workAreaDeletes.push(e);
        break;
      case "deleteContract":
        contractDeletes.push(e);
        break;
      default:
        updates.push(e);
    }
  }

  const run = db.transaction((): number => {
    let updated = 0;

    // ── Phase 1: updates ────────────────────────────────────────────
    for (const e of updates) {
      let info;
      switch (e.target) {
        case "workSpec":
          info = updateWorkSpec.run(e.body, e.sectionId);
          break;
        case "bdb":
          info = updateBdb.run(e.body, e.sectionId);
          break;
        case "cpRow": {
          const stmt = getCpRowStmt(e.field);
          // control_type stores an integer; everything else is text.
          const bindValue: string | number =
            e.field === "controlType" ? Number(e.value) : e.value;
          info = stmt.run(bindValue, e.rowId);
          break;
        }
        case "cpTitle":
          info = updateCpTitle.run(e.title, e.controlPlanId);
          break;
        case "contractRename": {
          // Allow updating either field independently. Each `undefined`
          // means "don't touch this column"; we run 0, 1, or 2 updates
          // and count every row-affecting one towards `updated`.
          let changes = 0;
          if (e.contractCode !== undefined) {
            const r = updateContractCode!.run(e.contractCode, e.id);
            changes += r.changes;
          }
          if (e.contractName !== undefined) {
            const r = updateContractName!.run(e.contractName, e.id);
            changes += r.changes;
          }
          info = { changes } as { changes: number };
          break;
        }
        case "workSpecContract":
          info = updateWorkSpecContract.run(e.contractId, e.workSpecId);
          break;
        case "bdbWorkArea":
          info = updateBdbWorkArea.run(e.workSpecId, e.bdbId);
          break;
        case "project": {
          // Run one UPDATE per touched field (undefined = leave
          // alone). We also bump modified_date whenever any project
          // column actually changes, so the "Last modified" line in
          // the UI stays in sync.
          let changes = 0;
          let touched = false;
          if (e.name !== undefined) {
            const r = updateProjectName.run(e.name, e.projectGuid);
            changes += r.changes;
            touched = true;
          }
          if (e.projectNumber !== undefined) {
            const r = updateProjectNumber.run(e.projectNumber, e.projectGuid);
            changes += r.changes;
            touched = true;
          }
          if (e.builder !== undefined) {
            const r = updateProjectBuilder.run(e.builder, e.projectGuid);
            changes += r.changes;
            touched = true;
          }
          if (e.molioReferencelistDate !== undefined) {
            const r = updateProjectReferencelistDate.run(
              e.molioReferencelistDate,
              e.projectGuid,
            );
            changes += r.changes;
            touched = true;
          }
          if (touched) {
            touchProjectModifiedDate.run(e.projectGuid);
          }
          info = { changes } as { changes: number };
          break;
        }
        case "workSpecMetadata": {
          // Mirror of the `project` case: run one UPDATE per touched
          // field, count row changes, bump project.modified_date once
          // at the end if any column changed.
          let changes = 0;
          let touched = false;
          if (e.workAreaCode !== undefined) {
            const r = updateWorkSpecCode.run(e.workAreaCode, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.workAreaName !== undefined) {
            const r = updateWorkSpecName.run(e.workAreaName, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.workAreaType !== undefined) {
            const r = updateWorkSpecType.run(e.workAreaType, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.createdBy !== undefined) {
            const r = updateWorkSpecCreatedBy.run(e.createdBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.createdByOrganization !== undefined) {
            const r = updateWorkSpecCreatedByOrg.run(
              e.createdByOrganization,
              e.id,
            );
            changes += r.changes;
            touched = true;
          }
          if (e.revision !== undefined) {
            const r = updateWorkSpecRevision.run(e.revision, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.revisionDate !== undefined) {
            const r = updateWorkSpecRevisionDate.run(e.revisionDate, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.issueDate !== undefined) {
            const r = updateWorkSpecIssueDate.run(e.issueDate, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.reviewedBy !== undefined) {
            const r = updateWorkSpecReviewedBy.run(e.reviewedBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.approvedBy !== undefined) {
            const r = updateWorkSpecApprovedBy.run(e.approvedBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (touched) {
            touchProjectModifiedDateAny.run();
          }
          info = { changes } as { changes: number };
          break;
        }
        case "bdbMetadata": {
          let changes = 0;
          let touched = false;
          if (e.name !== undefined) {
            const r = updateBdbName.run(e.name, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.isPfbb !== undefined) {
            const r = updateBdbIsPfbb.run(e.isPfbb, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.createdBy !== undefined) {
            const r = updateBdbCreatedBy.run(e.createdBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.createdByOrganization !== undefined) {
            const r = updateBdbCreatedByOrg.run(e.createdByOrganization, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.revision !== undefined) {
            const r = updateBdbRevision.run(e.revision, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.revisionDate !== undefined) {
            const r = updateBdbRevisionDate.run(e.revisionDate, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.issueDate !== undefined) {
            const r = updateBdbIssueDate.run(e.issueDate, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.reviewedBy !== undefined) {
            const r = updateBdbReviewedBy.run(e.reviewedBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.approvedBy !== undefined) {
            const r = updateBdbApprovedBy.run(e.approvedBy, e.id);
            changes += r.changes;
            touched = true;
          }
          if (touched) {
            touchProjectModifiedDateAny.run();
          }
          info = { changes } as { changes: number };
          break;
        }
        case "cpMetadata": {
          // Same shape as the other *Metadata cases — run one UPDATE
          // per touched field (undefined = skip), bump
          // project.modified_date once at the end if anything
          // actually changed.
          let changes = 0;
          let touched = false;
          if (e.revision !== undefined) {
            const r = updateCpRevision.run(e.revision, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.revisionDate !== undefined) {
            const r = updateCpRevisionDate.run(e.revisionDate, e.id);
            changes += r.changes;
            touched = true;
          }
          if (e.numberText !== undefined) {
            const r = updateCpNumberText.run(e.numberText, e.id);
            changes += r.changes;
            touched = true;
          }
          if (touched) {
            touchProjectModifiedDateAny.run();
          }
          info = { changes } as { changes: number };
          break;
        }
        case "cpHeaderUpdate": {
          let changes = 0;
          let touched = false;
          if (e.header !== undefined) {
            const r = updateCpHeaderText.run(e.header, e.headerId);
            changes += r.changes;
            touched = true;
          }
          if (e.headerNo !== undefined) {
            const r = updateCpHeaderNo.run(e.headerNo, e.headerId);
            changes += r.changes;
            touched = true;
          }
          if (touched) {
            touchProjectModifiedDateAny.run();
          }
          info = { changes } as { changes: number };
          break;
        }
        case "bdbSectionCreate": {
          // Upsert semantics: if a row with the same (child, pfbb_section)
          // pair already exists, UPDATE its body; otherwise INSERT.
          // The renderer should never normally stage two creates for
          // the same pair, but this defends against double-clicks on
          // "Add supplement" and against races between multiple windows.
          const existing = findExistingSupplement.get(
            e.bdbId,
            e.pfbbSectionId,
          ) as { id: number } | undefined;
          if (existing) {
            const r = updateBdb.run(e.body, existing.id);
            info = { changes: r.changes } as { changes: number };
          } else {
            const r = insertBdbSection.run(
              e.bdbId,
              e.sectionNo,
              e.body,
              e.pfbbSectionId,
            );
            info = { changes: r.changes } as { changes: number };
          }
          break;
        }
        case "bdbSectionDelete": {
          const r = deleteBdbSectionById.run(e.sectionId);
          info = { changes: r.changes } as { changes: number };
          break;
        }
        case "customDataSet": {
          // Base64 → Buffer. Empty string → zero-byte buffer. Values
          // are stored as BLOB, so we bind a Node Buffer directly.
          const valueBytes = Buffer.from(e.valueBase64, "base64");
          const r = upsertCustomData.run(e.key, valueBytes);
          info = { changes: r.changes } as { changes: number };
          break;
        }
        case "customDataDelete": {
          const r = deleteCustomData.run(e.key);
          info = { changes: r.changes } as { changes: number };
          break;
        }
        // Slice 10G — section hierarchy. Create inserts one row
        // and (if `insertAfterSectionNo` is non-null) shifts later
        // siblings. Rename updates one row's heading. Delete is a
        // recursive-CTE cascade that removes the section + all
        // descendants in a single statement.
        case "sectionCreate": {
          // Resolve the section_no for the new row.
          let newSectionNo: number;
          const sqlParentMatch = e.parentId; // NULL-safe comparison arg
          if (e.insertAfterSectionNo == null) {
            // Append: new row gets max+1 among current siblings.
            const row =
              e.specKind === "workSpec"
                ? maxWsSiblingNo.get(e.specId, sqlParentMatch, sqlParentMatch)
                : maxBdbSiblingNo.get(e.specId, sqlParentMatch, sqlParentMatch);
            const max = (row as { maxNo?: number } | undefined)?.maxNo ?? 0;
            newSectionNo = max + 1;
          } else {
            // Insert-after: shift siblings above the new slot, then
            // take `insertAfterSectionNo + 1`.
            const shifted =
              e.specKind === "workSpec"
                ? shiftWsSiblings.run(
                    e.specId,
                    sqlParentMatch,
                    sqlParentMatch,
                    e.insertAfterSectionNo,
                  )
                : shiftBdbSiblings.run(
                    e.specId,
                    sqlParentMatch,
                    sqlParentMatch,
                    e.insertAfterSectionNo,
                  );
            // Bump updated by the number of shifted rows so the
            // caller's change-count reflects the full scope.
            info = { changes: shifted.changes };
            updated += info.changes;
            newSectionNo = e.insertAfterSectionNo + 1;
          }
          const r =
            e.specKind === "workSpec"
              ? insertWsSection.run(
                  e.specId,
                  e.parentId,
                  newSectionNo,
                  e.heading,
                )
              : insertBdbSectionHierarchy.run(
                  e.specId,
                  e.parentId,
                  newSectionNo,
                  e.heading,
                );
          info = { changes: r.changes };
          break;
        }
        case "sectionRename": {
          const r =
            e.specKind === "workSpec"
              ? renameWsSection.run(e.heading, e.sectionId)
              : renameBdbSection.run(e.heading, e.sectionId);
          info = { changes: r.changes };
          break;
        }
        case "sectionDelete": {
          const r =
            e.specKind === "workSpec"
              ? cascadeDeleteWs.run(e.sectionId)
              : cascadeDeleteBdb.run(e.sectionId);
          info = { changes: r.changes };
          break;
        }
        default:
          // Should never reach here — updates[] is filtered to
          // non-delete variants.
          continue;
      }
      updated += info.changes;
    }

    // ── Phase 2: control-plan deletes ───────────────────────────────
    // FIX-DelCpStrike 2026-05-11. Buffered CP deletes run BEFORE the
    // BDB deletes so the BDB slot lookup in phase 3 finds a NULL
    // (we cleared it here) and doesn't try to double-delete the CP.
    // If the CP was already cascade-deleted by an earlier BDB delete
    // with `deleteControlPlans: true` we skip silently — order
    // tolerates the overlap.
    for (const e of controlPlanDeletes) {
      if (!cpStillExists.get(e.id)) continue; // Already gone.
      // Clear any BDB column that points at this CP first — the
      // schema stores the link as TEXT, so match on the stringified id.
      const idText = String(e.id);
      updated += clearCpDesignSlot.run(idText).changes;
      updated += clearCpProductionSlot.run(idText).changes;
      updated += deleteCpRows.run(e.id).changes;
      updated += deleteCpHeaders.run(e.id).changes;
      updated += deleteCpRow.run(e.id).changes;
    }

    // ── Phase 3: BDB deletes ────────────────────────────────────────
    // Each deletes its own sections then the BDB row. If the BDB was
    // already cascade-deleted by a subsequent workArea delete (or
    // would be), we still run this first — deleteBdb is the
    // narrower scope and shouldn't be skipped.
    //
    // FIX-DelBdbCps 2026-05-11 — when the edit carries
    // `deleteControlPlans: true`, also hard-delete each attached
    // CP (rows + headers + CP row) BEFORE the BDB itself goes
    // away. Order matters: we look up the slot ids from the
    // still-present BDB row.
    for (const e of bdbDeletes) {
      if (!bdbStillExists.get(e.id)) continue; // Already gone.
      if (e.deleteControlPlans) {
        const slots = lookupBdbCpSlots.get(e.id) as
          | {
              controlplan_design_id: string | null;
              controlplan_production_id: string | null;
            }
          | undefined;
        if (slots) {
          for (const idStr of [
            slots.controlplan_design_id,
            slots.controlplan_production_id,
          ]) {
            if (idStr == null || idStr === "") continue;
            const cpId = Number.parseInt(idStr, 10);
            if (!Number.isFinite(cpId)) continue;
            updated += deleteCpRows.run(cpId).changes;
            updated += deleteCpHeaders.run(cpId).changes;
            updated += deleteCpRow.run(cpId).changes;
          }
        }
      }
      updated += deleteBdbSections.run(e.id).changes;
      updated += deleteBdbRow.run(e.id).changes;
    }

    // ── Phase 4: work-area deletes ──────────────────────────────────
    // Each cascades its sections + its BDBs (+ their sections) and
    // orphans attachments. Control plans linked from the BDBs are
    // preserved (they become unlinked plans).
    for (const e of workAreaDeletes) {
      if (!workSpecStillExists.get(e.id)) continue; // Already gone.
      updated += deleteBdbSectionsUnderWorkSpec.run(e.id).changes;
      updated += deleteBdbsUnderWorkSpec.run(e.id).changes;
      updated += deleteWorkSpecSections.run(e.id).changes;
      updated += orphanAttachments.run(e.id).changes;
      updated += deleteWorkSpecRow.run(e.id).changes;
    }

    // ── Phase 5: contract deletes ───────────────────────────────────
    // Refuses if any work_spec still references the contract — the
    // caller should have buffered `workSpecContract` edits to
    // reassign them. Any such reassignments already ran in phase 1,
    // so by the time we get here the contract *should* be free of
    // references. If it isn't, throw and roll back everything.
    for (const e of contractDeletes) {
      if (!contractStillExists.get(e.id)) continue; // Already gone.
      const refs = workSpecsOnContract.all(e.id) as { id: number }[];
      if (refs.length > 0) {
        const ids = refs.map((r) => r.id).join(", ");
        throw new CoreError(
          "INTERNAL",
          {},
          `applyEdits: contract ${e.id} is still referenced by ` +
            `${refs.length} work area(s): [${ids}]. ` +
            `Reassign them before deleting.`,
        );
      }
      updated += deleteContractRow!.run(e.id).changes;
    }

    return updated;
  });

  return { updated: run() };
}

/**
 * Create the `contracts` table if it isn't there yet. Older Molio files
 * (schema 01.00.03 and below) didn't ship with this table — we add it
 * lazily the first time a contract operation is requested so the user
 * can start using contracts without a manual schema upgrade.
 *
 * Safe to call repeatedly; SQLite no-ops `create table if not exists`.
 */
export function ensureContractsTable(db: MoliospecHandle["db"]): void {
  db.exec(
    "create table if not exists contracts (" +
      "  id            integer primary key," +
      "  contract_code text," +
      "  contract_name text" +
      ")",
  );
}
