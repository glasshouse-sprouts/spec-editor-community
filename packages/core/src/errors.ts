/**
 * Coded core errors that survive the Electron IPC boundary.
 *
 * Why this exists
 * ===============
 * The renderer's i18n layer needs a stable identifier for every error
 * the core can throw, so it can map raw exception strings to friendly
 * Danish/English copy. We can't pass `.code` as a custom property
 * because Electron's `ipcRenderer.invoke` re-serialises Errors and
 * strips non-standard fields. So instead we encode the code into
 * `Error.message` itself, with a small machine-readable sentinel:
 *
 *     [MOLIO_ERR:PFBB_NAME_EMPTY] createPfbbChild: name is empty
 *     [MOLIO_ERR:PFBB_DUPLICATE_NAME:name=Foo,workSpecId=42] BDB named "Foo"…
 *
 * The sentinel is matched by `parseCoreErrorMessage()` on the renderer
 * side. The trailing free-form text after the bracket is the dev-facing
 * breadcrumb — it stays in console logs but never reaches the UI.
 *
 * Adding a new code
 * =================
 * 1. Add it to the `CoreErrorCode` union below.
 * 2. Add `errors.<CODE>` keys in both messages.da.json and
 *    messages.en.json (with `{paramName}` placeholders if needed).
 * 3. Throw it: `throw new CoreError("YOUR_CODE", { id: 42 }, "debug…")`.
 *
 * `INTERNAL` is the catch-all for engineering invariants the user
 * should never see ("no such X with id=Y" guards). The renderer renders
 * a generic "please report this" message; the dev-facing message
 * survives in the console so we can debug.
 */

/**
 * Stable identifiers for every error the core throws. Keep this list
 * narrow — most "no such id" guards collapse into `INTERNAL`. Only
 * promote a code to its own entry when the renderer needs to show
 * different copy for it.
 */
export type CoreErrorCode =
  // --- User-facing (specific copy) ---
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
  // --- Engineering invariants (generic copy) ---
  | "INTERNAL";

/** Allowed param value types — anything that survives JSON.stringify. */
export type CoreErrorParamValue = string | number | boolean;
export type CoreErrorParams = Record<string, CoreErrorParamValue>;

const SENTINEL = "MOLIO_ERR";

/**
 * Custom error type thrown from `packages/core`. Subclasses Error so
 * existing `instanceof Error` checks keep working; the IPC boundary
 * preserves `.message` (which carries the code) but not `.code`/`.params`,
 * so callers must use `parseCoreErrorMessage()` post-IPC rather than
 * `instanceof CoreError`.
 */
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly params: CoreErrorParams;

  constructor(code: CoreErrorCode, params: CoreErrorParams = {}, debug = "") {
    super(encodeMessage(code, params, debug));
    this.name = "CoreError";
    this.code = code;
    this.params = params;
  }
}

function encodeParams(params: CoreErrorParams): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      // Escape commas and `]` inside string values so the parser can
      // reliably split. Numbers/booleans stringify cleanly.
      const raw = String(v);
      const escaped = raw
        .replace(/\\/g, "\\\\")
        .replace(/,/g, "\\,")
        .replace(/]/g, "\\]");
      return `${k}=${escaped}`;
    })
    .join(",");
}

function encodeMessage(
  code: CoreErrorCode,
  params: CoreErrorParams,
  debug: string,
): string {
  const paramSegment = encodeParams(params);
  const head = paramSegment
    ? `[${SENTINEL}:${code}:${paramSegment}]`
    : `[${SENTINEL}:${code}]`;
  return debug ? `${head} ${debug}` : head;
}

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
  // Match `[MOLIO_ERR:CODE]` or `[MOLIO_ERR:CODE:k=v,...]`.
  // Inside the params segment, escaped `\,` and `\]` are allowed.
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
      // Coerce numerics back to numbers so `{count}` formatters work.
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
