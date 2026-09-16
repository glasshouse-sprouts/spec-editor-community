/**
 * Shared dialog-error type + render component.
 *
 * Slice #233 DRY pass — the renderer had eleven re-declarations of
 *
 *   { kind: "dirty" | "conflict" | "missing" | "other"; message: string }
 *
 * one in each dialog state slot, plus ten near-identical 8-line
 * `<div className="modal__error">` switch blocks in the modal files.
 * This file consolidates the type, the canonical copy for each
 * `kind`, and the rendering into one place.
 *
 * Variants (e.g. `too-large` and `duplicate` on the attachments
 * modal, `target-missing` on the import modal) compose via
 * `DialogErrorOf<E>` and the `extra` render slot.
 */

import type { ReactNode } from "react";

import { useT } from "../i18n/i18n.js";

/**
 * Standard four-kind union used by every IPC-driven dialog. Shared
 * across cp / contract / attachment / structural / metadata modals.
 */
export type IpcDialogError =
  | { kind: "dirty" }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "other"; message: string };

/**
 * Compose the standard four kinds with extra dialog-specific shapes.
 *   AttachmentsDialogError = DialogErrorOf<TooLargeError | DuplicateError>;
 *   ImportDialogError       = DialogErrorOf<{ kind: "target-missing" } | …>;
 */
export type DialogErrorOf<E = never> = IpcDialogError | E;

/**
 * Map a `{ kind: "conflict" | "missing" }` IPC result to the
 * matching `IpcDialogError` shape. Used by every confirm callback
 * that shells out to a save-pipeline IPC.
 */
export function classifyConflictMissing(r: {
  kind: "conflict" | "missing";
}): IpcDialogError {
  return r.kind === "conflict" ? { kind: "conflict" } : { kind: "missing" };
}

/**
 * Default copy for the three canonical IPC error kinds. Resolved via
 * `t()` so locale changes take effect on re-render. Keys live in
 * `errors.{dirty,conflict,missing}.full`. Callers can still override
 * any kind via the `copy` prop for dialog-specific phrasings.
 */
function getDefaultCopy(t: (key: string) => string): {
  dirty: string;
  conflict: string;
  missing: string;
} {
  return {
    dirty: t("errors.dirty.full"),
    conflict: t("errors.conflict.full"),
    missing: t("errors.missing.full"),
  };
}

interface Props<E extends { kind: string } = IpcDialogError> {
  error: E | null;
  /**
   * Prefix for the `"other"` branch — `"Delete failed"` renders as
   *   `"Delete failed: <message>"`
   * Pass a function for fully-dynamic prefixes (e.g.
   *   `(msg) => isDuplicate ? "Duplicating failed: …" : "Creating failed: …"`).
   */
  otherPrefix: string | ((message: string) => string);
  /**
   * Optional per-kind copy override. `missing` is the most common
   * one to override (e.g. attachment dialogs talk about a "target
   * work area" rather than "the file").
   */
  copy?: Partial<Record<"dirty" | "conflict" | "missing", string>>;
  /**
   * Optional render slot for non-standard error kinds (e.g.
   * `too-large`, `duplicate`, `target-missing`). Return null to
   * fall through to the default rendering for `IpcDialogError`
   * kinds, or a ReactNode to render custom copy.
   */
  extra?: (error: E) => ReactNode | null;
}

/**
 * Renders the standard `<div className="modal__error">` block for
 * an IPC dialog error. Returns null when there's no error.
 */
export function DialogError<E extends { kind: string } = IpcDialogError>({
  error,
  otherPrefix,
  copy,
  extra,
}: Props<E>): JSX.Element | null {
  const t = useT();
  const DEFAULT_COPY = getDefaultCopy(t);
  if (!error) return null;
  // Give the caller's `extra` slot first crack so it can handle
  // non-standard kinds before we try the canonical mapping.
  if (extra) {
    const extraNode = extra(error);
    if (extraNode != null && extraNode !== false) {
      return (
        <div className="modal__error" role="alert" aria-live="polite">
          {extraNode}
        </div>
      );
    }
  }
  let text: string | null = null;
  if (error.kind === "dirty") text = copy?.dirty ?? DEFAULT_COPY.dirty;
  else if (error.kind === "conflict")
    text = copy?.conflict ?? DEFAULT_COPY.conflict;
  else if (error.kind === "missing")
    text = copy?.missing ?? DEFAULT_COPY.missing;
  else if (error.kind === "other") {
    const msg = (error as unknown as { message: string }).message;
    text =
      typeof otherPrefix === "string"
        ? `${otherPrefix}: ${msg}`
        : otherPrefix(msg);
  }
  if (text == null) return null;
  return (
    <div className="modal__error" role="alert" aria-live="polite">
      {text}
    </div>
  );
}
