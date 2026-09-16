/**
 * CustomDataAccordion — slice 10I / 10I.b / #71.
 *
 * Read/write debug surface for the Molio schema's file-wide
 * `custom_data` table. Most files don't use the table; when they do
 * it's usually a third-party tool (another Molio-compatible editor,
 * a plugin, a sidecar) stashing its own serialised state.
 *
 * Slice 10I.b adds editing:
 *   - per-row Edit pen → inline textarea for the value; Save writes
 *     through a staged `customDataSet` patch; Cancel drops the patch.
 *   - per-row Delete trash → staged `customDataDelete` patch with a
 *     two-click confirm.
 *   - bottom of list "Add entry…" button → key + value form.
 *   - dot-namespaced keys (heuristic for third-party state) show a
 *     one-line "this may break the tool that wrote it" warning on
 *     destructive actions.
 *   - binary-detected values are view-only inline; editing shows a
 *     one-line warning that saving will replace the bytes with text.
 *
 * Values cross IPC as base64 (column is BLOB). We probe UTF-8 on
 * display — printable text shows inline as `<code>`; anything with
 * a null byte or control char below 0x20 (other than tab/LF/CR) is
 * treated as binary and shown as "(binary, N bytes)".
 */

import { Pencil as PencilIcon, Trash2 as TrashIcon } from "lucide-react";
import { useState } from "react";

import type { EffectiveCustomDataEntry } from "./edits.js";
import { useT } from "./i18n/i18n.js";

interface Props {
  entries: readonly EffectiveCustomDataEntry[];
  /** Stage an upsert of a row. Caller routes to the edit buffer. */
  onSet: (key: string, valueBase64: string) => void;
  /** Stage a delete of a row. `key` must refer to a disk-present
   *  entry OR a pending create; caller decides. */
  onDelete: (key: string) => void;
  /** Called when the user cancels an in-flight edit on a
   *  disk-persisted row — drops the pending patch so the row
   *  falls back to its disk state. */
  onClearPending: (key: string) => void;
}

export function CustomDataAccordion({
  entries,
  onSet,
  onDelete,
  onClearPending,
}: Props): JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // The accordion renders even when entries is empty — slice 10I.b
  // adds the "Add entry" affordance, so we need a surface to click
  // even on a fresh file. Slice 10I's "hide when empty" rule is
  // gone; the Debug chevron is the permanent entry point.
  const count = entries.length;
  const toggleKey = open
    ? count === 1
      ? "customData.toggle.hideOne"
      : "customData.toggle.hideMany"
    : count === 1
      ? "customData.toggle.showOne"
      : "customData.toggle.showMany";
  return (
    <div className="meta-modal__locked" data-testid="custom-data-accordion">
      <button
        type="button"
        className="meta-modal__locked-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="custom-data-accordion-toggle"
      >
        <span className="meta-modal__locked-chev">{open ? "▾" : "▸"}</span>
        {t(toggleKey, { count })}
      </button>
      {open && (
        <>
          <dl className="meta-modal__locked-list">
            {entries.map((e) => (
              <EntryRow
                key={e.key}
                entry={e}
                onSet={onSet}
                onDelete={onDelete}
                onClearPending={onClearPending}
              />
            ))}
            {entries.length === 0 && !adding && (
              <div className="custom-data__empty">
                {t("customData.emptyBefore")}
                <em>{t("customData.emptyAddEntry")}</em>
                {t("customData.emptyAfter")}
              </div>
            )}
          </dl>
          {adding ? (
            <AddEntryForm
              existingKeys={new Set(entries.map((e) => e.key))}
              onCancel={() => setAdding(false)}
              onAdd={(key, valueBase64) => {
                onSet(key, valueBase64);
                setAdding(false);
              }}
            />
          ) : (
            <div className="custom-data__add-row">
              <button
                type="button"
                className="custom-data__btn"
                onClick={() => setAdding(true)}
                data-testid="custom-data-add-button"
              >
                {t("customData.addEntryButton")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -------- One row --------------------------------------------------

function EntryRow({
  entry,
  onSet,
  onDelete,
  onClearPending,
}: {
  entry: EffectiveCustomDataEntry;
  onSet: (key: string, valueBase64: string) => void;
  onDelete: (key: string) => void;
  onClearPending: (key: string) => void;
}): JSX.Element {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isThirdParty = looksThirdParty(entry.key);
  const decoded = tryDecodeUtf8(entry.valueBase64);
  const isBinary = decoded === null && entry.byteLength > 0;

  return (
    <div
      className={`custom-data__row${
        editing ? " custom-data__row--editing" : ""
      }`}
      data-testid={`custom-data-row-${entry.key}`}
    >
      <dt className="custom-data__label">
        🧩 {entry.key}
        {entry.pendingKind === "set" ? (
          <span
            className="custom-data__dirty"
            title={t("customData.dirtyTitle")}
          >
            {" "}
            ●
          </span>
        ) : null}
      </dt>
      <dd className="custom-data__value">
        {editing ? (
          <EditValueForm
            initialValueBase64={entry.valueBase64}
            initialText={decoded}
            isBinary={isBinary}
            isThirdParty={isThirdParty}
            onCancel={() => {
              if (entry.pendingKind === "set") onClearPending(entry.key);
              setEditing(false);
            }}
            onSave={(valueBase64) => {
              onSet(entry.key, valueBase64);
              setEditing(false);
            }}
          />
        ) : entry.byteLength === 0 ? (
          <span className="meta-modal__locked-empty">
            {t("customData.valueEmpty")}
          </span>
        ) : decoded != null ? (
          <code className="custom-data__text">
            {decoded.length > 240 ? decoded.slice(0, 240) + "…" : decoded}
          </code>
        ) : (
          <span className="custom-data__binary">
            <em>
              {t("customData.valueBinary", {
                size: formatBytes(entry.byteLength),
              })}
            </em>
          </span>
        )}
      </dd>
      {!editing && (
        <div className="custom-data__actions">
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="custom-data__btn"
                onClick={() => setConfirmDelete(false)}
                title={t("customData.cancelDeleteTitle")}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="custom-data__btn custom-data__btn--danger"
                onClick={() => {
                  onDelete(entry.key);
                  setConfirmDelete(false);
                }}
                data-testid={`custom-data-confirm-delete-${entry.key}`}
                title={t("customData.confirmDeleteTitle")}
              >
                {t("customData.confirmDelete")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="custom-data__icon-btn"
                onClick={() => setEditing(true)}
                data-testid={`custom-data-edit-${entry.key}`}
                aria-label={
                  isBinary
                    ? t("customData.editAriaBinary")
                    : t("customData.editAria")
                }
                title={
                  isBinary
                    ? t("customData.editTitleBinary")
                    : t("customData.editTitle")
                }
              >
                <PencilIcon size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="custom-data__icon-btn custom-data__icon-btn--danger"
                onClick={() => setConfirmDelete(true)}
                data-testid={`custom-data-delete-${entry.key}`}
                aria-label={t("customData.deleteAria")}
                title={t("customData.deleteTitle")}
              >
                <TrashIcon size={14} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
      {!editing && isThirdParty && (
        <div className="custom-data__warning" role="note">
          {t("customData.warnThirdParty")}
        </div>
      )}
      {editing && isBinary && (
        <div className="custom-data__warning" role="note">
          {t("customData.warnBinary")}
        </div>
      )}
    </div>
  );
}

// -------- Value editor ---------------------------------------------

function EditValueForm({
  initialValueBase64,
  initialText,
  isBinary,
  isThirdParty: _isThirdParty,
  onCancel,
  onSave,
}: {
  initialValueBase64: string;
  initialText: string | null;
  isBinary: boolean;
  isThirdParty: boolean;
  onCancel: () => void;
  onSave: (valueBase64: string) => void;
}): JSX.Element {
  const t = useT();
  const [text, setText] = useState<string>(initialText ?? (isBinary ? "" : ""));
  return (
    <div className="custom-data__edit-form">
      <textarea
        className="custom-data__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        data-testid="custom-data-value-textarea"
      />
      <div className="custom-data__edit-actions">
        <button type="button" className="custom-data__btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="custom-data__btn custom-data__btn--primary"
          onClick={() => onSave(utf8ToBase64(text))}
          data-testid="custom-data-save-edit"
          disabled={utf8ToBase64(text) === initialValueBase64}
          title={
            utf8ToBase64(text) === initialValueBase64
              ? t("customData.saveTitleUnchanged")
              : t("customData.saveTitleStage")
          }
        >
          {t("customData.saveChange")}
        </button>
      </div>
    </div>
  );
}

// -------- Add-entry form -------------------------------------------

function AddEntryForm({
  existingKeys,
  onCancel,
  onAdd,
}: {
  existingKeys: Set<string>;
  onCancel: () => void;
  onAdd: (key: string, valueBase64: string) => void;
}): JSX.Element {
  const t = useT();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const trimmedKey = key.trim();
  const error = !trimmedKey
    ? t("customData.errorKeyRequired")
    : existingKeys.has(trimmedKey)
      ? t("customData.errorKeyExists")
      : null;
  const canSubmit = error == null;
  return (
    <div className="custom-data__add-form">
      <label className="custom-data__add-label">
        <span>{t("customData.addKeyLabel")}</span>
        <input
          type="text"
          className="custom-data__input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          placeholder={t("customData.addKeyPlaceholder")}
          data-testid="custom-data-add-key"
        />
      </label>
      <label className="custom-data__add-label">
        <span>{t("customData.addValueLabel")}</span>
        <textarea
          className="custom-data__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          data-testid="custom-data-add-value"
        />
      </label>
      {error && (
        <div className="custom-data__error" role="alert">
          {error}
        </div>
      )}
      <div className="custom-data__edit-actions">
        <button type="button" className="custom-data__btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="custom-data__btn custom-data__btn--primary"
          disabled={!canSubmit}
          onClick={() => onAdd(trimmedKey, utf8ToBase64(value))}
          data-testid="custom-data-confirm-add"
        >
          {t("customData.addEntry")}
        </button>
      </div>
    </div>
  );
}

// -------- Helpers --------------------------------------------------

/**
 * Heuristic: keys containing a `.` (dot) are treated as third-party
 * namespaced, e.g. `glasshouse.v1.notes` or `plugin.state`. Plain
 * keys like `my-key` are assumed user-owned. Approximate but cheap.
 */
function looksThirdParty(key: string): boolean {
  return key.includes(".");
}

/**
 * Try to decode a base64 payload as printable UTF-8. Returns the
 * string on success, or `null` when any control char under 0x20
 * (except tab/LF/CR) is present — that almost always means binary.
 */
function tryDecodeUtf8(base64: string): string | null {
  if (base64.length === 0) return "";
  try {
    const bytes = base64ToBytes(base64);
    for (const b of bytes) {
      if (b === 0) return null;
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return null;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
