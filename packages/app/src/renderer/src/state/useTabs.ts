/**
 * useTabs — slice #233 Session 2 (round 8).
 *
 * Tab state cluster: which tabs are open, which is active, and the
 * per-tab UI scratch state (TOC filter / collapsed nodes / Ref-panel
 * state). Tabs are pure views — edits live on the document, so closing
 * a tab never prompts. The per-tab UI state lives in a `Record<tabId,
 * TabUiState>` that's pruned when a tab closes so it doesn't grow
 * forever.
 *
 * Composition with the rest of App:
 *   - Reset on file open: callers use `reset()` to wipe both maps.
 *   - `reloadAfterCpOp` uses the raw `setTabs` to do compound
 *     close-tab + focus-tab updates in a single setState pass. We
 *     expose `setTabs` directly for that case rather than inventing
 *     a one-off compound API.
 *   - The Ref-panel default is sticky across tabs and sessions — it
 *     lives in a localStorage-backed ref outside this hook. We accept
 *     it as a getter so the hook can produce a fresh default whenever
 *     a tab needs one.
 */

import { useCallback, useState } from "react";

import type { RefSubTab } from "../refTypes.js";
import {
  activeTab,
  closeTab as closeTabHelper,
  initialTabState,
  selectTab as selectTabHelper,
  type TabState,
  type TabTarget,
} from "../tabs.js";

/**
 * What each tab remembers about its TOC column + Reference panel
 * across switches.
 */
export interface TabUiState {
  filter: string;
  /**
   * TOC section IDs the user has explicitly collapsed. Default =
   * empty set = everything expanded. Per-tab session state: switching
   * tabs keeps its own collapsed nodes, but closing + reopening the
   * file starts fresh (no persistence across app restarts).
   *
   * The global "+ / −" button in the TOC acts as a shortcut:
   * "Collapse all" fills this with every parent section ID; "Expand
   * all" clears it. Filter interaction (unchanged): while filtering,
   * this set is ignored so matches under a collapsed parent still
   * appear.
   */
  collapsedNodeIds: ReadonlySet<number>;
  refSubTab: RefSubTab | null;
  /**
   * Whether the Reference panel is hidden in this tab. Defaults from
   * the persisted global preference (see `refPanelPrefs.ts`) so the
   * user's most recent choice sticks across app restarts; individual
   * tabs can diverge during a session by toggling their own chevron.
   *
   * Only meaningful in standard mode (Basis / Referenceliste /
   * Paradigm). The aligned Work-area sub-tab ignores it — there is
   * no separate reference pane to hide there.
   */
  refPanelCollapsed: boolean;
}

const EMPTY_COLLAPSED: ReadonlySet<number> = new Set();

export function makeDefaultTabUi(refPanelCollapsed: boolean): TabUiState {
  return {
    filter: "",
    collapsedNodeIds: EMPTY_COLLAPSED,
    refSubTab: null,
    refPanelCollapsed,
  };
}

export interface UseTabsArgs {
  /**
   * Returns the current Ref-panel default (a global preference,
   * persisted in localStorage outside this hook). Used when seeding
   * a fresh `TabUiState` on demand.
   */
  getRefPanelDefault: () => boolean;
}

export interface UseTabsResult {
  tabs: TabState;
  /**
   * Raw tabs setter — exposed because `reloadAfterCpOp` needs to do
   * compound close-tab + focus-tab updates in a single setState.
   */
  setTabs: React.Dispatch<React.SetStateAction<TabState>>;
  tabUiStates: Record<string, TabUiState>;
  activeTabId: string;
  activeTabKind: TabTarget["kind"];
  activeTabUi: TabUiState;
  /** Shallow-merge a patch into the active tab's UI state. */
  patchActiveTabUi: (patch: Partial<TabUiState>) => void;
  /** Close a tab and prune its UI scratch state. */
  closeTab: (id: string) => void;
  /** Make the given tab id active. */
  selectTab: (id: string) => void;
  /** Reset both maps. Called on file open. */
  reset: () => void;
}

export function useTabs({ getRefPanelDefault }: UseTabsArgs): UseTabsResult {
  const [tabs, setTabs] = useState<TabState>(() => initialTabState());
  const [tabUiStates, setTabUiStates] = useState<Record<string, TabUiState>>(
    {},
  );

  const activeTabId = activeTab(tabs).id;
  const activeTabKind = activeTab(tabs).target.kind;
  const activeTabUi =
    tabUiStates[activeTabId] ?? makeDefaultTabUi(getRefPanelDefault());

  const patchActiveTabUi = useCallback(
    (patch: Partial<TabUiState>): void => {
      setTabUiStates((m) => ({
        ...m,
        [activeTabId]: {
          ...(m[activeTabId] ?? makeDefaultTabUi(getRefPanelDefault())),
          ...patch,
        },
      }));
    },
    [activeTabId, getRefPanelDefault],
  );

  const closeTab = useCallback((id: string): void => {
    setTabs((t) => closeTabHelper(t, id));
    setTabUiStates((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  }, []);

  const selectTab = useCallback((id: string): void => {
    setTabs((t) => selectTabHelper(t, id));
  }, []);

  const reset = useCallback((): void => {
    setTabs(initialTabState());
    setTabUiStates({});
  }, []);

  return {
    tabs,
    setTabs,
    tabUiStates,
    activeTabId,
    activeTabKind,
    activeTabUi,
    patchActiveTabUi,
    closeTab,
    selectTab,
    reset,
  };
}
