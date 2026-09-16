/** @vitest-environment jsdom */
/**
 * RELOAD-Merge — tests for the Merge dialog.
 *
 * The dialog shows each conflict side-by-side and collects a
 * three-way choice (keep mine / keep disk / edit a merged draft),
 * then hands the winning units to `onApply`. Locale is pinned to
 * English by test/setup.ts.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MergeUnit } from "../src/renderer/src/mergeOnReload.js";
import { ReloadMergeModal } from "../src/renderer/src/modals/ReloadMergeModal.js";

// The test build uses the classic JSX runtime — React must be in scope.
void React;

function unit(key: string, over: Partial<MergeUnit> = {}): MergeUnit {
  return {
    key,
    kind: "sectionBody",
    label: key,
    base: "base",
    mine: "mine",
    theirs: "theirs",
    edit: { target: "bdb", sectionId: 1, body: "mine" },
    ...over,
  };
}

afterEach(cleanup);

describe("ReloadMergeModal", () => {
  it("shows the auto-merged count", () => {
    render(
      <ReloadMergeModal
        autoApplied={[unit("a"), unit("b")]}
        conflicts={[]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={() => {}}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText(/Merged automatically: 2/)).toBeTruthy();
  });

  it("with no conflicts, Apply is enabled and the no-conflicts note shows", () => {
    render(
      <ReloadMergeModal
        autoApplied={[unit("a")]}
        conflicts={[]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={() => {}}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText(/No conflicts/)).toBeTruthy();
    const apply = screen.getByText("Apply merge") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it("keeps Apply disabled until every conflict is resolved", () => {
    render(
      <ReloadMergeModal
        autoApplied={[]}
        conflicts={[unit("c1"), unit("c2")]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={() => {}}
        onApply={() => {}}
      />,
    );
    const apply = screen.getByText("Apply merge") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    // 2 conflicts × (mine, theirs, custom) = 6 radios.
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]!); // c1 → mine
    expect(apply.disabled).toBe(true);
    fireEvent.click(radios[3]!); // c2 → mine
    expect(apply.disabled).toBe(false);
  });

  it("Apply hands back auto units + conflicts resolved to mine", () => {
    const onApply = vi.fn();
    render(
      <ReloadMergeModal
        autoApplied={[unit("auto1")]}
        conflicts={[unit("c1"), unit("c2")]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={() => {}}
        onApply={onApply}
      />,
    );
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]!); // c1 → mine
    fireEvent.click(radios[4]!); // c2 → theirs
    fireEvent.click(screen.getByText("Apply merge"));

    expect(onApply).toHaveBeenCalledTimes(1);
    const winners = onApply.mock.calls[0]![0] as MergeUnit[];
    expect(winners.map((u) => u.key).sort()).toEqual(["auto1", "c1"]);
  });

  it("a custom merged draft becomes the winning value", () => {
    const onApply = vi.fn();
    const c = unit("c1", {
      kind: "metaField",
      edit: { target: "bdbMetadata", id: 1, name: "mine" },
    });
    render(
      <ReloadMergeModal
        autoApplied={[]}
        conflicts={[c]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={() => {}}
        onApply={onApply}
      />,
    );
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[2]!); // → custom
    // A short field → the draft editor is a plain text input.
    const input = screen.getByDisplayValue("mine") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "merged draft" } });
    fireEvent.click(screen.getByText("Apply merge"));

    const winners = onApply.mock.calls[0]![0] as MergeUnit[];
    expect(winners).toHaveLength(1);
    expect(winners[0]!.mine).toBe("merged draft");
  });

  it("lists disk-side additions and removals", () => {
    render(
      <ReloadMergeModal
        autoApplied={[]}
        conflicts={[]}
        diskDelta={{
          added: [{ kind: "bdb", name: "Fresh BDB" }],
          removed: [{ kind: "controlPlan", name: "Old plan" }],
        }}
        onCancel={() => {}}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText(/Fresh BDB/)).toBeTruthy();
    expect(screen.getByText(/Old plan/)).toBeTruthy();
  });

  it("Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ReloadMergeModal
        autoApplied={[]}
        conflicts={[]}
        diskDelta={{ added: [], removed: [] }}
        onCancel={onCancel}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
