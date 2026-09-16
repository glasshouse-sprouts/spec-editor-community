/**
 * Shared error vocabulary for the renderer's "CP op" style dialogs —
 * the immediate-persistence flows that write to disk and reload the
 * file (CP creation, contracts, attachments, structural ops). Pulled
 * out of App.tsx in slice #233 Session 2 so the per-dialog hooks can
 * import from one place instead of redeclaring or threading the type
 * through props.
 *
 * The shape is intentionally narrow:
 *   - "dirty"    — refused because the edit map is non-empty.
 *   - "conflict" — IPC reported the file changed under us.
 *   - "missing"  — IPC reported the target row is gone.
 *   - "other"    — anything else, with a human-readable message.
 *
 * Specialised dialogs (e.g. Add attachment) widen this with extra
 * variants like "too-large" or "duplicate" inline at the dialog state
 * type — they don't belong in this shared union.
 */
export type CpOpDialogError =
  | { kind: "dirty" }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "other"; message: string };

/**
 * Map an IPC conflict/missing result into our dialog error shape.
 * Tiny, but having one helper keeps the call sites identical and
 * makes a future "richer error" pass a one-file change.
 */
export function classifyCpOpError(result: {
  kind: "conflict" | "missing";
}): CpOpDialogError {
  return result.kind === "conflict"
    ? { kind: "conflict" }
    : { kind: "missing" };
}
