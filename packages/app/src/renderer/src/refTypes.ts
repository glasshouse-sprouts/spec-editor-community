/**
 * Shared types + helpers for the Reference panel and its dropdown.
 *
 * Split out of ReferencePanel.tsx so RefTypeDropdown can use them
 * without creating a circular import between the two components.
 */

/**
 * Which reference sub-option is active.
 *
 * - `basis` / `instruction` — Molio API surfaces (MAPI5). Both
 *   render in aligned mode (left = the user's spec, right = the
 *   fetched Molio document) when content is loaded; otherwise the
 *   right column shows a state message (loading, error, etc).
 * - `referenceliste` / `paradigm` — placeholder Molio API surfaces;
 *   real wiring lands in MAPI6.
 * - `workArea` — BDB → its parent work area (PFBB-style alignment).
 * - `versionReference` — current spec → the matched spec inside the
 *   loaded Version reference file (Phase E of the version-compare
 *   slice). Only available when a reference file is loaded.
 */
export type RefSubTab =
  | "basis"
  | "instruction"
  | "referenceliste"
  | "paradigm"
  | "workArea"
  | "versionReference";

/** Target kind the parent tab represents — determines which options show. */
export type RefPanelTargetKind = "workSpec" | "bdb";

export interface SubTabDef {
  id: RefSubTab;
  /** i18n key — caller passes through `t(opt.labelKey)`. */
  labelKey: string;
}

/**
 * List of options to show in the dropdown for the current target.
 *
 * `hasVersionReference` toggles the "Version reference" option in /
 * out — it should only appear when the user has actually loaded a
 * second `.moliospec` to compare against, otherwise the option does
 * nothing and confuses the user.
 *
 * `hasMolioReference` toggles the Molio-backed options (Basis /
 * Instruction / Referenceliste / Paradigm). Defaults to true so the
 * Glasshouse build is unchanged; the Community build (no Molio API)
 * passes false, leaving only the local Work-area + Version options.
 */
export function visibleSubTabs(
  targetKind: RefPanelTargetKind,
  hasAlignment: boolean,
  hasVersionReference = false,
  hasMolioReference = true,
): SubTabDef[] {
  const tabs: SubTabDef[] = [];
  if (hasMolioReference) {
    tabs.push(
      { id: "basis", labelKey: "refType.basis" },
      { id: "instruction", labelKey: "refType.instruction" },
      { id: "referenceliste", labelKey: "refType.referenceliste" },
    );
    // Paradigm only exists in the work_spec schema.
    if (targetKind === "workSpec") {
      tabs.push({ id: "paradigm", labelKey: "refType.paradigm" });
    }
  }
  // "Work area" only makes sense on BDBs that actually have a parent.
  if (targetKind === "bdb" && hasAlignment) {
    tabs.push({ id: "workArea", labelKey: "refType.workArea" });
  }
  if (hasVersionReference) {
    tabs.push({
      id: "versionReference",
      labelKey: "refType.versionReference",
    });
  }
  return tabs;
}

/** Initial sub-tab for a tab whose user hasn't picked one yet.
 *  BDBs with a parent work area open on "Work area" (the most useful view
 *  for the BDB-vs-parent alignment case). Everything else opens on Basis when
 *  Molio is present. With no Molio (Community), "basis" is returned as an inert
 *  fallback — the caller hides the reference UI when no sub-tab is visible. */
export function defaultSubTab(
  targetKind: RefPanelTargetKind,
  hasAlignment: boolean,
): RefSubTab {
  if (targetKind === "bdb" && hasAlignment) return "workArea";
  return "basis";
}

/** If the chosen sub-tab isn't valid for the current target, fall back to a
 *  sensible default (same logic as `defaultSubTab`). */
export function coerceSubTab(
  wanted: RefSubTab,
  targetKind: RefPanelTargetKind,
  hasAlignment: boolean,
  hasVersionReference = false,
  hasMolioReference = true,
): RefSubTab {
  const ok = visibleSubTabs(
    targetKind,
    hasAlignment,
    hasVersionReference,
    hasMolioReference,
  ).some((t) => t.id === wanted);
  if (ok) return wanted;
  return defaultSubTab(targetKind, hasAlignment);
}

/** i18n key for an option's user-facing label. Caller passes
 *  through `t(labelKeyFor(sub))` to render. */
export function labelKeyFor(sub: RefSubTab): string {
  switch (sub) {
    case "basis":
      return "refType.basis";
    case "instruction":
      return "refType.instruction";
    case "referenceliste":
      return "refType.referenceliste";
    case "paradigm":
      return "refType.paradigm";
    case "workArea":
      return "refType.workArea";
    case "versionReference":
      return "refType.versionReference";
  }
}
