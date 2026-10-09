/**
 * Task 159 - "Start forfra" must give every new project its own identity.
 *
 * Before the fix, a new project was a byte copy of blank.moliospec, so
 * every project the app created carried the template's project GUID,
 * creation date and system name. Anything keyed on the GUID - the
 * cover tool's "last cover used" memory - then leaked between projects.
 *
 * These tests drive `createNewProjectFile`, the function the
 * createEmptyProject IPC handler calls, against the real bundled
 * template. If a later change goes back to copying the template, or
 * drops the identity step, the first test fails.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openMoliospec, readMoliospec } from "@molio2-editor/core";

import { createNewProjectFile } from "../src/main/newProjectFile.js";

const TEMPLATE = resolve(__dirname, "../resources/blank.moliospec");

let dir = "";
let templateGuid = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "new-project-file-"));
  const h = await openMoliospec(TEMPLATE);
  try {
    templateGuid = readMoliospec(h).project!.project_guid;
  } finally {
    await h.close();
  }
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function readProject(path: string) {
  const h = await openMoliospec(path);
  try {
    const file = readMoliospec(h);
    return { project: file.project!, contracts: file.contracts };
  } finally {
    await h.close();
  }
}

function create(
  name: string,
  opts: Partial<Parameters<typeof createNewProjectFile>[2]> = {},
) {
  const target = join(dir, name);
  return createNewProjectFile(TEMPLATE, target, {
    createdBySystem: "bskriver",
    contracts: [],
    save: (h, p) => h.saveAs(p),
    ...opts,
  }).then((identity) => ({ target, identity }));
}

describe("createNewProjectFile (Task 159)", () => {
  it("does NOT carry the template's project GUID into a new project", async () => {
    // The regression guard. It reads the template's GUID at run time
    // rather than hard-coding it, so it keeps working if the template
    // is ever rebuilt.
    const { target, identity } = await create("guard.moliospec");
    const { project } = await readProject(target);
    expect(templateGuid).toHaveLength(36);
    expect(project.project_guid).not.toBe(templateGuid);
    expect(project.project_guid).toBe(identity.projectGuid);
  });

  it("gives two projects created one after the other DIFFERENT GUIDs", async () => {
    const a = await create("first.moliospec");
    const b = await create("second.moliospec");
    const pa = (await readProject(a.target)).project;
    const pb = (await readProject(b.target)).project;
    expect(pa.project_guid).not.toBe(pb.project_guid);
    expect(pa.project_guid).not.toBe(templateGuid);
    expect(pb.project_guid).not.toBe(templateGuid);
  });

  it("stamps today's date and the app's own name", async () => {
    const now = new Date("2026-09-25T10:15:30.123Z");
    const { target } = await create("stamped.moliospec", {
      createdBySystem: "Spec Editor Community",
      now,
    });
    const { project } = await readProject(target);
    expect(project.created_date).toBe("2026-09-25T10:15:30.123Z");
    expect(project.created_by_system).toBe("Spec Editor Community");
  });

  it("seeds the default contracts into the project with the new identity", async () => {
    const { target, identity } = await create("seeded.moliospec", {
      contracts: [
        { code: "K01", name: "Jord" },
        { code: "K02", name: "Beton" },
      ],
    });
    const { project, contracts } = await readProject(target);
    expect(project.project_guid).toBe(identity.projectGuid);
    expect(contracts.map((c) => [c.contract_code, c.contract_name])).toEqual([
      ["K01", "Jord"],
      ["K02", "Beton"],
    ]);
  });

  it("still creates the project when seeding fails, with no half-seeded contracts", async () => {
    const errors: unknown[] = [];
    const { target, identity } = await create("seed-fails.moliospec", {
      contracts: [
        { code: "K01", name: "Jord" },
        // A getter that throws mid-way through the loop.
        {
          code: "K02",
          get name(): string {
            throw new Error("boom");
          },
        },
      ],
      onSeedError: (err) => errors.push(err),
    });
    expect(errors).toHaveLength(1);
    const { project, contracts } = await readProject(target);
    expect(project.project_guid).toBe(identity.projectGuid);
    expect(contracts).toEqual([]);
  });

  it("writes nothing when the identity step fails", async () => {
    const target = join(dir, "never.moliospec");
    await expect(
      createNewProjectFile(TEMPLATE, target, {
        createdBySystem: "",
        contracts: [],
        save: (h, p) => h.saveAs(p),
      }),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  it("never modifies the bundled template", async () => {
    const before = readFileSync(TEMPLATE);
    await create("template-untouched.moliospec");
    expect(readFileSync(TEMPLATE).equals(before)).toBe(true);
  });
});
