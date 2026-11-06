/** @vitest-environment jsdom */

/**
 * Task 138 - twelve tags other tools write must survive our app.
 *
 * h1-h6, blockquote, pre, b, i, sub and sup used to be stripped by the
 * sanitizer at load (the text stayed, the tag went) and the loss was
 * written to disk on the next save. Two paths are tested:
 *
 *   1. Open and save without touching the section. Only the load-time
 *      sanitizer touches the body; save sends edited sections only.
 *   2. Edit the section in the editor and save. Then the editor's
 *      schema decides what survives, before the sanitizer runs again.
 *      The editor is built from `sectionEditorExtensions()`, the same
 *      list `SectionEditor` mounts.
 *
 * b and i are the exception on path 2: StarterKit reads them as bold
 * and italic and writes them back as strong and em. The formatting
 * survives; the tag name does not.
 */

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import { sanitizeBody } from "../src/renderer/src/sanitizeBody.js";
import { sanitizeLoadedFile } from "../src/renderer/src/sanitizeLoadedFile.js";
import { sectionEditorExtensions } from "../src/renderer/src/sectionEditorExtensions.js";

/** One body per tag, so a failure names the tag. */
const BODY_BY_TAG: Record<string, string> = {
  h1: "<h1>Overskrift 1</h1>",
  h2: "<h2>Overskrift 2</h2>",
  h3: "<h3>Overskrift 3</h3>",
  h4: "<h4>Overskrift 4</h4>",
  h5: "<h5>Overskrift 5</h5>",
  h6: "<h6>Overskrift 6</h6>",
  blockquote: "<blockquote><p>Citat fra en anden kilde</p></blockquote>",
  pre: "<pre>linje 1\n    indrykket linje 2</pre>",
  b: "<p>Det er <b>fedt</b> skrevet</p>",
  i: "<p>Det er <i>kursivt</i> skrevet</p>",
  sub: "<p>H<sub>2</sub>O</p>",
  sup: "<p>Areal i m<sup>2</sup></p>",
};

/** What each tag becomes after an edit in the editor. */
const AFTER_EDIT: Record<string, string> = {
  ...Object.fromEntries(Object.keys(BODY_BY_TAG).map((t) => [t, t])),
  b: "strong",
  i: "em",
};

function payloadWith(body: string): FilePayload {
  const section = {
    id: 1,
    body,
  } as FilePayload["sectionsByBdb"][number][number];
  return {
    sectionsByWorkSpec: {},
    sectionsByBdb: { 7: [section] },
  } as unknown as FilePayload;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Open `body` in an editor with the app's schema, type at the end. */
function editAndSave(body: string): string {
  editor = new Editor({ extensions: sectionEditorExtensions(), content: body });
  editor.commands.focus("end");
  editor.commands.insertContent(" (rettet)");
  return sanitizeBody(editor.getHTML());
}

describe("Task 138 - open and save without editing", () => {
  it.each(Object.entries(BODY_BY_TAG))(
    "<%s> is left byte-for-byte as it was",
    (_tag, body) => {
      expect(sanitizeBody(body)).toBe(body);
      const loaded = sanitizeLoadedFile(payloadWith(body));
      expect(loaded.sectionsByBdb[7]![0]!.body).toBe(body);
    },
  );

  it("keeps a body holding all twelve tags at once", () => {
    const all = Object.values(BODY_BY_TAG).join("");
    expect(sanitizeBody(all)).toBe(all);
  });

  it("still strips attributes on the new tags", () => {
    expect(sanitizeBody('<h2 onclick="x()" class="big">T</h2>')).toBe(
      "<h2>T</h2>",
    );
    expect(sanitizeBody('<sup style="color:red">2</sup>')).toBe("<sup>2</sup>");
  });
});

describe("Task 138 - edit in the editor, then save", () => {
  it.each(Object.entries(BODY_BY_TAG))(
    "<%s> survives an edit of the section",
    (tag, body) => {
      const saved = editAndSave(body);
      const expected = AFTER_EDIT[tag]!;
      expect(saved).toContain(`<${expected}>`);
      expect(saved).toContain("(rettet)");
    },
  );

  it("keeps the heading level and the whitespace in <pre>", () => {
    // The trailing <p></p> is StarterKit's TrailingNode: when a section
    // ends in a block other than a paragraph, the editor adds an empty
    // one so the caret can get below it. Tables and images already
    // behave like this; it is not new with Task 138.
    expect(editAndSave("<h4>Fire</h4>")).toBe("<h4>Fire (rettet)</h4><p></p>");
    expect(editAndSave(BODY_BY_TAG["pre"]!)).toBe(
      "<pre>linje 1\n    indrykket linje 2 (rettet)</pre><p></p>",
    );
  });

  it("writes b and i back as strong and em", () => {
    expect(editAndSave(BODY_BY_TAG["b"]!)).toBe(
      "<p>Det er <strong>fedt</strong> skrevet (rettet)</p>",
    );
    expect(editAndSave(BODY_BY_TAG["i"]!)).toBe(
      "<p>Det er <em>kursivt</em> skrevet (rettet)</p>",
    );
  });

  it("does not turn '# ' into a heading while typing", () => {
    editor = new Editor({
      extensions: sectionEditorExtensions(),
      content: "<p></p>",
    });
    const hasHeadingInputRule = editor.extensionManager.extensions.some(
      (e) =>
        e.name.startsWith("preserved") &&
        (e.config.addInputRules !== undefined ||
          e.config.addKeyboardShortcuts !== undefined),
    );
    expect(hasHeadingInputRule).toBe(false);
  });
});
