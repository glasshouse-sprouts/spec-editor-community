/**
 * TypeScript types mirroring the Molio 2.0 SQLite schema (db_version 01.00.04).
 * See: 0000 Background info/.../molio-doc/template_01.00.04.sql
 *
 * NOTE: optional fields are declared `T | null` (not `T | undefined`) because
 * SQLite represents missing values as NULL; preserving that distinction makes
 * round-tripping predictable.
 */

/** Work area type values inserted by the schema as seed data. */
export enum WorkAreaType {
  Arbejdsbeskrivelse = 0,
  FaellesBeskrivelse = 1,
  ParadigmeForArbejdsbeskrivelse = 2,
}

/** Attachment type values inserted by the schema as seed data. */
export enum AttachmentType {
  Bilag = 1,
  Graensefladeskema = 2,
}

/** Control type values inserted by the schema. */
export enum ControlType {
  NotSelected = 0,
  Egenkontrol = 1,
  UafhaengigKontrol = 2,
  Tredjepartskontrol = 3,
}

export interface Project {
  project_guid: string;
  name: string;
  created_by_system: string;
  created_date: string;
  modified_date: string | null;
  builder: string | null;
  project_number: string;
  db_version: string;
  molio_referencelist_date: string | null;
}

export interface WorkSpec {
  id: number;
  work_area_code: string | null;
  work_area_name: string;
  created_by_organization: string | null;
  created_by: string | null;
  revision_date: string | null;
  revision: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  molio_spec_guid: string | null;
  molio_spec_revision_guid: string | null;
  molio_work_spec_paradigm_guid: string | null;
  molio_work_spec_paradigm_revision_guid: string | null;
  molio_referencelist_area: string | null;
  work_area_type: WorkAreaType;
  issue_date: string | null;
  molio_spec_revision_no: string | null;
  molio_spec_revision_date: string | null;
  molio_referencelist_area_date: string | null;
  contract_id: number | null;
}

export interface WorkSpecSection {
  id: number;
  work_spec_id: number;
  section_no: number;
  heading: string;
  body: string;
  molio_section_guid: string | null;
  parent_id: number | null;
}

export interface ConstructionElementSpec {
  id: number;
  work_spec_id: number | null;
  pfbb_id: number | null;
  is_pfbb: number;
  name: string;
  created_by_organization: string | null;
  created_by: string | null;
  revision_date: string | null;
  revision: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  molio_spec_guid: string | null;
  molio_spec_revision_guid: string | null;
  controlplan_design_id: string | null;
  controlplan_production_id: string | null;
  common_controlplan_design_guid: string | null;
  common_controlplan_production_guid: string | null;
  molio_construction_element_spec_guid: string | null;
  molio_construction_element_spec_revision_guid: string | null;
  molio_referencelist_area: string | null;
  issue_date: string | null;
  molio_spec_revision_no: string | null;
  molio_spec_revision_date: string | null;
  molio_referencelist_area_date: string | null;
  molio_construction_element_spec_revision_no: string | null;
  molio_construction_element_spec_revision_date: string | null;
}

export interface ConstructionElementSpecSection {
  id: number;
  construction_element_spec_id: number;
  section_no: number;
  heading: string;
  body: string;
  molio_section_guid: string | null;
  parent_id: number | null;
  pfbb_section_id: number | null;
}

export interface ControlPlan {
  id: number;
  revision_date: string | null;
  revision: string | null;
  number_text: string;
  title: string;
  control_plan_type: number;
}

export interface ControlPlanSectionHeader {
  id: number;
  header: string;
  header_no: string;
  control_plan_id: number;
}

export interface ControlPlanSection {
  id: number;
  header_id: number;
  control_plan_id: number;
  control_type: ControlType;
  section_no: string;
  subject: string;
  reference: string;
  method: string;
  quantity: string;
  time: string;
  acceptance_criteria: string;
  documentation: string;
  control_level: string;
  sample_level: string;
}

export interface Attachment {
  id: number;
  mime_type: string;
  content: Buffer;
  name: string;
  sha1_hash: Buffer | null;
  work_spec_id: number | null;
  attachment_type_id: AttachmentType;
}

export interface Contract {
  id: number;
  contract_code: string | null;
  contract_name: string | null;
}

export interface CustomDataEntry {
  key: string;
  value: Buffer;
}

/** The full in-memory representation of a `.moliospec` file. */
export interface MoliospecFile {
  /** db_version pragma value (e.g. "01.00.04"). */
  dbVersion: string;
  project: Project | null;
  workSpecs: WorkSpec[];
  workSpecSections: WorkSpecSection[];
  constructionElementSpecs: ConstructionElementSpec[];
  constructionElementSpecSections: ConstructionElementSpecSection[];
  controlPlans: ControlPlan[];
  controlPlanSectionHeaders: ControlPlanSectionHeader[];
  controlPlanSections: ControlPlanSection[];
  attachments: Attachment[];
  contracts: Contract[];
  customData: CustomDataEntry[];
}
