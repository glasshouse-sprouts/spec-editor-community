/**
 * Shared helpers for the IPC handler modules.
 *
 * Each handler module under `./handlers/` registers its own
 * `ipcMain.handle(...)` handlers on import, calling into core. These
 * helpers cover the cross-cutting concerns:
 *
 *   - `safeMtimeMs` — stat a file, returning null on missing/error.
 *   - `preflight`   — the standard mtime check (`conflict` / `missing`)
 *                     that wraps every write op.
 *   - `withHandleForWrite` — open → mutate → saveAs → close envelope.
 *   - `attachmentRowToInfo` — map a core Attachment row to the
 *                             IPC-facing `AttachmentInfo` DTO.
 *   - `sanitizeAttachmentFilename` — defensive filename scrubbing
 *                                    for the temp-file open flow.
 *   - `groupControlPlanHeaders` / `groupControlPlanRows` — the
 *     read-side grouping helpers used by `openFile`.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import type {
  ControlPlanSection,
  ControlPlanSectionHeader,
} from "@molio2-editor/core";
import { openMoliospec } from "@molio2-editor/core";
import type {
  AttachmentInfo,
  ControlPlanHeaderData,
  ControlPlanRowData,
} from "../../shared/ipc.js";
import { saveAsSelfWrite } from "../fileWatcher.js";
import { openForInPlaceWrite } from "./openForInPlaceWrite.js";
import { safeMtimeMs } from "../mtime.js";
import { compareCpRows } from "../cpRowSort.js";

// Re-exported so the many `import { safeMtimeMs } from "./shared.js"`
// call sites keep working; the implementation lives in ../mtime.js to
// avoid an import cycle with the file watcher.
export { safeMtimeMs };

/**
 * Shared write-path pre-flight: stat the path; return null on success,
 * or the typed conflict / missing result. Every write IPC handler
 * runs this before opening the file so we never start a transaction
 * we can't commit cleanly.
 */
export async function preflight(
  path: string,
  storedMtimeMs: number,
  force: boolean,
): Promise<
  null | { kind: "conflict"; currentMtimeMs: number } | { kind: "missing" }
> {
  const currentMtimeMs = await safeMtimeMs(path);
  if (currentMtimeMs === null) return { kind: "missing" };
  if (!force && currentMtimeMs !== storedMtimeMs) {
    return { kind: "conflict", currentMtimeMs };
  }
  return null;
}

/**
 * Run a write op inside the standard open-mutate-saveAs-close
 * envelope. `work` receives the open handle and returns whatever
 * extra payload fields should be merged into the final "ok" result
 * (e.g. a new row id).
 */
export async function withHandleForWrite<T>(
  path: string,
  work: (handle: Awaited<ReturnType<typeof openMoliospec>>) => T,
): Promise<{ work: T; mtimeMs: number }> {
  let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
  try {
    handle = await openForInPlaceWrite(path);
    const result = work(handle);
    const mtimeMs = await saveAsSelfWrite(handle, path);
    return { work: result, mtimeMs };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (err) {
        console.error("[main] withHandleForWrite: handle.close failed:", err);
      }
    }
  }
}

/** Map a core `Attachment` row onto the IPC-facing `AttachmentInfo` DTO. */
export function attachmentRowToInfo(row: {
  id: number;
  work_spec_id: number | null;
  name: string;
  mime_type: string;
  attachment_type_id: number;
  content: Buffer;
  sha1_hash: Buffer | null;
}): AttachmentInfo {
  return {
    id: row.id,
    workSpecId: row.work_spec_id ?? 0,
    name: row.name,
    mimeType: row.mime_type,
    attachmentTypeId: row.attachment_type_id,
    byteLength: row.content.byteLength,
    sha1Hex: (row.sha1_hash ?? Buffer.alloc(0)).toString("hex"),
  };
}

/**
 * Group control-plan headers by their parent plan id. The renderer
 * uses this to draw the section-group rows inside the table view.
 * Headers are sorted by `header_no` using a locale-aware natural sort
 * so e.g. "1.10" comes after "1.9".
 */
export function groupControlPlanHeaders(
  headers: ControlPlanSectionHeader[],
): Record<number, ControlPlanHeaderData[]> {
  const collator = new Intl.Collator(undefined, { numeric: true });
  const out: Record<number, ControlPlanHeaderData[]> = {};
  for (const h of headers) {
    (out[h.control_plan_id] ??= []).push({
      id: h.id,
      header: h.header,
      headerNo: h.header_no,
    });
  }
  for (const k of Object.keys(out)) {
    out[Number(k)]!.sort((a, b) => collator.compare(a.headerNo, b.headerNo));
  }
  return out;
}

/**
 * Group control-plan rows by their parent plan id. Ordering rules
 * live in `compareCpRows` (see ../cpRowSort.ts):
 *   - Populated `sectionNo` values sort naturally ("2" before "10").
 *   - Rows with empty `sectionNo` (e.g. a just-added blank row) sort
 *     to the BOTTOM so they appear below the existing numbered rows.
 *   - Ties broken by `id` so multiple blank rows keep insertion order.
 * The renderer rebuckets per-header at render time (small data set).
 */
export function groupControlPlanRows(
  rows: ControlPlanSection[],
): Record<number, ControlPlanRowData[]> {
  const collator = new Intl.Collator(undefined, { numeric: true });
  const out: Record<number, ControlPlanRowData[]> = {};
  for (const r of rows) {
    (out[r.control_plan_id] ??= []).push({
      id: r.id,
      headerId: r.header_id,
      controlType: r.control_type,
      sectionNo: r.section_no,
      subject: r.subject,
      reference: r.reference,
      method: r.method,
      quantity: r.quantity,
      time: r.time,
      acceptanceCriteria: r.acceptance_criteria,
      documentation: r.documentation,
      controlLevel: r.control_level,
      sampleLevel: r.sample_level,
    });
  }
  for (const k of Object.keys(out)) {
    out[Number(k)]!.sort((a, b) => compareCpRows(a, b, collator));
  }
  return out;
}
