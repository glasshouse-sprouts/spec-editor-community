/**
 * Control-plan modals.
 *
 * Holds the four CP-domain dialog components:
 *   - NewCpModal             — create a new CP (blank or duplicate of another)
 *   - DeleteCpModal          — confirm delete of a control plan
 *   - DeleteRowModal         — confirm delete of one row in a CP table
 *   - EditCpModal            — edit CP metadata (title, number, revision…)
 *
 * Each one is a controlled component: dialog state lives in App.tsx;
 * these just render + report changes through callbacks. No internal
 * I/O, no closure over App-state.
 */

import type {
  BdbInfo,
  ControlPlanInfo,
  ControlPlanRowData,
} from "../../../shared/ipc.js";
import { availableSlots } from "../cpSlots.js";
import { useT } from "../i18n/i18n.js";
import { DialogError } from "./DialogError.js";
import { useEscToClose } from "./useEscToClose.js";

export function NewCpModal({
  dialog,
  allControlPlans,
  onCancel,
  onConfirm,
  onChangeTitle,
  onChangeSlot,
  onChangeMode,
  onChangeSource,
}: {
  dialog: {
    bdb: BdbInfo;
    slot: "design" | "production";
    title: string;
    mode: "blank" | "duplicate";
    sourceCpId: number | null;
    titleTouched: boolean;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  allControlPlans: ControlPlanInfo[];
  onCancel: () => void;
  onConfirm: () => void;
  onChangeTitle: (title: string) => void;
  onChangeSlot: (slot: "design" | "production") => void;
  onChangeMode: (mode: "blank" | "duplicate") => void;
  onChangeSource: (sourceCpId: number | null) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const slots = availableSlots(dialog.bdb);
  // Sorted list for the source-CP picker. Sorted by numberText then
  // title so the list reads predictably; falls back to id for stable
  // ordering.
  const sortedPlans = [...allControlPlans].sort((a, b) => {
    const byNo = a.numberText.localeCompare(b.numberText, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byNo !== 0) return byNo;
    const byTitle = a.title.localeCompare(b.title, undefined, {
      sensitivity: "base",
    });
    if (byTitle !== 0) return byTitle;
    return a.id - b.id;
  });
  const noSourceSelected =
    dialog.mode === "duplicate" && dialog.sourceCpId == null;
  const isDuplicate = dialog.mode === "duplicate";
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-cp-title"
    >
      <div className="modal">
        <h2 id="new-cp-title" className="modal__title">
          {t("modal.newCp.title")}
        </h2>
        <p className="modal__body">
          {t("modal.newCp.body", { bdbName: dialog.bdb.name })}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <fieldset className="modal__fieldset" disabled={dialog.saving}>
            <legend className="modal__field-label">
              {t("modal.newCp.modeLegend")}
            </legend>
            <label className="modal__radio">
              <input
                type="radio"
                name="cp-mode"
                value="blank"
                checked={dialog.mode === "blank"}
                onChange={() => onChangeMode("blank")}
              />
              <span>{t("modal.newCp.modeBlank")}</span>
            </label>
            <label className="modal__radio">
              <input
                type="radio"
                name="cp-mode"
                value="duplicate"
                checked={dialog.mode === "duplicate"}
                onChange={() => onChangeMode("duplicate")}
                disabled={sortedPlans.length === 0}
              />
              <span>
                {t("modal.newCp.modeDuplicate")}
                {sortedPlans.length === 0 && (
                  <em className="modal__muted">
                    {t("modal.newCp.modeDuplicateNone")}
                  </em>
                )}
              </span>
            </label>
          </fieldset>

          <fieldset className="modal__fieldset" disabled={dialog.saving}>
            <legend className="modal__field-label">
              {t("modal.newCp.slotLegend")}
            </legend>
            <label className="modal__radio">
              <input
                type="radio"
                name="cp-slot"
                value="design"
                checked={dialog.slot === "design"}
                onChange={() => onChangeSlot("design")}
                disabled={!slots.design}
              />
              <span>{t("modal.newCp.slotDesign")}</span>
            </label>
            <label className="modal__radio">
              <input
                type="radio"
                name="cp-slot"
                value="production"
                checked={dialog.slot === "production"}
                onChange={() => onChangeSlot("production")}
                disabled={!slots.production}
              />
              <span>{t("modal.newCp.slotProduction")}</span>
            </label>
          </fieldset>

          {isDuplicate && (
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.newCp.sourceLabel")}
              </span>
              <select
                className="modal__input"
                value={dialog.sourceCpId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeSource(v === "" ? null : Number(v));
                }}
                disabled={dialog.saving || sortedPlans.length === 0}
                required
              >
                <option value="">{t("modal.newCp.sourcePlaceholder")}</option>
                {sortedPlans.map((cp) => {
                  const typeLabel =
                    cp.controlPlanType === 0
                      ? t("modal.newCp.slotDesign")
                      : cp.controlPlanType === 1
                        ? t("modal.newCp.slotProduction")
                        : "";
                  const prefix = cp.numberText ? `${cp.numberText} — ` : "";
                  const suffix = typeLabel ? `  (${typeLabel})` : "";
                  return (
                    <option key={cp.id} value={cp.id}>
                      {prefix}
                      {cp.title || t("common.untitled")}
                      {suffix}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.newCp.titleLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.title}
              onChange={(e) => onChangeTitle(e.target.value)}
              autoFocus
              disabled={dialog.saving}
              placeholder={
                isDuplicate
                  ? t("modal.newCp.titlePlaceholderDuplicate")
                  : t("modal.newCp.titlePlaceholderBlank")
              }
              required
            />
          </label>

          <DialogError
            error={dialog.error}
            otherPrefix={
              isDuplicate
                ? t("modal.newCp.errorPrefixDuplicate")
                : t("modal.newCp.errorPrefixCreate")
            }
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
              disabled={
                dialog.saving ||
                dialog.title.trim().length === 0 ||
                noSourceSelected ||
                dialog.error?.kind === "dirty" ||
                dialog.error?.kind === "missing"
              }
            >
              {dialog.saving
                ? isDuplicate
                  ? t("common.duplicating")
                  : t("common.creating")
                : isDuplicate
                  ? t("common.duplicate")
                  : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteCpModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: {
    plan: ControlPlanInfo;
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
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-cp-title"
    >
      <div className="modal">
        <h2 id="delete-cp-title" className="modal__title">
          {t("modal.deleteCp.title")}
        </h2>
        <p className="modal__body">
          {t("modal.deleteCp.body", {
            title: dialog.plan.title || t("common.untitled"),
          })}
        </p>
        <DialogError
          error={dialog.error}
          otherPrefix={t("modal.deleteCp.errorPrefix")}
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
            {dialog.saving ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteRowModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: {
    row: ControlPlanRowData;
    hasContent: boolean;
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
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const label =
    dialog.row.subject.trim() ||
    dialog.row.sectionNo.trim() ||
    `row ${dialog.row.id}`;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-row-title"
    >
      <div className="modal">
        <h2 id="delete-row-title" className="modal__title">
          {t("modal.deleteRow.title")}
        </h2>
        <p className="modal__body">
          {dialog.hasContent
            ? t("modal.deleteRow.bodyWithContent", { label })
            : t("modal.deleteRow.bodyEmpty", { label })}
        </p>
        <DialogError
          error={dialog.error}
          otherPrefix={t("modal.deleteRow.errorPrefix")}
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
            type="button"
            className={`modal__button ${
              dialog.hasContent
                ? "modal__button--danger"
                : "modal__button--primary"
            }`}
            onClick={onConfirm}
            disabled={
              dialog.saving ||
              dialog.error?.kind === "dirty" ||
              dialog.error?.kind === "missing"
            }
            autoFocus
          >
            {dialog.saving ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditCpModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeField,
}: {
  dialog: {
    id: number;
    title: string;
    numberText: string;
    revision: string;
    revisionDate: string;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeField: (
    field: "title" | "numberText" | "revision" | "revisionDate",
    value: string,
  ) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const canSubmit = dialog.title.trim().length > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-cp-title"
    >
      <div className="modal modal--wide">
        <h2 id="edit-cp-title" className="modal__title">
          {t("modal.editCp.title")}
        </h2>
        <p className="modal__body">{t("modal.editCp.body")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm();
          }}
        >
          <div className="meta-modal__grid">
            <label className="modal__field meta-modal__field--wide">
              <span className="modal__field-label">
                {t("modal.editCp.titleLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.title}
                onChange={(e) => onChangeField("title", e.target.value)}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                required
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editCp.numberLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.numberText}
                onChange={(e) => onChangeField("numberText", e.target.value)}
                placeholder={t("modal.editCp.numberPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editCp.revisionDateLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revisionDate}
                onChange={(e) => onChangeField("revisionDate", e.target.value)}
                placeholder={t("modal.editCp.revisionDatePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editCp.revisionLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revision}
                onChange={(e) => onChangeField("revision", e.target.value)}
                placeholder={t("modal.editCp.revisionPlaceholder")}
              />
            </label>
          </div>

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
