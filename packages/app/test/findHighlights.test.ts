/** @vitest-environment jsdom */
/**
 * Slice "Highlights & formatting" — `findHighlights` helper.
 *
 * Walks a synthetic FilePayload and verifies every formatting run
 * (4 highlight backgrounds + 4 text colors) is collected with the
 * right kind, text, and location. Also covers the truncation helper
 * used by the modal's row labels.
 */
import { describe, expect, it } from "vitest";

import {
  collectFromBody,
  findHighlights,
  truncateForDisplay,
  type Highlight,
} from "../src/renderer/src/highlights/findHighlights.js";
import type { FilePayload, SectionData } from "../src/shared/ipc.js";

function makeSection(over: Partial<SectionData>): SectionData {
  return {
    id: 1,
    sectionNo: 1,
    heading: "Heading",
    body: "",
    parentId: null,
    pfbbSectionId: null,
    ...over,
  };
}

function makePayload(args: {
  ws?: Record<number, SectionData[]>;
  bdb?: Record<number, SectionData[]>;
}): FilePayload {
  return {
    path: "/tmp/x.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: null,
    workSpecs: [],
    bdbs: [],
    controlPlans: [],
    contracts: [],
    sectionsByWorkSpec: args.ws ?? {},
    sectionsByBdb: args.bdb ?? {},
    cpHeadersByPlan: {},
    cpRowsByPlan: {},
    attachments: [],
  };
}

describe("findHighlights", () => {
  it("returns [] for an empty payload", () => {
    expect(findHighlights(makePayload({}))).toEqual([]);
  });

  it("returns [] for bodies with no marks", () => {
    const data = makePayload({
      ws: {
        1: [makeSection({ id: 7, body: "<p>Plain text only</p>" })],
      },
    });
    expect(findHighlights(data)).toEqual([]);
  });

  it("finds a single yellow highlight on a work-area section", () => {
    const data = makePayload({
      ws: {
        42: [
          makeSection({
            id: 7,
            sectionNo: 1,
            heading: "Intro",
            body: '<p>Plain <mark class="bg-yellow">important bit</mark> tail</p>',
          }),
        ],
      },
    });
    const got = findHighlights(data);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      markKind: "bg-yellow",
      text: "important bit",
      location: {
        kind: "workSpec",
        workSpecId: 42,
        sectionId: 7,
        sectionNo: 1,
        heading: "Intro",
      },
    });
  });

  it("finds a text-color run on a BDB section", () => {
    const data = makePayload({
      bdb: {
        99: [
          makeSection({
            id: 12,
            sectionNo: 3,
            heading: "Note",
            body: '<p>The <span class="tc-red">red word</span>.</p>',
          }),
        ],
      },
    });
    const got = findHighlights(data);
    expect(got).toHaveLength(1);
    expect(got[0]?.markKind).toBe("tc-red");
    expect(got[0]?.text).toBe("red word");
    expect(got[0]?.location).toMatchObject({ kind: "bdb", bdbId: 99 });
  });

  it("collects multiple kinds in document order across the same body", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            body:
              '<p><mark class="bg-blue">blue</mark> ' +
              '<span class="tc-green">green</span> ' +
              '<mark class="bg-red">red</mark></p>',
          }),
        ],
      },
    });
    const kinds = findHighlights(data).map((h) => h.markKind);
    expect(kinds).toEqual(["bg-blue", "tc-green", "bg-red"]);
  });

  it("ignores classes outside the 8-kind allowlist", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            body:
              '<p><mark class="bg-yellow">good</mark> ' +
              '<span class="tc-purple">unknown</span> ' +
              '<mark class="custom">unknown</mark></p>',
          }),
        ],
      },
    });
    const got = findHighlights(data);
    expect(got).toHaveLength(1);
    expect(got[0]?.markKind).toBe("bg-yellow");
  });

  it("ignores mismatched tag/class pairs (defence in depth)", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            // <mark> with a tc-* class shouldn't match (tc-* lives on
            // <span>); same for <span> with bg-*.
            body:
              '<p><mark class="tc-yellow">x</mark>' +
              '<span class="bg-yellow">y</span></p>',
          }),
        ],
      },
    });
    expect(findHighlights(data)).toEqual([]);
  });

  it("walks both work-area and BDB sections in id order", () => {
    const data = makePayload({
      ws: {
        2: [makeSection({ id: 1, body: '<mark class="bg-yellow">w2</mark>' })],
        1: [makeSection({ id: 2, body: '<mark class="bg-blue">w1</mark>' })],
      },
      bdb: {
        20: [makeSection({ id: 3, body: '<span class="tc-red">b20</span>' })],
        10: [makeSection({ id: 4, body: '<span class="tc-green">b10</span>' })],
      },
    });
    const got = findHighlights(data);
    // Work-area sections first (id-sorted: 1 then 2), then BDB (10 then 20).
    expect(got.map((h) => h.text)).toEqual(["w1", "w2", "b10", "b20"]);
  });

  it("numbers markOrdinal per kind, per section, in document order", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            body:
              "<p>" +
              '<mark class="bg-yellow">y1</mark>' +
              '<mark class="bg-blue">b1</mark>' +
              '<mark class="bg-yellow">y2</mark>' +
              '<mark class="bg-yellow">y3</mark>' +
              '<mark class="bg-blue">b2</mark>' +
              "</p>",
          }),
          makeSection({
            id: 2,
            // New section — yellows reset to ordinal 0.
            body: '<p><mark class="bg-yellow">y4</mark></p>',
          }),
        ],
      },
    });
    const got = findHighlights(data);
    const yellows = got.filter((h) => h.markKind === "bg-yellow");
    const blues = got.filter((h) => h.markKind === "bg-blue");
    expect(yellows.map((h) => ({ text: h.text, ord: h.markOrdinal }))).toEqual([
      { text: "y1", ord: 0 },
      { text: "y2", ord: 1 },
      { text: "y3", ord: 2 },
      // Section 2's yellow resets to 0.
      { text: "y4", ord: 0 },
    ]);
    expect(blues.map((h) => ({ text: h.text, ord: h.markOrdinal }))).toEqual([
      { text: "b1", ord: 0 },
      { text: "b2", ord: 1 },
    ]);
  });

  it("ordinals for tc-* are numbered independently of bg-*", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            body:
              "<p>" +
              '<mark class="bg-yellow">y</mark>' +
              '<span class="tc-yellow">ty1</span>' +
              '<span class="tc-yellow">ty2</span>' +
              "</p>",
          }),
        ],
      },
    });
    const got = findHighlights(data);
    const yellows = got.filter((h) => h.markKind === "bg-yellow");
    const tyellows = got.filter((h) => h.markKind === "tc-yellow");
    expect(yellows[0]?.markOrdinal).toBe(0);
    expect(tyellows.map((h) => h.markOrdinal)).toEqual([0, 1]);
  });

  it("preserves nested formatting inside a highlight", () => {
    const data = makePayload({
      ws: {
        1: [
          makeSection({
            id: 1,
            body: '<p><mark class="bg-yellow">important <strong>thing</strong></mark></p>',
          }),
        ],
      },
    });
    const got = findHighlights(data);
    expect(got).toHaveLength(1);
    // textContent walks the nested element — strong tag is gone but
    // the text inside survives.
    expect(got[0]?.text).toBe("important thing");
  });
});

describe("collectFromBody", () => {
  it("is a no-op for null / empty bodies", () => {
    const out: Highlight[] = [];
    const loc = {
      kind: "workSpec" as const,
      workSpecId: 1,
      sectionId: 1,
      sectionNo: 1,
      heading: "",
    };
    collectFromBody(null, loc, out);
    collectFromBody(undefined, loc, out);
    collectFromBody("", loc, out);
    expect(out).toEqual([]);
  });
});

describe("truncateForDisplay", () => {
  it("returns short strings unchanged", () => {
    expect(truncateForDisplay("hello world")).toBe("hello world");
  });

  it("collapses whitespace runs to single spaces", () => {
    expect(truncateForDisplay("  hello\n\n  world  ")).toBe("hello world");
  });

  it("truncates long strings on a word boundary", () => {
    const long = Array(20).fill("word").join(" "); // 99 chars
    const out = truncateForDisplay(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(81);
    // Should cut on a space, not mid-word.
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });
});
