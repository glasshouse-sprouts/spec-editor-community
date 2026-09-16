/**
 * SettingsDialog — app-level settings.
 *
 * Houses the UI language picker (since slice #36) and the Version-
 * compare diff-mark formatting (since slice "Version compare"). Both
 * persist per-user via localStorage so the choices survive app
 * relaunches. Future settings rows live in this same modal — keep
 * them grouped under semantic `<fieldset>` blocks so the dialog
 * scales without becoming a wall of inputs.
 */

import { useEffect, useState } from "react";

import { type Locale, useLocale, useT } from "../i18n/i18n.js";
import {
  patchVersionCompareFormat,
  resetVersionCompareFormat,
  useVersionCompareFormat,
  type DiffFormat,
  type DiffMarkKind,
} from "../compare/versionCompareFormat.js";
// Community edition: Glasshouse sign-in + Molio API + MCP server settings removed.
import type { DefaultsFileKind } from "../../../shared/ipc.js";

/**
 * Which diff-mark kinds are user-configurable today. "moved" is
 * intentionally omitted — Phase B doesn't detect moves yet, so
 * exposing the setting would imply a feature that doesn't ship. The
 * persisted value still survives (the storage shape includes all
 * three), so the row will reappear automatically when move detection
 * lands later. Tore's call 2026-04-26.
 */
const VISIBLE_DIFF_MARK_KINDS: ReadonlyArray<DiffMarkKind> = [
  "added",
  "deleted",
];
import { useEscToClose } from "./useEscToClose.js";

interface SettingsDialogProps {
  /** Closes the dialog (parent state). */
  onClose: () => void;
  /**
   * Phase 8 round 2 — Reader mode (Læsetilstand). Current value
   * comes from App-level state (persisted in PREFS). When the user
   * checks the box, App's handler decides whether to confirm
   * (e.g. unsaved edits) before flipping the value.
   */
  readerMode: boolean;
  /**
   * Toggle handler. Called with the desired next state. App
   * intercepts to show the "you have unsaved edits" confirm
   * dialog when relevant before applying.
   */
  onRequestToggleReaderMode: (next: boolean) => void;
}

export function SettingsDialog({
  onClose,
  readerMode,
  onRequestToggleReaderMode,
}: SettingsDialogProps): JSX.Element {
  const t = useT();
  const [locale, setLocale] = useLocale();
  const [format] = useVersionCompareFormat();
  useEscToClose(onClose);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
      <div className="modal modal--xl">
        <h2 id="settings-dialog-title" className="modal__title">
          {t("settings.title")}
        </h2>
        <div className="modal__body">
          <fieldset className="settings-section">
            <legend className="settings-section__legend">
              {t("settings.language.section")}
            </legend>
            <label className="modal__field">
              <span className="modal__field-label">
                {t("settings.language.label")}
              </span>
              <select
                className="modal__input"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                aria-label={t("settings.language.label")}
              >
                <option value="da">{t("settings.language.danish")}</option>
                <option value="en">{t("settings.language.english")}</option>
              </select>
            </label>
          </fieldset>

          {/* Phase 8 round 2 — Reader mode (Læsetilstand). */}
          <fieldset className="settings-section">
            <legend className="settings-section__legend">
              {t("settings.readerMode.section")}
            </legend>
            <p className="settings-section__hint">
              {t("settings.readerMode.hint")}
            </p>
            <label
              className="modal__field"
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={readerMode}
                onChange={(e) => onRequestToggleReaderMode(e.target.checked)}
                aria-label={t("settings.readerMode.label")}
              />
              <span>{t("settings.readerMode.label")}</span>
            </label>
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-section__legend">
              {t("settings.defaults.section")}
            </legend>
            <p className="settings-section__hint">
              {t("settings.defaults.hint")}
            </p>
            <DefaultsFileRow which="contracts" />
            <DefaultsFileRow which="mapping" />
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-section__legend">
              {t("settings.versionCompare.section")}
            </legend>
            <p className="settings-section__hint">
              {t("settings.versionCompare.hint")}
            </p>
            {VISIBLE_DIFF_MARK_KINDS.map((kind) => (
              <DiffFormatRow
                key={kind}
                kind={kind}
                format={format[kind]}
                t={t}
              />
            ))}
            <div style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="modal__button"
                onClick={() => resetVersionCompareFormat()}
              >
                {t("settings.versionCompare.reset")}
              </button>
            </div>
          </fieldset>
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("settings.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  Default-CSV row (#250 2D) — open / reset the editable default file.   */
/* --------------------------------------------------------------------- */

function DefaultsFileRow({ which }: { which: DefaultsFileKind }): JSX.Element {
  const t = useT();
  const label =
    which === "mapping"
      ? t("settings.defaults.mapping")
      : t("settings.defaults.contracts");
  async function open(): Promise<void> {
    const res = await window.molio.openDefaultsFile({ which });
    if (!res.ok) window.alert(t("settings.defaults.openFailed"));
  }
  async function reset(): Promise<void> {
    const res = await window.molio.resetDefaultsFile({ which });
    window.alert(
      res.ok
        ? t("settings.defaults.resetDone")
        : t("settings.defaults.resetFailed"),
    );
  }
  return (
    <div
      className="modal__field"
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <button
        type="button"
        className="modal__button"
        onClick={() => void open()}
      >
        {t("settings.defaults.open")}
      </button>
      <button
        type="button"
        className="modal__button"
        onClick={() => void reset()}
      >
        {t("settings.defaults.reset")}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  Diff-format row — three of these (added / deleted / moved).          */
/* --------------------------------------------------------------------- */

interface DiffFormatRowProps {
  kind: DiffMarkKind;
  format: DiffFormat;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function DiffFormatRow({ kind, format, t }: DiffFormatRowProps): JSX.Element {
  function patch(p: Partial<DiffFormat>): void {
    patchVersionCompareFormat(kind, p);
  }
  return (
    <div className="diff-format-row">
      <div className="diff-format-row__label">
        {t(`settings.versionCompare.kind.${kind}`)}
      </div>
      <div className="diff-format-row__preview">
        <span style={diffFormatToCss(format)}>
          {t("settings.versionCompare.preview")}
        </span>
      </div>
      <div className="diff-format-row__controls">
        <ToggleButton
          label="B"
          ariaLabel={t("settings.versionCompare.bold")}
          on={format.bold}
          onChange={(v) => patch({ bold: v })}
          style={{ fontWeight: 700 }}
        />
        <ToggleButton
          label="I"
          ariaLabel={t("settings.versionCompare.italic")}
          on={format.italic}
          onChange={(v) => patch({ italic: v })}
          style={{ fontStyle: "italic" }}
        />
        <ToggleButton
          label="S"
          ariaLabel={t("settings.versionCompare.strikethrough")}
          on={format.strikethrough}
          onChange={(v) => patch({ strikethrough: v })}
          style={{ textDecoration: "line-through" }}
        />
        <ToggleButton
          label="U"
          ariaLabel={t("settings.versionCompare.underline")}
          on={format.underline}
          onChange={(v) => patch({ underline: v })}
          style={{ textDecoration: "underline" }}
        />
        <ColorControl
          ariaLabel={t("settings.versionCompare.color")}
          value={format.color}
          onChange={(c) => patch({ color: c })}
          fallbackHex="#000000"
        />
        <ColorControl
          ariaLabel={t("settings.versionCompare.background")}
          value={format.background}
          onChange={(c) => patch({ background: c })}
          fallbackHex="#ffffff"
          isBackground
        />
      </div>
    </div>
  );
}

interface ToggleButtonProps {
  label: string;
  ariaLabel: string;
  on: boolean;
  onChange: (next: boolean) => void;
  style?: React.CSSProperties;
}

function ToggleButton({
  label,
  ariaLabel,
  on,
  onChange,
  style,
}: ToggleButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`diff-format-toggle${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => onChange(!on)}
      style={style}
    >
      {label}
    </button>
  );
}

interface ColorControlProps {
  ariaLabel: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Color shown in the picker when `value` is null (visual cue only). */
  fallbackHex: string;
  isBackground?: boolean;
}

function ColorControl({
  ariaLabel,
  value,
  onChange,
  fallbackHex,
  isBackground,
}: ColorControlProps): JSX.Element {
  return (
    <span className="diff-format-color">
      <input
        type="color"
        value={value ?? fallbackHex}
        aria-label={ariaLabel}
        title={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={isBackground ? "is-background" : ""}
      />
      {value != null && (
        <button
          type="button"
          className="diff-format-color__clear"
          aria-label="Clear color"
          title="Clear"
          onClick={() => onChange(null)}
        >
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Turn a `DiffFormat` into a `style` object for the live preview cell.
 * Re-exported so other modules (aligned-view reference column,
 * preview modal) can apply the user's chosen formatting in their
 * own React components without re-deriving the mapping.
 */
export function diffFormatToCss(f: DiffFormat): React.CSSProperties {
  const decorations: string[] = [];
  if (f.strikethrough) decorations.push("line-through");
  if (f.underline) decorations.push("underline");
  return {
    fontWeight: f.bold ? 700 : undefined,
    fontStyle: f.italic ? "italic" : undefined,
    textDecoration: decorations.length > 0 ? decorations.join(" ") : undefined,
    color: f.color ?? undefined,
    background: f.background ?? undefined,
  };
}
