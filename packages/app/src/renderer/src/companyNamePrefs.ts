/**
 * The company name app setting (Task 185, owner's decision 2026-10-08).
 *
 * One value for every project, set in Settings ("Firmanavn"), in both
 * bskriver and Community. It is printed in the PDF footer and at the foot
 * of the built-in cover. In bskriver, a custom cover's "Firmanavn" field
 * prints this value too (Task 190, owner's decision 2026-11-03); the
 * cover template has no company name of its own. An empty field gives an
 * empty footer cell - never a placeholder (Task 183).
 *
 * Stored like the UI language (`molio.locale` in i18n.ts): through
 * `prefStore()`, which in the app writes `preferences.json` under the
 * app's userData folder, so the value survives a restart. Same
 * KeyValueStore shape as the other pref modules, so tests can pass a
 * Map-backed store.
 *
 * If Molio later adds a company field to the .moliospec file, the source
 * can move there; the export reads it through `companyNameForPdf` only.
 */

export const COMPANY_NAME_KEY = "molio.companyName";

/** Minimal subset of the Storage interface we need. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The value as the user typed it, for the Settings field. "" when unset. */
export function readCompanyName(store: KeyValueStore): string {
  try {
    return store.getItem(COMPANY_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Persist the field's value as typed (the input must not jump while the
 * user types). Storage errors are swallowed - losing the preference is
 * not worth crashing over.
 */
export function writeCompanyName(store: KeyValueStore, value: string): void {
  try {
    store.setItem(COMPANY_NAME_KEY, value);
  } catch {
    /* ignore */
  }
}

/**
 * The company name for a PDF: trimmed, or null when the field is empty or
 * only whitespace, so the builders print an empty cell.
 */
export function companyNameForPdf(store: KeyValueStore): string | null {
  const v = readCompanyName(store).trim();
  return v === "" ? null : v;
}
