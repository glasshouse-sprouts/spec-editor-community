/**
 * Pure decision helper for `SpecTabView` render mode.
 *
 * Lives in its own file so it can be unit-tested without pulling jsdom
 * or rendering the whole component tree. The component imports this
 * instead of recomputing the flags inline.
 *
 * Three possible layouts for a spec tab's main area:
 *   - "aligned": the BDB-vs-parent-work-area 2-column grid.
 *   - "standard": single-column spec content PLUS the ReferencePanel.
 *   - "spec-only": single-column spec content, nothing on the right.
 *
 * Decision table (rows = isAlignedMode, cols = refPanelCollapsed):
 *
 *                refPanelCollapsed=false    refPanelCollapsed=true
 *   isAligned=T  aligned                    spec-only
 *   isAligned=F  standard                   spec-only
 *
 * "isAlignedMode" here means "user has picked Work-area sub-tab AND the
 * BDB has a parent work area" — i.e. aligned mode is *possible*. The
 * collapse flag can still override whether we actually render the
 * aligned grid.
 */

export type SpecTabLayout = "aligned" | "standard" | "spec-only";

export function decideSpecTabLayout(args: {
  isAlignedMode: boolean;
  refPanelCollapsed: boolean;
}): SpecTabLayout {
  if (args.refPanelCollapsed) return "spec-only";
  if (args.isAlignedMode) return "aligned";
  return "standard";
}

/**
 * Which ARIA label / tooltip to show on the collapse/expand chevron.
 * Kept here (not inside the component) so tests can verify we use the
 * right wording in aligned vs standard mode — subtle but worth pinning
 * down so a future refactor doesn't quietly drop the aligned-mode copy.
 */
export function refPanelToggleLabel(args: {
  isAlignedMode: boolean;
  collapsed: boolean;
}): string {
  if (args.isAlignedMode) {
    return args.collapsed
      ? "Show parent work area column"
      : "Hide parent work area column";
  }
  return args.collapsed ? "Show reference panel" : "Hide reference panel";
}
