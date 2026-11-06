/**
 * Preserve-only TipTap extensions for formatting other tools write
 * (Task 138).
 *
 * The sanitizer allows h1-h6, blockquote, pre, sub and sup (and b / i,
 * which StarterKit's Bold and Italic already read as strong / em). The
 * editor's schema did not know the first five: StarterKit's heading,
 * blockquote and codeBlock are switched off in `SectionEditor`, and
 * StarterKit has no sub / sup at all. ProseMirror drops what its schema
 * does not know, so editing a section that held any of them lost the
 * formatting on the next save, even though the sanitizer let it through.
 *
 * These extensions only teach the schema to read and write the tags.
 * They deliberately add no toolbar button, no input rule ("# " does not
 * turn a line into a heading) and no keyboard shortcut: the user keeps
 * the editor they know, and content from elsewhere survives an edit.
 * Same approach as tables and images were given before they got a UI.
 *
 * The node and mark names are our own, not StarterKit's, so nothing
 * that asks `isActive("heading")` mistakes them for the switched-off
 * StarterKit versions.
 */

import { Mark, Node } from "@tiptap/core";

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** `<h1>`-`<h6>`, level kept as an attribute. */
export const PreservedHeading = Node.create({
  name: "preservedHeading",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      level: { default: 1, rendered: false },
    };
  },

  parseHTML() {
    return HEADING_LEVELS.map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    }));
  },

  renderHTML({ node }) {
    const level = node.attrs["level"] as number;
    const safe = HEADING_LEVELS.includes(level as 1) ? level : 1;
    return [`h${safe}`, 0];
  },
});

/** `<blockquote>` around one or more blocks. */
export const PreservedBlockquote = Node.create({
  name: "preservedBlockquote",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "blockquote" }];
  },

  renderHTML() {
    return ["blockquote", 0];
  },
});

/**
 * `<pre>`: plain text with its whitespace kept. Rendered as a bare
 * `<pre>`, not StarterKit's `<pre><code>`, because `<code>` is not on
 * the allowlist.
 */
export const PreservedPre = Node.create({
  name: "preservedPre",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "pre", preserveWhitespace: "full" }];
  },

  renderHTML() {
    return ["pre", 0];
  },
});

/** `<sub>`. A run of text cannot be both sub- and superscript. */
export const PreservedSubscript = Mark.create({
  name: "preservedSubscript",
  excludes: "preservedSuperscript",

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML() {
    return ["sub", 0];
  },
});

/** `<sup>`. */
export const PreservedSuperscript = Mark.create({
  name: "preservedSuperscript",
  excludes: "preservedSubscript",

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML() {
    return ["sup", 0];
  },
});

/** All five, in the order `SectionEditor` mounts them. */
export const PRESERVED_FORMATTING_EXTENSIONS = [
  PreservedHeading,
  PreservedBlockquote,
  PreservedPre,
  PreservedSubscript,
  PreservedSuperscript,
];
