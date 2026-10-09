/**
 * Task 184 - "Gældende dato for referencer" is written from the
 * reference-list date.
 *
 * Self-check B2: finding the section (Molio's real variants, zero and
 * two matches, "<x>" further down left alone, the rest of the section
 * kept). Self-check B3: the date per description (BDB > work area >
 * project, and none).
 *
 * The HTML strings below are copied from real .moliospec files measured
 * on 2026-10-08 (only the date is varied).
 */
import { describe, expect, it } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import {
  setBdbField,
  setProjectField,
  setSectionBody,
  setWorkSpecField,
  stageSectionDelete,
  type EditMap,
} from "../src/renderer/src/edits.js";
import {
  buildDateTextSpecs,
  isReferencelistDateSection,
  planReferencelistDateText,
  referencelistDateLine,
  replaceReferencelistDateLine,
  specsWhoseDateChanged,
  type DateTextSpec,
  visibleText,
} from "../src/renderer/src/referencelistDateText.js";

const LINE = "<p>Gældende dato for referencer: 2026-10-08</p>";

/** Molio's variants of the section, as found in the files. */
const MOLIO = {
  entities: "<p>G&aelig;ldende dato for referencer: &lt;x&gt; </p>",
  spaceBeforeColon: "<p>Gældende dato for referencer : &lt;x&gt; </p>",
  yellowMark:
    '<p>Gældende dato for referencer : <mark class="bg-yellow">&lt;x&gt;</mark></p>',
  italicWithBreak:
    "<p><em>G&aelig;ldende dato for referencer:</em><em><br />\n&lt;x&gt;</em></p>",
  alreadyFilled: "<p>Gældende dato for referencer : 2022-08-26 </p>",
  plainNoParagraph: "Gældende dato for referencer: <br>\n31.11.2023",
};

/** The section continues with more text - 12 of 66 descriptions. */
const WITH_MORE =
  "<p>Gældende dato for referencer: &lt;x&gt;</p>" +
  "<p>Udover, de i referencelisten for basisbeskrivelsen angivne referencer, er følgende referencer gældende:</p>" +
  "<ul><li>&lt;x&gt;</li></ul>" +
  "<p>Tekst der er skrevet til</p>";
const REST_OF_WITH_MORE = WITH_MORE.slice(
  "<p>Gældende dato for referencer: &lt;x&gt;</p>".length,
);

/** The NEXT section, which also holds "<x>" - must never be touched. */
const NEXT_SECTION =
  "<p>Udover, de i referencelisten for basisbeskrivelsen angivne referencer, er følgende referencer gældende: &lt;x&gt;</p>";

function spec(
  sections: string[],
  date: string | null = "2026-10-08",
  id = 1,
): DateTextSpec {
  return {
    kind: "workSpec",
    id,
    name: `WA ${id}`,
    date,
    sections: sections.map((body, i) => ({
      id: id * 100 + i,
      body,
      diskBody: body,
    })),
  };
}

describe("B2 - finding the section", () => {
  it("recognises every Molio variant by its visible text", () => {
    for (const [name, body] of Object.entries(MOLIO)) {
      expect(isReferencelistDateSection(body), name).toBe(true);
    }
    expect(isReferencelistDateSection(WITH_MORE)).toBe(true);
  });

  it("does not take a section that only mentions the phrase later on", () => {
    expect(
      isReferencelistDateSection(
        "<p>Se afsnittet om Gældende dato for referencer: &lt;x&gt;</p>",
      ),
    ).toBe(false);
    expect(isReferencelistDateSection(NEXT_SECTION)).toBe(false);
    expect(isReferencelistDateSection("")).toBe(false);
  });

  it("decodes the entities Molio uses", () => {
    expect(visibleText(MOLIO.entities)).toBe(
      "Gældende dato for referencer: <x>",
    );
  });

  it("writes exactly the decided line for each Molio variant", () => {
    for (const [name, body] of Object.entries(MOLIO)) {
      expect(replaceReferencelistDateLine(body, "2026-10-08"), name).toBe(LINE);
    }
  });

  it("replaces only the date line and keeps the rest of the section (owner's decision 2026-10-08)", () => {
    expect(replaceReferencelistDateLine(WITH_MORE, "2026-10-08")).toBe(
      LINE + REST_OF_WITH_MORE,
    );
  });

  it("keeps what follows a plain-text date line", () => {
    const body =
      "Gældende dato for referencer: <br>\n31.11.2023<p>Mere tekst</p>";
    expect(replaceReferencelistDateLine(body, "2026-10-08")).toBe(
      LINE + "<p>Mere tekst</p>",
    );
  });

  it("refuses a date line that holds more than the date", () => {
    expect(
      replaceReferencelistDateLine(
        "<p>Gældende dato for referencer: 2022-08-26 men se også bilag 3</p>",
        "2026-10-08",
      ),
    ).toBeNull();
  });

  it("zero matches: the description is not touched", () => {
    const plan = planReferencelistDateText([spec(["<p>Omfang</p>"])]);
    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
  });

  it("two matches: nothing is touched, and the description is named", () => {
    const plan = planReferencelistDateText([
      spec([MOLIO.entities, MOLIO.spaceBeforeColon]),
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toEqual([{ kind: "workSpec", id: 1, name: "WA 1" }]);
  });

  it("'<x>' in the next section is never touched", () => {
    const plan = planReferencelistDateText([
      spec([MOLIO.entities, NEXT_SECTION]),
    ]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.sectionId).toBe(100);
    expect(plan.updates[0]!.newBody).toBe(LINE);
  });

  it("an unsafe date line is named, not touched", () => {
    const plan = planReferencelistDateText([
      spec(["<p>Gældende dato for referencer: 2022-08-26 se bilag</p>"]),
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.unsafe).toHaveLength(1);
  });

  it("no applicable date: nothing is touched (rule 4)", () => {
    const plan = planReferencelistDateText([spec([MOLIO.entities], null)]);
    expect(plan.updates).toEqual([]);
    expect(plan.unsafe).toEqual([]);
  });

  it("a line that already says exactly this is not counted (rule 5)", () => {
    const plan = planReferencelistDateText([spec([LINE])]);
    expect(plan.updates).toEqual([]);
    expect(plan.alreadyCorrect).toBe(1);
  });

  it("the line is the decided text", () => {
    expect(referencelistDateLine("2026-10-08")).toBe(LINE);
  });
});

/* ------------------------------------------------------------------ */
/*  B3 - the date per description                                     */
/* ------------------------------------------------------------------ */

function payload(opts: {
  projectDate?: string | null;
  wsDate?: string | null;
  bdbDate?: string | null;
}): FilePayload {
  const refs = (date: string | null | undefined) => ({
    referencelistArea: null,
    referencelistAreaDate: date ?? null,
  });
  return {
    project: { moliioReferencelistDate: opts.projectDate ?? null },
    workSpecs: [
      { id: 1, workAreaName: "Murværk", refs: refs(opts.wsDate) },
      { id: 2, workAreaName: "Tag", refs: refs(null) },
    ],
    bdbs: [
      {
        id: 10,
        name: "Formur",
        workSpecId: 1,
        pfbbId: null,
        refs: refs(opts.bdbDate),
      },
      { id: 11, name: "Bagmur", workSpecId: 1, pfbbId: null, refs: refs(null) },
      // A PFBB child - its text comes from the master.
      { id: 12, name: "Barn", workSpecId: 1, pfbbId: 10, refs: refs(null) },
    ],
    sectionsByWorkSpec: {
      1: [
        {
          id: 1,
          sectionNo: 1,
          heading: "Generelt",
          body: MOLIO.entities,
          parentId: null,
        },
      ],
      2: [
        {
          id: 2,
          sectionNo: 1,
          heading: "Generelt",
          body: MOLIO.entities,
          parentId: null,
        },
      ],
    },
    sectionsByBdb: {
      10: [
        {
          id: 20,
          sectionNo: 1,
          heading: "Generelt",
          body: MOLIO.entities,
          parentId: null,
        },
      ],
      11: [
        {
          id: 21,
          sectionNo: 1,
          heading: "Generelt",
          body: MOLIO.entities,
          parentId: null,
        },
      ],
      12: [
        {
          id: 22,
          sectionNo: 1,
          heading: "Generelt",
          body: MOLIO.entities,
          parentId: null,
        },
      ],
    },
  } as unknown as FilePayload;
}

const dateOf = (specs: DateTextSpec[], kind: string, id: number) =>
  specs.find((s) => s.kind === kind && s.id === id)?.date;

describe("B3 - the date that applies to each description", () => {
  it("BDB with its own date: the BDB's date wins", () => {
    const specs = buildDateTextSpecs(
      payload({
        projectDate: "2026-01-01",
        wsDate: "2025-06-01",
        bdbDate: "2024-03-03",
      }),
      {},
    );
    expect(dateOf(specs, "bdb", 10)).toBe("2024-03-03");
    expect(dateOf(specs, "bdb", 11)).toBe("2025-06-01");
  });

  it("work area with its own date: its BDBs inherit it, other areas get the project's", () => {
    const specs = buildDateTextSpecs(
      payload({ projectDate: "2026-01-01", wsDate: "2025-06-01" }),
      {},
    );
    expect(dateOf(specs, "workSpec", 1)).toBe("2025-06-01");
    expect(dateOf(specs, "bdb", 10)).toBe("2025-06-01");
    expect(dateOf(specs, "workSpec", 2)).toBe("2026-01-01");
  });

  it("only a project date: everything gets it", () => {
    const specs = buildDateTextSpecs(
      payload({ projectDate: "2026-01-01" }),
      {},
    );
    for (const s of specs) expect(s.date).toBe("2026-01-01");
  });

  it("no date anywhere: no date, and the plan touches nothing", () => {
    const specs = buildDateTextSpecs(payload({}), {});
    for (const s of specs) expect(s.date).toBeNull();
    expect(planReferencelistDateText(specs).updates).toEqual([]);
  });

  it("an unreadable date is skipped and the next level applies", () => {
    const specs = buildDateTextSpecs(
      payload({ projectDate: "2026-01-01", wsDate: "31.11.2023" }),
      {},
    );
    expect(dateOf(specs, "workSpec", 1)).toBe("2026-01-01");
  });

  it("reads pending (unsaved) dates and bodies, not only the disk", () => {
    let edits: EditMap = {};
    edits = setProjectField(
      edits,
      "g",
      "molioReferencelistDate",
      "2026-10-08",
      null,
    );
    edits = setBdbField(edits, 10, "referencelistAreaDate", "2024-03-03", null);
    edits = setSectionBody(
      edits,
      "workSpec",
      2,
      "<p>Omfang</p>",
      MOLIO.entities,
    );
    const specs = buildDateTextSpecs(payload({}), edits);
    expect(dateOf(specs, "workSpec", 1)).toBe("2026-10-08");
    expect(dateOf(specs, "bdb", 10)).toBe("2024-03-03");
    const plan = planReferencelistDateText(specs);
    // WA 2's section was edited away from the phrase, so it is not a match.
    expect(plan.updates.map((u) => `${u.kind}:${u.specId}`).sort()).toEqual([
      "bdb:10",
      "bdb:11",
      "workSpec:1",
    ]);
    // The disk body is handed on, so the edit helper can spot a revert.
    expect(plan.updates.find((u) => u.specId === 10)!.diskBody).toBe(
      MOLIO.entities,
    );
  });

  it("leaves out PFBB children and sections marked for deletion", () => {
    let edits: EditMap = {};
    edits = stageSectionDelete(edits, { specKind: "workSpec", sectionId: 1 });
    const specs = buildDateTextSpecs(
      payload({ projectDate: "2026-01-01" }),
      edits,
    );
    expect(specs.some((s) => s.kind === "bdb" && s.id === 12)).toBe(false);
    expect(
      specs.find((s) => s.kind === "workSpec" && s.id === 1)!.sections,
    ).toEqual([]);
  });

  it("'changed' mode: only descriptions whose applicable date changed", () => {
    const data = payload({ projectDate: "2026-01-01", wsDate: "2025-06-01" });
    const before = buildDateTextSpecs(data, {});
    // Change the project date: work area 1 and its BDBs keep 2025-06-01.
    const after = buildDateTextSpecs(
      data,
      setProjectField(
        {},
        "g",
        "molioReferencelistDate",
        "2026-10-08",
        "2026-01-01",
      ),
    );
    const changed = specsWhoseDateChanged(before, after);
    expect(changed.map((s) => `${s.kind}:${s.id}`)).toEqual(["workSpec:2"]);
  });

  it("a work-area date change reaches its BDBs that inherit", () => {
    const data = payload({ projectDate: "2026-01-01" });
    const before = buildDateTextSpecs(data, {});
    const after = buildDateTextSpecs(
      data,
      setWorkSpecField({}, 1, "referencelistAreaDate", "2025-06-01", null),
    );
    expect(
      specsWhoseDateChanged(before, after).map((s) => `${s.kind}:${s.id}`),
    ).toEqual(["workSpec:1", "bdb:10", "bdb:11"]);
  });
});
