/**
 * Unit tests for the composite spec-PDF builder.
 *
 * `buildCompositePdf` is "many specs → one PDF". These tests check
 * that the doc-def assembled by stitching chapter content together
 * is well-formed:
 *   - cover + TOC are emitted (or skipped, per the flags)
 *   - each chapter title becomes a `tocItem: true` node so the
 *     unified TOC picks it up
 *   - section content from each chapter survives the stitch
 *   - the per-chapter title + subtitle that `buildSpecPdf` would
 *     emit are stripped (we emit our own chapter heading above)
 *   - page breaks happen between chapters (the chapter title node
 *     carries `pageBreak: "before"` except for the very first one
 *     when there's no cover + no TOC)
 *   - styles use the shared `specPdfStyles` table so we don't
 *     drift apart from `buildSpecPdf`
 *
 * No DOM, no pdfmake — same approach as buildSpecPdf.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Content } from "pdfmake/interfaces";

import type { SectionData } from "../src/shared/ipc.js";
import {
  buildCompositePdf,
  compositeChapterDestPrefix,
  type CompositePdfChapter,
} from "../src/renderer/src/pdf/buildCompositePdf.js";
import { specPdfStyles } from "../src/renderer/src/pdf/buildSpecPdf.js";

const fakeHtml = (html: string): Content => ({ text: html });

function s(
  id: number,
  parentId: number | null,
  sectionNo: number,
  heading: string,
  body = "",
): SectionData {
  return { id, parentId, sectionNo, heading, body };
}

function allNodes(doc: ReturnType<typeof buildCompositePdf>): Content[] {
  return Array.isArray(doc.content) ? doc.content : [];
}

function nodesByStyle(content: Content[], style: string): Content[] {
  return content.filter(
    (n) =>
      typeof n === "object" &&
      n !== null &&
      "style" in n &&
      (n as { style?: unknown }).style === style,
  );
}

function chapter(
  i: number,
  title: string,
  sections: SectionData[] = [],
): CompositePdfChapter {
  return { kind: "bdb", title, sections };
}

describe("buildCompositePdf", () => {
  it("emits cover + TOC + chapter content in order", () => {
    const doc = buildCompositePdf({
      cover: {
        title: "All work areas",
        projectName: "Test Project",
        companyName: "Co",
      },
      chapters: [
        chapter(0, "BDB Alpha", [s(1, null, 1, "Heading A1", "<p>body</p>")]),
        chapter(1, "BDB Beta", [s(2, null, 1, "Heading B1", "<p>body</p>")]),
      ],
      htmlConverter: fakeHtml,
    });
    const content = allNodes(doc);
    // Cover stack node is the first; we don't peer into makeCover's
    // internals here, but we DO check that the TOC sits before any
    // chapter title.
    const tocIdx = content.findIndex(
      (n) => typeof n === "object" && n !== null && "toc" in n,
    );
    expect(tocIdx).toBeGreaterThan(-1);
    const chapterTitles = nodesByStyle(content, "chapterTitle");
    expect(chapterTitles).toHaveLength(2);
    // Every chapter title must appear AFTER the TOC.
    for (const ct of chapterTitles) {
      const idx = content.indexOf(ct);
      expect(idx).toBeGreaterThan(tocIdx);
    }
  });

  it("marks every chapter title with tocItem: true so the unified TOC picks it up", () => {
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [chapter(0, "Ch 1"), chapter(1, "Ch 2"), chapter(2, "Ch 3")],
      htmlConverter: fakeHtml,
    });
    const titles = nodesByStyle(allNodes(doc), "chapterTitle");
    for (const t of titles) {
      expect((t as { tocItem?: boolean }).tocItem).toBe(true);
    }
  });

  it("breaks the page before every chapter when cover or TOC is present", () => {
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [chapter(0, "Ch 1"), chapter(1, "Ch 2")],
      htmlConverter: fakeHtml,
    });
    const titles = nodesByStyle(allNodes(doc), "chapterTitle");
    for (const t of titles) {
      expect((t as { pageBreak?: string }).pageBreak).toBe("before");
    }
  });

  it("skips pageBreak on chapter 1 when there's no cover AND no TOC", () => {
    // Niche path used by tests / specialised callers: no chrome at all.
    // The very first chapter then sits on page 1 with no preceding
    // page break.
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [chapter(0, "Ch 1"), chapter(1, "Ch 2")],
      htmlConverter: fakeHtml,
      includeCoverPage: false,
      includeToc: false,
    });
    const titles = nodesByStyle(allNodes(doc), "chapterTitle");
    expect((titles[0] as { pageBreak?: string }).pageBreak).toBeUndefined();
    expect((titles[1] as { pageBreak?: string }).pageBreak).toBe("before");
  });

  it("strips the per-chapter title + subtitle that buildSpecPdf would otherwise emit", () => {
    // buildSpecPdf's first two content nodes are the spec's title +
    // (optional) subtitle. The composite builder emits its own
    // chapter heading above each chapter, so those inner ones would
    // be duplicates. Verify none survive.
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [
        {
          kind: "bdb",
          title: "Inner title",
          subtitle: "Inner subtitle",
          sections: [s(1, null, 1, "h", "")],
        },
      ],
      htmlConverter: fakeHtml,
    });
    const content = allNodes(doc);
    // The strip only removes nodes whose style === "title" or "subtitle".
    // Our chapter title is style "chapterTitle", so it must be present.
    expect(nodesByStyle(content, "chapterTitle")).toHaveLength(1);
    expect(nodesByStyle(content, "title")).toHaveLength(0);
    expect(nodesByStyle(content, "subtitle")).toHaveLength(0);
  });

  it("uses the shared specPdfStyles table", () => {
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [chapter(0, "Ch")],
      htmlConverter: fakeHtml,
    });
    expect(doc.styles).toBe(specPdfStyles);
  });

  it("produces a valid (cover + empty TOC) PDF when chapters is empty", () => {
    // Edge case: caller cherry-picked zero specs. Don't throw —
    // emit a thin doc so the user still sees the cover.
    const doc = buildCompositePdf({
      cover: { title: "Nothing here", companyName: "Co" },
      chapters: [],
      htmlConverter: fakeHtml,
    });
    const content = allNodes(doc);
    expect(content.length).toBeGreaterThan(0); // cover + TOC at least
    expect(nodesByStyle(content, "chapterTitle")).toHaveLength(0);
  });

  it("preserves section body content from each chapter", () => {
    const doc = buildCompositePdf({
      cover: { title: "x", companyName: "Co" },
      chapters: [
        chapter(0, "A", [s(1, null, 1, "Heading-A", "<p>BODY-A</p>")]),
        chapter(1, "B", [s(2, null, 1, "Heading-B", "<p>BODY-B</p>")]),
      ],
      htmlConverter: fakeHtml,
      // Disable cover + TOC so the assertion stays focused on
      // the chapter content.
      includeCoverPage: false,
      includeToc: false,
    });
    // Look for the body-text nodes (fakeHtml returns `{ text: html }`).
    const content = allNodes(doc);
    const texts: string[] = [];
    const collect = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (typeof obj["text"] === "string") texts.push(obj["text"] as string);
      const stack = obj["stack"];
      if (Array.isArray(stack)) stack.forEach(collect);
    };
    content.forEach(collect);
    expect(texts.some((t) => t.includes("BODY-A"))).toBe(true);
    expect(texts.some((t) => t.includes("BODY-B"))).toBe(true);
  });

  it("installs document-wide header / footer from the composite chrome args", () => {
    const doc = buildCompositePdf({
      cover: {
        title: "All",
        projectName: "Proj",
        companyName: "ACME",
      },
      chapters: [chapter(0, "Ch")],
      htmlConverter: fakeHtml,
    });
    // Don't render to bytes — just check the doc carries header/footer
    // functions (the BIPS chrome). They're functions of (currentPage,
    // pageCount); we call them to confirm they don't throw on
    // page-2 input (page 1 = cover, suppressed).
    expect(typeof doc.header).toBe("function");
    expect(typeof doc.footer).toBe("function");
    const headerFn = doc.header as (cur: number, count: number) => unknown;
    const footerFn = doc.footer as (cur: number, count: number) => unknown;
    expect(() => headerFn(2, 5)).not.toThrow();
    expect(() => footerFn(2, 5)).not.toThrow();
  });
});

/**
 * Task 150 - a composite holds a work area AND its BDBs, and their
 * sections come from two tables whose row ids overlap. Every section
 * heading carries a pdfmake node id (the TOC jumps to it), and pdfmake
 * throws "Node id 'section-N' already exists" on a duplicate. These
 * tests run pdfmake's own preprocessor, which is where that throw
 * happens, so they fail on the unscoped ids and pass on the fix.
 */
describe("buildCompositePdf - node ids across chapters (Task 150)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DocPreprocessor = require("pdfmake/src/docPreprocessor") as new () => {
    preprocessDocument(doc: unknown): unknown;
  };

  /** Every `id` and every `linkToDestination` anywhere in the tree. */
  function collectRefs(content: unknown): { ids: string[]; links: string[] } {
    const ids: string[] = [];
    const links: string[] = [];
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(visit);
        return;
      }
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (typeof obj.id === "string") ids.push(obj.id);
      if (typeof obj.linkToDestination === "string")
        links.push(obj.linkToDestination);
      for (const key of ["stack", "text", "columns", "ul", "ol"]) {
        if (obj[key] && typeof obj[key] === "object") visit(obj[key]);
      }
    };
    visit(content);
    return { ids, links };
  }

  // A work area and a BDB whose section ids overlap (1 and 2 in both).
  const overlapping: CompositePdfChapter[] = [
    {
      kind: "workSpec",
      title: "S210.01 Work area",
      sections: [
        s(1, null, 1, "WA heading", "<p>wa</p>"),
        s(2, 1, 1, "WA child", "<p>wa child</p>"),
      ],
    },
    {
      kind: "bdb",
      title: "BDB with overlapping ids",
      sections: [
        s(1, null, 1, "BDB heading", "<p>bdb</p>"),
        s(2, 1, 1, "BDB child", "<p>bdb child</p>"),
      ],
    },
  ];

  it("pdfmake accepts a composite whose chapters share section ids", () => {
    const doc = buildCompositePdf({
      cover: { title: "Whole project", companyName: "Co" },
      chapters: overlapping,
      htmlConverter: fakeHtml,
    });
    expect(() =>
      new DocPreprocessor().preprocessDocument(doc.content),
    ).not.toThrow();
  });

  it("gives every section heading a unique id, scoped by chapter", () => {
    const doc = buildCompositePdf({
      cover: { title: "Whole project", companyName: "Co" },
      chapters: overlapping,
      htmlConverter: fakeHtml,
    });
    const { ids } = collectRefs(doc.content);
    expect(ids).toEqual([
      `${compositeChapterDestPrefix(0)}section-1`,
      `${compositeChapterDestPrefix(0)}section-2`,
      `${compositeChapterDestPrefix(1)}section-1`,
      `${compositeChapterDestPrefix(1)}section-2`,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("PFBB note-page links point at an id that exists in the same document", () => {
    // The note page links to headings by id. If the heading and the
    // link were prefixed differently the PDF would still build, but the
    // jumps would point nowhere - so check the link targets resolve.
    const doc = buildCompositePdf({
      cover: { title: "Whole project", companyName: "Co" },
      chapters: [
        overlapping[0]!,
        {
          ...overlapping[1]!,
          pfbbChildOverlay: {
            masterName: "Master",
            supplementBodyBySectionId: { 2: "<p>supplement</p>" },
          },
        },
      ],
      htmlConverter: fakeHtml,
    });
    const { ids, links } = collectRefs(doc.content);
    expect(links).toEqual([`${compositeChapterDestPrefix(1)}section-2`]);
    for (const link of links) expect(ids).toContain(link);
    expect(() =>
      new DocPreprocessor().preprocessDocument(doc.content),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  Task 173 - a blank page 1 reserved for a custom cover              */
/* ------------------------------------------------------------------ */

/** Every string `text` in a pdfmake node tree (header/footer tables). */
function collectAllText(node: unknown): string[] {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    if (typeof obj.text === "string") out.push(obj.text);
    else if (Array.isArray(obj.text)) visit(obj.text);
    if (Array.isArray(obj.columns)) visit(obj.columns);
    if (obj.table && typeof obj.table === "object") {
      const t = obj.table as { body?: unknown };
      if (Array.isArray(t.body)) visit(t.body);
    }
    if (Array.isArray(obj.stack)) visit(obj.stack);
  };
  visit(node);
  return out;
}

describe("buildCompositePdf - reserveCoverPage (Task 173)", () => {
  type Chrome = (p: number, pc: number) => unknown;
  const base = () => ({
    cover: {
      title: "Hele projektet",
      projectName: "Test Project",
      companyName: "Co",
    },
    chapters: [
      chapter(0, "BDB Alpha", [s(1, null, 1, "Heading A1", "<p>body</p>")]),
    ],
    htmlConverter: fakeHtml,
  });

  it("starts with a blank page, then the TOC, and treats page 1 as the cover", () => {
    const doc = buildCompositePdf({
      ...base(),
      includeCoverPage: false,
      reserveCoverPage: true,
    });
    const content = allNodes(doc);
    expect(content[0]).toEqual({ text: "", pageBreak: "after" });
    expect(
      typeof content[1] === "object" &&
        content[1] !== null &&
        "toc" in content[1],
    ).toBe(true);
    const header = doc.header as Chrome;
    const footer = doc.footer as Chrome;
    expect((header(1, 9) as { text?: string }).text).toBe("");
    expect((footer(1, 9) as { text?: string }).text).toBe("");
    expect(collectAllText(footer(2, 9))).toContain("Page 2 of 9");
  });

  it("without TOC the first chapter still starts on page 2, like with the built-in cover", () => {
    const reserved = allNodes(
      buildCompositePdf({
        ...base(),
        includeCoverPage: false,
        reserveCoverPage: true,
        includeToc: false,
      }),
    );
    const builtIn = allNodes(
      buildCompositePdf({
        ...base(),
        includeCoverPage: true,
        includeToc: false,
      }),
    );
    const firstTitle = (c: Content[]) =>
      nodesByStyle(c, "chapterTitle")[0] as { pageBreak?: string };
    expect(firstTitle(reserved).pageBreak).toBe(firstTitle(builtIn).pageBreak);
  });
});
