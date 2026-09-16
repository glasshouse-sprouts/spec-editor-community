/**
 * Slice "Highlights & formatting" — Export options modal.
 *
 * Settings panel for the next PDF export. Currently houses two
 * sections — hide highlights (4 background colors) and hide font
 * colors (4 text colors) — but designed to grow as we add more
 * per-export toggles.
 *
 * Stateless wrt. settings: the dialog reads / writes via the
 * `hideMarkKinds` set owned by `useExportController`. The parent
 * controls open/close.
 *
 * UX rules
 * --------
 * - Each color is an independent toggle. Default = nothing hidden.
 * - "All" master per section flips every kind in that section on or
 *   off in one click. Reads `true` only when every color in the
 *   section is selected; otherwise indeterminate / off.
 * - State persists for the rest of the session. Closing the modal
 *   does NOT reset the toggles — that's the whole point.
 * - Settings only take effect on the *next* export; they don't
 *   trigger anything by themselves.
 */

import {
  BG_MARK_KINDS,
  TC_MARK_KINDS,
  type MarkKind,
} from "../highlights/markKinds.js";
import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface ExportOptionsModalProps {
  /** Currently-hidden mark kinds. Owned by `useExportController`. */
  hideMarkKinds: ReadonlySet<MarkKind>;
  /** Replace the whole set. Used by per-section "All" toggles. */
  setHideMarkKinds: (next: ReadonlySet<MarkKind>) => void;
  onClose: () => void;
}

export function ExportOptionsModal({
  hideMarkKinds,
  setHideMarkKinds,
  onClose,
}: ExportOptionsModalProps): JSX.Element {
  const t = useT();
  useEscToClose(onClose);

  function toggleKind(k: MarkKind, on: boolean): void {
    const next = new Set(hideMarkKinds);
    if (on) next.add(k);
    else next.delete(k);
    setHideMarkKinds(next);
  }

  function toggleSection(kinds: ReadonlyArray<MarkKind>, on: boolean): void {
    const next = new Set(hideMarkKinds);
    for (const k of kinds) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setHideMarkKinds(next);
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-options-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2 id="export-options-title" className="modal__title">
          {t("exportOptions.title")}
        </h2>
        <div className="modal__body">
          <p style={{ opacity: 0.7, fontSize: "0.875rem", marginTop: 0 }}>
            {t("exportOptions.intro")}
          </p>

          <ToggleSection
            heading={t("exportOptions.hideHighlights.title")}
            description={t("exportOptions.hideHighlights.description")}
            kinds={BG_MARK_KINDS}
            hideMarkKinds={hideMarkKinds}
            onToggleKind={toggleKind}
            onToggleSection={toggleSection}
            t={t}
          />

          <ToggleSection
            heading={t("exportOptions.hideFontColors.title")}
            description={t("exportOptions.hideFontColors.description")}
            kinds={TC_MARK_KINDS}
            hideMarkKinds={hideMarkKinds}
            onToggleKind={toggleKind}
            onToggleSection={toggleSection}
            t={t}
          />
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToggleSectionProps {
  heading: string;
  description: string;
  kinds: ReadonlyArray<MarkKind>;
  hideMarkKinds: ReadonlySet<MarkKind>;
  onToggleKind: (k: MarkKind, on: boolean) => void;
  onToggleSection: (kinds: ReadonlyArray<MarkKind>, on: boolean) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function ToggleSection({
  heading,
  description,
  kinds,
  hideMarkKinds,
  onToggleKind,
  onToggleSection,
  t,
}: ToggleSectionProps): JSX.Element {
  const allOn = kinds.every((k) => hideMarkKinds.has(k));
  return (
    <fieldset
      style={{
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 6,
        padding: "0.75rem 1rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <legend
        style={{
          padding: "0 0.5rem",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
      >
        {heading}
      </legend>
      <p
        style={{ margin: "0 0 0.625rem", opacity: 0.7, fontSize: "0.8125rem" }}
      >
        {description}
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1.25rem" }}
      >
        {kinds.map((k) => (
          <ColorToggle
            key={k}
            kind={k}
            checked={hideMarkKinds.has(k)}
            onChange={(on) => onToggleKind(k, on)}
            label={t(`highlights.kind.${k}`)}
          />
        ))}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            cursor: "pointer",
            paddingLeft: "0.5rem",
            borderLeft: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          <input
            type="checkbox"
            checked={allOn}
            onChange={(e) => onToggleSection(kinds, e.target.checked)}
          />
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
            {t("exportOptions.all")}
          </span>
        </label>
      </div>
    </fieldset>
  );
}

interface ColorToggleProps {
  kind: MarkKind;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}

function ColorToggle({
  kind,
  checked,
  onChange,
  label,
}: ColorToggleProps): JSX.Element {
  const isBg = kind.startsWith("bg-");
  const tone = kind.slice(3);
  const hex =
    tone === "yellow"
      ? "#fff26b"
      : tone === "blue"
        ? "#9ed6ff"
        : tone === "red"
          ? "#ff8b8b"
          : "#b7f0a3";
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          borderRadius: 3,
          background: isBg ? hex : "transparent",
          border: isBg ? "1px solid rgba(0,0,0,0.15)" : `2px solid ${hex}`,
          boxSizing: "border-box",
        }}
      />
      <span style={{ fontSize: "0.875rem" }}>{label}</span>
    </label>
  );
}
