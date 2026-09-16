/**
 * Contract modals + helper.
 *
 *   - contractLabel        — small helper for "code - name" display
 *   - NewContractModal     — create
 *   - EditContractModal    — rename code / name
 *   - DeleteContractModal  — confirm delete with reassign-or-block
 *
 * Stateless components: dialog state lives in App.tsx; here we just
 * render and report changes.
 */

import type { ContractInfo } from "../../../shared/ipc.js";
import { t, useT } from "../i18n/i18n.js";
import { DialogError } from "./DialogError.js";
import { useEscToClose } from "./useEscToClose.js";

/**
 * Visual separator between code + name in `contractLabel("01", "Foo")`
 * → `"01 - Foo"`. Exported so other call-sites that compose labels
 * from already-effective code/name strings stay in sync.
 */
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
  // Module-level helper — call t() directly (not the hook), since
  // contractLabel is also used outside React component contexts.
  return t("contract.unnamedFallback");
}

export function NewContractModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeCode,
  onChangeName,
}: {
  dialog: {
    code: string;
    name: string;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeCode: (c: string) => void;
  onChangeName: (n: string) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // Require at least one of the two fields populated. The schema allows
  // both null in theory, but an all-blank contract is useless.
  const canSubmit =
    !dialog.saving &&
    (dialog.code.trim().length > 0 || dialog.name.trim().length > 0) &&
    dialog.error?.kind !== "dirty" &&
    dialog.error?.kind !== "missing";
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-contract-title"
    >
      <div className="modal">
        <h2 id="new-contract-title" className="modal__title">
          {t("modal.newContract.title")}
        </h2>
        <p className="modal__body">{t("modal.newContract.body")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.newContract.codeLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.code}
              onChange={(e) => onChangeCode(e.target.value)}
              disabled={dialog.saving}
              placeholder={t("modal.newContract.codePlaceholder")}
              autoFocus
            />
          </label>
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.newContract.nameLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.name}
              onChange={(e) => onChangeName(e.target.value)}
              disabled={dialog.saving}
              placeholder={t("modal.newContract.namePlaceholder")}
            />
          </label>
          <DialogError
            error={dialog.error}
            otherPrefix={t("modal.newContract.errorPrefix")}
          />
          <div className="modal__actions">
            <button
              type="button"
              className="modal__button"
              onClick={onCancel}
              disabled={dialog.saving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={!canSubmit}
            >
              {dialog.saving ? t("common.creating") : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditContractModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeCode,
  onChangeName,
}: {
  dialog: {
    contract: ContractInfo;
    code: string;
    name: string;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeCode: (c: string) => void;
  onChangeName: (n: string) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const canSubmit =
    dialog.code.trim().length > 0 || dialog.name.trim().length > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-contract-title"
    >
      <div className="modal">
        <h2 id="edit-contract-title" className="modal__title">
          {t("modal.editContract.title")}
        </h2>
        <p className="modal__body">{t("modal.editContract.body")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.editContract.codeLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.code}
              onChange={(e) => onChangeCode(e.target.value)}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.editContract.nameLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.name}
              onChange={(e) => onChangeName(e.target.value)}
            />
          </label>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={!canSubmit}
            >
              {t("common.ok")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteContractModal({
  dialog,
  allContracts,
  workSpecs,
  onCancel,
  onConfirm,
  onConfirmReassign,
  onChangeTarget,
}: {
  dialog: {
    contract: ContractInfo;
    stage: "confirm" | "reassign";
    referencedWorkSpecIds: number[];
    targetContractId: number | null;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  allContracts: ContractInfo[];
  workSpecs: {
    id: number;
    workAreaCode: string | null;
    workAreaName: string;
  }[];
  onCancel: () => void;
  onConfirm: () => void;
  onConfirmReassign: () => void;
  onChangeTarget: (id: number | null) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const otherContracts = allContracts.filter(
    (c) => c.id !== dialog.contract.id,
  );
  const referenced = workSpecs.filter((w) =>
    dialog.referencedWorkSpecIds.includes(w.id),
  );
  const label = contractLabel(dialog.contract);
  const refCount = dialog.referencedWorkSpecIds.length;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-contract-title"
    >
      <div className="modal">
        <h2 id="delete-contract-title" className="modal__title">
          {dialog.stage === "confirm"
            ? t("modal.deleteContract.title")
            : t("modal.deleteContract.titleReassign")}
        </h2>

        {dialog.stage === "confirm" ? (
          <p className="modal__body">
            {t("modal.deleteContract.confirmBody", { label })}
          </p>
        ) : (
          <>
            <p className="modal__body">
              {refCount === 1
                ? t("modal.deleteContract.reassignBodyOne", { label })
                : t("modal.deleteContract.reassignBodyMany", {
                    label,
                    count: refCount,
                  })}
            </p>
            <ul className="modal__list">
              {referenced.map((w) => (
                <li key={w.id}>
                  <code>{w.workAreaCode ?? "—"}</code> {w.workAreaName}
                </li>
              ))}
            </ul>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.deleteContract.reassignToLabel")}
              </span>
              <select
                className="modal__input"
                value={
                  dialog.targetContractId === null
                    ? ""
                    : String(dialog.targetContractId)
                }
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeTarget(v === "" ? null : Number(v));
                }}
                disabled={dialog.saving}
              >
                <option value="">
                  {t("modal.deleteContract.noContractOption")}
                </option>
                {otherContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {contractLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <DialogError
          error={dialog.error}
          otherPrefix={t("modal.deleteContract.errorPrefix")}
        />

        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            disabled={dialog.saving}
          >
            {t("common.cancel")}
          </button>
          {dialog.stage === "confirm" ? (
            <button
              type="button"
              className="modal__button modal__button--danger"
              onClick={onConfirm}
              disabled={
                dialog.saving ||
                dialog.error?.kind === "dirty" ||
                dialog.error?.kind === "missing"
              }
              autoFocus
            >
              {t("modal.deleteContract.confirmButton")}
            </button>
          ) : (
            <button
              type="button"
              className="modal__button modal__button--danger"
              onClick={onConfirmReassign}
              disabled={
                dialog.saving ||
                dialog.error?.kind === "dirty" ||
                dialog.error?.kind === "missing"
              }
              autoFocus
            >
              {t("modal.deleteContract.confirmReassignButton")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
