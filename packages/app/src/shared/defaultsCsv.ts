/**
 * Pure parsers for the two user-editable default CSVs (#250):
 *
 *   - `contracts.csv`            -> default contracts (code,name) seeded
 *                                   into a new project.
 *   - `contract-workarea-map.csv` -> Molio-work-area-code -> contract-code
 *                                   mapping, used to pre-select the landing
 *                                   contract at import.
 *
 * Both are hand-editable by the user, so the parsers are forgiving:
 *   - lines starting with `#` are comments and skipped;
 *   - blank lines are skipped;
 *   - a leading header row (first cell "code" / "molio_workarea_code") is
 *     skipped;
 *   - malformed rows (missing a required field) are skipped and reported
 *     in `skipped` rather than throwing;
 *   - duplicate keys keep the FIRST occurrence; later ones are reported.
 *
 * No I/O, no Node APIs — safe to import from both main and renderer.
 */

export interface ContractDefaultRow {
  code: string;
  name: string;
}

export interface WorkAreaContractMapRow {
  workAreaCode: string;
  contractCode: string;
}

export interface CsvParseResult<T> {
  rows: T[];
  /** Human-readable reasons rows were dropped (for a non-blocking notice). */
  skipped: string[];
}

/** Split into trimmed, non-comment, non-blank lines. */
function dataLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Split one CSV line into cells. Simple comma split (no quoted commas). */
function cells(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

/**
 * Parse the default-contracts CSV. Columns: `code,name`. A contract name
 * may itself contain commas (everything after the first comma is the
 * name), so e.g. `E09,SANERING, NEDRIVNING` keeps the full name.
 */
export function parseContractsCsv(
  text: string,
): CsvParseResult<ContractDefaultRow> {
  const rows: ContractDefaultRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of dataLines(text)) {
    const firstComma = line.indexOf(",");
    const code = (firstComma === -1 ? line : line.slice(0, firstComma)).trim();
    const name = firstComma === -1 ? "" : line.slice(firstComma + 1).trim();
    if (code.toLowerCase() === "code") continue; // header row
    if (!code) {
      skipped.push(`Missing contract code: "${line}"`);
      continue;
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      skipped.push(`Duplicate contract code skipped: "${code}"`);
      continue;
    }
    seen.add(key);
    rows.push({ code, name });
  }
  return { rows, skipped };
}

/**
 * Parse the work-area -> contract mapping CSV. Columns:
 * `molio_workarea_code,contract_code[,note]`. Extra columns (a human
 * note) are ignored.
 */
export function parseWorkAreaMapCsv(
  text: string,
): CsvParseResult<WorkAreaContractMapRow> {
  const rows: WorkAreaContractMapRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of dataLines(text)) {
    const parts = cells(line);
    const workAreaCode = parts[0] ?? "";
    const contractCode = parts[1] ?? "";
    if (workAreaCode.toLowerCase() === "molio_workarea_code") continue; // header
    if (!workAreaCode || !contractCode) {
      skipped.push(`Incomplete mapping row skipped: "${line}"`);
      continue;
    }
    const key = workAreaCode.toLowerCase();
    if (seen.has(key)) {
      skipped.push(`Duplicate work-area code skipped: "${workAreaCode}"`);
      continue;
    }
    seen.add(key);
    rows.push({ workAreaCode, contractCode });
  }
  return { rows, skipped };
}
