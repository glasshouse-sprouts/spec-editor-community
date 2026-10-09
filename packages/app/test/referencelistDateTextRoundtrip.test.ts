/**
 * Task 184, self-check B4 - the rewritten "Gældende dato for referencer"
 * line survives save, close and reopen, for a work area and a BDB.
 *
 * The chain under test is the one the app uses: plan the line
 * (renderer) -> stage it as an ordinary section-body edit in the edit
 * map -> turn the map into save requests (`toEditRequestList`, what
 * the save IPC sends) -> core `applyEdits` -> write the file -> reopen.
 * The body is then read twice: through `readMoliospec`, and with raw SQL
 * against the reopened file. The raw query and its result are printed,
 * because "it saved" is worth nothing without the row to show for it.
 *
 * The synthetic sample has no such section, so the test first gives one
 * work-area section and one BDB section Molio's own text (copied from a
 * real file, 2026-10-08), with more text after the date line.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  applyEdits,
  openMoliospec,
  readMoliospec,
  type Edit,
} from "@molio2-editor/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  setSectionBody,
  toEditRequestList,
  type EditMap,
} from "../src/renderer/src/edits.js";
import {
  planReferencelistDateText,
  type DateTextSpec,
} from "../src/renderer/src/referencelistDateText.js";

const SAMPLE = resolve(
  __dirname,
  "../../../0900 Examples/synthetic-showoff-project.moliospec",
);

const MOLIO_WS =
  "<p>G&aelig;ldende dato for referencer: &lt;x&gt; </p>" +
  "<p>Udover, de i referencelisten for basisbeskrivelsen angivne referencer, er f&oslash;lgende referencer g&aelig;ldende:</p><ul><li>&lt;x&gt;</li></ul>";
const MOLIO_BDB =
  '<p>Gældende dato for referencer : <mark class="bg-yellow">&lt;x&gt;</mark></p>';

const RAW_QUERY = `
  select 'work_spec_section' as tbl, id, body
    from work_spec_section
   where id = ?
  union all
  select 'construction_element_spec_section' as tbl, id, body
    from construction_element_spec_section
   where id = ?
`;

describe("Task 184 B4 - the date line round-trips through save", () => {
  let workDir = "";
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-t184-"));
  });
  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("writes the line for a work area and a BDB, keeps the rest, and reads it back after reopen", async () => {
    const seeded = join(workDir, "seeded.moliospec");
    const saved = join(workDir, "saved.moliospec");

    // 1. Seed: give one WA section and one BDB section Molio's text.
    const ids = await (async () => {
      const h = await openMoliospec(SAMPLE);
      try {
        const d = readMoliospec(h);
        const wsSection = d.workSpecSections[0]!;
        const bdbSection = d.constructionElementSpecSections.find(
          (s) =>
            d.constructionElementSpecs.find(
              (b) => b.id === s.construction_element_spec_id,
            )?.pfbb_id == null,
        )!;
        applyEdits(h, [
          { target: "workSpec", sectionId: wsSection.id, body: MOLIO_WS },
          { target: "bdb", sectionId: bdbSection.id, body: MOLIO_BDB },
        ]);
        await h.saveAs(seeded);
        return {
          wsId: wsSection.work_spec_id,
          wsSectionId: wsSection.id,
          bdbId: bdbSection.construction_element_spec_id,
          bdbSectionId: bdbSection.id,
        };
      } finally {
        await h.close();
      }
    })();

    // 2. Plan + stage + save, the way the app does it.
    const h = await openMoliospec(seeded);
    try {
      const d = readMoliospec(h);
      const specs: DateTextSpec[] = [
        {
          kind: "workSpec",
          id: ids.wsId,
          name: "WA",
          date: "2026-10-08",
          sections: d.workSpecSections
            .filter((s) => s.work_spec_id === ids.wsId)
            .map((s) => ({ id: s.id, body: s.body, diskBody: s.body })),
        },
        {
          kind: "bdb",
          id: ids.bdbId,
          name: "BDB",
          date: "2024-03-03",
          sections: d.constructionElementSpecSections
            .filter((s) => s.construction_element_spec_id === ids.bdbId)
            .map((s) => ({ id: s.id, body: s.body, diskBody: s.body })),
        },
      ];
      const plan = planReferencelistDateText(specs);
      expect(plan.updates).toHaveLength(2);
      const edits: EditMap = plan.updates.reduce(
        (m, u) => setSectionBody(m, u.kind, u.sectionId, u.newBody, u.diskBody),
        {} as EditMap,
      );
      const result = applyEdits(h, toEditRequestList(edits) as Edit[]);
      expect(result.updated).toBe(2);
      await h.saveAs(saved);
    } finally {
      await h.close();
    }

    // 3. Reopen and read back - through the app's reader and raw SQL.
    const reopen = await openMoliospec(saved);
    try {
      const after = readMoliospec(reopen);
      const wsBody = after.workSpecSections.find(
        (s) => s.id === ids.wsSectionId,
      )?.body;
      const bdbBody = after.constructionElementSpecSections.find(
        (s) => s.id === ids.bdbSectionId,
      )?.body;
      expect(wsBody).toBe(
        "<p>Gældende dato for referencer: 2026-10-08</p>" +
          MOLIO_WS.slice(MOLIO_WS.indexOf("</p>") + 4),
      );
      expect(bdbBody).toBe("<p>Gældende dato for referencer: 2024-03-03</p>");

      const rows = reopen.db
        .prepare(RAW_QUERY)
        .all(ids.wsSectionId, ids.bdbSectionId);
      console.log("B4 query:", RAW_QUERY.trim());
      console.log("B4 result:", JSON.stringify(rows));
      expect(rows).toEqual([
        { tbl: "work_spec_section", id: ids.wsSectionId, body: wsBody },
        {
          tbl: "construction_element_spec_section",
          id: ids.bdbSectionId,
          body: bdbBody,
        },
      ]);
    } finally {
      await reopen.close();
    }
  });
});
