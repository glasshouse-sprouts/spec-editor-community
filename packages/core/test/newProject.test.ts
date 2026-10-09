/**
 * Task 159 - a new project gets its own identity.
 *
 * `stampNewProjectIdentity` replaces the template's project GUID,
 * creation date and system name. These tests run it against the real
 * bundled template, because the bug was in what the template carries.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CoreError,
  openMoliospec,
  readMoliospec,
  stampNewProjectIdentity,
} from "../src/index.js";
import { REPO_ROOT } from "./samples.js";

const BLANK = join(
  REPO_ROOT,
  "packages",
  "app",
  "resources",
  "blank.moliospec",
);

type ProjectRow = {
  project_guid: string;
  name: string;
  created_by_system: string;
  created_date: string;
  modified_date: string | null;
  project_number: string;
  db_version: string;
};

function projectRows(
  handle: Awaited<ReturnType<typeof openMoliospec>>,
): ProjectRow[] {
  return handle.db.prepare("select * from project").all() as ProjectRow[];
}

describe("stampNewProjectIdentity", () => {
  let dir = "";
  let templateRow: ProjectRow;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "new-project-"));
    const h = await openMoliospec(BLANK);
    try {
      templateRow = projectRows(h)[0]!;
    } finally {
      await h.close();
    }
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("replaces the template's GUID, date and system name", async () => {
    const now = new Date("2026-09-25T10:15:30.123Z");
    const h = await openMoliospec(BLANK);
    try {
      const id = stampNewProjectIdentity(h, {
        createdBySystem: "bskriver",
        now,
      });
      const rows = projectRows(h);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.project_guid).toBe(id.projectGuid);
      expect(row.project_guid).not.toBe(templateRow.project_guid);
      expect(row.project_guid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(row.created_date).toBe("2026-09-25T10:15:30.123Z");
      expect(row.created_by_system).toBe("bskriver");
      // Everything else in the row is left as the template has it.
      expect(row.name).toBe(templateRow.name);
      expect(row.project_number).toBe(templateRow.project_number);
      expect(row.db_version).toBe(templateRow.db_version);
      expect(row.modified_date).toBe(templateRow.modified_date);
    } finally {
      await h.close();
    }
  });

  it("gives two projects different GUIDs", async () => {
    const a = await openMoliospec(BLANK);
    const b = await openMoliospec(BLANK);
    try {
      const idA = stampNewProjectIdentity(a, { createdBySystem: "x" });
      const idB = stampNewProjectIdentity(b, { createdBySystem: "x" });
      expect(idA.projectGuid).not.toBe(idB.projectGuid);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("survives a save and reopen", async () => {
    const target = join(dir, "saved.moliospec");
    const h = await openMoliospec(BLANK);
    let guid: string;
    try {
      guid = stampNewProjectIdentity(h, {
        createdBySystem: "Spec Editor Community",
      }).projectGuid;
      await h.saveAs(target);
    } finally {
      await h.close();
    }
    const reopened = await openMoliospec(target);
    try {
      const payload = readMoliospec(reopened);
      expect(payload.project?.project_guid).toBe(guid);
      expect(payload.project?.created_by_system).toBe("Spec Editor Community");
    } finally {
      await reopened.close();
    }
  });

  it("lets the project edits address the row by its NEW guid", async () => {
    // The ordering rule: identity first, then everything else. The
    // project statements in applyEdits look the row up by GUID.
    const h = await openMoliospec(BLANK);
    try {
      const { projectGuid } = stampNewProjectIdentity(h, {
        createdBySystem: "bskriver",
      });
      const old = h.db
        .prepare("select count(*) as n from project where project_guid = ?")
        .get(templateRow.project_guid) as { n: number };
      const now = h.db
        .prepare("select count(*) as n from project where project_guid = ?")
        .get(projectGuid) as { n: number };
      expect(old.n).toBe(0);
      expect(now.n).toBe(1);
    } finally {
      await h.close();
    }
  });

  it("refuses an empty system name", async () => {
    const h = await openMoliospec(BLANK);
    try {
      expect(() =>
        stampNewProjectIdentity(h, { createdBySystem: "  " }),
      ).toThrow(CoreError);
      expect(projectRows(h)[0]!.project_guid).toBe(templateRow.project_guid);
    } finally {
      await h.close();
    }
  });

  it("refuses a file without exactly one project row", async () => {
    const h = await openMoliospec(BLANK);
    try {
      h.db.prepare("delete from project").run();
      expect(() =>
        stampNewProjectIdentity(h, { createdBySystem: "bskriver" }),
      ).toThrow(/exactly one project row/);
    } finally {
      await h.close();
    }
  });
});
