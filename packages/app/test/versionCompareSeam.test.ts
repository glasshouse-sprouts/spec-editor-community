/** @vitest-environment jsdom */
/**
 * Version-compare engine seam - Community default.
 *
 * With no provider mounted (Community), the engine reports "not enabled" and
 * every method is a safe no-op. These are never reached in practice (all call
 * sites are gated on a loaded reference file, always null in Community), but
 * the defaults keep the build green once the engine files are stripped.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useVersionCompareEngine } from "../src/renderer/src/VersionCompareContext.js";
import type { SectionData } from "../src/shared/ipc.js";

const sec = (id: number): SectionData =>
  ({ id, body: `b${id}` }) as unknown as SectionData;

describe("VersionCompareContext - Community default", () => {
  it("reports not enabled when no provider is mounted", () => {
    const { result } = renderHook(() => useVersionCompareEngine());
    expect(result.current.enabled).toBe(false);
  });

  it("compareVersions + findChangedSectionIds yield nothing", () => {
    const { result } = renderHook(() => useVersionCompareEngine());
    const engine = result.current;
    expect(engine.compareVersions({} as never, {} as never)).toEqual([]);
    expect(
      engine.findChangedSectionIds([sec(1)], [], {
        kind: "workSpec",
        currentId: 1,
      }),
    ).toEqual(new Set());
  });

  it("alignment + diff-mark no-ops return the input unchanged", () => {
    const { result } = renderHook(() => useVersionCompareEngine());
    const engine = result.current;
    const current = [sec(1), sec(2)];
    const fmt = { added: {}, deleted: {} } as never;

    // Alignment / section diff-marks just echo the current sections.
    expect(engine.buildVersionAlignmentSections(current, [], fmt, fmt)).toEqual(
      current,
    );
    expect(engine.applyDiffMarksToSections(current, [], fmt, fmt)).toEqual(
      current,
    );

    // Supplement diff-marks echo the input map (same keys, same bodies).
    const supplements = { 1: "<p>x</p>", 2: "<p>y</p>" };
    expect(
      engine.applyDiffMarksToPfbbChildSupplements({
        supplementBodyBySectionId: supplements,
        currentMasterSections: current,
        referenceMasterSections: [],
        referenceChildSections: [],
        addedFormat: fmt,
        deletedFormat: fmt,
      }),
    ).toEqual(supplements);
  });
});
