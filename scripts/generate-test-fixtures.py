#!/usr/bin/env python3
"""
Generate synthetic .moliospec test fixtures for the Community edition.

Why this exists
---------------
The original test fixtures were Molio's own sample files (their property,
no redistribution licence). They cannot ship in the public Community repo.
This script builds fully synthetic .moliospec files - real schema, made-up
content - so the test suite has fixtures that are safe to open source.

How it works
------------
Starts from `packages/app/resources/blank.moliospec` (the empty template the
app already ships - schema + lookup-table seeds, no Molio content), then
inserts synthetic rows with Python's built-in sqlite3 and re-gzips.

The fixtures are named so the existing test predicates still find them:
  - "...showoff..."          -> the rich edit/delete/import fixture
  - "...Version 01.00.04...projektf..." -> the PFBB fixture
  - "Legacy schemas/synthetic-legacy-01-00-0X..." -> the old-format fixtures

Legacy fixtures (Task 1 / M1)
-----------------------------
Molio changed the schema between 01.00.00 and 01.00.04, and files from
before 01.00.03 broke on save. We cannot ship Molio's own old sample files,
so the legacy fixtures are built the same way as the rest: fill a blank
01.00.04 template with synthetic content, then *downgrade* the schema to
what Molio's 01.00.00 / 01.00.01 files actually look like.

The old DDL below was read straight off Molio's sample files, so the
fixtures are structurally identical to the real thing - table definitions,
column order, nullability, indexes, triggers and views. Only the content is
made up.

Run: python3 scripts/generate-test-fixtures.py
"""

import gzip
import hashlib
import os
import sqlite3
import tempfile
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLANK = os.path.join(ROOT, "packages", "app", "resources", "blank.moliospec")
EX = os.path.join(ROOT, "0900 Examples")


def guid():
    return str(uuid.uuid4())  # 36 chars incl. hyphens


def base_conn():
    """Return a sqlite connection on a fresh copy of the blank template."""
    raw = gzip.open(BLANK, "rb").read()
    tmp = tempfile.mktemp(suffix=".sqlite")
    open(tmp, "wb").write(raw)
    con = sqlite3.connect(tmp)
    con.execute("PRAGMA foreign_keys=ON")
    return con, tmp


def set_project(con, name, number):
    # blank ships exactly one project row - update it in place.
    con.execute(
        "UPDATE project SET name=?, project_number=?, builder=?, modified_date=?",
        (name, number, "Syntetisk bygherre", "2026-06-15T00:00:00Z"),
    )


_AUTO = object()


def add_work_spec(con, code, name, wa_type, contract_id=None, molio_guid=_AUTO,
                  basis_revision_guid=None):
    g = guid() if molio_guid is _AUTO else molio_guid
    cur = con.execute(
        "INSERT INTO work_spec (work_area_code, work_area_name, work_area_type, "
        "created_by, created_by_organization, molio_spec_guid, "
        "molio_spec_revision_guid, contract_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (code, name, wa_type, "Test", "Testorg", g, basis_revision_guid,
         contract_id),
    )
    return cur.lastrowid


def add_ws_sections(con, ws_id, count):
    ids = []
    for n in range(1, count + 1):
        cur = con.execute(
            "INSERT INTO work_spec_section (work_spec_id, section_no, heading, body, "
            "molio_section_guid, parent_id) VALUES (?,?,?,?,?,?)",
            (ws_id, n, f"Afsnit {n}", f"<p>Syntetisk afsnitstekst {n}.</p>",
             guid(), None),
        )
        ids.append(cur.lastrowid)
    # make section 2 a child of section 1 to exercise hierarchy
    if len(ids) >= 2:
        con.execute("UPDATE work_spec_section SET parent_id=? WHERE id=?",
                    (ids[0], ids[1]))
    return ids


def add_bdb(con, ws_id, name, is_pfbb=0, pfbb_id=None):
    cur = con.execute(
        "INSERT INTO construction_element_spec (work_spec_id, name, is_pfbb, "
        "pfbb_id, created_by, molio_spec_guid) VALUES (?,?,?,?,?,?)",
        (ws_id, name, is_pfbb, pfbb_id, "Test", guid()),
    )
    return cur.lastrowid


def add_bdb_sections(con, bdb_id, count, pfbb_section_ids=None):
    ids = []
    for n in range(1, count + 1):
        psid = pfbb_section_ids[n - 1] if pfbb_section_ids else None
        cur = con.execute(
            "INSERT INTO construction_element_spec_section "
            "(construction_element_spec_id, section_no, heading, body, "
            "molio_section_guid, parent_id, pfbb_section_id) VALUES (?,?,?,?,?,?,?)",
            (bdb_id, n, f"BDB-afsnit {n}", f"<p>Syntetisk BDB-tekst {n}.</p>",
             guid(), None, psid),
        )
        ids.append(cur.lastrowid)
    return ids


def add_control_plan(con, number_text, title, cp_type):
    cur = con.execute(
        "INSERT INTO control_plan (number_text, title, control_plan_type, "
        "revision, revision_date) VALUES (?,?,?,?,?)",
        (number_text, title, cp_type, "01", "2026-06-15"),
    )
    cp_id = cur.lastrowid
    hcur = con.execute(
        "INSERT INTO control_plan_section_header (header, header_no, control_plan_id) "
        "VALUES (?,?,?)",
        ("Syntetisk emnegruppe", "1", cp_id),
    )
    header_id = hcur.lastrowid
    for i in range(1, 4):
        con.execute(
            "INSERT INTO control_plan_section (header_id, control_plan_id, "
            "control_type, section_no, subject, method, acceptance_criteria) "
            "VALUES (?,?,?,?,?,?,?)",
            (header_id, cp_id, i % 4, f"1.{i}", f"Syntetisk kontrolemne {i}",
             "Visuel", "Iht. projekt"),
        )
    return cp_id


def add_contract(con, code, name):
    cur = con.execute(
        "INSERT INTO contracts (contract_code, contract_name) VALUES (?,?)",
        (code, name),
    )
    return cur.lastrowid


def add_attachment(con, ws_id):
    content = b"Syntetisk bilagsindhold - ikke Molio-data."
    sha1 = hashlib.sha1(content).digest()
    con.execute(
        "INSERT INTO attachment (mime_type, content, name, sha1_hash, "
        "work_spec_id, attachment_type_id) VALUES (?,?,?,?,?,?)",
        ("text/plain", content, "bilag.txt", sha1, ws_id, 1),
    )


def finalize(con, tmp, out_path, gzipped=True, vacuum=False):
    """Write the database out.

    `gzipped=False` produces a raw SQLite file. Molio's own 01.00.00 and
    01.00.01 samples are a mix of both wrappings, and `io.ts` accepts
    either, so at least one legacy fixture is deliberately left raw.

    `vacuum=True` reclaims the pages left behind by the legacy fixtures'
    table rebuilds - without it a 4 kB file ships as ~90 kB of mostly
    free space.
    """
    con.commit()
    if vacuum:
        con.isolation_level = None  # VACUUM cannot run inside a transaction
        con.execute("VACUUM")
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    raw = open(tmp, "rb").read()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if gzipped:
        with gzip.open(out_path, "wb") as f:
            f.write(raw)
    else:
        with open(out_path, "wb") as f:
            f.write(raw)
    os.remove(tmp)
    print("  wrote", os.path.relpath(out_path, ROOT))


# ---------------------------------------------------------------------------
# Fixture 1 - rich project ("showoff" replacement)
# ---------------------------------------------------------------------------
def build_main():
    con, tmp = base_conn()
    set_project(con, "Syntetisk testprojekt", "TEST-001")
    c1 = add_contract(con, "C1", "Syntetisk fagentreprise")
    # ws1 carries a Molio basis-revision GUID so the reference resolver
    # passes (get_reference_content reaches the editor-not-running branch).
    ws1 = add_work_spec(con, "WA-01", "Arbejdsbeskrivelse A", 0, c1,
                        basis_revision_guid=guid())
    ws2 = add_work_spec(con, "WA-02", "Arbejdsbeskrivelse B", 0, None)
    ws3 = add_work_spec(con, "WA-03", "Paradigme", 2, None)
    # Every work area has sections AND at least one BDB - the mcp-server
    # caveats test assumes "every work area has BDBs".
    for ws, names in (
        (ws1, ["Bygningsdel A", "Bygningsdel B"]),
        (ws2, ["Bygningsdel C"]),
        (ws3, ["Bygningsdel D"]),
    ):
        add_ws_sections(con, ws, 3)
        for nm in names:
            bid = add_bdb(con, ws, nm)
            add_bdb_sections(con, bid, 3)
    add_control_plan(con, "KP-1", "Kontrolplan 1", 0)
    add_control_plan(con, "KP-2", "Kontrolplan 2", 1)
    add_attachment(con, ws1)
    finalize(con, tmp, os.path.join(EX, "synthetic-showoff-project.moliospec"))


# ---------------------------------------------------------------------------
# Fixture 2 - PFBB ("Projektfaelles" in "Version 01.00.04")
#
# Shape required by the PFBB tests (all discover structure dynamically):
#   - exactly one virtual work_spec (core's VIRTUAL_WORK_SPEC_NAME/CODE),
#     holding 2 PFBB masters (is_pfbb=1);
#   - a separate, regular work_spec holding 2 subscribers (is_pfbb=0,
#     pfbb_id -> a master), one of which has a supplement section whose
#     pfbb_section_id points at a master section.
# ---------------------------------------------------------------------------
# Mirrors core's VIRTUAL_WORK_SPEC_NAME / VIRTUAL_WORK_SPEC_CODE constants.
VIRTUAL_NAME = "Projektfælles bygningsdelsbeskrivelser"
VIRTUAL_CODE = "S999.01"


def build_pfbb():
    con, tmp = base_conn()
    set_project(con, "Syntetisk PFBB-projekt", "TEST-PFBB")
    # Virtual work_spec holding the masters (matches core's convention).
    virtual = add_work_spec(con, VIRTUAL_CODE, VIRTUAL_NAME, 0,
                            contract_id=None, molio_guid=None)
    # Separate, regular work_spec for the subscribers.
    subs_ws = add_work_spec(con, "WA-05", "Arbejdsbeskrivelse A", 0, None)
    add_ws_sections(con, subs_ws, 2)
    # Two PFBB masters in the virtual work_spec, each with sections.
    master_a = add_bdb(con, virtual, "PFBB master A", is_pfbb=1)
    master_a_sections = add_bdb_sections(con, master_a, 3)
    master_b = add_bdb(con, virtual, "PFBB master B", is_pfbb=1)
    add_bdb_sections(con, master_b, 3)
    # Two subscribers in the regular work_spec, each linking to a master.
    sub_a = add_bdb(con, subs_ws, "Abonnent A", is_pfbb=0, pfbb_id=master_b)
    add_bdb_sections(con, sub_a, 3)
    sub_b = add_bdb(con, subs_ws, "Abonnent B", is_pfbb=0, pfbb_id=master_a)
    # sub_b section_no 2 supplements master_a section_no 2 (pfbb_section_id).
    add_bdb_sections(con, sub_b, 3,
                     pfbb_section_ids=[None, master_a_sections[1], None])
    add_control_plan(con, "KP-1", "Kontrolplan 1", 0)
    finalize(
        con, tmp,
        os.path.join(EX, "Version 01.00.04", "Projektfaelles-synthetic.moliospec"),
    )


# ---------------------------------------------------------------------------
# Fixture 3 - old-schema variant (control_plan_section WITHOUT control_type)
# Reproduces the documented better-sqlite3 v12 regression coverage.
# ---------------------------------------------------------------------------
def build_oldschema():
    con, tmp = base_conn()
    set_project(con, "Syntetisk gammel-skema projekt", "TEST-OLD")
    ws1 = add_work_spec(con, "WA-01", "Arbejdsbeskrivelse A", 0, None)
    add_ws_sections(con, ws1, 3)
    b1 = add_bdb(con, ws1, "Bygningsdel A")
    add_bdb_sections(con, b1, 3)
    add_control_plan(con, "KP-1", "Kontrolplan 1", 0)
    # Rebuild control_plan_section without the control_type column.
    con.execute("PRAGMA foreign_keys=OFF")
    con.executescript(
        """
        CREATE TABLE cps_old (
          id integer primary key,
          header_id integer not null,
          control_plan_id integer not null,
          section_no text default '' not null,
          subject text default '' not null,
          reference text default '',
          method text default '',
          quantity text default '',
          time text default '',
          acceptance_criteria text default '',
          documentation text default '',
          control_level text default '',
          sample_level text default ''
        );
        INSERT INTO cps_old (id, header_id, control_plan_id, section_no, subject,
          reference, method, quantity, time, acceptance_criteria, documentation,
          control_level, sample_level)
        SELECT id, header_id, control_plan_id, section_no, subject, reference,
          method, quantity, time, acceptance_criteria, documentation,
          control_level, sample_level FROM control_plan_section;
        DROP TABLE control_plan_section;
        ALTER TABLE cps_old RENAME TO control_plan_section;
        """
    )
    finalize(
        con, tmp,
        os.path.join(EX, "synthetic-oldschema-no-control-type.moliospec"),
    )


# ---------------------------------------------------------------------------
# Fixtures 4-6 - legacy schema versions (Task 1 / M1)
#
# Built by filling a blank 01.00.04 template with synthetic content and then
# rewriting the schema back to what Molio's real 01.00.01 / 01.00.00 files
# look like. The DDL strings below were read off Molio's own sample files.
#
# Rebuilding a table that other tables reference by foreign key needs
# `legacy_alter_table=ON`: without it, SQLite 3.25+ helpfully rewrites those
# references when we RENAME the replacement into place, which is exactly what
# we do not want during a drop-and-rename swap.
# ---------------------------------------------------------------------------
LEGACY_DIR = os.path.join(EX, "Legacy schemas")


def _begin_schema_rewrite(con):
    """Get the connection into a state where the PRAGMAs below actually bite.

    `PRAGMA foreign_keys` is silently ignored inside an open transaction, and
    Python's sqlite3 opens one as soon as you INSERT. So: commit, switch to
    autocommit, then set the pragmas.
    """
    con.commit()
    con.isolation_level = None
    con.execute("PRAGMA foreign_keys=OFF")
    con.execute("PRAGMA legacy_alter_table=ON")


def _end_schema_rewrite(con):
    con.execute("PRAGMA legacy_alter_table=OFF")
    con.execute("PRAGMA foreign_keys=ON")


def _swap_table(con, table, ddl, columns, select_expr=None):
    """Replace `table` with one built from `ddl`, carrying `columns` over.

    `select_expr` defaults to `columns` - pass it when a column is renamed
    or defaulted (e.g. project_number -> project_key).
    """
    src = select_expr or columns
    con.executescript(
        f"""
        ALTER TABLE {table} RENAME TO {table}__old;
        {ddl};
        INSERT INTO {table} ({", ".join(columns)})
          SELECT {", ".join(src)} FROM {table}__old;
        DROP TABLE {table}__old;
        """
    )


# --- 01.00.01: 01.00.04 minus the purely additive bits ---------------------

DDL_01_WORK_SPEC = """
CREATE TABLE work_spec (
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

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36)),

  foreign key (work_area_type)
  references work_area_type (id)
)"""

WORK_SPEC_COLS_01 = [
    "id", "work_area_code", "work_area_name", "created_by_organization",
    "created_by", "revision_date", "revision", "reviewed_by", "approved_by",
    "molio_spec_guid", "molio_spec_revision_guid",
    "molio_work_spec_paradigm_guid", "molio_work_spec_paradigm_revision_guid",
    "molio_referencelist_area", "work_area_type", "issue_date",
    "molio_spec_revision_no", "molio_spec_revision_date",
    "molio_referencelist_area_date",
]

DDL_01_CES = """
CREATE TABLE construction_element_spec (
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

  foreign key (work_spec_id)
  references work_spec (id),

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36))
)"""

CES_COLS_01 = [
    "id", "work_spec_id", "pfbb_id", "is_pfbb", "name",
    "created_by_organization", "created_by", "revision_date", "revision",
    "reviewed_by", "approved_by", "molio_spec_guid",
    "molio_spec_revision_guid", "controlplan_design_id",
    "controlplan_production_id", "common_controlplan_design_guid",
    "common_controlplan_production_guid",
    "molio_construction_element_spec_guid",
    "molio_construction_element_spec_revision_guid",
    "molio_referencelist_area", "issue_date", "molio_spec_revision_no",
    "molio_spec_revision_date", "molio_referencelist_area_date",
]

DDL_01_CPS = """
CREATE TABLE control_plan_section (
  id                  integer primary key,
  header_id           integer not null,
  control_plan_id     integer not null,
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
  references control_plan_section_header (id)
)"""

CPS_COLS_01 = [
    "id", "header_id", "control_plan_id", "section_no", "subject",
    "reference", "method", "quantity", "time", "acceptance_criteria",
    "documentation", "control_level", "sample_level",
]


def downgrade_to_01_00_01(con):
    """01.00.04 -> 01.00.01. Purely subtractive: drop what was added later."""
    _begin_schema_rewrite(con)
    con.execute("DROP TABLE contracts")
    con.execute("DROP TABLE control_type_type")
    _swap_table(con, "work_spec", DDL_01_WORK_SPEC, WORK_SPEC_COLS_01)
    _swap_table(con, "construction_element_spec", DDL_01_CES, CES_COLS_01)
    _swap_table(con, "control_plan_section", DDL_01_CPS, CPS_COLS_01)
    con.execute("UPDATE project SET db_version='01.00.01'")
    _end_schema_rewrite(con)


# --- 01.00.00: renamed and relocated columns on top of the above -----------

DDL_00_PROJECT = """
CREATE TABLE project (
  project_guid      text primary key,
  name              text,
  created_by_system text,
  created_date      text,
  modified_date     text,
  builder           text,
  project_key       text,
  db_version        text,

  constraint "project_guid is not a valid guid"
  check ((length(project_guid) = 36))
)"""

DDL_00_PROJECT_TRIGGER = """
CREATE TRIGGER project_constraint_to_one_row before insert on project
when (select count(*) from project) >= 1
begin
  select raise(fail, 'Only one project per file is supported.');
end"""

DDL_00_CONTROL_PLAN = """
CREATE TABLE control_plan (
  id                integer primary key,
  revision_date     text,
  revision          text,
  header            text,
  title             text,
  control_plan_type integer
)"""

DDL_00_WORK_SPEC = """
CREATE TABLE work_spec (
  id                                        integer primary key,
  work_area_code                            text,
  work_area_name                            text,
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
  controlplan_design_id                     text,
  controlplan_production_id                 text,
  work_area_type                            integer default 0,
  issue_date                                text,

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36))
)"""

DDL_00_CES = """
CREATE TABLE construction_element_spec (
  id                                            integer primary key,
  work_spec_id                                  integer,
  pfbb_id                                       integer,
  is_pfbb                                       integer,
  name                                          text,
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

  foreign key (work_spec_id)
  references work_spec (id),

  constraint "molio_spec_guid is not a valid guid"
  check (molio_spec_guid is null or (length(molio_spec_guid) = 36))
)"""

DDL_00_CES_SECTION = """
CREATE TABLE construction_element_spec_section (
  id                           integer primary key,
  construction_element_spec_id integer not null,
  section_no                   integer not null,
  heading                      text    not null,
  body                         text    not null default '',
  molio_section_guid           text,
  parent_id                    integer,

  foreign key (construction_element_spec_id)
  references construction_element_spec (id),

  foreign key (parent_id)
  references construction_element_spec_section (id),

  constraint "Non-integer value used for section_no"
  check (typeof(section_no) = 'integer')
)"""

DDL_00_CES_SECTION_INDEX = """
CREATE UNIQUE INDEX construction_element_spec_section_unique_section_paths
on construction_element_spec_section (
  id,
  ifnull(parent_id, -1),
  section_no
)"""

DDL_00_CPS = """
CREATE TABLE control_plan_section (
  id                  integer primary key,
  header_id           integer,
  control_plan_id     integer,
  section_no          text default '',
  subject             text default '',
  reference           text default '',
  method              text default '',
  quantity            text default '',
  time                text default '',
  acceptance_criteria text default '',
  documentation       text default '',
  control_level       text default '',
  sample_level        text default '',

  foreign key (header_id)
  references control_plan_section_header (id)
)"""

DDL_00_CPS_HEADER = """
CREATE TABLE control_plan_section_header (
  id                    integer primary key,
  header                text  not null default '',
  header_no             text  not null default '',
  control_plan_id       integer,

  foreign key (control_plan_id)
  references control_plan (id)
)"""

DDL_00_WS_SECTION = """
CREATE TABLE work_spec_section (
  id                    integer primary key,
  work_spec_id          integer not null,
  section_no            int     not null,
  heading               text    not null,
  body                  text    not null default '',
  molio_section_guid    text,
  parent_id             integer,

  foreign key (work_spec_id)
  references work_spec (id),

  foreign key (parent_id)
  references work_spec_section (id),

  constraint "Non-integer value used for section_no"
  check (typeof(section_no) = 'integer')
)"""

DDL_00_WS_SECTION_INDEX = """
CREATE UNIQUE INDEX work_spec_section_unique_section_paths
on work_spec_section (
  id,
  ifnull(parent_id, -1),
  section_no
)"""

DDL_00_CUSTOM_DATA = """
CREATE TABLE custom_data (
  key   text primary key,
  value blob
)"""

WORK_SPEC_COLS_00 = [
    "id", "work_area_code", "work_area_name", "created_by_organization",
    "created_by", "revision_date", "revision", "reviewed_by", "approved_by",
    "molio_spec_guid", "molio_spec_revision_guid",
    "molio_work_spec_paradigm_guid", "molio_work_spec_paradigm_revision_guid",
    "molio_referencelist_area", "controlplan_design_id",
    "controlplan_production_id", "work_area_type", "issue_date",
]

CES_COLS_00 = CES_COLS_01[:-3]  # drops the three 01.00.01 revision columns


def downgrade_to_01_00_00(con):
    """01.00.01 -> 01.00.00. Renames and relocations, not just removals.

    The interesting one is the control-plan link: in 01.00.00 it sits on the
    work area (`work_spec.controlplan_*`); from 01.00.01 on it sits on the
    building element specification. We move it up here so the migration has
    something real to decide about.
    """
    _begin_schema_rewrite(con)

    # Move the control-plan links up to the work area before the columns
    # that hold them disappear. First BDB per work area wins - 01.00.00
    # could only express one link per work area anyway.
    links = {}
    for ws_id, design, production in con.execute(
        "SELECT work_spec_id, controlplan_design_id, controlplan_production_id "
        "FROM construction_element_spec "
        "WHERE controlplan_design_id IS NOT NULL "
        "   OR controlplan_production_id IS NOT NULL "
        "ORDER BY id"
    ):
        prev = links.setdefault(ws_id, [None, None])
        if prev[0] is None:
            prev[0] = design
        if prev[1] is None:
            prev[1] = production

    # project: project_number -> project_key, molio_referencelist_date gone.
    # Dropping the table takes its trigger with it, so put that back.
    _swap_table(
        con, "project", DDL_00_PROJECT,
        ["project_guid", "name", "created_by_system", "created_date",
         "modified_date", "builder", "project_key", "db_version"],
        ["project_guid", "name", "created_by_system", "created_date",
         "modified_date", "builder", "project_number", "db_version"],
    )
    con.execute(DDL_00_PROJECT_TRIGGER)

    # control_plan: number_text -> header.
    _swap_table(
        con, "control_plan", DDL_00_CONTROL_PLAN,
        ["id", "revision_date", "revision", "header", "title",
         "control_plan_type"],
        ["id", "revision_date", "revision", "number_text", "title",
         "control_plan_type"],
    )

    # work_spec: gains the control-plan columns, loses the revision columns
    # and the foreign key to work_area_type (which does not exist yet).
    _swap_table(
        con, "work_spec", DDL_00_WORK_SPEC, WORK_SPEC_COLS_00,
        ["id", "work_area_code", "work_area_name", "created_by_organization",
         "created_by", "revision_date", "revision", "reviewed_by",
         "approved_by", "molio_spec_guid", "molio_spec_revision_guid",
         "molio_work_spec_paradigm_guid",
         "molio_work_spec_paradigm_revision_guid", "molio_referencelist_area",
         "NULL", "NULL", "work_area_type", "issue_date"],
    )
    for ws_id, (design, production) in links.items():
        con.execute(
            "UPDATE work_spec SET controlplan_design_id=?, "
            "controlplan_production_id=? WHERE id=?",
            (design, production, ws_id),
        )

    # construction_element_spec: loses the three revision columns AND the
    # control-plan links we just moved up.
    _swap_table(
        con, "construction_element_spec", DDL_00_CES, CES_COLS_00,
        [("NULL" if c in ("controlplan_design_id",
                          "controlplan_production_id") else c)
         for c in CES_COLS_00],
    )

    # construction_element_spec_section: loses pfbb_section_id. Dropping the
    # table drops its unique index, so recreate it.
    _swap_table(
        con, "construction_element_spec_section", DDL_00_CES_SECTION,
        ["id", "construction_element_spec_id", "section_no", "heading",
         "body", "molio_section_guid", "parent_id"],
    )
    con.execute(DDL_00_CES_SECTION_INDEX)

    # Tables whose only difference is looser nullability.
    _swap_table(con, "control_plan_section", DDL_00_CPS, CPS_COLS_01)
    _swap_table(
        con, "control_plan_section_header", DDL_00_CPS_HEADER,
        ["id", "header", "header_no", "control_plan_id"],
    )
    _swap_table(
        con, "work_spec_section", DDL_00_WS_SECTION,
        ["id", "work_spec_id", "section_no", "heading", "body",
         "molio_section_guid", "parent_id"],
    )
    con.execute(DDL_00_WS_SECTION_INDEX)
    _swap_table(con, "custom_data", DDL_00_CUSTOM_DATA, ["key", "value"])

    # work_area_type does not exist in 01.00.00. Dropping it takes its
    # row-count trigger with it.
    con.execute("DROP TABLE work_area_type")
    con.execute("UPDATE project SET db_version='01.00.00'")
    _end_schema_rewrite(con)


def build_legacy_content(con, project_name, project_number):
    """Content shared by all three legacy fixtures, in 01.00.04 shape.

    Deliberate shape:
      - WA-01 has TWO building element specifications, so a migration cannot
        guess which one an 01.00.00 work-area control-plan link belongs to;
      - WA-02 has one, so the same question has an obvious answer there;
      - both control plans are linked, so we can prove what survives.
    """
    set_project(con, project_name, project_number)
    ws1 = add_work_spec(con, "WA-01", "Arbejdsbeskrivelse A", 0, None)
    ws2 = add_work_spec(con, "WA-02", "Arbejdsbeskrivelse B", 0, None)
    add_ws_sections(con, ws1, 3)
    add_ws_sections(con, ws2, 3)
    b1 = add_bdb(con, ws1, "Bygningsdel A")
    b2 = add_bdb(con, ws1, "Bygningsdel B")
    b3 = add_bdb(con, ws2, "Bygningsdel C")
    for b in (b1, b2, b3):
        add_bdb_sections(con, b, 3)
    cp_design = add_control_plan(con, "KP-1", "Kontrolplan projektering", 0)
    cp_prod = add_control_plan(con, "KP-2", "Kontrolplan produktion", 1)
    con.execute(
        "UPDATE construction_element_spec SET controlplan_design_id=? WHERE id=?",
        (str(cp_design), b1),
    )
    con.execute(
        "UPDATE construction_element_spec SET controlplan_production_id=? "
        "WHERE id=?",
        (str(cp_prod), b3),
    )
    add_attachment(con, ws1)


def build_legacy_01_00_03():
    """01.00.03: identical schema to 01.00.04, only the stamp differs.

    Its job in the test suite is to prove the migration leaves it alone.
    """
    con, tmp = base_conn()
    build_legacy_content(con, "Syntetisk 01.00.03-projekt", "TEST-010003")
    con.execute("UPDATE project SET db_version='01.00.03'")
    finalize(con, tmp,
             os.path.join(LEGACY_DIR, "synthetic-legacy-01-00-03.moliospec"))


def build_legacy_01_00_01():
    """01.00.01, left un-gzipped on purpose - Molio's real ones are too."""
    con, tmp = base_conn()
    build_legacy_content(con, "Syntetisk 01.00.01-projekt", "TEST-010001")
    downgrade_to_01_00_01(con)
    finalize(con, tmp,
             os.path.join(LEGACY_DIR, "synthetic-legacy-01-00-01.sqlite"),
             gzipped=False, vacuum=True)


def build_legacy_01_00_00():
    con, tmp = base_conn()
    build_legacy_content(con, "Syntetisk 01.00.00-projekt", "TEST-010000")
    downgrade_to_01_00_01(con)
    downgrade_to_01_00_00(con)
    finalize(con, tmp,
             os.path.join(LEGACY_DIR, "synthetic-legacy-01-00-00.moliospec"),
             vacuum=True)


BUILDERS = {
    "main": build_main,
    "pfbb": build_pfbb,
    "oldschema": build_oldschema,
    "legacy": (build_legacy_01_00_03, build_legacy_01_00_01,
               build_legacy_01_00_00),
}


if __name__ == "__main__":
    import sys

    # Every fixture contains fresh random GUIDs, so regenerating one that
    # has not changed still rewrites the file. Naming a group keeps an
    # unrelated commit from churning all six.
    #   python3 scripts/generate-test-fixtures.py            -> all
    #   python3 scripts/generate-test-fixtures.py legacy     -> one group
    wanted = sys.argv[1:] or list(BUILDERS)
    unknown = [w for w in wanted if w not in BUILDERS]
    if unknown:
        sys.exit(f"Unknown fixture group(s): {', '.join(unknown)}. "
                 f"Known: {', '.join(BUILDERS)}")
    print("Generating synthetic fixtures under '0900 Examples/':")
    for name in wanted:
        entry = BUILDERS[name]
        for fn in (entry if isinstance(entry, tuple) else (entry,)):
            fn()
    print("Done.")
