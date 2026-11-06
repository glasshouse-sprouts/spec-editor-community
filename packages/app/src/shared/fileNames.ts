/**
 * The one rule for which characters a file name may not contain
 * (Task 106).
 *
 * The renderer uses it to clean up a name it builds from a title; main
 * uses it to refuse a name that was not cleaned up, whoever sent it.
 * Before, the rule lived only in the renderer
 * (`renderer/src/exportGrouping.ts`), and main wrote whatever file
 * base arrived over IPC - including one with `../` in it.
 *
 * Windows is the strictest target: `< > : " / \ | ? *` and the control
 * characters are not allowed there. The slashes are also what turns a
 * name into a path, and NUL ends a path early in some APIs.
 *
 * Lives in shared/ because both processes import it; it must stay free
 * of Node and DOM APIs.
 */

/** Characters no file name may contain. */
export const FORBIDDEN_FILE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

/**
 * Make `s` safe as one file-name component: forbidden characters become
 * "_", and typographic dashes become "-" so names stay plain ASCII
 * where the title used an en or em dash.
 */
export function sanitiseFilePart(s: string): string {
  return s
    .replace(new RegExp(FORBIDDEN_FILE_NAME_CHARS.source, "g"), "_")
    .replace(/[‒–—―−]/g, "-");
}

/**
 * Is `base` safe to join onto a folder as a file name (before the
 * extension is added)? False for anything that is not a non-empty
 * string, contains a forbidden character, or is "." or "..". With no
 * slashes allowed, those two are the only names that point outside
 * the folder.
 */
export function isSafeFileBase(base: unknown): base is string {
  if (typeof base !== "string") return false;
  if (base.trim() === "" || base === "." || base === "..") return false;
  return !FORBIDDEN_FILE_NAME_CHARS.test(base);
}
