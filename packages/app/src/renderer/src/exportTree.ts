/**
 * Pure helpers for the Batch-Export modal.
 *
 * Everything here operates on plain data — no DOM, no IPC. Keeps the
 * modal state testable with vitest and keeps state-transition logic
 * out of the React component.
 *
 * Shape of the tree we render:
 *
 *   Contract "01 - Fagentreprise"
 *     Work area "2.5 Beton"
 *       BDB "2.5.1 Fundering"
 *       BDB "2.5.2 Dæk"
 *     Work area "3 Konstruktioner"
 *   [No contract]
 *     Work area "X"
 *   Standalone BDBs        <- BDBs with workSpecId === null
 *     BDB "orphan"
 *   Control plans          <- flat list, always at the bottom
 *     CP "3.1 Kontrolplan"  ...
 *
 * Selection rules (kept intentionally simple):
 *
 *   - Every leaf (work area, BDB, CP) has its own checkbox.
 *   - A parent row (contract, work area) is indeterminate when some of
 *     its leaves are checked, checked when all are, unchecked when none
 *     are. Clicking a parent toggles ALL its descendants.
 *   - Checking a work area doesn't auto-check its BDBs or its CPs —
 *     the user explicitly picks each file they want. This is different
 *     from the Import modal (where work areas cascade) because for
 *     export every selected item becomes a separate PDF on disk.
 *   - A standalone BDB (workSpecId null) just lives under its own
 *     "Standalone BDBs" bucket.
 */

import type {
  BdbInfo,
  ContractInfo,
  ControlPlanInfo,
  FilePayload,
  WorkSpecInfo,
} from "../../shared/ipc.js";
import { formatContractLabel } from "./ExportCardLabels.js";
import { compareByName, compareCodeThenName } from "./sortHelpers.js";

// ---------------------------------------------------------------------------
// Tree shape (read-only, derived from the loaded FilePayload).
// ---------------------------------------------------------------------------

export interface ExportTreeBdbNode {
  id: number;
  label: string;
}

export interface ExportTreeWorkAreaNode {
  id: number;
  label: string;
  bdbs: ExportTreeBdbNode[];
}

export interface ExportTreeContractGroup {
  /** Contract id, or null for the synthetic "[No contract]" bucket. */
  id: number | null;
  label: string;
  workAreas: ExportTreeWorkAreaNode[];
}

export interface ExportTreeCpNode {
  id: number;
  label: string;
  /** Owning BDB's label, e.g. "2.5.1 Fundering". Null when homeless. */
  ownerLabel: string | null;
  /**
   * Id of the BDB that "owns" this CP (first BDB that references it
   * via `controlPlanIds`). Null when the CP is homeless — no BDB
   * references it, usually because the BDB was deleted out from
   * under it. Used by the batch-export modal to nest CPs under
   * their BDB row, mirroring the project tree.
   */
  owningBdbId: number | null;
}

export interface ExportTree {
  contractGroups: ExportTreeContractGroup[];
  /** BDBs with `workSpecId === null`. Usually empty. */
  standaloneBdbs: ExportTreeBdbNode[];
  /** All control plans, flat. CP ordering matches payload order. */
  controlPlans: ExportTreeCpNode[];
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

/**
 * Build the render tree from a loaded file payload.
 *
 * Pure: same input → same output. The UI renders straight from this
 * and doesn't mutate it — selection state lives in a separate
 * `ExportSelection` object (below).
 */
export function buildExportTree(data: FilePayload): ExportTree {
  // Contract id → display label. Keeps the same "code - name" format
  // the sidebar uses, via the shared helper.
  const labelByContract = new Map<number, string>();
  for (const c of data.contracts) {
    labelByContract.set(c.id, formatContractLabel(c) ?? "(unnamed contract)");
  }

  // Work area → its display label (for CP owner resolution).
  const wsLabelById = new Map<number, string>();
  for (const ws of data.workSpecs) {
    wsLabelById.set(ws.id, workAreaLabel(ws));
  }

  // Group work areas by contract id (null → "No contract").
  const byContract = new Map<number | null, WorkSpecInfo[]>();
  for (const ws of data.workSpecs) {
    const key = ws.contractId ?? null;
    const arr = byContract.get(key);
    if (arr) arr.push(ws);
    else byContract.set(key, [ws]);
  }

  // BDBs bucketed by work-spec id (null → standalone).
  const bdbsByWs = new Map<number | null, BdbInfo[]>();
  for (const b of data.bdbs) {
    const key = b.workSpecId ?? null;
    const arr = bdbsByWs.get(key);
    if (arr) arr.push(b);
    else bdbsByWs.set(key, [b]);
  }

  const contractGroups: ExportTreeContractGroup[] = [];

  // Walk contracts alphabetically (code then name, Danish collator)
  // so the modal matches the sidebar / Project Overview tree, which
  // also alphabetises (slice 10B). The "No contract" bucket (if any)
  // sticks to the bottom regardless of sort.
  const sortedContracts = [...data.contracts].sort((a, b) =>
    compareCodeThenName(
      a.contractCode,
      a.contractName,
      b.contractCode,
      b.contractName,
    ),
  );
  for (const c of sortedContracts) {
    const wsArr = byContract.get(c.id);
    if (!wsArr || wsArr.length === 0) continue;
    const sortedWs = [...wsArr].sort((a, b) =>
      compareCodeThenName(
        a.workAreaCode,
        a.workAreaName,
        b.workAreaCode,
        b.workAreaName,
      ),
    );
    contractGroups.push({
      id: c.id,
      label: labelByContract.get(c.id) ?? "(unnamed contract)",
      workAreas: sortedWs.map((ws) => buildWorkAreaNode(ws, bdbsByWs)),
    });
  }
  const noContract = byContract.get(null);
  if (noContract && noContract.length > 0) {
    const sortedWs = [...noContract].sort((a, b) =>
      compareCodeThenName(
        a.workAreaCode,
        a.workAreaName,
        b.workAreaCode,
        b.workAreaName,
      ),
    );
    contractGroups.push({
      id: null,
      label: "[No contract]",
      workAreas: sortedWs.map((ws) => buildWorkAreaNode(ws, bdbsByWs)),
    });
  }

  const standaloneBdbs: ExportTreeBdbNode[] = [...(bdbsByWs.get(null) ?? [])]
    .sort((a, b) => compareByName(a.name, b.name))
    .map((b) => ({
      id: b.id,
      label: b.name || "(unnamed building element specification)",
    }));

  const controlPlans: ExportTreeCpNode[] = data.controlPlans.map((cp) =>
    buildCpNode(cp, data.bdbs, wsLabelById),
  );

  return { contractGroups, standaloneBdbs, controlPlans };
}

function buildWorkAreaNode(
  ws: WorkSpecInfo,
  bdbsByWs: Map<number | null, BdbInfo[]>,
): ExportTreeWorkAreaNode {
  // Sort BDBs alphabetically by name (BDBs carry no code) — matches
  // the Sidebar / Project Overview tree and the import modal.
  const sortedBdbs = [...(bdbsByWs.get(ws.id) ?? [])].sort((a, b) =>
    compareByName(a.name, b.name),
  );
  return {
    id: ws.id,
    label: workAreaLabel(ws),
    bdbs: sortedBdbs.map((b) => ({
      id: b.id,
      label: b.name || "(unnamed building element specification)",
    })),
  };
}

function workAreaLabel(ws: WorkSpecInfo): string {
  const name = ws.workAreaName || "(unnamed work area)";
  return ws.workAreaCode ? `${ws.workAreaCode} ${name}` : name;
}

function buildCpNode(
  cp: ControlPlanInfo,
  bdbs: BdbInfo[],
  wsLabelById: Map<number, string>,
): ExportTreeCpNode {
  // Find the first BDB that references this CP. Same rule as the
  // single-export dropdown uses — if a CP is shared (Icebox #103)
  // only the first owner gets listed for the label.
  const ownerBdb = bdbs.find((b) => b.controlPlanIds.includes(cp.id)) ?? null;
  let ownerLabel: string | null = null;
  if (ownerBdb) {
    const parentLbl =
      ownerBdb.workSpecId != null ? wsLabelById.get(ownerBdb.workSpecId) : null;
    const bdbLbl = ownerBdb.name || `BDB ${ownerBdb.id}`;
    ownerLabel = parentLbl ? `${parentLbl} · ${bdbLbl}` : bdbLbl;
  }
  const num = cp.numberText ? `${cp.numberText}  ` : "";
  return {
    id: cp.id,
    label: `${num}${cp.title || "(untitled CP)"}`,
    ownerLabel,
    owningBdbId: ownerBdb?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Selection state (immutable — caller replaces on every change).
// ---------------------------------------------------------------------------

/**
 * Which leaves are ticked. Three Sets, keyed by id, one per kind.
 * A Set keeps the state tiny (vs. storing `false` entries) and the
 * membership check O(1) for every checkbox render.
 */
export interface ExportSelection {
  workAreas: ReadonlySet<number>;
  bdbs: ReadonlySet<number>;
  cps: ReadonlySet<number>;
}

/** Empty starting selection. Used as `useState`'s initial value. */
export function emptySelection(): ExportSelection {
  return {
    workAreas: new Set<number>(),
    bdbs: new Set<number>(),
    cps: new Set<number>(),
  };
}

/** True when nothing is ticked. */
export function isEmptySelection(sel: ExportSelection): boolean {
  return sel.workAreas.size === 0 && sel.bdbs.size === 0 && sel.cps.size === 0;
}

/** Total number of ticked leaves, across all three kinds. */
export function selectionCount(sel: ExportSelection): number {
  return sel.workAreas.size + sel.bdbs.size + sel.cps.size;
}

/**
 * Flip one leaf in the selection. Caller swaps in the returned Set
 * (React immutable-update pattern — never mutate the existing Set).
 */
export function toggleLeaf(
  sel: ExportSelection,
  kind: "workArea" | "bdb" | "cp",
  id: number,
): ExportSelection {
  if (kind === "workArea")
    return { ...sel, workAreas: toggleInSet(sel.workAreas, id) };
  if (kind === "bdb") return { ...sel, bdbs: toggleInSet(sel.bdbs, id) };
  return { ...sel, cps: toggleInSet(sel.cps, id) };
}

function toggleInSet(s: ReadonlySet<number>, id: number): Set<number> {
  const out = new Set(s);
  if (out.has(id)) out.delete(id);
  else out.add(id);
  return out;
}

/**
 * Three-state: 'none', 'some', 'all'. Rendered as:
 *   none → unchecked box
 *   some → dash / indeterminate
 *   all  → fully checked box
 */
export type TriState = "none" | "some" | "all";

/** Tri-state for one work area (considers the WA itself + its BDBs). */
export function workAreaState(
  sel: ExportSelection,
  wa: ExportTreeWorkAreaNode,
): TriState {
  const total = 1 + wa.bdbs.length; // WA + BDBs
  let hit = sel.workAreas.has(wa.id) ? 1 : 0;
  for (const b of wa.bdbs) if (sel.bdbs.has(b.id)) hit += 1;
  if (hit === 0) return "none";
  if (hit === total) return "all";
  return "some";
}

/** Tri-state for one contract group (considers every WA + BDB in it). */
export function contractGroupState(
  sel: ExportSelection,
  group: ExportTreeContractGroup,
): TriState {
  let total = 0;
  let hit = 0;
  for (const wa of group.workAreas) {
    total += 1 + wa.bdbs.length;
    if (sel.workAreas.has(wa.id)) hit += 1;
    for (const b of wa.bdbs) if (sel.bdbs.has(b.id)) hit += 1;
  }
  if (total === 0) return "none";
  if (hit === 0) return "none";
  if (hit === total) return "all";
  return "some";
}

/**
 * Toggle every descendant of a work area together. If anything is
 * ticked → everything gets unticked; otherwise everything gets ticked.
 */
export function toggleWorkArea(
  sel: ExportSelection,
  wa: ExportTreeWorkAreaNode,
): ExportSelection {
  const state = workAreaState(sel, wa);
  const want = state !== "all";
  const nextWa = new Set(sel.workAreas);
  const nextBdbs = new Set(sel.bdbs);
  if (want) {
    nextWa.add(wa.id);
    for (const b of wa.bdbs) nextBdbs.add(b.id);
  } else {
    nextWa.delete(wa.id);
    for (const b of wa.bdbs) nextBdbs.delete(b.id);
  }
  return { ...sel, workAreas: nextWa, bdbs: nextBdbs };
}

/** Toggle every descendant of an entire contract group. */
export function toggleContractGroup(
  sel: ExportSelection,
  group: ExportTreeContractGroup,
): ExportSelection {
  const state = contractGroupState(sel, group);
  const want = state !== "all";
  const nextWa = new Set(sel.workAreas);
  const nextBdbs = new Set(sel.bdbs);
  for (const wa of group.workAreas) {
    if (want) nextWa.add(wa.id);
    else nextWa.delete(wa.id);
    for (const b of wa.bdbs) {
      if (want) nextBdbs.add(b.id);
      else nextBdbs.delete(b.id);
    }
  }
  return { ...sel, workAreas: nextWa, bdbs: nextBdbs };
}

/** Check or clear every leaf in the tree in one shot. */
export function selectAll(tree: ExportTree, checked: boolean): ExportSelection {
  if (!checked) return emptySelection();
  const waIds = new Set<number>();
  const bdbIds = new Set<number>();
  const cpIds = new Set<number>();
  for (const g of tree.contractGroups) {
    for (const wa of g.workAreas) {
      waIds.add(wa.id);
      for (const b of wa.bdbs) bdbIds.add(b.id);
    }
  }
  for (const b of tree.standaloneBdbs) bdbIds.add(b.id);
  for (const cp of tree.controlPlans) cpIds.add(cp.id);
  return { workAreas: waIds, bdbs: bdbIds, cps: cpIds };
}

// ---------------------------------------------------------------------------
// Batch target list — what the caller feeds into buildBytesFor().
// ---------------------------------------------------------------------------

/**
 * One item to export. Caller combines this with `buildBytesFor` (in
 * ExportCard) to actually produce PDF bytes.
 */
export type ExportTarget =
  | { kind: "workSpec"; id: number }
  | { kind: "bdb"; id: number }
  | { kind: "cp"; id: number };

/**
 * Flatten the selection to a stable-ordered list of targets. Order
 * matches the tree: contracts → work areas → BDBs, then standalone
 * BDBs, then CPs. Caller can count this array (for the status line)
 * or iterate (to build bytes).
 */
export function selectionToTargets(
  tree: ExportTree,
  sel: ExportSelection,
): ExportTarget[] {
  const out: ExportTarget[] = [];
  for (const g of tree.contractGroups) {
    for (const wa of g.workAreas) {
      if (sel.workAreas.has(wa.id)) out.push({ kind: "workSpec", id: wa.id });
      for (const b of wa.bdbs) {
        if (sel.bdbs.has(b.id)) out.push({ kind: "bdb", id: b.id });
      }
    }
  }
  for (const b of tree.standaloneBdbs) {
    if (sel.bdbs.has(b.id)) out.push({ kind: "bdb", id: b.id });
  }
  for (const cp of tree.controlPlans) {
    if (sel.cps.has(cp.id)) out.push({ kind: "cp", id: cp.id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filename collision-safe helpers — re-exported from the shared module
// so main (main-side write path) and renderer (tests + preview UI) use
// identical logic. See `../../shared/pdfExportUtils.ts`.
// ---------------------------------------------------------------------------

export {
  dedupeFileBases,
  dedupeAgainstDisk,
} from "../../shared/pdfExportUtils.js";
