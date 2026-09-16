/**
 * Table of contents column for spec tab views.
 *
 * What the user can do in the TOC:
 *   - Type in the filter box to narrow by heading text. Ancestors + all
 *     descendants of a matching row stay visible so hits read in context.
 *   - Click a chevron on a parent row to collapse/expand just that
 *     subtree.  The chevron only appears on rows that actually have
 *     children.  Clicking the number/heading still jumps — the two
 *     click targets don't overlap.
 *   - Click the global "+ / −" button to collapse/expand everything at
 *     once. That button is a shortcut: "Collapse all" adds every parent
 *     ID to the set; "Expand all" clears it. Per-node state stays
 *     visible in the set so it can still be nudged afterwards.
 *
 * Filter interaction: while the filter box has text, per-node collapse
 * is ignored — every matching row expands its ancestors so hits aren't
 * hidden under a collapsed parent.  The global button is also disabled
 * while filtering to avoid confusing state.
 *
 * The TOC also highlights which sections are currently in the viewport.
 * That `activeSectionIds` comes from SpecTabView (scrollspy).
 *
 * State plumbing: filter + `collapsedNodeIds` are controlled props,
 * owned by App.tsx per tab. Each tab remembers its own TOC state across
 * switches; no persistence across app restarts (resets on reopen).
 */

import { useMemo } from "react";

import type { SectionData } from "../../shared/ipc.js";
import { filterTreeForCompact } from "./compactFilter.js";
import { useT } from "./i18n/i18n.js";
import {
  buildSectionTree,
  filterSectionTree,
  sectionElementId,
  type SectionNode,
} from "./sectionTree.js";

interface Props {
  sections: SectionData[];
  filter: string;
  onFilterChange: (q: string) => void;
  /** Section IDs the user has explicitly collapsed. Empty = all expanded. */
  collapsedNodeIds: ReadonlySet<number>;
  onCollapsedNodeIdsChange: (next: ReadonlySet<number>) => void;
  /** All sections currently visible in the content viewport — plus the
   *  one row just above the visible block for context. Every matching
   *  row in the TOC gets the `.is-active` highlight. */
  activeSectionIds: ReadonlySet<number>;
  /** When true, rows for sections whose body is empty are removed from
   *  the TOC. Parents survive if any descendant survives — same rule as
   *  the spec pane, so the TOC and the content stay in sync. */
  compactView: boolean;
  /**
   * Slice 10H.7.b polish — master-section ids where the PFBB child
   * has a supplement (persisted OR a pending create/edit patch).
   * Rendered as a small ● marker on the TOC row so users can see at
   * a glance which sections this child has overridden. Optional;
   * regular BDB / work-spec views pass nothing.
   */
  sectionsWithSupplement?: ReadonlySet<number>;
  /**
   * UX3 (2026-04-27) — section ids that differ from the loaded
   * Version reference (added or modified, computed by
   * `findChangedSectionIds`). Renders a small neutral dot on each
   * row so users can see at a glance which sections have changes.
   *
   * Empty / undefined → no compare in progress, no dots. The dot
   * is distinct from `sectionsWithSupplement` (different colour);
   * a section with both renders both dots side by side.
   */
  sectionsWithChanges?: ReadonlySet<number>;
  /**
   * Slice 10G — right-click on a TOC node fires this callback with
   * the section id + pointer coordinates. Parent opens the hierarchy
   * context menu. Optional: PFBB child views pass nothing (master
   * owns the section structure).
   */
  onSectionContextMenu?: (
    sectionId: number,
    coords: { x: number; y: number },
  ) => void;
}

export function TOCColumn({
  sections,
  filter,
  onFilterChange,
  collapsedNodeIds,
  onCollapsedNodeIdsChange,
  activeSectionIds,
  compactView,
  sectionsWithSupplement,
  sectionsWithChanges,
  onSectionContextMenu,
}: Props): JSX.Element {
  const t = useT();
  const tree = useMemo(() => buildSectionTree(sections), [sections]);
  // Compact-view filter runs BEFORE the free-text filter: the user's
  // filter should only see sections that are currently visible in the
  // content pane. Running them in this order also means the "collapse
  // all" shortcut only collapses parents of visible rows.
  const compactTree = useMemo(
    () => filterTreeForCompact(tree, compactView),
    [tree, compactView],
  );
  const filtered = useMemo(
    () => filterSectionTree(compactTree, filter),
    [compactTree, filter],
  );

  // IDs of every parent node in the current compact-aware tree. Used
  // by the "Collapse all" shortcut — collapsing should include parents
  // that might currently be hidden by the text filter, so the collapsed
  // state survives clearing the filter later. When compact view is off,
  // `compactTree === tree`, so the behaviour is unchanged.
  const allParentIds = useMemo(
    () => collectParentIds(compactTree),
    [compactTree],
  );

  const isFiltering = filter.trim().length > 0;
  // Global button behaviour: when nothing is collapsed, offer "collapse
  // all". Otherwise offer "expand all". Simple + predictable; we don't
  // try to detect "is everything already collapsed?" because that's an
  // expensive walk for no real payoff.
  const nothingCollapsed = collapsedNodeIds.size === 0;

  const toggleNode = (id: number): void => {
    const next = new Set(collapsedNodeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCollapsedNodeIdsChange(next);
  };

  const handleGlobalClick = (): void => {
    onCollapsedNodeIdsChange(nothingCollapsed ? allParentIds : new Set());
  };

  const handleJump = (id: number): void => {
    const el = document.getElementById(sectionElementId(id));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="toc" aria-label={t("toc.ariaLabel")}>
      {/* Filter + toggle sit OUTSIDE the scroll area so they stay visible
       *  no matter how far the tree has been scrolled. `.toc__scroll` is
       *  the lone scrollable child; the filter row is flex-shrink-0 and
       *  pinned at the top of the column. */}
      <div className="toc__filter-row">
        <input
          type="search"
          className="toc__filter"
          placeholder={t("toc.filter.placeholder")}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <button
          type="button"
          className="toc__toggle-all"
          onClick={handleGlobalClick}
          title={
            isFiltering
              ? t("toc.toggleAll.filteringTooltip")
              : nothingCollapsed
                ? t("sidebar.tooltip.collapseAll")
                : t("sidebar.tooltip.expandAll")
          }
          aria-label={
            nothingCollapsed
              ? t("sidebar.aria.collapseAll")
              : t("sidebar.aria.expandAll")
          }
          aria-pressed={!nothingCollapsed}
          disabled={isFiltering}
        >
          {nothingCollapsed ? "−" : "+"}
        </button>
      </div>
      <div className="toc__scroll">
        {filtered.length === 0 ? (
          <div className="toc__empty">
            {filter ? t("toc.empty.noMatches") : t("toc.empty.noSections")}
          </div>
        ) : (
          <ul className="toc__list">
            {filtered.map((n) => (
              <TOCNode
                key={n.section.id}
                node={n}
                onJump={handleJump}
                activeIds={activeSectionIds}
                collapsedIds={collapsedNodeIds}
                onToggleNode={toggleNode}
                isFiltering={isFiltering}
                supplementIds={sectionsWithSupplement}
                changedIds={sectionsWithChanges}
                onContextMenu={onSectionContextMenu}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function TOCNode({
  node,
  onJump,
  activeIds,
  collapsedIds,
  onToggleNode,
  isFiltering,
  supplementIds,
  changedIds,
  onContextMenu,
}: {
  node: SectionNode;
  onJump: (id: number) => void;
  activeIds: ReadonlySet<number>;
  collapsedIds: ReadonlySet<number>;
  onToggleNode: (id: number) => void;
  isFiltering: boolean;
  supplementIds?: ReadonlySet<number>;
  /** UX3 — section ids that differ from the loaded Version reference.
   *  See TOCColumn `sectionsWithChanges` prop. */
  changedIds?: ReadonlySet<number>;
  onContextMenu?: (sectionId: number, coords: { x: number; y: number }) => void;
}): JSX.Element {
  const t = useT();
  const { section, depth, number, children } = node;
  const isActive = activeIds.has(section.id);
  const hasChildren = children.length > 0;
  // While filtering, force-expand so matches aren't hidden under a
  // collapsed parent. Otherwise respect per-node state.
  const isExpanded = isFiltering || !collapsedIds.has(section.id);
  const hasSupplement = supplementIds != null && supplementIds.has(section.id);
  // UX3 / UX3-bis — dot whichever section actually changed, leaf
  // or parent. The earlier "leaf only" rule (UX3) hid changes on
  // parent sections whose own body/heading was edited (e.g. user
  // empties all text in a section that has child sections), even
  // though the Revisions tab catches those cases. The set already
  // only contains exact-match changes — a parent dot does NOT
  // imply a descendant changed; it means the parent itself did —
  // so showing both is correct without making the TOC noisy.
  const hasChange = changedIds != null && changedIds.has(section.id);
  return (
    <li className="toc__item">
      <div
        className={`toc__row${isActive ? " is-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onContextMenu={
          onContextMenu
            ? (e) => {
                e.preventDefault();
                onContextMenu(section.id, {
                  x: e.clientX,
                  y: e.clientY,
                });
              }
            : undefined
        }
      >
        {hasChildren ? (
          <button
            type="button"
            className="toc__chevron"
            onClick={(e) => {
              // Don't let the click bubble to a parent handler or
              // interfere with focus on the heading link.
              e.stopPropagation();
              onToggleNode(section.id);
            }}
            title={
              isExpanded ? t("sidebar.aria.collapse") : t("sidebar.aria.expand")
            }
            aria-label={
              isExpanded
                ? t("toc.node.collapseSection")
                : t("toc.node.expandSection")
            }
            aria-expanded={isExpanded}
            // Disabled while filtering so the state can't diverge from
            // what's visible. The button stays in the DOM for layout
            // consistency (same indent for every row).
            disabled={isFiltering}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          // Leaf — render a same-width spacer so sibling numbers still
          // line up vertically with their parents' numbers.
          <span
            className="toc__chevron toc__chevron--leaf"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className={`toc__link${isActive ? " is-active" : ""}${
            hasSupplement ? " toc__link--has-supplement" : ""
          }${hasChange ? " toc__link--has-change" : ""}`}
          onClick={() => onJump(section.id)}
          title={
            hasChange
              ? t("toc.node.headingWithChange", {
                  heading: section.heading,
                })
              : hasSupplement
                ? t("toc.node.headingWithSupplement", {
                    heading: section.heading,
                  })
                : section.heading
          }
        >
          <span className="toc__no">{number}</span>
          <span className="toc__heading">{section.heading}</span>
          {hasSupplement && (
            <span
              className="toc__supplement-dot"
              aria-label={t("toc.node.supplementDotAria")}
              data-testid={`toc-supplement-dot-${section.id}`}
            >
              ●
            </span>
          )}
          {hasChange && (
            <span
              className="toc__change-dot"
              aria-label={t("toc.node.changeDotAria")}
              data-testid={`toc-change-dot-${section.id}`}
            >
              ●
            </span>
          )}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul className="toc__list">
          {children.map((c) => (
            <TOCNode
              key={c.section.id}
              node={c}
              onJump={onJump}
              activeIds={activeIds}
              collapsedIds={collapsedIds}
              onToggleNode={onToggleNode}
              isFiltering={isFiltering}
              supplementIds={supplementIds}
              changedIds={changedIds}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Walk the tree and collect the ID of every node that has at least one
 * child. Used by the "Collapse all" shortcut. Leaves aren't included
 * because collapsing a leaf is a no-op.
 */
function collectParentIds(tree: SectionNode[]): Set<number> {
  const out = new Set<number>();
  const visit = (n: SectionNode): void => {
    if (n.children.length > 0) {
      out.add(n.section.id);
      n.children.forEach(visit);
    }
  };
  tree.forEach(visit);
  return out;
}
