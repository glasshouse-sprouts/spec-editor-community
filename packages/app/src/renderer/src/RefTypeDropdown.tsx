/**
 * RefTypeDropdown — small button + popup menu that replaces the old tab
 * bar for picking which reference type the panel shows.
 *
 * Visual: a button showing the current reference's label plus a small
 * chevron icon on the right indicating it's clickable. Clicking opens a
 * menu below the button with the remaining options. Clicking outside,
 * pressing Escape, or selecting a menu item closes the menu.
 *
 * Used in two places:
 *   - Standard mode: at the top of the ReferencePanel (shows "Basis" /
 *     "Referenceliste" / "Paradigm").
 *   - Aligned mode: as the sticky header over the right/work-area column
 *     (shows the work area name).
 *
 * Local state only — open/closed. No global dropdown manager is needed
 * because we show at most one of these at a time.
 */

import { useEffect, useRef, useState } from "react";

import { useT } from "./i18n/i18n.js";
import {
  coerceSubTab,
  visibleSubTabs,
  type RefPanelTargetKind,
  type RefSubTab,
} from "./refTypes.js";

interface Props {
  /** Text shown on the trigger button. Usually the current ref-type's
   *  name, or the work-area name in aligned mode. */
  label: string;
  targetKind: RefPanelTargetKind;
  hasAlignment: boolean;
  /**
   * Slice "Version compare" Phase E — when true, the dropdown
   * surfaces an extra "Version reference" option. Driven by whether
   * the consumer (SpecTabView) has a `versionAlignment` to render.
   */
  hasVersionReference?: boolean;
  /**
   * Whether the Molio-backed options (Basis / Instruction / Referenceliste /
   * Paradigm) are available. Defaults to true (Glasshouse). Community passes
   * false so only the local Work-area + Version options remain.
   */
  hasMolioReference?: boolean;
  activeSubTab: RefSubTab;
  onSubTabChange: (t: RefSubTab) => void;
  /** Extra class on the root button for mode-specific styling. */
  className?: string;
}

export function RefTypeDropdown({
  label,
  targetKind,
  hasAlignment,
  hasVersionReference = false,
  hasMolioReference = true,
  activeSubTab,
  onSubTabChange,
  className,
}: Props): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — tiny hand-rolled listener rather
  // than a library dep. Works well for a single menu at a time.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = visibleSubTabs(
    targetKind,
    hasAlignment,
    hasVersionReference,
    hasMolioReference,
  );
  const safeActive = coerceSubTab(
    activeSubTab,
    targetKind,
    hasAlignment,
    hasVersionReference,
    hasMolioReference,
  );

  const pick = (t: RefSubTab): void => {
    setOpen(false);
    onSubTabChange(t);
  };

  return (
    <div
      ref={rootRef}
      className={`ref-dropdown${className ? " " + className : ""}`}
    >
      <button
        type="button"
        className="ref-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Change reference type"
      >
        <span className="ref-dropdown__label">{label}</span>
        <span className="ref-dropdown__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="ref-dropdown__menu" role="listbox">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === safeActive}
                className={`ref-dropdown__item${
                  o.id === safeActive ? " is-active" : ""
                }`}
                onClick={() => pick(o.id)}
              >
                {t(o.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
