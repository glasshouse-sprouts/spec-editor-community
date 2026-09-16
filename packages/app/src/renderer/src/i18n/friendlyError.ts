/**
 * Translate a raw caught error into user-friendly copy.
 *
 * Three sources of error reach the renderer's catch blocks:
 *
 * 1. `CoreError` thrown by `packages/core` — the message carries a
 *    `[MOLIO_ERR:CODE:k=v]` sentinel. We map the code to an
 *    `errors.code.<CODE>` translation, with the encoded params as
 *    placeholders.
 *
 * 2. Native fs / SQLite errors — the OS / SQLite library sets a `.code`
 *    property like `EACCES`, `ENOENT`, `SQLITE_BUSY`. Where Electron
 *    preserves that property across IPC, we look up
 *    `errors.system.<code>`. When it doesn't (the renderer-side catch
 *    wraps the error before we can read `.code`), the error.message
 *    typically contains the code as a leading token (`"EACCES: …"`),
 *    and we fall back to scanning the message text for a known errno.
 *
 * 3. Anything else (plain `Error`, thrown strings) — falls through to
 *    a generic "Unexpected error" envelope so the user at least gets
 *    a localised phrasing instead of raw English exception text.
 *
 * The fallback chain is designed so the user always sees translated
 * text: even unmapped errors get wrapped in the localised
 * `errors.unexpected` envelope, with the original message tucked into
 * `{message}` for context.
 */

import {
  parseCoreErrorMessage,
  type CoreErrorCode,
} from "../../../shared/coreErrors.js";

import { t } from "./i18n.js";

/** Errno codes we have friendly copy for under `errors.system.<code>`. */
const KNOWN_SYSTEM_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOENT",
  "EBUSY",
  "ENOSPC",
  "SQLITE_BUSY",
]);

/**
 * Pull a system errno code (`EACCES`, `SQLITE_BUSY`, …) off the error,
 * or null if no recognised code is present. Tries `.code` first
 * (preserved by some IPC paths), then scans `err.message` for the
 * leading-token form Node's fs errors use.
 */
function detectSystemCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string" && KNOWN_SYSTEM_CODES.has(c)) return c;
  }
  if (err instanceof Error) {
    // Node fs errors look like: "EACCES: permission denied, open '/path'"
    // SQLite errors look like:  "SQLITE_BUSY: database is locked"
    const m = err.message.match(/\b(SQLITE_[A-Z]+|E[A-Z]+)\b/);
    if (m && KNOWN_SYSTEM_CODES.has(m[1]!)) return m[1]!;
  }
  return null;
}

/**
 * Strip the `[MOLIO_ERR:...]` sentinel from a CoreError message and
 * return just the trailing human-readable tail. Useful when surfacing
 * a `{debug}` placeholder so the user doesn't see machine-readable
 * brackets.
 */
function stripSentinel(message: string): string {
  return message.replace(/\[MOLIO_ERR:[A-Z_]+(?::[^\]]*)?\]\s*/, "").trim();
}

/**
 * Render a user-friendly translated string for an arbitrary caught
 * error. `fallbackPrefix` is the action-context translation to use
 * when we can't classify the error any better than "unexpected"
 * (e.g. "Saving the file failed"). The full envelope reads
 * `<prefix>: <translated message>`.
 */
export function friendlyError(err: unknown, fallbackPrefix: string): string {
  const message = err instanceof Error ? err.message : String(err);

  // 1. CoreError-encoded sentinel — the canonical happy path.
  const parsed = parseCoreErrorMessage(message);
  if (parsed) {
    const code: CoreErrorCode = parsed.code;
    const debug = stripSentinel(message) || message;
    const tParams: Record<string, string | number> = { debug };
    for (const [k, v] of Object.entries(parsed.params)) {
      tParams[k] = typeof v === "boolean" ? String(v) : v;
    }
    return t(`errors.code.${code}`, tParams);
  }

  // 2. Known system errno — map to friendly system copy.
  const sys = detectSystemCode(err);
  if (sys) {
    return t(`errors.system.${sys}`);
  }

  // 3. Anything else — generic envelope. Caller's prefix carries the
  //    action context, our `{message}` slot keeps the raw text in
  //    case the user needs to share it for support.
  return `${fallbackPrefix}: ${t("errors.unexpected", { message })}`;
}

/**
 * Convenience for catch blocks that previously stored
 * `{ kind: "other"; message: string }` shapes — returns just the
 * `message` field, already translated. Lets us keep the existing
 * dialog state shape unchanged while delivering friendly copy.
 *
 * `prefix` is the same `otherPrefix` already used by `<DialogError>`.
 * For `kind: "other"` the renderer concatenates `${prefix}: ${message}`,
 * so we strip our own envelope to avoid double-prefixing.
 */
export function friendlyErrorForDialog(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const parsed = parseCoreErrorMessage(message);
  if (parsed) {
    const debug = stripSentinel(message) || message;
    const tParams: Record<string, string | number> = { debug };
    for (const [k, v] of Object.entries(parsed.params)) {
      tParams[k] = typeof v === "boolean" ? String(v) : v;
    }
    return t(`errors.code.${parsed.code}`, tParams);
  }
  const sys = detectSystemCode(err);
  if (sys) return t(`errors.system.${sys}`);
  // Plain message — let DialogError's prefix carry the context.
  return message;
}
