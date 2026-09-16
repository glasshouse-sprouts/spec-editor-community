/**
 * SectionContextMenu — slice 10G.
 *
 * Right-click popover on a TOC node. Four actions:
 *   - Add subsection      (nest a new section under the clicked one)
 *   - Add sibling at end  (same parent as the clicked one, appended
 *                          as the last child — no renumbering)
 *   - Rename…              (opens a small heading modal)
 *   - Delete…              (opens a cascade-confirm dialog)
 *
 * Visibility-wise this is just a positioned <div role="menu">; outside
 * clicks and Escape dismiss it. The parent (App.tsx) owns the state for
 * which node was clicked and which of the 4 modals (if any) is open.
 *
 * Labels come from the i18n catalogs (sectionMenu.*), including the
 * menu's own aria-label — the four data-testid values are stable and
 * language-independent, so tests do not care about the locale.
 *
 * PFBB child BDB views never mount this — the master owns the section
 * structure, so the child's TOC is read-only-structurally (supplements
 * are the only editable slice there, handled by the 10H.7 flow).
 */

import { useEffect, useRef } from "react";

import { useT } from "./i18n/i18n.js";

interface Props {
  /** Screen coordinates where the menu should appear. */
  top: number;
  left: number;
  /** Label used for the rename/delete prompts — purely cosmetic here. */
  sectionLabel: string;
  onAddSubsection: () => void;
  /** Slice 10G tweak — renamed to "at end" semantics, but the
   *  callback name is kept for minimal churn. */
  onAddSiblingAfter: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function SectionContextMenu({
  top,
  left,
  sectionLabel,
  onAddSubsection,
  onAddSiblingAfter,
  onRename,
  onDelete,
  onClose,
}: Props): JSX.Element {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (!ref.current) return;
      const t = e.target as Node | null;
      if (t && ref.current.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="tree-context-menu"
      style={{ top, left }}
      role="menu"
      aria-label={t("sectionMenu.ariaLabel", { sectionLabel })}
      data-testid="section-context-menu"
    >
      <button
        type="button"
        role="menuitem"
        className="tree-context-menu__item"
        onClick={() => {
          onAddSubsection();
          onClose();
        }}
        data-testid="section-menu-add-subsection"
      >
        {t("sectionMenu.addSubsection")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-menu__item"
        onClick={() => {
          onAddSiblingAfter();
          onClose();
        }}
        data-testid="section-menu-add-sibling"
      >
        {t("sectionMenu.addSiblingAtEnd")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-menu__item"
        onClick={() => {
          onRename();
          onClose();
        }}
        data-testid="section-menu-rename"
      >
        {t("sectionMenu.rename")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-menu__item tree-context-menu__item--danger"
        onClick={() => {
          onDelete();
          onClose();
        }}
        data-testid="section-menu-delete"
      >
        {t("sectionMenu.delete")}
      </button>
    </div>
  );
}
