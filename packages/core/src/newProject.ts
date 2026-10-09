/**
 * Give a freshly created `.moliospec` its own identity (Task 159).
 *
 * Why this is not in `write.ts`
 * =============================
 * `applyEdits` in `write.ts` EDITS an existing project, and every one
 * of its project statements finds the row by `where project_guid = ?`.
 * This does something else: it gives a newborn file its identity,
 * exactly once, and CHANGES the very key those statements look the row
 * up by. Putting it into the edit batch would let one edit pull the
 * key out from under the next. So it lives here, as its own function,
 * with one caller: creating a new project.
 *
 * It lives in core rather than in the app so it can be tested without
 * Electron, and so the MCP server can use it if it ever creates files.
 *
 * Order matters for the caller
 * ============================
 * Call this BEFORE anything else is written to the new file. Nothing
 * else in the schema references `project_guid` today, but the project
 * statements in `applyEdits` do, and a new file must never carry the
 * template's key for even one write.
 *
 *   copy the template -> stampNewProjectIdentity -> seed -> save -> open
 *
 * What it does NOT do
 * ===================
 * It never runs on a file the user opened. Existing files keep their
 * GUID, even when it is the shared template GUID (decision a on the
 * card, 2026-09-24): changing an identity the user did not ask to
 * change is not a harmless act, and there is no way to tell which of
 * two files sharing a GUID is "the real one".
 */

import { randomUUID } from "node:crypto";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";

export interface NewProjectIdentityOptions {
  /**
   * What goes into `created_by_system`: the app's own name, so the
   * field follows the edition ("bskriver" / "Spec Editor Community").
   * Required and non-empty - the column is NOT NULL, and an empty
   * value would say nothing.
   */
  createdBySystem: string;
  /** Creation time. Defaults to now. Injectable for tests. */
  now?: Date;
  /** The new GUID. Defaults to a random UUID v4. Injectable for tests. */
  projectGuid?: string;
}

export interface NewProjectIdentity {
  projectGuid: string;
  /** ISO 8601 in UTC with milliseconds, the same shape `modified_date` uses. */
  createdDate: string;
  createdBySystem: string;
}

/**
 * Replace the template's `project_guid`, `created_date` and
 * `created_by_system` with values that belong to this file.
 *
 * Runs in one transaction on the handle's temp database; nothing
 * reaches disk until the caller's `saveAs`. Throws if the file does
 * not hold exactly one project row - a template that breaks that has
 * no single identity to replace, and guessing would be worse than
 * stopping.
 */
export function stampNewProjectIdentity(
  handle: MoliospecHandle,
  options: NewProjectIdentityOptions,
): NewProjectIdentity {
  const createdBySystem = options.createdBySystem.trim();
  if (createdBySystem === "") {
    throw new CoreError(
      "INTERNAL",
      {},
      "stampNewProjectIdentity: createdBySystem is empty",
    );
  }
  const projectGuid = options.projectGuid ?? randomUUID();
  if (projectGuid.length !== 36) {
    throw new CoreError(
      "INTERNAL",
      {},
      `stampNewProjectIdentity: not a 36-character GUID: ${projectGuid}`,
    );
  }
  const createdDate = (options.now ?? new Date()).toISOString();

  const db = handle.db;
  const rows = db.prepare("select project_guid from project").all() as {
    project_guid: string;
  }[];
  if (rows.length !== 1) {
    throw new CoreError(
      "INTERNAL",
      {},
      `stampNewProjectIdentity: expected exactly one project row, found ${rows.length}`,
    );
  }
  const oldGuid = rows[0]!.project_guid;

  db.transaction(() => {
    const info = db
      .prepare(
        "update project set project_guid = ?, created_date = ?, " +
          "created_by_system = ? where project_guid = ?",
      )
      .run(projectGuid, createdDate, createdBySystem, oldGuid);
    if (info.changes !== 1) {
      throw new CoreError(
        "INTERNAL",
        {},
        `stampNewProjectIdentity: updated ${info.changes} rows, expected 1`,
      );
    }
  })();

  return { projectGuid, createdDate, createdBySystem };
}
