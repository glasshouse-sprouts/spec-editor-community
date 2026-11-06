/**
 * Task 105 - `applyEdits` sanitizes every section body it writes.
 *
 * The card's acceptance test, done in core (a test through the MCP
 * tools belongs to the MCP lane):
 *   1. A body with <script>, onerror= and a javascript: URL is written,
 *      the file saved and reopened: all three are gone. This is the
 *      path `edit_section_body` uses (a workSpec / bdb body edit).
 *   2. The same for a new section, along the path `create_section`
 *      uses in core: `sectionCreate`, then a body edit. The PFBB
 *      supplement edit, the third body write, is covered too.
 *   3. A body over the limit is refused with SectionBodyTooLongError,
 *      and nothing in the batch is written.
 *   4. Ordinary formatting - bold, italic, lists, tables - comes back
 *      byte for byte.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyEdits,
  CoreError,
  openMoliospec,
  readMoliospec,
  SECTION_BODY_MAX_LENGTH,
  SectionBodyTooLongError,
  type MoliospecFile,
  type MoliospecHandle,
} from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();
const showoff = samples.find((s) => s.label.toLowerCase().includes("showoff"));
const pfbbSample = samples.find((s) => /projektfaelles/i.test(s.label));

const HOSTILE =
  "<p>Behold mig</p>" +
  "<script>alert('script')</script>" +
  '<p><img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)"></p>' +
  '<p><a href="javascript:alert(2)">klik</a></p>';
const HOSTILE_CLEANED =
  "<p>Behold mig</p>" +
  '<p><img src="data:image/png;base64,iVBORw0KGgo="></p>' +
  "<p><a>klik</a></p>";

const FORMATTED =
  "<p><strong>fed</strong>, <em>kursiv</em>, <u>understreget</u></p>" +
  "<ul><li>punkt<ul><li>underpunkt</li></ul></li></ul>" +
  "<ol><li>nummer</li></ol>" +
  '<table><tbody><tr><th data-width="120">Felt</th><td>Værdi &amp; mere</td></tr></tbody></table>';

let workDir = "";
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "moliospec-sanitize-"));
});
afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** Save to a temp path, reopen, and read the file back. */
async function saveAndReread(
  h: MoliospecHandle,
  name: string,
): Promise<MoliospecFile> {
  const out = join(workDir, name);
  await h.saveAs(out);
  await h.close();
  const reopened = await openMoliospec(out);
  try {
    return readMoliospec(reopened);
  } finally {
    await reopened.close();
  }
}

describe("Task 105 - applyEdits sanitizes section bodies", () => {
  it("1. strips script, onerror and javascript: from a body edit (edit_section_body path)", async () => {
    expect(showoff).toBeDefined();
    const h = await openMoliospec(showoff!.path);
    const file = readMoliospec(h);
    const ws = file.workSpecSections[0]!;
    const bdb = file.constructionElementSpecSections[0]!;
    applyEdits(h, [
      { target: "workSpec", sectionId: ws.id, body: HOSTILE },
      { target: "bdb", sectionId: bdb.id, body: HOSTILE },
    ]);
    const reread = await saveAndReread(h, "hostile-edit.moliospec");
    for (const body of [
      reread.workSpecSections.find((s) => s.id === ws.id)!.body,
      reread.constructionElementSpecSections.find((s) => s.id === bdb.id)!.body,
    ]) {
      expect(body).toBe(HOSTILE_CLEANED);
      expect(body).not.toMatch(/script|onerror|javascript:/i);
    }
  });

  it("2. strips them from a new section's body (create_section path)", async () => {
    const h = await openMoliospec(showoff!.path);
    const before = readMoliospec(h);
    const bdbId = before.constructionElementSpecs[0]!.id;
    const beforeIds = new Set(
      before.constructionElementSpecSections.map((s) => s.id),
    );
    applyEdits(h, [
      {
        target: "sectionCreate",
        specKind: "bdb",
        specId: bdbId,
        parentId: null,
        insertAfterSectionNo: null,
        heading: "Nyt afsnit",
      },
    ]);
    const created = readMoliospec(h).constructionElementSpecSections.find(
      (s) => !beforeIds.has(s.id),
    )!;
    expect(created.body).toBe("");
    applyEdits(h, [{ target: "bdb", sectionId: created.id, body: HOSTILE }]);
    const reread = await saveAndReread(h, "hostile-create.moliospec");
    const row = reread.constructionElementSpecSections.find(
      (s) => s.id === created.id,
    )!;
    expect(row.heading).toBe("Nyt afsnit");
    expect(row.body).toBe(HOSTILE_CLEANED);
  });

  it("2b. strips them from a PFBB supplement (bdbSectionCreate)", async () => {
    expect(pfbbSample).toBeDefined();
    const h = await openMoliospec(pfbbSample!.path);
    const file = readMoliospec(h);
    const child = file.constructionElementSpecs.find((b) => b.pfbb_id != null);
    expect(child).toBeDefined();
    const taken = new Set(
      file.constructionElementSpecSections
        .filter((s) => s.construction_element_spec_id === child!.id)
        .map((s) => s.pfbb_section_id),
    );
    const master = file.constructionElementSpecSections.find(
      (s) =>
        s.construction_element_spec_id === child!.pfbb_id && !taken.has(s.id),
    );
    expect(master).toBeDefined();
    applyEdits(h, [
      {
        target: "bdbSectionCreate",
        bdbId: child!.id,
        pfbbSectionId: master!.id,
        sectionNo: String(master!.section_no ?? "0"),
        body: HOSTILE,
      },
    ]);
    const reread = await saveAndReread(h, "hostile-supplement.moliospec");
    const row = reread.constructionElementSpecSections.find(
      (s) =>
        s.construction_element_spec_id === child!.id &&
        s.pfbb_section_id === master!.id,
    )!;
    expect(row.body).toBe(HOSTILE_CLEANED);
  });

  it("3. refuses a body over the limit and writes nothing in the batch", async () => {
    const h = await openMoliospec(showoff!.path);
    try {
      const file = readMoliospec(h);
      const [a, b] = file.workSpecSections;
      const tooLong = "<p>" + "x".repeat(SECTION_BODY_MAX_LENGTH) + "</p>";
      let thrown: unknown;
      try {
        applyEdits(h, [
          { target: "workSpec", sectionId: a!.id, body: "<p>ny tekst</p>" },
          { target: "workSpec", sectionId: b!.id, body: tooLong },
        ]);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(SectionBodyTooLongError);
      expect(thrown).toBeInstanceOf(CoreError);
      const e = thrown as SectionBodyTooLongError;
      expect(e.code).toBe("SECTION_BODY_TOO_LONG");
      expect(e.length).toBe(tooLong.length);
      expect(e.limit).toBe(SECTION_BODY_MAX_LENGTH);
      expect(e.message).toMatch(
        /\[MOLIO_ERR:SECTION_BODY_TOO_LONG:length=\d+,limit=20971520\]/,
      );
      const after = readMoliospec(h);
      expect(after.workSpecSections.find((s) => s.id === a!.id)!.body).toBe(
        a!.body,
      );
    } finally {
      await h.close();
    }
  });

  it("3b. accepts a body exactly at the limit", async () => {
    const h = await openMoliospec(showoff!.path);
    try {
      const ws = readMoliospec(h).workSpecSections[0]!;
      const atLimit = "x".repeat(SECTION_BODY_MAX_LENGTH);
      expect(() =>
        applyEdits(h, [
          { target: "workSpec", sectionId: ws.id, body: atLimit },
        ]),
      ).not.toThrow();
    } finally {
      await h.close();
    }
  });

  it("4. leaves ordinary formatting byte for byte", async () => {
    const h = await openMoliospec(showoff!.path);
    const ws = readMoliospec(h).workSpecSections[0]!;
    applyEdits(h, [{ target: "workSpec", sectionId: ws.id, body: FORMATTED }]);
    const reread = await saveAndReread(h, "formatted.moliospec");
    expect(reread.workSpecSections.find((s) => s.id === ws.id)!.body).toBe(
      FORMATTED,
    );
  });
});
