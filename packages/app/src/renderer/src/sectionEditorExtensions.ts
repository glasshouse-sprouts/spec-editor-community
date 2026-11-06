/**
 * The TipTap extension list for the section editor.
 *
 * Lives outside `SectionEditor.tsx` so tests can build an editor with
 * exactly the schema the app uses (Task 138: what survives an edit is
 * decided by this list, not by the sanitizer alone). Each call returns
 * fresh extension instances, as `useEditor` expects.
 */

import type { Extensions } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { Table, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

import {
  BgColor,
  MolioTableCell,
  MolioTableHeader,
  TextColor,
} from "./editorMarks.js";
import { PRESERVED_FORMATTING_EXTENSIONS } from "./editorPreservedFormatting.js";

export function sectionEditorExtensions(): Extensions {
  return [
    // StarterKit = document + paragraph + text + bold + italic + strike
    // + lists + history + hardBreak (and a few we don't want). Disable
    // the Molio-disallowed ones so the toolbar can't produce them and
    // schema-level validation rejects pasted content. Strike is kept
    // ON — 6L.1 introduced it to the whitelist. Heading, blockquote and
    // codeBlock stay off: the preserve-only versions at the end of this
    // list read and write those tags without input rules or shortcuts
    // (Task 138).
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      // 6L.2 — external URL links. StarterKit bundles
      // `@tiptap/extension-link`; we tune its defaults:
      //   - `openOnClick: false` — during editing, clicking a link
      //     should move the caret, not open the URL in Electron.
      //     Opening is a reader-mode (#72 Icebox) concern.
      //   - `defaultProtocol: "https"` — if autolink sees a bare
      //     "example.com", treat it as https rather than http.
      //   - `protocols: ["mailto"]` — add mailto to the built-in
      //     http/https set (they're always included regardless).
      //   - `autolink: true` (default) — convert typed / pasted
      //     URLs into links automatically.
      //   - We deliberately do NOT set target/rel; our sanitizer
      //     strips them anyway, and without a target="_blank" the
      //     rel="noopener" wouldn't do anything in the PDF either.
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        protocols: ["mailto"],
      },
    }),
    // 6L.1 custom class-based marks (see editorMarks.ts for why not
    // extension-color / extension-highlight).
    TextColor,
    BgColor,
    // 6L.5a — inline base64 images. `allowBase64` lets TipTap accept
    // `data:image/...;base64,...` URLs (the default schema rejects
    // them as scripted). `inline: false` makes `<img>` a block node
    // wrapped in a paragraph — matches our sanitizer rule that images
    // live at the paragraph level, not inline with text.
    //
    // 6L.5a.4 — enable drag-to-resize handles on the four corners.
    // `alwaysPreserveAspectRatio: true` locks the aspect ratio to the
    // image's natural ratio (no squishing). The commit writes `width`
    // (and `height`) back to the node's attrs; the sanitizer strips
    // `height` on save so the browser / pdfmake re-derive it from the
    // natural aspect ratio at render time — that keeps stored HTML
    // small and avoids aspect-mismatch bugs if the source image is
    // ever swapped. `minWidth: 50` keeps the handles grabbable.
    Image.configure({
      allowBase64: true,
      inline: false,
      resize: {
        enabled: true,
        alwaysPreserveAspectRatio: true,
        minWidth: 50,
        minHeight: 50,
      },
    }),
    // 6L.4 — enable column resize + use our custom cell nodes so
    // widths round-trip via `data-width` instead of inline `style`.
    Table.configure({ resizable: true }),
    TableRow,
    MolioTableHeader,
    MolioTableCell,
    // Task 138: h1-h6, blockquote, pre, sub and sup survive an edit.
    // Preserve-only - no toolbar, input rules or shortcuts.
    ...PRESERVED_FORMATTING_EXTENSIONS,
  ];
}
