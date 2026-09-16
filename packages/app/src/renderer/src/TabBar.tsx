/**
 * TabBar — tabs across the top of the window.
 *
 * Project tab is always first and can't be closed. Other tabs come and go
 * as the user opens specs and BDBs from the sidebar.
 */

import { Home as HomeIcon } from "lucide-react";

import type { FilePayload } from "../../shared/ipc.js";
import { t as tFn, useT } from "./i18n/i18n.js";
import {
  findBdbById,
  findControlPlanById,
  findWorkSpecById,
} from "./loaded.js";
import { PROJECT_TAB_ID, type Tab, type TabState } from "./tabs.js";

interface Props {
  tabs: TabState;
  data: FilePayload;
  /**
   * IDs of tabs whose target has unsaved section-body edits. Derived by
   * App.tsx from the edit map (Phase 6 Slice B onward).
   */
  dirtyTabIds: ReadonlySet<string>;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function TabBar({
  tabs,
  data,
  dirtyTabIds,
  onSelect,
  onClose,
}: Props): JSX.Element {
  return (
    <div className="tabbar" role="tablist">
      {tabs.tabs.map((t) => (
        <TabButton
          key={t.id}
          tab={t}
          data={data}
          active={t.id === tabs.activeTabId}
          closable={t.id !== PROJECT_TAB_ID}
          dirty={dirtyTabIds.has(t.id)}
          onSelect={() => onSelect(t.id)}
          onClose={() => onClose(t.id)}
        />
      ))}
    </div>
  );
}

function TabButton({
  tab,
  data,
  active,
  closable,
  dirty,
  onSelect,
  onClose,
}: {
  tab: Tab;
  data: FilePayload;
  active: boolean;
  closable: boolean;
  dirty: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const { label, title } = describeTab(tab, data, t);
  // Project tab gets a modifier class so its home-icon can be
  // centered over the collapsed sidebar rail (48px wide, icons
  // centered at x=22 from the viewport left).
  const isProjectTab = tab.target.kind === "project";
  return (
    <div
      className={
        `tab${active ? " is-active" : ""}${dirty ? " is-dirty" : ""}` +
        (isProjectTab ? " tab--project" : "")
      }
      role="tab"
      aria-selected={active}
    >
      <button
        type="button"
        className="tab__label"
        onClick={onSelect}
        title={dirty ? t("tabBar.titleUnsaved", { title }) : title}
      >
        {dirty && (
          <span className="tab__dirty" aria-label={t("tabBar.unsavedChanges")}>
            ●
          </span>
        )}
        {label}
      </button>
      {closable && (
        <button
          type="button"
          className="tab__close"
          aria-label={t("tabBar.closeTab")}
          title={t("tabBar.closeTab")}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Human label + full tooltip for a tab. Derived from the file data so we
 * don't have to store strings in the tab state — if the user renames
 * something later, tabs update for free.
 */
function describeTab(
  tab: Tab,
  data: FilePayload,
  t: typeof tFn,
): { label: JSX.Element | string; title: string } {
  // Alias the target so TS keeps the narrowed type across closures.
  const target = tab.target;
  switch (target.kind) {
    case "project": {
      const name = data.project?.name ?? t("tabBar.projectFallbackName");
      // Use a home icon instead of the text "Project" — the icon is
      // more compact and visually signals "this is the landing page".
      return {
        label: (
          <HomeIcon
            size={16}
            strokeWidth={1.75}
            className="tab__home-icon"
            aria-label={t("tabBar.projectHome")}
          />
        ),
        title: name,
      };
    }
    case "workSpec": {
      const id = target.id;
      const w = findWorkSpecById(data, id);
      if (!w) {
        return {
          label: t("tabBar.workAreaMissingLabel", { id }),
          title: t("tabBar.missingTitle"),
        };
      }
      // Show both code (if any) and name in the tab label so the user can
      // identify the work area without relying on the tooltip. CSS truncates
      // with an ellipsis if it overflows the tab's max width.
      const label = w.workAreaCode
        ? `${w.workAreaCode} ${w.workAreaName}`
        : w.workAreaName;
      return { label, title: label };
    }
    case "bdb": {
      const id = target.id;
      const b = findBdbById(data, id);
      if (!b) {
        return {
          label: t("tabBar.bdbMissingLabel", { id }),
          title: t("tabBar.missingTitle"),
        };
      }
      return { label: b.name, title: b.name };
    }
    case "controlPlan": {
      const id = target.id;
      const cp = findControlPlanById(data, id);
      if (!cp) {
        return {
          label: t("tabBar.controlPlanMissingLabel", { id }),
          title: t("tabBar.missingTitle"),
        };
      }
      return { label: cp.numberText || cp.title, title: cp.title };
    }
    case "highlights": {
      // Singleton tab — same translated label every time.
      const label = t("highlights.tab.label");
      return { label, title: t("highlights.tab.title") };
    }
    case "revisions": {
      // Singleton tab for Version compare. Title is translated.
      const label = t("revisions.tab.label");
      return { label, title: t("revisions.tab.title") };
    }
  }
}
