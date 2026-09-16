/**
 * RELOAD-Merge M1 — the merge "brain".
 *
 * A pure 3-way merge planner. Given:
 *   - `base`  — the file version the editor loaded,
 *   - `edits` — the editor's buffered edits (changes since `base`),
 *   - `disk`  — the file as it currently is on disk,
 * it works out, per buffered edit, whether it applies automatically
 * (the disk didn't touch that spot), is a genuine conflict (both
 * sides changed the same spot), or whether the whole merge must be
 * abandoned.
 *
 * Scope — Level 2: section bodies, metadata fields, and control-plan
 * cells. Structural changes (creating / deleting / renaming / moving
 * sections, deleting BDBs / work areas / control plans, custom_data)
 * are NOT merged.
 *
 * The merge is "blocked" — caller falls back to the plain discard /
 * overwrite choice — when EITHER:
 *   - a buffered edit is itself structural, OR
 *   - the disk version deleted something a buffered edit targets
 *     (a "homeless" edit — "keep mine" would mean resurrecting
 *     deleted content, which is structural).
 * A disk-side deletion of something the user did NOT edit is fine
 * and does not block: there's simply nothing to reconcile there.
 *
 * No IO, no React — pure data in, plan out. See mergeOnReload.test.ts.
 */

import type {
  BdbInfo,
  ContractInfo,
  ControlPlanHeaderData,
  ControlPlanInfo,
  ControlPlanRowData,
  EditRequest,
  FilePayload,
  ProjectInfo,
  SectionData,
  WorkSpecInfo,
} from "../../shared/ipc.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MergeUnitKind = "sectionBody" | "cpCell" | "cpTitle" | "metaField";

/**
 * One atomic, independently-resolvable change from the editor's edit
 * buffer, classified against the disk version. A section-body edit is
 * one unit; a metadata edit that set three fields is three units.
 */
export interface MergeUnit {
  /** Stable identity — also a usable React key. */
  key: string;
  kind: MergeUnitKind;
  /** Plain functional label for the dialog (M3 may localise). */
  label: string;
  /** Value in the version the editor loaded (the merge base). */
  base: string;
  /** Value the user typed (the buffered edit). */
  mine: string;
  /** Value currently on disk. */
  theirs: string;
  /**
   * The EditRequest to apply when "mine" wins. For `metaField` units
   * this is a single-field metadata edit; M4 regroups same-entity
   * units into one edit before they re-enter the edit buffer.
   */
  edit: EditRequest;
}

/** A unit where both sides changed the same spot — user must pick. */
export type MergeConflict = MergeUnit;

/** Why a merge can't proceed. */
export interface MergeBlocker {
  kind: "structural-edit" | "target-deleted";
  /** Plain description of the offending change. */
  label: string;
}

/** A top-level entity (work area, BDB, or control plan). */
export type DiskEntityKind = "workArea" | "bdb" | "controlPlan";

/**
 * One top-level entity the disk added or removed relative to the
 * loaded base. This content flows in with the merge automatically —
 * it's never a conflict — but the dialog lists it so the user isn't
 * surprised by content appearing or vanishing silently.
 */
export interface DiskEntityChange {
  kind: DiskEntityKind;
  /** The entity's display name. */
  name: string;
}

/** Top-level additions / removals the disk made on its own. */
export interface DiskDelta {
  added: DiskEntityChange[];
  removed: DiskEntityChange[];
}

/**
 * Result of {@link computeMergePlan}.
 *  - `ok`      — mergeable; surface the dialog with auto + conflicts.
 *  - `blocked` — fall back to discard / overwrite; `blockers` says why.
 */
export type MergePlan =
  | {
      kind: "ok";
      autoApplied: MergeUnit[];
      conflicts: MergeConflict[];
      /** Top-level entities the disk added/removed — purely informational. */
      diskDelta: DiskDelta;
    }
  | { kind: "blocked"; blockers: MergeBlocker[] };

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** Edit targets that are structural — never merged in Level 2. */
const STRUCTURAL_TARGETS: ReadonlySet<EditRequest["target"]> = new Set<
  EditRequest["target"]
>([
  "sectionCreate",
  "sectionRename",
  "sectionDelete",
  "bdbSectionCreate",
  "bdbSectionDelete",
  "deleteBdb",
  "deleteWorkArea",
  "deleteContract",
  "deleteControlPlan",
  "customDataSet",
  "customDataDelete",
]);

/**
 * Cheap pre-check (no disk read needed): do the buffered edits
 * contain a structural change? Used by M2's "can we offer Merge?"
 * gate before the disk file is even re-read.
 */
export function editsContainStructural(edits: EditRequest[]): boolean {
  return edits.some((e) => STRUCTURAL_TARGETS.has(e.target));
}

// ---------------------------------------------------------------------------
// Value normalisation + classification
// ---------------------------------------------------------------------------

/** Normalise any field value to a string for comparison + display.
 *  null / undefined → "", booleans → "0"/"1", everything else → String. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

type Outcome = "auto" | "conflict" | "skip" | "deleted";

/**
 * Three-way classify for one unit.
 *  - `theirs === null` means the target object is GONE on disk.
 */
function classify(base: string, mine: string, theirs: string | null): Outcome {
  if (mine === base) return "skip"; // the "edit" isn't actually a change
  if (theirs === null) return "deleted"; // disk removed the target
  if (theirs === base) return "auto"; // disk untouched → take mine
  if (mine === theirs) return "skip"; // both sides converged
  return "conflict"; // both changed it, differently
}

// ---------------------------------------------------------------------------
// Payload index
// ---------------------------------------------------------------------------

interface PayloadIndex {
  waSections: Map<number, { section: SectionData; specId: number }>;
  bdbSections: Map<number, { section: SectionData; specId: number }>;
  cpRows: Map<number, { row: ControlPlanRowData; planId: number }>;
  cpHeaders: Map<number, ControlPlanHeaderData>;
  workSpecs: Map<number, WorkSpecInfo>;
  bdbs: Map<number, BdbInfo>;
  controlPlans: Map<number, ControlPlanInfo>;
  contracts: Map<number, ContractInfo>;
  project: ProjectInfo | null;
}

function indexPayload(p: FilePayload): PayloadIndex {
  const waSections = new Map<
    number,
    { section: SectionData; specId: number }
  >();
  for (const [specIdStr, list] of Object.entries(p.sectionsByWorkSpec)) {
    const specId = Number(specIdStr);
    for (const section of list) waSections.set(section.id, { section, specId });
  }
  const bdbSections = new Map<
    number,
    { section: SectionData; specId: number }
  >();
  for (const [specIdStr, list] of Object.entries(p.sectionsByBdb)) {
    const specId = Number(specIdStr);
    for (const section of list)
      bdbSections.set(section.id, { section, specId });
  }
  const cpRows = new Map<number, { row: ControlPlanRowData; planId: number }>();
  for (const [planIdStr, list] of Object.entries(p.cpRowsByPlan)) {
    const planId = Number(planIdStr);
    for (const row of list) cpRows.set(row.id, { row, planId });
  }
  const cpHeaders = new Map<number, ControlPlanHeaderData>();
  for (const list of Object.values(p.cpHeadersByPlan)) {
    for (const h of list) cpHeaders.set(h.id, h);
  }
  return {
    waSections,
    bdbSections,
    cpRows,
    cpHeaders,
    workSpecs: new Map(p.workSpecs.map((w) => [w.id, w])),
    bdbs: new Map(p.bdbs.map((b) => [b.id, b])),
    controlPlans: new Map(p.controlPlans.map((c) => [c.id, c])),
    contracts: new Map(p.contracts.map((c) => [c.id, c])),
    project: p.project,
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STRUCTURAL_PHRASE: Record<string, string> = {
  sectionCreate: "a new section",
  sectionRename: "a renamed section heading",
  sectionDelete: "a deleted section",
  bdbSectionCreate: "a new PFBB supplement section",
  bdbSectionDelete: "a deleted PFBB supplement section",
  deleteBdb: "a deleted building element specification",
  deleteWorkArea: "a deleted work area",
  deleteContract: "a deleted contract",
  deleteControlPlan: "a deleted control plan",
  customDataSet: "a custom-data change",
  customDataDelete: "a custom-data deletion",
};

function structuralLabel(edit: EditRequest): string {
  return STRUCTURAL_PHRASE[edit.target] ?? `a ${edit.target} change`;
}

// ---------------------------------------------------------------------------
// Per-edit handling
// ---------------------------------------------------------------------------

type Route = (outcome: Outcome, unit: MergeUnit) => void;

/** Identity-mapped field lists for the metadata edit targets where
 *  the edit's field names match the entity's field names exactly. */
const WS_META_FIELDS = [
  "workAreaCode",
  "workAreaName",
  "workAreaType",
  "createdBy",
  "createdByOrganization",
  "revision",
  "revisionDate",
  "issueDate",
  "reviewedBy",
  "approvedBy",
] as const;
const BDB_META_FIELDS = [
  "name",
  "isPfbb",
  "createdBy",
  "createdByOrganization",
  "revision",
  "revisionDate",
  "issueDate",
  "reviewedBy",
  "approvedBy",
] as const;
const CP_META_FIELDS = ["revision", "revisionDate", "numberText"] as const;
const CONTRACT_FIELDS = ["contractCode", "contractName"] as const;
const CP_HEADER_FIELDS = ["header", "headerNo"] as const;
/** project: the edit spells it `molioReferencelistDate`, ProjectInfo
 *  carries the double-i typo `moliioReferencelistDate`. */
const PROJECT_FIELD_MAP: Record<string, keyof ProjectInfo> = {
  name: "name",
  projectNumber: "projectNumber",
  builder: "builder",
  molioReferencelistDate: "moliioReferencelistDate",
};

function identityMap(fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f, f]));
}

/**
 * Classify every field a metadata edit sets, one MergeUnit per field.
 */
function handleMeta(
  edit: EditRequest,
  idKey: string,
  entityName: string,
  baseEntity: Record<string, unknown> | undefined,
  diskEntity: Record<string, unknown> | undefined,
  fieldMap: Record<string, string>,
  route: Route,
): void {
  const e = edit as unknown as Record<string, unknown>;
  const idVal = e[idKey];
  for (const [editField, entityField] of Object.entries(fieldMap)) {
    if (!(editField in e)) continue; // field not set by this edit
    const editVal = e[editField];
    const mine = norm(editVal);
    const base = baseEntity ? norm(baseEntity[entityField]) : "";
    const theirs = diskEntity ? norm(diskEntity[entityField]) : null;
    const outcome = classify(base, mine, theirs);
    if (outcome === "skip") continue;
    const singleEdit = {
      target: edit.target,
      [idKey]: idVal,
      [editField]: editVal,
    } as unknown as EditRequest;
    route(outcome, {
      key: `meta:${edit.target}:${String(idVal)}:${editField}`,
      kind: "metaField",
      label: `${entityName}: ${editField}`,
      base,
      mine,
      theirs: theirs ?? "",
      edit: singleEdit,
    });
  }
}

function handleEdit(
  edit: EditRequest,
  baseIx: PayloadIndex,
  diskIx: PayloadIndex,
  route: Route,
): void {
  switch (edit.target) {
    case "workSpec":
    case "bdb": {
      const baseMap =
        edit.target === "workSpec" ? baseIx.waSections : baseIx.bdbSections;
      const diskMap =
        edit.target === "workSpec" ? diskIx.waSections : diskIx.bdbSections;
      const baseHit = baseMap.get(edit.sectionId);
      const diskHit = diskMap.get(edit.sectionId);
      const base = baseHit ? baseHit.section.body : "";
      const theirs = diskHit ? diskHit.section.body : null;
      const outcome = classify(base, edit.body, theirs);
      if (outcome === "skip") return;
      const specName = baseHit
        ? edit.target === "workSpec"
          ? (baseIx.workSpecs.get(baseHit.specId)?.workAreaName ?? "Work area")
          : (baseIx.bdbs.get(baseHit.specId)?.name ??
            "Building element specification")
        : "Section";
      route(outcome, {
        key: `sec:${edit.target}:${edit.sectionId}`,
        kind: "sectionBody",
        label: baseHit
          ? `${specName}: ${baseHit.section.heading}`
          : `Section #${edit.sectionId}`,
        base,
        mine: edit.body,
        theirs: theirs ?? "",
        edit,
      });
      return;
    }
    case "cpRow": {
      const baseHit = baseIx.cpRows.get(edit.rowId);
      const diskHit = diskIx.cpRows.get(edit.rowId);
      const base = baseHit
        ? norm((baseHit.row as unknown as Record<string, unknown>)[edit.field])
        : "";
      const theirs = diskHit
        ? norm((diskHit.row as unknown as Record<string, unknown>)[edit.field])
        : null;
      const outcome = classify(base, norm(edit.value), theirs);
      if (outcome === "skip") return;
      const cpTitle = baseHit
        ? (baseIx.controlPlans.get(baseHit.planId)?.title ?? "Control plan")
        : "Control plan";
      route(outcome, {
        key: `cpRow:${edit.rowId}:${edit.field}`,
        kind: "cpCell",
        label: `${cpTitle} — row ${baseHit?.row.sectionNo || edit.rowId}: ${edit.field}`,
        base,
        mine: norm(edit.value),
        theirs: theirs ?? "",
        edit,
      });
      return;
    }
    case "cpTitle": {
      const baseCp = baseIx.controlPlans.get(edit.controlPlanId);
      const diskCp = diskIx.controlPlans.get(edit.controlPlanId);
      const base = baseCp ? baseCp.title : "";
      const theirs = diskCp ? diskCp.title : null;
      const outcome = classify(base, edit.title, theirs);
      if (outcome === "skip") return;
      route(outcome, {
        key: `cpTitle:${edit.controlPlanId}`,
        kind: "cpTitle",
        label: `${base || `Control plan #${edit.controlPlanId}`}: title`,
        base,
        mine: edit.title,
        theirs: theirs ?? "",
        edit,
      });
      return;
    }
    case "project": {
      const name = baseIx.project?.name ?? "Project";
      handleMeta(
        edit,
        "projectGuid",
        name,
        baseIx.project as unknown as Record<string, unknown> | undefined,
        diskIx.project as unknown as Record<string, unknown> | undefined,
        PROJECT_FIELD_MAP,
        route,
      );
      return;
    }
    case "workSpecMetadata": {
      const ws = baseIx.workSpecs.get(edit.id);
      handleMeta(
        edit,
        "id",
        ws?.workAreaName ?? `Work area #${edit.id}`,
        ws as unknown as Record<string, unknown> | undefined,
        diskIx.workSpecs.get(edit.id) as unknown as
          | Record<string, unknown>
          | undefined,
        identityMap(WS_META_FIELDS),
        route,
      );
      return;
    }
    case "bdbMetadata": {
      const bdb = baseIx.bdbs.get(edit.id);
      handleMeta(
        edit,
        "id",
        bdb?.name ?? `BDB #${edit.id}`,
        bdb as unknown as Record<string, unknown> | undefined,
        diskIx.bdbs.get(edit.id) as unknown as
          | Record<string, unknown>
          | undefined,
        identityMap(BDB_META_FIELDS),
        route,
      );
      return;
    }
    case "cpMetadata": {
      const cp = baseIx.controlPlans.get(edit.id);
      handleMeta(
        edit,
        "id",
        cp?.title ?? `Control plan #${edit.id}`,
        cp as unknown as Record<string, unknown> | undefined,
        diskIx.controlPlans.get(edit.id) as unknown as
          | Record<string, unknown>
          | undefined,
        identityMap(CP_META_FIELDS),
        route,
      );
      return;
    }
    case "contractRename": {
      const c = baseIx.contracts.get(edit.id);
      const name = c?.contractName ?? c?.contractCode ?? `Contract #${edit.id}`;
      handleMeta(
        edit,
        "id",
        name,
        c as unknown as Record<string, unknown> | undefined,
        diskIx.contracts.get(edit.id) as unknown as
          | Record<string, unknown>
          | undefined,
        identityMap(CONTRACT_FIELDS),
        route,
      );
      return;
    }
    case "cpHeaderUpdate": {
      const h = baseIx.cpHeaders.get(edit.headerId);
      handleMeta(
        edit,
        "headerId",
        h?.header ?? `Header #${edit.headerId}`,
        h as unknown as Record<string, unknown> | undefined,
        diskIx.cpHeaders.get(edit.headerId) as unknown as
          | Record<string, unknown>
          | undefined,
        identityMap(CP_HEADER_FIELDS),
        route,
      );
      return;
    }
    case "workSpecContract": {
      const ws = baseIx.workSpecs.get(edit.workSpecId);
      handleMeta(
        edit,
        "workSpecId",
        ws?.workAreaName ?? `Work area #${edit.workSpecId}`,
        ws as unknown as Record<string, unknown> | undefined,
        diskIx.workSpecs.get(edit.workSpecId) as unknown as
          | Record<string, unknown>
          | undefined,
        { contractId: "contractId" },
        route,
      );
      return;
    }
    default:
      // Structural targets are filtered out before handleEdit; any
      // other target is unknown — ignore defensively.
      return;
  }
}

// ---------------------------------------------------------------------------
// Disk-side top-level additions / removals
// ---------------------------------------------------------------------------

/**
 * Diff the top-level entities (work areas, BDBs, control plans) of
 * `base` against `disk`, by id. An entity only on disk was added;
 * one only in base was removed. Pure — no edits involved; this is
 * just "what did the file gain or lose on its own".
 */
export function computeDiskDelta(
  base: FilePayload,
  disk: FilePayload,
): DiskDelta {
  const added: DiskEntityChange[] = [];
  const removed: DiskEntityChange[] = [];

  function diff<T extends { id: number }>(
    baseList: readonly T[],
    diskList: readonly T[],
    kind: DiskEntityKind,
    nameOf: (t: T) => string,
  ): void {
    const baseIds = new Set(baseList.map((t) => t.id));
    const diskIds = new Set(diskList.map((t) => t.id));
    for (const t of diskList) {
      if (!baseIds.has(t.id)) added.push({ kind, name: nameOf(t) });
    }
    for (const t of baseList) {
      if (!diskIds.has(t.id)) removed.push({ kind, name: nameOf(t) });
    }
  }

  diff(
    base.workSpecs,
    disk.workSpecs,
    "workArea",
    (w) => w.workAreaName || w.workAreaCode || `#${w.id}`,
  );
  diff(base.bdbs, disk.bdbs, "bdb", (b) => b.name || `#${b.id}`);
  diff(
    base.controlPlans,
    disk.controlPlans,
    "controlPlan",
    (c) => c.title || `#${c.id}`,
  );

  return { added, removed };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Plan a 3-way merge of the editor's buffered edits against the disk
 * version. Pure — see the module docstring for the scope + blocking
 * rules.
 */
export function computeMergePlan(
  base: FilePayload,
  edits: EditRequest[],
  disk: FilePayload,
): MergePlan {
  const baseIx = indexPayload(base);
  const diskIx = indexPayload(disk);

  const autoApplied: MergeUnit[] = [];
  const conflicts: MergeConflict[] = [];
  const blockers: MergeBlocker[] = [];

  const route: Route = (outcome, unit) => {
    if (outcome === "auto") autoApplied.push(unit);
    else if (outcome === "conflict") conflicts.push(unit);
    else if (outcome === "deleted") {
      blockers.push({ kind: "target-deleted", label: unit.label });
    }
    // "skip" → discard silently
  };

  for (const edit of edits) {
    if (STRUCTURAL_TARGETS.has(edit.target)) {
      blockers.push({ kind: "structural-edit", label: structuralLabel(edit) });
      continue;
    }
    handleEdit(edit, baseIx, diskIx, route);
  }

  if (blockers.length > 0) return { kind: "blocked", blockers };
  return {
    kind: "ok",
    autoApplied,
    conflicts,
    diskDelta: computeDiskDelta(base, disk),
  };
}
