/**
 * Shared display-label helpers for the export surface.
 *
 * Extracted from `ExportCard.tsx` so the Batch-Export modal
 * (`exportTree.ts`) can reuse the same "code - name" formatting without
 * pulling in React or the rest of the card component. Pure functions
 * only — no DOM, no state.
 */

import type { ContractInfo } from "../../shared/ipc.js";

/**
 * Contracts show up as "<code> - <name>" (same format as the sidebar).
 * Either field may be null; if both are, returns null so the caller can
 * elide the contract slot entirely (e.g. from the running header).
 */
export function formatContractLabel(
  c: ContractInfo | undefined | null,
): string | null {
  if (!c) return null;
  const code = (c.contractCode ?? "").trim();
  const name = (c.contractName ?? "").trim();
  if (!code && !name) return null;
  if (code && name) return `${code} - ${name}`;
  return code || name;
}
