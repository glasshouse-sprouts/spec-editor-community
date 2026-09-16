/**
 * Project tree sidebar.
 *
 * Layout (Wave 3B — contract grouping):
 *   Project
 *   ▾ E00 - Generelle beskrivelser          ← contract group header
 *     ▾ Work Area A
 *       ▾ BDB 1
 *           Control plan 1a
 *           Control plan 1b
 *       ▸ BDB 2
 *     ▾ Work Area B
 *         BDB 3   (no control plan references)
 *   ▾ Uden kontrakt                         ← workSpecs with no contract
 *     ▾ Work Area C
 *   (BDBs without work area …)
 *   (Unlinked control plans …)
 *
 * Control plans are nested under the BDBs that reference them (via the
 * `controlplan_design_id` / `controlplan_production_id` columns).
 * Control plans NOT referenced by any BDB appear in a fallback
 * "Unlinked control plans" group at the bottom.
 *
 * Grouping uses the *effective* contract: i.e. if the user right-clicks
 * "Move to contract…" to reassign a work area, the tree re-groups
 * immediately (before save) so the change is visible.
 */

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EyeOff as EyeOffIcon } from "lucide-react";

import type {
  AttachmentInfo,
  BdbInfo,
  ContractInfo,
  ControlPlanInfo,
  FilePayload,
  WorkSpecInfo,
} from "../../shared/ipc.js";
import { isContractEmpty } from "./emptyNodes.js";
import { readHideEmpty, writeHideEmpty } from "./emptyNodesPrefs.js";
import { bucketVisibility } from "./homelessBuckets.js";
import { useT } from "./i18n/i18n.js";
import { findBdbById } from "./loaded.js";
import { prefStore } from "./prefs.js";
import { compareCodeThenName } from "./sortHelpers.js";
import type { TabTarget } from "./tabs.js";

interface Props {
  data: FilePayload;
  /** Which node is currently highlighted — comes from the active tab. */
  selection: TabTarget;
  /** Called when the user clicks a node. The host decides whether to open
   *  a new tab or focus an existing one. */
  onSelect: (s: TabTarget) => void;
  /** Right-click entry point for BDB nodes in the tree. The host opens
   *  the rename dialog and performs the IPC call; the sidebar just
   *  surfaces the menu item. Optional so the collapsed rail can skip
   *  it and the tests can render the sidebar standalone. */
  onDuplicateBdb?: (bdbId: number) => void;
  /** Right-click on a BDB that has `isPfbb=true` → "Create PFBB child…"
   *  (Slice 10H.5). Host opens the picker modal and runs the IPC call.
   *  Hidden when the BDB is not a PFBB master — regular BDBs and children
   *  (subscribers with `pfbbId != null`) never show this item. */
  onCreatePfbbChild?: (bdbId: number) => void;
  /** Right-click on a BDB → "New control plan…". Host opens its slot
   *  picker dialog; sidebar just surfaces the item. */
  onNewControlPlan?: (bdbId: number) => void;
  /** Right-click on a CP tree node → "Delete control plan". Host
   *  confirms and runs the IPC call. */
  onDeleteControlPlan?: (controlPlanId: number) => void;
  /** Right-click on a CP tree node → "Move to specification…" (Slice
   *  6O.4 — #112). Host opens the picker modal and runs the IPC move.
   *  Optional — when absent, the menu item is hidden. */
  onMoveControlPlan?: (controlPlanId: number) => void;
  /** Right-click on a work-area tree node → "Move to contract…". Host
   *  opens a picker modal and records the pending edit. Optional —
   *  when absent, the menu item is hidden. */
  onMoveWorkSpecToContract?: (workSpecId: number) => void;
  /** Right-click on a work-area tree node → "Delete…". Host opens the
   *  confirm modal (which runs the pre-flight impact query) and, on
   *  confirm, runs the IPC delete. Optional — when absent, the menu
   *  item is hidden. (Slice 6J) */
  onDeleteWorkSpec?: (workSpecId: number) => void;
  /** Right-click on a BDB tree node → "Delete…". Same pattern as
   *  `onDeleteWorkSpec`. (Slice 6J) */
  onDeleteBdb?: (bdbId: number) => void;
  /** Right-click on a work-area tree node → "Edit metadata…". Host
   *  opens the EditWorkSpecModal (Slice 10E). Optional — when absent,
   *  the menu item is hidden. */
  onRequestEditWorkSpec?: (workSpecId: number) => void;
  /** Right-click on a BDB tree node → "Edit metadata…". Host opens
   *  the EditBdbModal (Slice 10E). Optional — when absent, hidden. */
  onRequestEditBdb?: (bdbId: number) => void;
  /** Right-click on a work-area tree node → "Attachments…". Host opens
   *  the AttachmentsModal (Slice 10K). Optional — when absent, hidden.
   *
   *  Molio 2.0 compliance: the `attachment` table's FK targets
   *  `work_spec(id)` (i.e. the work area, Danish "arbejdsbeskrivelse") —
   *  NOT the BDB / construction_element_spec. One work area can own
   *  many attachments; its BDBs inherit visibility of those files. */
  onManageAttachments?: (workSpecId: number) => void;
  /** SPLIT-Merge (#248) — open the FillFromStandardModal for a work
   *  area. Caller decides whether to enable the menu item; we only
   *  show the entry when this callback is provided AND the work area
   *  has zero sections (the empty-shell case). */
  onFillFromStandard?: (workSpecId: number) => void;
  /** SPLIT-Merge — sets of work-spec ids that are eligible for the
   *  fill-from-standard action (i.e. they have zero sections). Built
   *  once per render at the App level for cheap lookup. */
  fillFromStandardEligible?: ReadonlySet<number>;
  /**
   * Slice 10K.8 — per-attachment actions surfaced on the tree leaf.
   * Each row appears under the work-area's "Attachments (N)" group.
   *
   * - Double-click a row → `onRequestOpenAttachment` (write temp + OS open)
   * - Right-click → Rename / Delete / Move submenu
   *
   * All four are optional — when absent the corresponding menu item / action
   * is hidden (used by tests + the collapsed rail).
   */
  onRequestOpenAttachment?: (attachmentId: number) => void;
  onRequestRenameAttachment?: (attachmentId: number) => void;
  onRequestDeleteAttachment?: (attachmentId: number) => void;
  onRequestMoveAttachment?: (attachmentId: number) => void;
  /** Right-click on a control-plan tree node → "Edit metadata…". Host
   *  opens the EditCpModal (Slice 10F). Optional — when absent, the
   *  menu item is hidden. */
  onRequestEditCp?: (controlPlanId: number) => void;
  /**
   * Slice 6M — buffered-delete predicates. When any of these return
   * true, the row is rendered strikethrough + muted and its
   * right-click menu flips the delete item to "Restore".
   *
   * The App implementation folds in the cascade: a BDB is considered
   * pending-delete if its direct `markDelete` patch is present OR its
   * parent work area is pending OR its parent contract is pending.
   * Same logic for work areas (direct or contract pending).
   */
  isContractPendingDelete?: (contractId: number) => boolean;
  isWorkSpecPendingDelete?: (workSpecId: number) => boolean;
  isBdbPendingDelete?: (bdbId: number) => boolean;
  /**
   * FIX-DelCpStrike 2026-05-11. True when this control plan is
   * pending-delete — either directly (`markDelete("controlPlan",
   * id)`) or via cascade because its parent BDB has a delete patch
   * with `deleteControlPlans: true`. Render strikethrough + flip the
   * right-click "Delete" menu item to "Restore".
   */
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
  /**
   * Right-click on a pending-deleted row → "Restore". Dropping the
   * patch takes the row out of the pending-delete state. Separate
   * callbacks per entity kind so we don't leak the `DeleteEntityKind`
   * type to the sidebar.
   */
  onRestoreContract?: (contractId: number) => void;
  onRestoreWorkSpec?: (workSpecId: number) => void;
  onRestoreBdb?: (bdbId: number) => void;
  onRestoreControlPlan?: (controlPlanId: number) => void;
  /**
   * Slice 10H.6d — true for the virtual "Projektfælles
   * bygningsdelsbeskrivelser" work_spec. When provided and returns
   * true, the sidebar hides all mutating actions on that row (Edit
   * metadata, Attachments, Move to contract, Delete) and on its
   * Attachments group. The row itself still renders so PFBB masters
   * inside it stay discoverable. Optional — when absent (tests,
   * legacy callers), every row is treated as a regular work area.
   */
  isVirtualWorkSpec?: (workSpecId: number) => boolean;
  /**
   * Contract-aware grouping (Wave 3B). All three helpers are optional
   * so tests and older callers can render the sidebar with raw data.
   *
   * - `effectiveContractCodeFor` / `effectiveContractNameFor` — read
   *   the user's buffered rename so group headers reflect pending edits.
   * - `effectiveWorkSpecContractFor` — read the user's buffered
   *   reassignment so a work area shows under the new group before save.
   *
   * When any helper is absent, grouping falls back to raw payload data.
   */
  effectiveContractCodeFor?: (
    contractId: number,
    originalCode: string | null,
  ) => string | null;
  effectiveContractNameFor?: (
    contractId: number,
    originalName: string | null,
  ) => string | null;
  effectiveWorkSpecContractFor?: (
    workSpecId: number,
    originalContractId: number | null,
  ) => number | null;
  /** When true, render a thin icon-only rail instead of the full tree.
   *  Spec §7.1 keeps the project nav "always visible" so the rail never
   *  hides completely — it only shrinks. */
  collapsed?: boolean;
  /**
   * Toggle handler for the new collapse/expand button that now lives
   * *inside* the sidebar (to the left of the filter input in the
   * expanded tree, as the topmost rail icon in the collapsed rail).
   * Host owns the actual preference state; the sidebar just fires the
   * callback. Optional — when absent, we hide the button (e.g. the
   * embedded Project Overview tree doesn't need it).
   */
  onToggleCollapsed?: () => void;
  /**
   * Phase 10 Slice 10C — when true, render with no fixed width /
   * border / elevated background so the component can live inside a
   * grid cell (Project Overview's 2fr column) and fill whatever space
   * the parent gives it. Purely a styling flag — the internal tree,
   * filter, and right-click menus behave exactly the same. Ignored
   * when `collapsed` is true (the rail has its own geometry).
   */
  embedded?: boolean;
}

/**
 * Label shown for a contract group header in the sidebar. Same format
 * as `contractLabel()` in App.tsx: `"code - name"` when both present,
 * otherwise just the non-blank half. Kept local to avoid a circular
 * import — sidebar shouldn't depend on App.tsx.
 */
export function sidebarContractLabel(
  code: string | null,
  name: string | null,
): string {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (c && n) return `${c} - ${n}`;
  if (c) return c;
  if (n) return n;
  return "(unnamed contract)";
}

/**
 * Render a "code + name" tree label, de-duplicating the three common
 * ways a row would otherwise render the same text twice:
 *
 *   1. `code` is null / empty  → just the name. (Old code rendered
 *      "— Fundering" for codeless work areas.)
 *   2. `code` equals `name`    → just the name. (Older data where the
 *      numberText was filled with the title.)
 *   3. `name` already starts with `code + " "` (e.g. code "1.1" + title
 *      "1.1 Fundering") → just the name.
 *
 * Returns a plain text node for the de-dup cases so there's no stray
 * `<code>` element taking styling, and a `<code>code</code> name` pair
 * otherwise. Exported so a unit test can lock the behaviour in place.
 */
export function renderCodeAndName(
  code: string | null | undefined,
  name: string | null | undefined,
): JSX.Element {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (!c) return <>{n}</>;
  if (c === n) return <>{n}</>;
  if (n.startsWith(c + " ") || n.startsWith(c + "\t")) return <>{n}</>;
  return (
    <>
      <code>{c}</code> {n}
    </>
  );
}

/**
 * Slice 10H.1 — PFBB pill.
 *
 * Renders a small coloured chip next to a BDB name:
 *   - ".pill--master" ("PFBB") when `bdb.isPfbb` is true (this row IS a
 *     Projektfælles master — other BDBs can subscribe to it).
 *   - ".pill--child"  ("↪ PFBB") when `bdb.pfbbId != null` (this row is
 *     a subscriber / child — inherits content from a master).
 *
 * A BDB can't be both at once (schema convention: `is_pfbb` and
 * `pfbb_id` are mutually exclusive). If the data is inconsistent we
 * prefer the master pill so the user notices. Tooltip (native `title=`)
 * spells out the meaning in Danish-friendly English.
 *
 * Exported so tests can render it standalone.
 */
export function PfbbPill({ bdb }: { bdb: BdbInfo }): JSX.Element | null {
  const t = useT();
  if (bdb.isPfbb) {
    return (
      <span
        className="pill pill--master"
        title={t("sidebar.badge.pfbbMaster.title")}
      >
        {t("sidebar.badge.pfbbMaster.label")}
      </span>
    );
  }
  if (bdb.pfbbId != null) {
    return (
      <span
        className="pill pill--child"
        title={t("sidebar.badge.pfbbChild.title")}
      >
        {t("sidebar.badge.pfbbChild.label")}
      </span>
    );
  }
  return null;
}

/**
 * Slice 10H.1 — work-area-type pill.
 *
 * Surfaces the `work_area_type` enum on a work-spec row:
 *   0 — Arbejdsbeskrivelse     → no pill (this is the default)
 *   1 — Fælles beskrivelse     → blue "Fælles"
 *   2 — Paradigme              → amber "Paradigme"
 *
 * The virtual "Projektfælles bygningsdelsbeskrivelser" work-spec (that
 * holds PFBB masters) has work_area_type = 0 by convention, so it gets
 * no pill — the BDB pills inside make it obvious what's going on.
 *
 * Exported so tests can render it standalone.
 */
export function WorkAreaTypePill({
  workSpec,
}: {
  workSpec: WorkSpecInfo;
}): JSX.Element | null {
  const t = useT();
  if (workSpec.workAreaType === 1) {
    return (
      <span
        className="pill pill--faelles"
        title={t("sidebar.badge.workAreaTypeFaelles.title")}
      >
        {t("sidebar.badge.workAreaTypeFaelles.label")}
      </span>
    );
  }
  if (workSpec.workAreaType === 2) {
    return (
      <span
        className="pill pill--paradigme"
        title={t("sidebar.badge.workAreaTypeParadigme.title")}
      >
        {t("sidebar.badge.workAreaTypeParadigme.label")}
      </span>
    );
  }
  return null;
}

/**
 * One contract group ready to render in the sidebar. `contractId === null`
 * is the "Uden kontrakt" bucket for work areas with no assignment.
 *
 * Exported so it can be unit-tested independently.
 */
export interface ContractGroup {
  contractId: number | null;
  label: string;
  /** Short code for the collapsed rail label. Empty string when the
   *  contract has no code (rare) — caller decides how to display. */
  code: string;
  /** Contract name (empty when blank/unknown). Separate from `label` so
   *  the collapsed-rail popout header can render "code - name" in a
   *  styled two-line layout without string-parsing the label. */
  name: string;
  workSpecs: WorkSpecInfo[];
}

/**
 * Group work areas under their (effective) contract, sort the groups
 * by contract code, sort work areas within each group by work-area
 * code, put the "no contract" bucket last, and include empty groups
 * (contracts that exist but have no work areas assigned) so the user
 * can still see them.
 *
 * Pure function — no I/O, deterministic. Exported for tests.
 */
export function groupWorkSpecsByContract(params: {
  contracts: ContractInfo[];
  workSpecs: WorkSpecInfo[];
  getEffectiveCode: (c: ContractInfo) => string | null;
  getEffectiveName: (c: ContractInfo) => string | null;
  getEffectiveContractId: (w: WorkSpecInfo) => number | null;
}): ContractGroup[] {
  const {
    contracts,
    workSpecs,
    getEffectiveCode,
    getEffectiveName,
    getEffectiveContractId,
  } = params;

  // Bucket by (effective) contractId. Include every known contract even
  // when empty, plus a sentinel null bucket.
  const buckets = new Map<number | null, WorkSpecInfo[]>();
  for (const c of contracts) buckets.set(c.id, []);
  buckets.set(null, []);
  for (const w of workSpecs) {
    const cid = getEffectiveContractId(w);
    const arr = buckets.get(cid);
    if (arr) arr.push(w);
    else buckets.set(cid, [w]); // contractId points to a removed row — keep it alive
  }

  // Sort work areas inside each bucket by code → name (Danish collation,
  // code-less rows to the bottom). See Slice 10B.
  for (const arr of buckets.values()) {
    arr.sort((a, b) =>
      compareCodeThenName(
        a.workAreaCode,
        a.workAreaName,
        b.workAreaCode,
        b.workAreaName,
      ),
    );
  }

  // Build ContractGroup entries for real contracts, sorted by code
  // (codeless contracts sink to the bottom, then tie-break by label so
  // the order is still predictable instead of "whatever insertion
  // order the payload happened to have").
  const groups: ContractGroup[] = contracts
    .map((c) => {
      const code = (getEffectiveCode(c) ?? "").trim();
      const name = (getEffectiveName(c) ?? "").trim();
      return {
        contractId: c.id as number | null,
        label: sidebarContractLabel(code, name),
        code,
        name,
        workSpecs: buckets.get(c.id) ?? [],
      };
    })
    .sort((a, b) => compareCodeThenName(a.code, a.label, b.code, b.label));

  // Unknown contract IDs (shouldn't happen, but don't hide rows):
  // add synthetic groups at the end.
  for (const [cid, arr] of buckets) {
    if (cid === null) continue;
    if (contracts.some((c) => c.id === cid)) continue;
    groups.push({
      contractId: cid,
      label: `(unknown contract #${cid})`,
      code: "",
      name: "",
      workSpecs: arr,
    });
  }

  // "[No contract]" bucket always last — but only if it has rows.
  // Using English-bracketed label to read as a meta-node, not a real
  // contract name.
  const noContract = buckets.get(null) ?? [];
  if (noContract.length > 0) {
    groups.push({
      contractId: null,
      label: "[No contract]",
      code: "",
      name: "",
      workSpecs: noContract,
    });
  }

  return groups;
}

/**
 * Result of applying a free-text filter to the sidebar tree. All three
 * lists are narrowed to only the rows that should still render, and the
 * two maps are keyed by parent id so WorkSpecNode / BdbNode receive
 * pre-filtered children.
 *
 * `isFiltering` is true exactly when the query was non-empty — the
 * caller uses this to force-expand visible rows (mirrors the TOC).
 */
export interface SidebarFilterResult {
  groups: ContractGroup[];
  bdbsByWorkSpec: Map<number, BdbInfo[]>;
  plansByBdb: Map<number, ControlPlanInfo[]>;
  unassignedBdbs: BdbInfo[];
  unlinkedPlans: ControlPlanInfo[];
  isFiltering: boolean;
}

/**
 * Filter the sidebar tree by a free-text query. Semantics mirror the
 * spec TOC's `filterSectionTree`:
 *
 *   - A node is kept if its own label matches, OR any ancestor matches
 *     (children inherit the match), OR any descendant matches (so a hit
 *     keeps its context above).
 *   - When an ancestor matches, the whole subtree comes along — useful
 *     when the user searches by contract code like "E00" and expects to
 *     see every work area under it.
 *   - Empty / whitespace-only query returns everything unchanged.
 *
 * Pure function — no I/O, no React. Exported for unit tests.
 */
export function filterSidebarTree(params: {
  groups: ContractGroup[];
  bdbsByWorkSpec: Map<number, BdbInfo[]>;
  planById: Map<number, ControlPlanInfo>;
  unassignedBdbs: BdbInfo[];
  unlinkedPlans: ControlPlanInfo[];
  filter: string;
}): SidebarFilterResult {
  const {
    groups,
    bdbsByWorkSpec,
    planById,
    unassignedBdbs,
    unlinkedPlans,
    filter,
  } = params;

  const q = filter.trim().toLowerCase();

  // Helper: build every-plan map once so we pass concrete arrays down.
  const plansByBdb = new Map<number, ControlPlanInfo[]>();
  for (const [wsId, bdbs] of bdbsByWorkSpec) {
    for (const b of bdbs) {
      const plans = b.controlPlanIds
        .map((id) => planById.get(id))
        .filter((p): p is ControlPlanInfo => p != null);
      plansByBdb.set(b.id, plans);
    }
    void wsId; // keep tsc quiet about the unused destructure
  }
  for (const b of unassignedBdbs) {
    const plans = b.controlPlanIds
      .map((id) => planById.get(id))
      .filter((p): p is ControlPlanInfo => p != null);
    plansByBdb.set(b.id, plans);
  }

  if (!q) {
    return {
      groups,
      bdbsByWorkSpec,
      plansByBdb,
      unassignedBdbs,
      unlinkedPlans,
      isFiltering: false,
    };
  }

  const contains = (s: string | null | undefined): boolean =>
    (s ?? "").toLowerCase().includes(q);

  const cpMatches = (cp: ControlPlanInfo): boolean =>
    contains(cp.numberText) || contains(cp.title);
  const bdbSelfMatch = (b: BdbInfo): boolean => contains(b.name);
  const wsSelfMatch = (w: WorkSpecInfo): boolean =>
    contains(w.workAreaCode) || contains(w.workAreaName);
  const groupSelfMatch = (g: ContractGroup): boolean => contains(g.label);

  // Narrowed child maps for filtered view. We build new maps so we can
  // render from them without touching the originals.
  const nextPlansByBdb = new Map<number, ControlPlanInfo[]>();
  const nextBdbsByWorkSpec = new Map<number, BdbInfo[]>();

  // Pass 1: decide which BDBs (and which of their plans) survive.
  //   - If BDB matches, keep the BDB + all its plans (subtree comes along).
  //   - Else if any plan matches, keep the BDB + the matching plans.
  //   - Else drop the BDB entirely.
  const keepBdb = (b: BdbInfo, ancestorMatched: boolean): boolean => {
    const plans = plansByBdb.get(b.id) ?? [];
    if (ancestorMatched || bdbSelfMatch(b)) {
      // Whole subtree rides along.
      nextPlansByBdb.set(b.id, plans);
      return true;
    }
    const hitPlans = plans.filter(cpMatches);
    if (hitPlans.length > 0) {
      nextPlansByBdb.set(b.id, hitPlans);
      return true;
    }
    return false;
  };

  // Pass 2: narrow work-spec children.
  const keepWorkSpec = (w: WorkSpecInfo, ancestorMatched: boolean): boolean => {
    const allBdbs = bdbsByWorkSpec.get(w.id) ?? [];
    if (ancestorMatched || wsSelfMatch(w)) {
      // Whole subtree rides along — re-filter BDBs with ancestorMatched=true
      // so their plans are kept in full.
      const keptBdbs = allBdbs.filter((b) => keepBdb(b, true));
      nextBdbsByWorkSpec.set(w.id, keptBdbs);
      return true;
    }
    const keptBdbs = allBdbs.filter((b) => keepBdb(b, false));
    if (keptBdbs.length > 0) {
      nextBdbsByWorkSpec.set(w.id, keptBdbs);
      return true;
    }
    return false;
  };

  // Pass 3: narrow contract groups.
  const nextGroups: ContractGroup[] = [];
  for (const g of groups) {
    const groupMatched = groupSelfMatch(g);
    const keptSpecs = g.workSpecs.filter((w) => keepWorkSpec(w, groupMatched));
    if (groupMatched || keptSpecs.length > 0) {
      nextGroups.push({ ...g, workSpecs: keptSpecs });
    }
  }

  // Unassigned BDBs — standalone, no contract/work-area ancestor.
  const nextUnassignedBdbs = unassignedBdbs.filter((b) => keepBdb(b, false));

  // Unlinked CPs — leaves.
  const nextUnlinkedPlans = unlinkedPlans.filter(cpMatches);

  return {
    groups: nextGroups,
    bdbsByWorkSpec: nextBdbsByWorkSpec,
    plansByBdb: nextPlansByBdb,
    unassignedBdbs: nextUnassignedBdbs,
    unlinkedPlans: nextUnlinkedPlans,
    isFiltering: true,
  };
}

export function Sidebar({
  data,
  selection,
  onSelect,
  onDuplicateBdb,
  onCreatePfbbChild,
  onNewControlPlan,
  onDeleteControlPlan,
  onMoveControlPlan,
  onMoveWorkSpecToContract,
  onDeleteWorkSpec,
  onDeleteBdb,
  onRequestEditWorkSpec,
  onFillFromStandard,
  fillFromStandardEligible,
  onRequestEditBdb,
  onManageAttachments,
  onRequestOpenAttachment,
  onRequestRenameAttachment,
  onRequestDeleteAttachment,
  onRequestMoveAttachment,
  onRequestEditCp,
  isVirtualWorkSpec,
  isContractPendingDelete,
  isWorkSpecPendingDelete,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
  onRestoreContract,
  onRestoreWorkSpec,
  onRestoreBdb,
  onRestoreControlPlan,
  effectiveContractCodeFor,
  effectiveContractNameFor,
  effectiveWorkSpecContractFor,
  collapsed = false,
  embedded = false,
  onToggleCollapsed,
}: Props): JSX.Element {
  const t = useT();
  /**
   * Right-click menu state. One state at a time — opening a second menu
   * closes the first. Anchored at the mouse position so the menu appears
   * where the click landed — standard desktop UX.
   *
   * The discriminated union keeps the body's ternary small: `kind` picks
   * which items to render, the rest is shared positioning + id.
   */
  type ContextMenu =
    | { kind: "bdb"; bdbId: number; top: number; left: number }
    | { kind: "cp"; controlPlanId: number; top: number; left: number }
    | { kind: "workSpec"; workSpecId: number; top: number; left: number }
    | { kind: "contract"; contractId: number; top: number; left: number }
    | {
        kind: "attachment";
        attachmentId: number;
        top: number;
        left: number;
      }
    /**
     * Right-click on the "Attachments (N)" group header — same target
     * as onManageAttachments, just invoked from a different row. We
     * reuse the work_spec id because the group belongs to one work
     * area.
     */
    | {
        kind: "attachmentsGroup";
        workSpecId: number;
        top: number;
        left: number;
      };
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Keep the context menu inside the viewport: anchoring at the cursor can push
  // it past the bottom / right edge, so shift it back on-screen after it mounts
  // (in a layout effect, before paint, so there is no visible jump).
  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let top = contextMenu.top;
    let left = contextMenu.left;
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [contextMenu]);

  const openBdbContextMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ): void => {
    // No menu if the host hasn't wired up any BDB-level actions.
    if (
      !onDuplicateBdb &&
      !onCreatePfbbChild &&
      !onNewControlPlan &&
      !onDeleteBdb &&
      !onRequestEditBdb
    )
      return;
    e.preventDefault();
    setContextMenu({ kind: "bdb", bdbId, top: e.clientY, left: e.clientX });
  };

  const openCpContextMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ): void => {
    if (!onDeleteControlPlan && !onMoveControlPlan && !onRequestEditCp) return;
    e.preventDefault();
    setContextMenu({
      kind: "cp",
      controlPlanId,
      top: e.clientY,
      left: e.clientX,
    });
  };

  const openWorkSpecContextMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    workSpecId: number,
  ): void => {
    if (
      !onMoveWorkSpecToContract &&
      !onDeleteWorkSpec &&
      !onRestoreWorkSpec &&
      !onRequestEditWorkSpec &&
      !onManageAttachments
    ) {
      return;
    }
    e.preventDefault();
    setContextMenu({
      kind: "workSpec",
      workSpecId,
      top: e.clientY,
      left: e.clientX,
    });
  };

  const openContractContextMenu = (
    e: React.MouseEvent<HTMLElement>,
    contractId: number,
  ): void => {
    // The contract group header only offers Restore today, so we only
    // bother opening the menu when the contract is actually pending-delete.
    if (!onRestoreContract) return;
    if (!isContractPendingDelete || !isContractPendingDelete(contractId)) {
      return;
    }
    e.preventDefault();
    setContextMenu({
      kind: "contract",
      contractId,
      top: e.clientY,
      left: e.clientX,
    });
  };

  const openAttachmentContextMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    attachmentId: number,
  ): void => {
    // No menu if the host hasn't wired up any attachment-level actions.
    if (
      !onRequestRenameAttachment &&
      !onRequestDeleteAttachment &&
      !onRequestMoveAttachment
    ) {
      return;
    }
    e.preventDefault();
    setContextMenu({
      kind: "attachment",
      attachmentId,
      top: e.clientY,
      left: e.clientX,
    });
  };

  /**
   * Right-click on the "Attachments (N)" group header of a work area.
   * Slice 10L.7 — opens a tiny one-item menu "Manage attachments…"
   * that routes to the same work-area attachments modal. No menu if
   * the host hasn't wired that handler.
   */
  const openAttachmentsGroupContextMenu = (
    e: React.MouseEvent<HTMLElement>,
    workSpecId: number,
  ): void => {
    if (!onManageAttachments) return;
    e.preventDefault();
    setContextMenu({
      kind: "attachmentsGroup",
      workSpecId,
      top: e.clientY,
      left: e.clientX,
    });
  };

  // Group BDBs by their parent work_spec.
  const bdbsByWorkSpec = useMemo(() => {
    const m = new Map<number, BdbInfo[]>();
    for (const b of data.bdbs) {
      if (b.workSpecId == null) continue;
      (m.get(b.workSpecId) ?? m.set(b.workSpecId, []).get(b.workSpecId)!).push(
        b,
      );
    }
    return m;
  }, [data.bdbs]);

  // Group attachments by their parent work_spec. Per the Molio 2.0 schema
  // (Slice 10K refactor), every attachment has a non-null workSpecId — so
  // no "unassigned attachments" bucket is needed.
  const attachmentsByWorkSpec = useMemo(() => {
    const m = new Map<number, AttachmentInfo[]>();
    for (const a of data.attachments) {
      (m.get(a.workSpecId) ?? m.set(a.workSpecId, []).get(a.workSpecId)!).push(
        a,
      );
    }
    return m;
  }, [data.attachments]);

  const unassignedBdbs = useMemo(
    () => data.bdbs.filter((b) => b.workSpecId == null),
    [data.bdbs],
  );

  // Contract groups. Sort groups by (effective) contract code; inside
  // each group work areas sort the same way they did before — by
  // workAreaCode with name tie-break. The "(no contract)" bucket ends
  // up last. All three helpers are optional: when absent we fall back
  // to the raw payload so tests can render the sidebar with no extra
  // wiring.
  const groups = useMemo(() => {
    return groupWorkSpecsByContract({
      contracts: data.contracts,
      workSpecs: data.workSpecs,
      getEffectiveCode: (c) =>
        effectiveContractCodeFor
          ? effectiveContractCodeFor(c.id, c.contractCode)
          : c.contractCode,
      getEffectiveName: (c) =>
        effectiveContractNameFor
          ? effectiveContractNameFor(c.id, c.contractName)
          : c.contractName,
      getEffectiveContractId: (w) =>
        effectiveWorkSpecContractFor
          ? effectiveWorkSpecContractFor(w.id, w.contractId)
          : w.contractId,
    });
  }, [
    data.contracts,
    data.workSpecs,
    effectiveContractCodeFor,
    effectiveContractNameFor,
    effectiveWorkSpecContractFor,
  ]);

  // Flat list of all work areas in display order (group-by-group). The
  // collapsed rail uses this to keep rail-button ordering consistent
  // with the expanded tree, plus a set of rail separators between
  // groups (see `groupBoundaryWorkSpecIds`).
  const sortedWorkSpecs = useMemo(() => {
    const out: WorkSpecInfo[] = [];
    for (const g of groups) out.push(...g.workSpecs);
    return out;
  }, [groups]);

  // Which contract groups are currently collapsed. Per-session; not
  // persisted. `Set<string>` because the key includes `"null"` for the
  // no-contract bucket.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const groupKey = (g: ContractGroup): string =>
    g.contractId === null ? "contract:null" : `contract:${g.contractId}`;

  // Per-row collapsed state (lifted out of the row components so the
  // "collapse all" button can drive every level in one click). Sets
  // are keyed by row id. Default: empty sets → everything expanded.
  const [collapsedWorkSpecs, setCollapsedWorkSpecs] = useState<Set<number>>(
    () => new Set(),
  );
  const [collapsedBdbs, setCollapsedBdbs] = useState<Set<number>>(
    () => new Set(),
  );
  // Attachment group (the "Attachments (N)" node under a work area) is
  // collapsed by work_spec id — one group per work area, so keying by
  // work_spec id is enough.
  const [collapsedAttachmentGroups, setCollapsedAttachmentGroups] = useState<
    Set<number>
  >(() => new Set());
  const toggleWorkSpec = (id: number): void => {
    setCollapsedWorkSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleBdb = (id: number): void => {
    setCollapsedBdbs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAttachmentGroup = (workSpecId: number): void => {
    setCollapsedAttachmentGroups((prev) => {
      const next = new Set(prev);
      if (next.has(workSpecId)) next.delete(workSpecId);
      else next.add(workSpecId);
      return next;
    });
  };

  // Free-text filter over the whole tree. Empty = no filter.
  const [filter, setFilter] = useState<string>("");

  // #255 — "Skjul tomme" toggle. One global flag (shared pref) that hides
  // empty control plans + empty contracts from the tree. Local state per
  // Sidebar instance, persisted so it survives restart and new instances.
  const [hideEmpty, setHideEmpty] = useState<boolean>(() =>
    readHideEmpty(prefStore()),
  );
  const toggleHideEmpty = (): void => {
    setHideEmpty((prev) => {
      const next = !prev;
      writeHideEmpty(prefStore(), next);
      return next;
    });
  };

  // Quick lookup: control plan id → full info.
  const planById = useMemo(() => {
    const m = new Map<number, ControlPlanInfo>();
    for (const cp of data.controlPlans) m.set(cp.id, cp);
    return m;
  }, [data.controlPlans]);

  // Which control plans are referenced by at least one BDB?
  const referencedPlanIds = useMemo(() => {
    const s = new Set<number>();
    for (const b of data.bdbs) for (const id of b.controlPlanIds) s.add(id);
    return s;
  }, [data.bdbs]);

  const unlinkedPlans = useMemo(
    () => data.controlPlans.filter((c) => !referencedPlanIds.has(c.id)),
    [data.controlPlans, referencedPlanIds],
  );

  // Apply the text filter — produces narrowed groups / bdbsByWorkSpec /
  // plansByBdb / unassignedBdbs / unlinkedPlans to render. When the
  // filter is empty, we get back the originals unchanged.
  const filteredRaw = useMemo(
    () =>
      filterSidebarTree({
        groups,
        bdbsByWorkSpec,
        planById,
        unassignedBdbs,
        unlinkedPlans,
        filter,
      }),
    [groups, bdbsByWorkSpec, planById, unassignedBdbs, unlinkedPlans, filter],
  );

  // #255 — when "Skjul tomme" is on, drop empty control plans (payload
  // flag) and empty real contracts from the rendered tree. Everything
  // downstream reads `filtered`, so this single derivation covers the
  // whole expanded tree. Pickers (move-to-contract, import) use the raw
  // data elsewhere, so empty contracts stay reachable there.
  const filtered = useMemo(() => {
    if (!hideEmpty) return filteredRaw;
    const plansByBdb = new Map<number, ControlPlanInfo[]>();
    for (const [bdbId, plans] of filteredRaw.plansByBdb) {
      plansByBdb.set(
        bdbId,
        plans.filter((p) => !p.isEmpty),
      );
    }
    return {
      ...filteredRaw,
      groups: filteredRaw.groups.filter(
        (g) => !isContractEmpty(g.contractId, g.workSpecs.length),
      ),
      plansByBdb,
      unlinkedPlans: filteredRaw.unlinkedPlans.filter((p) => !p.isEmpty),
    };
  }, [hideEmpty, filteredRaw]);

  // Lists of every collapsible row id in the CURRENT unfiltered tree.
  // Used by "collapse all" so the resulting state covers every chevron
  // the user can currently see or could see by clearing the filter.
  // We deliberately build from the unfiltered data so collapsing is
  // stable across filter changes.
  const collapsibleWorkSpecIds = useMemo(() => {
    const ids: number[] = [];
    for (const w of data.workSpecs) {
      if ((bdbsByWorkSpec.get(w.id)?.length ?? 0) > 0) ids.push(w.id);
    }
    return ids;
  }, [data.workSpecs, bdbsByWorkSpec]);
  const collapsibleBdbIds = useMemo(() => {
    const ids: number[] = [];
    for (const b of data.bdbs) {
      if (b.controlPlanIds.length > 0) ids.push(b.id);
    }
    return ids;
  }, [data.bdbs]);
  // Work-spec ids that currently have at least one attachment — those are
  // the only ones whose "Attachments (N)" group is in the tree and thus
  // collapsible.
  const collapsibleAttachmentGroupIds = useMemo(() => {
    const ids: number[] = [];
    for (const [wsId, list] of attachmentsByWorkSpec) {
      if (list.length > 0) ids.push(wsId);
    }
    return ids;
  }, [attachmentsByWorkSpec]);
  const collapsibleGroupKeys = useMemo(
    () => groups.filter((g) => g.workSpecs.length > 0).map(groupKey),
    [groups],
  );

  const isFiltering = filtered.isFiltering;
  const nothingCollapsed =
    collapsedGroups.size === 0 &&
    collapsedWorkSpecs.size === 0 &&
    collapsedBdbs.size === 0 &&
    collapsedAttachmentGroups.size === 0;

  const handleToggleAll = (): void => {
    if (nothingCollapsed) {
      setCollapsedGroups(new Set(collapsibleGroupKeys));
      setCollapsedWorkSpecs(new Set(collapsibleWorkSpecIds));
      setCollapsedBdbs(new Set(collapsibleBdbIds));
      setCollapsedAttachmentGroups(new Set(collapsibleAttachmentGroupIds));
    } else {
      setCollapsedGroups(new Set());
      setCollapsedWorkSpecs(new Set());
      setCollapsedBdbs(new Set());
      setCollapsedAttachmentGroups(new Set());
    }
  };

  /**
   * Right-click menu JSX. Factored into a variable so both the expanded
   * tree (return below) AND the collapsed rail (early-return just below)
   * can render the same menu. The menu uses `position: fixed` so it
   * doesn't matter which ancestor it's mounted under.
   */
  const contextMenuNode = contextMenu ? (
    <div
      ref={contextMenuRef}
      className="tree-context-menu"
      style={{ top: contextMenu.top, left: contextMenu.left }}
      role="menu"
      aria-label={
        contextMenu.kind === "bdb"
          ? t("sidebar.aria.menu.bdb")
          : contextMenu.kind === "cp"
            ? t("sidebar.aria.menu.cp")
            : contextMenu.kind === "workSpec"
              ? t("sidebar.aria.menu.workSpec")
              : contextMenu.kind === "attachment"
                ? t("sidebar.aria.menu.attachment")
                : t("sidebar.aria.menu.contract")
      }
    >
      {contextMenu.kind === "bdb" && (
        <>
          {(() => {
            const bdbId = contextMenu.bdbId;
            const pending = isBdbPendingDelete
              ? isBdbPendingDelete(bdbId)
              : false;
            if (pending) {
              return (
                onRestoreBdb && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRestoreBdb(bdbId);
                    }}
                  >
                    {t("sidebar.menu.bdb.restore")}
                  </button>
                )
              );
            }
            return (
              <>
                {onRequestEditBdb && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRequestEditBdb(bdbId);
                    }}
                  >
                    {t("sidebar.menu.bdb.editMetadata")}
                  </button>
                )}
                {onNewControlPlan && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onNewControlPlan(bdbId);
                    }}
                  >
                    {t("sidebar.menu.bdb.newControlPlan")}
                  </button>
                )}
                {onDuplicateBdb && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onDuplicateBdb(bdbId);
                    }}
                  >
                    {t("sidebar.menu.bdb.duplicate")}
                  </button>
                )}
                {/*
                 * Slice 10H.5 — only a PFBB *master* can spawn a child.
                 * Regular BDBs and existing children never see this
                 * item. We look up `isPfbb` from the sidebar's `data`
                 * rather than requiring the host to gate, so this stays
                 * encapsulated.
                 */}
                {onCreatePfbbChild &&
                  findBdbById(data, bdbId)?.isPfbb === true && (
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-context-menu__item"
                      onClick={() => {
                        setContextMenu(null);
                        onCreatePfbbChild(bdbId);
                      }}
                    >
                      {t("sidebar.menu.bdb.createPfbbChild")}
                    </button>
                  )}
                {onDeleteBdb && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item tree-context-menu__item--danger"
                    onClick={() => {
                      setContextMenu(null);
                      onDeleteBdb(bdbId);
                    }}
                  >
                    {t("sidebar.menu.bdb.delete")}
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}
      {contextMenu.kind === "cp" && (
        <>
          {(() => {
            // FIX-DelCpStrike 2026-05-11 — when this CP is
            // pending-delete (direct or cascaded via parent BDB),
            // hide the edit/move/delete actions and show Restore
            // instead, matching the BDB / WA / contract pattern.
            // Restore is a no-op for cascade-pending CPs (the
            // owning BDB owns the deletion); host still wires it.
            const id = contextMenu.controlPlanId;
            const pending = isControlPlanPendingDelete
              ? isControlPlanPendingDelete(id)
              : false;
            if (pending) {
              return (
                onRestoreControlPlan && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRestoreControlPlan(id);
                    }}
                  >
                    {t("sidebar.menu.cp.restore")}
                  </button>
                )
              );
            }
            return (
              <>
                {onRequestEditCp && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRequestEditCp(id);
                    }}
                  >
                    {t("sidebar.menu.cp.editMetadata")}
                  </button>
                )}
                {onMoveControlPlan && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onMoveControlPlan(id);
                    }}
                  >
                    {t("sidebar.menu.cp.move")}
                  </button>
                )}
                {onDeleteControlPlan && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item tree-context-menu__item--danger"
                    onClick={() => {
                      setContextMenu(null);
                      onDeleteControlPlan(id);
                    }}
                  >
                    {t("sidebar.menu.cp.delete")}
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}
      {contextMenu.kind === "workSpec" && (
        <>
          {(() => {
            const wsId = contextMenu.workSpecId;
            const pending = isWorkSpecPendingDelete
              ? isWorkSpecPendingDelete(wsId)
              : false;
            if (pending) {
              return (
                onRestoreWorkSpec && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRestoreWorkSpec(wsId);
                    }}
                  >
                    {t("sidebar.menu.workSpec.restore")}
                  </button>
                )
              );
            }
            // Slice 10H.6d — the virtual "Projektfælles" work_spec is a
            // Molio-convention grouping container for PFBB masters. It
            // must not be renamed, deleted, reassigned to a contract, or
            // accrue attachments. Hide every action and render a single
            // inert info item so the user sees *why* the menu is empty.
            if (isVirtualWorkSpec?.(wsId)) {
              return (
                <div
                  role="menuitem"
                  aria-disabled="true"
                  className="tree-context-menu__item tree-context-menu__item--disabled"
                  data-testid="ws-context-virtual-locked"
                >
                  {t("sidebar.menu.workSpec.virtualPfbbLocked")}
                </div>
              );
            }
            return (
              <>
                {onRequestEditWorkSpec && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onRequestEditWorkSpec(wsId);
                    }}
                  >
                    {t("sidebar.menu.workSpec.editMetadata")}
                  </button>
                )}
                {onFillFromStandard && fillFromStandardEligible?.has(wsId) && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onFillFromStandard(wsId);
                    }}
                  >
                    {t("sidebar.menu.fillFromStandard")}
                  </button>
                )}
                {onManageAttachments && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onManageAttachments(wsId);
                    }}
                  >
                    {t("sidebar.menu.workSpec.attachments")}
                  </button>
                )}
                {onMoveWorkSpecToContract && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item"
                    onClick={() => {
                      setContextMenu(null);
                      onMoveWorkSpecToContract(wsId);
                    }}
                  >
                    {t("sidebar.menu.workSpec.moveToContract")}
                  </button>
                )}
                {onDeleteWorkSpec && (
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-menu__item tree-context-menu__item--danger"
                    onClick={() => {
                      setContextMenu(null);
                      onDeleteWorkSpec(wsId);
                    }}
                  >
                    {t("sidebar.menu.workSpec.delete")}
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}
      {contextMenu.kind === "contract" && onRestoreContract && (
        <button
          type="button"
          role="menuitem"
          className="tree-context-menu__item"
          onClick={() => {
            const id = contextMenu.contractId;
            setContextMenu(null);
            onRestoreContract(id);
          }}
        >
          {t("sidebar.menu.contract.restore")}
        </button>
      )}
      {contextMenu.kind === "attachment" && (
        <>
          {onRequestRenameAttachment && (
            <button
              type="button"
              role="menuitem"
              className="tree-context-menu__item"
              onClick={() => {
                const id = contextMenu.attachmentId;
                setContextMenu(null);
                onRequestRenameAttachment(id);
              }}
            >
              {t("sidebar.menu.attachment.rename")}
            </button>
          )}
          {onRequestMoveAttachment && (
            <button
              type="button"
              role="menuitem"
              className="tree-context-menu__item"
              onClick={() => {
                const id = contextMenu.attachmentId;
                setContextMenu(null);
                onRequestMoveAttachment(id);
              }}
            >
              {t("sidebar.menu.attachment.move")}
            </button>
          )}
          {onRequestDeleteAttachment && (
            <button
              type="button"
              role="menuitem"
              className="tree-context-menu__item tree-context-menu__item--danger"
              onClick={() => {
                const id = contextMenu.attachmentId;
                setContextMenu(null);
                onRequestDeleteAttachment(id);
              }}
            >
              {t("sidebar.menu.attachment.delete")}
            </button>
          )}
        </>
      )}
      {contextMenu.kind === "attachmentsGroup" &&
        onManageAttachments &&
        // Slice 10H.6d — same lock as the work_spec menu above:
        // the virtual PFBB container owns no attachments.
        !isVirtualWorkSpec?.(contextMenu.workSpecId) && (
          <button
            type="button"
            role="menuitem"
            className="tree-context-menu__item"
            onClick={() => {
              const wsId = contextMenu.workSpecId;
              setContextMenu(null);
              onManageAttachments(wsId);
            }}
          >
            {t("sidebar.menu.attachmentsGroup.manage")}
          </button>
        )}
    </div>
  ) : null;

  if (collapsed) {
    return (
      <>
        <CollapsedRail
          data={data}
          selection={selection}
          onSelect={onSelect}
          groups={groups}
          bdbsByWorkSpec={bdbsByWorkSpec}
          unassignedBdbs={unassignedBdbs}
          unlinkedPlans={unlinkedPlans}
          planById={planById}
          onBdbContextMenu={openBdbContextMenu}
          onCpContextMenu={openCpContextMenu}
          onWorkSpecContextMenu={openWorkSpecContextMenu}
          onContractContextMenu={openContractContextMenu}
          isContractPendingDelete={isContractPendingDelete}
          isWorkSpecPendingDelete={isWorkSpecPendingDelete}
          isBdbPendingDelete={isBdbPendingDelete}
          isControlPlanPendingDelete={isControlPlanPendingDelete}
          onToggleCollapsed={embedded ? undefined : onToggleCollapsed}
        />
        {contextMenuNode}
      </>
    );
  }

  // Which "[No …]" catch-all buckets do we need to render under the
  // [No contract] group? Based on the *filtered* counts so they hide
  // during a filter that excludes every orphan. See Slice 6O.2.
  const noContractGroup =
    filtered.groups.find((g) => g.contractId === null) ?? null;
  const visibility = bucketVisibility({
    noContractWorkSpecs: noContractGroup?.workSpecs ?? [],
    noWorkAreaBdbs: filtered.unassignedBdbs,
    noBdbPlans: filtered.unlinkedPlans,
  });
  // When there are orphan BDBs / CPs but no contract-less work areas,
  // the [No contract] group isn't in `filtered.groups` yet — we need to
  // synthesize one below the real contract groups so the nested buckets
  // have a parent to hang under.
  const needsSyntheticNoContract =
    visibility.showNoContract && noContractGroup === null;

  const noResults =
    isFiltering && filtered.groups.length === 0 && !visibility.showNoContract;

  return (
    <aside className={embedded ? "sidebar sidebar--embedded" : "sidebar"}>
      {/* Toolbar row — filter input + collapse/expand-all toggle. Pinned
       *  at the top via flex so it stays visible no matter how far the
       *  tree has been scrolled. Mirrors the spec TOC toolbar so the two
       *  panes feel like siblings. */}
      <div className="sidebar__filter-row">
        {/* Collapse button lives left of the filter input. The app header
         *  used to own this toggle; moved here so it sits in the nav-tree
         *  context it acts on. Hidden in embedded mode (Project Overview
         *  tree) where collapsing makes no sense. */}
        {onToggleCollapsed && !embedded && (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapsed}
            aria-label={t("sidebar.aria.collapseSidebar")}
            title={t("sidebar.tooltip.collapseSidebar")}
          >
            ‹
          </button>
        )}
        <input
          type="search"
          className="sidebar__filter"
          placeholder={t("sidebar.filter.placeholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="sidebar__toggle-all"
          onClick={handleToggleAll}
          title={
            isFiltering
              ? t("sidebar.tooltip.toggleAllFiltering")
              : nothingCollapsed
                ? t("sidebar.tooltip.collapseAll")
                : t("sidebar.tooltip.expandAll")
          }
          aria-label={
            nothingCollapsed
              ? t("sidebar.aria.collapseAll")
              : t("sidebar.aria.expandAll")
          }
          aria-pressed={!nothingCollapsed}
          disabled={isFiltering}
        >
          {nothingCollapsed ? "−" : "+"}
        </button>
        {/* #255 — "Skjul tomme" toggle. Hides empty control plans +
         *  empty contracts. Pressed state styled via aria-pressed. */}
        <button
          type="button"
          className="sidebar__hide-empty"
          onClick={toggleHideEmpty}
          title={t("sidebar.hideEmpty.tooltip")}
          aria-label={t("sidebar.hideEmpty.tooltip")}
          aria-pressed={hideEmpty}
        >
          <EyeOffIcon size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar__scroll">
        {/* Previously rendered a <ProjectNode> here as the first row so the
         *  user could click the project name to open the Project tab. The
         *  project name now lives in the top bar (App.tsx), and the Project
         *  tab is always reachable from the tab bar, so the extra row is
         *  redundant visual noise in the tree. Kept the empty comment as a
         *  marker in case we ever want it back. */}
        <div className="sidebar__group-label">
          {t("sidebar.group.contracts")}
        </div>
        {data.workSpecs.length === 0 && data.contracts.length === 0 && (
          <div className="sidebar__empty">{t("sidebar.empty.none")}</div>
        )}
        {noResults && (
          <div className="sidebar__empty">{t("sidebar.empty.noMatches")}</div>
        )}
        {filtered.groups.map((g) => {
          const key = groupKey(g);
          // While filtering, force-expand so matches aren't hidden.
          const isCollapsed = !isFiltering && collapsedGroups.has(key);
          const groupPendingDelete =
            g.contractId !== null && isContractPendingDelete
              ? isContractPendingDelete(g.contractId)
              : false;
          const isNoContract = g.contractId === null;
          // The pure helper hands back English-y sentinel labels for
          // contracts with no name and the "[No contract]" bucket.
          // Translate those at render time so the user sees localized text.
          const displayLabel = isNoContract
            ? t("sidebar.group.noContract")
            : g.label === "(unnamed contract)"
              ? t("contract.unnamedFallback")
              : g.label;
          const displayGroup =
            displayLabel === g.label ? g : { ...g, label: displayLabel };
          return (
            <ContractGroupNode
              key={key}
              group={displayGroup}
              collapsed={isCollapsed}
              disabled={isFiltering}
              onToggle={() => toggleGroup(key)}
              pendingDelete={groupPendingDelete}
              empty={isContractEmpty(g.contractId, g.workSpecs.length)}
              onContextMenu={
                groupPendingDelete && g.contractId !== null
                  ? (e) => openContractContextMenu(e, g.contractId as number)
                  : undefined
              }
              // Special case: the [No contract] group must stay expandable
              // even when it has no contract-less work areas — its homeless
              // BDB / CP sub-buckets are the content to show.
              forceHasChildren={isNoContract && visibility.showNoWorkArea}
            >
              {g.workSpecs.length === 0 &&
              !(isNoContract && visibility.showNoWorkArea) ? (
                <div
                  className="sidebar__empty sidebar__empty--in-group"
                  style={{ paddingLeft: 28 }}
                >
                  {t("sidebar.empty.noWorkAreas")}
                </div>
              ) : (
                <>
                  {g.workSpecs.map((w) => (
                    <WorkSpecNode
                      key={w.id}
                      workSpec={w}
                      bdbs={filtered.bdbsByWorkSpec.get(w.id) ?? []}
                      plansByBdb={filtered.plansByBdb}
                      attachments={attachmentsByWorkSpec.get(w.id) ?? []}
                      selection={selection}
                      onSelect={onSelect}
                      onBdbContextMenu={openBdbContextMenu}
                      onCpContextMenu={openCpContextMenu}
                      onWorkSpecContextMenu={openWorkSpecContextMenu}
                      onAttachmentContextMenu={openAttachmentContextMenu}
                      onAttachmentsGroupContextMenu={
                        openAttachmentsGroupContextMenu
                      }
                      onOpenAttachment={onRequestOpenAttachment}
                      expanded={isFiltering || !collapsedWorkSpecs.has(w.id)}
                      onToggle={() => toggleWorkSpec(w.id)}
                      collapsedBdbs={collapsedBdbs}
                      onToggleBdb={toggleBdb}
                      collapsedAttachmentGroups={collapsedAttachmentGroups}
                      onToggleAttachmentGroup={toggleAttachmentGroup}
                      isFiltering={isFiltering}
                      // Shift chevron to sit under the contract header's text
                      // (header text starts at ~24px, chevron at 6px).
                      levelOffset={18}
                      pendingDelete={
                        isWorkSpecPendingDelete
                          ? isWorkSpecPendingDelete(w.id)
                          : false
                      }
                      isBdbPendingDelete={isBdbPendingDelete}
                      isControlPlanPendingDelete={isControlPlanPendingDelete}
                    />
                  ))}
                  {isNoContract && visibility.showNoWorkArea && (
                    <HomelessBuckets
                      unassignedBdbs={filtered.unassignedBdbs}
                      unlinkedPlans={filtered.unlinkedPlans}
                      showNoBdb={visibility.showNoBdb}
                      plansByBdb={filtered.plansByBdb}
                      selection={selection}
                      onSelect={onSelect}
                      openBdbContextMenu={openBdbContextMenu}
                      openCpContextMenu={openCpContextMenu}
                      collapsedBdbs={collapsedBdbs}
                      toggleBdb={toggleBdb}
                      isFiltering={isFiltering}
                      isBdbPendingDelete={isBdbPendingDelete}
                      isControlPlanPendingDelete={isControlPlanPendingDelete}
                    />
                  )}
                </>
              )}
            </ContractGroupNode>
          );
        })}

        {needsSyntheticNoContract && (
          <ContractGroupNode
            key="contract:null-synthetic"
            group={{
              contractId: null,
              label: t("sidebar.group.noContract"),
              code: "",
              name: "",
              workSpecs: [],
            }}
            collapsed={false}
            disabled={isFiltering}
            onToggle={() => {
              /* synthetic group is always expanded — nothing to toggle */
            }}
            forceHasChildren
          >
            <HomelessBuckets
              unassignedBdbs={filtered.unassignedBdbs}
              unlinkedPlans={filtered.unlinkedPlans}
              showNoBdb={visibility.showNoBdb}
              plansByBdb={filtered.plansByBdb}
              selection={selection}
              onSelect={onSelect}
              openBdbContextMenu={openBdbContextMenu}
              openCpContextMenu={openCpContextMenu}
              collapsedBdbs={collapsedBdbs}
              toggleBdb={toggleBdb}
              isFiltering={isFiltering}
              isBdbPendingDelete={isBdbPendingDelete}
              isControlPlanPendingDelete={isControlPlanPendingDelete}
            />
          </ContractGroupNode>
        )}
      </div>
      {contextMenuNode}
    </aside>
  );
}

function ProjectNode({
  name,
  selected,
  onClick,
}: {
  name: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`tree-node tree-node--project${selected ? " is-selected" : ""}`}
      onClick={onClick}
    >
      {name}
    </button>
  );
}

/**
 * One contract group in the expanded tree: a collapsible header +
 * its children. The chevron is disabled when a group has 0 work
 * areas — there's nothing to hide, but we still show the header so
 * the user can see the contract exists.
 */
function ContractGroupNode({
  group,
  collapsed,
  disabled = false,
  onToggle,
  pendingDelete = false,
  empty = false,
  onContextMenu,
  forceHasChildren = false,
  children,
}: {
  group: ContractGroup;
  collapsed: boolean;
  /** While filtering we force-expand every group — the chevron stays
   *  in the DOM for layout consistency but can't be clicked. */
  disabled?: boolean;
  /** #255 — true when the contract has no work areas. Draws a small
   *  "tom" marker. Only ever passed for shown groups (hidden ones are
   *  filtered out upstream when the toggle is on). */
  empty?: boolean;
  onToggle: () => void;
  /** Slice 6M — when true, contract has a buffered delete pending. We
   *  visually strike the header and let the caller open a Restore
   *  right-click menu on it. */
  pendingDelete?: boolean;
  onContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Slice 6O.2 — force the chevron live even when `workSpecs` is
   *  empty. Used by the [No contract] bucket when its only children
   *  are the nested homeless buckets (no work areas of its own). */
  forceHasChildren?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const t = useT();
  const hasChildren = forceHasChildren || group.workSpecs.length > 0;
  return (
    <>
      <div className="tree-row tree-row--contract" style={{ paddingLeft: 6 }}>
        <button
          type="button"
          className="tree-toggle"
          onClick={onToggle}
          aria-label={
            collapsed ? t("sidebar.aria.expand") : t("sidebar.aria.collapse")
          }
          disabled={!hasChildren || disabled}
        >
          {hasChildren ? (collapsed ? "▸" : "▾") : "·"}
        </button>
        <span
          className={`tree-node tree-node--contract-header${
            pendingDelete ? " tree-node--pending-delete" : ""
          }`}
          title={group.label}
          onContextMenu={onContextMenu}
        >
          {group.label}
          {empty && (
            <span className="tree-empty-badge">
              {t("sidebar.empty.badge")}
            </span>
          )}
        </span>
      </div>
      {!collapsed && children}
    </>
  );
}

function WorkSpecNode({
  workSpec,
  bdbs,
  plansByBdb,
  attachments = [],
  selection,
  onSelect,
  onBdbContextMenu,
  onCpContextMenu,
  onWorkSpecContextMenu,
  onAttachmentContextMenu,
  onAttachmentsGroupContextMenu,
  onOpenAttachment,
  expanded,
  onToggle,
  collapsedBdbs,
  onToggleBdb,
  collapsedAttachmentGroups,
  onToggleAttachmentGroup,
  isFiltering = false,
  levelOffset = 0,
  pendingDelete = false,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
}: {
  workSpec: WorkSpecInfo;
  bdbs: BdbInfo[];
  /** Pre-filtered CPs keyed by BDB id. Passed through to BdbNode so
   *  each BDB renders the CP set we chose at the Sidebar level. */
  plansByBdb: Map<number, ControlPlanInfo[]>;
  /** Attachments belonging to this work area. Optional — defaults to
   *  empty. When non-empty, rendered as an expandable "Attachments (N)"
   *  group below the BDBs. Hidden entirely when empty. */
  attachments?: AttachmentInfo[];
  selection: TabTarget;
  onSelect: (s: TabTarget) => void;
  /** Forwarded to each BDB child so right-click opens the host's
   *  context menu. Optional — same as on the outer Sidebar. */
  onBdbContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  /** Right-click on the work-area node itself. Optional — when absent
   *  (e.g. tests), the node has no context menu. */
  onWorkSpecContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    workSpecId: number,
  ) => void;
  /** Right-click on an attachment leaf row. Optional. */
  onAttachmentContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    attachmentId: number,
  ) => void;
  /** Right-click on the "Attachments (N)" group header (Slice 10L.7).
   *  Opens the one-item "Manage attachments…" menu. */
  onAttachmentsGroupContextMenu?: (
    e: React.MouseEvent<HTMLElement>,
    workSpecId: number,
  ) => void;
  /** Double-click on an attachment leaf row → open in OS default app. */
  onOpenAttachment?: (attachmentId: number) => void;
  /** Controlled expand/collapse — driven by Sidebar so toggle-all
   *  works. */
  expanded: boolean;
  onToggle: () => void;
  /** BDB collapsed state — same controlled-from-parent pattern. */
  collapsedBdbs: ReadonlySet<number>;
  onToggleBdb: (bdbId: number) => void;
  /** Attachments-group collapsed state, keyed by work_spec id. */
  collapsedAttachmentGroups?: ReadonlySet<number>;
  onToggleAttachmentGroup?: (workSpecId: number) => void;
  /** While filtering, chevrons can't be clicked (they force-expand). */
  isFiltering?: boolean;
  /**
   * Pixels of extra left padding applied to this row and all
   * descendants. Used so contract-group children align their chevron
   * under the parent's text (not under the parent's chevron).
   * Default 0 for backward-compat with the unassignedBdbs path.
   */
  levelOffset?: number;
  /** Slice 6M — when true, the work area has a buffered delete pending
   *  (direct or inherited from its contract). Apply strikethrough. */
  pendingDelete?: boolean;
  /** Slice 6M — per-BDB predicate so each child can apply its own
   *  strikethrough (BDB is pending-delete directly, via its work area,
   *  or via its contract). */
  isBdbPendingDelete?: (bdbId: number) => boolean;
  /** FIX-DelCpStrike 2026-05-11 — per-CP predicate passed through to
   *  BdbNode for each control plan's strikethrough. */
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
}): JSX.Element {
  const t = useT();
  const isSelected =
    selection.kind === "workSpec" && selection.id === workSpec.id;
  const hasChildren = bdbs.length > 0 || attachments.length > 0;
  const attachmentsGroupExpanded =
    isFiltering || !(collapsedAttachmentGroups?.has(workSpec.id) ?? false);

  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 6 + levelOffset }}>
        <button
          type="button"
          className="tree-toggle"
          onClick={onToggle}
          aria-label={
            expanded ? t("sidebar.aria.collapse") : t("sidebar.aria.expand")
          }
          disabled={!hasChildren || isFiltering}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : "·"}
        </button>
        <button
          type="button"
          className={`tree-node${isSelected ? " is-selected" : ""}${
            pendingDelete ? " tree-node--pending-delete" : ""
          }`}
          onClick={() => onSelect({ kind: "workSpec", id: workSpec.id })}
          onContextMenu={
            onWorkSpecContextMenu
              ? (e) => onWorkSpecContextMenu(e, workSpec.id)
              : undefined
          }
          title={workSpec.workAreaName}
        >
          {renderCodeAndName(workSpec.workAreaCode, workSpec.workAreaName)}
          <WorkAreaTypePill workSpec={workSpec} />
        </button>
      </div>
      {expanded && (
        <>
          {bdbs.map((b) => (
            <BdbNode
              key={b.id}
              bdb={b}
              plans={plansByBdb.get(b.id) ?? []}
              selection={selection}
              onSelect={onSelect}
              onContextMenu={onBdbContextMenu}
              onCpContextMenu={onCpContextMenu}
              indent={2}
              levelOffset={levelOffset}
              expanded={isFiltering || !collapsedBdbs.has(b.id)}
              onToggle={() => onToggleBdb(b.id)}
              isFiltering={isFiltering}
              pendingDelete={
                isBdbPendingDelete ? isBdbPendingDelete(b.id) : false
              }
              isControlPlanPendingDelete={isControlPlanPendingDelete}
            />
          ))}
          {attachments.length > 0 && (
            <AttachmentsGroupNode
              attachments={attachments}
              expanded={attachmentsGroupExpanded}
              onToggle={() => onToggleAttachmentGroup?.(workSpec.id)}
              onContextMenu={onAttachmentContextMenu}
              onGroupContextMenu={
                onAttachmentsGroupContextMenu
                  ? (e) => onAttachmentsGroupContextMenu(e, workSpec.id)
                  : undefined
              }
              onOpen={onOpenAttachment}
              levelOffset={levelOffset}
              isFiltering={isFiltering}
            />
          )}
        </>
      )}
    </>
  );
}

function BdbNode({
  bdb,
  plans,
  selection,
  onSelect,
  onContextMenu,
  onCpContextMenu,
  indent,
  levelOffset = 0,
  expanded,
  onToggle,
  isFiltering = false,
  pendingDelete = false,
  isControlPlanPendingDelete,
}: {
  bdb: BdbInfo;
  /** Already-filtered list of control plans to render. Sidebar builds
   *  this so the filter logic stays in one place. */
  plans: ControlPlanInfo[];
  selection: TabTarget;
  onSelect: (s: TabTarget) => void;
  /** Right-click handler. Receives the raw event so the host can read
   *  clientX/clientY to anchor the popup at the cursor. Optional so
   *  tests / other surfaces can render BdbNode without it. */
  onContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  indent: number;
  /** Same levelOffset the parent WorkSpec received — shifts this row
   *  and its CP children by the contract-group offset. */
  levelOffset?: number;
  /** Controlled expand/collapse — driven by Sidebar. */
  expanded: boolean;
  onToggle: () => void;
  /** While filtering, chevrons can't be clicked. */
  isFiltering?: boolean;
  /** Slice 6M — when true, the BDB has a buffered delete pending
   *  (direct or inherited). Apply strikethrough. */
  pendingDelete?: boolean;
  /** FIX-DelCpStrike 2026-05-11 — per-CP strikethrough predicate. */
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
}): JSX.Element {
  const t = useT();
  const selected = selection.kind === "bdb" && selection.id === bdb.id;
  const hasChildren = plans.length > 0;

  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 6 + indent * 14 + levelOffset }}
      >
        <button
          type="button"
          className="tree-toggle"
          onClick={onToggle}
          aria-label={
            expanded ? t("sidebar.aria.collapse") : t("sidebar.aria.expand")
          }
          disabled={!hasChildren || isFiltering}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : "·"}
        </button>
        <button
          type="button"
          className={`tree-node${selected ? " is-selected" : ""}${
            pendingDelete ? " tree-node--pending-delete" : ""
          }`}
          onClick={() => onSelect({ kind: "bdb", id: bdb.id })}
          onContextMenu={
            onContextMenu ? (e) => onContextMenu(e, bdb.id) : undefined
          }
          title={bdb.name}
        >
          {bdb.name}
          <PfbbPill bdb={bdb} />
        </button>
      </div>
      {expanded &&
        plans.map((p) => (
          <ControlPlanNode
            key={p.id}
            plan={p}
            selected={selection.kind === "controlPlan" && selection.id === p.id}
            indent={indent + 1}
            levelOffset={levelOffset}
            pendingDelete={
              isControlPlanPendingDelete
                ? isControlPlanPendingDelete(p.id)
                : false
            }
            onClick={() => onSelect({ kind: "controlPlan", id: p.id })}
            onContextMenu={onCpContextMenu}
          />
        ))}
    </>
  );
}

function ControlPlanNode({
  plan,
  selected,
  indent,
  levelOffset = 0,
  pendingDelete = false,
  onClick,
  onContextMenu,
}: {
  plan: ControlPlanInfo;
  selected: boolean;
  indent: number;
  /** Same levelOffset the grandparent WorkSpec received — shifts this
   *  row by the contract-group offset so CP rows align under their BDB. */
  levelOffset?: number;
  /** FIX-DelCpStrike 2026-05-11 — true when this CP is pending-delete
   *  (direct or cascade via parent BDB). Renders strikethrough + muted. */
  pendingDelete?: boolean;
  onClick: () => void;
  /** Right-click handler. Optional so tests can render without it. */
  onContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
}): JSX.Element {
  const t = useT();
  return (
    <div
      className="tree-row"
      style={{ paddingLeft: 6 + indent * 14 + levelOffset }}
    >
      <span className="tree-toggle tree-toggle--leaf">·</span>
      <button
        type="button"
        className={
          "tree-node" +
          (selected ? " is-selected" : "") +
          (pendingDelete ? " tree-node--pending-delete" : "")
        }
        onClick={onClick}
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, plan.id) : undefined
        }
        title={plan.title}
      >
        {renderCodeAndName(plan.numberText, plan.title)}
        {/* #255 — empty control plan marker (rows == 0). */}
        {plan.isEmpty && (
          <span className="tree-empty-badge">{t("sidebar.empty.badge")}</span>
        )}
      </button>
    </div>
  );
}

/**
 * Collapsible "Attachments (N)" group that appears under a work area
 * below the BDBs. Hidden by the parent when there are no attachments
 * — rendered only when `attachments.length > 0`. Indentation matches
 * BDB rows so the group header sits at the same column as a BDB.
 */
function AttachmentsGroupNode({
  attachments,
  expanded,
  onToggle,
  onContextMenu,
  onGroupContextMenu,
  onOpen,
  levelOffset = 0,
  isFiltering = false,
}: {
  attachments: AttachmentInfo[];
  expanded: boolean;
  onToggle: () => void;
  onContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    attachmentId: number,
  ) => void;
  /** Slice 10L.7 — right-click on the "Attachments (N)" header.
   *  Opens the one-item "Manage attachments…" menu. Optional. */
  onGroupContextMenu?: (e: React.MouseEvent<HTMLElement>) => void;
  onOpen?: (attachmentId: number) => void;
  levelOffset?: number;
  isFiltering?: boolean;
}): JSX.Element {
  const t = useT();
  // Same indent math as a BDB row (indent=2).
  const headerPaddingLeft = 6 + 2 * 14 + levelOffset;
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: headerPaddingLeft }}>
        <button
          type="button"
          className="tree-toggle"
          onClick={onToggle}
          aria-label={
            expanded ? t("sidebar.aria.collapse") : t("sidebar.aria.expand")
          }
          disabled={isFiltering}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span
          className="tree-node tree-node--attachments-group"
          title={t("sidebar.tooltip.attachmentsGroup")}
          onContextMenu={onGroupContextMenu}
        >
          {t("sidebar.group.attachmentsCount", { count: attachments.length })}
        </span>
      </div>
      {expanded &&
        attachments.map((a) => (
          <AttachmentLeafNode
            key={a.id}
            attachment={a}
            indent={3}
            levelOffset={levelOffset}
            onContextMenu={onContextMenu}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}

/**
 * Leaf row for a single attachment. Double-click opens it in the OS
 * default app (via the host's `onOpen` callback). Right-click opens
 * the attachment context menu (Rename / Move / Delete).
 */
function AttachmentLeafNode({
  attachment,
  indent,
  levelOffset = 0,
  onContextMenu,
  onOpen,
}: {
  attachment: AttachmentInfo;
  indent: number;
  levelOffset?: number;
  onContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    attachmentId: number,
  ) => void;
  onOpen?: (attachmentId: number) => void;
}): JSX.Element {
  const t = useT();
  return (
    <div
      className="tree-row"
      style={{ paddingLeft: 6 + indent * 14 + levelOffset }}
    >
      <span className="tree-toggle tree-toggle--leaf">·</span>
      <button
        type="button"
        className="tree-node tree-node--attachment"
        onDoubleClick={() => onOpen?.(attachment.id)}
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, attachment.id) : undefined
        }
        title={t("sidebar.tooltip.attachmentLeaf", { name: attachment.name })}
      >
        {attachment.name}
      </button>
    </div>
  );
}

/**
 * Nested "[No work area] → [No BDB]" catch-all buckets rendered inside
 * the [No contract] group (Slice 6O.2 — #110).
 *
 * Homeless BDBs live under [No work area]; unlinked control plans live
 * under [No BDB] (itself nested under [No work area]). Labels are just
 * static rows — not collapsible — so the orphans stay visible by
 * default. The intent is that these buckets exist to surface records
 * the user probably wants to fix / delete, and hiding them behind a
 * chevron defeats the purpose.
 *
 * Indent math:
 *   - `[No contract]` header sits at paddingLeft 6 (ContractGroupNode)
 *   - Work areas below it use `paddingLeft: 6 + 18 = 24` (levelOffset 18)
 *   - We place `[No work area]` at the same column as a work-area row
 *     (24) so it reads as a peer. Homeless BDBs inside it use the same
 *     `indent=2 + levelOffset=18` that a regular BDB would, so they
 *     align under the `[No work area]` label.
 *   - `[No BDB]` sits one step deeper (paddingLeft ~42). Unlinked CPs
 *     use `indent=3 + levelOffset=18` so they align under that label.
 */
function HomelessBuckets({
  unassignedBdbs,
  unlinkedPlans,
  showNoBdb,
  plansByBdb,
  selection,
  onSelect,
  openBdbContextMenu,
  openCpContextMenu,
  collapsedBdbs,
  toggleBdb,
  isFiltering,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
}: {
  unassignedBdbs: BdbInfo[];
  unlinkedPlans: ControlPlanInfo[];
  showNoBdb: boolean;
  plansByBdb: Map<number, ControlPlanInfo[]>;
  selection: TabTarget;
  onSelect: (s: TabTarget) => void;
  openBdbContextMenu: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  openCpContextMenu: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  collapsedBdbs: ReadonlySet<number>;
  toggleBdb: (bdbId: number) => void;
  isFiltering: boolean;
  isBdbPendingDelete?: (bdbId: number) => boolean;
  isControlPlanPendingDelete?: (controlPlanId: number) => boolean;
}): JSX.Element {
  const t = useT();
  return (
    <>
      <div
        className="sidebar__homeless-label"
        style={{ paddingLeft: 24 }}
        title={t("sidebar.tooltip.noWorkAreaBucket")}
      >
        {t("sidebar.group.noWorkArea")}
      </div>
      {unassignedBdbs.map((b) => (
        <BdbNode
          key={b.id}
          bdb={b}
          plans={plansByBdb.get(b.id) ?? []}
          selection={selection}
          onSelect={onSelect}
          onContextMenu={openBdbContextMenu}
          onCpContextMenu={openCpContextMenu}
          indent={2}
          levelOffset={18}
          expanded={isFiltering || !collapsedBdbs.has(b.id)}
          onToggle={() => toggleBdb(b.id)}
          isFiltering={isFiltering}
          pendingDelete={isBdbPendingDelete ? isBdbPendingDelete(b.id) : false}
          isControlPlanPendingDelete={isControlPlanPendingDelete}
        />
      ))}
      {showNoBdb && (
        <>
          <div
            className="sidebar__homeless-label"
            style={{ paddingLeft: 42 }}
            title={t("sidebar.tooltip.noBdbBucket")}
          >
            {t("sidebar.group.noBdb")}
          </div>
          {unlinkedPlans.map((c) => (
            <ControlPlanNode
              key={c.id}
              plan={c}
              selected={
                selection.kind === "controlPlan" && selection.id === c.id
              }
              indent={3}
              levelOffset={18}
              pendingDelete={
                isControlPlanPendingDelete
                  ? isControlPlanPendingDelete(c.id)
                  : false
              }
              onClick={() => onSelect({ kind: "controlPlan", id: c.id })}
              onContextMenu={openCpContextMenu}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * Popout state — which rail item is "open" and where on screen to anchor
 * the flyout panel.
 *
 * We use fixed positioning because the rail has its own vertical
 * `overflow: auto`, and an absolutely-positioned popout inside it would
 * get clipped when the button sits near the top/bottom edge. `rect.top`
 * and `rect.right` come from the button's bounding box at click time.
 */
type PopoutState =
  | {
      target: "contract";
      /** `null` is the "[No contract]" bucket. */
      contractId: number | null;
      top: number;
      left: number;
    }
  | { target: "bdb"; id: number; top: number; left: number }
  | null;

/**
 * The collapsed sidebar. Rendered as a thin rail with icon buttons;
 * clicking a group (work area / unassigned BDB) opens a popout that
 * shows the subtree so the user can reach BDBs and control plans
 * without expanding the whole sidebar. Leaf items (project, unlinked
 * control plans) open their tab directly.
 */
function CollapsedRail({
  data,
  selection,
  onSelect,
  groups,
  bdbsByWorkSpec,
  unassignedBdbs,
  unlinkedPlans,
  planById,
  onBdbContextMenu,
  onCpContextMenu,
  onWorkSpecContextMenu,
  onContractContextMenu,
  isContractPendingDelete,
  isWorkSpecPendingDelete,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
  onToggleCollapsed,
}: {
  data: FilePayload;
  selection: TabTarget;
  onSelect: (s: TabTarget) => void;
  groups: ContractGroup[];
  bdbsByWorkSpec: Map<number, BdbInfo[]>;
  unassignedBdbs: BdbInfo[];
  unlinkedPlans: ControlPlanInfo[];
  planById: Map<number, ControlPlanInfo>;
  /**
   * Right-click handlers — mirror the expanded tree so rail + popout
   * surfaces the same set of actions. All four are optional: when the
   * parent hasn't wired up the corresponding IPC, no menu appears.
   */
  onBdbContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  onWorkSpecContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    workSpecId: number,
  ) => void;
  onContractContextMenu?: (
    e: React.MouseEvent<HTMLElement>,
    contractId: number,
  ) => void;
  isContractPendingDelete?: (id: number) => boolean;
  /** FIX-DelCpStrike 2026-05-11 — rail popout was missing
   *  strikethrough for work areas / BDBs / CPs. Pass the same
   *  predicates we use for the expanded tree so rows render with
   *  `tree-node--pending-delete` when pending. */
  isWorkSpecPendingDelete?: (id: number) => boolean;
  isBdbPendingDelete?: (id: number) => boolean;
  isControlPlanPendingDelete?: (id: number) => boolean;
  /** Expand-the-sidebar button, rendered at the top of the rail. When
   *  absent we skip the button entirely (embedded mode). */
  onToggleCollapsed?: () => void;
}): JSX.Element {
  const t = useT();
  // Flat list used by the popout lookup — keeps the work-area search
  // order consistent with the expanded tree (group-by-group). Used
  // by RailPopout when walking the contract's subtree.
  const sortedWorkSpecs = useMemo(() => {
    const out: WorkSpecInfo[] = [];
    for (const g of groups) out.push(...g.workSpecs);
    return out;
  }, [groups]);
  // Only contracts with at least one work area show up as rail buttons
  // (per the design decision "empty contracts hide from the rail"). The
  // expanded tree still shows them.
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.workSpecs.length > 0),
    [groups],
  );
  const [popout, setPopout] = useState<PopoutState>(null);
  const popoutRef = useRef<HTMLDivElement | null>(null);

  /**
   * Close the popout if a click lands outside of it AND outside of any
   * rail button. We also close on Esc for keyboard users.
   *
   * The click listener uses `mousedown` rather than `click` so the popout
   * closes before any inner-button click fires — otherwise clicking a
   * different rail button while a popout was open would briefly flash
   * two popouts.
   */
  useEffect(() => {
    if (!popout) return;
    const onMouseDown = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoutRef.current?.contains(t)) return;
      // Rail buttons themselves handle their own toggle — don't fight
      // them. Let the button's onClick decide.
      const btn = (t as HTMLElement).closest?.(".rail-item");
      if (btn) return;
      // A right-click on a rail item or popout row opens the context
      // menu in a portal outside this popout. We want the popout to
      // stay open while the menu is visible — same behaviour as the
      // expanded tree. The menu has its own outside-click listener
      // that closes itself, so we just need to ignore those clicks
      // here.
      const inMenu = (t as HTMLElement).closest?.(".tree-context-menu");
      if (inMenu) return;
      setPopout(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPopout(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popout]);

  /** Open a contract's popout, or toggle closed if the same button
   *  was clicked again. Anchors at the button's right edge + top. */
  function toggleContract(
    e: React.MouseEvent<HTMLButtonElement>,
    contractId: number | null,
  ): void {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout((prev) =>
      prev && prev.target === "contract" && prev.contractId === contractId
        ? null
        : {
            target: "contract",
            contractId,
            top: rect.top,
            left: rect.right + 4,
          },
    );
  }

  /** Same, for an unassigned BDB button (the other thing that opens a
   *  popout from the rail). */
  function toggleBdb(e: React.MouseEvent<HTMLButtonElement>, id: number): void {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout((prev) =>
      prev && prev.target === "bdb" && prev.id === id
        ? null
        : { target: "bdb", id, top: rect.top, left: rect.right + 4 },
    );
  }

  /** Called when the user picks an item inside the popout. Opens the
   *  tab AND closes the popout so the collapsed rail stays quiet. */
  function pickFromPopout(t: TabTarget): void {
    onSelect(t);
    setPopout(null);
  }

  return (
    <>
      <aside
        className="sidebar sidebar--rail"
        aria-label={t("sidebar.aria.railNav")}
      >
        {/* Expand-sidebar button sits at the very top of the rail,
         *  above the home (⌂) icon. Moved here from the app header so
         *  the toggle lives inside the nav context it controls. */}
        {onToggleCollapsed && (
          <>
            <button
              type="button"
              className="sidebar__rail-collapse"
              onClick={onToggleCollapsed}
              aria-label={t("sidebar.aria.expandSidebar")}
              title={t("sidebar.tooltip.expandSidebar")}
            >
              ›
            </button>
            <div className="sidebar__rail-sep" aria-hidden="true" />
          </>
        )}
        {/* Home-icon removed from the rail: the Project tab in the
         * top tab bar now carries a home glyph and serves as the
         * entry point to the project overview. Keeping it here as
         * well would duplicate the control. */}
        {visibleGroups.map((g) => {
          const key =
            g.contractId === null
              ? "rail-contract-null"
              : `rail-contract-${g.contractId}`;
          const isOpen =
            popout?.target === "contract" && popout.contractId === g.contractId;
          // Rail label: contract code if present; else first chars of
          // name via railLabel; "—" glyph for the "[No contract]"
          // bucket. The tooltip carries the full "code - name".
          const label =
            g.contractId === null
              ? "—"
              : g.code
                ? g.code.trim().replace(/\s+/g, "").slice(0, 4) || "?"
                : railLabel(null, g.name);
          // A "selected" contract button = any work-area inside it
          // is the current tab. Gives a visual hint of which contract
          // the open spec belongs to, even in the thin rail.
          const selected =
            selection.kind === "workSpec" &&
            g.workSpecs.some((w) => w.id === selection.id);
          // Restore-contract menu only makes sense for a real, pending-
          // delete contract. The "[No contract]" bucket (contractId ===
          // null) can't be restored, so skip wiring the handler in that
          // case.
          const contractCtx =
            onContractContextMenu && g.contractId !== null
              ? (e: React.MouseEvent<HTMLButtonElement>) =>
                  onContractContextMenu(e, g.contractId as number)
              : undefined;
          // Translate the sentinel labels emitted by groupWorkSpecsByContract
          // ("[No contract]", "(unnamed contract)") for the rail tooltip.
          const railTitle =
            g.contractId === null
              ? t("sidebar.group.noContract")
              : g.label === "(unnamed contract)"
                ? t("contract.unnamedFallback")
                : g.label;
          return (
            <RailButton
              key={key}
              label={label}
              title={railTitle}
              selected={selected}
              kind="contract"
              ariaExpanded={isOpen}
              onClick={(e) => toggleContract(e, g.contractId)}
              onContextMenu={contractCtx}
            />
          );
        })}
        {unassignedBdbs.length > 0 && (
          <>
            <div className="sidebar__rail-sep" aria-hidden="true" />
            {unassignedBdbs.map((b) => {
              const hasChildren = b.controlPlanIds.length > 0;
              const isOpen = popout?.target === "bdb" && popout.id === b.id;
              return (
                <RailButton
                  key={`bdb-${b.id}`}
                  label={railLabel(null, b.name)}
                  title={b.name}
                  selected={selection.kind === "bdb" && selection.id === b.id}
                  kind="bdb"
                  ariaExpanded={hasChildren ? isOpen : undefined}
                  onClick={(e) => {
                    if (hasChildren) {
                      toggleBdb(e, b.id);
                    } else {
                      setPopout(null);
                      onSelect({ kind: "bdb", id: b.id });
                    }
                  }}
                  onContextMenu={
                    onBdbContextMenu
                      ? (e) => onBdbContextMenu(e, b.id)
                      : undefined
                  }
                />
              );
            })}
          </>
        )}
        {unlinkedPlans.length > 0 && (
          <>
            <div className="sidebar__rail-sep" aria-hidden="true" />
            {unlinkedPlans.map((c) => (
              <RailButton
                key={`cp-${c.id}`}
                label={railLabel(c.numberText, c.title)}
                title={`${c.numberText} — ${c.title}`}
                selected={
                  selection.kind === "controlPlan" && selection.id === c.id
                }
                kind="controlPlan"
                onClick={() => {
                  setPopout(null);
                  onSelect({ kind: "controlPlan", id: c.id });
                }}
                onContextMenu={
                  onCpContextMenu ? (e) => onCpContextMenu(e, c.id) : undefined
                }
              />
            ))}
          </>
        )}
      </aside>

      {popout && (
        <RailPopout
          ref={popoutRef}
          popout={popout}
          groups={groups}
          sortedWorkSpecs={sortedWorkSpecs}
          bdbsByWorkSpec={bdbsByWorkSpec}
          unassignedBdbs={unassignedBdbs}
          planById={planById}
          selection={selection}
          onPick={pickFromPopout}
          onBdbContextMenu={onBdbContextMenu}
          onCpContextMenu={onCpContextMenu}
          onWorkSpecContextMenu={onWorkSpecContextMenu}
          onContractContextMenu={onContractContextMenu}
          isContractPendingDelete={isContractPendingDelete}
          isWorkSpecPendingDelete={isWorkSpecPendingDelete}
          isBdbPendingDelete={isBdbPendingDelete}
          isControlPlanPendingDelete={isControlPlanPendingDelete}
        />
      )}
    </>
  );
}

/**
 * The flyout that appears next to a rail button. Content depends on
 * what was clicked:
 *  - Contract: a `code - name` header (non-clickable — you can't "open"
 *    a contract as a tab), then every work area in that contract,
 *    each with its BDBs + control plans nested underneath.
 *  - Unassigned BDB: the BDB itself + its control plans.
 *
 * Everything below the header is a plain button — clicking opens the
 * corresponding tab and closes the popout.
 *
 * NOTE: Wrapped in `forwardRef` because the parent uses the ref to
 * distinguish clicks-inside-popout from outside-click-to-close. React
 * 18 silently strips a plain `ref` prop on function components, so
 * forwardRef is required for the ref to actually land on the DOM
 * element and make `popoutRef.current?.contains(target)` work.
 */
interface RailPopoutProps {
  popout: NonNullable<PopoutState>;
  groups: ContractGroup[];
  sortedWorkSpecs: WorkSpecInfo[];
  bdbsByWorkSpec: Map<number, BdbInfo[]>;
  unassignedBdbs: BdbInfo[];
  planById: Map<number, ControlPlanInfo>;
  selection: TabTarget;
  onPick: (t: TabTarget) => void;
  /** Right-click handlers — optional, mirrored from the expanded tree. */
  onBdbContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  onWorkSpecContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    workSpecId: number,
  ) => void;
  onContractContextMenu?: (
    e: React.MouseEvent<HTMLElement>,
    contractId: number,
  ) => void;
  isContractPendingDelete?: (id: number) => boolean;
  /** FIX-DelCpStrike 2026-05-11 — pending-delete predicates so rail
   *  popout rows render strikethrough just like the expanded tree. */
  isWorkSpecPendingDelete?: (id: number) => boolean;
  isBdbPendingDelete?: (id: number) => boolean;
  isControlPlanPendingDelete?: (id: number) => boolean;
}

const RailPopout = forwardRef<HTMLDivElement, RailPopoutProps>(
  function RailPopout(
    {
      popout,
      groups,
      sortedWorkSpecs: _sortedWorkSpecs,
      bdbsByWorkSpec,
      unassignedBdbs,
      planById,
      selection,
      onPick,
      onBdbContextMenu,
      onCpContextMenu,
      onWorkSpecContextMenu,
      onContractContextMenu,
      isContractPendingDelete,
      isWorkSpecPendingDelete,
      isBdbPendingDelete,
      isControlPlanPendingDelete,
    },
    ref,
  ): JSX.Element | null {
    const t = useT();
    let header: React.ReactNode = null;
    let rows: React.ReactNode = null;

    if (popout.target === "contract") {
      const group = groups.find((g) => g.contractId === popout.contractId);
      if (!group) return null;
      // Non-clickable header: a contract isn't a tab target. Show code
      // and name on separate lines when both are present so the name has
      // room to breathe; just one line otherwise. Tooltip carries the
      // full label as a safety net.
      const showCode = group.contractId === null ? true : Boolean(group.code);
      const codeText = group.contractId === null ? "—" : group.code || "?";
      const nameText =
        group.contractId === null
          ? t("sidebar.popout.noContract")
          : group.name || t("contract.unnamedFallback");
      // Translate the sentinel label set by groupWorkSpecsByContract for
      // the tooltip on the popout header.
      const headerTitle =
        group.contractId === null
          ? t("sidebar.group.noContract")
          : group.label === "(unnamed contract)"
            ? t("contract.unnamedFallback")
            : group.label;
      // Offer "Restore contract" on the popout header only if the contract
      // is actually pending-delete (same rule as the expanded tree). The
      // "[No contract]" bucket has no contract to restore, so skip it.
      const headerCtx =
        onContractContextMenu &&
        group.contractId !== null &&
        isContractPendingDelete &&
        isContractPendingDelete(group.contractId)
          ? (e: React.MouseEvent<HTMLElement>) =>
              onContractContextMenu(e, group.contractId as number)
          : undefined;
      header = (
        <div
          className="rail-popout__header"
          title={headerTitle}
          role="presentation"
          onContextMenu={headerCtx}
        >
          {showCode && (
            <code className="rail-popout__header-code">{codeText}</code>
          )}
          <span className="rail-popout__header-name">{nameText}</span>
        </div>
      );
      rows =
        group.workSpecs.length === 0 ? (
          <div className="rail-popout__empty">
            {t("sidebar.empty.noWorkAreas")}
          </div>
        ) : (
          group.workSpecs.map((ws) => (
            <WorkSpecRailBlock
              key={ws.id}
              ws={ws}
              bdbs={bdbsByWorkSpec.get(ws.id) ?? []}
              planById={planById}
              selection={selection}
              onPick={onPick}
              onBdbContextMenu={onBdbContextMenu}
              onCpContextMenu={onCpContextMenu}
              onWorkSpecContextMenu={onWorkSpecContextMenu}
              isWorkSpecPendingDelete={isWorkSpecPendingDelete}
              isBdbPendingDelete={isBdbPendingDelete}
              isControlPlanPendingDelete={isControlPlanPendingDelete}
            />
          ))
        );
    } else {
      // target === "bdb" (unassigned)
      const bdb = unassignedBdbs.find((b) => b.id === popout.id);
      if (!bdb) return null;
      const bdbPending = isBdbPendingDelete
        ? isBdbPendingDelete(bdb.id)
        : false;
      header = (
        <button
          type="button"
          className={
            "rail-popout__top" +
            (selection.kind === "bdb" && selection.id === bdb.id
              ? " is-selected"
              : "") +
            (bdbPending ? " tree-node--pending-delete" : "")
          }
          onClick={() => onPick({ kind: "bdb", id: bdb.id })}
          onContextMenu={
            onBdbContextMenu ? (e) => onBdbContextMenu(e, bdb.id) : undefined
          }
          title={bdb.name}
        >
          {bdb.name}
          <PfbbPill bdb={bdb} />
        </button>
      );
      const plans = bdb.controlPlanIds
        .map((id) => planById.get(id))
        .filter((p): p is ControlPlanInfo => p != null);
      rows =
        plans.length === 0 ? (
          <div className="rail-popout__empty">
            {t("sidebar.empty.noControlPlans")}
          </div>
        ) : (
          plans.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                "rail-popout__row" +
                (selection.kind === "controlPlan" && selection.id === p.id
                  ? " is-selected"
                  : "") +
                (isControlPlanPendingDelete && isControlPlanPendingDelete(p.id)
                  ? " tree-node--pending-delete"
                  : "")
              }
              style={{ paddingLeft: 24 }}
              onClick={() => onPick({ kind: "controlPlan", id: p.id })}
              onContextMenu={
                onCpContextMenu ? (e) => onCpContextMenu(e, p.id) : undefined
              }
              title={p.title}
            >
              {renderCodeAndName(p.numberText, p.title)}
            </button>
          ))
        );
    }

    return (
      <div
        ref={ref}
        className="rail-popout"
        role="menu"
        style={{ top: popout.top, left: popout.left }}
      >
        {header}
        <div className="rail-popout__body">{rows}</div>
      </div>
    );
  },
);

/**
 * One work-area block inside a contract popout: a clickable row for
 * the work area itself, then its BDBs nested underneath, each followed
 * by its control plans. Indentation mirrors the expanded sidebar —
 * 12 px per level so the hierarchy reads at a glance.
 */
function WorkSpecRailBlock({
  ws,
  bdbs,
  planById,
  selection,
  onPick,
  onBdbContextMenu,
  onCpContextMenu,
  onWorkSpecContextMenu,
  isWorkSpecPendingDelete,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
}: {
  ws: WorkSpecInfo;
  bdbs: BdbInfo[];
  planById: Map<number, ControlPlanInfo>;
  selection: TabTarget;
  onPick: (t: TabTarget) => void;
  onBdbContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  onWorkSpecContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    workSpecId: number,
  ) => void;
  /** FIX-DelCpStrike 2026-05-11 — pending-delete predicates for
   *  strikethrough in the rail popout. */
  isWorkSpecPendingDelete?: (id: number) => boolean;
  isBdbPendingDelete?: (id: number) => boolean;
  isControlPlanPendingDelete?: (id: number) => boolean;
}): JSX.Element {
  const wsLabel = ws.workAreaCode
    ? `${ws.workAreaCode} — ${ws.workAreaName}`
    : ws.workAreaName;
  const wsPending = isWorkSpecPendingDelete
    ? isWorkSpecPendingDelete(ws.id)
    : false;
  return (
    <>
      <button
        type="button"
        className={
          "rail-popout__row" +
          (selection.kind === "workSpec" && selection.id === ws.id
            ? " is-selected"
            : "") +
          (wsPending ? " tree-node--pending-delete" : "")
        }
        // Indentation matches the expanded sidebar's 14px-per-level
        // cadence. Work area = first level under the popout header,
        // BDB = +14 (see BdbRailRow), CP = +28 (see BdbRailRow). Keeps
        // the popout tree visually consistent with the main tree.
        // Font weight is inherited (same as `.tree-node` — unbolded)
        // so popout rows match the expanded sidebar exactly.
        style={{ paddingLeft: 14 }}
        onClick={() => onPick({ kind: "workSpec", id: ws.id })}
        onContextMenu={
          onWorkSpecContextMenu
            ? (e) => onWorkSpecContextMenu(e, ws.id)
            : undefined
        }
        title={wsLabel}
      >
        {renderCodeAndName(ws.workAreaCode, ws.workAreaName)}
        <WorkAreaTypePill workSpec={ws} />
      </button>
      {bdbs.map((b) => (
        <BdbRailRow
          key={b.id}
          bdb={b}
          planById={planById}
          selection={selection}
          onPick={onPick}
          onBdbContextMenu={onBdbContextMenu}
          onCpContextMenu={onCpContextMenu}
          isBdbPendingDelete={isBdbPendingDelete}
          isControlPlanPendingDelete={isControlPlanPendingDelete}
        />
      ))}
    </>
  );
}

/** One BDB row inside a work-area popout — includes its control plans. */
function BdbRailRow({
  bdb,
  planById,
  selection,
  onPick,
  onBdbContextMenu,
  onCpContextMenu,
  isBdbPendingDelete,
  isControlPlanPendingDelete,
}: {
  bdb: BdbInfo;
  planById: Map<number, ControlPlanInfo>;
  selection: TabTarget;
  onPick: (t: TabTarget) => void;
  onBdbContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    bdbId: number,
  ) => void;
  onCpContextMenu?: (
    e: React.MouseEvent<HTMLButtonElement>,
    controlPlanId: number,
  ) => void;
  /** FIX-DelCpStrike 2026-05-11 — strikethrough predicates. */
  isBdbPendingDelete?: (id: number) => boolean;
  isControlPlanPendingDelete?: (id: number) => boolean;
}): JSX.Element {
  const plans = bdb.controlPlanIds
    .map((id) => planById.get(id))
    .filter((p): p is ControlPlanInfo => p != null);
  const bdbPending = isBdbPendingDelete ? isBdbPendingDelete(bdb.id) : false;
  return (
    <>
      <button
        type="button"
        className={
          "rail-popout__row" +
          (selection.kind === "bdb" && selection.id === bdb.id
            ? " is-selected"
            : "") +
          (bdbPending ? " tree-node--pending-delete" : "")
        }
        // +14 from the work-area row (14) = 28, matching the
        // expanded-sidebar cadence (work area → BDB is one level).
        style={{ paddingLeft: 28 }}
        onClick={() => onPick({ kind: "bdb", id: bdb.id })}
        onContextMenu={
          onBdbContextMenu ? (e) => onBdbContextMenu(e, bdb.id) : undefined
        }
        title={bdb.name}
      >
        {bdb.name}
        <PfbbPill bdb={bdb} />
      </button>
      {plans.map((p) => {
        const cpPending = isControlPlanPendingDelete
          ? isControlPlanPendingDelete(p.id)
          : false;
        return (
          <button
            key={p.id}
            type="button"
            className={
              "rail-popout__row" +
              (selection.kind === "controlPlan" && selection.id === p.id
                ? " is-selected"
                : "") +
              (cpPending ? " tree-node--pending-delete" : "")
            }
            // +14 from the BDB row (28) = 42 — CP one level deeper.
            style={{ paddingLeft: 42 }}
            onClick={() => onPick({ kind: "controlPlan", id: p.id })}
            onContextMenu={
              onCpContextMenu ? (e) => onCpContextMenu(e, p.id) : undefined
            }
            title={p.title}
          >
            {renderCodeAndName(p.numberText, p.title)}
          </button>
        );
      })}
    </>
  );
}

/** One square button in the icons-only rail. */
function RailButton({
  label,
  title,
  selected,
  kind,
  ariaExpanded,
  onClick,
  onContextMenu,
}: {
  label: string;
  title: string;
  selected: boolean;
  kind: "project" | "contract" | "workSpec" | "bdb" | "controlPlan";
  /** Whether this button currently has its popout open. `undefined` for
   *  leaf buttons (project, unlinked control plan) that never open a
   *  popout. */
  ariaExpanded?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Optional right-click handler. When supplied the caller is expected
   * to call `e.preventDefault()` so the browser's native context menu
   * doesn't also appear (the existing Sidebar `openXContextMenu` helpers
   * already do this). When omitted, the browser's default context menu
   * fires as normal.
   */
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`rail-item rail-item--${kind}${
        selected ? " is-selected" : ""
      }${ariaExpanded ? " is-open" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-label={title}
      aria-expanded={ariaExpanded}
    >
      {label}
    </button>
  );
}

/**
 * Short label for a rail button. Prefers a compact code (e.g. "BI 2");
 * otherwise falls back to the first 2-3 characters of the name.
 *
 * Exported for unit tests — no I/O, pure string math.
 */
export function railLabel(code: string | null, name: string): string {
  if (code && code.trim()) {
    // Collapse whitespace, keep up to 4 chars — codes like "BI 2" or "2.5"
    // fit; longer ones (unusual) truncate.
    const c = code.trim().replace(/\s+/g, "");
    return c.length <= 4 ? c : c.slice(0, 4);
  }
  // No code — take first word's first 2 chars, uppercased.
  const word = name.trim().split(/\s+/)[0] ?? "";
  return word.slice(0, 2).toUpperCase() || "?";
}
