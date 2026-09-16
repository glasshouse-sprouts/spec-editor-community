/**
 * Renderer-safe parser + types for the `[MOLIO_ERR:CODE]` sentinel
 * `packages/core` puts in error messages.
 *
 * Why this is here and not in `@molio2-editor/core`
 * =================================================
 * The renderer ships as a browser bundle. Importing anything from
 * `@molio2-editor/core` drags in Node-only deps (`better-sqlite3`,
 * `node:fs`, …) and breaks the build (#234 — see
 * `test/rendererCoreImportBan.test.ts`). The canonical encode/decode
 * lives in `packages/core/src/errors.ts`; this file is a renderer-safe
 * copy of just the *parse* half.
 *
 * The two sides must agree on the sentinel format. The integration
 * test in `test/friendlyError.test.ts` constructs a real `CoreError`
 * and round-trips it through this parser — any drift fails CI loudly.
 */

/**
 * Stable identifiers for every error `packages/core` throws. Mirror
 * of the `CoreErrorCode` union in `packages/core/src/errors.ts`. Add
 * to both when introducing a new code.
 */
export type CoreErrorCode =
  | "PFBB_NAME_EMPTY"
  | "PFBB_DUPLICATE_NAME"
  | "PFBB_INVALID_TARGET"
  | "CP_SLOT_OCCUPIED"
  | "CONTRACT_HAS_REFERENCES"
  | "IMPORT_BDB_OVERWRITE_UNSUPPORTED"
  | "IMPORT_TARGET_CONTRACT_MISSING"
  | "IMPORT_TARGET_WORK_AREA_MISSING"
  | "WORKSPEC_NOT_FOUND"
  | "WORKSPEC_NAME_EMPTY"
  | "WORKSPEC_INVALID_TYPE"
  | "BDB_NAME_EMPTY"
  | "BDB_DUPLICATE_NAME"
  | "FILL_TARGET_NOT_EMPTY"
  | "FILL_SOURCE_EMPTY"
  | "IO_NOT_MOLIOSPEC"
  | "IO_NOT_SQLITE"
  | "IO_DECOMPRESS_TOO_LARGE"
  | "IO_INTEGRITY_CHECK_FAILED"
  | "IO_WAL_CHECKPOINT_FAILED"
  | "IO_MIGRATION_FAILED"
  | "IO_LEGACY_FILE_READ_ONLY"
  | "INTERNAL";

export type CoreErrorParamValue = string | number | boolean;
export type CoreErrorParams = Record<string, CoreErrorParamValue>;

const SENTINEL = "MOLIO_ERR";

/**
 * Parse a `CoreError`-encoded message back into its code + params.
 * Returns null when the sentinel isn't present (regular Error, native
 * fs error, etc.). Tolerates the Electron IPC wrapper that prefixes
 * messages with `Error invoking remote method '...':` — the regex
 * just looks for the sentinel anywhere in the string.
 */
export function parseCoreErrorMessage(
  message: string,
): { code: CoreErrorCode; params: CoreErrorParams } | null {
  const match = message.match(
    new RegExp(`\\[${SENTINEL}:([A-Z_]+)(?::((?:\\\\.|[^\\]])*))?\\]`),
  );
  if (!match) return null;
  const code = match[1] as CoreErrorCode;
  const params: CoreErrorParams = {};
  if (match[2]) {
    for (const pair of splitEscaped(match[2], ",")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const k = pair.slice(0, eq);
      const v = unescapeValue(pair.slice(eq + 1));
      const asNum = Number(v);
      if (v !== "" && !Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(v)) {
        params[k] = asNum;
      } else if (v === "true" || v === "false") {
        params[k] = v === "true";
      } else {
        params[k] = v;
      }
    }
  }
  return { code, params };
}

function splitEscaped(input: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      buf += input[i + 1];
      i += 1;
      continue;
    }
    if (ch === sep) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function unescapeValue(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "\\" && i + 1 < input.length) {
      out += input[i + 1];
      i += 1;
      continue;
    }
    out += input[i]!;
  }
  return out;
}
