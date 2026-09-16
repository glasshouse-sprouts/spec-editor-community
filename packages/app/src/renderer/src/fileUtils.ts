/**
 * Small file-name utilities used by the renderer.
 */

/**
 * True when `name` looks like a Molio 2 spec filename.
 *
 * Accepts any `*.moliospec` regardless of case — macOS and Windows treat
 * filename extensions case-insensitively, so `Foo.MOLIOSPEC` and
 * `foo.moliospec` should both be opened.
 */
export function isMoliospecFile(name: string): boolean {
  return name.toLowerCase().endsWith(".moliospec");
}

/**
 * Filename from a full path — cheap basename() that handles both `/`
 * and `\` separators so it works for Windows and POSIX paths without
 * caring which OS the renderer is running on.
 *
 * Returns the input unchanged when no separator is present.
 */
export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * The filename to suggest when saving an upgraded old file (Task 1 / M1).
 *
 * Molio's older samples are often plain `.sqlite`, but what we write out
 * is a gzipped 01.00.04 `.moliospec`, so the extension is swapped. The
 * stem is left alone - it is the user's name for their project, and
 * renaming it for them would be presumptuous.
 *
 * Any other extension (or none) is replaced too; the point is that the
 * result is a `.moliospec`.
 */
export function suggestUpgradedName(path: string): string {
  const name = basename(path);
  if (isMoliospecFile(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.moliospec`;
}
