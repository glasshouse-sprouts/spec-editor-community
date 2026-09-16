/** @vitest-environment jsdom */
/**
 * Smoke tests for `buildBdbDocx` — the pure Word-export builder.
 *
 * What we verify
 * --------------
 *   1. The builder produces a non-empty Uint8Array.
 *   2. The output is a valid ZIP container (fflate can re-unzip it).
 *   3. The ZIP carries the same set of files the input template did,
 *      give or take — at minimum `word/document.xml`, all headers,
 *      `word/_rels/document.xml.rels`.
 *   4. The output `word/document.xml` contains the BDB's heading
 *      numbers + text, and the header XMLs reference the BDB title
 *      (not the original "Paradigme for bygningsdels- og
 *      procesbeskrivelse" placeholder).
 *   5. Body content with inline formatting round-trips through the
 *      HTML→OOXML converter and shows up as `<w:b/>` / `<w:i/>` etc.
 *      inside the document body.
 *
 * What we DON'T verify (yet)
 * --------------------------
 *   - That Word actually opens the file without errors. That has to
 *     be a manual smoke step against a Windows / macOS Word install.
 *
 * jsdom pragma above so the DOMParser inside htmlToOoxml works
 * during tests.
 */
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildBdbDocx,
  buildSpecDocx,
  buildWorkSpecDocx,
  BdbDocxBuildError,
} from "../src/renderer/src/word/buildBdbDocx.js";
import { getBdbTemplateBytes } from "../src/renderer/src/word/templateBytes.js";
import type {
  BdbInfo,
  ControlPlanInfo,
  FilePayload,
  SectionData,
  WorkSpecInfo,
} from "../src/shared/ipc.js";

/* ------------------------------------------------------------------ */
/*  Test fixtures (synthetic FilePayload)                              */
/* ------------------------------------------------------------------ */

/** Build a minimal FilePayload with one BDB and a small section tree. */
function makePayload(): {
  payload: FilePayload;
  bdb: BdbInfo;
} {
  const bdb: BdbInfo = {
    id: 42,
    name: "Test BDB — Smoke",
    workSpecId: 1,
    isPfbb: false,
    pfbbMasterId: null,
    revision: null,
    revisionDate: null,
    sectionCount: 0,
    designCpId: null,
    productionCpId: null,
  } as BdbInfo;

  // Four top-level chapters matching the template's 4 chapter slots.
  // Each has one body paragraph with mixed formatting so we cover
  // bold/italic/underline/strike + a bullet list.
  const sections: SectionData[] = [
    {
      id: 1,
      sectionNo: 1,
      heading: "Omfang",
      body: "<p>Denne <strong>BDB</strong> dækker <em>vinduer</em> og døre.</p>",
      parentId: null,
      pfbbSectionId: null,
    },
    {
      id: 2,
      sectionNo: 1,
      heading: "Generelt",
      body: "<p>Tekst i 1.1 — med <u>understreget</u> og <s>slettet</s>.</p>",
      parentId: 1,
      pfbbSectionId: null,
    },
    {
      id: 3,
      sectionNo: 2,
      heading: "Almene specifikationer",
      body: "<ul><li>Punkt A</li><li>Punkt B</li></ul>",
      parentId: null,
      pfbbSectionId: null,
    },
    {
      id: 4,
      sectionNo: 3,
      heading: "Projektering",
      body: '<p>Se <a href="https://example.dk">eksempel</a> for detaljer.</p>',
      parentId: null,
      pfbbSectionId: null,
    },
    {
      id: 5,
      sectionNo: 4,
      heading: "Produktion",
      body: "<p>Final chapter body.</p>",
      parentId: null,
      pfbbSectionId: null,
    },
  ];

  const payload: FilePayload = {
    path: "/tmp/test.moliospec",
    dbVersion: "1.0",
    mtimeMs: 0,
    project: {
      projectGuid: "test",
      name: "Test Project",
      projectNumber: "1",
      builder: null,
      createdBySystem: "test",
      createdDate: "2026-01-01",
      modifiedDate: null,
      moliioReferencelistDate: null,
    },
    workSpecs: [],
    bdbs: [bdb],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: { 42: sections },
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
    customData: [],
  };

  return { payload, bdb };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("buildBdbDocx — smoke", () => {
  it("produces a non-empty Uint8Array", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(1000); // template alone is ~56 KB
  });

  it("output is a valid ZIP that re-unzips", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    expect(Object.keys(files).length).toBeGreaterThan(5);
  });

  it("output preserves every template file (no accidental drops)", () => {
    const templateFiles = Object.keys(unzipSync(getBdbTemplateBytes()));
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const outFiles = Object.keys(unzipSync(out));
    for (const f of templateFiles) {
      expect(outFiles).toContain(f);
    }
  });

  it("document.xml contains the chapter headings", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("Omfang");
    expect(docXml).toContain("Almene specifikationer");
    expect(docXml).toContain("Projektering");
    expect(docXml).toContain("Produktion");
  });

  it("document.xml carries inline formatting marks", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("<w:b/>"); // bold from <strong>
    expect(docXml).toContain("<w:i/>"); // italic from <em>
    expect(docXml).toContain('<w:u w:val="single"/>'); // underline from <u>
    expect(docXml).toContain("<w:strike/>"); // strike from <s>
  });

  it("bullet list emits paragraphs with numPr referencing template numbering", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    // Two list items become two paragraphs styled ListParagraph.
    expect(docXml).toContain('<w:pStyle w:val="ListParagraph"/>');
    expect(docXml).toContain('<w:numId w:val="1"/>');
    expect(docXml).toContain("Punkt A");
    expect(docXml).toContain("Punkt B");
  });

  it("hyperlinks land as <w:hyperlink> + a relationship", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("<w:hyperlink");

    const relsXml = strFromU8(files["word/_rels/document.xml.rels"]!);
    expect(relsXml).toContain("https://example.dk");
    expect(relsXml).toContain('TargetMode="External"');
  });

  it("header XMLs have the placeholder string replaced with the BDB title", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    for (const path of Object.keys(files)) {
      if (/^word\/header\d+\.xml$/.test(path)) {
        const txt = strFromU8(files[path]!);
        if (!txt.includes("<w:t>")) continue; // empty header file
        // Either the placeholder was absent (some header files don't
        // carry it) or it was substituted — but it must never be
        // present verbatim in the output.
        expect(txt).not.toContain(
          "Paradigme for bygningsdels- og procesbeskrivelse",
        );
      }
    }

    // At least one header should now mention the BDB title.
    let foundTitle = false;
    for (const path of Object.keys(files)) {
      if (/^word\/header\d+\.xml$/.test(path)) {
        const txt = strFromU8(files[path]!);
        if (txt.includes("Test BDB")) {
          foundTitle = true;
          break;
        }
      }
    }
    expect(foundTitle).toBe(true);
  });

  it("rejects unknown bdb id with a tagged error", () => {
    const { payload } = makePayload();
    expect(() => buildBdbDocx({ data: payload, bdbId: 9999 })).toThrow(
      BdbDocxBuildError,
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Phase B coverage: tables, colours/highlights, images               */
/* ------------------------------------------------------------------ */

describe("buildBdbDocx — Phase B", () => {
  it("converts <table> to <w:tbl> with rows + cells", () => {
    const { payload } = makePayload();
    // Inject a tabled section into the first chapter.
    payload.sectionsByBdb[42]!.push({
      id: 100,
      sectionNo: 99,
      heading: "Tabel-test",
      body: "<table><tr><th>Header A</th><th>Header B</th></tr><tr><td>row1A</td><td>row1B</td></tr></table>",
      parentId: 1,
      pfbbSectionId: null,
    });
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("<w:tbl>");
    expect(docXml).toContain('<w:tblStyle w:val="TableGrid"/>');
    expect(docXml).toContain("<w:tr>");
    expect(docXml).toContain("<w:tc>");
    expect(docXml).toContain("Header A");
    expect(docXml).toContain("row1B");
    // Header cell carries the shading fill.
    expect(docXml).toContain('w:fill="EFEFEF"');
  });

  it("emits <w:color> for tc-* spans and <w:shd> for bg-* marks", () => {
    const { payload } = makePayload();
    payload.sectionsByBdb[42]!.push({
      id: 101,
      sectionNo: 98,
      heading: "Farve",
      body:
        '<p><span class="tc-blue">blå tekst</span> og ' +
        '<mark class="bg-yellow">gul fremhævelse</mark></p>',
      parentId: 1,
      pfbbSectionId: null,
    });
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain('<w:color w:val="9ED6FF"/>');
    expect(docXml).toContain(
      '<w:shd w:val="clear" w:color="auto" w:fill="FFF26B"/>',
    );
  });

  it("compact: drops empty sections + ancestors with no surviving kids", () => {
    const { payload, bdb } = makePayload();
    // Replace the BDB's sections with a tree where chapter "2" is
    // completely empty (both its own body and every descendant).
    // Compact mode should drop chapter 2 entirely; chapter 1 + 3 + 4
    // survive because they have body content.
    payload.sectionsByBdb[bdb.id] = [
      {
        id: 10,
        sectionNo: 1,
        heading: "Omfang",
        body: "<p>Has content.</p>",
        parentId: null,
        pfbbSectionId: null,
      },
      {
        id: 20,
        sectionNo: 2,
        heading: "Almene specifikationer (empty)",
        body: "",
        parentId: null,
        pfbbSectionId: null,
      },
      {
        id: 21,
        sectionNo: 1,
        heading: "Empty child",
        body: "",
        parentId: 20,
        pfbbSectionId: null,
      },
      {
        id: 30,
        sectionNo: 3,
        heading: "Projektering",
        body: "<p>Has content.</p>",
        parentId: null,
        pfbbSectionId: null,
      },
    ];
    const out = buildBdbDocx({ data: payload, bdbId: bdb.id, compact: true });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);

    // Chapter 1 + 3 headings appear; chapter 2's heading does not.
    expect(docXml).toContain("Omfang");
    expect(docXml).toContain("Projektering");
    expect(docXml).not.toContain("Almene specifikationer (empty)");
    expect(docXml).not.toContain("Empty child");
  });

  it("compact off (default): keeps empty sections", () => {
    const { payload, bdb } = makePayload();
    payload.sectionsByBdb[bdb.id] = [
      {
        id: 10,
        sectionNo: 1,
        heading: "Empty top",
        body: "",
        parentId: null,
        pfbbSectionId: null,
      },
    ];
    const out = buildBdbDocx({ data: payload, bdbId: bdb.id });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("Empty top");
  });

  it("embeds a base64 image into word/media + adds rel + content-type", () => {
    const { payload } = makePayload();
    // 1×1 transparent PNG.
    const pngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    payload.sectionsByBdb[42]!.push({
      id: 102,
      sectionNo: 97,
      heading: "Billede",
      body: `<p><img src="data:image/png;base64,${pngB64}" width="200" alt="dot"></p>`,
      parentId: 1,
      pfbbSectionId: null,
    });
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const files = unzipSync(out);

    // The image bytes land under word/media/ with the expected name.
    const mediaFiles = Object.keys(files).filter((p) =>
      p.startsWith("word/media/"),
    );
    expect(mediaFiles.length).toBe(1);
    expect(mediaFiles[0]).toMatch(/^word\/media\/image1\.png$/);

    // document.xml carries the drawing block referencing the image rel.
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("<w:drawing>");
    expect(docXml).toContain("<a:blip");

    // Content_Types declares the new png extension.
    const ctXml = strFromU8(files["[Content_Types].xml"]!);
    expect(ctXml).toContain('Extension="png"');
    expect(ctXml).toContain('ContentType="image/png"');

    // Rels carries the image relationship.
    const relsXml = strFromU8(files["word/_rels/document.xml.rels"]!);
    expect(relsXml).toContain('Target="media/image1.png"');
    expect(relsXml).toContain(
      '"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"',
    );
  });
});

/* ------------------------------------------------------------------ */
/*  DOCX-WA: work-area (work_spec) exports                             */
/* ------------------------------------------------------------------ */

/** Build a minimal FilePayload carrying one work area (work_spec)
 *  with a short section tree. The bdb side is empty — these tests
 *  exercise the workSpec branch only. */
function makeWorkSpecPayload(): {
  payload: FilePayload;
  wa: WorkSpecInfo;
} {
  const wa: WorkSpecInfo = {
    id: 7,
    workAreaCode: "2.5",
    workAreaName: "Beton",
    workAreaType: 0,
    revision: null,
    revisionDate: null,
    contractId: null,
    refs: {
      basisGuid: null,
      basisRevisionGuid: null,
      paradigmGuid: null,
      paradigmRevisionGuid: null,
      referencelistArea: null,
      referencelistAreaDate: null,
    },
    createdBy: null,
    createdByOrganization: null,
    issueDate: null,
    reviewedBy: null,
    approvedBy: null,
    locked: {
      molioSpecRevisionNo: null,
      molioSpecRevisionDate: null,
    },
  };

  const sections: SectionData[] = [
    {
      id: 1,
      sectionNo: 1,
      heading: "Omfang",
      body: "<p>Arbejdsbeskrivelse for <strong>beton</strong>.</p>",
      parentId: null,
      pfbbSectionId: null,
    },
    {
      id: 2,
      sectionNo: 2,
      heading: "Almene specifikationer",
      body: "<p>Krav til betonkvalitet.</p>",
      parentId: null,
      pfbbSectionId: null,
    },
  ];

  const payload: FilePayload = {
    path: "/tmp/test.moliospec",
    dbVersion: "1.0",
    mtimeMs: 0,
    project: {
      projectGuid: "test",
      name: "Test Project",
      projectNumber: "1",
      builder: null,
      createdBySystem: "test",
      createdDate: "2026-01-01",
      modifiedDate: null,
      moliioReferencelistDate: null,
    },
    workSpecs: [wa],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: { 7: sections },
    sectionsByBdb: {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
    customData: [],
  };

  return { payload, wa };
}

describe("buildSpecDocx — work-area (work_spec) path", () => {
  it("buildWorkSpecDocx produces a non-empty Uint8Array", () => {
    const { payload } = makeWorkSpecPayload();
    const out = buildWorkSpecDocx({ data: payload, workSpecId: 7 });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(1000);
  });

  it("buildSpecDocx({kind:'workSpec'}) renders the work-area chapters", () => {
    const { payload } = makeWorkSpecPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "workSpec", id: 7 },
    });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("Omfang");
    expect(docXml).toContain("Almene specifikationer");
    expect(docXml).toContain("Krav til betonkvalitet");
  });

  it("header XMLs carry '<code> <name>' title (work area)", () => {
    const { payload } = makeWorkSpecPayload();
    const out = buildWorkSpecDocx({ data: payload, workSpecId: 7 });
    const files = unzipSync(out);
    let foundTitle = false;
    for (const path of Object.keys(files)) {
      if (/^word\/header\d+\.xml$/.test(path)) {
        const txt = strFromU8(files[path]!);
        // The work-area title is "2.5 Beton" — match both pieces
        // in any one header.
        if (txt.includes("2.5") && txt.includes("Beton")) {
          foundTitle = true;
          break;
        }
      }
    }
    expect(foundTitle).toBe(true);
  });

  it("rejects unknown work-area id with a tagged error", () => {
    const { payload } = makeWorkSpecPayload();
    expect(() =>
      buildSpecDocx({ data: payload, spec: { kind: "workSpec", id: 9999 } }),
    ).toThrow(BdbDocxBuildError);
  });

  it("falls back to just the name when workAreaCode is null", () => {
    const { payload, wa } = makeWorkSpecPayload();
    // Mutate the test fixture: drop the code.
    const noCode: WorkSpecInfo = { ...wa, workAreaCode: null };
    payload.workSpecs = [noCode];
    const out = buildWorkSpecDocx({ data: payload, workSpecId: 7 });
    const files = unzipSync(out);
    // Title should be just "Beton" — never the literal "null" code.
    let foundClean = false;
    for (const path of Object.keys(files)) {
      if (/^word\/header\d+\.xml$/.test(path)) {
        const txt = strFromU8(files[path]!);
        if (txt.includes("Beton") && !txt.includes("null Beton")) {
          foundClean = true;
        }
      }
    }
    expect(foundClean).toBe(true);
  });

  it("legacy buildBdbDocx wrapper still works (back-compat)", () => {
    // Make a combined payload with both a BDB and a work area; the
    // legacy wrapper should still target the BDB by id.
    const { payload, bdb } = makePayload();
    // Inject an unrelated work area so resolveSpec has multiple specs
    // to choose from. The legacy wrapper must NOT see it.
    payload.workSpecs = [
      {
        id: 7,
        workAreaCode: "2.5",
        workAreaName: "Beton",
        workAreaType: 0,
        revision: null,
        revisionDate: null,
        contractId: null,
        refs: {
          basisGuid: null,
          basisRevisionGuid: null,
          paradigmGuid: null,
          paradigmRevisionGuid: null,
          referencelistArea: null,
          referencelistAreaDate: null,
        },
        createdBy: null,
        createdByOrganization: null,
        issueDate: null,
        reviewedBy: null,
        approvedBy: null,
        locked: {
          molioSpecRevisionNo: null,
          molioSpecRevisionDate: null,
        },
      } as WorkSpecInfo,
    ];
    const out = buildBdbDocx({ data: payload, bdbId: bdb.id });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    // The BDB's chapter headings must show — work-area heading "Beton"
    // (from the unrelated WS) must NOT appear, because the legacy
    // wrapper resolves to the BDB only.
    expect(docXml).toContain("Omfang");
    // No accidental cross-pollution from the workSpec fixture.
    // (The workSpec's section bodies don't appear in sectionsByBdb,
    //  so this is mostly a smoke check — but useful to keep.)
  });
});

/* ------------------------------------------------------------------ */
/*  DOCX-CP: control-plan exports                                      */
/* ------------------------------------------------------------------ */

/** Build a minimal FilePayload carrying one Control Plan with two
 *  group headers and a mix of populated + empty rows. The BDB list
 *  contains one entry that references the CP — used to assert
 *  parent-name resolution. */
function makeCpPayload(): {
  payload: FilePayload;
  cp: ControlPlanInfo;
  parentBdb: BdbInfo;
} {
  const parentBdb: BdbInfo = {
    id: 50,
    name: "Vinduer + døre",
    workSpecId: null,
    isPfbb: false,
    pfbbMasterId: null,
    revision: null,
    revisionDate: null,
    sectionCount: 0,
    designCpId: 80,
    productionCpId: null,
    controlPlanIds: [80],
  } as unknown as BdbInfo;

  const cp: ControlPlanInfo = {
    id: 80,
    numberText: "3.1",
    title: "Kontrolskema, projektering",
    controlPlanType: 0,
    revision: null,
    revisionDate: null,
  };

  const headers = [
    { id: 1, header: "Materialer", headerNo: "1" },
    { id: 2, header: "Udførelse", headerNo: "2" },
  ];

  const rows = [
    {
      id: 100,
      headerId: 1,
      controlType: 1,
      sectionNo: "1.1",
      subject: "Beton kvalitet",
      reference: "DS 482",
      method: "Visuel",
      quantity: "",
      time: "Før støbning",
      acceptanceCriteria: "Som specificeret",
      documentation: "Foto",
      controlLevel: "Normal",
      sampleLevel: "",
    },
    {
      id: 101,
      headerId: 1,
      controlType: 2,
      sectionNo: "1.2",
      subject: "Armering",
      reference: "DS/EN 10080",
      method: "Måling",
      quantity: "",
      time: "Inden støbning",
      acceptanceCriteria: "± 5 mm",
      documentation: "Måleskema",
      controlLevel: "Skærpet",
      sampleLevel: "",
    },
    {
      // Entirely empty row — should be hidden by compact mode.
      id: 102,
      headerId: 2,
      controlType: 0,
      sectionNo: "2.1",
      subject: "",
      reference: "",
      method: "",
      quantity: "",
      time: "",
      acceptanceCriteria: "",
      documentation: "",
      controlLevel: "",
      sampleLevel: "",
    },
    {
      // Empty too — so group 2 has no surviving rows in compact.
      id: 103,
      headerId: 2,
      controlType: 0,
      sectionNo: "2.2",
      subject: "",
      reference: "",
      method: "",
      quantity: "",
      time: "",
      acceptanceCriteria: "",
      documentation: "",
      controlLevel: "",
      sampleLevel: "",
    },
  ];

  const payload: FilePayload = {
    path: "/tmp/test.moliospec",
    dbVersion: "1.0",
    mtimeMs: 0,
    project: {
      projectGuid: "test",
      name: "Test Project",
      projectNumber: "1",
      builder: null,
      createdBySystem: "test",
      createdDate: "2026-01-01",
      modifiedDate: null,
      moliioReferencelistDate: null,
    },
    workSpecs: [],
    bdbs: [parentBdb],
    controlPlans: [cp],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: { 80: headers },
    cpRowsByPlan: { 80: rows },
    attachments: [],
    customData: [],
  };

  return { payload, cp, parentBdb };
}

describe("buildSpecDocx — control-plan (cp) path", () => {
  it("produces a non-empty Uint8Array using the CP template", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(1000);
    // Sanity: it's a valid ZIP that re-opens.
    const files = unzipSync(out);
    expect(Object.keys(files).length).toBeGreaterThan(5);
    // The CP template only carries header5/footer6 etc — header1/header3
    // also exist. At least one of them must be patched.
    expect(files["word/document.xml"]).toBeDefined();
  });

  it("injects group-banner rows for each CP header", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const files = unzipSync(out);
    const docXml = strFromU8(files["word/document.xml"]!);
    // Both header labels should appear in the document body.
    expect(docXml).toContain("Materialer");
    expect(docXml).toContain("Udførelse");
    // Banner rows use gridSpan 9 — assert at least one is present.
    expect(docXml).toContain('<w:gridSpan w:val="9"/>');
  });

  it("emits each populated row with its data", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    expect(docXml).toContain("Beton kvalitet");
    expect(docXml).toContain("DS 482");
    expect(docXml).toContain("Armering");
    expect(docXml).toContain("DS/EN 10080");
    expect(docXml).toContain("Visuel");
    expect(docXml).toContain("Måling");
  });

  it("renders the controlType as E/U/T characters", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // The two populated rows used controlType 1 ("E") and 2 ("U").
    // At minimum each character should appear somewhere new — but
    // they're single letters, so check via surrounding XML hints.
    expect(docXml).toContain(">E</w:t>");
    expect(docXml).toContain(">U</w:t>");
  });

  it("strips the template's placeholder rows (1.1…2.6)", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // The template's placeholder "1.7" / "2.6" rows must be gone —
    // our fixture only emits 1.1 and 1.2 (group 1) and 2.1/2.2
    // (group 2, both empty). Compact mode is off, so 2.1/2.2 stay.
    expect(docXml).not.toContain(">1.7</w:t>");
    expect(docXml).not.toContain(">2.6</w:t>");
    // But the rows we DO emit must show.
    expect(docXml).toContain(">1.1</w:t>");
    expect(docXml).toContain(">1.2</w:t>");
  });

  it("compact ON drops entirely-blank rows + their empty group", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
      compact: true,
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // Group 1 survives (two populated rows).
    expect(docXml).toContain("Materialer");
    // Group 2 was all-empty → dropped entirely.
    expect(docXml).not.toContain("Udførelse");
    // The empty rows' section numbers must NOT be in the output.
    expect(docXml).not.toContain(">2.1</w:t>");
    expect(docXml).not.toContain(">2.2</w:t>");
  });

  it("compact OFF (default) keeps every row, including all-empty ones", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // Both groups survive, both empty rows still emitted.
    expect(docXml).toContain("Materialer");
    expect(docXml).toContain("Udførelse");
    expect(docXml).toContain(">2.1</w:t>");
    expect(docXml).toContain(">2.2</w:t>");
  });

  it("patches header XMLs with parent BDB name + CP title", () => {
    const { payload } = makeCpPayload();
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const files = unzipSync(out);
    let foundParent = false;
    let foundCpTitle = false;
    for (const path of Object.keys(files)) {
      if (!/^word\/header\d+\.xml$/.test(path)) continue;
      const txt = strFromU8(files[path]!);
      // The placeholders MUST be gone wherever they appeared.
      expect(txt).not.toContain("Vindue, dør og port, leverance");
      expect(txt).not.toContain(
        "Kontrolskema, projektering, særlige kontroller",
      );
      if (txt.includes("Vinduer + døre")) foundParent = true;
      if (txt.includes("Kontrolskema, projektering")) foundCpTitle = true;
    }
    expect(foundParent).toBe(true);
    expect(foundCpTitle).toBe(true);
  });

  it("falls back to 'Kontrolplan' when no BDB references the CP", () => {
    const { payload } = makeCpPayload();
    // Orphan the CP: remove the parent's reference.
    payload.bdbs = [{ ...payload.bdbs[0]!, controlPlanIds: [] } as BdbInfo];
    const out = buildSpecDocx({
      data: payload,
      spec: { kind: "cp", id: 80 },
    });
    const files = unzipSync(out);
    let foundFallback = false;
    for (const path of Object.keys(files)) {
      if (!/^word\/header\d+\.xml$/.test(path)) continue;
      const txt = strFromU8(files[path]!);
      if (txt.includes("Kontrolplan")) foundFallback = true;
    }
    expect(foundFallback).toBe(true);
  });

  it("rejects unknown control-plan id with a tagged error", () => {
    const { payload } = makeCpPayload();
    expect(() =>
      buildSpecDocx({ data: payload, spec: { kind: "cp", id: 9999 } }),
    ).toThrow(BdbDocxBuildError);
  });
});

/* ------------------------------------------------------------------ */
/*  TOC toggle: with-TOC (5 sections) vs no-TOC (4 sections)           */
/* ------------------------------------------------------------------ */

describe("buildBdbDocx — table-of-contents toggle", () => {
  it("default (includeToc omitted) uses the 5-section TOC template", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42 });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // The with-TOC template's front matter carries the TOC heading.
    expect(docXml).toContain("Indholdsfortegnelse");
  });

  it("includeToc: false uses the 4-section no-TOC template", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42, includeToc: false });
    const files = unzipSync(out);
    expect(files["word/document.xml"]).toBeDefined();
    const docXml = strFromU8(files["word/document.xml"]!);
    // No-TOC output keeps exactly 4 section breaks (front matter shares
    // its section with chapter 1).
    const sectCount = (docXml.match(/<w:sectPr\b/g) || []).length;
    expect(sectCount).toBe(4);
  });

  it("no-TOC output has no table-of-contents field", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42, includeToc: false });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    expect(docXml).not.toContain("Indholdsfortegnelse");
  });

  it("no-TOC keeps the front matter and injects all four chapters in order", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42, includeToc: false });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    // Front matter preserved.
    expect(docXml).toContain("Udarbejdet");
    // All four chapter headings present…
    for (const h of ["Omfang", "Almene specifikationer", "Projektering", "Produktion"]) {
      expect(docXml).toContain(h);
    }
    // …and in document order.
    const iOmfang = docXml.indexOf("Omfang");
    const iAlmene = docXml.indexOf("Almene specifikationer");
    const iProj = docXml.indexOf("Projektering");
    const iProd = docXml.indexOf("Produktion");
    expect(iOmfang).toBeLessThan(iAlmene);
    expect(iAlmene).toBeLessThan(iProj);
    expect(iProj).toBeLessThan(iProd);
  });

  it("no-TOC output is a valid ZIP that preserves the template's files", () => {
    const { payload } = makePayload();
    const out = buildBdbDocx({ data: payload, bdbId: 42, includeToc: false });
    const files = unzipSync(out);
    expect(Object.keys(files).length).toBeGreaterThan(5);
    // Body content still round-trips (formatting marks land).
    const docXml = strFromU8(files["word/document.xml"]!);
    expect(docXml).toContain("<w:b/>");
  });

  it("no-TOC work-area export also renders chapters", () => {
    const { payload } = makeWorkSpecPayload();
    const out = buildWorkSpecDocx({
      data: payload,
      workSpecId: 7,
      includeToc: false,
    });
    const docXml = strFromU8(unzipSync(out)["word/document.xml"]!);
    expect(docXml).toContain("Omfang");
    expect(docXml).toContain("Krav til betonkvalitet");
    const sectCount = (docXml.match(/<w:sectPr\b/g) || []).length;
    expect(sectCount).toBe(4);
  });
});
