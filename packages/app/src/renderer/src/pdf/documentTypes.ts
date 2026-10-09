/**
 * The document type printed on a PDF's built-in cover, on its own small
 * grey line ABOVE the title (Task 147, owner's decisions 2026-10-08).
 * Only the value is printed - no "Dokumenttype:" label.
 *
 * The value is always DERIVED from the file and from what an export
 * actually contains. The user changes a work area's type on the work
 * area itself ("Rediger arbejdsbeskrivelse"), never in the export
 * dialog.
 *
 * PDF text is always Danish (Task 183), so the strings live here and not
 * in the translation files.
 *
 * The same value is used for the "Type: ..." metadata line under the
 * title in spec PDFs, so the cover and the body never disagree.
 *
 * Pure, no imports: the export grouping (`exportGrouping.ts`) and all
 * four PDF builders use it.
 */

/**
 * Molio's own names for `work_spec.work_area_type`, spelled exactly as in
 * `packages/core/src/schema.ts` (CANONICAL_SEEDS.work_area_type). The
 * renderer may not import `@molio2-editor/core`, so they are copied here;
 * `test/pdfDocumentType.test.ts` fails if the two drift apart.
 */
export const WORK_AREA_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "Arbejdsbeskrivelse",
  1: "Fælles beskrivelse",
  2: "Paradigme for arbejdsbeskrivelse",
};

export const BDB_DOCUMENT_TYPE = "Bygningsdelsbeskrivelse";
export const CONTROL_PLAN_DOCUMENT_TYPE = "Kontrolplan";
export const VERSION_SUMMARY_DOCUMENT_TYPE = "Ændringsoversigt";

/**
 * A work area's own type. An unknown or missing value (not one of Molio's
 * three seeds) falls back to "Arbejdsbeskrivelse", the plain type - never
 * a number or an empty line.
 */
export function workAreaTypeLabel(
  workAreaType: number | null | undefined,
): string {
  return (
    (workAreaType != null ? WORK_AREA_TYPE_LABELS[workAreaType] : undefined) ??
    WORK_AREA_TYPE_LABELS[0]!
  );
}

/**
 * The same type in the app UI (Task 147 B2.2): i18n keys, because the UI
 * follows the app language, unlike the PDF. Same 0/1/2 mapping and the
 * same fallback to type 0 as `workAreaTypeLabel`. Owner's decision
 * 2026-10-09: the English catalogue also uses Molio's own Danish names.
 */
export const WORK_AREA_TYPE_UI_KEYS: Readonly<Record<number, string>> = {
  0: "workAreaType.arbejdsbeskrivelse",
  1: "workAreaType.faellesBeskrivelse",
  2: "workAreaType.paradigme",
};

/** i18n key for a work area's own type in the UI. */
export function workAreaTypeUiKey(
  workAreaType: number | null | undefined,
): string {
  return (
    (workAreaType != null ? WORK_AREA_TYPE_UI_KEYS[workAreaType] : undefined) ??
    WORK_AREA_TYPE_UI_KEYS[0]!
  );
}

/** Document type of a single spec PDF (work area or BDB). */
export function specDocumentType(
  kind: "workSpec" | "bdb",
  workAreaType: number | null | undefined,
): string {
  return kind === "bdb" ? BDB_DOCUMENT_TYPE : workAreaTypeLabel(workAreaType);
}

/** What a composite PDF is grouped by - one per composite export mode. */
export type CompositeScope = "workArea" | "contract" | "project";

/**
 * Document type of a composite PDF, from what it actually contains. The
 * table was approved by the owner 2026-10-08 (card 147):
 *
 * | Scope     | Contains        | Text                                                      |
 * |-----------|-----------------|-----------------------------------------------------------|
 * | workArea  | the WA only     | the WA's own type                                         |
 * | workArea  | WA + BDBs       | "<the WA's own type> med bygningsdelsbeskrivelser"         |
 * | contract  | WAs only        | Samlede arbejdsbeskrivelser for entreprisen               |
 * | contract  | WAs + BDBs      | Samlede arbejds- og bygningsdelsbeskrivelser for entreprisen |
 * | project   | WAs only        | Samlede arbejdsbeskrivelser for projektet                 |
 * | project   | WAs + BDBs      | Samlede arbejds- og bygningsdelsbeskrivelser for projektet |
 * | project   | BDBs only       | Samlede bygningsdelsbeskrivelser for projektet            |
 *
 * Control plans are never part of a composite, so no text names them.
 * At contract and project level the text does not try to reflect that
 * the work areas may have different types - "Samlede arbejdsbeskrivelser"
 * covers all three (owner, 2026-10-08).
 *
 * `workAreaType` is the type of the work area for the workArea scope and
 * ignored otherwise.
 */
export function compositeDocumentType(args: {
  scope: CompositeScope;
  hasWorkAreas: boolean;
  hasBdbs: boolean;
  workAreaType?: number | null;
}): string {
  const { scope, hasWorkAreas, hasBdbs } = args;
  if (scope === "workArea") {
    const own = workAreaTypeLabel(args.workAreaType);
    return hasBdbs ? `${own} med bygningsdelsbeskrivelser` : own;
  }
  const where = scope === "contract" ? "entreprisen" : "projektet";
  if (!hasWorkAreas) return `Samlede bygningsdelsbeskrivelser for ${where}`;
  return hasBdbs
    ? `Samlede arbejds- og bygningsdelsbeskrivelser for ${where}`
    : `Samlede arbejdsbeskrivelser for ${where}`;
}
