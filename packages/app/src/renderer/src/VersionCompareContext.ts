/**
 * Version-compare engine seam (Community-safe).
 *
 * The "Compare versions" feature is Glasshouse-only. Its diff engine
 * (compareVersions + the alignment / change-id / diff-mark helpers) is pure
 * local logic, but Community must not ship or import it. This context injects
 * the engine so the shared on-screen (MainPane) and export code never import
 * the engine files directly.
 *
 * In Community no provider is mounted: the default below is a set of no-ops
 * (`enabled: false`). Those no-ops are never actually reached, because every
 * call site is gated on a loaded reference file (always null in Community), but
 * they keep the types honest and the build green after the engine files are
 * stripped.
 *
 * The Glasshouse implementation + provider live in
 * `compare/versionCompareEngineProvider.tsx` (removed by the Community strip).
 * This file imports no engine code.
 *
 * Invariant (rules of hooks): consumers call `useVersionCompareEngine()`
 * unconditionally. The engine object is fixed per build and never swaps at
 * runtime, so consumers see a stable value.
 */
import { createContext, useContext } from "react";

import type { FilePayload, SectionData } from "../../shared/ipc.js";
import type { Revision } from "./compare/compareTypes.js";
import type { DiffFormat } from "./compare/versionCompareFormat.js";

/** Which tab a change-id lookup is scoped to (work area or BDB). */
export interface TabParentMatcher {
  kind: "workSpec" | "bdb";
  currentId: number;
}

/** Inputs for diff-marking a PFBB child's supplement bodies. */
export interface PfbbSupplementDiffArgs {
  /** Current child overlay's supplement bodies, keyed by current
   *  master-section id. Output preserves these same keys. */
  supplementBodyBySectionId: Readonly<Record<number, string>>;
  /** Current master BDB's section list (to derive section paths). */
  currentMasterSections: ReadonlyArray<SectionData>;
  /** Reference master BDB's section list (may be empty when unmatched). */
  referenceMasterSections: ReadonlyArray<SectionData>;
  /** Reference child BDB's supplement rows (may be empty when unmatched). */
  referenceChildSections: ReadonlyArray<SectionData>;
  addedFormat: DiffFormat;
  deletedFormat: DiffFormat;
}

export interface VersionCompareEngine {
  /** Whether the version-compare feature is available (a provider is mounted). */
  enabled: boolean;
  compareVersions(current: FilePayload, reference: FilePayload): Revision[];
  buildVersionAlignmentSections(
    currentSections: ReadonlyArray<SectionData>,
    referenceSections: ReadonlyArray<SectionData>,
    addedFormat: DiffFormat,
    deletedFormat: DiffFormat,
  ): SectionData[];
  findChangedSectionIds(
    currentSections: ReadonlyArray<SectionData>,
    revisions: ReadonlyArray<Revision> | undefined | null,
    matcher: TabParentMatcher,
  ): Set<number>;
  applyDiffMarksToSections(
    currentSections: ReadonlyArray<SectionData>,
    referenceSections: ReadonlyArray<SectionData>,
    addedFormat: DiffFormat,
    deletedFormat: DiffFormat,
  ): SectionData[];
  applyDiffMarksToPfbbChildSupplements(
    args: PfbbSupplementDiffArgs,
  ): Record<number, string>;
}

const noVersionCompare: VersionCompareEngine = {
  enabled: false,
  compareVersions: () => [],
  buildVersionAlignmentSections: (current) => current.slice(),
  findChangedSectionIds: () => new Set<number>(),
  applyDiffMarksToSections: (current) => current.slice(),
  applyDiffMarksToPfbbChildSupplements: (args) => ({
    ...args.supplementBodyBySectionId,
  }),
};

const VersionCompareContext =
  createContext<VersionCompareEngine>(noVersionCompare);

/** Provider used by the Glasshouse-only engine module. */
export const VersionCompareProvider = VersionCompareContext.Provider;

/** Read the injected version-compare engine. */
export function useVersionCompareEngine(): VersionCompareEngine {
  return useContext(VersionCompareContext);
}
