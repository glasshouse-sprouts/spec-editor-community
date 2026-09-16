/**
 * Shared IPC contract between main, preload and renderer.
 *
 * Only plain JSON-serializable data crosses the IPC bridge — no Buffers,
 * no class instances. The main process opens a .moliospec via the core
 * package, reads everything needed for the UI, closes the handle, then
 * returns the payload. This matches the user's explicit choice:
 * close-after-read skeleton.
 *
 * Attachment binary blobs are deliberately excluded from the payload to
 * keep it serializable and reasonably sized. A later IPC channel will
 * stream individual attachment bytes when needed.
 */

import type { WorkAreaContractMapRow } from "./defaultsCsv.js";

export interface ProjectInfo {
  projectGuid: string;
  name: string;
  projectNumber: string;
  builder: string | null;
  createdBySystem: string;
  createdDate: string;
  modifiedDate: string | null;
  moliioReferencelistDate: string | null;
}

/**
 * Metadata about the three "reference" links a spec can hold.
 * All four fields are nullable because a freshly-created spec won't have
 * them set until the user picks something in Molio's reference service.
 *
 * - basisGuid / basisRevisionGuid → "Aftalegrundlag"; points at a specific
 *   revision of a Molio specification.
 * - paradigmGuid / paradigmRevisionGuid → "Paradigme"; template this spec
 *   was created from.
 * - referencelistArea / referencelistAreaDate → "Referenceliste"; area
 *   code (e.g. "2.5") + the date of the referenced list.
 *
 * We ship these verbatim to the renderer for display. Resolving them to
 * live Molio content is a Phase 7 job (Molio API wiring).
 */
export interface ReferenceLinks {
  basisGuid: string | null;
  basisRevisionGuid: string | null;
  paradigmGuid: string | null;
  paradigmRevisionGuid: string | null;
  referencelistArea: string | null;
  referencelistAreaDate: string | null;
}

export interface WorkSpecInfo {
  id: number;
  workAreaCode: string | null;
  workAreaName: string;
  /** 0=Arbejdsbeskrivelse, 1=FaellesBeskrivelse, 2=ParadigmeForArbejdsbeskrivelse. */
  workAreaType: number;
  revision: string | null;
  revisionDate: string | null;
  /**
   * The contract this work area is assigned to (`contracts.id`), or null
   * when it has no contract yet. Contracts are a 01.00.04+ concept; the
   * schema leaves the column nullable for older or in-progress projects.
   */
  contractId: number | null;
  refs: ReferenceLinks;

  // ── Editable metadata (Slice 10E). Nullable text columns. ──────────
  createdBy: string | null;
  createdByOrganization: string | null;
  issueDate: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;

  // ── Locked Molio-sourced metadata (Slice 10E accordion). ───────────
  /** Everything Molio owns — rendered read-only. */
  locked: {
    molioSpecRevisionNo: string | null;
    molioSpecRevisionDate: string | null;
  };
}

/**
 * One project contract. Both code and name are nullable because the
 * schema allows contracts that only have one of the two set — e.g. a
 * freshly-created contract while the user is still filling in details.
 */
export interface ContractInfo {
  id: number;
  contractCode: string | null;
  contractName: string | null;
}

export interface BdbInfo {
  id: number;
  name: string;
  /** work_spec_id this BDB belongs under, or null if unassigned. */
  workSpecId: number | null;
  isPfbb: boolean;
  /**
   * If this BDB subscribes to (is a "child" of) a PFBB master, the id
   * of that master. Null for regular BDBs and for master PFBBs themselves.
   * See `0000 Background info/pfbb_investigation.md` §1–§2.
   */
  pfbbId: number | null;
  revision: string | null;
  revisionDate: string | null;
  /**
   * Control plan IDs this BDB references. Up to two — one for "design",
   * one for "production". IDs that don't resolve to a known control plan
   * are omitted. Order: [design, production] when both are present.
   */
  controlPlanIds: number[];
  refs: ReferenceLinks;

  // ── Editable metadata (Slice 10E). Nullable text columns. ──────────
  createdBy: string | null;
  createdByOrganization: string | null;
  issueDate: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;

  // ── Locked Molio-sourced metadata (Slice 10E accordion). ───────────
  locked: {
    molioSpecRevisionNo: string | null;
    molioSpecRevisionDate: string | null;
    controlplanDesignId: string | null;
    controlplanProductionId: string | null;
    commonControlplanDesignGuid: string | null;
    commonControlplanProductionGuid: string | null;
    molioConstructionElementSpecGuid: string | null;
    molioConstructionElementSpecRevisionGuid: string | null;
    molioConstructionElementSpecRevisionNo: string | null;
    molioConstructionElementSpecRevisionDate: string | null;
  };
}

export interface ControlPlanInfo {
  id: number;
  numberText: string;
  title: string;
  controlPlanType: number;
  /**
   * Slice 10F additions — both nullable in the Molio schema. Surfaced
   * here so the renderer can show effective values in the tree and
   * pre-fill the Edit metadata modal synchronously.
   */
  revision: string | null;
  revisionDate: string | null;
  /**
   * #255 — true when this control plan has no meaningful content: no
   * rows, or only blank skeleton rows (a section number but nothing
   * else). Computed in the main process via `controlPlanIsEmpty` so the
   * sidebar can mark + hide it without threading the row map down to the
   * leaf. Optional: absent payloads (older builders / test fixtures) are
   * treated as not-empty.
   */
  isEmpty?: boolean;
}

/**
 * One group header inside a control plan. These chunk the detail rows
 * into visual categories (e.g. "1. Udførelse", "2. Kvalitetskontrol").
 */
export interface ControlPlanHeaderData {
  id: number;
  /** Display label — e.g. "Udførelse". */
  header: string;
  /** Display number — e.g. "1", "2", "2.1". */
  headerNo: string;
}

/**
 * One row inside a control plan. Matches the `control_plan_section`
 * columns from the Molio schema. `headerId` links it back to the group
 * it belongs under; `controlType` mirrors core's `ControlType` enum
 * (0 = not selected, 1 = E, 2 = U, 3 = T).
 */
export interface ControlPlanRowData {
  id: number;
  headerId: number;
  controlType: number;
  sectionNo: string;
  subject: string;
  reference: string;
  method: string;
  quantity: string;
  time: string;
  acceptanceCriteria: string;
  documentation: string;
  controlLevel: string;
  sampleLevel: string;
}

export interface SectionData {
  id: number;
  sectionNo: number;
  heading: string;
  /** HTML body as stored in the file. Never edited here. */
  body: string;
  parentId: number | null;
  /**
   * Slice 10H.7 — on a PFBB child's section row, this points at the
   * master section it supplements (a `construction_element_spec_section.id`
   * on the master BDB). `null` on master rows and on regular BDB rows.
   * Used by the merged child view to join master + supplement sections
   * by this id.
   */
  pfbbSectionId: number | null;
}

/**
 * One row from the `custom_data` table — a file-wide key/value store
 * the Molio schema provides for extensions (plugins, tool-specific
 * prefs, NBS/NTI/Glasshouse sidecars, etc). Slice 10I surfaces these
 * read-only in the Edit Project modal so power users can see what's
 * in their file; the save path already preserves them byte-for-byte
 * via the SQLite copy mechanism.
 *
 * `value` is base64-encoded because the underlying column is BLOB —
 * values may be binary (serialised plugin state, images, etc.), and
 * Electron's IPC can't carry raw Node Buffers cleanly. The renderer
 * decodes lazily when it wants to display the value as text.
 */
export interface CustomDataEntryInfo {
  key: string;
  /** Base64-encoded blob bytes. Empty string when the value is zero-length. */
  valueBase64: string;
  /** Raw byte length before base64 — shown in the UI as a size label. */
  byteLength: number;
}

/**
 * Set when the file that was opened had to be upgraded from an older
 * schema (Task 1 / M1). Null for every ordinary file.
 *
 * Two things follow from a non-null value, and both are required:
 *   - the user is shown a dialog they have to click away, because the
 *     conversion is irreversible;
 *   - Save is routed to "Save as". The original file is never
 *     overwritten - it is the user's only copy of the old format.
 */
export interface SchemaUpgradeInfo {
  /** The version the file on disk was written in, e.g. "01.00.00". */
  fromVersion: string;
  /** What the upgraded copy is stamped as, i.e. "01.00.04". */
  toVersion: string;
  /**
   * True for 01.00.00 files, where control plans hang off the work area
   * instead of the building element specification. Those links are not
   * carried over - see the migration module for why guessing is worse
   * than dropping them.
   */
  losesControlPlanLinks: boolean;
  /** How many work areas lost a control-plan link. May be 0. */
  droppedControlPlanLinks: number;
}

export interface FilePayload {
  path: string;
  dbVersion: string;
  /**
   * Non-null when this payload came out of a schema upgrade. See
   * `SchemaUpgradeInfo`. `dbVersion` above already reports the NEW
   * version, because that is what the renderer is holding; the old one
   * is in `schemaUpgrade.fromVersion`.
   */
  schemaUpgrade: SchemaUpgradeInfo | null;
  /**
   * Last-modified time of the .moliospec file on disk, in "ms since Unix
   * epoch" (as returned by `fs.stat().mtimeMs`). The renderer stores this
   * as its "expected mtime" and ships it back to the main process on
   * save so we can detect if another program has written the file since
   * we loaded it. See dirtyState.detectConflict.
   */
  mtimeMs: number;
  project: ProjectInfo | null;
  workSpecs: WorkSpecInfo[];
  bdbs: BdbInfo[];
  controlPlans: ControlPlanInfo[];
  /**
   * Project contracts. Empty when the file is on an older schema that
   * doesn't have the `contracts` table, or when the user hasn't created
   * any yet. See Slice 6I.
   */
  contracts: ContractInfo[];
  /** work_spec_id → its sections, ordered by section_no. */
  sectionsByWorkSpec: Record<number, SectionData[]>;
  /** construction_element_spec_id → its sections, ordered by section_no. */
  sectionsByBdb: Record<number, SectionData[]>;
  /** control_plan_id → its group headers, ordered by headerNo. */
  cpHeadersByPlan: Record<number, ControlPlanHeaderData[]>;
  /** control_plan_id → its rows (all headers together), ordered by sectionNo. */
  cpRowsByPlan: Record<number, ControlPlanRowData[]>;
  /**
   * Attachment summaries (Slice 10K). Bytes are NOT included — the
   * list only carries id, name, mime, size, sha1, type and parent
   * workSpecId. When the UI needs bytes it will fetch them via a
   * separate IPC (deferred to Slice 10L / "open attachment").
   *
   * Sorted by id so the order matches the `order by id` core read.
   */
  attachments: AttachmentInfo[];
  /**
   * `custom_data` rows (Slice 10I). Usually empty — most files don't
   * use the table. Surfaced read-only via the Debug accordion on
   * the Edit Project modal so users can see what third-party tools
   * have stored alongside their spec.
   */
  customData: CustomDataEntryInfo[];
}

/**
 * One edit applied during Save. Nine shapes:
 *
 *  - `workSpec` / `bdb`: update a section body HTML. Existing behaviour.
 *  - `cpRow`: update one column on a control_plan_section row. `field`
 *    is a camelCase key matching ControlPlanRowData's editable columns.
 *    For `controlType` the value is the integer (0..3) as a string —
 *    main coerces to number before binding.
 *  - `cpTitle`: rename a control plan (the title shown in the tree + CP
 *    view header).
 *  - `contractRename`: update one or both of a contract's code/name.
 *    Fields left `undefined` are not touched. `null` is a valid value
 *    — it clears the column — while `undefined` means "no change".
 *  - `workSpecContract`: assign a work area to a contract, or clear the
 *    link by passing `null`. Moves the work area in the sidebar tree.
 *  - `deleteContract` / `deleteWorkArea` / `deleteBdb` (Slice 6M):
 *    buffered container deletes. These are applied in-transaction by
 *    core.applyEdits in a deterministic phase order (updates first,
 *    then BDB deletes → work-area deletes → contract deletes). A
 *    contract delete inside the same batch as a `workSpecContract`
 *    reassignment works because the reassignment runs first, which
 *    can clear the last ref on the contract.
 *
 * The renderer builds one array of these for each Save invocation.
 */
export type EditRequest =
  | { target: "workSpec"; sectionId: number; body: string }
  | { target: "bdb"; sectionId: number; body: string }
  | {
      target: "cpRow";
      rowId: number;
      field: CpRowEditableField;
      value: string;
    }
  | { target: "cpTitle"; controlPlanId: number; title: string }
  | {
      target: "contractRename";
      id: number;
      contractCode?: string | null;
      contractName?: string | null;
    }
  | {
      target: "workSpecContract";
      workSpecId: number;
      contractId: number | null;
    }
  | { target: "deleteContract"; id: number }
  | { target: "deleteWorkArea"; id: number }
  | {
      target: "deleteBdb";
      id: number;
      /**
       * FIX-DelBdbCps 2026-05-11. When true, also hard-delete any
       * attached control plan rows + headers + CP rows alongside
       * the BDB. When false / omitted, CPs survive as unlinked.
       */
      deleteControlPlans?: boolean;
    }
  /**
   * FIX-DelCpStrike 2026-05-11. Buffered control-plan delete. The
   * dialog now stages the delete in the edit buffer (strikethrough
   * in sidebar, restorable until Save) instead of calling
   * `deleteControlPlan` directly. On apply we cascade rows +
   * headers + CP + NULL the BDB slot column.
   */
  | { target: "deleteControlPlan"; id: number }
  /**
   * Slice 10D — update project metadata. Every field is optional:
   * `undefined` means "don't touch", `null` clears a nullable
   * column. `name` and `projectNumber` are NOT NULL in the schema
   * so their values are always `string`.
   */
  | {
      target: "project";
      projectGuid: string;
      name?: string;
      projectNumber?: string;
      builder?: string | null;
      molioReferencelistDate?: string | null;
    }
  /**
   * Slice 10E — update work-area (work_spec) metadata. Same
   * `undefined` / `null` / plain-value semantics as `project`.
   * `workAreaName` and `workAreaType` are NOT NULL; the others
   * are nullable. `contract_id` is NOT included here — it is
   * already editable via the `workSpecContract` variant that
   * powers the "Move to contract…" action.
   */
  | {
      target: "workSpecMetadata";
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
  /**
   * Slice 10E — update BDB (construction_element_spec) metadata.
   * `name` is NOT NULL; `isPfbb` is a 0/1 integer. `work_spec_id`
   * is NOT included — it is edited via "Move to specification…".
   */
  | {
      target: "bdbMetadata";
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
  /**
   * Slice 10F — update control-plan metadata. Only `revision` and
   * `revisionDate` are carried here; the Molio `control_plan` schema
   * has no reviewed_by / approved_by / issue_date columns. `title`
   * continues to use the existing `cpTitle` variant, so inline table
   * edits and the modal don't overlap on the same slot.
   */
  | {
      target: "cpMetadata";
      id: number;
      revision?: string | null;
      revisionDate?: string | null;
      /** 10I-followup audit gap 2 — `control_plan.number_text`. */
      numberText?: string;
    }
  /** 10I-followup audit gap 3 — update a control_plan_section_header
   *  row's heading text and/or number string. */
  | {
      target: "cpHeaderUpdate";
      headerId: number;
      header?: string;
      headerNo?: string;
    }
  /**
   * Slice 10H.7 — create a PFBB child supplement section. On apply,
   * INSERTs (or UPDATEs-in-place if a row with the same `(bdbId,
   * pfbbSectionId)` pair already exists) a
   * `construction_element_spec_section` row on the child BDB,
   * pointing back at the master via `pfbb_section_id`.
   */
  | {
      target: "bdbSectionCreate";
      bdbId: number;
      pfbbSectionId: number;
      sectionNo: string;
      body: string;
    }
  /**
   * Slice 10H.7 — delete a PFBB child supplement section by id.
   * Staged when the user clears a supplement to empty or explicitly
   * removes it.
   */
  | {
      target: "bdbSectionDelete";
      sectionId: number;
    }
  /**
   * Slice 10I.b — upsert a file-wide `custom_data` row. `key` is the
   * primary key in the table; values are BLOB so the renderer sends
   * them as base64 text (main decodes to a Buffer before binding).
   */
  | {
      target: "customDataSet";
      key: string;
      valueBase64: string;
    }
  /** Slice 10I.b — delete a `custom_data` row by key. Idempotent. */
  | {
      target: "customDataDelete";
      key: string;
    }
  /**
   * Slice 10G — create a new section. `parentId: null` means root
   * level. `insertAfterSectionNo: null` appends; otherwise siblings
   * with `section_no > insertAfterSectionNo` are renumbered +1 and
   * the new row lands at `insertAfterSectionNo + 1`.
   */
  | {
      target: "sectionCreate";
      specKind: "workSpec" | "bdb";
      specId: number;
      parentId: number | null;
      insertAfterSectionNo: number | null;
      heading: string;
    }
  /** Slice 10G — rename a section's heading. */
  | {
      target: "sectionRename";
      specKind: "workSpec" | "bdb";
      sectionId: number;
      heading: string;
    }
  /** Slice 10G — delete a section and its entire subtree. */
  | {
      target: "sectionDelete";
      specKind: "workSpec" | "bdb";
      sectionId: number;
    };

/**
 * Backward-compatible alias. The renderer's Slice-6A code emits these;
 * keeping the name means no forced rename across the codebase while we
 * migrate state and UI to the richer `EditRequest`.
 */
export type SectionEdit = Extract<EditRequest, { target: "workSpec" | "bdb" }>;

/** Editable columns on control_plan_section. Keep in sync with core. */
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

/**
 * Save request sent from renderer to main.
 *
 * `edits` may be empty — a no-edit save still round-trips the file
 * (same open → saveAs → close as Slice 6A). When non-empty, main runs
 * `core.applyEdits(handle, edits)` inside a transaction before saveAs,
 * so either everything is written or nothing is.
 */
export interface SaveFileRequest {
  path: string;
  /**
   * The mtime the renderer last saw (from load, or the previous save).
   * Main compares against current disk mtime; if they differ and
   * `force` is false, main returns a conflict result rather than writing.
   */
  storedMtimeMs: number;
  /** When true, skip the conflict check and overwrite unconditionally. */
  force: boolean;
  /**
   * Edits to apply before saving. May be empty. Accepts any shape of
   * `EditRequest` — the field name stays `edits` to avoid breaking
   * renderer code written during Slice 6A.
   */
  edits: EditRequest[];
}

/**
 * Save result returned from main to renderer.
 *
 *   - "saved"     write succeeded; `mtimeMs` is the new on-disk mtime that
 *                 the renderer should store as its new baseline.
 *   - "conflict"  file on disk was modified since we loaded it; renderer
 *                 surfaces the Cancel / Overwrite / Reload dialog.
 *                 `currentMtimeMs` is what main observed just now.
 *   - "missing"   file no longer exists at `path`. Renderer surfaces an
 *                 error; nothing was written.
 */
export type SaveFileResult =
  | { kind: "saved"; mtimeMs: number }
  | { kind: "conflict"; currentMtimeMs: number }
  | { kind: "missing" }
  /**
   * The file on disk is in a pre-01.00.03 format. Saving it in place
   * would silently convert the user's only copy of the old file, so the
   * main process refuses and the renderer routes to "Save as" instead.
   *
   * This is the enforcement point, not the reminder: the renderer
   * already routes on `FilePayload.schemaUpgrade`, and this makes sure
   * an overwrite cannot happen even if it forgets.
   */
  | { kind: "needsSaveAs"; fromVersion: string };

/**
 * Control-plan lifecycle operations.
 *
 * These are "immediate persistence" ops: each call opens the file, runs
 * the op, saveAs, and closes. The renderer gets back any newly-created
 * IDs plus the file's new mtime so it can refresh its cached mtime
 * (used by conflict detection during subsequent Saves).
 *
 * The renderer typically follows each call with a full re-load of the
 * file payload so the tree and CP views pick up the new row graph.
 *
 * Conflict handling: these all use the same `storedMtimeMs` + `force`
 * shape as SaveFileRequest so the UI can route conflicts through the
 * same Cancel/Overwrite/Reload dialog.
 */
export type CpOpConflict = { kind: "conflict"; currentMtimeMs: number };
export type CpOpMissing = { kind: "missing" };

export interface CpOpBaseRequest {
  path: string;
  storedMtimeMs: number;
  force: boolean;
}

export interface CreateCpRequest extends CpOpBaseRequest {
  bdbId: number;
  slot: "design" | "production";
  title: string;
  /** Optional. Defaults to "" — the schema's NOT-NULL default. */
  numberText?: string;
}
export type CreateCpResult =
  | {
      kind: "ok";
      controlPlanId: number;
      headerId: number | null;
      rowId: number | null;
      mtimeMs: number;
    }
  | CpOpConflict
  | CpOpMissing;

export interface DeleteCpRequest extends CpOpBaseRequest {
  controlPlanId: number;
}
export type DeleteCpResult =
  | { kind: "ok"; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * Clone an existing CP into the chosen BDB slot (Slice 6N).
 *
 * The new CP's `control_plan_type` is derived from `slot` — the caller
 * picks Design or Production explicitly; the source CP's type is just a
 * hint that the UI uses to pre-select the slot radio.
 */
export interface DuplicateCpRequest extends CpOpBaseRequest {
  /** The CP to clone. Can live under any BDB in the project. */
  sourceCpId: number;
  /** The BDB that will own the new CP. */
  bdbId: number;
  slot: "design" | "production";
  /** Display title for the new CP. */
  title: string;
  /** Optional. Defaults to the source CP's own number_text. */
  numberText?: string;
}
export type DuplicateCpResult =
  | {
      kind: "ok";
      controlPlanId: number;
      clonedHeaderCount: number;
      clonedRowCount: number;
      mtimeMs: number;
    }
  | CpOpConflict
  | CpOpMissing;

/**
 * Move an existing CP under a different BDB (Slice 6O.3).
 *
 * Slot is NOT a caller decision here — core picks design or production
 * from the CP's own `control_plan_type`. If the target BDB's matching
 * slot is already filled by a different CP, the call fails with an
 * explanatory error (the renderer surfaces it as a blocker dialog —
 * see Tore's UX choice in the 6O thread).
 *
 * Homeless CPs (not currently referenced by any BDB) are supported;
 * `previousBdbId` just comes back null.
 */
export interface MoveCpRequest extends CpOpBaseRequest {
  sourceCpId: number;
  targetBdbId: number;
}
export type MoveCpResult =
  | {
      kind: "ok";
      /** Which slot on the target BDB received the CP ("design" | "production"). */
      slot: "design" | "production";
      /** The BDB the CP used to live under — null if it was homeless. */
      previousBdbId: number | null;
      previousSlot: "design" | "production" | null;
      mtimeMs: number;
    }
  /**
   * The target BDB's matching slot is already filled by a different CP.
   * The renderer surfaces the error message to the user — the move is
   * rejected, nothing was written.
   */
  | { kind: "slot-occupied"; message: string }
  | CpOpConflict
  | CpOpMissing;

export interface AddCpRowRequest extends CpOpBaseRequest {
  controlPlanId: number;
  headerId: number;
  sectionNo?: string;
}
export type AddCpRowResult =
  | { kind: "ok"; rowId: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

export interface DeleteCpRowRequest extends CpOpBaseRequest {
  rowId: number;
}
export type DeleteCpRowResult =
  | { kind: "ok"; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

export interface AddCpHeaderRequest extends CpOpBaseRequest {
  controlPlanId: number;
  header: string;
  headerNo: string;
}
export type AddCpHeaderResult =
  | { kind: "ok"; headerId: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

export interface DeleteCpHeaderRequest extends CpOpBaseRequest {
  headerId: number;
}
export type DeleteCpHeaderResult =
  | { kind: "ok"; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * Duplicate a construction-element specification (BDB) with all its
 * sections. See core.duplicateBdb for the copy semantics (attachments
 * skipped, references preserved, identity GUIDs + CP links cleared).
 */
export interface DuplicateBdbRequest extends CpOpBaseRequest {
  bdbId: number;
  /** Optional explicit name for the copy; defaults to `<orig> (copy)`. */
  newName?: string;
  /**
   * When true, also deep-copy each attached control plan and link
   * the new CPs to the duplicate BDB. See core.duplicateBdb's
   * `includeControlPlans` doc for the full semantics. Defaults to
   * false on the wire; the UI's Duplicate BDB dialog defaults the
   * checkbox to true.
   */
  includeControlPlans?: boolean;
}
export type DuplicateBdbResult =
  | { kind: "ok"; newBdbId: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * Create a PFBB "child" (subscriber) BDB that points at a PFBB master
 * (Slice 10H.3). See core.createPfbbChild for validation and the exact
 * column-copy rules. The UI (Slice 10H.5) is expected to have done a
 * friendlier precheck before calling this — the core writer's throws
 * are the safety net, not the primary UX.
 */
export interface CreatePfbbChildRequest extends CpOpBaseRequest {
  /** Id of the PFBB master (`is_pfbb=1`, `pfbb_id` null) to subscribe to. */
  masterId: number;
  /** Target work_spec (must not be the master's own work_spec). */
  targetWorkSpecId: number;
  /** Display name for the new child. Required; trimmed server-side. */
  name: string;
}
export type CreatePfbbChildResult =
  | { kind: "ok"; newBdbId: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * Migrate orphan PFBB masters to the virtual "Projektfælles" work_spec
 * (Slice 10H.6b). Triggered by the on-open banner when the renderer
 * detects masters living in regular work areas — "Move them now" sends
 * this request.
 *
 * The writer is idempotent: it re-points every `is_pfbb=1` master whose
 * `work_spec_id` is not already the virtual row, creating the virtual
 * row first if missing. If there are zero orphans, nothing is written
 * and the file's mtime doesn't change.
 */
export interface MigrateOrphanPfbbMastersRequest extends CpOpBaseRequest {}
export type MigrateOrphanPfbbMastersResult =
  | {
      kind: "ok";
      /** Count of BDBs whose `work_spec_id` was re-pointed. */
      movedCount: number;
      /** Ids of the moved BDBs, sorted ascending. Empty when 0 moved. */
      movedBdbIds: number[];
      /** The virtual work_spec's id after the call, or -1 if none needed. */
      virtualWorkSpecId: number;
      /** `true` if this call created the virtual row. */
      createdVirtual: boolean;
      mtimeMs: number;
    }
  | CpOpConflict
  | CpOpMissing;

/**
 * Contract lifecycle ops. Same "immediate persistence" envelope as the
 * CP / BDB ops above: open → mutate → saveAs → close, with conflict
 * detection via `storedMtimeMs` + `force`.
 *
 * Rename and work-area reassignment go through the normal Save pipeline
 * as EditRequest entries — they don't need their own IPC channels.
 */
export interface CreateContractRequest extends CpOpBaseRequest {
  contractCode?: string | null;
  contractName?: string | null;
}
export type CreateContractResult =
  | { kind: "ok"; contractId: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * #250 — create the user's default contracts (from the editable
 * `contracts.csv`) in the open project. Contracts whose code already
 * exists are skipped, so it's safe to run more than once. `created` is
 * how many were actually added.
 */
export type SeedDefaultContractsRequest = CpOpBaseRequest;
export type SeedDefaultContractsResult =
  | { kind: "ok"; created: number; mtimeMs: number }
  | CpOpConflict
  | CpOpMissing;

/**
 * #250 (2D) — open / reset the user's editable default CSVs. `which`
 * picks the contracts list or the work-area->contract mapping. "open"
 * launches the file in the OS default app; "reset" deletes the user copy
 * and restores the shipped default.
 */
export type DefaultsFileKind = "contracts" | "mapping";
export interface DefaultsFileRequest {
  which: DefaultsFileKind;
}
export type DefaultsFileResult = { ok: true } | { ok: false; error?: string };

export interface DeleteContractRequest extends CpOpBaseRequest {
  contractId: number;
}
export type DeleteContractResult =
  | { kind: "ok"; mtimeMs: number }
  /**
   * The contract still has work areas pointing at it. `workSpecIds`
   * lists the offending `work_spec.id` values so the renderer can
   * surface "reassign these first" to the user.
   */
  | { kind: "referenced"; workSpecIds: number[] }
  | CpOpConflict
  | CpOpMissing;

/* ------------------------------------------------------------------ */
/*  Attachments (Slice 10K)                                            */
/* ------------------------------------------------------------------ */
/**
 * Work-area-level attachment ops. Same immediate-persistence envelope
 * as contracts (open → mutate → saveAs → close). Conflict handling via
 * `storedMtimeMs` + `force`.
 *
 * Schema note (Molio 2.0): `attachment.work_spec_id` is the ONLY FK —
 * attachments belong to a work_spec row (work area / arbejdsbeskrivelse).
 * Attaching to a BDB (construction_element_spec), a section, or the
 * project is NOT supported by the schema.
 *
 * Size cap: the renderer passes raw file bytes across IPC. To avoid
 * unbounded memory use we cap each call at MAX_ATTACHMENT_BYTES. The
 * renderer should read the file size first and show a clear error
 * rather than hand us a 500 MB Buffer.
 */
export const MAX_ATTACHMENT_BYTES = 90_000_000;

/** Attachment row info returned to the renderer after add/replace. */
export interface AttachmentInfo {
  id: number;
  /**
   * FK to `work_spec(id)` — the work area this attachment belongs to.
   * Per the Molio 2.0 schema, this is the ONLY parent pointer on an
   * attachment. BDBs, sections, and the project cannot own attachments.
   */
  workSpecId: number;
  name: string;
  mimeType: string;
  attachmentTypeId: number;
  byteLength: number;
  /** Hex-encoded SHA-1 of the stored bytes. */
  sha1Hex: string;
}

export interface AddAttachmentRequest extends CpOpBaseRequest {
  workSpecId: number;
  name: string;
  mimeType: string;
  /** Raw bytes. The preload layer forwards this as a Uint8Array. */
  content: Uint8Array;
  /** Defaults to Bilag (1) in core. Pass 2 for Graensefladeskema. */
  attachmentTypeId?: number;
}
export type AddAttachmentResult =
  | { kind: "ok"; mtimeMs: number; attachment: AttachmentInfo }
  | { kind: "too-large"; maxBytes: number; actualBytes: number }
  /**
   * An attachment with identical bytes already exists. The Molio schema
   * enforces `UNIQUE(sha1_hash)` — content-addressed storage. Rather
   * than surface the raw SqliteError we translate it here and include
   * the existing row's name + parent work area so the UI can say
   * "already attached as 'X' under 'Y'".
   */
  | {
      kind: "duplicate";
      existing: { id: number; name: string; workSpecId: number };
    }
  | CpOpConflict
  | CpOpMissing;

export interface DeleteAttachmentRequest extends CpOpBaseRequest {
  attachmentId: number;
}
export type DeleteAttachmentResult =
  | { kind: "ok"; mtimeMs: number }
  /** No attachment row with that id — UI should refresh. */
  | { kind: "not-found" }
  | CpOpConflict
  | CpOpMissing;

export interface ReplaceAttachmentRequest extends CpOpBaseRequest {
  attachmentId: number;
  /** All four fields are optional — only the ones provided are changed. */
  name?: string;
  mimeType?: string;
  content?: Uint8Array;
  attachmentTypeId?: number;
}
export type ReplaceAttachmentResult =
  | { kind: "ok"; mtimeMs: number; attachment: AttachmentInfo }
  | { kind: "too-large"; maxBytes: number; actualBytes: number }
  | { kind: "not-found" }
  | CpOpConflict
  | CpOpMissing;

/**
 * Rename an attachment in place (Slice 10K.8). Only `name` changes;
 * bytes / sha / type / parent work_spec are preserved.
 */
export interface RenameAttachmentRequest extends CpOpBaseRequest {
  attachmentId: number;
  name: string;
}
export type RenameAttachmentResult =
  | { kind: "ok"; mtimeMs: number; attachment: AttachmentInfo }
  | { kind: "not-found" }
  | CpOpConflict
  | CpOpMissing;

/**
 * Move an attachment to a different work area (Slice 10K.8). Changes
 * only `work_spec_id`; everything else is preserved. Throws on the
 * main side if the target work_spec does not exist (reported as
 * `not-found`).
 */
export interface MoveAttachmentRequest extends CpOpBaseRequest {
  attachmentId: number;
  newWorkSpecId: number;
}
export type MoveAttachmentResult =
  | { kind: "ok"; mtimeMs: number; attachment: AttachmentInfo }
  | { kind: "not-found" }
  | CpOpConflict
  | CpOpMissing;

/**
 * Open an attachment with the OS's default app for its mime type
 * (Slice 10K.8). The main process writes the blob to a per-session
 * temp directory and hands the path to Electron `shell.openPath`.
 * The temp file is kept for the lifetime of the app session so the
 * external viewer can keep the handle open.
 *
 * Read-only — does NOT mutate the .moliospec. No conflict / mtime
 * envelope; no save-first requirement.
 */
export interface OpenAttachmentRequest {
  /** Absolute path to the .moliospec file; mirrors CpOpBaseRequest.path. */
  path: string;
  attachmentId: number;
}
export type OpenAttachmentResult =
  | { kind: "ok"; tempPath: string }
  | { kind: "not-found" }
  // Blocked by the open-safety allowlist (5d): the attachment's file type
  // is not on the safe-to-auto-open list (e.g. .command, .html, .svg).
  | { kind: "blocked"; extension: string | null }
  | { kind: "error"; message: string };

/**
 * Fetch the raw bytes of a single attachment (Slice 10L — PDF export
 * appendix). Read-only: no mtime envelope, no save-first requirement.
 *
 * The payload ships `bytes` as a `Uint8Array` so Electron's structured
 * clone keeps it compact across the IPC boundary (JSON.stringify would
 * blow it up 4x as base64). The renderer converts to a `data:` URL on
 * its side when it needs to hand the image to pdfmake.
 */
export interface ReadAttachmentBytesRequest {
  /** Absolute path to the .moliospec file; mirrors CpOpBaseRequest.path. */
  path: string;
  attachmentId: number;
}
export type ReadAttachmentBytesResult =
  | {
      kind: "ok";
      /** Raw attachment bytes. */
      bytes: Uint8Array;
      mimeType: string;
      name: string;
    }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/**
 * Delete a work area and everything that's exclusively its own
 * (sections + all its BDBs + their sections). Attachments are
 * orphaned (work_spec_id → NULL), not deleted. Control plans are
 * kept — they become unlinked plans in the sidebar. See
 * core.deleteWorkArea for the full cascade rules (Slice 6J).
 */
export interface DeleteWorkAreaRequest extends CpOpBaseRequest {
  workSpecId: number;
}
/**
 * Summary counts returned on success so the UI can show what
 * actually happened ("Deleted 3 BDBs, 12 sections; 2 attachments
 * orphaned"). All four numbers are always reported, even when 0.
 */
export interface DeleteSummaryCounts {
  bdbs: number;
  sections: number;
  attachmentsOrphaned: number;
  controlPlansUnlinked: number;
}
export type DeleteWorkAreaResult =
  | { kind: "ok"; mtimeMs: number; summary: DeleteSummaryCounts }
  | CpOpConflict
  | CpOpMissing;

/**
 * Delete a single BDB + its sections. Control plans linked from the
 * BDB are preserved (they become unlinked plans).
 */
export interface DeleteBdbRequest extends CpOpBaseRequest {
  bdbId: number;
}
export type DeleteBdbResult =
  | { kind: "ok"; mtimeMs: number; summary: DeleteSummaryCounts }
  | CpOpConflict
  | CpOpMissing;

/**
 * Pre-flight query: tells the UI what *would* be cascaded before
 * the user confirms the delete. Read-only — main opens the file,
 * runs the count queries, closes, and returns. No writes.
 *
 * The renderer uses this to render the confirm-dialog copy:
 * "This work area contains 3 BDBs, 12 sections, and 2 attachments…"
 *
 * No `storedMtimeMs` / `force` — this is read-only, so conflict
 * handling doesn't apply.
 */
export interface GetDeleteImpactRequest {
  path: string;
  target: { kind: "workArea"; id: number } | { kind: "bdb"; id: number };
}
export interface DeleteImpact {
  bdbs: number;
  sections: number;
  attachmentsOrphaned: number;
  controlPlansUnlinked: number;
  /** True when the target has nothing to cascade — the UI can show
   * a softer "Delete this? It's empty." confirm. */
  isEmpty: boolean;
}
export type GetDeleteImpactResult =
  | { kind: "ok"; impact: DeleteImpact }
  | { kind: "missing" };

/* ------------------------------------------------------------------ */
/*  Import from another moliospec (Slice 6K)                            */
/* ------------------------------------------------------------------ */

/**
 * Slim, tree-only view of a source moliospec. Returned by
 * `readImportSource` so the Import modal can render a
 * Contract → Work Area → BDB tree without paying for the full
 * FilePayload (sections, control-plan rows, attachments, etc).
 *
 * Shapes are intentionally flat — the renderer groups BDBs under
 * their work areas and work areas under their contracts on its
 * own. That keeps the IPC payload JSON-serializable and easy to
 * diff in React state.
 */
export interface ImportSourceWorkArea {
  id: number;
  workAreaCode: string | null;
  workAreaName: string;
  /** Contract this work area belongs to (source's `contracts.id`),
   * or null if unassigned. */
  contractId: number | null;
}

export interface ImportSourceBdb {
  id: number;
  name: string;
  /** Work area this BDB belongs to (source's `work_spec.id`),
   * or null for "standalone" BDBs (shown at the root of the tree). */
  workSpecId: number | null;
}

export interface ImportSourceSummary {
  /** Source file's contracts. Empty on older schemas. */
  contracts: ContractInfo[];
  workAreas: ImportSourceWorkArea[];
  bdbs: ImportSourceBdb[];
}

export interface ReadImportSourceRequest {
  sourcePath: string;
}
export type ReadImportSourceResult =
  | { kind: "ok"; summary: ImportSourceSummary }
  | { kind: "missing" };

/**
 * Mirrors core's `CollisionPolicy`. "overwrite" is accepted by the
 * type here so the UI can offer all three, but core currently throws
 * if you actually send it — fix is a future iteration.
 */
export type ImportCollisionPolicy =
  | "skip"
  | "rename"
  | "overwrite"
  // FIX-ImportMerge 2026-05-11. Work-area only: reuse the existing
  // target work area as the landing spot for the source's BDBs. The
  // target work area's metadata / sections / attachments stay
  // untouched; the source work area's own data is dropped. Default
  // policy in the renderer when a collision is detected.
  | "merge";

export interface ImportWorkAreaPlan {
  sourceWorkSpecId: number;
  targetContractId: number | null;
  includeBdbIds?: number[];
  onCollision: ImportCollisionPolicy;
  renamedCode?: string | null;
  renamedName?: string;
}

export interface ImportBdbPlan {
  sourceBdbId: number;
  targetWorkSpecId: number;
  onCollision: ImportCollisionPolicy;
  renamedName?: string;
}

export interface ImportPlanDTO {
  workAreas: ImportWorkAreaPlan[];
  bdbs: ImportBdbPlan[];
}

export interface ImportWorkAreaCollisionDTO {
  sourceWorkSpecId: number;
  targetWorkSpecId: number;
  matchedOn: "code" | "name" | "code+name";
  workAreaCode: string | null;
  workAreaName: string;
}

export interface ImportBdbCollisionDTO {
  sourceBdbId: number;
  targetBdbId: number;
  targetWorkSpecId: number;
  name: string;
}

export interface ImportPrecheckDTO {
  workAreaCollisions: ImportWorkAreaCollisionDTO[];
  bdbCollisions: ImportBdbCollisionDTO[];
}

export interface ImportPrecheckRequest {
  sourcePath: string;
  targetPath: string;
  plan: ImportPlanDTO;
}
export type ImportPrecheckResult =
  | { kind: "ok"; precheck: ImportPrecheckDTO }
  | { kind: "missing"; which: "source" | "target" };

export interface ImportApplyRequest extends CpOpBaseRequest {
  /** The file the user is importing FROM (read-only). */
  sourcePath: string;
  plan: ImportPlanDTO;
}
export interface ImportSummary {
  workAreasImported: number;
  bdbsImported: number;
  controlPlansImported: number;
  skippedWorkAreas: number[];
  skippedBdbs: number[];
}
export type ImportApplyResult =
  | { kind: "ok"; mtimeMs: number; summary: ImportSummary }
  | { kind: "source-missing" }
  | CpOpConflict
  | CpOpMissing;

/**
 * SPLIT-Merge (#248) — fill an empty target work area's sections
 * from a chosen source work area. Surgical alternative to import:apply.
 *
 * Source can come from any moliospec on disk — including a freshly
 * downloaded Molio standard template. The target work area must be
 * empty (0 sections); the call refuses otherwise via `FILL_TARGET_NOT_EMPTY`.
 */
export interface FillEmptyWorkSpecRequest extends CpOpBaseRequest {
  /** The file to copy sections FROM (read-only). */
  sourcePath: string;
  /** Source work area's id within `sourcePath`. */
  sourceWorkSpecId: number;
  /** Target work area's id within `path` (the open file). */
  targetWorkSpecId: number;
}
export interface FillEmptyWorkSpecSummary {
  sectionsCopied: number;
}
export type FillEmptyWorkSpecResult =
  | { kind: "ok"; mtimeMs: number; summary: FillEmptyWorkSpecSummary }
  | { kind: "source-missing" }
  | CpOpConflict
  | CpOpMissing;

/**
 * Save-as-PDF request (Phase 7.1). The renderer builds the PDF bytes
 * in-process (pdfmake runs in a browser context), then asks main to
 * open a save dialog and write them to disk.
 *
 * `bytes` is the final PDF file content. Electron's structured clone
 * ships `Uint8Array` across the IPC boundary as a Node Buffer, which
 * is fine for `fs.writeFile`.
 */
export interface SavePdfRequest {
  /** Pre-filled filename in the dialog (no path). Ends with ".pdf". */
  suggestedFileName: string;
  /** The PDF file contents. */
  bytes: Uint8Array;
}

/**
 * Result of a save-as-PDF call.
 *
 *   - "saved"      dialog confirmed + file written; `path` is what the
 *                  user picked, so the renderer can surface it.
 *   - "cancelled"  user dismissed the save dialog. No write happened.
 *   - "error"      something went wrong during the write. `message` is a
 *                  human-readable reason; the renderer shows it in a
 *                  toast/alert. Exceptions from the main process are
 *                  caught and funnelled through this branch so the
 *                  renderer never sees a raw rejection.
 */
export type SavePdfResult =
  | { kind: "saved"; path: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/**
 * Batch save-as-PDF request (Phase 7.3). The renderer builds every PDF
 * in-process first, then sends the whole array to main. Main shows ONE
 * directory picker, writes every file there with collision-safe names,
 * and returns the list of what actually landed on disk.
 *
 *   items:
 *     - `fileBase` is the filename stem WITHOUT extension. Main appends
 *       `.pdf` and applies any collision suffix. Callers should have
 *       already run their preferred sanitiser (same logic as single
 *       export: forbid `\ / : * ? " < > |`).
 *     - `bytes` is the final PDF file content.
 *
 * Collisions: main picks up any `<fileBase>.pdf` files already in the
 * chosen directory and renames the incoming file to `<fileBase>-1.pdf`,
 * `<fileBase>-2.pdf` and so on — same rule as the in-batch dedup
 * (see `dedupeAgainstDisk` in shared/pdfExportUtils.ts).
 */
export interface SavePdfBatchItem {
  fileBase: string;
  bytes: Uint8Array;
}
export interface SavePdfBatchRequest {
  /**
   * Pre-filled directory picker title. Optional; main falls back to a
   * reasonable default when empty.
   */
  dialogTitle?: string;
  items: SavePdfBatchItem[];
}

/**
 * Result of a batch-save-as-PDF call.
 *
 *   - "saved"      directory confirmed + every item attempted. `written`
 *                  is the list of files that landed (full paths).
 *                  `errors` lists per-item failures (partial success is
 *                  possible — a single failed write doesn't abort the
 *                  batch). Both arrays may be empty.
 *   - "cancelled"  user dismissed the directory picker. No files written.
 *   - "error"      the whole call failed before any write (e.g. unable
 *                  to list the directory). No files written.
 */
export type SavePdfBatchResult =
  | {
      kind: "saved";
      directory: string;
      written: string[];
      errors: Array<{ fileBase: string; message: string }>;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  DOCX export (DOCX slice, 2026-05-12)                              */
/* ------------------------------------------------------------------ */

/**
 * Save a generated Word document to disk via the OS Save dialog.
 * Mirrors the `SavePdfRequest` / `SavePdfResult` pair — same shape
 * so the renderer's plumbing can stay symmetric across PDF / DOCX.
 *
 * `bytes` carries the full `.docx` blob (a ZIP container). Crosses
 * IPC as a structured-cloned `Uint8Array` — same as PDF bytes.
 */
export interface SaveDocxRequest {
  suggestedFileName: string;
  bytes: Uint8Array;
}
export type SaveDocxResult =
  | { kind: "saved"; path: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/**
 * Batch Word-document save — mirrors `SavePdfBatchRequest` exactly.
 * Renderer pre-builds every .docx in-process and hands main the full
 * array with one IPC call. Main shows ONE folder picker, dedupes
 * filenames against what's already on disk, writes each file, and
 * returns a per-item summary. Per-file write errors don't abort the
 * batch (same "partial success is allowed" rule the PDF batch uses).
 */
export interface SaveDocxBatchItem {
  fileBase: string;
  bytes: Uint8Array;
}
export interface SaveDocxBatchRequest {
  /** Pre-filled folder-picker title. Optional; main falls back to a
   *  reasonable default when empty. */
  dialogTitle?: string;
  items: SaveDocxBatchItem[];
}
export type SaveDocxBatchResult =
  | {
      kind: "saved";
      directory: string;
      written: string[];
      errors: Array<{ fileBase: string; message: string }>;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  MCP export bridge (EXP-MCP slice)                                 */
/* ------------------------------------------------------------------ */

/**
 * The MCP server lives in its own Node process. Some operations
 * (PDF export, "open this file in the editor") require the editor's
 * renderer because that's where the data + PDF builder + tab state
 * live. The MCP server therefore talks to the editor over its
 * loopback HTTP listener, and main forwards each call to the
 * renderer via the request/reply pattern below.
 *
 * Why request/reply instead of plain `webContents.send`
 * -----------------------------------------------------
 * `webContents.send` is one-way. To wait for a renderer result we
 * include a `requestId` in the request and listen on a paired reply
 * channel; main correlates the reply by id and resolves a Promise.
 * See `main/mcpRequestRenderer.ts`.
 */

/** Selection by IDs — same IDs that come back from the read-only
 *  MCP tools (`list_work_areas`, `list_bdbs`, `list_control_plans`).
 *  Each array is optional; if all three are empty/omitted the editor
 *  treats the request as "export everything." */
export interface McpExportSelection {
  workAreaIds: number[];
  bdbIds: number[];
  controlPlanIds: number[];
}

/** Grouping mode — mirrors the renderer's `ExportGroupBy`. Repeated
 *  here so the shared types don't reach into the renderer source. */
export type McpExportGroupBy =
  | "perSpec"
  | "perWorkArea"
  | "perContract"
  | "perProject";

/** Main → renderer: build a set of PDFs and reply with the bytes.
 *  The renderer uses its own loaded FilePayload (the file currently
 *  open in the editor) — the MCP layer doesn't pass file content. */
export interface McpBuildPdfsRequest {
  requestId: string;
  groupBy: McpExportGroupBy;
  /** When null, the renderer treats the request as "every checkable
   *  leaf in the export tree." */
  selection: McpExportSelection | null;
  includeCoverPage: boolean;
  compact: boolean;
  /** Include a table of contents in each spec PDF. Optional — omitted
   *  means "on" (the PDF builders default to true). */
  includeToc?: boolean;
  /** Absolute path to a specific `.speccustom` to use as the cover,
   *  overriding the auto-detected sibling. Null/undefined = auto-detect. */
  coverPath?: string | null;
}

/** Renderer → main: the result of one `McpBuildPdfsRequest`. */
export interface McpBuildPdfsReply {
  requestId: string;
  result:
    | {
        kind: "ok";
        /** The file path of the moliospec the editor had open when
         *  the bytes were produced. Main returns this back to the
         *  MCP server so the caller can confirm what was exported. */
        sourcePath: string;
        items: Array<{ fileBase: string; bytes: Uint8Array }>;
        /** Per-job build errors. The renderer still ships items for
         *  the jobs that succeeded — partial success is possible. */
        errors: Array<{ fileBase: string; message: string }>;
      }
    | { kind: "no-file" }
    | { kind: "error"; message: string };
}

/** Main → renderer: build Word documents for one or more specs and
 *  reply with the bytes. Sibling to McpBuildPdfsRequest but
 *  per-spec (no groupBy, no selection tree). Each spec produces one
 *  .docx — BDBs and work areas can be mixed in a single request.
 *
 *  DOCX-WA: `workSpecIds` was added so MCP callers can export work
 *  areas alongside BDBs. Either or both arrays may be non-empty;
 *  the request is treated as empty only when both are.
 */
export interface McpBuildDocxRequest {
  requestId: string;
  /** BDB ids to export. */
  bdbIds: number[];
  /** Work-area ids to export. New in DOCX-WA — optional in the
   *  MCP tool input (we treat omitted as empty). */
  workSpecIds: number[];
  /** Control-plan ids to export. New in DOCX-CP. Uses a different
   *  Word template (Molio_2_ControlPlan_Template.docx). Optional in
   *  the MCP tool input. */
  controlPlanIds: number[];
  /** When true, hide empty sections (same rule as the PDF / GUI
   *  "Compact" checkbox — see compactFilter.ts). Default false. */
  compact: boolean;
  /** Include a table of contents (BDB / work area only — picks the
   *  with-/no-TOC Word template). Optional — omitted means "on". */
  includeToc?: boolean;
}

/** One per-spec ref returned by the renderer. Matches `DocxSpecRef`
 *  in `buildBdbDocx.ts` — the kind discriminates BDB / work area / CP. */
export type McpBuildDocxItemKind = "bdb" | "workSpec" | "cp";

/** Renderer → main: result of an McpBuildDocxRequest. */
export interface McpBuildDocxReply {
  requestId: string;
  result:
    | {
        kind: "ok";
        /** The .moliospec path the editor had open while building. */
        sourcePath: string;
        items: Array<{
          fileBase: string;
          /** Spec kind — "bdb" for a BDB, "workSpec" for a work
           *  area. Lets the caller pair the result back to its
           *  request. */
          specKind: McpBuildDocxItemKind;
          /** The spec's id (BDB id or work_spec id, depending on
           *  `specKind`). Renamed from the old `bdbId` field for
           *  clarity — old MCP clients that hard-coded `bdbId`
           *  will need to read `specId` instead. */
          specId: number;
          bytes: Uint8Array;
        }>;
        /** Per-spec build errors. Other items in the batch still ship. */
        errors: Array<{
          specKind: McpBuildDocxItemKind;
          specId: number;
          message: string;
        }>;
      }
    | { kind: "no-file" }
    | { kind: "error"; message: string };
}

/** Main → renderer: open the given .moliospec in the active editor
 *  window. The renderer is responsible for the dirty-state check —
 *  see `McpSetActiveFileReply` for the refusal kinds. */
export interface McpSetActiveFileRequest {
  requestId: string;
  /** Absolute path on the user's disk. */
  path: string;
}

/** Renderer → main: result of the open-file request. */
export interface McpSetActiveFileReply {
  requestId: string;
  result:
    | { kind: "ok"; path: string; filename: string }
    /** Editor has unsaved edits — user must save first. */
    | { kind: "dirty" }
    | { kind: "error"; message: string };
}

/* ------------------------------------------------------------------ */
/*  Molio API (Phase 7.5 — MAPI3+)                                    */
/* ------------------------------------------------------------------ */

/** Which Molio API environment the user wants to talk to. */
export type MolioApiEnv = "qa" | "prd";

/**
 * Redacted view of the Molio API config that the renderer is allowed
 * to see. The actual subscription keys NEVER cross the IPC boundary —
 * `qaKeySet` / `prdKeySet` only signal "is a key configured?". The
 * `source` field tells the UI whether the active key was supplied via
 * the user's Settings dialog (encrypted on disk) or via an environment
 * variable at app start (dev-only path).
 *
 * RELEASE-A5: `glasshouseSession` carries the current sign-in state.
 * The renderer uses it to show "Signed in as X / expires in N days"
 * and to swap the manual-key UI out for the sign-in flow.
 */
export interface MolioConfigView {
  env: MolioApiEnv;
  qaKeySet: boolean;
  prdKeySet: boolean;
  /** What's powering the *active* key (i.e. for the chosen `env`). */
  source: "settings" | "env" | "unset";
  /**
   * The user's email — used to validate licenses against the License
   * API. Persisted in the same config file (plaintext; not a secret).
   * `null` until the user enters it in Settings. Required for any
   * content fetch (MAPI5+).
   */
  email: string | null;
  /**
   * Current Glasshouse sign-in state, if any. `null` when no one is
   * signed in (or the previous session has been purged on expiry).
   */
  glasshouseSession: GlasshouseSessionView | null;
  /**
   * URL of the Glasshouse sign-up page ("Create account" in the
   * sign-in dialog opens this in the system browser). Computed by
   * main from the same base URL sign-in itself uses, so a
   * GLASSHOUSE_API_BASE_URL dev override affects both consistently.
   */
  glasshouseSignUpUrl: string;
}

/**
 * RELEASE-A5 — public view of the Glasshouse session. The actual
 * tokens / Molio keys NEVER cross the IPC boundary; the renderer
 * only needs to know "are we signed in, as whom, and how long
 * until the session expires".
 */
export interface GlasshouseSessionView {
  /** Email used to sign in. */
  email: string;
  /** Epoch ms — when sign-in completed. */
  signedInAt: number;
  /** Epoch ms — when the 3-day timeout will fire. */
  expiresAt: number;
}

/** Setter request. Pass `null` for a key field to clear it. */
export interface SetMolioConfigRequest {
  env?: MolioApiEnv;
  qaKey?: string | null;
  prdKey?: string | null;
  /** Pass `null` (literal) to clear, undefined to leave alone. */
  email?: string | null;
}

/** Test-connection request. Email is required to validate the license. */
export interface TestMolioConnectionRequest {
  email: string;
}

/* ------------------------------------------------------------------ */
/*  Glasshouse sign-in (RELEASE-A5)                                   */
/* ------------------------------------------------------------------ */

/** Sign-in request — email + password the user typed in the dialog. */
export interface GlasshouseSignInRequest {
  email: string;
  password: string;
}

/**
 * Sign-in result. The actual tokens / Molio keys are persisted via
 * `safeStorage` on the main side and never returned to the renderer;
 * the renderer just learns whether sign-in succeeded and, on success,
 * gets the updated redacted `MolioConfigView`.
 *
 *   - `ok`               — signed in; new config view attached.
 *   - `auth-failed`      — Glasshouse rejected the email/password.
 *   - `transport-error`  — network / server problem.
 *   - `parse-error`      — Glasshouse responded but with an unexpected shape.
 *   - `storage-error`    — encrypting / writing the session failed.
 */
export type GlasshouseSignInResult =
  | { kind: "ok"; config: MolioConfigView }
  | {
      kind: "auth-failed";
      message: string;
      /**
       * Machine-readable reason from Glasshouse, when present — e.g.
       * "unconfirmed". Absent for an older Glasshouse that doesn't
       * send it yet, or when the 401 body wasn't JSON. See
       * `GlasshouseErrorCode` in `main/glasshouseSignIn.ts` for the
       * full vocabulary; kept as a plain string here so the renderer
       * doesn't need that main-only type.
       */
      errorCode?: string;
    }
  | { kind: "transport-error"; message: string }
  | { kind: "parse-error"; message: string }
  | { kind: "storage-error"; message: string };

/**
 * Status of the current session. Cheap query — main reads the
 * persisted config and returns a flag + the public session view (or
 * null if not signed in / session purged on expiry).
 */
export interface GlasshouseSessionStatus {
  signedIn: boolean;
  session: GlasshouseSessionView | null;
}

/** Test-connection result. */
export type TestMolioConnectionResult =
  | {
      kind: "ok";
      /** Number of work areas returned by getListOfWorkAreas. */
      workAreaCount: number;
      /** License validation result for the supplied email. */
      licenseValid: boolean;
      /** Read or write tier — whichever validated true. */
      tier?: "read" | "write";
    }
  | {
      kind: "no-key";
      /** No key configured for the active env. */
    }
  | {
      kind: "auth-failed";
      message: string;
    }
  | {
      kind: "error";
      message: string;
    };

/* ------------------------------------------------------------------ */
/*  MolioReference fetch (MAPI5)                                      */
/* ------------------------------------------------------------------ */

/** Which Molio reference document the renderer wants. */
export type MolioReferenceKind = "basis" | "instructions";

/** Request: which revision + which kind. */
export interface GetMolioReferenceRequest {
  /** GUID of the work-area revision to fetch — i.e. the spec/BDB's
   *  `basisRevisionGuid`. Pass null/empty to get a `no-revision`
   *  response (used to keep the renderer simple). */
  revisionId: string | null;
  /** Which document — Basis specification or Instructions. */
  kind: MolioReferenceKind;
}

/**
 * One section in the response. Mirrors `MolioBasicSection` from
 * core but flattened to plain JSON for IPC transport. The renderer
 * converts this tree into its own `SectionData[]` for the aligned
 * view.
 */
export interface MolioReferenceSection {
  heading: string;
  body: string;
  sectionNo: number;
  sections: MolioReferenceSection[];
  molioSectionGuid: string;
}

/** Response payload — the envelope + the section tree. */
export interface MolioReferenceData {
  workAreaCode: string;
  workAreaName: string;
  revision: string;
  revisionDate: string;
  molioSpecificationGuid: string;
  /** Top-level sections. Same shape regardless of `kind`. */
  sections: MolioReferenceSection[];
}

/**
 * Discriminated result. The renderer switches on `kind` to render
 * the right state in the aligned-view right column.
 *
 *  - `ok`            — content fetched (or served from session cache)
 *  - `no-revision`   — request had no revisionId (spec has no Basis link)
 *  - `no-config`     — Molio API hasn't been set up in Settings yet
 *  - `no-license`    — the email's license validation returned false
 *  - `auth-failed`   — subscription key rejected (401/403)
 *  - `error`         — any other failure (network, http 4xx/5xx, parse)
 */
export type GetMolioReferenceResult =
  | { kind: "ok"; data: MolioReferenceData }
  | { kind: "no-revision" }
  | { kind: "no-config"; reason: "no-key" | "no-email" }
  | { kind: "no-license" }
  | { kind: "auth-failed"; message: string }
  /** Task 117 — Molio has no content for the identifier this
   *  project file stored (a 404 from a revision-keyed fetch).
   *  The renderer shows a plain-language message; no technical
   *  detail crosses IPC. See main/handlers/molioContentError.ts. */
  | { kind: "revision-unavailable" }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  MolioReferencelist fetch (MAPI6)                                  */
/* ------------------------------------------------------------------ */

/** Request: which work-area revision's reference list to fetch.
 *  Pass null/empty for `no-revision` (spec has no Basis link). */
export interface GetMolioReferencelistRequest {
  workAreaRevisionId: string | null;
}

/** One citation inside a Referenceliste sub-section. JSON-flat
 *  mirror of `MolioReferencelistReference` from core. */
export interface MolioReferencelistReferenceData {
  /** Recursive — sub-citations. Often empty. */
  subReferences: MolioReferencelistReferenceData[];
  /** Editions / addendums; shape unknown — kept opaque. */
  editionsAndAddendums: unknown[];
  /** Numeric prefix (e.g. `"Stk 1"`). */
  titlePrefix: string;
  title: string;
  /** GUID of the cited document, when known. */
  id: string;
  /** Standard / publication number (often empty). */
  number: string;
  /** ISO datetime for publisher's release date. */
  publisherReleaseDate: string;
  author: string;
  publisher: string;
}

export interface MolioReferencelistSubSectionData {
  titlePrefix: string;
  title: string;
  id: string;
  references: MolioReferencelistReferenceData[];
}

export interface MolioReferencelistSectionData {
  titlePrefix: string;
  title: string;
  id: string;
  description: string;
  descriptionReferences: MolioReferencelistSubSectionData[];
}

/** Top-level response payload — envelope + the section list. */
export interface MolioReferencelistData {
  /** GUID of the reference list. */
  id: string;
  /** Human title (e.g. "S240.01.05 Vindue, dør og port, leverance"). */
  title: string;
  /** Numeric revision (e.g. 2). */
  revision: number;
  /** String revision incl. minor (e.g. "R02.00"). */
  fullRevision: string;
  /** ISO date the list was published. */
  date: string;
  sections: MolioReferencelistSectionData[];
}

/** Discriminated result. Mirrors GetMolioReferenceResult so the
 *  renderer can share state-rendering code. */
export type GetMolioReferencelistResult =
  | { kind: "ok"; data: MolioReferencelistData }
  | { kind: "no-revision" }
  | { kind: "no-config"; reason: "no-key" | "no-email" }
  | { kind: "no-license" }
  | { kind: "auth-failed"; message: string }
  /** Task 117 — Molio has no content for the identifier this
   *  project file stored (a 404 from a revision-keyed fetch).
   *  The renderer shows a plain-language message; no technical
   *  detail crosses IPC. See main/handlers/molioContentError.ts. */
  | { kind: "revision-unavailable" }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  License status (MAPI7)                                            */
/* ------------------------------------------------------------------ */

/**
 * Discriminated state the top-toolbar pill renders. Computed in
 * main from the current config + the persistent license cache:
 *
 *  - `unknown` — config is set but we haven't validated yet (cache
 *    miss/stale + nothing in the current session pinged the API).
 *    Pill shows "License not verified" / clickable to open Settings.
 *  - `ok` — last validation said true and is fresh (≤24h).
 *  - `no-license` — last validation said false.
 *  - `no-key` — no subscription key configured for the active env.
 *  - `no-email` — key is set but no email; license can't be validated.
 *
 * `auth-failed` (subscription key rejected) is NOT cached on the
 * main side because validateLicenseByEmail throws before returning
 * a boolean. The renderer surfaces it as a session-only flag —
 * a "Connection failed" pill state distinct from "no license".
 */
export type LicenseStatus =
  | { kind: "ok" }
  | { kind: "no-license" }
  | { kind: "no-key" }
  | { kind: "no-email" }
  | { kind: "unknown" };

/* ------------------------------------------------------------------ */
/*  Start from scratch (IMP-API)                                      */
/* ------------------------------------------------------------------ */

/** Result of `createEmptyProject`. Save dialog runs in main; the
 *  user can cancel before any file is written. The renderer follows
 *  up with `openFile(path)` for a successful create — same pipeline
 *  it uses for opening any other file, no special cases needed. */
export type CreateEmptyProjectResult =
  | { kind: "ok"; path: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  Browse Molio template files (IMP-API)                             */
/* ------------------------------------------------------------------ */

/** One row in the renderer-facing list of available templates.
 *  The pre-parsed fields (`code`, `title`, `revision`, `date`)
 *  come from `parseGeneratedFileName` in core. */
export interface MolioListedFile {
  /** Original underscore-encoded label from the API. */
  rawFileName: string;
  /** Absolute download URL on `bv.molio.dk`. */
  url: string;
  /** Work-area code, e.g. "S010.01". Empty for meta entries. */
  code: string;
  /** Display title, e.g. "Byggesag". */
  title: string;
  /** Revision label (e.g. "01"). Empty when the parser fell back. */
  revision: string;
  /** ISO date `YYYY-MM-DD`. Empty when not parsed. */
  date: string;
  /** True when the parser couldn't structure the fields — UI
   *  should show `rawFileName` instead. */
  fallback: boolean;
}

/** Discriminated result of `listMolioFiles`. */
export type ListMolioFilesResult =
  | { kind: "ok"; data: MolioListedFile[] }
  | { kind: "no-config"; reason: "no-key" | "no-email" }
  | { kind: "no-license" }
  | { kind: "auth-failed"; message: string }
  | { kind: "error"; message: string };

/** Request: which file to download. */
export interface DownloadMolioFileRequest {
  /** URL from the listed file's `url`. We pass the URL rather than
   *  reconstruct it so the renderer doesn't need to know the host. */
  url: string;
  /** Optional original fileName — used to derive the temp file's
   *  display name. The actual extracted .moliospec inside the ZIP
   *  may use a different name; main prefers the inner one when
   *  available. */
  rawFileName?: string;
}

/** Discriminated result of `downloadMolioFile`. */
export type DownloadMolioFileResult =
  | {
      kind: "ok";
      /** Local path on disk where the extracted .moliospec landed.
       *  The renderer can call `openFile(path)` on it directly. */
      path: string;
      /** Display name (e.g. the inner zip entry name). */
      name: string;
    }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  MolioControlPlan fetch (CP-API)                                   */
/* ------------------------------------------------------------------ */

/** Request: which Molio reference CP to fetch. Null/empty → no-revision. */
export interface GetMolioControlPlanRequest {
  controlPlanGuid: string | null;
}

/** One node in the renderer-facing CP tree. JSON-flat mirror of
 *  `MolioControlPlanSection` from core. Snake_case row fields are
 *  preserved verbatim from Molio's payload. */
export interface MolioControlPlanSectionData {
  title: string;
  number: string;
  /** Children. `null` at leaves; never undefined. */
  sections: MolioControlPlanSectionData[] | null;
  // Leaf-row fields. Optional; only populated on row nodes.
  section_no?: string;
  subject?: string;
  control_type?: string;
  reference?: string;
  control_level?: string;
  sample_level?: string;
  acceptance_criteria?: string;
  time?: string;
  documentation?: string;
  method?: string;
  quantity?: string;
}

/** Top-level response payload — envelope + the section tree. */
export interface MolioControlPlanData {
  /** Human title. */
  title: string;
  /** Revision string (e.g. "R00.00"). */
  revisionNumber: string;
  /** "Production" / "Design" — verbatim from the API. */
  controlPlanType: string;
  sections: MolioControlPlanSectionData[];
}

/** Discriminated result. Mirrors the other Molio fetch result types. */
export type GetMolioControlPlanResult =
  | { kind: "ok"; data: MolioControlPlanData }
  | { kind: "no-revision" }
  | { kind: "no-config"; reason: "no-key" | "no-email" }
  | { kind: "no-license" }
  | { kind: "auth-failed"; message: string }
  /** Task 117 — Molio has no content for the identifier this
   *  project file stored (a 404 from a revision-keyed fetch).
   *  The renderer shows a plain-language message; no technical
   *  detail crosses IPC. See main/handlers/molioContentError.ts. */
  | { kind: "revision-unavailable" }
  | { kind: "error"; message: string };

/** Shape of `window.molio` injected by the preload script. */
export interface MolioBridge {
  openFileDialog(): Promise<string | null>;
  openFile(path: string): Promise<FilePayload>;
  saveFile(req: SaveFileRequest): Promise<SaveFileResult>;
  createControlPlan(req: CreateCpRequest): Promise<CreateCpResult>;
  duplicateControlPlan(req: DuplicateCpRequest): Promise<DuplicateCpResult>;
  /**
   * Move an existing CP under a different BDB. Slot is auto-picked from
   * the CP's own `control_plan_type` (design=0, production=1). Returns
   * `slot-occupied` instead of throwing when the target slot is already
   * filled by another CP. See MoveCpRequest above.
   */
  moveControlPlan(req: MoveCpRequest): Promise<MoveCpResult>;
  deleteControlPlan(req: DeleteCpRequest): Promise<DeleteCpResult>;
  addControlPlanRow(req: AddCpRowRequest): Promise<AddCpRowResult>;
  deleteControlPlanRow(req: DeleteCpRowRequest): Promise<DeleteCpRowResult>;
  addControlPlanHeader(req: AddCpHeaderRequest): Promise<AddCpHeaderResult>;
  deleteControlPlanHeader(
    req: DeleteCpHeaderRequest,
  ): Promise<DeleteCpHeaderResult>;
  duplicateBdb(req: DuplicateBdbRequest): Promise<DuplicateBdbResult>;
  /**
   * Create a PFBB child (subscriber) BDB pointing at an existing PFBB
   * master. See CreatePfbbChildRequest above and core.createPfbbChild
   * for the validation + column-copy rules.
   */
  createPfbbChild(req: CreatePfbbChildRequest): Promise<CreatePfbbChildResult>;
  /**
   * Move every orphan PFBB master (`is_pfbb=1`, `pfbb_id` null, not in
   * the virtual work_spec) into the virtual "Projektfælles" work_spec
   * (Slice 10H.6b). Creates the virtual row if missing AND there are
   * orphans; does nothing when the project is already clean.
   */
  migrateOrphanPfbbMasters(
    req: MigrateOrphanPfbbMastersRequest,
  ): Promise<MigrateOrphanPfbbMastersResult>;
  createContract(req: CreateContractRequest): Promise<CreateContractResult>;
  deleteContract(req: DeleteContractRequest): Promise<DeleteContractResult>;
  seedDefaultContracts(
    req: SeedDefaultContractsRequest,
  ): Promise<SeedDefaultContractsResult>;
  /**
   * #250 — the user's work-area-code -> contract-code mapping (from the
   * editable CSV), used to pre-select the landing contract at import.
   * No args; returns [] when the file is absent/empty.
   */
  getContractWorkAreaMapping(): Promise<WorkAreaContractMapRow[]>;
  openDefaultsFile(req: DefaultsFileRequest): Promise<DefaultsFileResult>;
  resetDefaultsFile(req: DefaultsFileRequest): Promise<DefaultsFileResult>;
  /**
   * Attachment ops (Slice 10K). Work-area-level; schema does not
   * support BDB-, project-, or section-level attachments. Bytes flow
   * over IPC as Uint8Array; size-capped at {@link MAX_ATTACHMENT_BYTES}.
   */
  addAttachment(req: AddAttachmentRequest): Promise<AddAttachmentResult>;
  deleteAttachment(
    req: DeleteAttachmentRequest,
  ): Promise<DeleteAttachmentResult>;
  replaceAttachment(
    req: ReplaceAttachmentRequest,
  ): Promise<ReplaceAttachmentResult>;
  renameAttachment(
    req: RenameAttachmentRequest,
  ): Promise<RenameAttachmentResult>;
  moveAttachment(req: MoveAttachmentRequest): Promise<MoveAttachmentResult>;
  openAttachment(req: OpenAttachmentRequest): Promise<OpenAttachmentResult>;
  readAttachmentBytes(
    req: ReadAttachmentBytesRequest,
  ): Promise<ReadAttachmentBytesResult>;
  deleteWorkArea(req: DeleteWorkAreaRequest): Promise<DeleteWorkAreaResult>;
  deleteBdb(req: DeleteBdbRequest): Promise<DeleteBdbResult>;
  getDeleteImpact(req: GetDeleteImpactRequest): Promise<GetDeleteImpactResult>;
  importPrecheck(req: ImportPrecheckRequest): Promise<ImportPrecheckResult>;
  importApply(req: ImportApplyRequest): Promise<ImportApplyResult>;
  /** SPLIT-Merge — fill an empty target work area from a source one. */
  fillEmptyWorkSpec(
    req: FillEmptyWorkSpecRequest,
  ): Promise<FillEmptyWorkSpecResult>;
  /**
   * Read the source-side tree of a moliospec the user wants to import
   * from. Read-only: main opens the file, pulls a slim summary
   * (contracts + work areas + BDBs), closes, and returns. No writes.
   *
   * Used by the Import modal to render its "pick what to bring over"
   * tree before the user clicks Check / Import.
   */
  readImportSource(
    req: ReadImportSourceRequest,
  ): Promise<ReadImportSourceResult>;
  /**
   * Inform the main process whether the renderer currently holds unsaved
   * changes. Main caches the flag and, on window close, prompts the user
   * to confirm losing them. Fire-and-forget (no response expected).
   */
  setDirty(dirty: boolean): void;
  /**
   * Subscribe to "save before closing" messages from main. Invoked when
   * the user picks Save in the close-window dialog. Returns a disposer.
   */
  onTriggerSaveAndClose(callback: () => void): () => void;
  /**
   * Task 83 — subscribe to "save, then open this file" messages from
   * main. Invoked when the user picks Save in the dialog raised by
   * double-clicking a `.moliospec` while holding unsaved edits. The
   * callback receives the absolute path to open. Returns a disposer.
   */
  onTriggerSaveAndOpen(callback: (path: string) => void): () => void;
  /**
   * Task 83 — ask main for the file this launch was started to open,
   * if any. Returns the absolute path once and null on every later
   * call. Call it as soon as the renderer can act on the answer.
   */
  takePendingOpenPath(): Promise<string | null>;
  /** Product name, version, edition and the About panel's links. */
  getAppInfo(): Promise<AppInfo>;
  /** Subscribe to update-state changes. Returns a disposer. */
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  /** The update state as it is right now. */
  getUpdateState(): Promise<UpdateState>;
  /** Ask main to check for a new version now. */
  checkForUpdates(): Promise<UpdateState>;
  /**
   * Restart into the downloaded version. Answers `unsaved` instead of
   * restarting when the editor has unsaved edits - see
   * `InstallUpdateResult`.
   */
  installUpdateNow(): Promise<InstallUpdateResult>;
  /**
   * Tell main that it's safe to close the window — used after a
   * successful save-before-close. Fire-and-forget.
   */
  closeWindow(): void;
  /**
   * Resolve a DOM `File` (from drag-and-drop) to the absolute filesystem
   * path. Uses Electron's `webUtils.getPathForFile` under the hood —
   * needed because `File.path` was removed from the renderer when context
   * isolation is on. Synchronous; returns an empty string if the file
   * doesn't correspond to a real filesystem entry.
   */
  getPathForFile(file: File): string;
  /**
   * Open a "Save As" dialog and write the given PDF bytes to disk.
   * Fire-and-respond IPC: on cancel the renderer is told nothing was
   * written; on error we return a text message instead of rejecting so
   * the renderer doesn't have to wrap the call in try/catch.
   */
  savePdf(req: SavePdfRequest): Promise<SavePdfResult>;
  /**
   * Show a directory picker, then write every PDF in the batch to the
   * chosen folder using collision-safe filenames. Single "atomic" IPC
   * call so the user only sees ONE dialog even when exporting a whole
   * contract's worth of specs. See SavePdfBatchRequest above.
   */
  savePdfBatch(req: SavePdfBatchRequest): Promise<SavePdfBatchResult>;
  /**
   * Open a "Save As" dialog and write the given DOCX bytes to disk.
   * Same fire-and-respond contract as `savePdf`; cancel returns a
   * `cancelled` result, OS / write errors return `error` with a
   * message instead of rejecting the promise.
   */
  saveDocx(req: SaveDocxRequest): Promise<SaveDocxResult>;
  /**
   * Batch DOCX save — pick a folder once, write every .docx to it
   * with collision-safe filenames. Mirrors `savePdfBatch`. Used by
   * the renderer when the user picked 2+ BDBs to export.
   */
  saveDocxBatch(req: SaveDocxBatchRequest): Promise<SaveDocxBatchResult>;
  /**
   * Save As — show a save dialog, write the file at the chosen path,
   * return the new path + mtime. `cancelled` is the user dismissing
   * the dialog without picking a file. Slice #41.
   */
  saveFileAs(req: SaveFileAsRequest): Promise<SaveFileAsResult>;
  /**
   * Subscribe to top-level menu actions dispatched by the main
   * process. Returns a disposer. The renderer routes each `MenuAction`
   * to the matching in-app handler — see `useShortcutHandler`.
   * Slice #41.
   */
  onMenuAction(callback: (action: MenuAction) => void): () => void;
  /**
   * Subscribe to the `glasshousespec://signed-up` deep link. Fires when
   * the user comes back from Glasshouse' confirmation page; the only
   * expected response is to open the sign-in dialog. No payload — see
   * `main/glasshouseDeepLink.ts` for why. Returns a disposer. Task 71.
   */
  onGlasshouseSignedUp(callback: () => void): () => void;
  /**
   * RELOAD-2 — point the main-process file watcher at `path` (the
   * currently-open file), treating `mtimeMs` as the known-current
   * version. Pass `path: null` to stop watching. Fire-and-forget;
   * re-sent on every open / save / reload.
   */
  watchActiveFile(path: string | null, mtimeMs: number): void;
  /**
   * RELOAD-2 — subscribe to "the open file changed on disk" events
   * from main. Returns a disposer.
   */
  onFileChangedOnDisk(
    callback: (event: FileChangedOnDiskEvent) => void,
  ): () => void;
  /**
   * EXP-MCP slice — subscribe to "build PDFs" requests forwarded from
   * the MCP server via main. The renderer runs its existing PDF build
   * pipeline against the currently-open FilePayload and ships the bytes
   * back via `sendMcpBuildPdfsReply`. Returns a disposer.
   */
  onMcpBuildPdfsRequest(
    callback: (req: McpBuildPdfsRequest) => void,
  ): () => void;
  /** Reply to an `McpBuildPdfsRequest`. Fire-and-forget. */
  sendMcpBuildPdfsReply(reply: McpBuildPdfsReply): void;
  /** MCP DOCX bridge — sibling of the PDF subscription. */
  onMcpBuildDocxRequest(
    callback: (req: McpBuildDocxRequest) => void,
  ): () => void;
  sendMcpBuildDocxReply(reply: McpBuildDocxReply): void;
  /**
   * EXP-MCP slice — subscribe to "set active file" requests forwarded
   * from the MCP server. The renderer checks for unsaved edits, opens
   * the file if clean, and replies via `sendMcpSetActiveFileReply`.
   * Returns a disposer.
   */
  onMcpSetActiveFileRequest(
    callback: (req: McpSetActiveFileRequest) => void,
  ): () => void;
  /** Reply to an `McpSetActiveFileRequest`. Fire-and-forget. */
  sendMcpSetActiveFileReply(reply: McpSetActiveFileReply): void;
  /**
   * Static info about the host platform. Used by the in-app shortcuts
   * cheat sheet to render `⌘` on macOS vs `Ctrl` elsewhere. Slice #41.
   */
  platform: "darwin" | "win32" | "linux";
  /**
   * Task 64 — open the application menu as a popup, anchored at the
   * given window coordinates (omit to let Electron place it at the
   * pointer). Used by the hamburger in the Windows title strip. On
   * macOS this is never called; the menu lives in the system menu
   * bar.
   */
  popupAppMenu(position?: { x: number; y: number }): void;
  /**
   * Molio API config, redacted. The renderer can see whether keys
   * are configured (per env), which env is active, and where the
   * active key came from — but never the keys themselves.
   */
  getMolioConfig(): Promise<MolioConfigView>;
  /**
   * Update the Molio API config. Pass plaintext keys; main encrypts
   * them via Electron `safeStorage` before writing to disk. Pass
   * `null` to clear a key. Returns the new redacted config view.
   */
  setMolioConfig(req: SetMolioConfigRequest): Promise<MolioConfigView>;
  /**
   * Test the active env's connection: calls getListOfWorkAreas to
   * verify the subscription key works, then validates the supplied
   * email against the License API to check entitlement. Returns a
   * structured result so the UI can render success / specific
   * failure modes without parsing strings.
   */
  testMolioConnection(
    req: TestMolioConnectionRequest,
  ): Promise<TestMolioConnectionResult>;
  /**
   * RELEASE-A5 — sign in to Glasshouse. On success the main side
   * persists the issued Molio keys + access token via safeStorage,
   * and the returned `MolioConfigView` reflects the new state.
   */
  glasshouseSignIn(
    req: GlasshouseSignInRequest,
  ): Promise<GlasshouseSignInResult>;
  /** Sign out. Purges the stored session; email is preserved so
   *  re-sign-in can pre-fill it. Returns the updated config view. */
  glasshouseSignOut(): Promise<MolioConfigView>;
  /** Cheap query — how long is left on the current session?
   *  Returns `signedIn: false` when no session is active. */
  glasshouseSessionStatus(): Promise<GlasshouseSessionStatus>;
  /**
   * Fetch a Molio reference document (Basic spec or Instructions)
   * for a given revisionId. Main checks license once per session
   * (cached), fetches via `MolioApiClient`, and caches the response
   * by `${kind}:${revisionId}` — wiped on app close. The renderer
   * is free to call this every time the user switches sub-tab; the
   * second call is essentially free.
   */
  getMolioReference(
    req: GetMolioReferenceRequest,
  ): Promise<GetMolioReferenceResult>;
  /**
   * MAPI6 — fetch a Molio reference list (Referenceliste tab).
   * Different shape from `getMolioReference` (citation tree, not
   * section content), so it lives on its own channel. License /
   * cache plumbing identical.
   */
  getMolioReferencelist(
    req: GetMolioReferencelistRequest,
  ): Promise<GetMolioReferencelistResult>;
  /**
   * CP-API — fetch a Molio reference control plan
   * (`getControlPlanContent`) for a given common-CP guid. Used by
   * the "Default Control plan" modal in the CP view. License /
   * cache plumbing identical to `getMolioReferencelist`.
   */
  getMolioControlPlan(
    req: GetMolioControlPlanRequest,
  ): Promise<GetMolioControlPlanResult>;
  /**
   * IMP-API — list every `.moliospec` template file Molio
   * publishes. Returns parsed entries the renderer can filter
   * directly. Same license / IPC pattern as the other Molio
   * fetches.
   */
  listMolioFiles(): Promise<ListMolioFilesResult>;
  /**
   * IMP-API — download one of the listed files. Main fetches the
   * ZIP from `bv.molio.dk`, extracts the inner `.moliospec`,
   * writes it to `userData/molio-downloads/`, and returns the
   * path. The renderer can then call `openFile(path)` to feed it
   * through the existing import pipeline.
   */
  downloadMolioFile(
    req: DownloadMolioFileRequest,
  ): Promise<DownloadMolioFileResult>;
  /**
   * IMP-API — Save dialog → copy bundled blank template → return
   * the chosen path. Renderer then calls `openFile(path)` to load
   * the new project the normal way. Cancelled → `cancelled`. */
  createEmptyProject(): Promise<CreateEmptyProjectResult>;
  /**
   * MAPI7 — current license-status snapshot for the top-bar pill.
   * Renderer polls on mount + after Settings changes; main
   * computes from config + persistent license cache.
   */
  getLicenseStatus(): Promise<LicenseStatus>;
  // Community edition: the MCP server path lookup is removed.
  /**
   * Renderer-prefs storage (PREFS series, 2026-04-27).
   *
   * `prefs.initial` is a snapshot of every persisted pref captured
   * at preload time via a synchronous IPC. Used by hooks whose
   * `useState` lazy initializers need a synchronous read.
   *
   * `prefs.set` writes one key. Async, fire-and-forget from the
   * renderer's perspective (the cached snapshot is updated locally
   * by the IpcKeyValueStore wrapper, so reads stay coherent).
   */
  prefs: {
    initial: Record<string, string>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /**
   * Custom cover (#249 COVER). Find a `.speccustom` sitting next to the
   * given .moliospec (returns its path + JSON), and read a `.speccustom`
   * file by absolute path. Called by the Glasshouse cover engine; the
   * handlers are generic file IO so they stay in Community too (inert —
   * nothing in Community calls them).
   */
  coverFindSibling(
    req: CoverFindSiblingRequest,
  ): Promise<CoverFindSiblingResult>;
  coverReadTemplate(
    req: CoverReadTemplateRequest,
  ): Promise<CoverReadTemplateResult>;
  /** Save dialog → write a `.speccustom`. */
  coverSaveTemplate(
    req: CoverSaveTemplateRequest,
  ): Promise<CoverSaveTemplateResult>;
  /** Open dialog (filtered to `.speccustom`) → read its bytes. */
  coverOpenTemplate(): Promise<CoverOpenTemplateResult>;
  /** Open dialog (filtered to PDF) → read its bytes as base64. */
  coverOpenUnderlay(): Promise<CoverOpenUnderlayResult>;
  /** Write cover-only PDF bytes to a temp file and open it for preview. */
  coverPreview(req: CoverPreviewRequest): Promise<CoverPreviewResult>;
  /** The path of the open .moliospec (to look for a sibling cover), or null. */
  coverCurrentMoliospecPath(): Promise<CoverCurrentPathResult>;
}

/* -------------------------------------------------------------------- */
/*  Custom cover (#249 COVER) IPC payloads                               */
/* -------------------------------------------------------------------- */

export interface CoverFindSiblingRequest {
  /** Absolute path of the open .moliospec. */
  moliospecPath: string;
}
export type CoverFindSiblingResult =
  | { kind: "found"; path: string; bytes: Uint8Array }
  | { kind: "none" }
  | { kind: "error"; message: string };

export interface CoverReadTemplateRequest {
  /** Absolute path of a `.speccustom` file. */
  path: string;
}
export type CoverReadTemplateResult =
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export interface CoverSaveTemplateRequest {
  /** The `.speccustom` package bytes (v2 zip) to write. */
  bytes: Uint8Array;
  /** Pre-filled filename in the Save dialog (e.g. "forside.speccustom"). */
  suggestedName?: string;
  /**
   * Full path to pre-select in the Save dialog, so "Gem…" defaults to
   * overwriting an existing file (e.g. the project's sibling `.speccustom`).
   * Takes precedence over suggestedName when set.
   */
  defaultPath?: string;
}
export type CoverSaveTemplateResult =
  | { kind: "saved"; path: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export type CoverOpenTemplateResult =
  | { kind: "ok"; path: string; bytes: Uint8Array }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export type CoverOpenUnderlayResult =
  | { kind: "ok"; base64: string; name: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface CoverPreviewRequest {
  /** Cover-only PDF bytes to open in the OS viewer. */
  bytes: Uint8Array;
}
export type CoverPreviewResult =
  | { kind: "ok" }
  | { kind: "error"; message: string };

/** The open .moliospec path (for sibling-cover lookup), or null if none. */
export interface CoverCurrentPathResult {
  path: string | null;
}

/** Channel names used by ipcMain/ipcRenderer. */
export const Channels = {
  openFileDialog: "file:open-dialog",
  openFile: "file:open",
  saveFile: "file:save",
  setDirty: "app:set-dirty",
  /**
   * Main → renderer: the user chose "Save" in the close-window dialog.
   * The renderer runs its normal save flow; on success it calls
   * `closeWindow` below. If the save fails or hits a conflict, the
   * renderer shows the relevant modal/banner and leaves the window open
   * — the user can resolve and try closing again.
   */
  triggerSaveAndClose: "app:save-then-close",
  /**
   * Main → renderer (Task 83): the user double-clicked a `.moliospec`
   * in Finder / Explorer while the editor had unsaved edits, and chose
   * "Save" in the dialog main put up. Sibling of
   * `triggerSaveAndClose` above: the renderer runs the same save flow,
   * but on success opens the path carried in the payload instead of
   * closing the window.
   *
   * On a conflict or a save failure the renderer surfaces the usual
   * modal/banner and does NOT open the file — the user resolves and
   * double-clicks again.
   *
   * Payload: the absolute path of the file to open afterwards.
   */
  triggerSaveAndOpen: "app:save-then-open",
  /**
   * Renderer → main (Task 83): "was this app started to open a file?"
   *
   * Asked once, by the renderer, as soon as it is ready to act on the
   * answer. Main returns the path the OS handed us at launch and
   * forgets it, so a reload or a second caller gets null rather than
   * re-opening the same file.
   *
   * A PULL, deliberately, where the first attempt was a push on
   * `did-finish-load`. That event fires when the page has loaded, which
   * is not the same moment as "React has mounted and subscribed" — on
   * Windows, where every launch-with-a-file goes through this path, the
   * message landed in the gap and vanished without a trace. Letting the
   * renderer ask when it is good and ready removes the race instead of
   * narrowing it.
   */
  takePendingOpenPath: "app:take-pending-open-path",
  /**
   * Automatic updates. Main owns the state machine (see
   * `main/appUpdater.ts`); the renderer only displays it and asks for
   * two things.
   *
   *   - `updateStateChanged` — main → renderer, whenever the state
   *     moves. Broadcast, not a reply, because most transitions are
   *     nobody's request: a scheduled check, a download finishing.
   *   - `getUpdateState` — the state right now, for a panel that has
   *     just been opened and missed the broadcasts.
   *   - `checkForUpdates` — the user pressed "Check for updates".
   *   - `installUpdateNow` — the user asked to restart into the new
   *     version. Refused, politely, when there are unsaved edits.
   */
  /**
   * What this build is: product name, version and edition, plus the
   * links the About panel shows. Read from the app itself rather than
   * written into the renderer, so the version on screen is the version
   * running and cannot drift from package.json.
   */
  getAppInfo: "app:get-info",
  updateStateChanged: "update:state-changed",
  getUpdateState: "update:get-state",
  checkForUpdates: "update:check",
  installUpdateNow: "update:install-now",
  /**
   * Renderer → main: "it's safe to close now." Main sets an internal
   * override flag and triggers `win.close()` again. Used by the
   * save-then-close handshake above.
   */
  closeWindow: "app:close-window",
  /**
   * Renderer → main (Task 64): open the application menu as a popup
   * at the given window coordinates. Used by the hamburger button in
   * the Windows title strip, where the native menu row is hidden.
   * Fire-and-forget; main pops the INSTALLED menu, not a fresh one.
   */
  popupAppMenu: "app:popup-menu",
  // Control-plan lifecycle (Slice 6D — see spec §CP lifecycle).
  createCp: "cp:create",
  duplicateCp: "cp:duplicate",
  moveCp: "cp:move",
  deleteCp: "cp:delete",
  addCpRow: "cp:add-row",
  deleteCpRow: "cp:delete-row",
  addCpHeader: "cp:add-header",
  deleteCpHeader: "cp:delete-header",
  duplicateBdb: "bdb:duplicate",
  // PFBB child creation (Slice 10H.4). Not a "normal" edit — it's an
  // immediate-persistence op like duplicateBdb, using the same envelope.
  createPfbbChild: "bdb:create-pfbb-child",
  // PFBB orphan-master migration (Slice 10H.6b). Same open → mutate →
  // saveAs → close envelope; no-op when project is already clean.
  migrateOrphanPfbbMasters: "bdb:migrate-orphan-pfbb-masters",
  // Contracts (Slice 6I — project-level contract manager).
  createContract: "contract:create",
  deleteContract: "contract:delete",
  seedDefaultContracts: "contract:seed-defaults",
  getContractWorkAreaMapping: "contract:get-workarea-mapping",
  openDefaultsFile: "defaults:open-file",
  resetDefaultsFile: "defaults:reset-file",
  // Attachments (Slice 10K — work-area-level attachment CRUD).
  addAttachment: "attachment:add",
  deleteAttachment: "attachment:delete",
  replaceAttachment: "attachment:replace",
  renameAttachment: "attachment:rename",
  moveAttachment: "attachment:move",
  openAttachment: "attachment:open",
  /**
   * Read-only: return the raw bytes + mime + filename for a single
   * attachment. Used by the PDF exporter (Slice 10L) so the renderer
   * can embed image attachments in the per-work-spec appendix. No
   * mtime envelope — this reads from disk, doesn't mutate anything.
   */
  readAttachmentBytes: "attachment:read-bytes",
  // Delete work area / BDB (Slice 6J).
  deleteWorkArea: "workArea:delete",
  deleteBdb: "bdb:delete",
  getDeleteImpact: "delete:impact",
  // Import from another moliospec (Slice 6K).
  importPrecheck: "import:precheck",
  importApply: "import:apply",
  // SPLIT-Merge (#248) — fill an empty work area from a standard.
  fillEmptyWorkSpec: "workSpec:fill-empty",
  /**
   * Read-only IPC used by the Import modal to fetch the source-side
   * tree before precheck. See `readImportSource` on MolioBridge.
   *
   * NOTE: like `importPrecheck` / `importApply`, the main + preload
   * sites use the literal string "import:read-source" directly —
   * Rollup's property-DCE quirk tends to strip tail entries off this
   * object in the bundle. The Channels entry is kept here for
   * typing consistency and to centralize the string.
   */
  readImportSource: "import:read-source",
  // PDF export (Phase 7.1). Renderer builds the bytes, main shows the
  // save dialog + writes to disk. Literal-string-safe to rename later.
  savePdf: "pdf:save",
  /**
   * Batch-export (Phase 7.3). Renderer builds every PDF, then sends one
   * array to main which shows a directory picker and writes the lot.
   * Same Rollup DCE caveat as the import channels — keep the literal
   * in sync on both sides.
   */
  savePdfBatch: "pdf:save-batch",
  /**
   * DOCX export (single file). Renderer builds the bytes, main shows
   * the OS save dialog and writes to disk. Same shape as `savePdf`.
   */
  saveDocx: "docx:save",
  /**
   * Batch DOCX export — same shape as `pdf:save-batch`. Renderer
   * builds every .docx, then sends one array to main which shows ONE
   * directory picker and writes them all. Same Rollup DCE caveat:
   * the main + preload sites use the literal string verbatim.
   */
  saveDocxBatch: "docx:save-batch",
  /**
   * Save As… — open a file dialog, write the current in-memory edits to
   * the chosen path, return the new path + mtime. Slice #41 (keyboard
   * shortcuts / Save As). Same conflict-detection envelope as `saveFile`
   * but the renderer is free to ignore conflicts: writing to a *new*
   * path is always allowed, and writing on top of an existing different
   * file is the user's explicit choice via the OS dialog.
   */
  saveFileAs: "file:save-as",
  /**
   * RELOAD-2 — file-watch control + notification.
   *
   * `watchActiveFile` (renderer → main, one-way): point the main-
   * process mtime watcher at the currently-open file, or pass
   * `path: null` to stop watching. Re-sent on every open / save /
   * reload so the watcher's baseline stays in sync.
   *
   * `fileChangedOnDisk` (main → renderer, one-way): the watched file
   * was modified by something else (another window, the MCP server,
   * a Dropbox sync). The renderer raises a "changed on disk" banner.
   */
  watchActiveFile: "file:watch-active",
  fileChangedOnDisk: "file:changed-on-disk",
  /**
   * Main → renderer: a top-level menu item was clicked. The payload is
   * a typed `MenuAction` (open / save / saveAs / closeTab / import /
   * export / settings / shortcuts). The renderer routes each action to
   * the matching in-app handler. Slice #41.
   */
  menuAction: "app:menu-action",
  /**
   * Main → renderer: the app was opened (or brought forward) through
   * the `glasshousespec://signed-up` deep link from Glasshouse' sign-up
   * confirmation page. Task 71.
   *
   * No payload, by design: the page sends no data, and the only
   * permitted effect is opening the sign-in dialog. See
   * `main/glasshouseDeepLink.ts`.
   */
  glasshouseSignedUpDeepLink: "glasshouse:signed-up-deep-link",
  /**
   * MCP export bridge (EXP-MCP slice). The MCP server's HTTP endpoint
   * delegates to the renderer via this request/reply pair. Main sends
   * `mcp:build-pdfs:request` (one-way), renderer replies on
   * `mcp:build-pdfs:reply` (one-way). Main correlates by requestId.
   * See `main/mcpRequestRenderer.ts` for the helper.
   */
  mcpBuildPdfsRequest: "mcp:build-pdfs:request",
  mcpBuildPdfsReply: "mcp:build-pdfs:reply",
  /** MCP DOCX build bridge — sibling of the PDF pair. */
  mcpBuildDocxRequest: "mcp:build-docx:request",
  mcpBuildDocxReply: "mcp:build-docx:reply",
  /**
   * MCP set-active-file bridge — same request/reply pattern as
   * mcpBuildPdfs above. Tells the renderer to open the given path
   * in the active editor window; renderer refuses if the editor
   * has unsaved changes (the AI is expected to surface this to the
   * user so they can save first).
   */
  mcpSetActiveFileRequest: "mcp:set-active-file:request",
  mcpSetActiveFileReply: "mcp:set-active-file:reply",
  /**
   * Molio API integration (Phase 7.5 — MAPI3+). The renderer NEVER
   * sees the subscription keys directly; it asks main for a redacted
   * "is configured?" view, sets new values via setMolioConfig (which
   * encrypts at rest via Electron `safeStorage`), and runs a test
   * call via testMolioConnection. Actual API calls (getListOfWorkAreas
   * etc.) come in a follow-up channel set as MAPI5+ lights up the
   * Reference panel.
   */
  getMolioConfig: "molioApi:get-config",
  setMolioConfig: "molioApi:set-config",
  testMolioConnection: "molioApi:test-connection",
  /**
   * RELEASE-A5 — Glasshouse sign-in / sign-out / session status.
   * Replaces the manual subscription-key flow in Settings.
   */
  glasshouseSignIn: "molioApi:glasshouse-sign-in",
  glasshouseSignOut: "molioApi:glasshouse-sign-out",
  glasshouseSessionStatus: "molioApi:glasshouse-session-status",
  /**
   * MAPI5 — fetch a Basic spec or Instructions document for a
   * revisionId. License is checked once per session; content is
   * cached for the session by `${kind}:${revisionId}`.
   */
  getMolioReference: "molioApi:get-reference",
  /**
   * MAPI6 — fetch a Referenceliste (citation tree) for a
   * workAreaRevisionId. Same caches as getMolioReference but
   * separate channel because the response shape differs.
   */
  getMolioReferencelist: "molioApi:get-referencelist",
  /**
   * CP-API — fetch a Molio reference control plan by GUID.
   * Surfaces in the "Default Control plan" modal in the CP view.
   */
  getMolioControlPlan: "molioApi:get-control-plan",
  /**
   * IMP-API — list available .moliospec template files (Browse
   * Molio source in the unified import modal).
   */
  listMolioFiles: "molioApi:list-files",
  /**
   * IMP-API — download one .moliospec template file. Main does
   * the ZIP unwrapping and writes the extracted file under
   * userData; returns the path.
   */
  downloadMolioFile: "molioApi:download-file",
  /** IMP-API — Start from scratch. Main asks where to save, copies
   *  the bundled blank template, opens the new file, returns its
   *  FilePayload. */
  createEmptyProject: "file:create-empty-project",
  /** MAPI7 — current license status for the top-bar pill. */
  getLicenseStatus: "molioApi:get-license-status",
  // Community edition: the MCP server path channel is removed.
  /**
   * Renderer-prefs storage (PREFS, 2026-04-27).
   * `prefsGetAllSync` is invoked via `ipcRenderer.sendSync` from
   * the preload script — sync because the renderer's pref hooks
   * need a synchronous initial value (lazy `useState` initializers).
   */
  prefsGetAllSync: "prefs:get-all-sync",
  prefsSet: "prefs:set",
  prefsDelete: "prefs:delete",
  // Custom cover (#249 COVER).
  coverFindSibling: "cover:find-sibling",
  coverReadTemplate: "cover:read-template",
  coverSaveTemplate: "cover:save-template",
  coverOpenTemplate: "cover:open-template",
  coverOpenUnderlay: "cover:open-underlay",
  coverPreview: "cover:preview",
} as const;

/**
 * Discriminated union of every menu-driven action the main process can
 * dispatch to the renderer. Add a new value here when adding a new
 * menu item. See `useShortcutHandler` for the renderer-side dispatcher.
 */
export type MenuAction =
  /** File → New: create a brand-new blank .moliospec (same as the
   *  Welcome screen's "Start from scratch"). */
  | { kind: "newFile" }
  | { kind: "open" }
  | { kind: "save" }
  | { kind: "saveAs" }
  | { kind: "closeTab" }
  | { kind: "import" }
  | { kind: "export" }
  | { kind: "settings" }
  | { kind: "shortcuts" }
  /**
   * Slice "Version compare" — open a second `.moliospec` as the
   * read-only "Version reference" the current project is compared
   * against. Re-uses the standard openFile pipeline; the renderer
   * routes the result to `referenceFile` state instead of the main
   * `file` state.
   */
  | { kind: "loadReference" }
  /**
   * UX1 — Open one of the entries from the File → Open Recent
   * submenu. `path` is the absolute filesystem path stored in the
   * recent-files list. The renderer pipes it through the same
   * `openPath()` flow the Welcome screen uses for clicked recents.
   */
  | { kind: "openRecent"; path: string }
  /**
   * UX1 — Wipe the recent-files list (the "Clear Menu" item under
   * File → Open Recent). The renderer is the source of truth for
   * the list (it owns `useFileState.recentFiles`), so the menu
   * just sends the request and the renderer clears its state +
   * persists the empty list through the existing PREFS path.
   */
  | { kind: "clearRecent" }
  /**
   * RELOAD-3 — File → Reload from Disk. Re-reads the open file from
   * disk, discarding any in-memory edits. The renderer shows a
   * confirm dialog first when there are unsaved changes.
   */
  | { kind: "reloadFromDisk" }
  /**
   * Open the About panel. On macOS this comes from the app menu, on
   * Windows and Linux from Help - both send the same action, so the
   * renderer has one place to open it from.
   */
  | { kind: "about" };

/**
 * Where the app is in the update cycle.
 *
 * One shape for every state the user can meet, so a panel showing it
 * cannot end up in a combination that does not exist - "downloading"
 * without a version, or an error with a stale percentage still on
 * screen.
 *
 * `unsupported` is a real state, not a failure - but it has two very
 * different causes, and saying the wrong one is worse than saying
 * nothing:
 *
 *   - `dev`: this is a development run. Updating is not wired up
 *     because there is nothing installed to replace. Says nothing
 *     about what the released app does.
 *   - `noChannel`: this build was made without an update feed, so it
 *     genuinely will not update itself. True of the Community
 *     edition.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  /** Checked, and this is already the newest version. */
  | { kind: "upToDate"; checkedAt: number }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  /** Downloaded and waiting. Installs itself when the app next quits. */
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported"; reason: "dev" | "noChannel" };

/**
 * Answer to "restart and install now".
 *
 * `unsaved` is the interesting one: the app is about to quit, and
 * quitting with unsaved edits is the worst thing an update could do to
 * someone. The renderer tells the user to save first; the update stays
 * downloaded and installs on the next ordinary quit either way.
 */
/** One link in the About panel. `labelKey` is an i18n key. */
export interface AppInfoLink {
  labelKey: string;
  url: string;
}

/**
 * What the About panel shows about the running build.
 *
 * `version` comes from Electron rather than from anything the renderer
 * holds, so it is the version actually running. A hard-coded version
 * on an About screen is wrong the first time somebody forgets to
 * change it, and nobody notices for months.
 */
export interface AppInfo {
  productName: string;
  version: string;
  /** "Glasshouse" or "Community". */
  edition: string;
  links: AppInfoLink[];
}

export type InstallUpdateResult =
  | { kind: "restarting" }
  | { kind: "unsaved" }
  | { kind: "notReady" };

/**
 * Result of `saveFileAs`. Same shape as `saveFile`, except `kind: "ok"`
 * carries the freshly-chosen `path` so the renderer can update the
 * tab's stored path. `kind: "cancelled"` is the new branch — the user
 * dismissed the OS dialog without picking a destination.
 */
export type SaveFileAsResult =
  | { kind: "ok"; path: string; mtimeMs: number }
  | { kind: "cancelled" };

/**
 * Payload of the `fileChangedOnDisk` event (RELOAD-2). `path` is the
 * file that changed; `currentMtimeMs` is its new on-disk mtime.
 */
export interface FileChangedOnDiskEvent {
  path: string;
  currentMtimeMs: number;
}

export interface SaveFileAsRequest {
  /**
   * The file currently open. Save-As applies the renderer's pending
   * edits ON TOP of this source, then writes the result to the path
   * the user picks in the dialog. The original file is left untouched.
   */
  sourcePath: string;
  /** Suggested filename in the OS dialog (no extension required — main adds .moliospec). */
  suggestedName: string;
  /** Edits to write — same shape as `saveFile`'s `edits`. */
  edits: EditRequest[];
}
