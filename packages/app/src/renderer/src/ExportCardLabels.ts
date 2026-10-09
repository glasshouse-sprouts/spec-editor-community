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

/**
 * A work area's title in an export: "<code> <name>" with ONE space, e.g.
 * "S215.01 Skeletkonstruktion, let" (Task 145, owner's decision
 * 2026-10-08). Without a code - or with a code that is only whitespace -
 * the title is just the name, never with a leading space.
 *
 * One rule for every export surface that prints a work area's title: the
 * export tree, the PDF cover and title block (single and composite), the
 * composite's chapter headings (and so its table of contents) and the
 * custom cover's "specTitle". The Word export builds the same string in
 * `word/buildBdbDocx.ts` and `useDocxExport.ts`.
 *
 * The on-screen UI writes "<code> — <name>" (MainPane); documents use the
 * space form the owner chose for the export.
 */
export function formatWorkAreaTitle(
  code: string | null | undefined,
  name: string,
): string {
  const c = (code ?? "").trim();
  const n = name.trim();
  if (!c) return n;
  if (!n) return c;
  return `${c} ${n}`;
}

/**
 * The work area as printed in row 3 of the running PDF header and in a
 * custom cover's "Arbejdsbeskrivelse" field (binding `workAreaName`):
 * the same "<code> <name>" string as the title (Task 145, owner
 * 2026-10-08). Used for a work area's own PDF and for the parent work
 * area of a BDB or control-plan PDF. Null when there is no work area or
 * it has neither code nor name, so the cell stays empty.
 */
export function workAreaHeaderLabel(
  ws:
    | { workAreaCode: string | null; workAreaName: string | null }
    | null
    | undefined,
): string | null {
  if (!ws) return null;
  return formatWorkAreaTitle(ws.workAreaCode, ws.workAreaName ?? "") || null;
}
