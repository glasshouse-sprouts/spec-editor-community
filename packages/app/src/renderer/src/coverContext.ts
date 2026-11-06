/**
 * Custom-cover engine seam (Community-safe). #249 COVER, Skive 3c.
 *
 * The custom front-page feature is Glasshouse-only, but the shared
 * export code (`useExportController`, `buildBytesFor`,
 * `executeCompositeExport`) must be able to ask "is there a custom
 * cover, and if so wrap these bytes" without importing any pdf-lib /
 * template code. This context injects a `CoverEngine` exactly like
 * `VersionCompareContext` injects the diff engine.
 *
 * In Community no provider is mounted: the default is a no-op
 * (`enabled: false`, `resolveActiveTemplate` → null, `applyCover`
 * returns the bytes untouched). So the export path behaves exactly as
 * before — the body is built with the built-in auto cover and nothing
 * is wrapped.
 *
 * This file is KEPT in Community (like VersionCompareContext.ts). It
 * deliberately imports nothing from `cover/` — every type here is a
 * primitive — so the whole `cover/` folder can stay stripped. The real
 * engine lives in `cover/coverEngineProvider.tsx` (Glasshouse-only,
 * removed by the Community strip) and is added in commit 3c-2.
 */

import { createContext, useContext } from "react";

/**
 * Per-PDF values a cover field can show. All primitives — the engine
 * combines these with the template's own company name to fill the
 * field bindings. (Project-level values repeat on every PDF; the
 * spec-level ones vary per exported document.)
 */
export interface CoverExportContext {
  projectName: string | null;
  projectNumber: string | null;
  builder: string | null;
  /**
   * The company name from Settings > "Firma" (Task 185), the value the
   * PDF footer prints. A custom cover's "Firmanavn" field shows the same
   * value (Task 190), so the two can never disagree.
   */
  companyName: string | null;
  /** Export date, pre-formatted (e.g. "2026-06-26"). */
  dateText: string;
  specTitle: string | null;
  revision: string | null;
  revisionDate: string | null;
  contractLabel: string | null;
  workAreaName: string | null;
  /**
   * The document type the built-in cover prints above the title (Task 147,
   * B2.1), computed by the same functions in `pdf/documentTypes.ts`, so a
   * custom cover's "Dokumenttype" field shows exactly the same value.
   */
  documentType: string;
}

/** Identifies the project so the engine can resolve folder/remembered. */
export interface CoverProjectRef {
  /** Path of the open .moliospec (used to look for a sibling template). */
  moliospecPath: string;
  /** Stable project id used as the "remembered template" key. */
  projectGuid: string | null;
}

/**
 * Opaque handle to a resolved active template. The shared export code
 * never looks inside it — it just receives one from
 * `resolveActiveTemplate` and hands it back to `applyCover`. The real
 * engine casts its internal object to this brand.
 */
export type CoverActiveTemplate = { readonly __coverActive: "active" };

/** What the shared export path threads through its build options. */
export interface CoverApply {
  active: CoverActiveTemplate;
  apply: CoverEngine["applyCover"];
}

export interface CoverEngine {
  /** Whether a real cover engine is mounted (Glasshouse). */
  enabled: boolean;
  /**
   * Resolve the active template for this project (session pick > sibling
   * `.speccustom` > remembered > none). Returns null when there is no
   * custom cover — the caller then uses the built-in auto cover. Called
   * once per export.
   */
  resolveActiveTemplate(
    ref: CoverProjectRef,
  ): Promise<CoverActiveTemplate | null>;
  /**
   * Resolve a template from a SPECIFIC `.speccustom` path (used by the MCP
   * export's `coverPath` override). Returns null if it can't be read/parsed.
   */
  resolveTemplateFromPath(path: string): Promise<CoverActiveTemplate | null>;
  /**
   * Put the resolved custom cover on a finished body PDF. The body MUST
   * have been rendered with `reserveCoverPage: true`: its blank page 1
   * is replaced by the cover (Task 173), so pdfmake's own page numbers
   * - table of contents included - already count the cover.
   */
  applyCover(
    active: CoverActiveTemplate,
    bodyPdfBytes: Uint8Array,
    ctx: CoverExportContext,
  ): Promise<Uint8Array>;
  /**
   * Open the in-app cover editor (Glasshouse) for the project at this
   * `.moliospec` path. No-op in Community.
   *
   * Task 174: the engine lives as long as the window, and a window can
   * open several projects one after another. A cover picked in the
   * editor belongs to the project it was opened for, so the caller must
   * say which project that is - the same `data.path` the export passes
   * to `resolveActiveTemplate`.
   */
  openEditor(moliospecPath: string): void;
  /** Clear the active cover (back to disk resolution / standard cover). */
  clearTemplate(): void;
  /**
   * A short label for the in-session template picked for THIS project,
   * or null if none (Task 174: a pick made in another project is null).
   */
  activeTemplateLabelFor(moliospecPath: string): string | null;
}

const noCover: CoverEngine = {
  enabled: false,
  resolveActiveTemplate: async () => null,
  resolveTemplateFromPath: async () => null,
  applyCover: async (_active, bytes) => bytes,
  openEditor: () => {},
  clearTemplate: () => {},
  activeTemplateLabelFor: () => null,
};

const CoverContext = createContext<CoverEngine>(noCover);

/** Provider used by the Glasshouse-only engine module (3c-2). */
export const CoverProvider = CoverContext.Provider;

/** Read the injected cover engine. */
export function useCoverEngine(): CoverEngine {
  return useContext(CoverContext);
}
