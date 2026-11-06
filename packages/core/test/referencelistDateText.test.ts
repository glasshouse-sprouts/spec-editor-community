/**
 * Card 188 - the core copy of the "Gældende dato for referencer" rule.
 *
 * The text functions are the renderer's, word for word; their parity
 * with the renderer copy is tested in
 * `packages/mcp-server/test/referencelistDateTextParity.test.ts`
 * (core tests do not reach into the app). What is only here is
 * `buildDateTextSpecsFromFile`, tested below: the date per description
 * (BDB > work area > project) and which descriptions are left out.
 */
import { describe, expect, it } from "vitest";

import {
  buildDateTextSpecsFromFile,
  planReferencelistDateText,
  specsWhoseDateChanged,
} from "../src/referencelistDateText.js";
import type { MoliospecFile } from "../src/types.js";

const DATE_SECTION = "<p>Gældende dato for referencer: &lt;x&gt;</p>";

/** The few columns the builder reads; the rest of the file is empty. */
function file(): MoliospecFile {
  return {
    workSpecs: [
      {
        id: 1,
        work_area_name: "Uden egen dato",
        molio_referencelist_area_date: null,
      },
      {
        id: 2,
        work_area_name: "Med egen dato",
        molio_referencelist_area_date: "2025-01-01",
      },
    ],
    workSpecSections: [
      { id: 10, work_spec_id: 1, body: DATE_SECTION },
      { id: 20, work_spec_id: 2, body: DATE_SECTION },
    ],
    constructionElementSpecs: [
      {
        id: 1,
        name: "Arver fra arbejdsbeskrivelse",
        work_spec_id: 2,
        pfbb_id: null,
        molio_referencelist_area_date: null,
      },
      {
        id: 2,
        name: "Egen dato",
        work_spec_id: 1,
        pfbb_id: null,
        molio_referencelist_area_date: "2024-06-30",
      },
      {
        id: 3,
        name: "PFBB-barn",
        work_spec_id: 1,
        pfbb_id: 1,
        molio_referencelist_area_date: null,
      },
    ],
    constructionElementSpecSections: [
      { id: 100, construction_element_spec_id: 1, body: DATE_SECTION },
      { id: 300, construction_element_spec_id: 3, body: DATE_SECTION },
    ],
  } as unknown as MoliospecFile;
}

describe("buildDateTextSpecsFromFile", () => {
  it("resolves the date per description: BDB > work area > project", () => {
    const specs = buildDateTextSpecsFromFile(file(), "2026-11-03");
    const dates = Object.fromEntries(
      specs.map((s) => [`${s.kind}:${s.id}`, s.date]),
    );
    expect(dates).toEqual({
      "workSpec:1": "2026-11-03",
      "workSpec:2": "2025-01-01",
      "bdb:1": "2025-01-01",
      "bdb:2": "2024-06-30",
    });
  });

  it("leaves PFBB children out", () => {
    const specs = buildDateTextSpecsFromFile(file(), "2026-11-03");
    expect(specs.some((s) => s.kind === "bdb" && s.id === 3)).toBe(false);
  });

  it("gives no date for a project value that is not YYYY-MM-DD", () => {
    const specs = buildDateTextSpecsFromFile(file(), "31.11.2023");
    expect(specs.find((s) => s.kind === "workSpec" && s.id === 1)?.date).toBe(
      null,
    );
  });

  it("a new project date only reaches descriptions without their own", () => {
    const changed = specsWhoseDateChanged(
      buildDateTextSpecsFromFile(file(), null),
      buildDateTextSpecsFromFile(file(), "2026-11-03"),
    );
    expect(changed.map((s) => `${s.kind}:${s.id}`)).toEqual(["workSpec:1"]);
    expect(planReferencelistDateText(changed).updates).toEqual([
      {
        kind: "workSpec",
        specId: 1,
        specName: "Uden egen dato",
        sectionId: 10,
        date: "2026-11-03",
        newBody: "<p>Gældende dato for referencer: 2026-11-03</p>",
        diskBody: DATE_SECTION,
      },
    ]);
  });
});
