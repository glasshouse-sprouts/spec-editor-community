/**
 * Pure helpers that power the Import modal.
 *
 * Everything here operates on plain data — no DOM, no IPC. That keeps
 * the modal state testable with vitest and keeps App.tsx free of
 * state-transition arithmetic.
 *
 * The modal-lifecycle shape we target:
 *
 *   1. User picks a source file.
 *   2. Main returns an `ImportSourceSummary` (contracts + workAreas + bdbs).
 *   3. We build a `SourceTree` from it — a Contract → WorkArea → BDB
 *      render graph with a "[No contract]" bucket and a "standalone
 *      BDBs" bucket.
 *   4. User checks items and picks landing spots. Cascade rules:
 *        - Checking a work area auto-checks all its BDBs.
 *        - Unchecking a work area auto-unchecks all its BDBs.
 *        - Individual BDBs can be unchecked without unchecking the
 *          parent work area (importing the work area "shell" is fine).
 *   5. When all checked work areas have a `landingContract` chosen
 *      (null = target's "[No contract]" bucket) and all checked
 *      *standalone* BDBs have a `landingWorkArea` chosen,
 *      `canCheck(state)` flips true. The modal enables the Check
 *      button.
 *   6. `buildImportPlan(state)` turns the state into an
 *      `ImportPlanDTO` — the DTO both precheck and apply consume.
 *
 * Collision resolution (Skip / Rename / Overwrite) happens in a
 * second pass after precheck returns. Those helpers live with the
 * collision UI (see Phase 6K.3-E).
 */

import type {
  ContractInfo,
  ImportBdbCollisionDTO,
  ImportBdbPlan,
  ImportCollisionPolicy,
  ImportPlanDTO,
  ImportPrecheckDTO,
  ImportSourceBdb,
  ImportSourceSummary,
  ImportSourceWorkArea,
  ImportWorkAreaCollisionDTO,
  ImportWorkAreaPlan,
  WorkSpecInfo,
} from "../../shared/ipc.js";
import type { WorkAreaContractMapRow } from "../../shared/defaultsCsv.js";
import { compareByName, compareCodeThenName } from "./sortHelpers.js";

// ---------------------------------------------------------------------------
// Tree shape (read-only, derived from the source summary)
// ---------------------------------------------------------------------------

export interface SourceTreeBdbNode {
  id: number;
  name: string;
}

export interface SourceTreeWorkAreaNode {
  id: number;
  workAreaCode: string | null;
  workAreaName: string;
  bdbs: SourceTreeBdbNode[];
}

export interface SourceTreeContractGroup {
  /**
   * The source's contract id this group represents, or `null` for the
   * synthetic "[No contract]" bucket that holds work areas without
   * a `contractId`.
   */
  id: number | null;
  label: string;
  workAreas: SourceTreeWorkAreaNode[];
}

export interface SourceTree {
  /** Groups for every source contract plus a trailing "[No contract]"
   * bucket when at least one work area has null `contractId`. */
  contractGroups: SourceTreeContractGroup[];
  /** BDBs whose `workSpecId` is null — they live at the tree root. */
  standaloneBdbs: SourceTreeBdbNode[];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Keep the separator in one place so the modal + rest of the app
 * stay consistent (same value as App.tsx's `CONTRACT_LABEL_SEPARATOR`). */
export const CONTRACT_LABEL_SEPARATOR = " - ";

export function contractLabel(c: {
  contractCode: string | null;
  contractName: string | null;
}): string {
  const code = (c.contractCode ?? "").trim();
  const name = (c.contractName ?? "").trim();
  if (code && name) return `${code}${CONTRACT_LABEL_SEPARATOR}${name}`;
  if (code) return code;
  if (name) return name;
  return "(unnamed contract)";
}

export function workAreaLabel(w: {
  workAreaCode: string | null;
  workAreaName: string;
}): string {
  const code = (w.workAreaCode ?? "").trim();
  const name = (w.workAreaName ?? "").trim();
  if (code && name) return `${code} ${name}`;
  if (code) return code;
  if (name) return name;
  return "(unnamed work area)";
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

/**
 * Group the flat source summary into contract → work-area → BDB
 * buckets. Orphan work areas (`contractId === null`) land in a
 * trailing "[No contract]" group. BDBs with no `workSpecId` land in
 * `standaloneBdbs` at the tree root.
 *
 * Sort order is stable and display-friendly:
 *   - Contract groups by `contractLabel` (case-insensitive);
 *     "[No contract]" always last.
 *   - Work areas within a contract by `workAreaCode` (natural-ish —
 *     we compare with `localeCompare({ numeric: true })` so "2.1"
 *     comes before "10").
 *   - BDBs within a work area, and standalone BDBs, by `name`.
 */
export function buildSourceTree(summary: ImportSourceSummary): SourceTree {
  // 1. Bucket work areas by contract id.
  const waByContract = new Map<number | null, ImportSourceWorkArea[]>();
  for (const wa of summary.workAreas) {
    const key = wa.contractId ?? null;
    const list = waByContract.get(key) ?? [];
    list.push(wa);
    waByContract.set(key, list);
  }

  // 2. Bucket BDBs by work-spec id.
  const bdbByWs = new Map<number | null, ImportSourceBdb[]>();
  for (const b of summary.bdbs) {
    const key = b.workSpecId ?? null;
    const list = bdbByWs.get(key) ?? [];
    list.push(b);
    bdbByWs.set(key, list);
  }

  const byId = new Map(summary.contracts.map((c) => [c.id, c]));

  // 3. Build one group per contract that appears in either the
  //    contracts table or the work-areas table. A contract that
  //    exists but has no work areas still shows up (empty group).
  const groupIds = new Set<number | null>();
  for (const c of summary.contracts) groupIds.add(c.id);
  for (const wa of summary.workAreas) {
    if (wa.contractId !== null) groupIds.add(wa.contractId);
  }

  const contractGroups: SourceTreeContractGroup[] = [];
  for (const id of groupIds) {
    if (id === null) continue; // handled below as "[No contract]"
    const contract = byId.get(id);
    const label = contract ? contractLabel(contract) : `Contract #${id}`; // fallback — shouldn't happen, but safe.
    contractGroups.push({
      id,
      label,
      workAreas: sortWorkAreas(waByContract.get(id) ?? []).map((wa) =>
        buildWorkAreaNode(wa, bdbByWs.get(wa.id) ?? []),
      ),
    });
  }

  // Sort contract groups alphabetically (Danish collation — Slice 10B).
  contractGroups.sort((a, b) => compareByName(a.label, b.label));

  // "[No contract]" group — trailing, only if there are any orphan
  // work areas.
  const orphans = waByContract.get(null);
  if (orphans && orphans.length > 0) {
    contractGroups.push({
      id: null,
      label: "[No contract]",
      workAreas: sortWorkAreas(orphans).map((wa) =>
        buildWorkAreaNode(wa, bdbByWs.get(wa.id) ?? []),
      ),
    });
  }

  const standaloneBdbs = sortBdbs(bdbByWs.get(null) ?? []).map((b) => ({
    id: b.id,
    name: b.name,
  }));

  return { contractGroups, standaloneBdbs };
}

function sortWorkAreas(list: ImportSourceWorkArea[]): ImportSourceWorkArea[] {
  // Slice 10B: code → name with Danish collation; code-less rows sink
  // to the bottom. Matches what the sidebar tree does so the Import
  // modal reads the same.
  return [...list].sort((a, b) =>
    compareCodeThenName(
      a.workAreaCode,
      a.workAreaName,
      b.workAreaCode,
      b.workAreaName,
    ),
  );
}

function sortBdbs(list: ImportSourceBdb[]): ImportSourceBdb[] {
  // Slice 10B: BDBs have no code column — just name, with Danish
  // collation.
  return [...list].sort((a, b) => compareByName(a.name, b.name));
}

function buildWorkAreaNode(
  wa: ImportSourceWorkArea,
  bdbs: ImportSourceBdb[],
): SourceTreeWorkAreaNode {
  return {
    id: wa.id,
    workAreaCode: wa.workAreaCode,
    workAreaName: wa.workAreaName,
    bdbs: sortBdbs(bdbs).map((b) => ({ id: b.id, name: b.name })),
  };
}

// ---------------------------------------------------------------------------
// Landing-spot defaults
// ---------------------------------------------------------------------------

/**
 * Pick the default target contract for a source work area.
 *
 * Priority:
 *   1. Exact `contractLabel` match in the target (code + name). If the
 *      source says "C01 - Fundering" and the target has the same label
 *      verbatim, land the work area there.
 *   2. Exact `contractCode` match.
 *   3. null (= "[No contract]" in the target).
 *
 * Returns `undefined` when we can't even locate the source contract,
 * which just folds to null at the call site. Keeping the explicit
 * `undefined` lets callers distinguish "couldn't decide" from "decided
 * on [No contract]" in logs.
 */
export function defaultContractForWorkArea(
  sourceContractId: number | null,
  sourceContracts: readonly ContractInfo[],
  targetContracts: readonly ContractInfo[],
): number | null {
  if (sourceContractId === null) return null;
  const src = sourceContracts.find((c) => c.id === sourceContractId);
  if (!src) return null;
  const srcLabel = contractLabel(src).toLowerCase();
  const byLabel = targetContracts.find(
    (c) => contractLabel(c).toLowerCase() === srcLabel,
  );
  if (byLabel) return byLabel.id;
  if (src.contractCode) {
    const code = src.contractCode.trim().toLowerCase();
    const byCode = targetContracts.find(
      (c) => (c.contractCode ?? "").trim().toLowerCase() === code,
    );
    if (byCode) return byCode.id;
  }
  return null;
}

/**
 * #250 — pick the landing contract for an imported work area, preferring
 * the user's default mapping (work-area code -> contract code) and falling
 * back to the existing source-contract match.
 *
 * Priority:
 *   1. Mapping: the work area's own code matches a mapping row AND that
 *      contract code exists in the target -> land there.
 *   2. Otherwise the existing `defaultContractForWorkArea` behaviour
 *      (match the source contract by label, then code).
 *
 * A mapping that points at a contract code not present in the target is
 * intentionally ignored (locked decision: fall back, never auto-create).
 */
export function pickLandingContract(params: {
  workAreaCode: string | null;
  mapping: readonly WorkAreaContractMapRow[];
  sourceContractId: number | null;
  sourceContracts: readonly ContractInfo[];
  targetContracts: readonly ContractInfo[];
}): number | null {
  const {
    workAreaCode,
    mapping,
    sourceContractId,
    sourceContracts,
    targetContracts,
  } = params;
  const code = (workAreaCode ?? "").trim().toLowerCase();
  if (code) {
    const m = mapping.find((r) => r.workAreaCode.trim().toLowerCase() === code);
    if (m) {
      const cc = m.contractCode.trim().toLowerCase();
      const byCode = targetContracts.find(
        (c) => (c.contractCode ?? "").trim().toLowerCase() === cc,
      );
      if (byCode) return byCode.id;
      // Mapped contract not in the target -> fall through to the default.
    }
  }
  return defaultContractForWorkArea(
    sourceContractId,
    sourceContracts,
    targetContracts,
  );
}

/**
 * Pick the default target work area for a standalone source BDB.
 *
 * We don't have a lot to match on — a standalone BDB has no "parent"
 * in the source. We return the first target work area alphabetically,
 * or `null` when the target has no work areas at all (the user must
 * create one first; the modal surfaces this as a blocking message).
 */
export function defaultWorkAreaForStandaloneBdb(
  targetWorkAreas: readonly WorkSpecInfo[],
): number | null {
  if (targetWorkAreas.length === 0) return null;
  // Slice 10B: same Danish code→name sort as everywhere else so the
  // "first alphabetically" definition doesn't drift.
  const sorted = [...targetWorkAreas].sort((a, b) =>
    compareCodeThenName(
      a.workAreaCode,
      a.workAreaName,
      b.workAreaCode,
      b.workAreaName,
    ),
  );
  const first = sorted[0];
  // `sorted.length > 0` is guaranteed by the early-return above, but
  // TS's noUncheckedIndexedAccess can't see through it — the explicit
  // nullish guard below keeps the compiler happy.
  return first ? first.id : null;
}

// ---------------------------------------------------------------------------
// Modal state + cascade rules
// ---------------------------------------------------------------------------

/**
 * The pure data backing the modal. React's `useState` wraps this
 * verbatim; every transition returns a *new* object so identity
 * comparisons pick up rerenders correctly.
 */
export interface ImportModalState {
  /** Source work-spec ids the user has checked. */
  checkedWorkAreas: ReadonlySet<number>;
  /** Source BDB ids the user has checked. Includes both "under a
   * checked work area" and "standalone". */
  checkedBdbs: ReadonlySet<number>;
  /** source ws id → target contract id (null = "[No contract]"). */
  landingContract: ReadonlyMap<number, number | null>;
  /** source BDB id → target work-spec id. Only populated for
   * *standalone* checked BDBs. */
  landingWorkArea: ReadonlyMap<number, number>;
}

export function emptyModalState(): ImportModalState {
  return {
    checkedWorkAreas: new Set(),
    checkedBdbs: new Set(),
    landingContract: new Map(),
    landingWorkArea: new Map(),
  };
}

/** Toggle a work area's checkbox. Cascades to every BDB under it. */
export function toggleWorkArea(
  state: ImportModalState,
  wa: SourceTreeWorkAreaNode,
  checked: boolean,
): ImportModalState {
  const nextWs = new Set(state.checkedWorkAreas);
  const nextBdbs = new Set(state.checkedBdbs);
  const nextLandingContract = new Map(state.landingContract);
  if (checked) {
    nextWs.add(wa.id);
    for (const b of wa.bdbs) nextBdbs.add(b.id);
  } else {
    nextWs.delete(wa.id);
    for (const b of wa.bdbs) nextBdbs.delete(b.id);
    nextLandingContract.delete(wa.id);
  }
  return {
    ...state,
    checkedWorkAreas: nextWs,
    checkedBdbs: nextBdbs,
    landingContract: nextLandingContract,
  };
}

/** Toggle a single BDB's checkbox. Does NOT affect its parent work
 * area (see buildSourceTree docstring for why). */
export function toggleBdb(
  state: ImportModalState,
  bdbId: number,
  checked: boolean,
): ImportModalState {
  const nextBdbs = new Set(state.checkedBdbs);
  const nextLandingWorkArea = new Map(state.landingWorkArea);
  if (checked) nextBdbs.add(bdbId);
  else {
    nextBdbs.delete(bdbId);
    nextLandingWorkArea.delete(bdbId);
  }
  return {
    ...state,
    checkedBdbs: nextBdbs,
    landingWorkArea: nextLandingWorkArea,
  };
}

/** Set the landing contract for a checked work area. Pass `null` for
 * "[No contract]". */
export function setLandingContract(
  state: ImportModalState,
  sourceWorkSpecId: number,
  targetContractId: number | null,
): ImportModalState {
  const next = new Map(state.landingContract);
  next.set(sourceWorkSpecId, targetContractId);
  return { ...state, landingContract: next };
}

/** Set the landing work area for a checked *standalone* BDB. */
export function setLandingWorkArea(
  state: ImportModalState,
  sourceBdbId: number,
  targetWorkSpecId: number,
): ImportModalState {
  const next = new Map(state.landingWorkArea);
  next.set(sourceBdbId, targetWorkSpecId);
  return { ...state, landingWorkArea: next };
}

// ---------------------------------------------------------------------------
// Gate for the Check button
// ---------------------------------------------------------------------------

/**
 * True when the state is ready to be sent to `importPrecheck`:
 *   - At least one thing is checked.
 *   - Every checked work area has a `landingContract` entry (null is
 *     a valid value — "[No contract]").
 *   - Every checked *standalone* BDB has a `landingWorkArea` entry.
 *     BDBs under a checked work area don't need a landing work area —
 *     they ride along with the parent.
 */
export function canCheck(state: ImportModalState, tree: SourceTree): boolean {
  const totalChecked = state.checkedWorkAreas.size + state.checkedBdbs.size;
  if (totalChecked === 0) return false;

  // Work-area landing contracts.
  for (const wsId of state.checkedWorkAreas) {
    if (!state.landingContract.has(wsId)) return false;
  }

  // Standalone BDBs need a landing work area.
  const standaloneIds = new Set(tree.standaloneBdbs.map((b) => b.id));
  for (const bdbId of state.checkedBdbs) {
    if (!standaloneIds.has(bdbId)) continue;
    if (!state.landingWorkArea.has(bdbId)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

/**
 * Turn the modal state into an `ImportPlanDTO` ready to send to
 * `importPrecheck` or `importApply`.
 *
 * Collision policy is always "skip" here — the user resolves
 * collisions after precheck runs. Callers that *re-run* apply after
 * precheck pass in a `resolutions` map that overrides the default.
 */
export function buildImportPlan(
  state: ImportModalState,
  tree: SourceTree,
  resolutions?: {
    workAreas?: ReadonlyMap<
      number,
      {
        policy: ImportCollisionPolicy;
        renamedCode?: string | null;
        renamedName?: string;
      }
    >;
    bdbs?: ReadonlyMap<
      number,
      { policy: ImportCollisionPolicy; renamedName?: string }
    >;
  },
): ImportPlanDTO {
  const standaloneIds = new Set(tree.standaloneBdbs.map((b) => b.id));
  const bdbsByWorkArea = new Map<number, Set<number>>();
  for (const group of tree.contractGroups) {
    for (const wa of group.workAreas) {
      bdbsByWorkArea.set(wa.id, new Set(wa.bdbs.map((b) => b.id)));
    }
  }

  const workAreas: ImportWorkAreaPlan[] = [];
  for (const wsId of state.checkedWorkAreas) {
    const allBdbs = bdbsByWorkArea.get(wsId) ?? new Set<number>();
    const checkedSubset = [...allBdbs].filter((id) =>
      state.checkedBdbs.has(id),
    );
    // includeBdbIds convention: omit when *all* are checked (core
    // reads "undefined" as "everything"); otherwise list explicitly.
    const includeBdbIds =
      checkedSubset.length === allBdbs.size ? undefined : checkedSubset;

    const res = resolutions?.workAreas?.get(wsId);
    const onCollision = res?.policy ?? "skip";
    const plan: ImportWorkAreaPlan = {
      sourceWorkSpecId: wsId,
      targetContractId: state.landingContract.get(wsId) ?? null,
      onCollision,
    };
    if (includeBdbIds !== undefined) plan.includeBdbIds = includeBdbIds;
    if (res?.renamedCode !== undefined) plan.renamedCode = res.renamedCode;
    if (res?.renamedName !== undefined) plan.renamedName = res.renamedName;
    workAreas.push(plan);
  }

  // Standalone BDBs: each becomes its own entry in plan.bdbs.
  const bdbs: ImportBdbPlan[] = [];
  for (const bdbId of state.checkedBdbs) {
    if (!standaloneIds.has(bdbId)) continue;
    const target = state.landingWorkArea.get(bdbId);
    if (target === undefined) continue; // defensive; canCheck guards this.
    const res = resolutions?.bdbs?.get(bdbId);
    const plan: ImportBdbPlan = {
      sourceBdbId: bdbId,
      targetWorkSpecId: target,
      onCollision: res?.policy ?? "skip",
    };
    if (res?.renamedName !== undefined) plan.renamedName = res.renamedName;
    bdbs.push(plan);
  }

  return { workAreas, bdbs };
}

// ---------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------

/**
 * How the user wants to resolve one work-area collision. `renamedCode`
 * and `renamedName` are only meaningful when `policy === "rename"` —
 * for other policies they're ignored and may be omitted.
 */
export interface WorkAreaResolution {
  policy: ImportCollisionPolicy;
  renamedCode?: string | null;
  renamedName?: string;
}

export interface BdbResolution {
  policy: ImportCollisionPolicy;
  renamedName?: string;
}

export type ResolutionsMap = {
  workAreas: ReadonlyMap<number, WorkAreaResolution>;
  bdbs: ReadonlyMap<number, BdbResolution>;
};

/**
 * Fresh default for each collision.
 *
 * Work areas default to **"merge"** (FIX-ImportMerge 2026-05-11) —
 * the most common intent when a user re-imports a newer spec into a
 * project they've already started annotating is "fold the new BDBs
 * into the work area I've already started; don't touch what I've
 * already done." `merge` keeps the existing target work area
 * untouched and just brings the source's BDBs in under it.
 *
 * BDBs default to "skip" (unchanged): a BDB collision is rare and
 * usually means the user already has the row; skipping is the safe
 * default.
 *
 * Both defaults need no extra input from the user, so the Import
 * button is immediately enabled right after Check.
 */
export function defaultResolutions(precheck: ImportPrecheckDTO): {
  workAreas: Map<number, WorkAreaResolution>;
  bdbs: Map<number, BdbResolution>;
} {
  const workAreas = new Map<number, WorkAreaResolution>();
  for (const c of precheck.workAreaCollisions) {
    workAreas.set(c.sourceWorkSpecId, { policy: "merge" });
  }
  const bdbs = new Map<number, BdbResolution>();
  for (const c of precheck.bdbCollisions) {
    bdbs.set(c.sourceBdbId, { policy: "skip" });
  }
  return { workAreas, bdbs };
}

/**
 * Index of collisions by source id. Convenient for the tree render,
 * which has to ask "does *this* row have a collision?" a lot.
 */
export interface CollisionIndex {
  workAreaBySourceId: ReadonlyMap<number, ImportWorkAreaCollisionDTO>;
  bdbBySourceId: ReadonlyMap<number, ImportBdbCollisionDTO>;
}
export function indexCollisions(precheck: ImportPrecheckDTO): CollisionIndex {
  const wa = new Map<number, ImportWorkAreaCollisionDTO>();
  for (const c of precheck.workAreaCollisions) wa.set(c.sourceWorkSpecId, c);
  const bdb = new Map<number, ImportBdbCollisionDTO>();
  for (const c of precheck.bdbCollisions) bdb.set(c.sourceBdbId, c);
  return { workAreaBySourceId: wa, bdbBySourceId: bdb };
}

/**
 * Gate for the Import button. Assumes `canCheck` already returned true
 * AND a precheck has been run (otherwise Import is hidden/disabled).
 *
 *   - Every collision has a resolution entry (defaultResolutions
 *     ensures this right after the precheck returns).
 *   - Every resolution with `policy === "rename"` has a non-empty
 *     name. Work-area rename also requires a name (code may be null,
 *     mirroring the schema).
 */
export function canImport(
  resolutions: ResolutionsMap,
  precheck: ImportPrecheckDTO,
): boolean {
  for (const c of precheck.workAreaCollisions) {
    const r = resolutions.workAreas.get(c.sourceWorkSpecId);
    if (!r) return false;
    if (r.policy === "rename") {
      if (!r.renamedName || !r.renamedName.trim()) return false;
    }
  }
  for (const c of precheck.bdbCollisions) {
    const r = resolutions.bdbs.get(c.sourceBdbId);
    if (!r) return false;
    if (r.policy === "rename") {
      if (!r.renamedName || !r.renamedName.trim()) return false;
    }
  }
  return true;
}
