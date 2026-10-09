/**
 * Project / work-area / BDB metadata modals — extracted from App.tsx
 * in slice #233.
 *
 *   - EditProjectModal       (project name, project_number, builder, etc.)
 *   - LockedFieldsAccordion  (read-only Molio-sourced columns)
 *   - EditWorkSpecModal      (10 editable + locked accordion)
 *   - EditBdbModal           (9 editable + locked accordion + isPfbb toggle)
 *
 * Stateless components: dialog state lives in App.tsx; here we just
 * render and report changes. EditProjectModal uses the already-
 * extracted CustomDataAccordion for the file-wide custom_data debug
 * surface.
 */

import { useState } from "react";

import { CustomDataAccordion } from "../CustomDataAccordion.js";
import type { EffectiveCustomDataEntry } from "../edits.js";
import { useT } from "../i18n/i18n.js";
import { computePfbbToggleHint } from "../pfbbMigration.js";
import { isUnreadableDate } from "../referencelistDates.js";
import { useEscToClose } from "./useEscToClose.js";

/**
 * Task 155 - the reference-list date (fiksdato) field, used by all
 * three metadata modals.
 *
 * Three things it has to get right:
 *
 *  - **A date picker, not free text.** `<input type="date">` gives
 *    the picker and the `YYYY-MM-DD` shape for free, and the browser
 *    will not let a malformed value out of it.
 *  - **An unreadable stored value must not vanish.** A date input
 *    cannot display "20. november 2024", so a value that is present
 *    but unreadable gets a plain text box plus a warning instead.
 *    Which box is shown is decided ONCE from the value the dialog
 *    opened with, so the input never changes type mid-edit and steal
 *    the user's focus. The project field was free text until this
 *    change, so such values exist in real files.
 *  - **Blank means inherit.** When the field is empty, the value it
 *    will inherit is spelled out underneath.
 *
 * Why the inherited value is a line under the field and not the
 * placeholder the prompt asked for: `<input type="date">` ignores
 * `placeholder` in Chromium - the box shows its own date mask - so a
 * placeholder would never have been read by anyone.
 */
export function ReferencelistDateField({
  label,
  value,
  /** The value this dialog opened with. Decides picker vs text box. */
  original,
  /** What a blank field inherits, already resolved. */
  inherited,
  onChange,
}: {
  label: string;
  value: string;
  original: string | null;
  inherited: { date: string; source: "project" | "workArea" } | null;
  onChange: (v: string) => void;
}): JSX.Element {
  const t = useT();
  const unreadable = isUnreadableDate(original);
  return (
    <label className="modal__field">
      <span className="modal__field-label">{label}</span>
      <input
        type={unreadable ? "text" : "date"}
        className="modal__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {unreadable && (
        <span className="modal__field-warn">
          {t("modal.referencelistDate.unreadable", { value: original ?? "" })}
        </span>
      )}
      {value.trim() === "" && inherited && (
        <span className="modal__field-hint">
          {t("modal.referencelistDate.inherits", {
            date: inherited.date,
            source: t(
              inherited.source === "workArea"
                ? "modal.referencelistDate.fromWorkArea"
                : "modal.referencelistDate.fromProject",
            ),
          })}
        </span>
      )}
      {value.trim() === "" && !inherited && (
        <span className="modal__field-hint">
          {t("modal.referencelistDate.noneAnywhere")}
        </span>
      )}
    </label>
  );
}

export function EditProjectModal({
  dialog,
  customData,
  onSetCustomData,
  onDeleteCustomData,
  onClearCustomDataPending,
  onCancel,
  onConfirm,
  onChangeName,
  onChangeProjectNumber,
  onChangeBuilder,
  onChangeMolioReferencelistDate,
  onWriteDateIntoSpecs,
}: {
  dialog: {
    projectGuid: string;
    name: string;
    projectNumber: string;
    builder: string;
    molioReferencelistDate: string;
    /** Task 155 - the value the dialog opened with, so the field can
     *  tell a readable date from free text left over from before
     *  this field was validated. */
    originalMolioReferencelistDate: string | null;
  };
  /** Slice 10I.b — effective `custom_data` entries (disk rows with
   *  any pending edits folded in). Optional so tests / old callers
   *  don't need to stub it. */
  customData?: readonly EffectiveCustomDataEntry[];
  /** Slice 10I.b — stage an upsert/delete of a custom_data row. */
  onSetCustomData?: (key: string, valueBase64: string) => void;
  onDeleteCustomData?: (key: string) => void;
  onClearCustomDataPending?: (key: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onChangeName: (v: string) => void;
  onChangeProjectNumber: (v: string) => void;
  onChangeBuilder: (v: string) => void;
  onChangeMolioReferencelistDate: (v: string) => void;
  /** Task 184 - confirm the dialog and then offer to write the date
   *  into the "Gældende dato for referencer" section of EVERY
   *  description, also when the date itself did not change. Without
   *  it a file whose date was set before this feature can never be
   *  brought in step. Optional so tests / old callers need not stub it. */
  onWriteDateIntoSpecs?: () => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // Required fields — submit is blocked if either is blank.
  const canSubmit =
    dialog.name.trim().length > 0 && dialog.projectNumber.trim().length > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-project-title"
    >
      <div className="modal modal--wide">
        <h2 id="edit-project-title" className="modal__title">
          {t("modal.editProject.title")}
        </h2>
        <p className="modal__body">
          {t("modal.editProject.bodyBefore")}
          <kbd>⌘S</kbd>
          {t("modal.editProject.bodyAfter")}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.editProject.nameLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.name}
              onChange={(e) => onChangeName(e.target.value)}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              required
            />
          </label>
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.editProject.projectNumberLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.projectNumber}
              onChange={(e) => onChangeProjectNumber(e.target.value)}
              required
            />
          </label>
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.editProject.builderLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.builder}
              onChange={(e) => onChangeBuilder(e.target.value)}
              placeholder={t("modal.editProject.builderPlaceholder")}
            />
          </label>
          <ReferencelistDateField
            label={t("modal.editProject.molioReferencelistDateLabel")}
            value={dialog.molioReferencelistDate}
            original={dialog.originalMolioReferencelistDate}
            // The project is the top level - there is nothing above it
            // to inherit from.
            inherited={null}
            onChange={onChangeMolioReferencelistDate}
          />
          {onWriteDateIntoSpecs && (
            <div className="modal__field">
              <button
                type="button"
                className="modal__button"
                onClick={onWriteDateIntoSpecs}
                disabled={!canSubmit}
              >
                {t("modal.editProject.writeDateIntoSpecs")}
              </button>
              <span className="modal__field-hint">
                {t("modal.editProject.writeDateIntoSpecsHint")}
              </span>
            </div>
          )}
          {customData &&
            onSetCustomData &&
            onDeleteCustomData &&
            onClearCustomDataPending && (
              <CustomDataAccordion
                entries={customData}
                onSet={onSetCustomData}
                onDelete={onDeleteCustomData}
                onClearPending={onClearCustomDataPending}
              />
            )}
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

/**
 * Task 155, rule 5 - the project's reference-list date just changed,
 * and some work areas or BDBs carry a date of their own that differs
 * from the new one.
 *
 * Those rows do NOT follow automatically: a date set on a row is a
 * deliberate choice, and silently overwriting it would change which
 * reference list that part of the project is built on. Rows with a
 * blank date inherit and are never counted here, so the dialog only
 * appears when there is a real decision to make.
 */
export function ReferencelistDateCascadeModal({
  newDate,
  workAreaCount,
  bdbCount,
  onKeepTheirs,
  onUpdateAll,
}: {
  /** The new project date, or null when the field was cleared. */
  newDate: string | null;
  workAreaCount: number;
  bdbCount: number;
  onKeepTheirs: () => void;
  onUpdateAll: () => void;
}): JSX.Element {
  useEscToClose(onKeepTheirs);
  const t = useT();
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="referencelist-cascade-title"
    >
      <div className="modal">
        <h2 id="referencelist-cascade-title" className="modal__title">
          {t("modal.referencelistCascade.title")}
        </h2>
        <p className="modal__body">
          {newDate
            ? t("modal.referencelistCascade.bodyWithDate", { date: newDate })
            : t("modal.referencelistCascade.bodyCleared")}
        </p>
        <p className="modal__body">
          {t("modal.referencelistCascade.counts", {
            workAreas: workAreaCount,
            bdbs: bdbCount,
          })}
        </p>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onKeepTheirs}
            autoFocus
          >
            {t("modal.referencelistCascade.keepTheirs")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onUpdateAll}
          >
            {t("modal.referencelistCascade.updateAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Task 184 - offer to rewrite the "Gældende dato for referencer" line in
 * the descriptions whose applicable date changed (or, from the button in
 * "Redigér projekt", in all of them).
 *
 * "Update" is the pre-selected answer (owner's decision): it has focus,
 * so Enter applies it. Esc and "Leave the text" change nothing.
 * Descriptions that were not touched are named, so the user can fix
 * them by hand.
 */
export function ReferencelistDateTextModal({
  workAreaCount,
  bdbCount,
  ambiguousNames,
  unsafeNames,
  onSkip,
  onUpdate,
}: {
  workAreaCount: number;
  bdbCount: number;
  /** Descriptions with more than one matching section. */
  ambiguousNames: readonly string[];
  /** Descriptions whose date line holds more than the date. */
  unsafeNames: readonly string[];
  onSkip: () => void;
  onUpdate: () => void;
}): JSX.Element {
  useEscToClose(onSkip);
  const t = useT();
  const hasUpdates = workAreaCount + bdbCount > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="referencelist-date-text-title"
    >
      <div className="modal">
        <h2 id="referencelist-date-text-title" className="modal__title">
          {t("modal.referencelistDateText.title")}
        </h2>
        {hasUpdates ? (
          <>
            <p className="modal__body">
              {t("modal.referencelistDateText.body", {
                workAreas: workAreaCount,
                bdbs: bdbCount,
              })}
            </p>
            <p className="modal__body">
              {t("modal.referencelistDateText.detail")}
            </p>
          </>
        ) : (
          <p className="modal__body">
            {t("modal.referencelistDateText.nothing")}
          </p>
        )}
        {ambiguousNames.length > 0 && (
          <p className="modal__body">
            {t("modal.referencelistDateText.ambiguous", {
              names: ambiguousNames.join(", "),
            })}
          </p>
        )}
        {unsafeNames.length > 0 && (
          <p className="modal__body">
            {t("modal.referencelistDateText.unsafe", {
              names: unsafeNames.join(", "),
            })}
          </p>
        )}
        <div className="modal__actions">
          {hasUpdates ? (
            <>
              <button type="button" className="modal__button" onClick={onSkip}>
                {t("modal.referencelistDateText.skip")}
              </button>
              <button
                type="button"
                className="modal__button modal__button--primary"
                onClick={onUpdate}
                autoFocus
              >
                {t("modal.referencelistDateText.update")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="modal__button modal__button--primary"
              onClick={onSkip}
              autoFocus
            >
              {t("common.ok")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LockedFieldsAccordion({
  rows,
}: {
  rows: { label: string; value: string | null }[];
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const populated = rows.filter((r) => r.value != null && r.value !== "");
  const empty = rows.filter((r) => r.value == null || r.value === "");
  const summary =
    empty.length > 0
      ? t("modal.lockedFields.summaryWithEmpty", {
          set: populated.length,
          empty: empty.length,
        })
      : t("modal.lockedFields.summary", { set: populated.length });
  return (
    <div className="meta-modal__locked">
      <button
        type="button"
        className="meta-modal__locked-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="meta-modal__locked-chev">{open ? "▾" : "▸"}</span>
        {open
          ? t("modal.lockedFields.hide", { summary })
          : t("modal.lockedFields.show", { summary })}
      </button>
      {open && (
        <dl className="meta-modal__locked-list">
          {rows.map((r) => (
            <div key={r.label} className="meta-modal__locked-row">
              <dt
                className="meta-modal__locked-label"
                title={t("modal.lockedFields.lockTitle")}
              >
                🔒 {r.label}
              </dt>
              <dd className="meta-modal__locked-value">
                {r.value == null || r.value === "" ? (
                  <span className="meta-modal__locked-empty">—</span>
                ) : (
                  <code>{r.value}</code>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function EditWorkSpecModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeField,
}: {
  dialog: {
    id: number;
    workAreaCode: string;
    workAreaName: string;
    workAreaType: number;
    revision: string;
    revisionDate: string;
    issueDate: string;
    createdBy: string;
    createdByOrganization: string;
    reviewedBy: string;
    approvedBy: string;
    locked: {
      molioSpecRevisionNo: string | null;
      molioSpecRevisionDate: string | null;
      /** MAPI6-F — schema-level reference GUIDs. */
      molioSpecGuid: string | null;
      molioSpecRevisionGuid: string | null;
      paradigmGuid: string | null;
      paradigmRevisionGuid: string | null;
      referencelistArea: string | null;
    };
    /**
     * Task 155 - the work area's own reference-list date (fiksdato),
     * now editable. Moved out of the locked block; the GUID beside it
     * (`locked.referencelistArea`) stays locked, because it is the
     * base revision's own id and not a choice.
     */
    referencelistAreaDate: string;
    originalReferencelistAreaDate: string | null;
    /** What a blank field inherits - the project's date. */
    inheritedReferencelistDate: {
      date: string;
      source: "project" | "workArea";
    } | null;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeField: (
    field:
      | "workAreaCode"
      | "workAreaName"
      | "workAreaType"
      | "revision"
      | "revisionDate"
      | "issueDate"
      | "createdBy"
      | "createdByOrganization"
      | "reviewedBy"
      | "approvedBy"
      | "referencelistAreaDate",
    value: string,
  ) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const canSubmit = dialog.workAreaName.trim().length > 0;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-workspec-title"
    >
      <div className="modal modal--wide">
        <h2 id="edit-workspec-title" className="modal__title">
          {t("modal.editWorkSpec.title")}
        </h2>
        <p className="modal__body">
          {t("modal.editWorkSpec.bodyBefore")}
          <kbd>⌘S</kbd>
          {t("modal.editWorkSpec.bodyAfter")}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm();
          }}
        >
          <div className="meta-modal__grid">
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.codeLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.workAreaCode}
                onChange={(e) => onChangeField("workAreaCode", e.target.value)}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                placeholder={t("modal.editWorkSpec.codePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.nameLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.workAreaName}
                onChange={(e) => onChangeField("workAreaName", e.target.value)}
                required
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.typeLabel")}
              </span>
              <select
                className="modal__input"
                value={String(dialog.workAreaType)}
                onChange={(e) => onChangeField("workAreaType", e.target.value)}
              >
                <option value="0">
                  {t("modal.editWorkSpec.typeArbejdsbeskrivelse")}
                </option>
                <option value="1">
                  {t("modal.editWorkSpec.typeFaellesBeskrivelse")}
                </option>
                <option value="2">
                  {t("modal.editWorkSpec.typeParadigmeForArbejdsbeskrivelse")}
                </option>
              </select>
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.revisionLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revision}
                onChange={(e) => onChangeField("revision", e.target.value)}
                placeholder={t("modal.editWorkSpec.revisionPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.issueDateLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.issueDate}
                onChange={(e) => onChangeField("issueDate", e.target.value)}
                placeholder={t("modal.editWorkSpec.issueDatePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.revisionDateLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revisionDate}
                onChange={(e) => onChangeField("revisionDate", e.target.value)}
                placeholder={t("modal.editWorkSpec.revisionDatePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.createdByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.createdBy}
                onChange={(e) => onChangeField("createdBy", e.target.value)}
                placeholder={t("modal.editWorkSpec.createdByPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.organizationLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.createdByOrganization}
                onChange={(e) =>
                  onChangeField("createdByOrganization", e.target.value)
                }
                placeholder={t("modal.editWorkSpec.organizationPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.reviewedByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.reviewedBy}
                onChange={(e) => onChangeField("reviewedBy", e.target.value)}
                placeholder={t("modal.editWorkSpec.reviewedByPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editWorkSpec.approvedByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.approvedBy}
                onChange={(e) => onChangeField("approvedBy", e.target.value)}
                placeholder={t("modal.editWorkSpec.approvedByPlaceholder")}
              />
            </label>
            <ReferencelistDateField
              label={t("modal.editWorkSpec.referencelistAreaDateLabel")}
              value={dialog.referencelistAreaDate}
              original={dialog.originalReferencelistAreaDate}
              inherited={dialog.inheritedReferencelistDate}
              onChange={(v) => onChangeField("referencelistAreaDate", v)}
            />
          </div>

          <LockedFieldsAccordion
            rows={[
              {
                label: t("modal.editWorkSpec.locked.molioSpecRevisionNo"),
                value: dialog.locked.molioSpecRevisionNo,
              },
              {
                label: t("modal.editWorkSpec.locked.molioSpecRevisionDate"),
                value: dialog.locked.molioSpecRevisionDate,
              },
              {
                label: t("modal.editWorkSpec.locked.molioSpecGuid"),
                value: dialog.locked.molioSpecGuid,
              },
              {
                label: t("modal.editWorkSpec.locked.molioSpecRevisionGuid"),
                value: dialog.locked.molioSpecRevisionGuid,
              },
              {
                label: t("modal.editWorkSpec.locked.paradigmGuid"),
                value: dialog.locked.paradigmGuid,
              },
              {
                label: t("modal.editWorkSpec.locked.paradigmRevisionGuid"),
                value: dialog.locked.paradigmRevisionGuid,
              },
              {
                label: t("modal.editWorkSpec.locked.referencelistArea"),
                value: dialog.locked.referencelistArea,
              },
            ]}
          />

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

export function EditBdbModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeField,
  onToggleIsPfbb,
}: {
  dialog: {
    id: number;
    name: string;
    isPfbb: boolean;
    /** Original `is_pfbb` value (0 or 1) when the dialog opened. */
    originalIsPfbb: number;
    /** Whether the BDB currently lives in the virtual PFBB work_spec. */
    currentWorkSpecIsVirtual: boolean;
    /** Whether this BDB is a PFBB child (subscriber). Slice 10H.9. */
    isPfbbChild: boolean;
    revision: string;
    revisionDate: string;
    issueDate: string;
    createdBy: string;
    createdByOrganization: string;
    reviewedBy: string;
    approvedBy: string;
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
      /** MAPI6-F — schema-level reference GUIDs. */
      molioSpecGuid: string | null;
      molioSpecRevisionGuid: string | null;
      referencelistArea: string | null;
    };
    /** Task 155 - the BDB's own reference-list date, now editable.
     *  The GUID beside it stays locked. */
    referencelistAreaDate: string;
    originalReferencelistAreaDate: string | null;
    /** What a blank field inherits: the work area's date if it has
     *  one, otherwise the project's. */
    inheritedReferencelistDate: {
      date: string;
      source: "project" | "workArea";
    } | null;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeField: (
    field:
      | "name"
      | "revision"
      | "revisionDate"
      | "issueDate"
      | "createdBy"
      | "createdByOrganization"
      | "reviewedBy"
      | "approvedBy"
      | "referencelistAreaDate",
    value: string,
  ) => void;
  onToggleIsPfbb: (next: boolean) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // Slice 10H.6c — auto-move info / refuse hint. See
  // computePfbbToggleHint for the decision table; this component
  // just renders the result.
  const pfbbHint = computePfbbToggleHint({
    originalIsPfbb: dialog.originalIsPfbb,
    isPfbb: dialog.isPfbb,
    currentWorkSpecIsVirtual: dialog.currentWorkSpecIsVirtual,
  });
  const willMoveIn = pfbbHint.kind === "info";
  const blockedOff = pfbbHint.kind === "block";
  const canSubmit = dialog.name.trim().length > 0 && !blockedOff;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-bdb-title"
    >
      <div className="modal modal--wide">
        <h2 id="edit-bdb-title" className="modal__title">
          {t("modal.editBdb.title")}
        </h2>
        <p className="modal__body">
          {t("modal.editBdb.bodyBefore")}
          <kbd>⌘S</kbd>
          {t("modal.editBdb.bodyAfter")}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm();
          }}
        >
          <div className="meta-modal__grid">
            <label className="modal__field meta-modal__field--wide">
              <span className="modal__field-label">
                {t("modal.editBdb.nameLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.name}
                onChange={(e) => onChangeField("name", e.target.value)}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                required
              />
            </label>
            <label
              className="modal__field meta-modal__field--wide meta-modal__checkbox-field"
              title={
                dialog.isPfbbChild
                  ? t("modal.editBdb.isPfbbChildTitle")
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={dialog.isPfbb}
                onChange={(e) => onToggleIsPfbb(e.target.checked)}
                disabled={dialog.isPfbbChild}
                data-testid="edit-bdb-ispfbb-checkbox"
              />
              <span>
                {t("modal.editBdb.isPfbbLabelBefore")}
                <strong>{t("modal.editBdb.isPfbbLabelStrong")}</strong>
                {t("modal.editBdb.isPfbbLabelAfter")}
              </span>
            </label>
            {dialog.isPfbbChild ? (
              <div
                className="modal__field meta-modal__field--wide meta-modal__hint-line"
                data-testid="edit-bdb-pfbb-child-hint"
              >
                {t("modal.editBdb.pfbbChildHintBefore")}
                <strong>{t("modal.editBdb.pfbbChildHintStrong")}</strong>
                {t("modal.editBdb.pfbbChildHintAfter")}
              </div>
            ) : null}
            {willMoveIn ? (
              <div
                className="modal__field meta-modal__field--wide meta-modal__info-line"
                data-testid="edit-bdb-pfbb-move-info"
              >
                {t("modal.editBdb.pfbbMoveInfoBefore")}
                <em>{t("modal.editBdb.pfbbWorkAreaName")}</em>
                {t("modal.editBdb.pfbbMoveInfoAfter")}
              </div>
            ) : null}
            {blockedOff ? (
              <div
                className="modal__field meta-modal__field--wide meta-modal__error-line"
                role="alert"
                data-testid="edit-bdb-pfbb-block"
              >
                {t("modal.editBdb.pfbbBlockBefore")}
                <em>{t("modal.editBdb.pfbbWorkAreaName")}</em>
                {t("modal.editBdb.pfbbBlockAfter")}
              </div>
            ) : null}
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.issueDateLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.issueDate}
                onChange={(e) => onChangeField("issueDate", e.target.value)}
                placeholder={t("modal.editBdb.issueDatePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.revisionDateLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revisionDate}
                onChange={(e) => onChangeField("revisionDate", e.target.value)}
                placeholder={t("modal.editBdb.revisionDatePlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.revisionLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.revision}
                onChange={(e) => onChangeField("revision", e.target.value)}
                placeholder={t("modal.editBdb.revisionPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.createdByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.createdBy}
                onChange={(e) => onChangeField("createdBy", e.target.value)}
                placeholder={t("modal.editBdb.createdByPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.organizationLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.createdByOrganization}
                onChange={(e) =>
                  onChangeField("createdByOrganization", e.target.value)
                }
                placeholder={t("modal.editBdb.organizationPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.reviewedByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.reviewedBy}
                onChange={(e) => onChangeField("reviewedBy", e.target.value)}
                placeholder={t("modal.editBdb.reviewedByPlaceholder")}
              />
            </label>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("modal.editBdb.approvedByLabel")}
              </span>
              <input
                type="text"
                className="modal__input"
                value={dialog.approvedBy}
                onChange={(e) => onChangeField("approvedBy", e.target.value)}
                placeholder={t("modal.editBdb.approvedByPlaceholder")}
              />
            </label>
            <ReferencelistDateField
              label={t("modal.editBdb.referencelistAreaDateLabel")}
              value={dialog.referencelistAreaDate}
              original={dialog.originalReferencelistAreaDate}
              inherited={dialog.inheritedReferencelistDate}
              onChange={(v) => onChangeField("referencelistAreaDate", v)}
            />
          </div>

          <LockedFieldsAccordion
            rows={[
              {
                label: t("modal.editBdb.locked.controlplanDesignId"),
                value: dialog.locked.controlplanDesignId,
              },
              {
                label: t("modal.editBdb.locked.controlplanProductionId"),
                value: dialog.locked.controlplanProductionId,
              },
              {
                label: t("modal.editBdb.locked.commonControlplanDesignGuid"),
                value: dialog.locked.commonControlplanDesignGuid,
              },
              {
                label: t(
                  "modal.editBdb.locked.commonControlplanProductionGuid",
                ),
                value: dialog.locked.commonControlplanProductionGuid,
              },
              {
                label: t("modal.editBdb.locked.molioSpecRevisionNo"),
                value: dialog.locked.molioSpecRevisionNo,
              },
              {
                label: t("modal.editBdb.locked.molioSpecRevisionDate"),
                value: dialog.locked.molioSpecRevisionDate,
              },
              {
                label: t("modal.editBdb.locked.molioSpecGuid"),
                value: dialog.locked.molioSpecGuid,
              },
              {
                label: t("modal.editBdb.locked.molioSpecRevisionGuid"),
                value: dialog.locked.molioSpecRevisionGuid,
              },
              {
                label: t("modal.editBdb.locked.referencelistArea"),
                value: dialog.locked.referencelistArea,
              },
              {
                label: t(
                  "modal.editBdb.locked.molioConstructionElementSpecGuid",
                ),
                value: dialog.locked.molioConstructionElementSpecGuid,
              },
              {
                label: t(
                  "modal.editBdb.locked.molioConstructionElementSpecRevisionGuid",
                ),
                value: dialog.locked.molioConstructionElementSpecRevisionGuid,
              },
              {
                label: t(
                  "modal.editBdb.locked.molioConstructionElementSpecRevisionNo",
                ),
                value: dialog.locked.molioConstructionElementSpecRevisionNo,
              },
              {
                label: t(
                  "modal.editBdb.locked.molioConstructionElementSpecRevisionDate",
                ),
                value: dialog.locked.molioConstructionElementSpecRevisionDate,
              },
            ]}
          />

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
