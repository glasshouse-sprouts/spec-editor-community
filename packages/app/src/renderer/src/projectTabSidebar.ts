/**
 * Phase 10 Slice 10A — sidebar auto-collapse state machine for the
 * Project Overview tab.
 *
 * The Project Overview tab hosts its own full-width navigation tree
 * (from Slice 10C onwards), so the app-level left sidebar is
 * redundant there. To free up horizontal space, we auto-collapse the
 * left sidebar whenever the focused tab is the Project tab — but we
 * respect the user's persisted preference on every other tab.
 *
 * Decision (2026-04-22, option "a"): a manual sidebar-toggle made
 * *while on the Project tab* is treated as a session-only override.
 * It does **not** change the persisted user preference. When the
 * user leaves the Project tab, the override is cleared; the next
 * entry to the Project tab starts auto-collapsed again.
 *
 * This module is a pure state machine so it can be unit tested
 * without spinning up React / jsdom. The App component wires the
 * three functions here to its tab-change and toggle handlers.
 */

import type { TabTarget } from "./tabs.js";

/** A narrow view of `TabTarget["kind"]` — the only thing this module cares about. */
export type TabKind = TabTarget["kind"];

/**
 * Two-part state driving the left-sidebar collapsed flag.
 *
 * - `userPreference` — the persisted value shown when the user is *not*
 *   on the Project tab. Backed by `molio2.sidebar.collapsed` in
 *   localStorage. Only changes via explicit toggles made while off
 *   the Project tab.
 * - `projectTabOverride` — a session-only override applied while the
 *   Project tab is active. `null` means "no override → use the auto-
 *   collapsed default". Set when the user clicks the toggle while on
 *   the Project tab. Cleared when the user navigates away.
 */
export interface SidebarPrefState {
  userPreference: boolean;
  projectTabOverride: boolean | null;
}

/** Convenience: brand-new state from a persisted user preference. */
export function initialSidebarPrefState(
  userPreference: boolean,
): SidebarPrefState {
  return { userPreference, projectTabOverride: null };
}

/**
 * The flag the sidebar actually renders with.
 *
 * - On the Project tab: use the explicit override if set, otherwise
 *   auto-collapse (return `true`).
 * - Elsewhere: use the persisted user preference.
 */
export function effectiveSidebarCollapsed(
  state: SidebarPrefState,
  activeTabKind: TabKind,
): boolean {
  if (activeTabKind === "project") {
    return state.projectTabOverride ?? true;
  }
  return state.userPreference;
}

/**
 * Handle a click on the sidebar toggle button.
 *
 * - On the Project tab: flip the override. This never touches the
 *   persisted user preference.
 * - Elsewhere: flip the user preference (which the caller will persist).
 *
 * The returned state is always a fresh object so React can detect the
 * change via reference equality.
 */
export function handleSidebarToggle(
  state: SidebarPrefState,
  activeTabKind: TabKind,
): SidebarPrefState {
  const current = effectiveSidebarCollapsed(state, activeTabKind);
  if (activeTabKind === "project") {
    return { ...state, projectTabOverride: !current };
  }
  return { ...state, userPreference: !current };
}

/**
 * Handle the active tab changing.
 *
 * When the user leaves the Project tab, we clear the session-only
 * override. That way the next time they come back, the sidebar auto-
 * collapses again — the override was a "just for now" gesture, not
 * a permanent preference.
 *
 * Staying on the Project tab (or never having been there) is a no-op.
 */
export function handleActiveTabChange(
  state: SidebarPrefState,
  newTabKind: TabKind,
): SidebarPrefState {
  if (newTabKind !== "project" && state.projectTabOverride !== null) {
    return { ...state, projectTabOverride: null };
  }
  return state;
}
