/**
 * Reader: pull a full `MoliospecFile` object out of a `MoliospecHandle`.
 *
 * No transformations applied — row values are passed through as stored so
 * that a later writer can reproduce them byte-for-byte.
 *
 * The reader is schema-version-tolerant: tables that only exist in newer
 * versions (e.g. `contracts` was added in 01.00.04) are read as empty arrays
 * when absent. This keeps older sample files (01.00.00–01.00.02) openable
 * without silent upgrades — the user explicitly controls upgrades.
 */

import type { MoliospecHandle } from "./io.js";
import type {
  Attachment,
  ConstructionElementSpec,
  ConstructionElementSpecSection,
  Contract,
  ControlPlan,
  ControlPlanSection,
  ControlPlanSectionHeader,
  CustomDataEntry,
  MoliospecFile,
  Project,
  WorkSpec,
  WorkSpecSection,
} from "./types.js";

/**
 * Detect the schema version. Tries `pragma db_version` first (set by Molio
 * in their template), falls back to the `db_version` column on the `project`
 * row if present.
 */
export function readDbVersion(handle: MoliospecHandle): string {
  const pragmaResult = handle.db.pragma("db_version") as Array<{
    db_version: string;
  }>;
  const pragmaValue = pragmaResult[0]?.db_version;
  if (pragmaValue && pragmaValue !== "0") return pragmaValue;

  // Fall back to the `project` row.
  const row = handle.db
    .prepare("select db_version from project limit 1")
    .get() as { db_version?: string } | undefined;
  return row?.db_version ?? "unknown";
}

/** Collect the names of every table present in the opened database. */
function listTables(handle: MoliospecHandle): Set<string> {
  const rows = handle.db
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/**
 * Run a SELECT only if the table exists; otherwise return [].
 * This lets us read files from older schema versions without crashing.
 */
function readTableIfExists<T>(
  handle: MoliospecHandle,
  tables: Set<string>,
  tableName: string,
  sql: string,
): T[] {
  if (!tables.has(tableName)) return [];
  return handle.db.prepare(sql).all() as T[];
}

/** Read every table into a single typed `MoliospecFile` object. */
export function readMoliospec(handle: MoliospecHandle): MoliospecFile {
  const db = handle.db;
  const tables = listTables(handle);

  const project = tables.has("project")
    ? ((db.prepare("select * from project limit 1").get() as
        | Project
        | undefined) ?? null)
    : null;

  const workSpecs = readTableIfExists<WorkSpec>(
    handle,
    tables,
    "work_spec",
    "select * from work_spec order by id",
  );

  const workSpecSections = readTableIfExists<WorkSpecSection>(
    handle,
    tables,
    "work_spec_section",
    "select * from work_spec_section order by id",
  );

  const constructionElementSpecs = readTableIfExists<ConstructionElementSpec>(
    handle,
    tables,
    "construction_element_spec",
    "select * from construction_element_spec order by id",
  );

  const constructionElementSpecSections =
    readTableIfExists<ConstructionElementSpecSection>(
      handle,
      tables,
      "construction_element_spec_section",
      "select * from construction_element_spec_section order by id",
    );

  const controlPlans = readTableIfExists<ControlPlan>(
    handle,
    tables,
    "control_plan",
    "select * from control_plan order by id",
  );

  const controlPlanSectionHeaders = readTableIfExists<ControlPlanSectionHeader>(
    handle,
    tables,
    "control_plan_section_header",
    "select * from control_plan_section_header order by id",
  );

  const controlPlanSections = readTableIfExists<ControlPlanSection>(
    handle,
    tables,
    "control_plan_section",
    "select * from control_plan_section order by id",
  );

  const attachments = readTableIfExists<Attachment>(
    handle,
    tables,
    "attachment",
    "select * from attachment order by id",
  );

  // `contracts` was introduced in schema 01.00.04 — absent in older files.
  const contracts = readTableIfExists<Contract>(
    handle,
    tables,
    "contracts",
    "select * from contracts order by id",
  );

  const customData = readTableIfExists<CustomDataEntry>(
    handle,
    tables,
    "custom_data",
    "select key, value from custom_data order by key",
  );

  return {
    dbVersion: readDbVersion(handle),
    project,
    workSpecs,
    workSpecSections,
    constructionElementSpecs,
    constructionElementSpecSections,
    controlPlans,
    controlPlanSectionHeaders,
    controlPlanSections,
    attachments,
    contracts,
    customData,
  };
}

/**
 * Load a single attachment's raw bytes + metadata. Used by the PDF
 * exporter (Slice 10L) so it can embed image attachments in the
 * work-spec appendix without having to return the full binary in the
 * default FilePayload. Read-only; does not mutate anything.
 *
 * Returns `null` if the attachment row doesn't exist — the caller can
 * decide whether to log + skip or treat as an error. We prefer null
 * over throwing because export is a batch pipeline and we don't want
 * a single missing attachment to fail the whole PDF.
 */
export interface AttachmentBytesResult {
  id: number;
  name: string;
  mimeType: string;
  workSpecId: number | null;
  content: Buffer;
}

export function readAttachmentBytes(
  handle: MoliospecHandle,
  attachmentId: number,
): AttachmentBytesResult | null {
  const row = handle.db
    .prepare(
      "select id, name, mime_type, work_spec_id, content " +
        "from attachment where id = ? limit 1",
    )
    .get(attachmentId) as
    | {
        id: number;
        name: string;
        mime_type: string;
        work_spec_id: number | null;
        content: Buffer;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    workSpecId: row.work_spec_id,
    content: row.content,
  };
}
