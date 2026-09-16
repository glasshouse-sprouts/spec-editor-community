/**
 * In-memory edit buffer.
 *
 * A single flat map holds every pending change the user has made, so
 * one `hasEdits(map)` / `toEditRequestList(map)` call covers the whole
 * document regardless of edit kind.
 *
 * Seven kinds of edits share the map; each has a distinct key prefix
 * so they can never collide:
 *
 *     workSpec:<id>          — section-body HTML on a work-spec section
 *     bdb:<id>               — section-body HTML on a BDB section
 *     cpTitle:<id>           — control-plan title string
 *     cpRow:<rowId>:<field>  — one editable column on a control-plan row
 *     contract:<id>          — rename a contract (code and/or name)
 *     wsContract:<workSpecId> — assign a work area to a contract (or null)
 *     project               — project-metadata patch (Slice 10D). There's
 *                              only one project row per file so this key
 *                              has no id suffix.
 *     del:<entityKind>:<id>  — buffered container delete (Slice 6M).
 *                              `entityKind` is one of
 *                              `contract` | `workSpec` | `bdb`. The
 *                              patch carries no other data — the
 *                              delete runs at save time via core's
 *                              deleteContract/deleteWorkArea/deleteBdb
 *                              edit variants.
 *
 * Design choices:
 *
 *   - **Pure helpers.** Every mutation returns a new map (or the same
 *     reference if the state is unchanged) so React's identity checks
 *     let us skip unnecessary re-renders.
 *   - **Tagged values.** The map's value is a discriminated union —
 *     `patch.kind` tells you what shape to expect without parsing the
 *     key. Keeps `toEditRequestList` simple and type-safe.
 *   - **Back-compat.** `SectionKind`, `setSectionBody`, `getEffectiveBody`,
 *     `isSectionEdited`, `editKey`, `toSectionEditList`, `SectionPatch`
 *     are all unchanged at the call-site level — the Slice 6A/B code
 *     doesn't have to care that the map now also carries CP edits.
 */

import type { CpRowEditableField, EditRequest } from "../../shared/ipc.js";

export type SectionKind = "workSpec" | "bdb";

/** `workSpec:123` or `bdb:45`. */
export function editKey(kind: SectionKind, sectionId: number): string {
  return `${kind}:${sectionId}`;
}

/** `cpTitle:12` */
export function cpTitleKey(controlPlanId: number): string {
  return `cpTitle:${controlPlanId}`;
}

/**
 * `bdbSectionCreate:<childBdbId>:<pfbbSectionId>` — one patch per
 * child / master-section pair. Second-write-wins is the intended
 * merge rule (see `setBdbSectionSupplement`).
 */
export function bdbSectionCreateKey(
  bdbId: number,
  pfbbSectionId: number,
): string {
  return `bdbSectionCreate:${bdbId}:${pfbbSectionId}`;
}

/**
 * `bdbSectionDelete:<sectionId>` — one patch per supplement row
 * id being removed.
 */
export function bdbSectionDeleteKey(sectionId: number): string {
  return `bdbSectionDelete:${sectionId}`;
}

/** `cpRow:99:subject` */
export function cpRowKey(rowId: number, field: CpRowEditableField): string {
  return `cpRow:${rowId}:${field}`;
}

/** `contract:7` */
export function contractKey(contractId: number): string {
  return `contract:${contractId}`;
}

/** `wsContract:12` — one patch per work area (last assignment wins). */
export function workSpecContractKey(workSpecId: number): string {
  return `wsContract:${workSpecId}`;
}

/**
 * `project` — the single-row project metadata patch. There's at most
 * one project per file so the key has no id suffix; passing one in
 * would just make the merge logic awkward.
 */
export const PROJECT_KEY = "project";

/**
 * Project-metadata fields the UI is allowed to edit (Slice 10D).
 * Mirrors the writable columns in `packages/core/src/write.ts`.
 */
export type ProjectEditableField =
  | "name"
  | "projectNumber"
  | "builder"
  | "molioReferencelistDate";

/**
 * Work-area (work_spec) fields the UI is allowed to edit (Slice 10E).
 * NOT-NULL fields: `workAreaName`, `workAreaType`. Others are nullable.
 */
export type WorkSpecEditableField =
  | "workAreaCode"
  | "workAreaName"
  | "workAreaType"
  | "createdBy"
  | "createdByOrganization"
  | "revision"
  | "revisionDate"
  | "issueDate"
  | "reviewedBy"
  | "approvedBy";

/**
 * BDB (construction_element_spec) fields the UI is allowed to edit
 * (Slice 10E). NOT-NULL fields: `name`, `isPfbb`. Others are nullable.
 *
 * `isPfbb` is modelled as a `number` (0/1) on the wire to match the
 * SQLite schema; the modal component converts between a checkbox and
 * this number.
 */
export type BdbEditableField =
  | "name"
  | "isPfbb"
  | "createdBy"
  | "createdByOrganization"
  | "revision"
  | "revisionDate"
  | "issueDate"
  | "reviewedBy"
  | "approvedBy";

/**
 * Control-plan fields the modal can edit (Slice 10F). Only two
 * columns exist on the Molio `control_plan` schema that weren't
 * already editable (`title` goes through the existing `cpTitle`
 * path used by the inline table-header editor).
 */
export type CpEditableField =
  | "revision"
  | "revisionDate"
  // Slice 10I-followup audit gap 2 — `control_plan.number_text`.
  // NOT NULL in schema, so we use empty string as the "cleared"
  // value. The editable-field union still types as
  // `string | null` for setCpField symmetry; setters coerce null
  // to empty when emitting the patch.
  | "numberText";

/** `wsMeta:12` — one metadata patch per work-area row. */
export function workSpecMetadataKey(id: number): string {
  return `wsMeta:${id}`;
}

/** `bdbMeta:45` — one metadata patch per BDB row. */
export function bdbMetadataKey(id: number): string {
  return `bdbMeta:${id}`;
}

/** `cpMeta:9` — one metadata patch per control plan row. */
export function cpMetadataKey(id: number): string {
  return `cpMeta:${id}`;
}

/**
 * Buffered-delete entity kinds. Slice 6M originally restricted this
 * to the three "container" rows (contract / workSpec / bdb) and kept
 * control-plan deletes immediate. FIX-DelCpStrike 2026-05-11 added
 * `"controlPlan"` so the sidebar can show the same strikethrough +
 * Restore affordance as for BDB / WA.
 */
export type DeleteEntityKind = "contract" | "workSpec" | "bdb" | "controlPlan";

/** `del:contract:7` / `del:workSpec:12` / `del:bdb:45` / `del:controlPlan:9`. */
export function deleteKey(entityKind: DeleteEntityKind, id: number): string {
  return `del:${entityKind}:${id}`;
}

/**
 * One entry in the edit map. Variants carry the minimal data needed
 * to rebuild an `EditRequest` for the IPC save path — no information
 * has to be re-parsed out of the key.
 */
export type EditPatch =
  | { kind: "body"; body: string }
  | { kind: "cpTitle"; title: string }
  | {
      kind: "cpRow";
      rowId: number;
      field: CpRowEditableField;
      value: string;
    }
  | {
      kind: "contract";
      /**
       * Effective values after editing. `undefined` means "don't touch
       * this column on save"; `null` clears it. Both fields can't be
       * undefined at the same time — such a patch would be a no-op and
       * is never stored.
       */
      contractCode?: string | null;
      contractName?: string | null;
    }
  | {
      kind: "wsContract";
      /**
       * `null` = clear the link (work area becomes "no contract").
       * A number = assign to that contract id.
       */
      contractId: number | null;
    }
  | {
      kind: "delete";
      /**
       * Which table this delete targets. Mirrors the three core Edit
       * variants `deleteContract` / `deleteWorkArea` / `deleteBdb`.
       */
      entityKind: DeleteEntityKind;
      id: number;
      /**
       * FIX-DelBdbCps 2026-05-11. Only meaningful when
       * `entityKind === "bdb"`. When true, the save-time apply will
       * also hard-delete each attached control plan (and its rows +
       * headers). When false / omitted, CPs become unlinked as
       * before. The Delete BDB dialog defaults this to true so the
       * user must deliberately uncheck to keep orphan CPs around.
       */
      deleteControlPlans?: boolean;
    }
  | {
      kind: "project";
      /**
       * project_guid is carried in the patch so the IPC `EditRequest`
       * can be built without re-looking-up the project from state.
       */
      projectGuid: string;
      /**
       * Effective values after editing. `undefined` means "not
       * touched"; `null` clears a nullable column. `name` /
       * `projectNumber` are NOT NULL so their patch values are
       * always strings. If every field reverts to its original, the
       * patch is dropped entirely (see `clearProjectPatchIfClean`).
       */
      name?: string;
      projectNumber?: string;
      builder?: string | null;
      molioReferencelistDate?: string | null;
    }
  | {
      kind: "wsMeta";
      /** work_spec.id — carried so the flatten step can emit the
       *  EditRequest without re-parsing the key. */
      id: number;
      /**
       * Per-field override, same semantics as the `project` patch:
       * `undefined` = not touched, `null` = clear (nullable columns
       * only). `workAreaName`/`workAreaType` are NOT NULL.
       */
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
  | {
      kind: "bdbMeta";
      /** construction_element_spec.id. */
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
  | {
      kind: "cpMeta";
      /** control_plan.id. */
      id: number;
      /**
       * Per-field override — same semantics as the other *Meta
       * patches. `undefined` = not touched, `null` = clear (both
       * columns are nullable in the Molio schema).
       */
      revision?: string | null;
      revisionDate?: string | null;
      /** 10I-followup gap 2 — number_text. NOT NULL; null clears
       *  via empty string at flatten time. */
      numberText?: string | null;
    }
  /**
   * 10I-followup gap 3 — update a control_plan_section_header row.
   * One patch per header id; both columns optional, `undefined` =
   * leave alone, plain string for the new value.
   */
  | {
      kind: "cpHeaderUpdate";
      headerId: number;
      header?: string;
      headerNo?: string;
    }
  /**
   * Slice 10H.7 — create a PFBB child supplement. One patch per
   * (child BDB, master section) pair; if the user clicks "Add
   * supplement" twice in a row on the same section, the second
   * call merges into the first (last-body-wins) rather than
   * stacking two edits. The flatten step emits a
   * `bdbSectionCreate` EditRequest.
   *
   * If the user clears the body back to empty before saving, the
   * renderer must replace this patch with `kind: "bdbSectionClear"`
   * so the flatten step never emits a create with empty body. See
   * rule 5 in the 10H.7 plan doc.
   */
  | {
      kind: "bdbSectionCreate";
      /** construction_element_spec.id of the child BDB. */
      bdbId: number;
      /** The master's construction_element_spec_section.id being supplemented. */
      pfbbSectionId: number;
      /** section_no copied from the master at patch-creation time. */
      sectionNo: string;
      /** Body HTML the user typed. Empty body triggers a clear. */
      body: string;
    }
  /**
   * Slice 10H.7 — delete an existing PFBB child supplement by id.
   * Staged when the user clears an already-persisted supplement to
   * empty, or explicitly removes it. The flatten step emits a
   * `bdbSectionDelete` EditRequest.
   */
  | {
      kind: "bdbSectionDelete";
      /** construction_element_spec_section.id of the supplement row. */
      sectionId: number;
    }
  /**
   * Slice 10I.b — upsert a file-wide `custom_data` row. One pending
   * patch per key; a subsequent set overwrites the pending patch.
   */
  | {
      kind: "customDataSet";
      key: string;
      /** New value bytes, base64-encoded for IPC transfer. */
      valueBase64: string;
    }
  /**
   * Slice 10I.b — delete a `custom_data` row by key. Replaces any
   * pending `customDataSet` on the same key.
   */
  | {
      kind: "customDataDelete";
      key: string;
    }
  /**
   * Slice 10G — stage a new section under the given parent. One
   * patch per "logical insert"; the flatten step preserves original
   * insert order within a parent so renumbering lands right.
   *
   * Creates aren't referenced by any other renderer state (the new
   * row has no client-side id until after save + reload), which is
   * why this patch uses a synthetic `localId` counter as its map
   * key — no collision possible with disk ids.
   */
  | {
      kind: "sectionCreate";
      /** Stable per-session id. Used only as the EditMap key. */
      localId: number;
      specKind: "workSpec" | "bdb";
      specId: number;
      parentId: number | null;
      insertAfterSectionNo: number | null;
      heading: string;
    }
  /** Slice 10G — stage a heading rename for an existing section. */
  | {
      kind: "sectionRename";
      specKind: "workSpec" | "bdb";
      sectionId: number;
      heading: string;
    }
  /**
   * Slice 10G — stage a subtree delete. The renderer treats this
   * as a tombstone for filtering (remove the section + descendants
   * from visible TOC / content).
   */
  | {
      kind: "sectionDelete";
      specKind: "workSpec" | "bdb";
      sectionId: number;
    };

/** Back-compat alias — was the only value shape in Slice 6B. */
export type SectionPatch = Extract<EditPatch, { kind: "body" }>;

/** Frozen at the type level to keep mutations accidental-proof. */
export type EditMap = Readonly<Record<string, EditPatch>>;

export const EMPTY_EDITS: EditMap = Object.freeze({});

/** True if any edit (any kind) is pending. */
export function hasEdits(map: EditMap): boolean {
  for (const _ in map) return true;
  return false;
}

/** Count of pending patches across all kinds. */
export function editCount(map: EditMap): number {
  return Object.keys(map).length;
}

// ─────────────────────────────────────────────────────────────────────
// Section bodies (work-spec / BDB)
// ─────────────────────────────────────────────────────────────────────

/**
 * Set or clear a section-body patch. If `newBody === originalBody` the
 * patch is removed (a no-op edit should not count as dirty). If the
 * patch is unchanged we return the same map reference.
 */
export function setSectionBody(
  map: EditMap,
  kind: SectionKind,
  sectionId: number,
  newBody: string,
  originalBody: string,
): EditMap {
  const key = editKey(kind, sectionId);
  const existing = map[key];

  if (newBody === originalBody) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && existing.kind === "body" && existing.body === newBody) {
    return map;
  }
  return { ...map, [key]: { kind: "body", body: newBody } };
}

export function clearSectionEdit(
  map: EditMap,
  kind: SectionKind,
  sectionId: number,
): EditMap {
  const key = editKey(kind, sectionId);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveBody(
  map: EditMap,
  kind: SectionKind,
  sectionId: number,
  originalBody: string,
): string {
  const patch = map[editKey(kind, sectionId)];
  return patch && patch.kind === "body" ? patch.body : originalBody;
}

export function isSectionEdited(
  map: EditMap,
  kind: SectionKind,
  sectionId: number,
): boolean {
  return editKey(kind, sectionId) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Control-plan title
// ─────────────────────────────────────────────────────────────────────

export function setCpTitle(
  map: EditMap,
  controlPlanId: number,
  newTitle: string,
  originalTitle: string,
): EditMap {
  const key = cpTitleKey(controlPlanId);
  const existing = map[key];

  if (newTitle === originalTitle) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && existing.kind === "cpTitle" && existing.title === newTitle) {
    return map;
  }
  return { ...map, [key]: { kind: "cpTitle", title: newTitle } };
}

export function clearCpTitleEdit(map: EditMap, controlPlanId: number): EditMap {
  const key = cpTitleKey(controlPlanId);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveCpTitle(
  map: EditMap,
  controlPlanId: number,
  originalTitle: string,
): string {
  const patch = map[cpTitleKey(controlPlanId)];
  return patch && patch.kind === "cpTitle" ? patch.title : originalTitle;
}

export function isCpTitleEdited(map: EditMap, controlPlanId: number): boolean {
  return cpTitleKey(controlPlanId) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Control-plan row cells
// ─────────────────────────────────────────────────────────────────────

export function setCpRowCell(
  map: EditMap,
  rowId: number,
  field: CpRowEditableField,
  newValue: string,
  originalValue: string,
): EditMap {
  const key = cpRowKey(rowId, field);
  const existing = map[key];

  if (newValue === originalValue) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && existing.kind === "cpRow" && existing.value === newValue) {
    return map;
  }
  return {
    ...map,
    [key]: { kind: "cpRow", rowId, field, value: newValue },
  };
}

export function clearCpRowCellEdit(
  map: EditMap,
  rowId: number,
  field: CpRowEditableField,
): EditMap {
  const key = cpRowKey(rowId, field);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveCpRowCell(
  map: EditMap,
  rowId: number,
  field: CpRowEditableField,
  originalValue: string,
): string {
  const patch = map[cpRowKey(rowId, field)];
  return patch && patch.kind === "cpRow" ? patch.value : originalValue;
}

export function isCpRowCellEdited(
  map: EditMap,
  rowId: number,
  field: CpRowEditableField,
): boolean {
  return cpRowKey(rowId, field) in map;
}

/**
 * True if any cell on the given row has a pending patch. Handy for
 * row-level dirty indicators and for the "row has changes" guard in
 * the delete-row flow.
 */
export function isAnyCpRowCellEdited(map: EditMap, rowId: number): boolean {
  const prefix = `cpRow:${rowId}:`;
  for (const k in map) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Contracts (rename)
// ─────────────────────────────────────────────────────────────────────
//
// Contract rename is a two-column update (`contract_code`, `contract_name`).
// The edit map stores one patch per contract; per-field setters merge into
// that patch so editing code and name independently both survive until
// save. Reverting every touched field drops the patch entirely.
//
// `null` is a valid value — it clears the column. `undefined` in the patch
// means "this column is not being touched".

/**
 * Pull the existing patch for `contractId`, defaulting to an empty one.
 * Keeps the merge logic in the setters short and explicit.
 */
function getContractPatch(
  map: EditMap,
  contractId: number,
): Extract<EditPatch, { kind: "contract" }> | undefined {
  const patch = map[contractKey(contractId)];
  return patch && patch.kind === "contract" ? patch : undefined;
}

/**
 * True when every populated field of the patch has been reverted back to
 * its original — we can drop the patch in that case.
 */
function contractPatchIsClean(
  patch: Extract<EditPatch, { kind: "contract" }>,
): boolean {
  return patch.contractCode === undefined && patch.contractName === undefined;
}

export function setContractCode(
  map: EditMap,
  contractId: number,
  newCode: string | null,
  originalCode: string | null,
): EditMap {
  const key = contractKey(contractId);
  const existing = getContractPatch(map, contractId);

  const revertsToOriginal = newCode === originalCode;

  // New patch = existing merged with `contractCode` override (or removal).
  const next: Extract<EditPatch, { kind: "contract" }> = {
    kind: "contract",
    ...(existing ?? {}),
  };
  if (revertsToOriginal) delete next.contractCode;
  else next.contractCode = newCode;

  if (contractPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (
    existing &&
    existing.contractCode === next.contractCode &&
    existing.contractName === next.contractName
  ) {
    return map;
  }

  return { ...map, [key]: next };
}

export function setContractName(
  map: EditMap,
  contractId: number,
  newName: string | null,
  originalName: string | null,
): EditMap {
  const key = contractKey(contractId);
  const existing = getContractPatch(map, contractId);

  const revertsToOriginal = newName === originalName;

  const next: Extract<EditPatch, { kind: "contract" }> = {
    kind: "contract",
    ...(existing ?? {}),
  };
  if (revertsToOriginal) delete next.contractName;
  else next.contractName = newName;

  if (contractPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (
    existing &&
    existing.contractCode === next.contractCode &&
    existing.contractName === next.contractName
  ) {
    return map;
  }

  return { ...map, [key]: next };
}

export function clearContractEdit(map: EditMap, contractId: number): EditMap {
  const key = contractKey(contractId);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

/** Effective code after any pending patch. */
export function getEffectiveContractCode(
  map: EditMap,
  contractId: number,
  originalCode: string | null,
): string | null {
  const patch = map[contractKey(contractId)];
  if (patch && patch.kind === "contract" && patch.contractCode !== undefined) {
    return patch.contractCode;
  }
  return originalCode;
}

/** Effective name after any pending patch. */
export function getEffectiveContractName(
  map: EditMap,
  contractId: number,
  originalName: string | null,
): string | null {
  const patch = map[contractKey(contractId)];
  if (patch && patch.kind === "contract" && patch.contractName !== undefined) {
    return patch.contractName;
  }
  return originalName;
}

export function isContractEdited(map: EditMap, contractId: number): boolean {
  return contractKey(contractId) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Work-area → contract assignment
// ─────────────────────────────────────────────────────────────────────
//
// One patch per work area. The value is the new `contract_id` (or null to
// clear the link). A re-assignment to the original value drops the patch
// so "move to contract X, then back" ends up clean.

export function setWorkSpecContract(
  map: EditMap,
  workSpecId: number,
  newContractId: number | null,
  originalContractId: number | null,
): EditMap {
  const key = workSpecContractKey(workSpecId);
  const existing = map[key];

  if (newContractId === originalContractId) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (
    existing &&
    existing.kind === "wsContract" &&
    existing.contractId === newContractId
  ) {
    return map;
  }

  return {
    ...map,
    [key]: { kind: "wsContract", contractId: newContractId },
  };
}

export function clearWorkSpecContractEdit(
  map: EditMap,
  workSpecId: number,
): EditMap {
  const key = workSpecContractKey(workSpecId);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveWorkSpecContract(
  map: EditMap,
  workSpecId: number,
  originalContractId: number | null,
): number | null {
  const patch = map[workSpecContractKey(workSpecId)];
  return patch && patch.kind === "wsContract"
    ? patch.contractId
    : originalContractId;
}

export function isWorkSpecContractEdited(
  map: EditMap,
  workSpecId: number,
): boolean {
  return workSpecContractKey(workSpecId) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Buffered container deletes (Slice 6M)
// ─────────────────────────────────────────────────────────────────────
//
// These three helpers mark a contract / work area / BDB for deletion at
// the next Save. They do not touch the file or the loaded payload — the
// renderer renders pending-delete rows as strikethrough + muted and the
// row is only actually removed when core.applyEdits runs.
//
// Marking the same row twice is a no-op (same map reference is
// returned). `restoreDelete` drops the patch. There is no merge logic:
// a delete patch carries no fields beyond its identity.

/** Mark `id` (of `entityKind`) for deletion on next Save.
 *  `options.deleteControlPlans` is BDB-only (FIX-DelBdbCps): when
 *  true, the save also hard-deletes the BDB's attached CPs. */
export function markDelete(
  map: EditMap,
  entityKind: DeleteEntityKind,
  id: number,
  options?: { deleteControlPlans?: boolean },
): EditMap {
  const key = deleteKey(entityKind, id);
  if (key in map) return map;
  const patch: EditPatch = {
    kind: "delete",
    entityKind,
    id,
    ...(entityKind === "bdb" && options?.deleteControlPlans
      ? { deleteControlPlans: true }
      : {}),
  };
  return { ...map, [key]: patch };
}

/** Restore a pending-deleted row (removes the patch). */
export function restoreDelete(
  map: EditMap,
  entityKind: DeleteEntityKind,
  id: number,
): EditMap {
  const key = deleteKey(entityKind, id);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

/** True when this row is currently marked for deletion. */
export function isPendingDelete(
  map: EditMap,
  entityKind: DeleteEntityKind,
  id: number,
): boolean {
  return deleteKey(entityKind, id) in map;
}

/**
 * FIX-DelCpStrike 2026-05-11. True when the given BDB has a direct
 * delete patch AND that patch carries `deleteControlPlans: true`. Used
 * by the renderer to cascade strikethrough to attached CPs so the
 * sidebar shows what will actually go away on save.
 *
 * Does NOT consider WA / contract cascades — those don't carry a
 * flag, so attached CPs survive (orphan) in those paths and should
 * not show strikethrough.
 */
export function bdbDeleteIncludesCps(map: EditMap, bdbId: number): boolean {
  const patch = map[deleteKey("bdb", bdbId)];
  return (
    patch !== undefined &&
    patch.kind === "delete" &&
    patch.entityKind === "bdb" &&
    patch.deleteControlPlans === true
  );
}

// ─────────────────────────────────────────────────────────────────────
// Project metadata (Slice 10D)
// ─────────────────────────────────────────────────────────────────────
//
// One patch per file (there's only one project row). Works like the
// contract-rename patch: each writable column is independently touched
// via a per-field setter; reverting every field back to its original
// drops the patch entirely so "edit then undo manually" ends clean.
//
// `name` and `projectNumber` are NOT NULL in the schema — callers
// should pass trimmed strings; empty ones will be written verbatim
// and rejected at the core layer if the schema disagrees.

type ProjectPatch = Extract<EditPatch, { kind: "project" }>;

function getProjectPatch(map: EditMap): ProjectPatch | undefined {
  const patch = map[PROJECT_KEY];
  return patch && patch.kind === "project" ? patch : undefined;
}

/**
 * True when every populated column of the patch is `undefined` — i.e.
 * no field is actually being changed. We treat that as "nothing to
 * save" and drop the patch (minus the identity key, which would leave
 * an empty `project:<guid>` patch in the map).
 */
function projectPatchIsClean(patch: ProjectPatch): boolean {
  return (
    patch.name === undefined &&
    patch.projectNumber === undefined &&
    patch.builder === undefined &&
    patch.molioReferencelistDate === undefined
  );
}

/**
 * Set one project field. `newValue` that equals `originalValue` reverts
 * the field (removes it from the patch); if that was the last field
 * touched, the whole patch is dropped.
 *
 * Keeps the call-site short — the renderer calls this per field on
 * modal save without caring about merge logic.
 */
export function setProjectField(
  map: EditMap,
  projectGuid: string,
  field: ProjectEditableField,
  newValue: string | null,
  originalValue: string | null,
): EditMap {
  const existing = getProjectPatch(map);
  const revertsToOriginal = newValue === originalValue;

  const next: ProjectPatch = {
    kind: "project",
    projectGuid,
    ...(existing ?? {}),
  };

  if (revertsToOriginal) {
    delete next[field];
  } else {
    // `name` / `projectNumber` are NOT NULL — narrow the type for TS.
    if (field === "name") {
      next.name = newValue ?? "";
    } else if (field === "projectNumber") {
      next.projectNumber = newValue ?? "";
    } else if (field === "builder") {
      next.builder = newValue;
    } else {
      next.molioReferencelistDate = newValue;
    }
  }

  if (projectPatchIsClean(next)) {
    if (!existing) return map;
    const { [PROJECT_KEY]: _discard, ...rest } = map;
    return rest;
  }

  if (
    existing &&
    existing.name === next.name &&
    existing.projectNumber === next.projectNumber &&
    existing.builder === next.builder &&
    existing.molioReferencelistDate === next.molioReferencelistDate
  ) {
    return map;
  }

  return { ...map, [PROJECT_KEY]: next };
}

export function clearProjectEdit(map: EditMap): EditMap {
  if (!(PROJECT_KEY in map)) return map;
  const { [PROJECT_KEY]: _discard, ...rest } = map;
  return rest;
}

/**
 * Effective value for one project field after any pending patch.
 * Mirrors `getEffectiveContractCode`/`Name` — callers don't have to
 * reach into the raw map.
 */
export function getEffectiveProjectField(
  map: EditMap,
  field: ProjectEditableField,
  originalValue: string | null,
): string | null {
  const patch = getProjectPatch(map);
  if (!patch) return originalValue;
  const override = patch[field];
  // `undefined` means "not touched"; `null` is an explicit clear.
  if (override === undefined) return originalValue;
  return override ?? null;
}

export function isProjectEdited(map: EditMap): boolean {
  return PROJECT_KEY in map;
}

// ─────────────────────────────────────────────────────────────────────
// Work-area (work_spec) metadata — Slice 10E
// ─────────────────────────────────────────────────────────────────────
//
// Same pattern as the project helpers above: per-field `undefined` =
// untouched, `null` = clear (for nullable columns). When every field
// reverts to its original value the whole patch is dropped so a clean
// edit-then-undo leaves the map tidy. `workAreaName` / `workAreaType`
// are NOT NULL — the setter narrows them to their non-null form.

type WsMetaPatch = Extract<EditPatch, { kind: "wsMeta" }>;

function getWsMetaPatch(map: EditMap, id: number): WsMetaPatch | undefined {
  const patch = map[workSpecMetadataKey(id)];
  return patch && patch.kind === "wsMeta" ? patch : undefined;
}

function wsMetaPatchIsClean(patch: WsMetaPatch): boolean {
  return (
    patch.workAreaCode === undefined &&
    patch.workAreaName === undefined &&
    patch.workAreaType === undefined &&
    patch.createdBy === undefined &&
    patch.createdByOrganization === undefined &&
    patch.revision === undefined &&
    patch.revisionDate === undefined &&
    patch.issueDate === undefined &&
    patch.reviewedBy === undefined &&
    patch.approvedBy === undefined
  );
}

/**
 * Set (or revert) one field on the work-area metadata patch. For
 * nullable text fields, pass `newValue = null` to clear; pass the
 * original value to revert a previously-edited field. For
 * `workAreaType`, `newValue` is the integer enum as a string (the
 * same serialization the core layer expects) — callers can also pass
 * a plain number, which we accept to keep the `<select value>` wiring
 * obvious.
 */
export function setWorkSpecField(
  map: EditMap,
  id: number,
  field: WorkSpecEditableField,
  newValue: string | number | null,
  originalValue: string | number | null,
): EditMap {
  const key = workSpecMetadataKey(id);
  const existing = getWsMetaPatch(map, id);
  const revertsToOriginal = newValue === originalValue;

  const next: WsMetaPatch = { kind: "wsMeta", id, ...(existing ?? {}) };

  if (revertsToOriginal) {
    // Type trick: `delete next[field]` is valid because every field
    // is optional. Narrow to `keyof WsMetaPatch` so TS is happy.
    delete (next as Record<string, unknown>)[field];
  } else if (field === "workAreaName") {
    next.workAreaName = (newValue ?? "") as string;
  } else if (field === "workAreaType") {
    next.workAreaType =
      typeof newValue === "number" ? newValue : Number(newValue ?? 0);
  } else {
    // All remaining fields are nullable strings.
    (next as Record<string, unknown>)[field] =
      newValue === null ? null : String(newValue);
  }

  if (wsMetaPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && shallowEqualWsMeta(existing, next)) return map;
  return { ...map, [key]: next };
}

function shallowEqualWsMeta(a: WsMetaPatch, b: WsMetaPatch): boolean {
  return (
    a.workAreaCode === b.workAreaCode &&
    a.workAreaName === b.workAreaName &&
    a.workAreaType === b.workAreaType &&
    a.createdBy === b.createdBy &&
    a.createdByOrganization === b.createdByOrganization &&
    a.revision === b.revision &&
    a.revisionDate === b.revisionDate &&
    a.issueDate === b.issueDate &&
    a.reviewedBy === b.reviewedBy &&
    a.approvedBy === b.approvedBy
  );
}

export function clearWorkSpecMetadataEdit(map: EditMap, id: number): EditMap {
  const key = workSpecMetadataKey(id);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveWorkSpecField(
  map: EditMap,
  id: number,
  field: WorkSpecEditableField,
  originalValue: string | number | null,
): string | number | null {
  const patch = getWsMetaPatch(map, id);
  if (!patch) return originalValue;
  const override = (patch as Record<string, unknown>)[field];
  if (override === undefined) return originalValue;
  return override as string | number | null;
}

export function isWorkSpecMetadataEdited(map: EditMap, id: number): boolean {
  return workSpecMetadataKey(id) in map;
}

// ─────────────────────────────────────────────────────────────────────
// BDB (construction_element_spec) metadata — Slice 10E
// ─────────────────────────────────────────────────────────────────────

type BdbMetaPatch = Extract<EditPatch, { kind: "bdbMeta" }>;

function getBdbMetaPatch(map: EditMap, id: number): BdbMetaPatch | undefined {
  const patch = map[bdbMetadataKey(id)];
  return patch && patch.kind === "bdbMeta" ? patch : undefined;
}

function bdbMetaPatchIsClean(patch: BdbMetaPatch): boolean {
  return (
    patch.name === undefined &&
    patch.isPfbb === undefined &&
    patch.createdBy === undefined &&
    patch.createdByOrganization === undefined &&
    patch.revision === undefined &&
    patch.revisionDate === undefined &&
    patch.issueDate === undefined &&
    patch.reviewedBy === undefined &&
    patch.approvedBy === undefined
  );
}

export function setBdbField(
  map: EditMap,
  id: number,
  field: BdbEditableField,
  newValue: string | number | null,
  originalValue: string | number | null,
): EditMap {
  const key = bdbMetadataKey(id);
  const existing = getBdbMetaPatch(map, id);
  const revertsToOriginal = newValue === originalValue;

  const next: BdbMetaPatch = { kind: "bdbMeta", id, ...(existing ?? {}) };

  if (revertsToOriginal) {
    delete (next as Record<string, unknown>)[field];
  } else if (field === "name") {
    next.name = (newValue ?? "") as string;
  } else if (field === "isPfbb") {
    next.isPfbb =
      typeof newValue === "number" ? newValue : Number(newValue ?? 0);
  } else {
    (next as Record<string, unknown>)[field] =
      newValue === null ? null : String(newValue);
  }

  if (bdbMetaPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && shallowEqualBdbMeta(existing, next)) return map;
  return { ...map, [key]: next };
}

function shallowEqualBdbMeta(a: BdbMetaPatch, b: BdbMetaPatch): boolean {
  return (
    a.name === b.name &&
    a.isPfbb === b.isPfbb &&
    a.createdBy === b.createdBy &&
    a.createdByOrganization === b.createdByOrganization &&
    a.revision === b.revision &&
    a.revisionDate === b.revisionDate &&
    a.issueDate === b.issueDate &&
    a.reviewedBy === b.reviewedBy &&
    a.approvedBy === b.approvedBy
  );
}

export function clearBdbMetadataEdit(map: EditMap, id: number): EditMap {
  const key = bdbMetadataKey(id);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveBdbField(
  map: EditMap,
  id: number,
  field: BdbEditableField,
  originalValue: string | number | null,
): string | number | null {
  const patch = getBdbMetaPatch(map, id);
  if (!patch) return originalValue;
  const override = (patch as Record<string, unknown>)[field];
  if (override === undefined) return originalValue;
  return override as string | number | null;
}

export function isBdbMetadataEdited(map: EditMap, id: number): boolean {
  return bdbMetadataKey(id) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Control plan metadata — Slice 10F
// ─────────────────────────────────────────────────────────────────────

type CpMetaPatch = Extract<EditPatch, { kind: "cpMeta" }>;

function getCpMetaPatch(map: EditMap, id: number): CpMetaPatch | undefined {
  const patch = map[cpMetadataKey(id)];
  return patch && patch.kind === "cpMeta" ? patch : undefined;
}

function cpMetaPatchIsClean(patch: CpMetaPatch): boolean {
  return (
    patch.revision === undefined &&
    patch.revisionDate === undefined &&
    patch.numberText === undefined
  );
}

/**
 * Update a single control-plan metadata field (revision / revisionDate).
 * Mirrors `setWorkSpecField`/`setBdbField`: reverting to the original
 * value drops that field from the patch, and once no field is left the
 * whole patch is removed.
 *
 * `title` is intentionally NOT handled here — the modal routes title
 * changes through the existing `setCpTitle` path (used by the inline
 * table-header editor) so there's only ever one patch per column.
 */
export function setCpField(
  map: EditMap,
  id: number,
  field: CpEditableField,
  newValue: string | null,
  originalValue: string | null,
): EditMap {
  const key = cpMetadataKey(id);
  const existing = getCpMetaPatch(map, id);
  const revertsToOriginal = newValue === originalValue;

  const next: CpMetaPatch = { kind: "cpMeta", id, ...(existing ?? {}) };

  if (revertsToOriginal) {
    delete (next as Record<string, unknown>)[field];
  } else {
    // Both fields are nullable strings.
    (next as Record<string, unknown>)[field] =
      newValue === null ? null : String(newValue);
  }

  if (cpMetaPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }

  if (existing && shallowEqualCpMeta(existing, next)) return map;
  return { ...map, [key]: next };
}

function shallowEqualCpMeta(a: CpMetaPatch, b: CpMetaPatch): boolean {
  return (
    a.revision === b.revision &&
    a.revisionDate === b.revisionDate &&
    a.numberText === b.numberText
  );
}

export function clearCpMetadataEdit(map: EditMap, id: number): EditMap {
  const key = cpMetadataKey(id);
  if (!(key in map)) return map;
  const { [key]: _discard, ...rest } = map;
  return rest;
}

export function getEffectiveCpField(
  map: EditMap,
  id: number,
  field: CpEditableField,
  originalValue: string | null,
): string | null {
  const patch = getCpMetaPatch(map, id);
  if (!patch) return originalValue;
  const override = (patch as Record<string, unknown>)[field];
  if (override === undefined) return originalValue;
  return override as string | null;
}

// ─────────────────────────────────────────────────────────────────────
// 10I-followup gap 3 — Control plan section header updates
// ─────────────────────────────────────────────────────────────────────

export type CpHeaderEditableField = "header" | "headerNo";

export function cpHeaderUpdateKey(headerId: number): string {
  return `cpHeaderUpdate:${headerId}`;
}

type CpHeaderPatch = Extract<EditPatch, { kind: "cpHeaderUpdate" }>;

function getCpHeaderPatch(
  map: EditMap,
  headerId: number,
): CpHeaderPatch | undefined {
  const patch = map[cpHeaderUpdateKey(headerId)];
  return patch && patch.kind === "cpHeaderUpdate" ? patch : undefined;
}

function cpHeaderPatchIsClean(patch: CpHeaderPatch): boolean {
  return patch.header === undefined && patch.headerNo === undefined;
}

/**
 * Update one column on a control_plan_section_header. Mirrors the
 * other field-style setters: passing the original value drops that
 * field from the patch; once both fields are clean the whole patch
 * is removed.
 */
export function setCpHeaderField(
  map: EditMap,
  headerId: number,
  field: CpHeaderEditableField,
  newValue: string,
  originalValue: string,
): EditMap {
  const key = cpHeaderUpdateKey(headerId);
  const existing = getCpHeaderPatch(map, headerId);
  const revertsToOriginal = newValue === originalValue;

  const next: CpHeaderPatch = {
    kind: "cpHeaderUpdate",
    headerId,
    ...(existing ?? {}),
  };
  if (revertsToOriginal) {
    delete (next as Record<string, unknown>)[field];
  } else {
    (next as Record<string, unknown>)[field] = newValue;
  }
  if (cpHeaderPatchIsClean(next)) {
    if (!existing) return map;
    const { [key]: _discard, ...rest } = map;
    return rest;
  }
  if (
    existing &&
    existing.header === next.header &&
    existing.headerNo === next.headerNo
  ) {
    return map;
  }
  return { ...map, [key]: next };
}

export function getEffectiveCpHeaderField(
  map: EditMap,
  headerId: number,
  field: CpHeaderEditableField,
  originalValue: string,
): string {
  const patch = getCpHeaderPatch(map, headerId);
  if (!patch) return originalValue;
  const override = (patch as Record<string, unknown>)[field];
  if (override === undefined) return originalValue;
  return override as string;
}

export function isCpMetadataEdited(map: EditMap, id: number): boolean {
  return cpMetadataKey(id) in map;
}

// ─────────────────────────────────────────────────────────────────────
// Slice 10H.7 — PFBB child supplement helpers
// ─────────────────────────────────────────────────────────────────────
//
// The child view exposes one editor per master section. Writing in
// that editor buffers a `bdbSectionCreate` patch; clearing it back
// to empty either drops that patch (if the supplement was new this
// session) or converts it to a `bdbSectionDelete` patch (if the
// supplement already exists on disk).
//
// Key points:
//   - Patches are keyed by `(bdbId, pfbbSectionId)` for creates and
//     by `sectionId` for deletes. Second-write-wins on both.
//   - `setBdbSectionSupplement` is the main entry point the editor
//     calls on every body change. `existingSectionId` tells us
//     whether the supplement already has a persisted row: null = new
//     this session, number = already on disk.

/**
 * Set or update a PFBB child supplement's body.
 *
 * Behaviour:
 *   - **New this session** (`existingSectionId == null`)
 *     - body non-empty → store a `bdbSectionCreate` patch
 *     - body empty     → drop any existing create patch (nothing to save)
 *   - **Already on disk** (`existingSectionId != null`)
 *     - body non-empty → store a `bdbSectionCreate` upsert patch
 *       (core's applyEdits will UPDATE the existing row in place)
 *     - body empty     → replace any pending create with a
 *       `bdbSectionDelete` patch
 */
export function setBdbSectionSupplement(
  map: EditMap,
  input: {
    bdbId: number;
    pfbbSectionId: number;
    sectionNo: string;
    body: string;
    /** Current row id on disk, or null if the supplement is new. */
    existingSectionId: number | null;
    /**
     * On-disk body for this supplement, or null if nothing persisted
     * yet. Used by the "no-op vs disk" guard below: TipTap can fire
     * `onChange` on mount with a normalised copy of the initial HTML
     * (e.g. same characters, slightly different tag spacing); without
     * this check we'd stage a stale create patch that keeps the dirty
     * dot lit even when the user hasn't actually changed anything.
     * Mirror of the `newBody === originalBody` guard in
     * `setSectionBody`.
     */
    originalBody: string | null;
  },
): EditMap {
  const createKey = bdbSectionCreateKey(input.bdbId, input.pfbbSectionId);
  const deleteKey_ =
    input.existingSectionId != null
      ? bdbSectionDeleteKey(input.existingSectionId)
      : null;
  const diskBody = input.originalBody ?? "";

  // No-op vs disk: when the typed body matches whatever's on disk,
  // drop any pending create/delete so the edit buffer clears. Same
  // idea as setSectionBody for regular sections.
  if (input.body === diskBody) {
    const hadCreate = createKey in map;
    const hadDelete = deleteKey_ != null && deleteKey_ in map;
    if (!hadCreate && !hadDelete) return map;
    const next: Record<string, EditPatch> = { ...map };
    if (hadCreate) delete next[createKey];
    if (hadDelete) delete next[deleteKey_!];
    return next;
  }

  const next: Record<string, EditPatch> = { ...map };

  if (input.body.length > 0) {
    // Writing — never leave a stale delete around.
    if (deleteKey_ && deleteKey_ in next) {
      delete next[deleteKey_];
    }
    const patch: EditPatch = {
      kind: "bdbSectionCreate",
      bdbId: input.bdbId,
      pfbbSectionId: input.pfbbSectionId,
      sectionNo: input.sectionNo,
      body: input.body,
    };
    const existing = next[createKey];
    if (
      existing &&
      existing.kind === "bdbSectionCreate" &&
      existing.body === patch.body &&
      existing.sectionNo === patch.sectionNo
    ) {
      // Same value as before → no-op (keeps map identity stable).
      return map;
    }
    next[createKey] = patch;
    return next;
  }

  // Empty body — decide drop vs. delete.
  const hadCreate = createKey in next;
  if (hadCreate) {
    delete next[createKey];
  }
  if (deleteKey_) {
    // The supplement exists on disk; stage a delete regardless of
    // whether a create patch was pending.
    next[deleteKey_] = {
      kind: "bdbSectionDelete",
      sectionId: input.existingSectionId!,
    };
  }
  if (!hadCreate && !deleteKey_) return map; // nothing changed
  if (!hadCreate && deleteKey_ && deleteKey_ in map) return map; // already staged
  return next;
}

/**
 * Drop any pending supplement edits for a specific
 * `(bdbId, pfbbSectionId)` pair. Used when the user explicitly
 * cancels an in-progress supplement that was never persisted.
 *
 * If `existingSectionId` is provided, any pending delete for that
 * row id is also dropped — so cancelling an edit on a persisted
 * supplement restores the on-disk value instead of deleting it.
 */
export function clearBdbSectionSupplementEdit(
  map: EditMap,
  input: {
    bdbId: number;
    pfbbSectionId: number;
    existingSectionId: number | null;
  },
): EditMap {
  const createKey = bdbSectionCreateKey(input.bdbId, input.pfbbSectionId);
  const deleteKey_ =
    input.existingSectionId != null
      ? bdbSectionDeleteKey(input.existingSectionId)
      : null;
  if (!(createKey in map) && !(deleteKey_ && deleteKey_ in map)) return map;
  const next: Record<string, EditPatch> = { ...map };
  delete next[createKey];
  if (deleteKey_) delete next[deleteKey_];
  return next;
}

/**
 * Slice 10H.11 — stage a direct delete of a PFBB child supplement
 * row by its own `construction_element_spec_section.id`. Used by the
 * broken-supplements cleanup flow, where the user wants to remove an
 * orphan row whose `pfbbSectionId` points at a master that no longer
 * exists — so `setBdbSectionSupplement` (which is keyed by
 * `(bdbId, pfbbSectionId)`) isn't the right shape.
 *
 * Idempotent: staging the same delete twice returns the same map.
 */
export function stageBdbSectionDelete(
  map: EditMap,
  sectionId: number,
): EditMap {
  const key = bdbSectionDeleteKey(sectionId);
  const existing = map[key];
  if (existing && existing.kind === "bdbSectionDelete") return map;
  const next: Record<string, EditPatch> = { ...map };
  next[key] = { kind: "bdbSectionDelete", sectionId };
  return next;
}

// ─────────────────────────────────────────────────────────────────────
// Slice 10I.b — file-wide custom_data edits
// ─────────────────────────────────────────────────────────────────────

export function customDataKey(key: string): string {
  return `customData:${key}`;
}

/**
 * Stage an upsert of a `custom_data` row. If a prior set / delete for
 * the same key is pending, it's replaced. If `valueBase64` matches
 * `originalBase64` (i.e. the user's typed value equals disk), the
 * pending patch is dropped entirely — the edit buffer keeps clean.
 */
export function setCustomData(
  map: EditMap,
  input: {
    key: string;
    valueBase64: string;
    /** Base64 of the on-disk value, or null if there's no disk row
     *  for this key. Used for the no-op vs disk check. */
    originalBase64: string | null;
  },
): EditMap {
  const mapKey = customDataKey(input.key);
  const diskBase = input.originalBase64 ?? null;
  const userBase = input.valueBase64;
  // If the typed value matches disk AND the disk row actually exists,
  // drop any pending patch so the dirty dot clears.
  if (diskBase != null && userBase === diskBase) {
    if (!(mapKey in map)) return map;
    const next: Record<string, EditPatch> = { ...map };
    delete next[mapKey];
    return next;
  }
  const patch: EditPatch = {
    kind: "customDataSet",
    key: input.key,
    valueBase64: userBase,
  };
  const existing = map[mapKey];
  if (
    existing &&
    existing.kind === "customDataSet" &&
    existing.valueBase64 === patch.valueBase64
  ) {
    return map;
  }
  const next: Record<string, EditPatch> = { ...map };
  next[mapKey] = patch;
  return next;
}

/**
 * Stage a delete of a `custom_data` row. If the row has no disk
 * presence (caller passes `hadDiskRow=false`), we just drop any
 * pending `customDataSet` instead — no point staging a delete for
 * something that never hit disk.
 */
export function deleteCustomDataEdit(
  map: EditMap,
  input: { key: string; hadDiskRow: boolean },
): EditMap {
  const mapKey = customDataKey(input.key);
  const next: Record<string, EditPatch> = { ...map };
  if (!input.hadDiskRow) {
    // Never-persisted key: drop any pending set, don't stage a delete.
    if (!(mapKey in next)) return map;
    delete next[mapKey];
    return next;
  }
  const existing = map[mapKey];
  if (existing && existing.kind === "customDataDelete") return map;
  next[mapKey] = { kind: "customDataDelete", key: input.key };
  return next;
}

/**
 * Drop any pending custom_data edit for the given key — e.g. when the
 * user clicks "Cancel" on an inline edit of a persisted row.
 */
export function clearCustomDataEdit(map: EditMap, key: string): EditMap {
  const mapKey = customDataKey(key);
  if (!(mapKey in map)) return map;
  const next: Record<string, EditPatch> = { ...map };
  delete next[mapKey];
  return next;
}

/**
 * Merged view of the current `custom_data` state: disk entries with
 * pending edits applied on top. Returns a new array sorted by key
 * so the UI renders in a stable order. Each entry carries a
 * `pendingKind` flag so the UI can show per-row dirty indicators.
 */
export interface EffectiveCustomDataEntry {
  key: string;
  valueBase64: string;
  byteLength: number;
  /** null → no pending edit; "set" → a pending set; "delete" → the
   *  row is staged for deletion and shouldn't render in the main
   *  list (callers typically filter these out). */
  pendingKind: null | "set" | "delete";
}

export function getEffectiveCustomData(
  map: EditMap,
  disk: readonly { key: string; valueBase64: string; byteLength: number }[],
): EffectiveCustomDataEntry[] {
  // Merge disk + pending creates, then filter out pending deletes for
  // the visible list. Caller can layer its own "deleted but not yet
  // saved" UI on top if wanted; the default surface is "what the
  // save will produce".
  const diskByKey = new Map(disk.map((e) => [e.key, e]));
  const pendingSetsByKey = new Map<
    string,
    Extract<EditPatch, { kind: "customDataSet" }>
  >();
  const pendingDeletesByKey = new Set<string>();
  for (const k in map) {
    const patch = map[k];
    if (!patch) continue;
    if (patch.kind === "customDataSet") {
      pendingSetsByKey.set(patch.key, patch);
    } else if (patch.kind === "customDataDelete") {
      pendingDeletesByKey.add(patch.key);
    }
  }
  const mergedKeys = new Set<string>([
    ...diskByKey.keys(),
    ...pendingSetsByKey.keys(),
  ]);
  const out: EffectiveCustomDataEntry[] = [];
  for (const key of mergedKeys) {
    if (pendingDeletesByKey.has(key)) continue;
    const pendingSet = pendingSetsByKey.get(key);
    if (pendingSet) {
      const byteLength = computeBase64ByteLength(pendingSet.valueBase64);
      out.push({
        key,
        valueBase64: pendingSet.valueBase64,
        byteLength,
        pendingKind: "set",
      });
    } else {
      const d = diskByKey.get(key)!;
      out.push({
        key,
        valueBase64: d.valueBase64,
        byteLength: d.byteLength,
        pendingKind: null,
      });
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/**
 * Byte length of a base64 payload without allocating a Buffer. Every
 * 4 base64 chars decode to 3 bytes, minus padding `=` chars.
 */
function computeBase64ByteLength(b64: string): number {
  if (b64.length === 0) return 0;
  const padding = (b64.endsWith("==") ? 2 : 0) + (b64.endsWith("=") ? 1 : 0);
  return Math.floor((b64.length * 3) / 4) - (padding === 3 ? 2 : padding);
}

// ─────────────────────────────────────────────────────────────────────
// Slice 10G — section hierarchy (create / rename / delete)
// ─────────────────────────────────────────────────────────────────────

/**
 * Monotonically-increasing per-session counter for `sectionCreate`
 * patch keys. Disk ids are positive integers; we use negative ids
 * here so there's no possible collision. The counter resets on
 * reload, which is fine — creates are flushed by save and the
 * subsequent openFile reload replaces the whole EditMap.
 */
let nextSectionCreateLocalId = -1;

function allocateSectionCreateLocalId(): number {
  const id = nextSectionCreateLocalId;
  nextSectionCreateLocalId -= 1;
  return id;
}

/** Map key for a `sectionCreate` patch — guaranteed unique. */
export function sectionCreateKey(localId: number): string {
  return `sectionCreate:${localId}`;
}
/** Map key for a `sectionRename` patch — one per section. */
export function sectionRenameKey(
  specKind: "workSpec" | "bdb",
  sectionId: number,
): string {
  return `sectionRename:${specKind}:${sectionId}`;
}
/** Map key for a `sectionDelete` patch — one per section. */
export function sectionDeleteKey(
  specKind: "workSpec" | "bdb",
  sectionId: number,
): string {
  return `sectionDelete:${specKind}:${sectionId}`;
}

/**
 * Stage a new section create. Returns the updated EditMap.
 *
 * `insertAfterSectionNo: null` = append after last sibling;
 * otherwise the new row lands at `insertAfterSectionNo + 1`.
 */
export function stageSectionCreate(
  map: EditMap,
  input: {
    specKind: "workSpec" | "bdb";
    specId: number;
    parentId: number | null;
    insertAfterSectionNo: number | null;
    heading: string;
  },
): EditMap {
  const localId = allocateSectionCreateLocalId();
  const mapKey = sectionCreateKey(localId);
  const next: Record<string, EditPatch> = { ...map };
  next[mapKey] = {
    kind: "sectionCreate",
    localId,
    specKind: input.specKind,
    specId: input.specId,
    parentId: input.parentId,
    insertAfterSectionNo: input.insertAfterSectionNo,
    heading: input.heading,
  };
  return next;
}

/**
 * Stage a heading rename for a disk-persisted section. Idempotent —
 * setting the same heading twice returns the same map. Passing a
 * heading that matches the original drops the patch entirely so the
 * dirty dot clears.
 */
export function stageSectionRename(
  map: EditMap,
  input: {
    specKind: "workSpec" | "bdb";
    sectionId: number;
    heading: string;
    originalHeading: string;
  },
): EditMap {
  const mapKey = sectionRenameKey(input.specKind, input.sectionId);
  if (input.heading === input.originalHeading) {
    if (!(mapKey in map)) return map;
    const next: Record<string, EditPatch> = { ...map };
    delete next[mapKey];
    return next;
  }
  const existing = map[mapKey];
  if (
    existing &&
    existing.kind === "sectionRename" &&
    existing.heading === input.heading
  ) {
    return map;
  }
  const next: Record<string, EditPatch> = { ...map };
  next[mapKey] = {
    kind: "sectionRename",
    specKind: input.specKind,
    sectionId: input.sectionId,
    heading: input.heading,
  };
  return next;
}

/**
 * Stage a delete for a disk-persisted section. Also removes any
 * pending rename on the same section (no point carrying it through
 * when the row is about to disappear).
 */
export function stageSectionDelete(
  map: EditMap,
  input: { specKind: "workSpec" | "bdb"; sectionId: number },
): EditMap {
  const deleteMapKey = sectionDeleteKey(input.specKind, input.sectionId);
  const renameMapKey = sectionRenameKey(input.specKind, input.sectionId);
  const existing = map[deleteMapKey];
  if (existing && existing.kind === "sectionDelete") {
    // Already staged — drop any pending rename and we're done.
    if (!(renameMapKey in map)) return map;
    const next: Record<string, EditPatch> = { ...map };
    delete next[renameMapKey];
    return next;
  }
  const next: Record<string, EditPatch> = { ...map };
  if (renameMapKey in next) delete next[renameMapKey];
  next[deleteMapKey] = {
    kind: "sectionDelete",
    specKind: input.specKind,
    sectionId: input.sectionId,
  };
  return next;
}

/** Drop a pending `sectionCreate` patch (e.g. undo before save). */
export function dropSectionCreate(map: EditMap, localId: number): EditMap {
  const mapKey = sectionCreateKey(localId);
  if (!(mapKey in map)) return map;
  const next: Record<string, EditPatch> = { ...map };
  delete next[mapKey];
  return next;
}

/**
 * Is the given section currently marked for deletion in the edit
 * buffer? Used by the section tree to tombstone it + its descendants.
 */
export function isSectionTombstoned(
  map: EditMap,
  specKind: "workSpec" | "bdb",
  sectionId: number,
): boolean {
  return sectionDeleteKey(specKind, sectionId) in map;
}

/**
 * Effective heading for a section: the pending rename's heading if
 * present, else the original.
 */
export function getEffectiveSectionHeading(
  map: EditMap,
  specKind: "workSpec" | "bdb",
  sectionId: number,
  originalHeading: string,
): string {
  const patch = map[sectionRenameKey(specKind, sectionId)];
  if (patch && patch.kind === "sectionRename") return patch.heading;
  return originalHeading;
}

/**
 * Return the ids of every section staged for deletion under the
 * given spec (useful for quick tombstone filtering of a section
 * array). Pure — caller memoizes if needed.
 */
export function stagedSectionDeleteIds(
  map: EditMap,
  specKind: "workSpec" | "bdb",
): ReadonlySet<number> {
  const out = new Set<number>();
  for (const k in map) {
    const patch = map[k];
    if (!patch) continue;
    if (patch.kind === "sectionDelete" && patch.specKind === specKind) {
      out.add(patch.sectionId);
    }
  }
  return out;
}

/**
 * Return the effective supplement body for a given master-section
 * link on a child, merging any pending edits with the on-disk value.
 *
 *   - if a `bdbSectionDelete` patch is pending → empty string
 *   - else if a `bdbSectionCreate` patch is pending → that body
 *   - else the passed-in original body (or empty string if null)
 */
export function getEffectiveBdbSupplementBody(
  map: EditMap,
  input: {
    bdbId: number;
    pfbbSectionId: number;
    existingSectionId: number | null;
    originalBody: string | null;
  },
): string {
  if (input.existingSectionId != null) {
    const dk = bdbSectionDeleteKey(input.existingSectionId);
    if (dk in map) return "";
  }
  const ck = bdbSectionCreateKey(input.bdbId, input.pfbbSectionId);
  const patch = map[ck];
  if (patch && patch.kind === "bdbSectionCreate") return patch.body;
  return input.originalBody ?? "";
}

/**
 * True if a supplement on this `(child BDB, master section)` pair
 * has any pending edit — either a create/upsert or a delete.
 */
export function isBdbSupplementEdited(
  map: EditMap,
  input: {
    bdbId: number;
    pfbbSectionId: number;
    existingSectionId: number | null;
  },
): boolean {
  if (bdbSectionCreateKey(input.bdbId, input.pfbbSectionId) in map) {
    return true;
  }
  if (
    input.existingSectionId != null &&
    bdbSectionDeleteKey(input.existingSectionId) in map
  ) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Flatten for IPC save
// ─────────────────────────────────────────────────────────────────────

const TARGET_ORDER: Record<EditRequest["target"], number> = {
  workSpec: 0,
  bdb: 1,
  cpTitle: 2,
  cpRow: 3,
  // Contract-related edits run last so saves always resolve section-level
  // work before touching project metadata. No functional impact today —
  // applyEdits runs everything in one transaction — but it makes the
  // deterministic order easier to reason about in logs and tests.
  contractRename: 4,
  workSpecContract: 5,
  // Project metadata sorts alongside the other update targets (it
  // runs in phase 1 inside applyEdits) but after contract renames
  // so logs read top-down from finest-grained → coarsest.
  project: 6,
  // Slice 10E — work-area + BDB metadata. Sort after the project
  // bucket so a multi-row save logs project first, then its container
  // children. Purely cosmetic; applyEdits doesn't depend on order.
  workSpecMetadata: 7,
  bdbMetadata: 8,
  // Slice 10F — control-plan metadata. Sorts after the BDB metadata
  // bucket so logs keep reading top-down (contract → workArea → BDB →
  // control plan).
  cpMetadata: 9,
  // 10I-followup gap 3 — CP section header updates sort right after
  // the CP metadata bucket so logs read top-down.
  cpHeaderUpdate: 9.5,
  // Slice 10H.7 — PFBB child supplement edits. Sort after the
  // other updates (so we keep "top-down" ordering project →
  // workArea → BDB → CP → BDB sections) but before container
  // deletes. Order within this bucket: creates before deletes, so
  // if the user creates a new supplement and then deletes it in
  // the same save (same pair), the flattener would have dropped
  // the create already — but if there's a create for one pair and
  // a delete for another, the create comes first. Purely cosmetic.
  bdbSectionCreate: 10,
  bdbSectionDelete: 11,
  // Slice 10I.b — file-wide custom_data upsert/delete. Sorts after
  // section edits so logs read "spec content first, metadata last";
  // applyEdits doesn't depend on order.
  customDataSet: 12,
  customDataDelete: 13,
  // Slice 10G — section hierarchy. Order within the bucket is
  // important: deletes first (so we free section_no slots before
  // any inserts come in), then renames (cosmetic — doesn't affect
  // other edits), then creates last so the insertAfter arithmetic
  // is against the post-delete state. Core also validates ids at
  // pre-check time, so stale references fail loudly.
  sectionDelete: 14,
  sectionRename: 15,
  sectionCreate: 16,
  // Buffered container deletes (Slice 6M) sort after updates so the
  // same-save "reassign work area → new contract, then delete old
  // contract" scenario goes through with the updates flushing first.
  // Core's applyEdits also partitions by phase internally, so this
  // ordering is belt-and-braces but makes log output readable.
  //
  // Within the delete bucket we go deepest-child → parent: control
  // plan, then BDB, then work area, then contract — so logs read
  // bottom-up through the hierarchy.
  deleteControlPlan: 16.5,
  deleteBdb: 17,
  deleteWorkArea: 18,
  deleteContract: 19,
};

/**
 * Flatten the map into the `EditRequest[]` shape main expects. The
 * output is sorted deterministically by (target, id…) so Save
 * requests are diffable in logs + tests.
 */
export function toEditRequestList(map: EditMap): EditRequest[] {
  const out: EditRequest[] = [];
  for (const key of Object.keys(map)) {
    const patch = map[key];
    if (!patch) continue;

    if (patch.kind === "body") {
      // Key is `${kind}:${id}`.
      const parts = key.split(":");
      const kind = parts[0];
      const id = Number(parts[1]);
      if ((kind !== "workSpec" && kind !== "bdb") || !Number.isInteger(id)) {
        continue;
      }
      out.push({
        target: kind as SectionKind,
        sectionId: id,
        body: patch.body,
      });
    } else if (patch.kind === "cpTitle") {
      const parts = key.split(":");
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) continue;
      out.push({ target: "cpTitle", controlPlanId: id, title: patch.title });
    } else if (patch.kind === "cpRow") {
      out.push({
        target: "cpRow",
        rowId: patch.rowId,
        field: patch.field,
        value: patch.value,
      });
    } else if (patch.kind === "contract") {
      // Key is `contract:<id>`.
      const parts = key.split(":");
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) continue;
      const req: Extract<EditRequest, { target: "contractRename" }> = {
        target: "contractRename",
        id,
      };
      if (patch.contractCode !== undefined)
        req.contractCode = patch.contractCode;
      if (patch.contractName !== undefined)
        req.contractName = patch.contractName;
      out.push(req);
    } else if (patch.kind === "wsContract") {
      // Key is `wsContract:<workSpecId>`.
      const parts = key.split(":");
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) continue;
      out.push({
        target: "workSpecContract",
        workSpecId: id,
        contractId: patch.contractId,
      });
    } else if (patch.kind === "delete") {
      // Map the entity kind onto the four core delete variants.
      // Key isn't parsed — the patch carries its own id + entityKind.
      if (patch.entityKind === "contract") {
        out.push({ target: "deleteContract", id: patch.id });
      } else if (patch.entityKind === "workSpec") {
        out.push({ target: "deleteWorkArea", id: patch.id });
      } else if (patch.entityKind === "controlPlan") {
        // FIX-DelCpStrike 2026-05-11. Buffered CP delete — core
        // cascades rows + headers + CP + clears the BDB slot.
        out.push({ target: "deleteControlPlan", id: patch.id });
      } else {
        // FIX-DelBdbCps — forward the optional deleteControlPlans
        // flag through to core's applyEdits BDB-delete loop.
        out.push({
          target: "deleteBdb",
          id: patch.id,
          ...(patch.deleteControlPlans ? { deleteControlPlans: true } : {}),
        });
      }
    } else if (patch.kind === "project") {
      const req: Extract<EditRequest, { target: "project" }> = {
        target: "project",
        projectGuid: patch.projectGuid,
      };
      if (patch.name !== undefined) req.name = patch.name;
      if (patch.projectNumber !== undefined)
        req.projectNumber = patch.projectNumber;
      if (patch.builder !== undefined) req.builder = patch.builder;
      if (patch.molioReferencelistDate !== undefined) {
        req.molioReferencelistDate = patch.molioReferencelistDate;
      }
      // An entirely-cleaned patch would have been dropped already
      // (see `projectPatchIsClean`), so at least one field is set.
      out.push(req);
    } else if (patch.kind === "wsMeta") {
      const req: Extract<EditRequest, { target: "workSpecMetadata" }> = {
        target: "workSpecMetadata",
        id: patch.id,
      };
      if (patch.workAreaCode !== undefined)
        req.workAreaCode = patch.workAreaCode;
      if (patch.workAreaName !== undefined)
        req.workAreaName = patch.workAreaName;
      if (patch.workAreaType !== undefined)
        req.workAreaType = patch.workAreaType;
      if (patch.createdBy !== undefined) req.createdBy = patch.createdBy;
      if (patch.createdByOrganization !== undefined) {
        req.createdByOrganization = patch.createdByOrganization;
      }
      if (patch.revision !== undefined) req.revision = patch.revision;
      if (patch.revisionDate !== undefined)
        req.revisionDate = patch.revisionDate;
      if (patch.issueDate !== undefined) req.issueDate = patch.issueDate;
      if (patch.reviewedBy !== undefined) req.reviewedBy = patch.reviewedBy;
      if (patch.approvedBy !== undefined) req.approvedBy = patch.approvedBy;
      out.push(req);
    } else if (patch.kind === "bdbMeta") {
      const req: Extract<EditRequest, { target: "bdbMetadata" }> = {
        target: "bdbMetadata",
        id: patch.id,
      };
      if (patch.name !== undefined) req.name = patch.name;
      if (patch.isPfbb !== undefined) req.isPfbb = patch.isPfbb;
      if (patch.createdBy !== undefined) req.createdBy = patch.createdBy;
      if (patch.createdByOrganization !== undefined) {
        req.createdByOrganization = patch.createdByOrganization;
      }
      if (patch.revision !== undefined) req.revision = patch.revision;
      if (patch.revisionDate !== undefined)
        req.revisionDate = patch.revisionDate;
      if (patch.issueDate !== undefined) req.issueDate = patch.issueDate;
      if (patch.reviewedBy !== undefined) req.reviewedBy = patch.reviewedBy;
      if (patch.approvedBy !== undefined) req.approvedBy = patch.approvedBy;
      out.push(req);
    } else if (patch.kind === "cpMeta") {
      const req: Extract<EditRequest, { target: "cpMetadata" }> = {
        target: "cpMetadata",
        id: patch.id,
      };
      if (patch.revision !== undefined) req.revision = patch.revision;
      if (patch.revisionDate !== undefined)
        req.revisionDate = patch.revisionDate;
      // 10I-followup gap 2 — number_text is NOT NULL in the schema,
      // so a `null` patch value means "clear" → empty string.
      if (patch.numberText !== undefined) {
        req.numberText = patch.numberText === null ? "" : patch.numberText;
      }
      out.push(req);
    } else if (patch.kind === "cpHeaderUpdate") {
      const req: Extract<EditRequest, { target: "cpHeaderUpdate" }> = {
        target: "cpHeaderUpdate",
        headerId: patch.headerId,
      };
      if (patch.header !== undefined) req.header = patch.header;
      if (patch.headerNo !== undefined) req.headerNo = patch.headerNo;
      out.push(req);
    } else if (patch.kind === "bdbSectionCreate") {
      out.push({
        target: "bdbSectionCreate",
        bdbId: patch.bdbId,
        pfbbSectionId: patch.pfbbSectionId,
        sectionNo: patch.sectionNo,
        body: patch.body,
      });
    } else if (patch.kind === "bdbSectionDelete") {
      out.push({
        target: "bdbSectionDelete",
        sectionId: patch.sectionId,
      });
    } else if (patch.kind === "customDataSet") {
      out.push({
        target: "customDataSet",
        key: patch.key,
        valueBase64: patch.valueBase64,
      });
    } else if (patch.kind === "customDataDelete") {
      out.push({
        target: "customDataDelete",
        key: patch.key,
      });
    } else if (patch.kind === "sectionCreate") {
      out.push({
        target: "sectionCreate",
        specKind: patch.specKind,
        specId: patch.specId,
        parentId: patch.parentId,
        insertAfterSectionNo: patch.insertAfterSectionNo,
        heading: patch.heading,
      });
    } else if (patch.kind === "sectionRename") {
      out.push({
        target: "sectionRename",
        specKind: patch.specKind,
        sectionId: patch.sectionId,
        heading: patch.heading,
      });
    } else if (patch.kind === "sectionDelete") {
      out.push({
        target: "sectionDelete",
        specKind: patch.specKind,
        sectionId: patch.sectionId,
      });
    }
  }

  out.sort((a, b) => {
    const oa = TARGET_ORDER[a.target];
    const ob = TARGET_ORDER[b.target];
    if (oa !== ob) return oa - ob;

    if (
      (a.target === "workSpec" || a.target === "bdb") &&
      (b.target === "workSpec" || b.target === "bdb")
    ) {
      return a.sectionId - b.sectionId;
    }
    if (a.target === "cpTitle" && b.target === "cpTitle") {
      return a.controlPlanId - b.controlPlanId;
    }
    if (a.target === "cpRow" && b.target === "cpRow") {
      if (a.rowId !== b.rowId) return a.rowId - b.rowId;
      return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
    }
    if (a.target === "contractRename" && b.target === "contractRename") {
      return a.id - b.id;
    }
    if (a.target === "workSpecContract" && b.target === "workSpecContract") {
      return a.workSpecId - b.workSpecId;
    }
    if (a.target === "workSpecMetadata" && b.target === "workSpecMetadata") {
      return a.id - b.id;
    }
    if (a.target === "bdbMetadata" && b.target === "bdbMetadata") {
      return a.id - b.id;
    }
    if (a.target === "cpMetadata" && b.target === "cpMetadata") {
      return a.id - b.id;
    }
    if (
      (a.target === "deleteBdb" ||
        a.target === "deleteWorkArea" ||
        a.target === "deleteContract") &&
      a.target === b.target
    ) {
      return a.id - (b as { id: number }).id;
    }
    return 0;
  });
  return out;
}

/**
 * Back-compat: Slice 6A/B call-sites only produced section-body edits.
 * New code should call `toEditRequestList` — this helper just filters
 * to the section shapes for any remaining callers.
 */
export function toSectionEditList(
  map: EditMap,
): Array<{ target: SectionKind; sectionId: number; body: string }> {
  return toEditRequestList(map).flatMap((e) =>
    e.target === "workSpec" || e.target === "bdb"
      ? [{ target: e.target, sectionId: e.sectionId, body: e.body }]
      : [],
  );
}
