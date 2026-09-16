/**
 * Reference content seam (Community-safe).
 *
 * SpecTabView renders three kinds of reference content in its right column:
 *  - Molio Basis / Instruction / Paradigm / Referenceliste (Glasshouse-only),
 *  - Version reference (Glasshouse-only, prop-driven),
 *  - Work area / PFBB alignment (Community, prop-driven).
 *
 * Only the Molio content reaches Molio API code. This context injects it so
 * SpecTabView never imports the Molio reference files directly. In Community no
 * provider is mounted, the default below applies, `enabled` is false, and the
 * Molio sub-tabs disappear with no content rendered.
 *
 * The Glasshouse implementation + provider live in
 * `molio/MolioReferenceContent.tsx` (removed by the Community strip). This file
 * imports no Molio code, so Community keeps it.
 *
 * Invariant (rules of hooks): `useContent` is called unconditionally by
 * SpecTabView. Its implementation is fixed per build (the default here in
 * Community, the Molio hook in Glasshouse) and never swaps at runtime, so the
 * set of hooks it calls is stable across renders.
 */
import { createContext, useContext, type ReactNode } from "react";

import type { ReferenceLinks, SectionData } from "../../shared/ipc.js";
import type { RefSubTab } from "./refTypes.js";

export interface ReferenceContentArgs {
  refs: ReferenceLinks;
  effectiveSubTab: RefSubTab;
}

export interface ReferenceContentResult {
  /**
   * Right-side aligned content for a Molio content sub-tab
   * (Basis / Instruction / Paradigm) when loaded, else null.
   */
  alignment: { sideTitle: string; sections: SectionData[] } | null;
  /** Standard-mode side panel (the Molio reference panel), else null. */
  panel: ReactNode | null;
}

export interface ReferenceContentApi {
  /** Whether Molio reference content is available (a provider is mounted). */
  enabled: boolean;
  /** Hook returning the reference content for the active sub-tab. */
  useContent: (args: ReferenceContentArgs) => ReferenceContentResult;
}

const noReferenceContent: ReferenceContentApi = {
  enabled: false,
  useContent: () => ({ alignment: null, panel: null }),
};

const ReferenceContentContext =
  createContext<ReferenceContentApi>(noReferenceContent);

/** Provider used by the Glasshouse-only Molio content module. */
export const ReferenceContentProvider = ReferenceContentContext.Provider;

/** Read the injected reference-content API. */
export function useReferenceContentApi(): ReferenceContentApi {
  return useContext(ReferenceContentContext);
}
