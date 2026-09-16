/**
 * Import-from-another-moliospec modal.
 *
 * Rendered from App.tsx when `importDialog` is non-null. The modal
 * has four panels stacked vertically:
 *
 *   1. File header (source path, Change… button — not yet wired).
 *   2. Source tree with per-row checkbox + inline landing-spot picker.
 *   3. Collision banner (shown after Check): per-colliding row,
 *      inline Skip / Rename / Overwrite (Overwrite hidden for BDBs
 *      because core throws — see Slice 6K.1) + rename input.
 *   4. Action row: Cancel / Check / Import.
 *
 * All state lives in App.tsx; this component is a pure controlled
 * view. Props are wide but each callback maps 1:1 to one transition
 * in `importPlan.ts`, so the callsite remains readable.
 */

import { useT } from "./i18n/i18n.js";
import { useEscToClose } from "./modals/useEscToClose.js";
import type {
  BdbResolution,
  CollisionIndex,
  ImportModalState,
  ResolutionsMap,
  SourceTree,
  SourceTreeBdbNode,
  SourceTreeContractGroup,
  SourceTreeWorkAreaNode,
  WorkAreaResolution,
} from "./importPlan.js";
import { contractLabel, workAreaLabel } from "./importPlan.js";
import type {
  ContractInfo,
  ImportCollisionPolicy,
  ImportSummary,
  WorkSpecInfo,
} from "../../shared/ipc.js";

/** Shape of the error banner shown at the top of the modal. */
export type ImportDialogError =
  | { kind: "dirty" }
  | { kind: "conflict" }
  | { kind: "target-missing" }
  | { kind: "source-missing" }
  | { kind: "other"; message: string };

/**
 * Everything the modal needs to render. `App.tsx` hands this down as
 * one prop so the interface stays legible at the callsite even though
 * the shape itself is wide.
 */
export interface ImportDialogView {
  sourcePath: string;
  tree: SourceTree | null;
  modalState: ImportModalState;
  targetContracts: readonly ContractInfo[];
  targetWorkAreas: readonly WorkSpecInfo[];
  /** After Check ran successfully. Null before. */
  collisionIndex: CollisionIndex | null;
  resolutions: ResolutionsMap;
  busy: null | "loading" | "checking" | "applying";
  error: ImportDialogError | null;
  /** True when the Check button's gate (everything has a landing
   * spot) is satisfied. Driven from `canCheck` in the parent. */
  canCheck: boolean;
  /** True once a precheck has run + every collision is resolved. */
  canImport: boolean;
  /** Set on successful import. When non-null, the modal shows a
   * success view instead of the tree + action buttons. */
  successSummary: ImportSummary | null;
}

export interface ImportModalProps {
  view: ImportDialogView;
  onCancel: () => void;
  onCheck: () => void;
  onImport: () => void;
  onToggleWorkArea: (wa: SourceTreeWorkAreaNode, checked: boolean) => void;
  onToggleBdb: (bdbId: number, checked: boolean) => void;
  onSetLandingContract: (
    sourceWorkSpecId: number,
    targetContractId: number | null,
  ) => void;
  onSetLandingWorkArea: (sourceBdbId: number, targetWorkSpecId: number) => void;
  onSetWorkAreaResolution: (
    sourceWorkSpecId: number,
    r: WorkAreaResolution,
  ) => void;
  onSetBdbResolution: (sourceBdbId: number, r: BdbResolution) => void;
}

// --------------------------------------------------------------------------
// Top-level component
// --------------------------------------------------------------------------

export function ImportModal(props: ImportModalProps): JSX.Element {
  const t = useT();
  useEscToClose(props.onCancel);
  const { view } = props;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="modal import-modal">
        <h2 id="import-modal-title" className="modal__title">
          {t("modal.import.title")}
        </h2>
        <p className="modal__body modal__muted">
          {t("modal.import.sourceLabel")}{" "}
          <code className="path">{view.sourcePath}</code>
        </p>

        {view.error && (
          <div className="modal__error" role="alert" aria-live="polite">
            {renderError(t, view.error)}
          </div>
        )}

        {view.successSummary ? (
          <SuccessView summary={view.successSummary} onClose={props.onCancel} />
        ) : (
          <>
            <TreeSection {...props} />
            {view.collisionIndex && <CollisionSection {...props} />}
            <ActionRow {...props} />
          </>
        )}
      </div>
    </div>
  );
}

function renderError(
  t: (key: string, params?: Record<string, string | number>) => string,
  e: ImportDialogError,
): string {
  switch (e.kind) {
    case "dirty":
      return t("modal.import.error.dirty");
    case "conflict":
      return t("modal.import.error.conflict");
    case "target-missing":
      return t("modal.import.error.targetMissing");
    case "source-missing":
      return t("modal.import.error.sourceMissing");
    case "other":
      return t("modal.import.error.other", { message: e.message });
  }
}

// --------------------------------------------------------------------------
// Tree panel
// --------------------------------------------------------------------------

function TreeSection(props: ImportModalProps): JSX.Element {
  const t = useT();
  const { view } = props;
  if (view.busy === "loading" || view.tree === null) {
    return (
      <div className="import-modal__tree import-modal__tree--loading">
        <p className="modal__muted">{t("modal.import.busy.loading")}</p>
      </div>
    );
  }

  const { tree } = view;
  if (tree.contractGroups.length === 0 && tree.standaloneBdbs.length === 0) {
    return (
      <div className="import-modal__tree import-modal__tree--empty">
        <p className="modal__muted">{t("modal.import.tree.empty")}</p>
      </div>
    );
  }

  return (
    <div className="import-modal__tree" role="tree">
      {tree.contractGroups.map((group) => (
        <ContractGroupRow key={groupKey(group.id)} group={group} {...props} />
      ))}
      {tree.standaloneBdbs.length > 0 && (
        <StandaloneBdbsGroup bdbs={tree.standaloneBdbs} {...props} />
      )}
    </div>
  );
}

function groupKey(id: number | null): string {
  return id === null ? "no-contract" : `contract-${id}`;
}

function ContractGroupRow({
  group,
  ...rest
}: { group: SourceTreeContractGroup } & ImportModalProps): JSX.Element {
  const t = useT();
  return (
    <div className="import-modal__group" role="group">
      <div className="import-modal__group-label">{group.label}</div>
      {group.workAreas.length === 0 ? (
        <div className="import-modal__empty-note modal__muted">
          {t("modal.import.tree.noWorkAreasInContract")}
        </div>
      ) : (
        group.workAreas.map((wa) => (
          <WorkAreaRow key={wa.id} wa={wa} {...rest} />
        ))
      )}
    </div>
  );
}

function WorkAreaRow({
  wa,
  ...props
}: { wa: SourceTreeWorkAreaNode } & ImportModalProps): JSX.Element {
  const t = useT();
  const { view } = props;
  const checked = view.modalState.checkedWorkAreas.has(wa.id);
  const landing = view.modalState.landingContract.get(wa.id);
  const collision = view.collisionIndex?.workAreaBySourceId.get(wa.id) ?? null;
  const resolution = view.resolutions.workAreas.get(wa.id);
  const busy = view.busy !== null;

  return (
    <div className="import-modal__row import-modal__row--wa">
      <label className="import-modal__check">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => props.onToggleWorkArea(wa, e.currentTarget.checked)}
        />
        <span className="import-modal__row-label">{workAreaLabel(wa)}</span>
      </label>

      {checked && (
        <div className="import-modal__row-controls">
          <label className="import-modal__inline">
            <span className="import-modal__inline-label">
              {t("modal.import.landUnder")}
            </span>
            <select
              className="import-modal__select"
              disabled={busy}
              value={
                landing === undefined
                  ? "__unset"
                  : landing === null
                    ? "__none"
                    : String(landing)
              }
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "__unset") return;
                if (v === "__none") props.onSetLandingContract(wa.id, null);
                else props.onSetLandingContract(wa.id, Number.parseInt(v, 10));
              }}
            >
              {landing === undefined && (
                <option value="__unset">
                  {t("modal.import.chooseContract")}
                </option>
              )}
              <option value="__none">{t("modal.import.noContract")}</option>
              {view.targetContracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contractLabel(c)}
                </option>
              ))}
            </select>
          </label>

          {collision && (
            <WorkAreaCollisionControl
              sourceWorkSpecId={wa.id}
              resolution={resolution}
              onSet={(r) => props.onSetWorkAreaResolution(wa.id, r)}
              busy={busy}
              collisionLabel={workAreaLabel({
                workAreaCode: collision.workAreaCode,
                workAreaName: collision.workAreaName,
              })}
            />
          )}
        </div>
      )}

      {checked && wa.bdbs.length > 0 && (
        <div className="import-modal__children">
          {wa.bdbs.map((b) => (
            <BdbRow key={b.id} bdb={b} standalone={false} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}

function StandaloneBdbsGroup({
  bdbs,
  ...rest
}: { bdbs: SourceTreeBdbNode[] } & ImportModalProps): JSX.Element {
  const t = useT();
  return (
    <div className="import-modal__group" role="group">
      <div className="import-modal__group-label">
        {t("modal.import.standaloneBdbs")}
      </div>
      {bdbs.map((b) => (
        <BdbRow key={b.id} bdb={b} standalone={true} {...rest} />
      ))}
    </div>
  );
}

function BdbRow({
  bdb,
  standalone,
  ...props
}: {
  bdb: SourceTreeBdbNode;
  standalone: boolean;
} & ImportModalProps): JSX.Element {
  const t = useT();
  const { view } = props;
  const checked = view.modalState.checkedBdbs.has(bdb.id);
  const landing = view.modalState.landingWorkArea.get(bdb.id);
  const collision = view.collisionIndex?.bdbBySourceId.get(bdb.id) ?? null;
  const resolution = view.resolutions.bdbs.get(bdb.id);
  const busy = view.busy !== null;

  return (
    <div className="import-modal__row import-modal__row--bdb">
      <label className="import-modal__check">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => props.onToggleBdb(bdb.id, e.currentTarget.checked)}
        />
        <span className="import-modal__row-label">{bdb.name}</span>
      </label>

      {checked && standalone && (
        <div className="import-modal__row-controls">
          <label className="import-modal__inline">
            <span className="import-modal__inline-label">
              {t("modal.import.landUnder")}
            </span>
            <select
              className="import-modal__select"
              disabled={busy || view.targetWorkAreas.length === 0}
              value={landing === undefined ? "__unset" : String(landing)}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "__unset") return;
                props.onSetLandingWorkArea(bdb.id, Number.parseInt(v, 10));
              }}
            >
              {landing === undefined && (
                <option value="__unset">
                  {t("modal.import.chooseWorkArea")}
                </option>
              )}
              {view.targetWorkAreas.map((w) => (
                <option key={w.id} value={w.id}>
                  {workAreaLabel(w)}
                </option>
              ))}
            </select>
          </label>

          {view.targetWorkAreas.length === 0 && (
            <span className="import-modal__inline-note">
              {t("modal.import.targetNoWorkAreas")}
            </span>
          )}
        </div>
      )}

      {checked && collision && (
        <div className="import-modal__row-controls">
          <BdbCollisionControl
            sourceBdbId={bdb.id}
            resolution={resolution}
            onSet={(r) => props.onSetBdbResolution(bdb.id, r)}
            busy={busy}
            collisionName={collision.name}
          />
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Collision section header (a summary banner above the tree when
// precheck found collisions; the row-level pills do the actual work).
// --------------------------------------------------------------------------

function CollisionSection(props: ImportModalProps): JSX.Element {
  const t = useT();
  const { view } = props;
  const waN = view.collisionIndex?.workAreaBySourceId.size ?? 0;
  const bdbN = view.collisionIndex?.bdbBySourceId.size ?? 0;
  if (waN === 0 && bdbN === 0) {
    return (
      <p className="import-modal__check-banner import-modal__check-banner--ok">
        {t("modal.import.collision.bannerOk")}
      </p>
    );
  }
  const parts: string[] = [];
  if (waN > 0) {
    parts.push(
      waN === 1
        ? t("modal.import.collision.workAreaCountOne", { count: waN })
        : t("modal.import.collision.workAreaCountMany", { count: waN }),
    );
  }
  if (bdbN > 0) {
    parts.push(
      bdbN === 1
        ? t("modal.import.collision.bdbCountOne", { count: bdbN })
        : t("modal.import.collision.bdbCountMany", { count: bdbN }),
    );
  }
  const joined = parts.join(t("modal.import.collision.joiner"));
  return (
    <p className="import-modal__check-banner import-modal__check-banner--warn">
      {t("modal.import.collision.bannerWarn", { items: joined })}
    </p>
  );
}

// --------------------------------------------------------------------------
// Per-row collision controls
// --------------------------------------------------------------------------

function WorkAreaCollisionControl({
  resolution,
  onSet,
  busy,
  collisionLabel,
}: {
  sourceWorkSpecId: number;
  resolution: WorkAreaResolution | undefined;
  onSet: (r: WorkAreaResolution) => void;
  busy: boolean;
  collisionLabel: string;
}): JSX.Element {
  const t = useT();
  const policy = resolution?.policy ?? "skip";
  return (
    <div className="import-modal__collision">
      <span className="import-modal__collision-badge">
        {t("modal.import.collision.badge")}
      </span>
      <span className="import-modal__collision-msg">
        {t("modal.import.collision.targetAlreadyHas", {
          label: collisionLabel,
        })}
      </span>
      <select
        className="import-modal__select"
        disabled={busy}
        value={policy}
        onChange={(e) => {
          const next = e.currentTarget.value as ImportCollisionPolicy;
          onSet({ ...resolution, policy: next });
        }}
      >
        {/* FIX-ImportMerge 2026-05-11 — "merge" sits first because
            it's the default and matches the most common intent. */}
        <option value="merge">
          {t("modal.import.collision.mergeWorkArea")}
        </option>
        <option value="skip">{t("modal.import.collision.skip")}</option>
        <option value="rename">{t("modal.import.collision.rename")}</option>
        <option value="overwrite">
          {t("modal.import.collision.overwriteWorkArea")}
        </option>
      </select>
      {policy === "rename" && (
        <>
          <input
            type="text"
            className="modal__input import-modal__rename-input"
            placeholder={t("modal.import.collision.newCodePlaceholder")}
            disabled={busy}
            value={resolution?.renamedCode ?? ""}
            onChange={(e) =>
              onSet({
                ...resolution,
                policy: "rename",
                renamedCode: e.currentTarget.value,
              })
            }
          />
          <input
            type="text"
            className="modal__input import-modal__rename-input"
            placeholder={t("modal.import.collision.newNamePlaceholder")}
            disabled={busy}
            value={resolution?.renamedName ?? ""}
            onChange={(e) =>
              onSet({
                ...resolution,
                policy: "rename",
                renamedName: e.currentTarget.value,
              })
            }
          />
        </>
      )}
    </div>
  );
}

function BdbCollisionControl({
  resolution,
  onSet,
  busy,
  collisionName,
}: {
  sourceBdbId: number;
  resolution: BdbResolution | undefined;
  onSet: (r: BdbResolution) => void;
  busy: boolean;
  collisionName: string;
}): JSX.Element {
  const t = useT();
  const policy = resolution?.policy ?? "skip";
  return (
    <div className="import-modal__collision">
      <span className="import-modal__collision-badge">
        {t("modal.import.collision.badge")}
      </span>
      <span className="import-modal__collision-msg">
        {t("modal.import.collision.targetAlreadyHas", { label: collisionName })}
      </span>
      <select
        className="import-modal__select"
        disabled={busy}
        value={policy}
        onChange={(e) => {
          const next = e.currentTarget.value as ImportCollisionPolicy;
          // Overwrite for BDBs not supported by core — prevent it here.
          if (next === "overwrite") return;
          onSet({ ...resolution, policy: next });
        }}
      >
        <option value="skip">{t("modal.import.collision.skip")}</option>
        <option value="rename">{t("modal.import.collision.rename")}</option>
        {/* Overwrite intentionally omitted — core throws. */}
      </select>
      {policy === "rename" && (
        <input
          type="text"
          className="modal__input import-modal__rename-input"
          placeholder={t("modal.import.collision.newNamePlaceholder")}
          disabled={busy}
          value={resolution?.renamedName ?? ""}
          onChange={(e) =>
            onSet({
              ...resolution,
              policy: "rename",
              renamedName: e.currentTarget.value,
            })
          }
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Action row
// --------------------------------------------------------------------------

function ActionRow(props: ImportModalProps): JSX.Element {
  const t = useT();
  const { view } = props;
  const busy = view.busy !== null;

  const showImport = view.collisionIndex !== null;
  return (
    <div className="modal__actions import-modal__actions">
      <button
        type="button"
        className="modal__button"
        onClick={props.onCancel}
        disabled={busy}
      >
        {t("modal.import.cancelButton")}
      </button>
      {!showImport && (
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={props.onCheck}
          disabled={busy || !view.canCheck}
          title={
            view.canCheck
              ? undefined
              : t("modal.import.checkButtonDisabledTitle")
          }
        >
          {view.busy === "checking"
            ? t("modal.import.busy.checking")
            : t("modal.import.checkButton")}
        </button>
      )}
      {showImport && (
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={props.onImport}
          disabled={busy || !view.canImport}
          title={
            view.canImport
              ? undefined
              : t("modal.import.importButtonDisabledTitle")
          }
        >
          {view.busy === "applying"
            ? t("modal.import.busy.applying")
            : t("modal.import.applyButton")}
        </button>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Success view (post-import)
// --------------------------------------------------------------------------

function SuccessView({
  summary,
  onClose,
}: {
  summary: ImportSummary;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const waImported =
    summary.workAreasImported === 1
      ? t("modal.import.success.workAreasOne", {
          count: summary.workAreasImported,
        })
      : t("modal.import.success.workAreasMany", {
          count: summary.workAreasImported,
        });
  const bdbImported =
    summary.bdbsImported === 1
      ? t("modal.import.success.bdbsOne", { count: summary.bdbsImported })
      : t("modal.import.success.bdbsMany", { count: summary.bdbsImported });
  const cpImported =
    summary.controlPlansImported === 1
      ? t("modal.import.success.controlPlansOne", {
          count: summary.controlPlansImported,
        })
      : t("modal.import.success.controlPlansMany", {
          count: summary.controlPlansImported,
        });

  const skippedWa = summary.skippedWorkAreas.length;
  const skippedBdb = summary.skippedBdbs.length;
  const skippedWaText =
    skippedWa === 1
      ? t("modal.import.success.skippedWorkAreasOne", { count: skippedWa })
      : t("modal.import.success.skippedWorkAreasMany", { count: skippedWa });
  const skippedBdbText =
    skippedBdb === 1
      ? t("modal.import.success.skippedBdbsOne", { count: skippedBdb })
      : t("modal.import.success.skippedBdbsMany", { count: skippedBdb });

  return (
    <div className="import-modal__success">
      <p>
        {t("modal.import.success.summaryBefore")}
        <strong>{waImported}</strong>
        {t("modal.import.success.summarySep1")}
        <strong>{bdbImported}</strong>
        {t("modal.import.success.summarySep2")}
        <strong>{cpImported}</strong>
        {t("modal.import.success.summaryAfter")}
      </p>
      {(summary.skippedWorkAreas.length > 0 ||
        summary.skippedBdbs.length > 0) && (
        <p className="modal__muted">
          {t("modal.import.success.skipped", {
            workAreas: skippedWaText,
            bdbs: skippedBdbText,
          })}
        </p>
      )}
      <div className="modal__actions">
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={onClose}
          autoFocus
        >
          {t("modal.import.success.doneButton")}
        </button>
      </div>
    </div>
  );
}
