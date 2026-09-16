/** @vitest-environment jsdom */
/**
 * Reference content seam - capability gating + Community default.
 *
 * These pin the behaviour the Community export depends on: with no Molio
 * provider, the Molio sub-tabs disappear and the reference-content seam reports
 * "not available". The Work-area (PFBB) and Version-reference options are
 * unaffected because they are local / prop-driven.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  coerceSubTab,
  defaultSubTab,
  visibleSubTabs,
} from "../src/renderer/src/refTypes.js";
import { useReferenceContentApi } from "../src/renderer/src/ReferenceContentContext.js";

describe("visibleSubTabs - Molio capability gating", () => {
  it("includes the Molio tabs by default (Glasshouse)", () => {
    const ids = visibleSubTabs("workSpec", false).map((t) => t.id);
    expect(ids).toEqual([
      "basis",
      "instruction",
      "referenceliste",
      "paradigm",
    ]);
  });

  it("drops every Molio tab when Molio is absent (Community)", () => {
    // workSpec, no alignment, no version, no Molio -> no sub-tabs at all.
    const ids = visibleSubTabs("workSpec", false, false, false).map(
      (t) => t.id,
    );
    expect(ids).toEqual([]);
  });

  it("keeps the local Work-area option without Molio (BDB with parent)", () => {
    const ids = visibleSubTabs("bdb", true, false, false).map((t) => t.id);
    expect(ids).toEqual(["workArea"]);
  });

  it("keeps the Version-reference option without Molio", () => {
    const ids = visibleSubTabs("bdb", true, true, false).map((t) => t.id);
    expect(ids).toEqual(["workArea", "versionReference"]);
  });

  it("still lists Molio tabs alongside local ones when enabled", () => {
    const ids = visibleSubTabs("bdb", true, true, true).map((t) => t.id);
    expect(ids).toEqual([
      "basis",
      "instruction",
      "referenceliste",
      "workArea",
      "versionReference",
    ]);
  });
});

describe("coerceSubTab - falls back when Molio is absent", () => {
  it("coerces a Molio tab to Work area when Molio is gone (BDB w/ parent)", () => {
    expect(coerceSubTab("basis", "bdb", true, false, false)).toBe("workArea");
  });

  it("leaves a valid local tab untouched", () => {
    expect(coerceSubTab("workArea", "bdb", true, false, false)).toBe(
      "workArea",
    );
  });

  it("keeps Molio tabs valid when Molio is enabled", () => {
    expect(coerceSubTab("instruction", "workSpec", false, false, true)).toBe(
      "instruction",
    );
  });
});

describe("defaultSubTab", () => {
  it("opens BDBs with a parent on Work area", () => {
    expect(defaultSubTab("bdb", true)).toBe("workArea");
  });

  it("falls back to basis otherwise (inert in Community)", () => {
    expect(defaultSubTab("workSpec", false)).toBe("basis");
  });
});

describe("ReferenceContentContext - Community default", () => {
  it("reports not enabled and yields no content when no provider is mounted", () => {
    const { result } = renderHook(() => useReferenceContentApi());
    expect(result.current.enabled).toBe(false);
    // The default useContent calls no hooks, so it is safe to invoke directly.
    expect(
      result.current.useContent({
        refs: {} as never,
        effectiveSubTab: "basis",
      }),
    ).toEqual({ alignment: null, panel: null });
  });
});
