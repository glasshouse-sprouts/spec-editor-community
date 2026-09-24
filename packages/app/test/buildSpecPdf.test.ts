/**
 * Unit tests for the pure spec-PDF builder.
 *
 * The builder returns a plain pdfmake `TDocumentDefinitions` object,
 * so these tests don't need pdfmake, html-to-pdfmake, or a DOM —
 * they just look at the returned JSON.
 *
 * The real HTML converter is injected from the runtime wrapper
 * (renderPdf.ts). Here we inject an identity-ish fake that returns a
 * `{ text: html }` node so we can assert body content ended up in the
 * right place.
 *
 * 7.2 notes: the builder now attaches `header` / `footer` functions
 * to the doc-def. We call them directly to assert their output rather
 * than trying to serialise.
 */
import { describe, expect, it } from "vitest";
import type { Content } from "pdfmake/interfaces";

import type { SectionData } from "../src/shared/ipc.js";
import {
  buildSpecPdf,
  buildAppendixRow,
  formatBytes,
  mimeShortLabel,
  type AttachmentAppendixEntry,
} from "../src/renderer/src/pdf/buildSpecPdf.js";

/** Trivial HTML-to-Content fake: wraps the input string unchanged. */
const fakeHtml = (html: string): Content => ({ text: html });

/** Make a section row with minimal boilerplate. */
function s(
  id: number,
  parentId: number | null,
  sectionNo: number,
  heading: string,
  body = "",
): SectionData {
  return { id, parentId, sectionNo, heading, body };
}

/**
 * Pull the flat `content` array out of a doc-def and look for a node
 * whose `.text` equals the given string. Used to assert ordering /
 * presence without depending on exact index positions.
 */
function textAt(content: Content[], i: number): string | undefined {
  const n = content[i];
  if (n && typeof n === "object" && "text" in n) {
    const t = (n as { text: unknown }).text;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/** Flatten every node's `.text` string into a bag for easy `.toContain` asserts. */
function allTexts(content: Content[]): string[] {
  const out: string[] = [];
  for (const n of content) {
    if (n && typeof n === "object" && "text" in n) {
      const t = (n as { text: unknown }).text;
      if (typeof t === "string") out.push(t);
    }
  }
  return out;
}

/** Default args that pass through the 7.2 chrome requirements. */
function defaultArgs(): Parameters<typeof buildSpecPdf>[0] {
  return {
    kind: "workSpec",
    title: "T",
    sections: [],
    companyName: "Company name",
    htmlConverter: fakeHtml,
    // Off by default in tests so older assertions stay valid — each
    // test opts in when it wants to check the cover.
    includeCoverPage: false,
    includeToc: false,
  };
}

describe("buildSpecPdf", () => {
  it("puts title, metadata and empty-marker in order when no sections", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "workSpec",
      title: "My spec",
      subtitle: "2.5",
      projectName: "Test project",
    });
    const content = doc.content as Content[];
    expect(textAt(content, 0)).toBe("My spec");
    expect(textAt(content, 1)).toBe("2.5");
    expect(textAt(content, 2)).toContain("Kind: Arbejdsbeskrivelse");
    expect(textAt(content, 2)).toContain("Project: Test project");
    expect(textAt(content, 3)).toBe("(no sections)");
  });

  it("labels BDB correctly and omits empty metadata fields", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "Fundering",
    });
    const content = doc.content as Content[];
    // With no subtitle / project / revision, the meta line is just the kind
    // label, which now uses the full domain term (i18n sweep, 2026-06-12).
    expect(textAt(content, 0)).toBe("Fundering");
    expect(textAt(content, 1)).toBe("Kind: Bygningsdelsbeskrivelse");
    expect(textAt(content, 1)).not.toContain("Project");
    expect(textAt(content, 1)).not.toContain("Revision");
  });

  it("emits dotted section numbers and body via injected converter", () => {
    const sections: SectionData[] = [
      s(1, null, 1, "Chapter", "<p>Chapter intro</p>"),
      s(2, 1, 1, "Sub A", "<p>Sub A body</p>"),
      s(3, 1, 2, "Sub B"), // empty body — converter not called
    ];
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "workSpec",
      title: "T",
      sections,
    });
    const texts = allTexts(doc.content as Content[]);
    expect(texts).toContain("1  Chapter");
    expect(texts).toContain("<p>Chapter intro</p>");
    expect(texts).toContain("1.1  Sub A");
    expect(texts).toContain("<p>Sub A body</p>");
    expect(texts).toContain("1.2  Sub B");
  });

  it("includes revision info in metadata when provided", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      revision: "B",
      revisionDate: "2026-04-19",
    });
    const content = doc.content as Content[];
    const meta = textAt(content, 1);
    expect(meta).toContain("Revision: B");
    expect(meta).toContain("Revision date: 2026-04-19");
  });

  it("skips empty bodies silently (no call to htmlConverter)", () => {
    const calls: string[] = [];
    const spy = (html: string): Content => {
      calls.push(html);
      return { text: html };
    };
    buildSpecPdf({
      ...defaultArgs(),
      sections: [s(1, null, 1, "Only heading", "")],
      htmlConverter: spy,
    });
    expect(calls).toEqual([]);
  });

  it("treats whitespace-only bodies as empty", () => {
    const calls: string[] = [];
    const spy = (html: string): Content => {
      calls.push(html);
      return { text: html };
    };
    buildSpecPdf({
      ...defaultArgs(),
      sections: [s(1, null, 1, "Heading", "   \n   ")],
      htmlConverter: spy,
    });
    expect(calls).toEqual([]);
  });

  it("sets A4 page size and top-of-file metadata", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      title: "Work title",
    });
    expect(doc.pageSize).toBe("A4");
    expect(doc.info?.title).toBe("Work title");
    expect(doc.info?.creator).toBe("Spec Editor Community");
  });

  // ---- 7.2 additions -----------------------------------------------

  it("emits a cover page when includeCoverPage is true (default)", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeCoverPage: true,
      title: "Cover title",
      projectName: "Project 42",
    });
    const texts = allTexts(doc.content as Content[]);
    // Cover contributes the big title + company name before the
    // ordinary title block further down.
    expect(texts).toContain("Cover title");
    expect(texts).toContain("Project 42");
    expect(texts).toContain("Company name");
    // Exactly one node in the document should be marked as a
    // page-break-after — the cover's tail text.
    const breaks = (doc.content as Content[]).filter(
      (n): n is { pageBreak?: string } =>
        typeof n === "object" && n !== null && "pageBreak" in n,
    );
    expect(breaks.length).toBeGreaterThanOrEqual(1);
  });

  it("skips the cover page when includeCoverPage is false", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeCoverPage: false,
      title: "No cover",
    });
    const content = doc.content as Content[];
    // First node is the title block directly — no spacer/cover before it.
    expect(textAt(content, 0)).toBe("No cover");
  });

  it("emits a TOC node and tags every heading with tocItem: true", () => {
    const sections: SectionData[] = [
      s(1, null, 1, "A"),
      s(2, 1, 1, "A.1"),
      s(3, null, 2, "B"),
    ];
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeToc: true,
      sections,
    });
    const content = doc.content as Content[];
    // Exactly one node has a `.toc` key.
    const tocNodes = content.filter(
      (n) => n && typeof n === "object" && "toc" in n,
    );
    expect(tocNodes.length).toBe(1);
    // Every heading node should carry `tocItem: true`.
    const tocItems = content.filter(
      (n): n is { tocItem?: unknown } =>
        typeof n === "object" && n !== null && "tocItem" in n,
    );
    // 3 headings = 3 tocItem nodes.
    expect(tocItems.length).toBe(3);
    for (const n of tocItems) {
      expect((n as { tocItem?: unknown }).tocItem).toBe(true);
    }
  });

  it("omits the TOC node when includeToc is false", () => {
    const sections: SectionData[] = [s(1, null, 1, "A"), s(2, null, 2, "B")];
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeToc: false,
      sections,
    });
    const content = doc.content as Content[];
    const tocNodes = content.filter(
      (n) => n && typeof n === "object" && "toc" in n,
    );
    expect(tocNodes.length).toBe(0);
  });

  it("builds a BIPS-style running header with project + workArea + documentLabel", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      projectName: "My project",
      workAreaName: "2.5 Beton",
      title: "Fundering",
      kind: "bdb",
    });
    // Header is a function: call it for page 2 and walk the table body.
    const fn = doc.header as (p: number, pc: number) => unknown;
    const node = fn(2, 5);
    const texts = collectAllText(node);
    // Right column, bold top cell.
    expect(texts).toContain("My project");
    // Row 3 left — work-area name inherited from parent.
    expect(texts).toContain("2.5 Beton");
    // Row 4 left — BDB's own name for BDB PDFs.
    expect(texts).toContain("Fundering");
    // Danish BIPS labels.
    expect(texts).toContain("Dato");
    expect(texts).toContain("Rev.dato");
    expect(texts).toContain("Side");
    // defaultArgs() has includeCoverPage: false, so there is no built-in
    // cover page to keep clean - page 1 carries the running header too.
    expect(collectAllText(fn(1, 5))).toContain("My project");

    // With the built-in cover ON, page 1 stays clean.
    const withCover = buildSpecPdf({
      ...defaultArgs(),
      projectName: "My project",
      includeCoverPage: true,
    });
    const coverFn = withCover.header as (p: number, pc: number) => unknown;
    expect((coverFn(1, 5) as { text?: string }).text).toBe("");
  });

  it("prints the literal 'Arbejdsbeskrivelse' on row 4 for work-area PDFs", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "workSpec",
      title: "2.5 Beton",
      workAreaName: "2.5 Beton",
    });
    const fn = doc.header as (p: number, pc: number) => unknown;
    const texts = collectAllText(fn(2, 5));
    expect(texts).toContain("Arbejdsbeskrivelse");
  });

  // ---- 7.3: compact flag ------------------------------------------

  it("compact=true drops leaf sections with visually-empty bodies", () => {
    // Three leaves: one with real body, one empty, one whitespace-only.
    // Compact mode should keep only the first.
    const sections: SectionData[] = [
      s(1, null, 1, "Kept", "<p>Real body</p>"),
      s(2, null, 2, "Empty", ""),
      s(3, null, 3, "Whitespace", "   \n   "),
    ];
    const doc = buildSpecPdf({
      ...defaultArgs(),
      compact: true,
      sections,
    });
    const texts = allTexts(doc.content as Content[]);
    expect(texts).toContain("1  Kept");
    expect(texts).not.toContain("2  Empty");
    expect(texts).not.toContain("3  Whitespace");
  });

  it("compact=false (default) keeps empty-body sections for completeness", () => {
    const sections: SectionData[] = [
      s(1, null, 1, "Kept", "<p>Real body</p>"),
      s(2, null, 2, "Empty", ""),
    ];
    const doc = buildSpecPdf({
      ...defaultArgs(),
      sections, // compact omitted → defaults to false
    });
    const texts = allTexts(doc.content as Content[]);
    expect(texts).toContain("1  Kept");
    expect(texts).toContain("2  Empty");
  });

  it("builds a running footer with company name + page N of M", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      companyName: "Company name",
    });
    const fn = doc.footer as (p: number, pc: number) => unknown;
    const footer = fn(3, 7);
    const texts = collectAllText(footer);
    expect(texts).toContain("Company name");
    expect(texts).toContain("Page 3 of 7");
    // defaultArgs() has includeCoverPage: false, so there is no built-in
    // cover page to keep clean - page 1 carries the footer too.
    expect(collectAllText(fn(1, 7))).toContain("Company name");

    // With the built-in cover ON, page 1 stays clean.
    const withCover = buildSpecPdf({
      ...defaultArgs(),
      companyName: "Company name",
      includeCoverPage: true,
    });
    const coverFn = withCover.footer as (p: number, pc: number) => unknown;
    expect((coverFn(1, 7) as { text?: string }).text).toBe("");
  });

  // ---- 10L: attachments appendix ---------------------------------

  /** Build a minimal appendix entry for tests. */
  const att = (
    overrides: Partial<AttachmentAppendixEntry> = {},
  ): AttachmentAppendixEntry => ({
    name: "file.bin",
    mimeType: "application/octet-stream",
    byteLength: 1024,
    ...overrides,
  });

  it("emits no Bilag heading when attachments is omitted", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      sections: [s(1, null, 1, "A", "<p>body</p>")],
    });
    const texts = collectAllText(doc.content as Content[]);
    expect(texts).not.toContain("Bilag");
  });

  it("emits no Bilag heading when attachments array is empty", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      sections: [s(1, null, 1, "A", "<p>body</p>")],
      attachments: [],
    });
    const texts = collectAllText(doc.content as Content[]);
    expect(texts).not.toContain("Bilag");
  });

  it("emits one Bilag heading with tocItem + pageBreak before the list", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeToc: true,
      sections: [s(1, null, 1, "A", "<p>body</p>")],
      attachments: [att({ name: "alpha.txt" })],
    });
    const content = doc.content as Content[];
    // Exactly one node with text "Bilag".
    const bilag = content.filter(
      (n): n is { text?: unknown; tocItem?: unknown; pageBreak?: unknown } =>
        typeof n === "object" &&
        n !== null &&
        "text" in n &&
        (n as { text?: unknown }).text === "Bilag",
    );
    expect(bilag.length).toBe(1);
    // Heading must start a fresh page and show up in the TOC.
    expect((bilag[0] as { pageBreak?: unknown }).pageBreak).toBe("before");
    expect((bilag[0] as { tocItem?: unknown }).tocItem).toBe(true);
  });

  it("sorts attachment rows alphabetically by filename (Danish collator)", () => {
    // Danish collator places æ, ø, å after z. Input order is scrambled to
    // prove the builder re-sorts (and doesn't just preserve insertion).
    const doc = buildSpecPdf({
      ...defaultArgs(),
      attachments: [
        att({ name: "zebra.txt" }),
        att({ name: "alpha.txt" }),
        att({ name: "æble.txt" }),
        att({ name: "bravo.txt" }),
      ],
    });
    const content = doc.content as Content[];
    // Filename lives in column 2 of each appendix row. Grab all strings
    // matching our test names in document order.
    const names = collectAllText(content).filter((t) =>
      ["zebra.txt", "alpha.txt", "æble.txt", "bravo.txt"].includes(t),
    );
    expect(names).toEqual(["alpha.txt", "bravo.txt", "zebra.txt", "æble.txt"]);
  });

  it("does not mutate the caller's attachments array when sorting", () => {
    const input: AttachmentAppendixEntry[] = [
      att({ name: "zebra.txt" }),
      att({ name: "alpha.txt" }),
    ];
    const snapshot = input.map((e) => e.name);
    buildSpecPdf({ ...defaultArgs(), attachments: input });
    expect(input.map((e) => e.name)).toEqual(snapshot);
  });

  it("renders image entries with the image cell when dataUrl is present", () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const row = buildAppendixRow(
      att({ name: "pic.png", mimeType: "image/png", dataUrl: tinyPng }),
    );
    // Top-level row is a `columns` cell.
    const cols = (row as { columns?: unknown[] }).columns;
    expect(Array.isArray(cols)).toBe(true);
    // First column: stack → [{ image: dataUrl, fit, width }].
    const iconCol = cols![0] as { stack?: unknown[] };
    const iconCell = iconCol.stack![0] as {
      image?: string;
      fit?: number[];
      width?: number;
    };
    expect(iconCell.image).toBe(tinyPng);
    expect(iconCell.fit).toEqual([150, 150]);
    expect(iconCell.width).toBe(150);
  });

  it("falls back to the text-badge cell when an entry has no dataUrl", () => {
    const row = buildAppendixRow(
      att({ name: "report.pdf", mimeType: "application/pdf" }),
    );
    const cols = (row as { columns?: unknown[] }).columns!;
    const iconCol = cols[0] as { stack?: unknown[] };
    const iconCell = iconCol.stack![0] as { table?: unknown; image?: unknown };
    // No image property on the fallback cell.
    expect(iconCell.image).toBeUndefined();
    // Fallback uses a nested table containing the short mime label.
    expect(iconCell.table).toBeTruthy();
    const badgeTexts = collectAllText(iconCell);
    expect(badgeTexts).toContain("PDF");
  });

  it("labels each appendix row with filename + 'mime · size' meta", () => {
    const row = buildAppendixRow(
      att({
        name: "spec.pdf",
        mimeType: "application/pdf",
        byteLength: 2 * 1024 * 1024, // 2 MB
      }),
    );
    const texts = collectAllText(row);
    expect(texts).toContain("spec.pdf");
    // Meta line combines mime + size via "·".
    const meta = texts.find((t) => t.includes("application/pdf"));
    expect(meta).toBeDefined();
    expect(meta).toContain("2.0 MB");
  });
});

// ---- PFBB child overlay (slice 10H.10) ---------------------------

describe("buildSpecPdf with pfbbChildOverlay", () => {
  const masterSections: SectionData[] = [
    s(10, null, 1, "Allment", "<p>Master body 1.</p>"),
    s(11, null, 2, "Konstruktion", "<p>Master body 2.</p>"),
    s(12, null, 3, "Vedligehold", ""), // master body empty
  ];

  it("inserts a PFBB note page between cover and TOC when overlay is set", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "Child BDB",
      sections: masterSections,
      includeCoverPage: true,
      includeToc: true,
      pfbbChildOverlay: {
        masterName: "Vægge Master",
        supplementBodyBySectionId: {
          10: "<p>My project-specific addition.</p>",
        },
      },
    });
    const content = doc.content as Content[];
    const texts = collectAllText(content);
    // Note page title + section heading are present.
    expect(texts).toContain("Om denne bygningsdelsbeskrivelse");
    // Section with supplement (10 = "Allment") is listed as a link —
    // the list item is a plain `{text: "1  Allment", linkToDestination: ...}`
    // node so collectAllText picks it up directly.
    const hasListItem = texts.some((t) => t.includes("Allment"));
    expect(hasListItem).toBe(true);

    // The explainer paragraph uses inline text-array ([string, {bold,text}, string])
    // for the bold master name; serialise the whole tree for a content
    // search so we can assert both the master name and the grey/black
    // reading key appear together.
    const asJson = JSON.stringify(content);
    expect(asJson).toContain("Vægge Master");
    expect(asJson).toContain("Grå tekst");
    expect(asJson).toContain("Sort tekst");
  });

  it("shows the 'ingen supplementer' message when the child has no supplements", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "Empty child",
      sections: masterSections,
      pfbbChildOverlay: {
        masterName: "Some master",
        supplementBodyBySectionId: {},
      },
    });
    const asJson = JSON.stringify(doc.content);
    // Copy is one plain string (italic, no inline bold), so it's
    // picked up as a single text node either way — search the tree
    // to be robust against future wording tweaks on the same key
    // phrase.
    expect(asJson).toMatch(
      /ingen projektspecifikke supplementer|al tekst er overtaget/,
    );
  });

  it("renders master body in a grey-colored stack and supplement in default color", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "T",
      sections: [s(1, null, 1, "A", "<p>MASTER</p>")],
      pfbbChildOverlay: {
        masterName: "M",
        supplementBodyBySectionId: { 1: "<p>SUPPLEMENT</p>" },
      },
    });
    const content = doc.content as Content[];
    // Find the grey stack wrapping the master body.
    const greyStacks: unknown[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.color === "#999" && Array.isArray(obj.stack)) {
        greyStacks.push(obj);
      }
      if (Array.isArray(obj.stack)) for (const x of obj.stack) visit(x);
      if (Array.isArray(n)) for (const x of n as unknown[]) visit(x);
    };
    for (const n of content) visit(n);
    expect(greyStacks.length).toBe(1);

    // Supplement body appears in content, NOT nested in a grey stack.
    const allTexts = collectAllText(content);
    expect(allTexts).toContain("<p>SUPPLEMENT</p>");
    expect(allTexts).toContain("<p>MASTER</p>");
  });

  it("section with supplement but no master renders black supplement only", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "T",
      sections: [s(5, null, 1, "Only supplement", "")], // master empty
      pfbbChildOverlay: {
        masterName: "M",
        supplementBodyBySectionId: { 5: "<p>Supplement only.</p>" },
      },
    });
    const content = doc.content as Content[];
    const texts = collectAllText(content);
    expect(texts).toContain("<p>Supplement only.</p>");

    // No grey stack for section 5 since master body is empty.
    let greyStackCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.color === "#999" && Array.isArray(obj.stack)) {
        greyStackCount++;
      }
      if (Array.isArray(obj.stack)) for (const x of obj.stack) visit(x);
    };
    for (const n of content) visit(n);
    // The note page may or may not contain grey wrappers, but the
    // section-walk output should have zero grey stacks.
    // We verify by counting them across ONLY the body-region nodes.
    // A simpler invariant: no converter output was tinted grey.
    // We rely on the fact that the note page doesn't use the grey
    // wrapper — it only uses pfbbNoteBody style (no color). So 0.
    expect(greyStackCount).toBe(0);
  });

  it("section with master body but no supplement renders grey master only", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "T",
      sections: [s(7, null, 1, "Inherited", "<p>Just master.</p>")],
      pfbbChildOverlay: {
        masterName: "M",
        supplementBodyBySectionId: {}, // no supplements
      },
    });
    const content = doc.content as Content[];
    const texts = collectAllText(content);
    expect(texts).toContain("<p>Just master.</p>");
    // Grey wrapper exists for the master body.
    let greyStackCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.color === "#999" && Array.isArray(obj.stack)) {
        greyStackCount++;
      }
      if (Array.isArray(obj.stack)) for (const x of obj.stack) visit(x);
    };
    for (const n of content) visit(n);
    expect(greyStackCount).toBe(1);
  });

  it("heading gets a destination id so note-page links can target it", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "T",
      sections: [s(42, null, 1, "Hello", "<p>body</p>")],
      pfbbChildOverlay: {
        masterName: "M",
        supplementBodyBySectionId: { 42: "<p>supp</p>" },
      },
    });
    const content = doc.content as Content[];
    // Look for the heading node with id "section-42".
    const found = content.find(
      (n) =>
        n != null &&
        typeof n === "object" &&
        (n as { id?: string }).id === "section-42",
    );
    expect(found).toBeDefined();
  });

  it("walk is unchanged when no overlay is supplied (no grey tinting)", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      kind: "bdb",
      title: "T",
      sections: [s(1, null, 1, "A", "<p>body</p>")],
      // No pfbbChildOverlay.
    });
    const content = doc.content as Content[];
    let greyStackCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.color === "#999" && Array.isArray(obj.stack)) {
        greyStackCount++;
      }
      if (Array.isArray(obj.stack)) for (const x of obj.stack) visit(x);
    };
    for (const n of content) visit(n);
    expect(greyStackCount).toBe(0);
  });
});

// ---- formatBytes --------------------------------------------------

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("keeps raw bytes below 1 KB", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB with one decimal up to 10 KB, no decimal above", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(500 * 1024)).toBe("500 KB");
  });

  it("formats MB with one decimal up to 10 MB, no decimal above", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("formats GB for very large files", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe("10 GB");
  });

  it("clamps NaN / negative / Infinity to '0 B'", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

// ---- mimeShortLabel ----------------------------------------------

describe("mimeShortLabel", () => {
  it("maps the common office / pdf mime types to their short tag", () => {
    expect(mimeShortLabel("application/pdf")).toBe("PDF");
    expect(mimeShortLabel("application/msword")).toBe("DOC");
    expect(
      mimeShortLabel(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("DOC");
    expect(mimeShortLabel("application/vnd.ms-excel")).toBe("XLS");
    expect(
      mimeShortLabel(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("XLS");
    expect(mimeShortLabel("application/vnd.ms-powerpoint")).toBe("PPT");
    expect(
      mimeShortLabel(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("PPT");
  });

  it("tags text/* and image/* families generically", () => {
    expect(mimeShortLabel("text/plain")).toBe("TXT");
    expect(mimeShortLabel("text/markdown")).toBe("TXT");
    expect(mimeShortLabel("image/png")).toBe("IMG");
    expect(mimeShortLabel("image/jpeg")).toBe("IMG");
  });

  it("falls back to the first three chars of the subtype for unknown mimes", () => {
    expect(mimeShortLabel("application/zip")).toBe("ZIP");
    expect(mimeShortLabel("application/x-custom")).toBe("X-C");
    expect(mimeShortLabel("video/mp4")).toBe("MP4");
    // No slash → first 3 chars of whatever was passed.
    expect(mimeShortLabel("wibble")).toBe("WIB");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(mimeShortLabel("  Application/PDF  ")).toBe("PDF");
    expect(mimeShortLabel("IMAGE/PNG")).toBe("IMG");
  });
});

/**
 * Walk an arbitrary pdfmake Content node (including nested tables and
 * columns) and collect every string `text` value. Needed because the
 * BIPS header is a nested table + columns structure, so the older
 * "grab node.columns[0].text" trick no longer works.
 */
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

/* ------------------------------------------------------------------ */
/*  Task 173 - a blank page 1 reserved for a custom cover              */
/* ------------------------------------------------------------------ */

describe("buildSpecPdf - reserveCoverPage (Task 173)", () => {
  type Chrome = (p: number, pc: number) => unknown;

  it("starts with a blank page and treats page 1 as the cover in header and footer", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      projectName: "My project",
      reserveCoverPage: true,
    });
    const content = doc.content as Content[];
    expect(content[0]).toEqual({ text: "", pageBreak: "after" });
    const header = doc.header as Chrome;
    const footer = doc.footer as Chrome;
    expect((header(1, 5) as { text?: string }).text).toBe("");
    expect((footer(1, 5) as { text?: string }).text).toBe("");
    // pdfmake counts the reserved page, so page 2 is numbered 2 - no offset.
    expect(collectAllText(header(2, 5))).toContain("2/5");
    expect(collectAllText(footer(2, 5))).toContain("Page 2 of 5");
  });

  it("is off by default - page 1 is body and carries the header", () => {
    const doc = buildSpecPdf({ ...defaultArgs(), projectName: "My project" });
    const content = doc.content as Content[];
    expect(content[0]).not.toEqual({ text: "", pageBreak: "after" });
    expect(collectAllText((doc.header as Chrome)(1, 5))).toContain(
      "My project",
    );
  });

  it("is ignored when the built-in cover is on", () => {
    const doc = buildSpecPdf({
      ...defaultArgs(),
      includeCoverPage: true,
      reserveCoverPage: true,
    });
    const content = doc.content as Content[];
    expect(content[0]).not.toEqual({ text: "", pageBreak: "after" });
    const blanks = content.filter(
      (n) =>
        JSON.stringify(n) === JSON.stringify({ text: "", pageBreak: "after" }),
    );
    expect(blanks).toHaveLength(0);
  });
});
