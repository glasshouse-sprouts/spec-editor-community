/**
 * The canonical Molio 2.0 schema, version 01.00.04.
 *
 * Why this file exists
 * ====================
 * `migrate.ts` upgrades files written in an older schema. To do that it
 * needs an authoritative description of what "current" looks like — not
 * approximately, but exactly: same tables, same columns, same order, same
 * nullability, same defaults, same indexes, triggers and views. A file we
 * produce that differs from what Molio's own tools emit is a file their
 * tools may reject, and we would only find out when a customer complains.
 *
 * The DDL below was read straight off Molio's 01.00.04 sample databases and
 * cross-checked against `packages/app/resources/blank.moliospec`, the empty
 * template the app already ships. `schemaDrift.test.ts` re-checks that
 * agreement on every test run, so this file cannot quietly drift away from
 * the template (or the template from this file).
 *
 * Cosmetic note: some of Molio's own files carry the same tables with
 * quoted identifiers, because they were edited in a GUI tool at some point.
 * Column names, order, types, nullability and defaults are identical; only
 * the DDL *text* differs. We compare the former, never the latter.
 */

/** The schema version this package reads and writes. */
export const CURRENT_DB_VERSION = "01.00.04";

/**
 * The oldest version that already has the complete current schema.
 *
 * 01.00.03 and 01.00.04 are identical in every table and column — the
 * version bump carried no schema change — so a 01.00.03 file needs no
 * migration and must not be touched.
 */
export const OLDEST_CURRENT_SCHEMA_VERSION = "01.00.03";

/**
 * `create table` statements, keyed by table name.
 *
 * Order matters only for foreign keys, which SQLite resolves lazily, so
 * these can be applied in any order.
 */
export const CANONICAL_TABLES: Readonly<Record<string, string>> = {
  project: `
create table project (
  project_guid              text primary key,
  name                      text not null,
  created_by_system         text not null,
  created_date              text not null,
  modified_date             text,
  builder                   text,
  project_number            text not null,
  db_version                text not null,
  molio_referencelist_date  text,

  constraint "project_guid is not a valid guid"
  check ((length(project_guid) = 36))
)`,

  work_area_type: `
create table work_area_type (
    id             integer primary key,
    work_area_type text not null
)`,

  control_type_type: `
create table control_type_type (
    id               integer primary key,
    control_type     text default '' not null,
    name             text default '' not null
)`,

  contracts: `
create table contracts (
  id            integer primary key,
  contract_code text,
  contract_name text
)`,

  work_spec: `
create table work_spec (
  id                                        integer primary key,
  work_area_code                            text,
  work_area_name                            text not null,
  created_by_organization                   text,
  created_by                                text,
  revision_date                             text,
  revision                                  text,
  reviewed_by                               text,
  approved_by                               text,
  molio_spec_guid                           text,
  molio_spec_revision_guid                  text,
  molio_work_spec_paradigm_guid             text,
  molio_work_spec_paradigm_revision_guid    text,
  molio_referencelist_area                  text,
  work_area_type                            integer not null,
  issue_date                                text,
  molio_spec_revision_no                    text,
  molio_spec_revision_date                  text,
  molio_referencelist_area_date             text,
  contract_id                               integer,

  foreign key (work_area_type)
  references work_area_type (id),

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36))
)`,

  work_spec_section: `
create table work_spec_section (
  id                    integer primary key,
  work_spec_id          integer not null,
  section_no            int     not null,
  heading               text    not null,
  body                  text    default '',
  molio_section_guid    text,
  parent_id             integer,

  foreign key (work_spec_id)
  references work_spec (id),

  foreign key (parent_id)
  references work_spec_section (id),

  constraint "Non-integer value used for section_no"
  check (typeof(section_no) = 'integer')
)`,

  construction_element_spec: `
create table construction_element_spec (
  id                                            integer primary key,
  work_spec_id                                  integer,
  pfbb_id                                       integer,
  is_pfbb                                       integer default 0 not null,
  name                                          text not null,
  created_by_organization                       text,
  created_by                                    text,
  revision_date                                 text,
  revision                                      text,
  reviewed_by                                   text,
  approved_by                                   text,
  molio_spec_guid                               text,
  molio_spec_revision_guid                      text,
  controlplan_design_id                         text,
  controlplan_production_id                     text,
  common_controlplan_design_guid                text,
  common_controlplan_production_guid            text,
  molio_construction_element_spec_guid          text,
  molio_construction_element_spec_revision_guid text,
  molio_referencelist_area                      text,
  issue_date                                    text,
  molio_spec_revision_no                        text,
  molio_spec_revision_date                      text,
  molio_referencelist_area_date                 text,
  molio_construction_element_spec_revision_no   text,
  molio_construction_element_spec_revision_date text,

  foreign key (work_spec_id)
  references work_spec (id),

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36))
)`,

  construction_element_spec_section: `
create table construction_element_spec_section (
  id                           integer primary key,
  construction_element_spec_id integer not null,
  section_no                   integer not null,
  heading                      text    not null,
  body                         text    default '',
  molio_section_guid           text,
  parent_id                    integer,
  pfbb_section_id              integer default null,

  foreign key (construction_element_spec_id)
  references construction_element_spec (id),

  foreign key (parent_id)
  references construction_element_spec_section (id),

  constraint "Non-integer value used for section_no"
  check (typeof(section_no) = 'integer')
)`,

  control_plan: `
create table control_plan (
  id                integer primary key,
  revision_date     text,
  revision          text,
  number_text       text not null,
  title             text not null,
  control_plan_type integer not null
)`,

  control_plan_section_header: `
create table control_plan_section_header (
  id                    integer primary key,
  header                text  not null default '',
  header_no             text  not null default '',
  control_plan_id       integer not null,

  foreign key (control_plan_id)
  references control_plan (id)
)`,

  control_plan_section: `
create table control_plan_section (
  id                  integer primary key,
  header_id           integer not null,
  control_plan_id     integer not null,
  control_type        integer default 0 not null,
  section_no          text default '' not null,
  subject             text default '' not null,
  reference           text default '',
  method              text default '',
  quantity            text default '',
  time                text default '',
  acceptance_criteria text default '',
  documentation       text default '',
  control_level       text default '',
  sample_level        text default '',

  foreign key (header_id)
  references control_plan_section_header (id),
  foreign key (control_type)
  references control_type_type (id)
)`,

  attachment_type: `
create table attachment_type (
  id            integer primary key,
  attachment_type  text    not null
)`,

  attachment: `
create table attachment (
  id        integer primary key,
  mime_type text    not null,
  content   blob    not null,
  name      text    not null default '',
  sha1_hash blob,
  work_spec_id integer,
  attachment_type_id integer not null,

  foreign key (work_spec_id)
  references work_spec (id),

  foreign key (attachment_type_id)
  references attachment_type (id),

  constraint "content is not a blob"
  check (typeof(content) = 'blob'),

  constraint "sha1_hash is not a valid SHA1 hash"
  check (sha1_hash is null or
         (typeof(sha1_hash) = 'blob' and
          length(sha1_hash) = 20)),

  constraint "duplicate sha1_hash detected"
  unique (sha1_hash)
)`,

  custom_data: `
create table custom_data (
  key   text primary key,
  value blob not null
)`,
};

/** An index, trigger or view, with the name SQLite files it under. */
export interface SchemaExtra {
  name: string;
  ddl: string;
}

/**
 * Indexes, triggers and views, grouped by the table they belong to.
 *
 * Grouping matters during migration: dropping a table also drops its
 * indexes and its triggers, so those have to be recreated after a rebuild.
 * Views are NOT dropped with the table, which is exactly why each entry
 * carries its name — the migration recreates only what actually went away.
 */
export const CANONICAL_TABLE_EXTRAS: Readonly<
  Record<string, readonly SchemaExtra[]>
> = {
  project: [
    {
      name: "project_constraint_to_one_row",
      ddl: `
create trigger project_constraint_to_one_row before insert on project
when (select count(*) from project) >= 1
begin
  select raise(fail, 'Only one project per file is supported.');
end`,
    },
  ],

  work_area_type: [
    {
      name: "work_area_type_constraint_to_three_row",
      ddl: `
create trigger work_area_type_constraint_to_three_row before insert on work_area_type
when (select count(*) from work_area_type) >= 3
begin
  select raise(fail, 'Only 3 work_area_types per file is supported.');
end`,
    },
  ],

  work_spec_section: [
    {
      name: "work_spec_section_unique_section_paths",
      ddl: `
create unique index work_spec_section_unique_section_paths
on work_spec_section (
  id,
  ifnull(parent_id, -1), -- All nulls are treated as unique, convert to -1 instead
  section_no
)`,
    },
    {
      name: "work_spec_section_path",
      ddl: `
create view work_spec_section_path as
  with recursive tree (
    id,           -- integer
    section_no,   -- integer
    section_path, -- text
    depth         -- integer
  ) as (
    select
      id,
      section_no,
      cast(section_no as text),
      1 as depth
    from work_spec_section
    where parent_id is null
    union all
    select
      node.id,
      node.section_no,
      tree.section_path || '.' || node.section_no,
      tree.depth + 1
    from work_spec_section node, tree
    where node.parent_id = tree.id
  )
  select id, section_path, depth from tree`,
    },
  ],

  construction_element_spec_section: [
    {
      name: "construction_element_spec_section_unique_section_paths",
      ddl: `
create unique index construction_element_spec_section_unique_section_paths
on construction_element_spec_section (
  id,
  ifnull(parent_id, -1), -- All nulls are treated as unique, convert to -1 instead
  section_no
)`,
    },
    {
      name: "construction_element_spec_section_path",
      ddl: `
create view construction_element_spec_section_path as
  with recursive tree (
    id,           -- integer
    section_no,   -- integer
    section_path, -- text
    depth         -- integer
  ) as (
    select
      id,
      section_no,
      cast(section_no as text),
      1 as depth
    from construction_element_spec_section
    where parent_id is null
    union all
    select
      node.id,
      node.section_no,
      tree.section_path || '.' || node.section_no,
      tree.depth + 1
    from construction_element_spec_section node, tree
    where node.parent_id = tree.id
  )
  select id, section_path, depth from tree`,
    },
  ],
};

/**
 * Rows that belong to the lookup tables.
 *
 * These are part of the format, not user content: `work_spec.work_area_type`
 * and `control_plan_section.control_type` are foreign keys into them, so a
 * file whose lookup tables are empty is not a usable file. Migration seeds
 * them when it has to create the table.
 *
 * Danish spellings are Molio's own — these strings are what their tools
 * write and what their tools expect to read back.
 */
export const CANONICAL_SEEDS: Readonly<
  Record<string, ReadonlyArray<ReadonlyArray<string | number>>>
> = {
  work_area_type: [
    [0, "Arbejdsbeskrivelse"],
    [1, "Fælles beskrivelse"],
    [2, "Paradigme for arbejdsbeskrivelse"],
  ],
  control_type_type: [
    [0, "", "Ikke angivet"],
    [1, "E", "Egenkontrol"],
    [2, "U", "Uafhængig kontrol"],
    [3, "T", "Tredjepartskontrol"],
  ],
  attachment_type: [
    [1, "Bilag"],
    [2, "Grænsefladeskema"],
  ],
};

/** Column signature as SQLite reports it, used for comparisons. */
export interface CanonicalColumn {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: number;
}

/**
 * Minimal shape we need from a `better-sqlite3` connection. Declared
 * structurally so this module does not have to import the driver's types
 * (and so tests can hand it an in-memory database).
 */
interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  pragma(source: string): unknown;
}

/**
 * Create every canonical table, its indexes/triggers/views, and seed the
 * lookup tables. Used to build a reference database for comparison, and by
 * the drift test. Migration does not call this wholesale — it only creates
 * what a given file is actually missing.
 */
export function applyCanonicalSchema(db: SqliteLike): void {
  for (const ddl of Object.values(CANONICAL_TABLES)) db.exec(ddl);
  for (const extras of Object.values(CANONICAL_TABLE_EXTRAS)) {
    for (const extra of extras) db.exec(extra.ddl);
  }
  for (const [table, rows] of Object.entries(CANONICAL_SEEDS)) {
    seedLookupTable(db, table, rows);
  }
}

/**
 * Insert the canonical rows of a lookup table. Idempotent: rows that are
 * already there are left alone, so this is safe to call on a file that has
 * a half-populated lookup table.
 */
export function seedLookupTable(
  db: SqliteLike,
  table: string,
  rows:
    | ReadonlyArray<ReadonlyArray<string | number>>
    | undefined = CANONICAL_SEEDS[table],
): void {
  if (!rows || rows.length === 0) return;
  const width = rows[0]?.length ?? 0;
  const placeholders = new Array(width).fill("?").join(", ");
  const stmt = db.prepare(
    `insert or ignore into "${table}" values (${placeholders})`,
  );
  for (const row of rows) stmt.run(...row);
}

/** Read the column signature of one table from an open database. */
export function readColumns(db: SqliteLike, table: string): CanonicalColumn[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  return rows.map((r) => ({
    name: r.name,
    type: r.type.toLowerCase(),
    notNull: r.notnull !== 0,
    defaultValue: r.dflt_value,
    primaryKey: r.pk,
  }));
}

/** True when two column signatures are the same, order included. */
export function columnsMatch(
  a: readonly CanonicalColumn[],
  b: readonly CanonicalColumn[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((col, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      col.name === other.name &&
      col.type === other.type &&
      col.notNull === other.notNull &&
      col.defaultValue === other.defaultValue &&
      col.primaryKey === other.primaryKey
    );
  });
}
