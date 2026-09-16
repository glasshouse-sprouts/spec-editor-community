/**
 * Tab state for the Spec Editor (Phase 4 slice A).
 *
 * The app shows tabs across the top. One "Project" tab is always present
 * (the home view). Clicking a work area or BDB in the sidebar opens a new
 * tab, or focuses an existing one if the same spec is already open — see
 * `openOrFocusTab` below.
 *
 * We intentionally keep tab state small and derived: the tab knows only
 * *what* it points at, not *how* to render it. Rendering lives in MainPane.
 *
 * Not persisted across app restarts — see ROADMAP.md open decisions.
 */

/** What one tab represents. */
export type TabTarget =
  | { kind: "project" }
  | { kind: "workSpec"; id: number }
  | { kind: "bdb"; id: number }
  | { kind: "controlPlan"; id: number }
  /**
   * Highlights & formatting overview — singleton tab, opened from the
   * Highlighter icon in the top header. Lists every 6L.1 formatting
   * run with click-to-jump + per-row preview. Closeable like any
   * non-project tab; re-opens via the same button.
   */
  | { kind: "highlights" }
  /**
   * Version compare revisions — singleton tab, opened from the
   * Revisions icon in the top header (only visible when a Version
   * reference is loaded). Lists every section / CP row / attachment
   * difference between the current project and the reference, with
   * click-to-jump + per-row side-by-side preview.
   */
  | { kind: "revisions" };

export interface Tab {
  /** Opaque id — stable for the tab's lifetime, used as React key. */
  id: string;
  target: TabTarget;
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string;
}

/** The project tab has a fixed id so we can refer to it from anywhere. */
export const PROJECT_TAB_ID = "tab:project";

/**
 * Singleton id for the Highlights & formatting tab. Like the project
 * tab, there's always at most one — `openOrFocusTab` makes a fresh one
 * if missing or focuses the existing one. The fixed id lets us drive
 * "is the highlights tab open?" checks from anywhere.
 */
export const HIGHLIGHTS_TAB_ID = "tab:highlights";

/** Same singleton pattern, for the Version compare revisions tab. */
export const REVISIONS_TAB_ID = "tab:revisions";

/** Starting state — just the project tab, focused. */
export function initialTabState(): TabState {
  return {
    tabs: [{ id: PROJECT_TAB_ID, target: { kind: "project" } }],
    activeTabId: PROJECT_TAB_ID,
  };
}

/** True if `t` already points at `target`. */
function targetsMatch(t: Tab, target: TabTarget): boolean {
  if (t.target.kind !== target.kind) return false;
  // Singleton kinds (project, highlights, revisions) — same kind = same tab.
  if (t.target.kind === "project") return target.kind === "project";
  if (target.kind === "project") return false;
  if (t.target.kind === "highlights") return target.kind === "highlights";
  if (target.kind === "highlights") return false;
  if (t.target.kind === "revisions") return target.kind === "revisions";
  if (target.kind === "revisions") return false;
  return t.target.id === target.id;
}

/**
 * Open a tab for `target`. If a tab already exists with that target,
 * we focus it (rather than opening a duplicate). Otherwise we append a
 * new tab at the end and focus it.
 *
 * Singleton kinds (`project`, `highlights`) re-use a stable id so any
 * code path can refer to them by constant.
 */
export function openOrFocusTab(state: TabState, target: TabTarget): TabState {
  const existing = state.tabs.find((t) => targetsMatch(t, target));
  if (existing) {
    return { ...state, activeTabId: existing.id };
  }
  const newId =
    target.kind === "highlights"
      ? HIGHLIGHTS_TAB_ID
      : target.kind === "revisions"
        ? REVISIONS_TAB_ID
        : `tab:${nextId()}`;
  const newTab: Tab = { id: newId, target };
  return {
    tabs: [...state.tabs, newTab],
    activeTabId: newTab.id,
  };
}

/**
 * Close a tab. The Project tab cannot be closed. If we close the active
 * tab, focus shifts to the tab immediately to its left (or the project
 * tab as a safety net).
 */
export function closeTab(state: TabState, tabId: string): TabState {
  if (tabId === PROJECT_TAB_ID) return state;
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return state;

  const tabs = state.tabs.filter((t) => t.id !== tabId);
  const wasActive = state.activeTabId === tabId;
  let activeTabId = state.activeTabId;
  if (wasActive) {
    // Prefer the tab to the left; fall back to whatever remains, then Project.
    activeTabId = tabs[idx - 1]?.id ?? tabs[idx]?.id ?? PROJECT_TAB_ID;
  }
  return { tabs, activeTabId };
}

/** Switch focus to `tabId`. No-op if the tab doesn't exist. */
export function selectTab(state: TabState, tabId: string): TabState {
  if (!state.tabs.some((t) => t.id === tabId)) return state;
  return { ...state, activeTabId: tabId };
}

/** The currently focused tab. Always defined — project tab is a safety net. */
export function activeTab(state: TabState): Tab {
  return state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]!;
}

/**
 * The set of spec ids the renderer currently knows about — used by
 * `pruneTabsForFile` to drop tabs pointing at deleted specs.
 *
 * Singleton tabs (project / highlights / revisions) never need to
 * appear here; they're always valid regardless of file contents.
 */
export interface ValidSpecIds {
  workSpecs: ReadonlySet<number>;
  bdbs: ReadonlySet<number>;
  controlPlans: ReadonlySet<number>;
}

/**
 * After a file reload (typically post-save when something was
 * deleted), drop any tabs whose target spec no longer exists.
 * If the active tab was dropped, focus shifts to the project tab
 * (always present, never closeable).
 *
 * FIX-Tab 2026-05-11: closes "no BDB" / "no work area" zombie
 * tabs that would otherwise stay open after a save that deleted
 * the underlying spec.
 *
 * Pure function so the test suite doesn't need to mount React.
 */
export function pruneTabsForFile(
  state: TabState,
  valid: ValidSpecIds,
): TabState {
  const tabs = state.tabs.filter((t) => {
    switch (t.target.kind) {
      case "project":
      case "highlights":
      case "revisions":
        return true;
      case "workSpec":
        return valid.workSpecs.has(t.target.id);
      case "bdb":
        return valid.bdbs.has(t.target.id);
      case "controlPlan":
        return valid.controlPlans.has(t.target.id);
    }
  });
  if (tabs.length === state.tabs.length) return state;

  const activeStillOpen = tabs.some((t) => t.id === state.activeTabId);
  const activeTabId = activeStillOpen ? state.activeTabId : PROJECT_TAB_ID;
  return { tabs, activeTabId };
}

// -- internal ---------------------------------------------------------------

let _counter = 0;
function nextId(): number {
  _counter += 1;
  return _counter;
}
