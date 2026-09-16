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
