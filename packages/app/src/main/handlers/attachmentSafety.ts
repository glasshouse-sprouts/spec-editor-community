/**
 * Attachment open-safety allowlist (code-review punkt 5d).
 *
 * Threat model: a .moliospec can come from anyone, and its attachments'
 * bytes + names are fully attacker-controlled. "Open" writes the bytes to
 * a temp file and hands the path to the OS default handler
 * (`shell.openPath`). A malicious file can therefore carry:
 *   - `report.command` / `.bat` / `.sh` — runs code on a double-click,
 *   - `invoice.html` — local phishing rendered as a trusted local file,
 *   - `.svg` — scriptable XML.
 *
 * We use an ALLOWLIST (deny by default): only well-known document, image
 * and office types open automatically. Anything else — including unknown
 * or missing extensions — is blocked, and the user is warned instead.
 *
 * Pure module: no Electron imports, so it's unit-testable on its own.
 */

/** Extensions (lower-case, no dot) we consider safe to auto-open. */
export const SAFE_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // Documents
  "pdf",
  "txt",
  "csv",
  "md",
  "rtf",
  // Images (note: SVG is intentionally excluded — it's scriptable XML)
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  // Office
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
]);

/**
 * Lower-cased extension (without the dot) of a filename, or null when the
 * name has no extension. A trailing dot or a leading-dot-only name (e.g.
 * ".bashrc") counts as "no usable extension" → blocked.
 */
export function attachmentExtension(name: string): string | null {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  // No dot, dot is the first char, or dot is the last char → no extension.
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return trimmed.slice(dot + 1).toLowerCase();
}

/**
 * True if the attachment is safe to open automatically with the OS
 * default handler. Deny-by-default: unknown or missing extensions return
 * false so the caller blocks the open and warns the user.
 */
export function isSafeToOpenAttachment(name: string): boolean {
  const ext = attachmentExtension(name);
  return ext !== null && SAFE_ATTACHMENT_EXTENSIONS.has(ext);
}
