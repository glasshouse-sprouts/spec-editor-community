/**
 * Structural / move modals — extracted from App.tsx in slice #233.
 *
 *   - DeleteTargetModal     — confirm delete of a work area / BDB
 *   - MoveWorkSpecModal     — reassign work area to a different contract
 *   - MoveControlPlanModal  — move a CP under a different BDB
 *
 * Stateless components — dialog state lives in App.tsx.
 */

import { useMemo } from "react";

import type {
  BdbInfo,
  ContractInfo,
  DeleteImpact,
  WorkSpecInfo,
} from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
import { compareCodeThenName, danishCollator } from "../sortHelpers.js";
import { contractLabel } from "./contractModals.js";
import { DialogError } from "./DialogError.js";
import { useEscToClose } from "./useEscToClose.js";

export function DeleteTargetModal({
  kind,
  label,
  impact,
  saving,
  error,
  pfbbChildCount = 0,
  deleteControlPlans,
  onToggleDeleteControlPlans,
  onCancel,
  onConfirm,
}: {
  kind: "workArea" | "bdb";
  label: string;
  impact: DeleteImpact | null;
  saving: boolean;
  error:
    | { kind: "dirty" }
    | { kind: "conflict" }
    | { kind: "missing" }
    | { kind: "other"; message: string }
    | null;
  /**
   * Slice 10H.8 — only meaningful when `kind === "bdb"`. When > 0 this
   * is a PFBB master with live children; the confirm button is
   * disabled and a block reason replaces the cascade details. Caller
   * computes the count from the current payload + edit buffer.
   */
  pfbbChildCount?: number;
  /**
   * FIX-DelBdbCps 2026-05-11. Only meaningful when `kind === "bdb"`.
   * When true (the default), attached control plans are hard-deleted
   * together with the BDB on save. When false the CPs are left as
   * unlinked plans (the historical behavior).
   */
  deleteControlPlans?: boolean;
  onToggleDeleteControlPlans?: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const blockedByPfbbChildren = kind === "bdb" && pfbbChildCount > 0;
  const titleId = "delete-target-title";
  const heading =
    kind === "workArea"
      ? t("modal.deleteTarget.titleWorkArea")
      : t("modal.deleteTarget.titleBdb");

  // Render the cascade details as prose once the pre-flight returns.
  const details = ((): JSX.Element => {
    if (!impact) {
      return (
        <span className="modal__muted">{t("modal.deleteTarget.checking")}</span>
      );
    }
    if (impact.isEmpty) {
      return (
        <>
          {kind === "workArea"
            ? t("modal.deleteTarget.emptyWorkArea")
            : t("modal.deleteTarget.emptyBdb")}
        </>
      );
    }
    const parts: string[] = [];
    if (kind === "workArea" && impact.bdbs > 0) {
      parts.push(
        impact.bdbs === 1
          ? t("modal.deleteTarget.impact.bdbsOne")
          : t("modal.deleteTarget.impact.bdbsMany", { count: impact.bdbs }),
      );
    }
    if (impact.sections > 0) {
      parts.push(
        impact.sections === 1
          ? t("modal.deleteTarget.impact.sectionsOne")
          : t("modal.deleteTarget.impact.sectionsMany", {
              count: impact.sections,
            }),
      );
    }
    const cascadeCopy =
      parts.length === 0
        ? t("modal.deleteTarget.impact.nothingElse")
        : parts.length === 1
          ? parts[0]!
          : parts.length === 2
            ? t("modal.deleteTarget.impact.joinTwo", {
                a: parts[0]!,
                b: parts[1]!,
              })
            : t("modal.deleteTarget.impact.joinMany", {
                head: parts.slice(0, -1).join(", "),
                tail: parts[parts.length - 1]!,
              });

    return (
      <>
        {t("modal.deleteTarget.cascadePrefix")} <strong>{cascadeCopy}</strong>
        {t("modal.deleteTarget.cascadeSuffix")}
        {impact.attachmentsOrphaned > 0 && (
          <>
            {" "}
            {impact.attachmentsOrphaned === 1
              ? t("modal.deleteTarget.impact.attachmentsOne")
              : t("modal.deleteTarget.impact.attachmentsMany", {
                  count: impact.attachmentsOrphaned,
                })}{" "}
            {kind === "workArea"
              ? t("modal.deleteTarget.impact.attachmentsParenWorkArea")
              : t("modal.deleteTarget.impact.attachmentsParenBdb")}
          </>
        )}
        {impact.controlPlansUnlinked > 0 && (
          <>
            {" "}
            {impact.controlPlansUnlinked === 1
              ? t("modal.deleteTarget.impact.controlPlansOne")
              : t("modal.deleteTarget.impact.controlPlansMany", {
                  count: impact.controlPlansUnlinked,
                })}{" "}
            {t("modal.deleteTarget.impact.controlPlansParen")}
          </>
        )}
      </>
    );
  })();

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="modal">
        <h2 id={titleId} className="modal__title">
          {heading}
        </h2>
        {blockedByPfbbChildren ? (
          <>
            <p className="modal__body">
              <strong>{label}</strong>{" "}
              {t("modal.deleteTarget.pfbbBlockedPrefix")}{" "}
              <strong>
                {pfbbChildCount === 1
                  ? t("modal.deleteTarget.pfbbChildrenOne")
                  : t("modal.deleteTarget.pfbbChildrenMany", {
                      count: pfbbChildCount,
                    })}
              </strong>{" "}
              {t("modal.deleteTarget.pfbbBlockedSuffix")}
            </p>
            <div
              className="modal__body modal__error"
              role="alert"
              data-testid="delete-bdb-blocked-pfbb"
            >
              {t("modal.deleteTarget.pfbbBlockedHint")}
            </div>
          </>
        ) : (
          <>
            <p className="modal__body">
              {t("modal.deleteTarget.markPrefix")} <strong>{label}</strong>
              {t("modal.deleteTarget.markSuffix")} {details}
            </p>
            <p className="modal__body modal__muted">
              {t("modal.deleteTarget.deferredPrefix")}{" "}
              <em>{t("modal.deleteTarget.restoreWord")}</em>{" "}
              {t("modal.deleteTarget.deferredSuffix")}
            </p>
            {/* FIX-DelBdbCps 2026-05-11 — only relevant for BDB delete
                with at least one attached CP. Default ON. */}
            {kind === "bdb" &&
              impact !== null &&
              impact.controlPlansUnlinked > 0 &&
              onToggleDeleteControlPlans && (
                <label
                  className="modal__field modal__field--checkbox"
                  data-testid="delete-bdb-delete-cps"
                >
                  <input
                    type="checkbox"
                    checked={deleteControlPlans ?? true}
                    onChange={(e) =>
                      onToggleDeleteControlPlans(e.target.checked)
                    }
                  />
                  <span>
                    {t("modal.deleteTarget.deleteCps.label", {
                      count: impact.controlPlansUnlinked,
                    })}
                  </span>
                </label>
              )}
          </>
        )}
        <DialogError
          error={error}
          otherPrefix={t("modal.deleteTarget.errorPrefix")}
        />
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            disabled={saving}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--danger"
            onClick={onConfirm}
            disabled={
              saving ||
              impact === null ||
              error?.kind === "missing" ||
              blockedByPfbbChildren
            }
            autoFocus
          >
            {t("modal.deleteTarget.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MoveWorkSpecModal({
  dialog,
  allContracts,
  onCancel,
  onConfirm,
  onChangeFilter,
  onChangeTarget,
}: {
  dialog: {
    workSpecId: number;
    workSpecLabel: string;
    originalContractId: number | null;
    filter: string;
    targetContractId: number | null;
  };
  allContracts: ContractInfo[];
  onCancel: () => void;
  onConfirm: () => void;
  onChangeFilter: (f: string) => void;
  onChangeTarget: (id: number | null) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // Sort by contract code ascending (natural, Danish collation — see
  // Slice 10B). Contracts with no code sink to the bottom; on tie we
  // fall back to name. Sort happens before filtering so the visible
  // order is stable regardless of what the user types.
  const sorted = useMemo(() => {
    return [...allContracts].sort((a, b) =>
      compareCodeThenName(
        a.contractCode,
        a.contractName,
        b.contractCode,
        b.contractName,
      ),
    );
  }, [allContracts]);

  const q = dialog.filter.trim().toLowerCase();
  const filtered =
    q.length === 0
      ? sorted
      : sorted.filter((c) => contractLabel(c).toLowerCase().includes(q));

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-workspec-title"
    >
      <div className="modal">
        <h2 id="move-workspec-title" className="modal__title">
          {t("modal.moveWorkSpec.title")}
        </h2>
        <p className="modal__body">
          {t("modal.moveWorkSpec.bodyPrefix")}{" "}
          <strong>{dialog.workSpecLabel}</strong>
          {t("modal.moveWorkSpec.bodySuffix")} <kbd>⌘S</kbd>{" "}
          {t("modal.moveWorkSpec.bodyAfterShortcut")}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.moveWorkSpec.filterLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.filter}
              onChange={(e) => onChangeFilter(e.target.value)}
              autoFocus
              placeholder={t("modal.moveWorkSpec.filterPlaceholder")}
            />
          </label>
          <div className="modal__picker-list" role="listbox">
            <label className="modal__picker-row">
              <input
                type="radio"
                name="move-ws-target"
                checked={dialog.targetContractId === null}
                onChange={() => onChangeTarget(null)}
              />
              <span>{t("modal.moveWorkSpec.noContractOption")}</span>
            </label>
            {filtered.map((c) => (
              <label key={c.id} className="modal__picker-row">
                <input
                  type="radio"
                  name="move-ws-target"
                  checked={dialog.targetContractId === c.id}
                  onChange={() => onChangeTarget(c.id)}
                />
                <span>{contractLabel(c)}</span>
              </label>
            ))}
            {filtered.length === 0 && q.length > 0 && (
              <div className="modal__picker-empty">
                {t("modal.moveWorkSpec.noMatches", { query: dialog.filter })}
              </div>
            )}
          </div>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
            >
              {t("common.ok")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MoveControlPlanModal({
  dialog,
  allBdbs,
  allWorkSpecs,
  allContracts,
  onCancel,
  onConfirm,
  onChangeFilter,
  onChangeTarget,
}: {
  dialog: {
    controlPlanId: number;
    controlPlanLabel: string;
    cpType: 0 | 1;
    originalBdbId: number | null;
    targetBdbId: number | null;
    filter: string;
    saving: boolean;
    // Inline the CpOpDialogError shape so this component stays at module
    // scope (CpOpDialogError is declared inside the App function).
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
    slotOccupiedMessage: string | null;
  };
  allBdbs: BdbInfo[];
  allWorkSpecs: WorkSpecInfo[];
  allContracts: ContractInfo[];
  onCancel: () => void;
  onConfirm: () => void;
  onChangeFilter: (f: string) => void;
  onChangeTarget: (id: number | null) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // The slot we'll try to fill — 0 maps to design, 1 to production.
  const slotCol: "design" | "production" =
    dialog.cpType === 0 ? "design" : "production";
  const slotLabel =
    slotCol === "design"
      ? t("modal.moveControlPlan.slotDesign")
      : t("modal.moveControlPlan.slotProduction");

  // Figure out which BDBs would be rejected by core before the user clicks
  // OK — any BDB whose matching slot is filled by a *different* CP. The
  // CP itself is always valid (no-op self-move).
  const disabledReason = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of allBdbs) {
      const slotIds = b.controlPlanIds;
      // We don't have exact slot→id mapping here, but controlPlanIds is
      // packed [design, production]. A CP can only occupy its matching
      // slot; if any slot id on this BDB is a *different* CP of the same
      // type, we'd conflict. Safer rule: if the BDB's controlPlanIds
      // includes a CP of the same type as ours (and that CP isn't us),
      // treat it as filled. In practice this is a lightweight check —
      // core is still the authority and will return `slot-occupied` if
      // it actually conflicts.
      for (const id of slotIds) {
        if (id !== dialog.controlPlanId) {
          // We don't have the other CP's type on hand without plumbing
          // more data; keep the check simple and rely on server-side
          // rejection as the fallback. Mark "likely full" only when the
          // BDB already has the max number of CPs for its slot shape.
        }
      }
      // Simpler heuristic: if the BDB has 2 CPs, both slots are full —
      // we'd always conflict unless one of them is us. If the BDB has 1
      // CP that's not us, we might still fit (if it's the other slot).
      if (slotIds.length >= 2 && !slotIds.includes(dialog.controlPlanId)) {
        m.set(b.id, t("modal.moveControlPlan.bothSlotsFilled"));
      }
    }
    return m;
  }, [allBdbs, dialog.controlPlanId, t]);

  // Sort helper — Danish natural-order collator shared with the rest
  // of the app (Slice 10B). Kept as a local alias so the rest of the
  // `grouped` useMemo reads the same as it did before.
  const collator = danishCollator;

  const q = dialog.filter.trim().toLowerCase();

  // Build grouped view: Map<contractId | "no-contract", Map<wsId | "no-ws",
  // BdbInfo[]>>. We filter at all three levels: a contract matches if its
  // label contains q, a work area matches if its label does, a BDB matches
  // if its name does. Parent matches show all children; a child-only match
  // shows just that child under its parent.
  const grouped = useMemo(() => {
    const wsById = new Map<number, WorkSpecInfo>(
      allWorkSpecs.map((w) => [w.id, w]),
    );
    const cById = new Map<number, ContractInfo>(
      allContracts.map((c) => [c.id, c]),
    );
    type Group = {
      contractKey: string;
      contractLabel: string;
      workAreas: {
        wsKey: string;
        wsLabel: string;
        bdbs: BdbInfo[];
      }[];
    };
    const groups = new Map<string, Group>();

    for (const b of allBdbs) {
      const ws = b.workSpecId != null ? wsById.get(b.workSpecId) : undefined;
      const contractId = ws?.contractId ?? null;
      const c = contractId != null ? cById.get(contractId) : undefined;

      const cKey = c ? `c:${c.id}` : "c:none";
      const cLabel = c
        ? contractLabel(c)
        : t("modal.moveControlPlan.noContract");
      const wsKey = ws ? `w:${ws.id}` : "w:none";
      const wsLabel = ws
        ? ws.workAreaCode
          ? `${ws.workAreaCode} — ${ws.workAreaName}`
          : ws.workAreaName
        : t("modal.moveControlPlan.noWorkArea");

      if (!groups.has(cKey)) {
        groups.set(cKey, {
          contractKey: cKey,
          contractLabel: cLabel,
          workAreas: [],
        });
      }
      const g = groups.get(cKey)!;
      let wsEntry = g.workAreas.find((w) => w.wsKey === wsKey);
      if (!wsEntry) {
        wsEntry = { wsKey, wsLabel, bdbs: [] };
        g.workAreas.push(wsEntry);
      }
      wsEntry.bdbs.push(b);
    }

    // Apply filter.
    if (q.length > 0) {
      for (const g of Array.from(groups.values())) {
        const contractHit = g.contractLabel.toLowerCase().includes(q);
        if (contractHit) continue; // keep everything under it
        g.workAreas = g.workAreas
          .map((w) => {
            const wsHit = w.wsLabel.toLowerCase().includes(q);
            if (wsHit) return w;
            const filtered = w.bdbs.filter((b) =>
              b.name.toLowerCase().includes(q),
            );
            return filtered.length > 0 ? { ...w, bdbs: filtered } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (g.workAreas.length === 0) groups.delete(g.contractKey);
      }
    }

    // Sort everything.
    const arr = Array.from(groups.values());
    arr.sort((a, b) => collator.compare(a.contractLabel, b.contractLabel));
    for (const g of arr) {
      g.workAreas.sort((a, b) => collator.compare(a.wsLabel, b.wsLabel));
      for (const w of g.workAreas) {
        w.bdbs.sort((a, b) => collator.compare(a.name, b.name));
      }
    }
    return arr;
  }, [allBdbs, allWorkSpecs, allContracts, q, collator, t]);

  // Cover the common "user hits Enter on an empty pick" case: disable OK
  // if nothing is selected, the CP is still at its current BDB, or the
  // dialog is in an error/saving state that blocks submission.
  const okDisabled =
    dialog.saving ||
    dialog.error?.kind === "dirty" ||
    dialog.error?.kind === "missing" ||
    dialog.targetBdbId == null ||
    dialog.targetBdbId === dialog.originalBdbId;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-cp-title"
    >
      <div className="modal">
        <h2 id="move-cp-title" className="modal__title">
          {t("modal.moveControlPlan.title")}
        </h2>
        <p className="modal__body">
          {t("modal.moveControlPlan.bodyPrefix")}{" "}
          <strong>{dialog.controlPlanLabel}</strong>
          {t("modal.moveControlPlan.bodyMiddle")} <strong>{slotLabel}</strong>
          {t("modal.moveControlPlan.bodySuffix")}
        </p>
        {dialog.error?.kind === "dirty" && (
          <p className="modal__error">
            {t("modal.moveControlPlan.errorDirty")}
          </p>
        )}
        {dialog.error?.kind === "conflict" && (
          <p className="modal__error">
            {t("modal.moveControlPlan.errorConflict")}
          </p>
        )}
        {dialog.error?.kind === "missing" && (
          <p className="modal__error">
            {t("modal.moveControlPlan.errorMissing")}
          </p>
        )}
        {dialog.error?.kind === "other" && (
          <p className="modal__error">{dialog.error.message}</p>
        )}
        {dialog.slotOccupiedMessage && (
          <p className="modal__error">{dialog.slotOccupiedMessage}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!okDisabled) onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.moveControlPlan.filterLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.filter}
              onChange={(e) => onChangeFilter(e.target.value)}
              autoFocus
              placeholder={t("modal.moveControlPlan.filterPlaceholder")}
            />
          </label>
          <div className="modal__picker-list" role="listbox">
            {grouped.length === 0 && q.length > 0 && (
              <div className="modal__picker-empty">
                {t("modal.moveControlPlan.noMatches", {
                  query: dialog.filter,
                })}
              </div>
            )}
            {grouped.map((g) => (
              <div key={g.contractKey} className="modal__picker-group">
                <div className="modal__picker-group-header">
                  {g.contractLabel}
                </div>
                {g.workAreas.map((w) => (
                  <div key={w.wsKey} className="modal__picker-subgroup">
                    <div className="modal__picker-subgroup-header">
                      {w.wsLabel}
                    </div>
                    {w.bdbs.map((b) => {
                      const disabled = disabledReason.has(b.id);
                      const isCurrent = b.id === dialog.originalBdbId;
                      return (
                        <label
                          key={b.id}
                          className={
                            "modal__picker-row" +
                            (disabled ? " modal__picker-row--disabled" : "")
                          }
                        >
                          <input
                            type="radio"
                            name="move-cp-target"
                            checked={dialog.targetBdbId === b.id}
                            disabled={disabled}
                            onChange={() => onChangeTarget(b.id)}
                          />
                          <span>
                            {b.name}
                            {isCurrent && (
                              <span className="modal__picker-tag">
                                {t("modal.moveControlPlan.currentTag")}
                              </span>
                            )}
                            {disabled && (
                              <span className="modal__picker-tag">
                                {disabledReason.get(b.id)}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={okDisabled}
            >
              {dialog.saving
                ? t("modal.moveControlPlan.moving")
                : t("modal.moveControlPlan.move")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
