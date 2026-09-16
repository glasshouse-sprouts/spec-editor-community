/**
 * Batch-export modal (Phase 7.3).
 *
 * Shown when the user clicks "Batch export…" on the Export card. Lets
 * them tick any combination of work areas, BDBs, and control plans,
 * then emits one PDF per selection into a user-picked folder (main
 * handles the directory dialog + writes).
 *
 * The modal is a controlled component: selection, cover and compact
 * live in the parent (`ExportCard`) so those flags stay in sync with
 * the single-export flow. Per Tore's call — the two checkboxes are
 * SHARED with the card, not modal-local.
 *
 * The tree itself is built by `buildExportTree` (pure). Parent-row
 * tri-state + cascading toggles are driven by helpers in
 * `exportTree.ts` — no cascade logic lives here.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  contractGroupState,
  selectAll,
  selectionCount,
  toggleContractGroup,
  toggleLeaf,
  toggleWorkArea,
  workAreaState,
  type ExportSelection,
  type ExportTree,
  type ExportTreeBdbNode,
  type ExportTreeContractGroup,
  type ExportTreeCpNode,
  type ExportTreeWorkAreaNode,
  type TriState,
} from "./exportTree.js";
import { useT } from "./i18n/i18n.js";
import { useCoverEngine } from "./coverContext.js";

/** Status surfaced after the IPC call finishes (or mid-flight). */
export type BatchExportStatus =
  | { kind: "idle" }
  | { kind: "building"; done: number; total: number }
  | { kind: "writing" }
  | {
      kind: "saved";
      directory: string;
      writtenCount: number;
      errors: Array<{ fileBase: string; message: string }>;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface BatchExportModalProps {
  tree: ExportTree;
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  includeCoverPage: boolean;
  onIncludeCoverPageChange: (v: boolean) => void;
  compact: boolean;
  onCompactChange: (v: boolean) => void;
  /** Include a table of contents (PDF + Word). Default on. */
  includeToc: boolean;
  onIncludeTocChange: (v: boolean) => void;
  /**
   * 2026-05-12. PDF export grouping mode.
   *  - "perSpec"     → one PDF per checked work area / BDB (default).
   *  - "perWorkArea" → one composite PDF per work area in scope.
   *  - "perContract" → one composite PDF per contract in scope.
   *  - "perProject"  → one PDF for the whole project.
   * Default is "perSpec" — matches previous behaviour exactly.
   */
  groupBy: "perSpec" | "perWorkArea" | "perContract" | "perProject";
  onGroupByChange: (
    v: "perSpec" | "perWorkArea" | "perContract" | "perProject",
  ) => void;
  /**
   * Slice "Version compare PDF" — show the version-compare options
   * row when a reference is loaded. The two flags both default off:
   * the user explicitly opts into marked changes / the summary PDF.
   * When `referenceLoaded` is false, this whole row is hidden so the
   * modal looks identical to its pre-slice form.
   */
  referenceLoaded?: boolean;
  markChanges?: boolean;
  onMarkChangesChange?: (v: boolean) => void;
  includeSummary?: boolean;
  onIncludeSummaryChange?: (v: boolean) => void;
  onCancel: () => void;
  /** Parent resolves once the IPC flow settles. */
  onExport: () => void;
  /**
   * DOCX-4 / DOCX-WA / DOCX-CP — optional callback for the "Word"
   * button. Receives the user's full selection of BDBs, work areas
   * AND control plans; Word export is one .docx per spec (mixing
   * kinds in one click). When omitted the Word button is hidden —
   * used by tests and the version-compare flow that doesn't
   * make sense for Word.
   *
   * The `opts` object carries the modal's option toggles that apply
   * to the Word build: `compact` (mirrors the PDF "Compact (hide empty
   * sections)" checkbox) and `includeToc` (the table-of-contents
   * toggle — picks the with-/no-TOC Word template).
   */
  onExportDocx?: (
    refs: ReadonlyArray<
      | { kind: "bdb"; id: number }
      | { kind: "workSpec"; id: number }
      | { kind: "cp"; id: number }
    >,
    opts: { compact: boolean; includeToc: boolean },
  ) => void;
  status: BatchExportStatus;
}

/**
 * The modal. Renders a backdrop + the card. Esc cancels. Export is
 * disabled until the user has ticked at least one leaf and we aren't
 * mid-flight.
 */
export function BatchExportModal(props: BatchExportModalProps): JSX.Element {
  const {
    tree,
    selection,
    onSelectionChange,
    includeCoverPage,
    onIncludeCoverPageChange,
    compact,
    onCompactChange,
    includeToc,
    onIncludeTocChange,
    groupBy,
    onGroupByChange,
    referenceLoaded = false,
    markChanges = false,
    onMarkChangesChange,
    includeSummary = false,
    onIncludeSummaryChange,
    onCancel,
    onExport,
    onExportDocx,
    status,
  } = props;

  const t = useT();
  // Custom-cover engine (Glasshouse). Used only for the "edit cover"
  // shortcut below; renders nothing in Community (enabled false).
  const cover = useCoverEngine();
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = status.kind === "building" || status.kind === "writing";
  const count = selectionCount(selection);
  // Allow export when the user has either selected at least one
  // target OR enabled the summary PDF (which doesn't depend on a
  // target selection — it summarises the whole project).
  const canExport = (count > 0 || includeSummary) && !busy;

  // Free-text filter — slice 10H.10-UX. Case-insensitive substring
  // match against a row's label (and, for CPs, the owner label). A
  // contract / work-area parent is kept when any descendant matches,
  // same pattern the sidebar uses via `filterSidebarTree`.
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  // Esc closes the modal — only when we're not mid-flight (closing during
  // an in-flight IPC would orphan the write).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Derived: are ALL leaves ticked? Used for the "Select all" master check.
  const allTicked = isAllTicked(tree, selection);

  // Index control plans by owning BDB id so every BDB row can render
  // its CPs nested right below it (like the project tree does).
  const cpsByBdb = useMemo(() => {
    const out = new Map<number, ExportTreeCpNode[]>();
    for (const cp of tree.controlPlans) {
      if (cp.owningBdbId == null) continue;
      const list = out.get(cp.owningBdbId);
      if (list) list.push(cp);
      else out.set(cp.owningBdbId, [cp]);
    }
    return out;
  }, [tree.controlPlans]);

  // CPs without a BDB owner render in their own homeless bucket at
  // the bottom, same way the sidebar surfaces homeless CPs.
  const homelessCps = useMemo(
    () => tree.controlPlans.filter((cp) => cp.owningBdbId == null),
    [tree.controlPlans],
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div
        className="modal batch-export-modal"
        ref={dialogRef}
        aria-labelledby="batch-export-title"
      >
        <h2 id="batch-export-title" className="modal__title">
          {t("modal.batchExport.title")}
        </h2>

        {/* Shared flags — inherited from ExportCard */}
        <div className="batch-export-modal__flags">
          <label className="batch-export-modal__flag">
            <input
              type="checkbox"
              checked={includeCoverPage}
              onChange={(e) => onIncludeCoverPageChange(e.target.checked)}
              disabled={busy}
            />
            <span>{t("modal.batchExport.options.includeCoverPage")}</span>
          </label>
          <label className="batch-export-modal__flag">
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => onCompactChange(e.target.checked)}
              disabled={busy}
            />
            <span>{t("modal.batchExport.options.compact")}</span>
          </label>
          <label className="batch-export-modal__flag">
            <input
              type="checkbox"
              checked={includeToc}
              onChange={(e) => onIncludeTocChange(e.target.checked)}
              disabled={busy}
            />
            <span>{t("modal.batchExport.options.tableOfContents")}</span>
          </label>
        </div>

        {/* 2026-05-12. PDF grouping selector. Default 'perSpec' =
            today's behaviour. The other three bundle multiple specs
            into a single composite PDF — see exportGrouping.ts.
            Switched from radio buttons to a dropdown (Tore 2026-05-12)
            so the modal stays compact; the label still uses the
            same legend i18n key. */}
        <div className="batch-export-modal__groupby">
          <label
            className="batch-export-modal__groupby-label"
            htmlFor="batch-export-groupby"
          >
            {t("modal.batchExport.groupBy.legend")}
          </label>
          <select
            id="batch-export-groupby"
            className="batch-export-modal__groupby-select"
            value={groupBy}
            onChange={(e) =>
              onGroupByChange(
                e.target.value as
                  | "perSpec"
                  | "perWorkArea"
                  | "perContract"
                  | "perProject",
              )
            }
            disabled={busy}
          >
            {(
              ["perSpec", "perWorkArea", "perContract", "perProject"] as const
            ).map((v) => (
              <option key={v} value={v}>
                {t(`modal.batchExport.groupBy.${v}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Version-compare options — only visible when a reference is
         *  loaded. Both default off; user opts in. */}
        {referenceLoaded && (
          <div className="batch-export-modal__flags batch-export-modal__flags--versionCompare">
            <label className="batch-export-modal__flag">
              <input
                type="checkbox"
                checked={markChanges}
                onChange={(e) => onMarkChangesChange?.(e.target.checked)}
                disabled={busy}
              />
              <span>{t("modal.batchExport.options.markChanges")}</span>
            </label>
            <label className="batch-export-modal__flag">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => onIncludeSummaryChange?.(e.target.checked)}
                disabled={busy}
              />
              <span>{t("modal.batchExport.options.includeSummary")}</span>
            </label>
          </div>
        )}

        {/* Free-text filter — hides non-matching rows, keeps parents
         * whose descendants match. */}
        <div className="batch-export-modal__filter">
          <input
            type="search"
            placeholder={t("modal.batchExport.filter.placeholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={busy}
            className="batch-export-modal__filter-input"
            aria-label={t("modal.batchExport.filter.ariaLabel")}
          />
          {q && (
            <button
              type="button"
              className="batch-export-modal__filter-clear"
              onClick={() => setFilter("")}
              disabled={busy}
              aria-label={t("modal.batchExport.filter.clearAriaLabel")}
              title={t("modal.batchExport.filter.clearTitle")}
            >
              ×
            </button>
          )}
        </div>

        {/* Select-all master toggle */}
        <div className="batch-export-modal__select-all">
          <label className="batch-export-modal__flag">
            <input
              type="checkbox"
              checked={allTicked}
              // Indeterminate when some-but-not-all are ticked.
              ref={(el) => {
                if (el) el.indeterminate = !allTicked && count > 0;
              }}
              onChange={(e) =>
                onSelectionChange(selectAll(tree, e.target.checked))
              }
              disabled={busy}
            />
            <span>{t("modal.batchExport.selectAll")}</span>
          </label>
          <span className="batch-export-modal__count">
            {count === 0
              ? t("modal.batchExport.count.none")
              : count === 1
                ? t("modal.batchExport.count.one")
                : t("modal.batchExport.count.many", { count })}
          </span>
        </div>

        {/* The tree */}
        <div className="batch-export-modal__tree">
          {tree.contractGroups.map((group) => (
            <ContractGroupBlock
              key={contractGroupKey(group)}
              group={group}
              selection={selection}
              onSelectionChange={onSelectionChange}
              disabled={busy}
              cpsByBdb={cpsByBdb}
              filter={q}
            />
          ))}
          {tree.standaloneBdbs.length > 0 && (
            <StandaloneBdbsBlock
              bdbs={tree.standaloneBdbs}
              selection={selection}
              onSelectionChange={onSelectionChange}
              disabled={busy}
              cpsByBdb={cpsByBdb}
              filter={q}
            />
          )}
          {homelessCps.length > 0 && (
            <HomelessCpsBlock
              cps={homelessCps}
              selection={selection}
              onSelectionChange={onSelectionChange}
              disabled={busy}
              filter={q}
            />
          )}
          {tree.contractGroups.length === 0 &&
            tree.standaloneBdbs.length === 0 &&
            tree.controlPlans.length === 0 && (
              <div className="batch-export-modal__empty">
                {t("modal.batchExport.empty")}
              </div>
            )}
        </div>

        {/* Status line + buttons */}
        <BatchStatusLine status={status} />
        <div className="modal__actions">
          {/* Custom cover (Glasshouse) shortcut — pinned bottom-left via
              margin-right:auto so the other actions stay right. Hidden in
              Community (engine off). Opens the same editor as the card. */}
          {cover.enabled && (
            <button
              type="button"
              className="modal__button"
              style={{ marginRight: "auto" }}
              onClick={cover.openEditor}
              disabled={busy}
            >
              Rediger forside…
            </button>
          )}
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            disabled={busy}
          >
            {status.kind === "saved" ? t("common.close") : t("common.cancel")}
          </button>
          {/* DOCX-4 / DOCX-WA / DOCX-CP — Word button. Hidden when
              the host didn't wire `onExportDocx`. Enabled when at
              least one BDB, work area, or control plan is ticked;
              all three kinds export to one .docx per spec in the
              same click. Order: work areas → BDBs → control plans,
              matching the sidebar's display order. */}
          {onExportDocx &&
            (() => {
              const wordRefs: Array<
                | { kind: "bdb"; id: number }
                | { kind: "workSpec"; id: number }
                | { kind: "cp"; id: number }
              > = [
                ...Array.from(selection.workAreas)
                  .sort((a, b) => a - b)
                  .map((id) => ({ kind: "workSpec" as const, id })),
                ...Array.from(selection.bdbs)
                  .sort((a, b) => a - b)
                  .map((id) => ({ kind: "bdb" as const, id })),
                ...Array.from(selection.cps)
                  .sort((a, b) => a - b)
                  .map((id) => ({ kind: "cp" as const, id })),
              ];
              const wordCount = wordRefs.length;
              return (
                <button
                  type="button"
                  className="modal__button"
                  onClick={() => onExportDocx(wordRefs, { compact, includeToc })}
                  disabled={busy || wordCount === 0}
                  title={
                    wordCount === 0
                      ? "Vælg mindst én bygningsdelsbeskrivelse, arbejdsbeskrivelse eller kontrolplan for at eksportere til Word."
                      : `Eksportér ${wordCount} spec(s) som Word-dokumenter.`
                  }
                >
                  {wordCount <= 1
                    ? "Eksportér Word"
                    : `Eksportér ${wordCount} Word-filer`}
                </button>
              );
            })()}
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onExport}
            disabled={!canExport}
          >
            {busy
              ? t("modal.batchExport.busy.exporting")
              : count === 1
                ? t("modal.batchExport.exportButtonOne")
                : t("modal.batchExport.exportButtonMany", { count })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract → work-area → BDB block
// ---------------------------------------------------------------------------

function ContractGroupBlock({
  group,
  selection,
  onSelectionChange,
  disabled,
  cpsByBdb,
  filter,
}: {
  group: ExportTreeContractGroup;
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  disabled: boolean;
  cpsByBdb: Map<number, ExportTreeCpNode[]>;
  filter: string;
}): JSX.Element | null {
  // Filter: keep a work area only if itself or any descendant matches.
  const visibleWas = group.workAreas.filter((wa) =>
    workAreaMatchesFilter(wa, cpsByBdb, filter),
  );
  // Group visible iff group label matches OR any visible WA matches.
  const groupMatches = matchesText(group.label, filter);
  if (!groupMatches && visibleWas.length === 0) return null;
  // If the group itself matches the filter, show all its work areas
  // (inherit match); otherwise only the filtered subset.
  const wasToRender = groupMatches ? group.workAreas : visibleWas;

  const state = contractGroupState(selection, group);
  return (
    <div className="batch-export-modal__group">
      <TriStateRow
        label={group.label}
        state={state}
        onToggle={() =>
          onSelectionChange(toggleContractGroup(selection, group))
        }
        disabled={disabled}
        rowClass="batch-export-modal__row--contract"
      />
      <div className="batch-export-modal__children">
        {wasToRender.map((wa) => (
          <WorkAreaBlock
            key={`wa:${wa.id}`}
            wa={wa}
            selection={selection}
            onSelectionChange={onSelectionChange}
            disabled={disabled}
            cpsByBdb={cpsByBdb}
            // Cascade-pass the filter only when the group/WA ancestor
            // doesn't already match; otherwise treat "all visible".
            filter={groupMatches ? "" : filter}
          />
        ))}
      </div>
    </div>
  );
}

function WorkAreaBlock({
  wa,
  selection,
  onSelectionChange,
  disabled,
  cpsByBdb,
  filter,
}: {
  wa: ExportTreeWorkAreaNode;
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  disabled: boolean;
  cpsByBdb: Map<number, ExportTreeCpNode[]>;
  filter: string;
}): JSX.Element | null {
  const t = useT();
  const waMatches = matchesText(wa.label, filter);
  const visibleBdbs = wa.bdbs.filter((b) =>
    bdbMatchesFilter(b, cpsByBdb, filter),
  );
  if (filter && !waMatches && visibleBdbs.length === 0) return null;
  const bdbsToRender = !filter || waMatches ? wa.bdbs : visibleBdbs;

  const state = workAreaState(selection, wa);
  return (
    <div className="batch-export-modal__wa">
      <TriStateRow
        label={wa.label}
        state={state}
        onToggle={() => onSelectionChange(toggleWorkArea(selection, wa))}
        disabled={disabled}
        rowClass="batch-export-modal__row--wa"
      />
      <div className="batch-export-modal__children">
        {/* Explicit checkbox for the work area PDF itself. Separate from
         * the tri-state parent row above so the user can export just the
         * BDBs without the parent spec. */}
        <div className="batch-export-modal__row batch-export-modal__row--wa-self">
          <label className="batch-export-modal__check">
            <input
              type="checkbox"
              checked={selection.workAreas.has(wa.id)}
              onChange={() =>
                onSelectionChange(toggleLeaf(selection, "workArea", wa.id))
              }
              disabled={disabled}
            />
            <span>{t("modal.batchExport.includeWorkAreaPdf")}</span>
          </label>
        </div>
        {bdbsToRender.map((b) => (
          <BdbWithCpsRow
            key={`bdb:${b.id}`}
            bdb={b}
            selection={selection}
            onSelectionChange={onSelectionChange}
            disabled={disabled}
            cpsByBdb={cpsByBdb}
            filter={waMatches ? "" : filter}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One BDB row plus its child CPs nested underneath. Slice 10H.10-UX —
 * replaces the old flat "Control plans" bucket at the bottom of the
 * modal; CPs now live with their owning BDB, matching the project tree.
 */
function BdbWithCpsRow({
  bdb,
  selection,
  onSelectionChange,
  disabled,
  cpsByBdb,
  filter,
}: {
  bdb: ExportTreeBdbNode;
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  disabled: boolean;
  cpsByBdb: Map<number, ExportTreeCpNode[]>;
  filter: string;
}): JSX.Element | null {
  const cps = cpsByBdb.get(bdb.id) ?? [];
  const bdbMatches = matchesText(bdb.label, filter);
  const visibleCps = cps.filter((cp) => matchesText(cp.label, filter));
  if (filter && !bdbMatches && visibleCps.length === 0) return null;
  const cpsToRender = !filter || bdbMatches ? cps : visibleCps;

  return (
    <div className="batch-export-modal__bdb">
      <div className="batch-export-modal__row batch-export-modal__row--bdb">
        <label className="batch-export-modal__check">
          <input
            type="checkbox"
            checked={selection.bdbs.has(bdb.id)}
            onChange={() =>
              onSelectionChange(toggleLeaf(selection, "bdb", bdb.id))
            }
            disabled={disabled}
          />
          <span>{bdb.label}</span>
        </label>
      </div>
      {cpsToRender.length > 0 && (
        <div className="batch-export-modal__children">
          {cpsToRender.map((cp) => (
            <CpRow
              key={`cp:${cp.id}`}
              cp={cp}
              checked={selection.cps.has(cp.id)}
              onToggle={() =>
                onSelectionChange(toggleLeaf(selection, "cp", cp.id))
              }
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Standalone BDBs (no parent work area). Rendered as a group at the
 * bottom of the tree, same nesting rules for their CPs as the main
 * contract → work-area → BDB branch.
 */
function StandaloneBdbsBlock({
  bdbs,
  selection,
  onSelectionChange,
  disabled,
  cpsByBdb,
  filter,
}: {
  bdbs: ExportTreeBdbNode[];
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  disabled: boolean;
  cpsByBdb: Map<number, ExportTreeCpNode[]>;
  filter: string;
}): JSX.Element | null {
  const t = useT();
  const visible = bdbs.filter((b) => bdbMatchesFilter(b, cpsByBdb, filter));
  if (filter && visible.length === 0) return null;
  const toRender = filter ? visible : bdbs;
  return (
    <div className="batch-export-modal__group">
      <div className="batch-export-modal__group-label">
        {t("modal.batchExport.groups.standaloneBdbs")}
      </div>
      {toRender.map((b) => (
        <BdbWithCpsRow
          key={`sb:${b.id}`}
          bdb={b}
          selection={selection}
          onSelectionChange={onSelectionChange}
          disabled={disabled}
          cpsByBdb={cpsByBdb}
          filter={filter}
        />
      ))}
    </div>
  );
}

/**
 * Homeless CPs — CPs whose owning BDB was deleted / never set.
 * Rendered at the bottom so they stay reachable but don't clutter
 * the main tree.
 */
function HomelessCpsBlock({
  cps,
  selection,
  onSelectionChange,
  disabled,
  filter,
}: {
  cps: ExportTreeCpNode[];
  selection: ExportSelection;
  onSelectionChange: (next: ExportSelection) => void;
  disabled: boolean;
  filter: string;
}): JSX.Element | null {
  const t = useT();
  const visible = cps.filter((cp) => matchesText(cp.label, filter));
  if (filter && visible.length === 0) return null;
  const toRender = filter ? visible : cps;
  return (
    <div className="batch-export-modal__group">
      <div className="batch-export-modal__group-label">
        {t("modal.batchExport.groups.homelessCps")}
      </div>
      {toRender.map((cp) => (
        <CpRow
          key={`cp:${cp.id}`}
          cp={cp}
          checked={selection.cps.has(cp.id)}
          onToggle={() => onSelectionChange(toggleLeaf(selection, "cp", cp.id))}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function CpRow({
  cp,
  checked,
  onToggle,
  disabled,
}: {
  cp: ExportTreeCpNode;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="batch-export-modal__row batch-export-modal__row--cp">
      <label className="batch-export-modal__check">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
        />
        <span>{cp.label}</span>
      </label>
    </div>
  );
}

/** Plain case-insensitive substring match. Empty `q` matches everything. */
function matchesText(label: string, q: string): boolean {
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

function bdbMatchesFilter(
  bdb: ExportTreeBdbNode,
  cpsByBdb: Map<number, ExportTreeCpNode[]>,
  q: string,
): boolean {
  if (!q) return true;
  if (matchesText(bdb.label, q)) return true;
  const cps = cpsByBdb.get(bdb.id) ?? [];
  return cps.some((cp) => matchesText(cp.label, q));
}

function workAreaMatchesFilter(
  wa: ExportTreeWorkAreaNode,
  cpsByBdb: Map<number, ExportTreeCpNode[]>,
  q: string,
): boolean {
  if (!q) return true;
  if (matchesText(wa.label, q)) return true;
  return wa.bdbs.some((b) => bdbMatchesFilter(b, cpsByBdb, q));
}

/**
 * Checkbox that honours the tri-state from exportTree.ts. React doesn't
 * accept `indeterminate` as a JSX prop, so we set it via a ref.
 */
function TriStateRow({
  label,
  state,
  onToggle,
  disabled,
  rowClass,
}: {
  label: string;
  state: TriState;
  onToggle: () => void;
  disabled: boolean;
  rowClass: string;
}): JSX.Element {
  return (
    <div className={`batch-export-modal__row ${rowClass}`}>
      <label className="batch-export-modal__check">
        <input
          type="checkbox"
          checked={state === "all"}
          ref={(el) => {
            if (el) el.indeterminate = state === "some";
          }}
          onChange={onToggle}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

function BatchStatusLine({
  status,
}: {
  status: BatchExportStatus;
}): JSX.Element | null {
  const t = useT();
  if (status.kind === "idle") return null;
  if (status.kind === "building") {
    return (
      <p className="batch-export-modal__status">
        {t("modal.batchExport.busy.building", {
          current: status.done,
          total: status.total,
        })}
      </p>
    );
  }
  if (status.kind === "writing") {
    return (
      <p className="batch-export-modal__status">
        {t("modal.batchExport.busy.writing")}
      </p>
    );
  }
  if (status.kind === "cancelled") {
    return (
      <p className="batch-export-modal__status batch-export-modal__status--muted">
        {t("modal.batchExport.busy.cancelled")}
      </p>
    );
  }
  if (status.kind === "saved") {
    if (status.errors.length === 0) {
      return (
        <p className="batch-export-modal__status batch-export-modal__status--ok">
          {status.writtenCount === 1
            ? t("modal.batchExport.success.savedOne")
            : t("modal.batchExport.success.savedMany", {
                count: status.writtenCount,
              })}{" "}
          <code>{status.directory}</code>.
        </p>
      );
    }
    const total = status.writtenCount + status.errors.length;
    return (
      <div className="batch-export-modal__status batch-export-modal__status--warn">
        <p>
          {t("modal.batchExport.success.savedPartial", {
            written: status.writtenCount,
            total,
          })}{" "}
          <code>{status.directory}</code>.
        </p>
        <ul>
          {status.errors.map((e) => (
            <li key={e.fileBase}>
              <strong>{e.fileBase}</strong>: {e.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="batch-export-modal__status batch-export-modal__status--err">
      {t("modal.batchExport.error.generic", { message: status.message })}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contractGroupKey(g: ExportTreeContractGroup): string {
  return g.id === null ? "contract:null" : `contract:${g.id}`;
}

/** True when every leaf in the tree is in the selection. */
function isAllTicked(tree: ExportTree, sel: ExportSelection): boolean {
  for (const g of tree.contractGroups) {
    for (const wa of g.workAreas) {
      if (!sel.workAreas.has(wa.id)) return false;
      for (const b of wa.bdbs) if (!sel.bdbs.has(b.id)) return false;
    }
  }
  for (const b of tree.standaloneBdbs) if (!sel.bdbs.has(b.id)) return false;
  for (const cp of tree.controlPlans) if (!sel.cps.has(cp.id)) return false;
  // An empty tree is vacuously "all" — but we surface that as `count===0`
  // in the caller, so returning true here is fine.
  return true;
}
