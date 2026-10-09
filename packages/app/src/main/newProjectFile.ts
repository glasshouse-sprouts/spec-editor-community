/**
 * Build a new project file from the bundled template (Task 159).
 *
 * "Start forfra" used to be a plain byte copy of `blank.moliospec`,
 * so every new project inherited the template's `project_guid`,
 * `created_date` and `created_by_system`. All new projects shared one
 * GUID, and anything keyed on it - the cover tool remembers the last
 * cover per project GUID - leaked from one project into the next.
 *
 * The order is fixed, and it is the point of this module:
 *
 *   1. open the template   (a temp copy; the template itself is never written)
 *   2. give it an identity (new GUID, today's date, this app's name)
 *   3. seed contracts      (the user's standard "fagentrepriser")
 *   4. save to the target  (ONE atomic write - H1)
 *
 * Identity comes before seeding because the project statements in core
 * find the row by its GUID. Everything is written in one go at the end,
 * so a crash leaves either no new file or a complete one - never a copy
 * of the template that still carries the shared GUID.
 *
 * No Electron imports, so it can be tested with plain vitest. The
 * caller passes the app's name and the save function (the IPC handler
 * passes `saveAsSelfWrite`, which brackets the write for the file
 * watcher).
 */

import {
  createContract,
  openMoliospec,
  stampNewProjectIdentity,
  type MoliospecHandle,
  type NewProjectIdentity,
} from "@molio2-editor/core";

import type { ContractDefaultRow } from "../shared/defaultsCsv.js";

export interface CreateNewProjectFileOptions {
  /** Goes into `created_by_system`. Pass `app.getName()`. */
  createdBySystem: string;
  /** Default contracts to seed. Seeding is best-effort, see below. */
  contracts: readonly ContractDefaultRow[];
  /** Writes the handle to `targetPath`. Must be atomic (H1). */
  save: (handle: MoliospecHandle, targetPath: string) => Promise<unknown>;
  /** Injectable for tests. */
  now?: Date;
  /** Called when seeding fails; the project is still created without them. */
  onSeedError?: (err: unknown) => void;
}

export async function createNewProjectFile(
  templatePath: string,
  targetPath: string,
  options: CreateNewProjectFileOptions,
): Promise<NewProjectIdentity> {
  const handle = await openMoliospec(templatePath);
  try {
    const identity = stampNewProjectIdentity(handle, {
      createdBySystem: options.createdBySystem,
      now: options.now,
    });

    // #250 - seed the standard contracts. Non-fatal, as before: an empty
    // project is still a valid project. One transaction, so a failure
    // halfway leaves no contracts rather than some of them.
    if (options.contracts.length > 0) {
      try {
        handle.db.transaction(() => {
          for (const row of options.contracts) {
            createContract(handle, {
              contractCode: row.code,
              contractName: row.name,
            });
          }
        })();
      } catch (err) {
        options.onSeedError?.(err);
      }
    }

    await options.save(handle, targetPath);
    return identity;
  } finally {
    await handle.close();
  }
}
