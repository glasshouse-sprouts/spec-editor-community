/** @vitest-environment jsdom */
/**
 * Task 154 - the description keeps its place when the reference tab
 * changes (e.g. Basis -> Vejledning).
 *
 * Renders the real SpecTabView with a stand-in for the Molio content
 * provider. Basis is loaded; Vejledning is not, so picking it goes
 * through the same loading state the app goes through the first time:
 * the right side has nothing to show for a moment, the view leaves the
 * aligned layout, and comes back when the content arrives.
 *
 * jsdom has no layout, so the test gives each section header a
 * position (100 px per section, minus how far the user has scrolled)
 * and records which section `scrollIntoView` is asked to show. That is
 * the thing the user sees: which section is at the top after the
 * switch.
 */
import React, { createContext, useContext, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SectionData } from "../src/shared/ipc.js";
import {
  ReferenceContentProvider,
  type ReferenceContentApi,
} from "../src/renderer/src/ReferenceContentContext.js";
import type { RefSubTab } from "../src/renderer/src/refTypes.js";
import { SpecTabView } from "../src/renderer/src/SpecTabView.js";

const SECTIONS: SectionData[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id,
  sectionNo: id,
  heading: `Afsnit ${id}`,
  body: `<p>Tekst ${id}</p>`,
  parentId: null,
  pfbbSectionId: null,
}));

/** Which Molio tabs have their content loaded. Set by the test. */
const LoadedTabs = createContext<ReadonlySet<RefSubTab>>(new Set());

const molioContent: ReferenceContentApi = {
  enabled: true,
  useContent: ({ effectiveSubTab }) => {
    const loaded = useContext(LoadedTabs);
    return {
      alignment: loaded.has(effectiveSubTab)
        ? { sideTitle: String(effectiveSubTab), sections: SECTIONS }
        : null,
      panel: <div className="test-panel">indlæser</div>,
    };
  },
};

let setLoaded: (tabs: ReadonlySet<RefSubTab>) => void = () => {};

function Host(): React.ReactElement {
  const [loaded, set] = useState<ReadonlySet<RefSubTab>>(new Set(["basis"]));
  const [subTab, setSubTab] = useState<RefSubTab | null>("basis");
  setLoaded = set;
  return (
    <ReferenceContentProvider value={molioContent}>
      <LoadedTabs.Provider value={loaded}>
        <SpecTabView
          title="BDB"
          kind="bdb"
          revision={null}
          revisionDate={null}
          sections={SECTIONS}
          tocFilter=""
          onTocFilterChange={() => {}}
          tocCollapsedNodeIds={new Set()}
          onTocCollapsedNodeIdsChange={() => {}}
          refs={{ basisRevisionGuid: "rev-1" } as never}
          targetKind="bdb"
          refSubTab={subTab}
          onRefSubTabChange={setSubTab}
          refPanelCollapsed={false}
          onToggleRefPanelCollapsed={() => {}}
          alignment={null}
          compactView={false}
          layoutMode="web"
        />
      </LoadedTabs.Provider>
    </ReferenceContentProvider>
  );
}

/** Sections the user has scrolled past. Section 4 is at the top. */
let scrolledPast = 3;
let scrolledTo: number[] = [];
/** Where each restore happened, for the report: "standard:4", "aligned:4". */
let scrollLog: string[] = [];

beforeEach(() => {
  scrolledPast = 3;
  scrolledTo = [];
  scrollLog = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const owner =
        this.parentElement?.closest<HTMLElement>("[data-section-id]");
      if (this.classList.contains("section__header") && owner) {
        const top = (Number(owner.dataset.sectionId) - 1 - scrolledPast) * 100;
        return { top, bottom: top + 20, left: 0, right: 0 } as DOMRect;
      }
      return { top: 0, bottom: 500, left: 0, right: 0 } as DOMRect;
    },
  );
  Element.prototype.scrollIntoView = function (this: Element) {
    // Only the description itself; the table of contents keeps its own
    // active entry in view with the same call.
    const id = (this as HTMLElement).dataset.sectionId;
    const where = this.closest(".aligned")
      ? "aligned"
      : this.closest(".spec-content")
        ? "standard"
        : null;
    if (id && where) scrolledTo.push(Number(id));
    if (id && where) scrollLog.push(`${where}:${id}`);
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the reference dropdown and pick the option matching `name`. */
function pick(container: HTMLElement, name: RegExp): void {
  const toggle = container.querySelector<HTMLElement>(
    '[aria-haspopup="listbox"]',
  );
  fireEvent.click(toggle!);
  const option = Array.from(
    container.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((o) => name.test(o.textContent ?? ""));
  expect(option, `no option matching ${name}`).toBeDefined();
  fireEvent.click(option!);
}

describe("Task 154 - switching the reference keeps the description's place", () => {
  it("returns to the section the user was reading after Vejledning has loaded", () => {
    const { container } = render(<Host />);
    expect(container.querySelector(".aligned")).not.toBeNull();

    pick(container, /vejledning|instruction/i);
    // Vejledning is loading: the aligned layout is gone for now.
    expect(container.querySelector(".aligned")).toBeNull();

    act(() => setLoaded(new Set(["basis", "instruction"])));
    expect(container.querySelector(".aligned")).not.toBeNull();

    // The last thing the view did was put section 4 back at the top -
    // in the aligned view the user ends up looking at.
    expect(scrollLog.at(-1)).toBe("aligned:4");
  });

  it("follows the user if they scroll while Vejledning is loading", async () => {
    const { container } = render(<Host />);
    pick(container, /vejledning|instruction/i);
    const standard = container.querySelector(".spec-content")!;
    scrolledPast = 4; // now section 5 is at the top
    fireEvent.scroll(standard);
    await act(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    act(() => setLoaded(new Set(["basis", "instruction"])));
    expect(scrollLog.at(-1)).toBe("aligned:5");
  });

  it("keeps the place when switching back to an already loaded tab", () => {
    const { container } = render(<Host />);
    act(() => setLoaded(new Set(["basis", "instruction"])));
    pick(container, /vejledning|instruction/i);
    scrolledTo = [];
    pick(container, /basis/i);
    expect(container.querySelector(".aligned")).not.toBeNull();
    // No layout change, so nothing needs restoring and nothing jumps.
    expect(scrolledTo).toEqual([]);
  });
});
