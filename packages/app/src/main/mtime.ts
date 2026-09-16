/**
 * One tiny helper, in its own module on purpose.
 *
 * `safeMtimeMs` is needed both by the IPC handlers (`handlers/shared.ts`)
 * and by the file watcher (`fileWatcher.ts`). Since the handlers now also
 * call into the watcher for the self-write protocol, keeping the helper
 * in either of those two files would create an import cycle between them.
 * It lives here instead, so both can import it without importing each
 * other's world.
 */

import { stat } from "node:fs/promises";

/**
 * Read the mtime of a file as milliseconds-since-epoch. Returns null
 * if the file is missing or stat throws — the renderer treats that as
 * a "missing" save result.
 */
export async function safeMtimeMs(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.mtimeMs;
  } catch {
    return null;
  }
}
