/**
 * Public API of the Molio 2.0 core package.
 *
 * This package is pure TypeScript / Node and knows nothing about Electron,
 * React, or the DOM. The UI layer uses only what is exported from here.
 */

export * from "./types.js";
export {
  CoreError,
  parseCoreErrorMessage,
  type CoreErrorCode,
  type CoreErrorParams,
  type CoreErrorParamValue,
} from "./errors.js";
export {
  openMoliospec,
  MoliospecHandle,
  isGzipped,
  isSqlite,
  type OpenMoliospecOptions,
  type SaveAsOptions,
} from "./io.js";

// Path canonicalisation. Shared by the editor and the MCP server, which
// compare paths across a process boundary (M4).
//
// Placed here, and not at the end of the file, on purpose: the Community
// straddler patch removes the molio-api block, which is the last thing in
// this file, and its hunk runs to the end. Anything added after that block
// makes the patch fail. Anything added before it just shifts the line
// numbers, which patch handles.
export { canonicalPath, samePath } from "./paths.js";
export {
  readMoliospec,
  readDbVersion,
  readAttachmentBytes,
  type AttachmentBytesResult,
} from "./read.js";
export {
  CURRENT_DB_VERSION,
  OLDEST_CURRENT_SCHEMA_VERSION,
  applyCanonicalSchema,
  CANONICAL_TABLES,
  CANONICAL_TABLE_EXTRAS,
  CANONICAL_SEEDS,
  readColumns,
  columnsMatch,
  type CanonicalColumn,
  type SchemaExtra,
} from "./schema.js";
export {
  planMigration,
  migrateToCurrent,
  compareDbVersion,
  getCanonicalColumns,
  type MigrationPlan,
  type MigrationResult,
} from "./migrate.js";
export {
  applyEdits,
  type Edit,
  type SectionBodyEdit,
  type ApplyEditsResult,
  type CpRowEditableField,
} from "./write.js";
export {
  createWorkSpec,
  duplicateWorkArea,
  deleteWorkArea,
  deleteBdb,
  getDeleteImpact,
  type CreateWorkSpecArgs,
  type CreateWorkSpecResult,
  type DuplicateWorkAreaArgs,
  type DuplicateWorkAreaResult,
  type DeleteWorkAreaArgs,
  type DeleteBdbArgs,
  type DeleteSummary,
  type DeleteImpact,
} from "./writeStructural.js";
export {
  createContract,
  deleteContract,
  type CreateContractArgs,
  type CreateContractResult,
} from "./writeContract.js";
export {
  createBdb,
  duplicateBdb,
  createPfbbChild,
  type CreateBdbArgs,
  type CreateBdbResult,
  type DuplicateBdbArgs,
  type DuplicateBdbResult,
  type CreatePfbbChildArgs,
  type CreatePfbbChildResult,
} from "./writeBdb.js";
export {
  createControlPlan,
  duplicateControlPlan,
  moveControlPlan,
  deleteControlPlan,
  addControlPlanRow,
  deleteControlPlanRow,
  addControlPlanHeader,
  deleteControlPlanHeader,
  type CpSlot,
  type CreateControlPlanArgs,
  type CreateControlPlanResult,
  type DuplicateControlPlanArgs,
  type DuplicateControlPlanResult,
  type MoveControlPlanArgs,
  type MoveControlPlanResult,
  type AddControlPlanRowArgs,
  type AddControlPlanHeaderArgs,
} from "./writeCp.js";
export {
  addAttachment,
  deleteAttachment,
  replaceAttachment,
  renameAttachment,
  moveAttachment,
  DuplicateAttachmentError,
  type AddAttachmentArgs,
  type ReplaceAttachmentArgs,
} from "./writeAttachment.js";
export {
  VIRTUAL_WORK_SPEC_NAME,
  VIRTUAL_WORK_SPEC_CODE,
  isVirtualWorkSpec,
  findVirtualWorkSpecId,
  ensureVirtualWorkSpec,
  migrateOrphanPfbbMasters,
  moveBdbToVirtualWorkSpec,
  type EnsureVirtualWorkSpecResult,
  type MigrateOrphanPfbbMastersResult,
  type MoveBdbToVirtualWorkSpecResult,
} from "./pfbbWorkSpec.js";
export {
  importFromMoliospec,
  getImportPrecheck,
  fillEmptyWorkSpec,
  type ImportPlan,
  type WorkAreaImportPlan,
  type BdbImportPlan,
  type ImportPrecheck,
  type WorkAreaCollision,
  type BdbCollision,
  type ImportResult,
  type CollisionPolicy,
  type FillEmptyWorkSpecResult,
} from "./import.js";
// Community edition: the Molio API client + types are Glasshouse-only and the
// `molio-api` module is removed by the strip, so this re-export is dropped.
