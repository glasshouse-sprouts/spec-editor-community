/**
 * Contract write operations: create + delete.
 *
 * `deleteContract` refuses to delete when work specs reference the
 * contract — it throws a typed error listing the referrers so the
 * caller can guide the user to reassign or pick a different
 * contract first.
 *
 * Both functions lazily upgrade the schema: older Molio files
 * (01.00.03 and below) didn't ship with a `contracts` table.
 * `ensureContractsTable` (re-exported from `write.ts`) is called
 * before any insert/delete so users can start using contracts
 * without a manual schema migration.
 *
 * Extracted from `write.ts` in slice #233-followup.
 */

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";

import { ensureContractsTable } from "./write.js";

/* ------------------------------------------------------------------ */
/*  Contracts (Slice 6I)                                               */
/* ------------------------------------------------------------------ */

export interface CreateContractArgs {
  /** Display code (e.g. "K-01"). Optional — contracts can be unnamed. */
  contractCode?: string | null;
  /** Display name. Optional. */
  contractName?: string | null;
}

export interface CreateContractResult {
  /** The new contract's id. */
  contractId: number;
}

/**
 * Create a new contract row. If the file was opened from an older
 * schema version that didn't include the `contracts` table, it's
 * created on the fly — matches the read-side behaviour where a
 * missing table is treated as "just empty, not an error".
 *
 * Both fields are nullable in the schema. Callers can pass `null`
 * (or omit) for "not set"; empty strings are stored as-is.
 */
export function createContract(
  handle: MoliospecHandle,
  args: CreateContractArgs = {},
): CreateContractResult {
  const db = handle.db;
  ensureContractsTable(db);
  const code = args.contractCode ?? null;
  const name = args.contractName ?? null;
  const info = db
    .prepare(
      "insert into contracts (contract_code, contract_name) values (?, ?)",
    )
    .run(code, name);
  return { contractId: Number(info.lastInsertRowid) };
}

/**
 * Delete a contract. Refuses (throws) if any `work_spec` still
 * references this contract via `contract_id` — the caller should
 * reassign those work areas first. This is the safer of the two
 * delete strategies we discussed in planning: no silent side-effect
 * on other tables, no data loss by surprise.
 *
 * The error includes the list of referencing work-area ids so the UI
 * can show the user which work areas need to be reassigned.
 */
export function deleteContract(
  handle: MoliospecHandle,
  contractId: number,
): void {
  const db = handle.db;
  ensureContractsTable(db);

  const exists = db
    .prepare("select 1 from contracts where id = ? limit 1")
    .get(contractId);
  if (!exists) {
    throw new CoreError(
      "INTERNAL",
      { contractId },
      `deleteContract: no such contract id=${contractId}`,
    );
  }

  const refs = db
    .prepare("select id from work_spec where contract_id = ?")
    .all(contractId) as { id: number }[];
  if (refs.length > 0) {
    const ids = refs.map((r) => r.id).join(", ");
    throw new CoreError(
      "CONTRACT_HAS_REFERENCES",
      { contractId, count: refs.length },
      `deleteContract: contract ${contractId} is still referenced by ` +
        `${refs.length} work area(s): [${ids}]. Reassign them first.`,
    );
  }

  db.prepare("delete from contracts where id = ?").run(contractId);
}
