/**
 * Open a file that is about to be modified and written back over
 * itself, refusing if it is in a pre-01.00.03 format (Task 1 / M1).
 *
 * Why every in-place write has to come through here
 * =================================================
 * Converting an old file to the current schema is irreversible, and
 * the file on disk is the user's only copy of the old format. So a
 * converted file has to become a NEW file — which only "Save as" does.
 * The editor's Save routes there. The other write handlers (contracts,
 * building element specifications, attachments, imports) have no such
 * route, so they refuse and tell the user to save the file once first.
 *
 * Two details that are easy to get wrong, and were:
 *
 *   - The check belongs at OPEN, not at save. On an old file the write
 *     code frequently throws while merely *preparing* its statements —
 *     the missing `contracts` table is the whole reason this task
 *     exists — so a guard at the save is never reached and the user
 *     gets a raw SQLite message instead of an explanation.
 *
 *   - "Every write handler shares one helper" was not true. Eight
 *     in-place writes bypassed `withHandleForWrite` and called
 *     `openMoliospec` directly. Hence this being its own module: it is
 *     the thing to reach for, and it has no dependency on the window
 *     or the file watcher, so it can be tested on its own.
 */

import { CoreError, openMoliospec, planMigration } from "@molio2-editor/core";

/**
 * Open `path` for a write that will land back on the same path.
 *
 * Throws a coded `IO_LEGACY_FILE_READ_ONLY` for a file the app must
 * not convert in place; the renderer turns that into Danish/English
 * copy naming both versions. The handle is closed before throwing, so
 * a refusal leaves no temp directory behind.
 */
export async function openForInPlaceWrite(
  path: string,
): Promise<Awaited<ReturnType<typeof openMoliospec>>> {
  const handle = await openMoliospec(path);
  const plan = planMigration(handle);
  if (!plan.needed) return handle;
  await handle.close();
  throw new CoreError(
    "IO_LEGACY_FILE_READ_ONLY",
    { fromVersion: plan.fromVersion, toVersion: plan.toVersion },
    `openForInPlaceWrite: refusing to write to a ${plan.fromVersion} ` +
      `file in place: ${path}`,
  );
}
