/**
 * SectionEditor — TipTap-based rich-text editor for a single section body.
 *
 * Scope (Slice 6B + 6L.0 + 6L.1):
 *   - Editable nodes: paragraph, hard break, bullet/ordered lists, list
 *     items.
 *   - Editable marks: bold (<strong>), italic (<em>), underline (<u>),
 *     strikethrough (<s>), text color (<span class="tc-{color}">),
 *     highlight background (<mark class="bg-{color}">).
 *   - Preserved (but not insertable via toolbar): image, table family.
 *     We mount extensions for these so existing file content survives the
 *     round-trip into TipTap's schema and back. Users can't *create* new
 *     images / tables in this slice; richer nodes land in 6L.4 / 6L.5a.
 *   - Everything else in the Molio whitelist is still enforced at save by
 *     DOMPurify as a belt-and-braces check.
 *
 * Formatting UI (6L.0 + 6L.1):
 *   - Formatting lives in a `BubbleMenu` that floats above the current
 *     selection. No selection → no chrome at all. Keyboard shortcuts
 *     continue to work regardless (⌘B bold, ⌘I italic, ⌘U underline,
 *     ⌘⇧X strike, Tab/Shift+Tab for list nesting).
 *   - Single-row layout: B | I | U | S | • List | 1. List | A▾
 *     (text color) | H▾ (highlight). The two color controls are
 *     dropdowns so the bar stays short.
 */

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import { Image } from "@tiptap/extension-image";
import { Table, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold as BoldIcon,
  Highlighter as HighlighterIcon,
  Image as ImagePickIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  Strikethrough as StrikeIcon,
  Table as TableIcon,
  Type as TypeIcon,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  BgColor,
  MolioTableCell,
  MolioTableHeader,
  PALETTE_COLORS,
  TextColor,
  type PaletteColor,
} from "./editorMarks.js";
import {
  extractImageFiles,
  handleImageDrop,
  handleImagePaste,
  openImageFilePicker,
  processAndInsertImages,
  type ImageInsertCallbacks,
  type ImageInsertNotice,
} from "./imageDropPaste.js";
import { useT } from "./i18n/i18n.js";

interface Props {
  /** The sanitized HTML this editor should start with. */
  initialHtml: string;
  /** Called on every change with the new raw HTML (unsanitized). */
  onChange: (html: string) => void;
  /** Called when the editor loses focus — lets the parent collapse back
   *  to the read-only view if desired. */
  onBlur?: () => void;
  /** True ⇢ autofocus when mounted. Used when the user click-to-edits. */
  autoFocus?: boolean;
  /**
   * Viewport coordinates where the user clicked to start editing. When
   * set, we place the caret at that screen position instead of at the
   * end of the document. Requires the edit-mode DOM to occupy the same
   * space as the read-mode DOM (see `.section-editor` negative margins
   * in styles.css) — otherwise the click point maps to a nearby but
   * not identical text position. Falls back to "end" if the point is
   * outside the editor (e.g. the user clicked below the last line).
   */
  initialCursorAt?: { x: number; y: number } | null;
  /**
   * 6L.5a-β image-insert callbacks. The UI layer (App / MainPane) can
   * hook these to show a soft warning banner (file bigger than ~500 KB
   * but under the hard limit), an error toast (file > 5 MB rejected),
   * or a decode-failure toast. All optional — if omitted, warn/reject
   * are silent (the file just doesn't land in the editor) and errors
   * are ignored.
   */
  onImageInsertWarn?: (n: ImageInsertNotice) => void;
  onImageInsertReject?: (n: ImageInsertNotice) => void;
  onImageInsertError?: (n: { fileName: string | null; error: unknown }) => void;
  /**
   * Phase 8 round 2 — when false, TipTap is mounted in read-only
   * mode (no caret, no input, no toolbar). Default true. Used by
   * Reader mode (Læsetilstand) to lock supplements that would
   * otherwise be editable, e.g. PFBB child supplement bodies that
   * are mounted unconditionally rather than via click-to-edit.
   */
  editable?: boolean;
}

export function SectionEditor({
  initialHtml,
  onChange,
  onBlur,
  autoFocus,
  initialCursorAt,
  onImageInsertWarn,
  onImageInsertReject,
  onImageInsertError,
  editable = true,
}: Props): JSX.Element {
  const t = useT();
  // Keep the latest onChange in a ref so the editor's update handler
  // doesn't need to be re-bound every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  // Same pattern for the image callbacks — the editor's editorProps are
  // captured once at construction, so we look up the latest callback
  // through a ref on each drop/paste event.
  const imageCallbacksRef = useRef<ImageInsertCallbacks>({});
  imageCallbacksRef.current = {
    onWarn: onImageInsertWarn,
    onReject: onImageInsertReject,
    onError: onImageInsertError,
  };
  // The TipTap editor ref — populated once `useEditor` returns below.
  // editorProps.handleDrop / handlePaste capture this ref so they can
  // reach back to the Editor's `.chain()` API (ProseMirror's view
  // object alone doesn't expose it).
  const editorRef = useRef<Editor | null>(null);
  // 6L.5a-γ2 — suppress the blur-unmount pipeline while an image
  // operation is in flight.
  //
  // Why this exists
  // ---------------
  // The parent (AlignedSpecView) unmounts this editor as soon as
  // TipTap fires `onBlur` — that's the "click-to-edit / click-away-
  // to-stop" model. Image operations blur the editor in benign ways:
  //   - Opening the OS file picker focuses the dialog window → blur.
  //   - Drag+drop on the wrapper (not the contenteditable) moves
  //     focus outside the PM node → blur.
  // Without a suppressor, the editor unmounts and the async insert
  // then fires on a destroyed editor — the image silently doesn't
  // land and the section "becomes non-editable again" (the symptom
  // the user reported).
  //
  // We set the ref true before starting an image op, run the op
  // (which is usually async), and clear the ref on completion with
  // a small trailing setTimeout so any pending blur event that was
  // already queued gets through *while the flag is still set*.
  const suppressBlurRef = useRef(false);

  /**
   * 6P.3 — right-click context menu for tables.
   *
   * Simplest possible scope (option A): we react ONLY when the right-
   * click lands inside a <td> or <th>. For every other spot — regular
   * paragraphs, images, list items, outside the editor — we let the
   * browser show its native context menu (spell-check, paste, emoji,
   * etc.). That keeps the OS-level affordances users expect on a
   * text area without forcing us to reimplement paste / spell-check.
   *
   * State is just the viewport (x, y) of the click. `null` means
   * the menu is closed.
   */
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const tableMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tableMenu) return;
    const onDown = (e: MouseEvent): void => {
      if (tableMenuRef.current?.contains(e.target as Node)) return;
      setTableMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setTableMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tableMenu]);

  /**
   * Helper — flip the blur suppressor on, run an image operation
   * (sync or async), then flip it back off once we're past the
   * blur-window. Caller-provided `op` can be:
   *   - a sync function (fire-and-forget insert was queued inside)
   *   - an async function / Promise (we await it before clearing)
   *
   * The trailing 100 ms timeout is a balance: long enough for the
   * blur triggered by picker-open to fire; short enough that the
   * editor still blur-unmounts normally if the user alt-tabs
   * immediately after completing the insert.
   */
  const runWithBlurSuppressed = (op: () => Promise<void> | void): void => {
    suppressBlurRef.current = true;
    const release = () => {
      setTimeout(() => {
        suppressBlurRef.current = false;
      }, 100);
    };
    let result: Promise<void> | void;
    try {
      result = op();
    } catch (err) {
      release();
      throw err;
    }
    if (result && typeof (result as Promise<void>).finally === "function") {
      (result as Promise<void>).finally(release);
    } else {
      release();
    }
  };

  const editor = useEditor({
    extensions: [
      // StarterKit = document + paragraph + text + bold + italic + strike
      // + lists + history + hardBreak (and a few we don't want). Disable
      // the Molio-disallowed ones so the toolbar can't produce them and
      // schema-level validation rejects pasted content. Strike is kept
      // ON — 6L.1 introduced it to the whitelist.
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
    ],
    content: initialHtml,
    // Phase 8 round 2 — Reader mode (Læsetilstand). When the
    // surrounding component flips this off, TipTap mounts read-only
    // (no caret, no input, no bubble menu). Click-to-edit gates
    // upstream prevent SpecView from even mounting this in reader
    // mode; the prop covers the always-mounted case (PFBB child
    // supplement).
    editable,
    // When we have click coordinates we handle focus + caret placement
    // below in a useEffect; otherwise fall back to 'end' so the user
    // can still start typing after opening an empty body via keyboard.
    autofocus: autoFocus && !initialCursorAt ? "end" : false,
    editorProps: {
      attributes: {
        class: "section-editor__content",
      },
      // 6L.5a-β: capture image drops/pastes.
      //
      // Returning `true` means "I handled it" — ProseMirror skips its
      // default behaviour (which would e.g. insert a <img> with an
      // `blob:` URL that TipTap's schema rejects anyway) and, for
      // drops, our `stopPropagation` inside `handleImageDrop` keeps
      // the app-level .moliospec drop handler from claiming the event.
      //
      // Returning `false` for non-image transfers lets ProseMirror /
      // the app-level handler do the normal thing (e.g. open a
      // dropped .moliospec file).
      handleDrop: (_view, event) => {
        const ed = editorRef.current;
        if (!ed) return false;
        // We can't inspect the transfer for image files here without
        // duplicating logic from handleImageDrop — just flip the
        // suppressor on for the duration; it's harmless for non-image
        // drops (they return `false` immediately and the suppressor
        // lifts after the 100 ms trailing timeout).
        suppressBlurRef.current = true;
        const handled = handleImageDrop(
          ed,
          event as DragEvent,
          imageCallbacksRef.current,
        );
        // Release on the next tick if no image was handled (nothing
        // async in flight). If an insert was claimed, handleImageDrop's
        // fire-and-forget processAndInsertImages will outlast this
        // release — the blur it guards against is the synchronous one
        // fired by the drop itself, which happens before this tick.
        setTimeout(() => {
          suppressBlurRef.current = false;
        }, 100);
        return handled;
      },
      handlePaste: (_view, event) => {
        const ed = editorRef.current;
        if (!ed) return false;
        suppressBlurRef.current = true;
        const handled = handleImagePaste(
          ed,
          event as ClipboardEvent,
          imageCallbacksRef.current,
        );
        setTimeout(() => {
          suppressBlurRef.current = false;
        }, 100);
        return handled;
      },
    },
    onUpdate({ editor }) {
      onChangeRef.current(editor.getHTML());
    },
    onBlur() {
      // Suppress the unmount-on-blur while an image operation is in
      // flight — see suppressBlurRef comment above.
      if (suppressBlurRef.current) return;
      onBlurRef.current?.();
    },
  });

  // Keep editorRef in sync. useEditor returns the same instance across
  // renders (after the first), so this is cheap — we just want the
  // editorProps handlers above to be able to reach `editor.chain()`.
  editorRef.current = editor;

  // Place the caret at the user's click point when we have coordinates.
  // `posAtCoords` translates a viewport (left, top) pair into a
  // ProseMirror document position. Wrapped in try/catch because:
  //  (a) posAtCoords can return null or a position that's not a valid
  //      text-selection target (table border, resize handle zone, etc.)
  //  (b) setTextSelection will throw on an out-of-range pos
  //  (c) the editor's view may not be fully laid out on the first tick
  // In any failure mode we fall back to focus-at-end so editing still
  // works — the caret placement is a UX nicety, not a correctness need.
  //
  // Deferred via requestAnimationFrame so layout has a chance to settle
  // before we ask the view where a screen coordinate maps to.
  useEffect(() => {
    if (!editor || !initialCursorAt) return;
    const raf = requestAnimationFrame(() => {
      try {
        const hit = editor.view.posAtCoords({
          left: initialCursorAt.x,
          top: initialCursorAt.y,
        });
        if (hit && typeof hit.pos === "number") {
          editor.chain().focus().setTextSelection(hit.pos).run();
          return;
        }
      } catch {
        // fall through to the end-of-doc fallback
      }
      try {
        editor.chain().focus("end").run();
      } catch {
        // nothing else to do; user can click again inside the editor.
      }
    });
    return () => cancelAnimationFrame(raf);
    // One-shot: do not re-run on every coordinate/editor change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Tear down the editor instance when the component unmounts. Without
  // this TipTap leaks ProseMirror views — noticeable on a file with
  // many sections being click-edited in succession.
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, []);

  if (!editor) {
    return <div className="section-editor section-editor--loading" />;
  }

  // ---- Wrapper-level drop guard (6L.5a-β hotfix) ----
  //
  // Why this exists
  // ---------------
  // The `editorProps.handleDrop` above only runs when the native drop
  // lands ON the ProseMirror contenteditable DOM node. In practice,
  // users often drop slightly off — on the border, on the bubble/floating
  // menu's footprint, on a line of white space at the bottom — and the
  // event bubbles straight up to the app-level drop handler in App.tsx,
  // which responds with "not a .moliospec file." That's the regression
  // the user reported.
  //
  // Fix: add a React-level `onDrop` on the `.section-editor` wrapper.
  // This is strictly "second line of defence":
  //
  //   - If PM's handler ran and called stopPropagation on the native
  //     event, React's synthetic dispatch never fires (the native event
  //     stopped bubbling before reaching React's root listener), so this
  //     handler does NOT run. No double-insert.
  //
  //   - If PM's handler didn't run (drop outside the contenteditable
  //     but inside the `.section-editor` frame), this handler catches
  //     the React synthetic event before it bubbles to App.
  //
  // The `onDragOver` + `onDragEnter` / `onDragLeave` companions keep
  // the browser's drop-target contract (preventDefault during dragover
  // is REQUIRED for the subsequent drop to fire) and also keep App's
  // drag-counter in sync by stopping those events for image drags.
  const onWrapperDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    // `types` is one of the only dataTransfer fields readable during
    // drag (files/items are gated for security until drop). `Files`
    // indicates at least one file is being dragged.
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onWrapperDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes("Files")) return;
    // Stop App's drag-counter from treating this as an app-level drag.
    e.stopPropagation();
  };

  const onWrapperDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.stopPropagation();
  };

  const onWrapperDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    const files = extractImageFiles(e.dataTransfer);
    if (files.length > 0) {
      // Image drop — claim the event and insert.
      e.preventDefault();
      e.stopPropagation();
      // No coord-based caret here: the drop likely missed the
      // contenteditable, so we just insert at the current selection
      // (or end). Fire-and-forget — the ProseMirror transaction is
      // dispatched per insert.
      //
      // Wrap in the blur-suppressor so the blur fired by the drop
      // moving focus out of the contenteditable doesn't cause the
      // parent to unmount this editor mid-insert.
      runWithBlurSuppressed(() =>
        processAndInsertImages(editor, files, imageCallbacksRef.current),
      );
      return;
    }
    // Non-image file dropped onto the section editor — the user's
    // intent is ambiguous (it's almost certainly NOT "please open
    // this as a .moliospec"), so swallow silently rather than let
    // App show the "not a .moliospec file" error. If the user
    // wanted to open a file, they'd drop it on the main app area.
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /**
   * Right-click handler — 6P.3.
   *
   * Only hijack the event when the click landed inside a table cell.
   * For anything else we let the browser's native context menu fire
   * so paste / spell-check / emoji pickers continue to work on normal
   * text. We also move the caret into the clicked cell so the later
   * add/delete op targets the cell the user actually clicked, not
   * whatever was previously selected.
   */
  const onWrapperContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement | null;
    const cell = target?.closest?.("td, th");
    if (!cell) return;
    e.preventDefault();
    try {
      const hit = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });
      if (hit && typeof hit.pos === "number") {
        editor.chain().focus().setTextSelection(hit.pos).run();
      }
    } catch {
      // Best-effort — fall through to whatever selection exists.
    }
    setTableMenu({ x: e.clientX, y: e.clientY });
  };

  // Clamp the menu inside the viewport. Approximate width/height are
  // "close enough" for the small menu we render — if we get them
  // slightly off, the menu still stays on-screen because the clamp
  // only ever pulls it inward, never pushes it out.
  const TABLE_MENU_W = 200;
  const TABLE_MENU_H = 260;

  return (
    <div
      className="section-editor"
      onDragEnter={onWrapperDragEnter}
      onDragOver={onWrapperDragOver}
      onDragLeave={onWrapperDragLeave}
      onDrop={onWrapperDrop}
      onContextMenu={onWrapperContextMenu}
    >
      {/*
        BubbleMenu floats above the current text selection. It's rendered
        via TipTap's helper (which in turn uses floating-ui under the
        hood) so positioning, auto-hide, and portal behaviour are all
        handled for us. We only provide the button content and styling.
        The `shouldShow` default only shows the menu when the selection
        is non-empty — exactly what we want for formatting buttons.
      */}
      <BubbleMenu
        editor={editor}
        className="section-editor__bubble"
        role="toolbar"
        aria-label={t("editor.aria.toolbar")}
      >
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title={t("editor.toolbar.bold")}
        >
          <BoldIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title={t("editor.toolbar.italic")}
        >
          <ItalicIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title={t("editor.toolbar.underline")}
        >
          <UnderlineIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title={t("editor.toolbar.strike")}
        >
          <StrikeIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <span className="section-editor__bubble-sep" aria-hidden="true" />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title={t("editor.toolbar.bulletList")}
        >
          <ListIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title={t("editor.toolbar.orderedList")}
        >
          <ListOrderedIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        </ToolbarButton>
        <span className="section-editor__bubble-sep" aria-hidden="true" />
        <ColorDropdown
          editor={editor}
          kind="text"
          title={t("editor.toolbar.textColor")}
        />
        <ColorDropdown
          editor={editor}
          kind="bg"
          title={t("editor.toolbar.bgColor")}
        />
        <span className="section-editor__bubble-sep" aria-hidden="true" />
        {/*
          6L.2: external URL link on the current text selection. The
          button is always visible in the bubble menu (which itself
          only renders for non-empty selections), and greys out when
          the selection contains an image node.
        */}
        <LinkButton editor={editor} suppressBlurRef={suppressBlurRef} />
        {/*
          6L.4: table ops only show when the selection is inside a
          table. This keeps the bubble short in the common case.
        */}
        {editor.isActive("table") && (
          <>
            <span className="section-editor__bubble-sep" aria-hidden="true" />
            <TableOpsDropdown editor={editor} />
          </>
        )}
      </BubbleMenu>

      {/*
        6L.4 FloatingMenu: shows on empty paragraphs and gives the user
        a way to insert block content (currently just tables — images
        land in 6L.5a). The `shouldShow` default renders the menu when
        the current node is empty and the selection is a cursor (no
        range).
      */}
      <FloatingMenu editor={editor} className="section-editor__floating">
        <InsertTableButton editor={editor} />
        <InsertImageButton
          editor={editor}
          callbacksRef={imageCallbacksRef}
          suppressBlurRef={suppressBlurRef}
        />
      </FloatingMenu>

      <EditorContent editor={editor} />
      {tableMenu &&
        createPortal(
          <div
            ref={tableMenuRef}
            className="tree-context-menu section-editor__table-ctx-menu"
            role="menu"
            aria-label={t("editor.aria.tableActions")}
            style={{
              top: Math.min(tableMenu.y, window.innerHeight - TABLE_MENU_H - 4),
              left: Math.min(tableMenu.x, window.innerWidth - TABLE_MENU_W - 4),
            }}
            // Prevent ProseMirror from stealing focus when clicking items.
            onMouseDown={(e) => e.preventDefault()}
          >
            <TableCtxMenuItem
              label={t("editor.table.rowAbove")}
              disabled={!editor.can().addRowBefore()}
              onClick={() => {
                editor.chain().focus().addRowBefore().run();
                setTableMenu(null);
              }}
            />
            <TableCtxMenuItem
              label={t("editor.table.rowBelow")}
              disabled={!editor.can().addRowAfter()}
              onClick={() => {
                editor.chain().focus().addRowAfter().run();
                setTableMenu(null);
              }}
            />
            <TableCtxMenuItem
              label={t("editor.table.columnBefore")}
              disabled={!editor.can().addColumnBefore()}
              onClick={() => {
                editor.chain().focus().addColumnBefore().run();
                setTableMenu(null);
              }}
            />
            <TableCtxMenuItem
              label={t("editor.table.columnAfter")}
              disabled={!editor.can().addColumnAfter()}
              onClick={() => {
                editor.chain().focus().addColumnAfter().run();
                setTableMenu(null);
              }}
            />
            <div className="section-editor__table-ops-sep" aria-hidden="true" />
            <TableCtxMenuItem
              label={t("editor.table.deleteRow")}
              disabled={!editor.can().deleteRow()}
              onClick={() => {
                editor.chain().focus().deleteRow().run();
                setTableMenu(null);
              }}
            />
            <TableCtxMenuItem
              label={t("editor.table.deleteColumn")}
              disabled={!editor.can().deleteColumn()}
              onClick={() => {
                editor.chain().focus().deleteColumn().run();
                setTableMenu(null);
              }}
            />
            <TableCtxMenuItem
              label={t("editor.table.deleteTable")}
              disabled={!editor.can().deleteTable()}
              destructive
              onClick={() => {
                editor.chain().focus().deleteTable().run();
                setTableMenu(null);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * One row in the 6P.3 table context menu. Visually identical to the
 * tree-context-menu items (reuses those classes) so the whole app has
 * one "popup menu" look. Uses onMouseDown to fire the command before
 * any blur/outside-click handler can close the menu under us.
 */
function TableCtxMenuItem({
  label,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={`tree-context-menu__item${
        destructive ? " tree-context-menu__item--danger" : ""
      }`}
      disabled={disabled}
      // Fire on mouseDown so the menu closes before ProseMirror sees
      // a blur from the outside-click handler swallowing the click.
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
    >
      {label}
    </button>
  );
}

/**
 * Bubble-menu button. Renders whatever JSX children it gets (almost
 * always a lucide-react icon at the 6L.2 follow-up, previously a glyph
 * string). `title` carries the Danish label used as the tooltip — per
 * Tore's decision the bubble menu is icon-only with tooltip copy.
 *
 * `disabled` greys the button out (semantic and visual) — used by the
 * Link button when the selection covers an image, where inserting a
 * link is explicitly unsupported.
 */
function ToolbarButton({
  active,
  onClick,
  title,
  children,
  disabled,
  style,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`section-editor__bubble-btn${active ? " is-active" : ""}`}
      // Prevent the button press from blurring the editor — otherwise the
      // click tears down the selection and the command runs against an
      // empty range.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}

/**
 * Small controlled dropdown for the text-color / highlight-color pickers
 * in the bubble menu. Click the trigger → panel opens below with four
 * colored swatches and a ⊘ clear button. Click outside → closes.
 *
 * We deliberately do not use a portal here — the bubble menu itself is
 * already portalled to `document.body`, and the panel needs to sit
 * inside the bubble's DOM so its click counts as "inside the bubble"
 * for the parent bubble-menu's own outside-click logic.
 */
function ColorDropdown({
  editor,
  kind,
  title,
}: {
  editor: Editor;
  kind: "text" | "bg";
  title: string;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Currently-applied color for this kind (or null if none).
  const active = editor.getAttributes(kind === "text" ? "textColor" : "bgColor")
    .color as PaletteColor | undefined;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const apply = (color: PaletteColor) => {
    const chain = editor.chain().focus();
    if (kind === "text") chain.setTextColor(color).run();
    else chain.setBgColor(color).run();
    setOpen(false);
  };

  const clear = () => {
    const chain = editor.chain().focus();
    if (kind === "text") chain.unsetTextColor().run();
    else chain.unsetBgColor().run();
    setOpen(false);
  };

  // Icon + thin color bar showing the currently-selected swatch. The
  // bar is always rendered (transparent when no color is set) so the
  // button height doesn't shift between states.
  const Icon = kind === "text" ? TypeIcon : HighlighterIcon;
  const barBg = active ? `var(--palette-${active})` : "transparent";

  return (
    <div className="section-editor__bubble-dd" ref={wrapRef}>
      <button
        type="button"
        className={`section-editor__bubble-btn${open ? " is-open" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="section-editor__color-stack">
          <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
          <span
            className={`section-editor__color-bar${active ? "" : " is-empty"}`}
            style={{ background: barBg }}
          />
        </span>
        <span className="section-editor__bubble-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="section-editor__bubble-dd-panel"
          role="menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          {PALETTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`section-editor__swatch${active === c ? " is-active" : ""}`}
              style={{ background: `var(--palette-${c})` }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(c)}
              title={t(`editor.color.${c}`)}
              aria-label={t(`editor.color.${c}`)}
            />
          ))}
          <button
            type="button"
            className="section-editor__swatch section-editor__swatch--clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            title={t("editor.toolbar.removeColor")}
            aria-label={t("editor.toolbar.removeColor")}
          >
            ⊘
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6L.2 — LinkButton + LinkModal (Insert / Edit / Remove URL link)    */
/* ------------------------------------------------------------------ */

/**
 * Bubble-menu button for wrapping the current text selection in an
 * external URL link. Text-only (Tore decision): disabled when the
 * selection covers an image node.
 *
 * UX history:
 *   - Initial 6L.2 used `window.prompt`, which Electron silently
 *     disables in the renderer (returns null without showing a
 *     dialog). The follow-up replaces it with an in-app modal
 *     matching the rest of the app (Import / BatchExport / Duplicate
 *     BDB). Same "edit or remove" semantics as before.
 *
 * Blur suppression: opening the modal moves focus into its input,
 * which blurs the editor. Without suppression the parent unmounts
 * the SectionEditor on blur and subsequent `editor.chain()...setLink`
 * runs against a destroyed editor. Same `suppressBlurRef` trick
 * the image picker uses — parent owns the ref, we flip it for the
 * duration of the modal and release on close.
 *
 * Scheme enforcement happens in two layers (unchanged):
 *   - TipTap's Link extension runs `isAllowedUri` before the mark is
 *     applied — typing `javascript:…` is silently dropped.
 *   - DOMPurify (6L.2.1) re-vets at save; any non-http/https/mailto
 *     href is stripped, leaving the link text intact.
 *
 * We don't validate mailto syntax — users can type `mailto:x@y.dk`
 * freely; bad addresses just won't open.
 */
function LinkButton({
  editor,
  suppressBlurRef,
}: {
  editor: Editor;
  suppressBlurRef: React.MutableRefObject<boolean>;
}): JSX.Element {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasImage = editor.isActive("image");
  const isLink = editor.isActive("link");
  const currentHref = isLink
    ? ((editor.getAttributes("link") as { href?: string }).href ?? "")
    : "";

  /** Flip the parent's blur suppressor so focus moving into the
   *  modal input doesn't unmount the editor. */
  const openDialog = (): void => {
    if (hasImage) return;
    suppressBlurRef.current = true;
    setDialogOpen(true);
  };

  /** Release the suppressor after a small trailing delay so any blur
   *  event already queued by the modal closing sees the flag set. */
  const closeDialog = (): void => {
    setDialogOpen(false);
    setTimeout(() => {
      suppressBlurRef.current = false;
    }, 100);
  };

  const applyHref = (rawHref: string): void => {
    const trimmed = rawHref.trim();
    // Expand the selection to cover the full link mark before mutating
    // so partial-selection edits don't leave orphaned sub-links.
    const chain = editor.chain().focus().extendMarkRange("link");
    if (trimmed === "") {
      chain.unsetLink().run();
    } else {
      // TipTap's Link extension runs `isAllowedUri` first; anything it
      // rejects (e.g. `javascript:`) is a no-op. Sanitizer is the
      // backstop on save.
      chain.setLink({ href: trimmed }).run();
    }
    closeDialog();
  };

  const removeHref = (): void => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closeDialog();
  };

  return (
    <>
      <ToolbarButton
        active={isLink}
        onClick={openDialog}
        disabled={hasImage}
        title={
          hasImage
            ? t("editor.toolbar.linkOnImage")
            : isLink
              ? t("editor.toolbar.linkEdit")
              : t("editor.toolbar.linkInsert")
        }
      >
        <LinkIcon size={14} strokeWidth={2.25} aria-hidden="true" />
      </ToolbarButton>
      {dialogOpen && (
        <LinkModal
          initialHref={currentHref}
          isEdit={isLink}
          onSubmit={applyHref}
          onRemove={isLink ? removeHref : undefined}
          onCancel={closeDialog}
        />
      )}
    </>
  );
}

/**
 * Simple single-field modal for entering a URL. Rendered via
 * `createPortal` onto `document.body` so the backdrop covers the
 * whole window regardless of where LinkButton sits in the tree
 * (it's nested deep inside the BubbleMenu portal).
 *
 * Keyboard:
 *   - Enter (via form submit) applies the URL.
 *   - Esc cancels. (We listen on the window — the input's own
 *     default keydown doesn't handle Esc in all browsers.)
 *
 * A11y: `role="dialog"` + `aria-modal` + labelled heading so screen
 * readers announce it as a modal. We don't trap focus within the
 * modal — this is a 3-button form, tab-cycling through it is fine.
 */
function LinkModal({
  initialHref,
  isEdit,
  onSubmit,
  onRemove,
  onCancel,
}: {
  initialHref: string;
  isEdit: boolean;
  onSubmit: (href: string) => void;
  onRemove?: () => void;
  onCancel: () => void;
}): JSX.Element {
  const t = useT();
  const [value, setValue] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the URL input when the modal opens so the user can
  // start typing immediately. Select any pre-filled text so an edit
  // can be replaced with a single keypress.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Esc closes. Use capture-phase listener on window so we beat any
  // ancestor handlers that might eat the event first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    onSubmit(value);
  };

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-modal-title"
      // Block mousedown from reaching the editor so the outside-click
      // handlers in nested dropdowns (e.g. TableOpsDropdown) don't
      // treat a click inside the modal as "click outside the dd".
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="modal">
        <h2 id="link-modal-title" className="modal__title">
          {isEdit
            ? t("editor.dialog.link.titleEdit")
            : t("editor.dialog.link.titleInsert")}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="modal__field">
            <label className="modal__field-label" htmlFor="link-modal-href">
              {t("editor.dialog.link.urlLabel")}
            </label>
            <input
              id="link-modal-href"
              ref={inputRef}
              type="text"
              className="modal__input"
              placeholder={t("editor.dialog.link.urlPlaceholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            {onRemove && (
              <button
                type="button"
                className="modal__button modal__button--danger"
                onClick={onRemove}
              >
                {t("editor.dialog.link.remove")}
              </button>
            )}
            <button
              type="submit"
              className="modal__button modal__button--primary"
            >
              {isEdit ? t("common.save") : t("editor.dialog.link.submitInsert")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* 6L.4 — InsertTableButton (grid picker) + TableOpsDropdown          */
/* ------------------------------------------------------------------ */

/** Max rows × cols the grid picker offers at once. 8×8 is the common
 *  upper bound for hand-authored tables; larger tables would be
 *  pasted in from elsewhere. */
const GRID_MAX_ROWS = 8;
const GRID_MAX_COLS = 8;

/**
 * FloatingMenu button that opens a rows × cols grid picker. Hovering
 * a cell highlights that sub-grid; clicking inserts a table of that
 * shape with a header row. Lives in the FloatingMenu so it only
 * appears on empty paragraphs where inserting a block makes sense.
 */
function InsertTableButton({ editor }: { editor: Editor }): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  // hovered is a 1-indexed pair (rows, cols). 0,0 = nothing hovered.
  const [hovered, setHovered] = useState<{ r: number; c: number }>({
    r: 0,
    c: 0,
  });
  // Portal position: top/left in viewport coords + which direction the
  // picker opens (down = below the button, up = above). Recomputed on
  // open and cleared on close.
  const [anchor, setAnchor] = useState<{
    top: number;
    left: number;
    placement: "down" | "up";
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Grid picker is now rendered in a portal on document.body so it
  // isn't clipped/hidden by the stacking context of sibling sections.
  // That changes a few things:
  //  - We compute absolute viewport coordinates from the trigger
  //    button's getBoundingClientRect() and use `position: fixed`.
  //  - Outside-click detection has to check BOTH the wrapper (around
  //    the trigger) and the picker DOM node (which now lives outside).
  //  - If any ancestor scrolls we close the picker — keeping it
  //    anchored to a moving trigger would require continuous
  //    recalculation, which isn't worth it for a momentary popover.
  //  - Escape also closes it (keyboard users expect this).
  useEffect(() => {
    if (!open) return;

    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      if (pickerRef.current?.contains(target)) return;
      setOpen(false);
      setHovered({ r: 0, c: 0 });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHovered({ r: 0, c: 0 });
      }
    };
    const onScroll = () => {
      setOpen(false);
      setHovered({ r: 0, c: 0 });
    };

    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    // Capture phase so we catch scrolls on any ancestor, not just
    // window. The picker is fixed — if any parent moves, our
    // absolute coords go stale instantly.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const insert = (rows: number, cols: number) => {
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setOpen(false);
    setHovered({ r: 0, c: 0 });
  };

  // Build the cell grid once; re-renders just flip class names.
  const cells = useMemo(() => {
    const out: Array<{ r: number; c: number }> = [];
    for (let r = 1; r <= GRID_MAX_ROWS; r++) {
      for (let c = 1; c <= GRID_MAX_COLS; c++) {
        out.push({ r, c });
      }
    }
    return out;
  }, []);

  const label =
    hovered.r > 0 && hovered.c > 0
      ? `${hovered.r} × ${hovered.c}`
      : t("editor.toolbar.insertTable");

  // Rough picker dimensions used only for the flip-up decision; exact
  // size is CSS-driven (8×8 cells @16px + 2px gap + 6px padding + a
  // small label row ≈ 170×190px). We just need a conservative
  // estimate so we pick "up" when there's genuinely not enough room
  // below.
  const PICKER_H_APPROX = 200;
  const PICKER_W_APPROX = 170;
  const GAP = 4;

  const handleOpen = () => {
    if (open) {
      setOpen(false);
      setHovered({ r: 0, c: 0 });
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: "down" | "up" =
      spaceBelow < PICKER_H_APPROX + GAP && rect.top > PICKER_H_APPROX + GAP
        ? "up"
        : "down";
    const top =
      placement === "down"
        ? rect.bottom + GAP
        : rect.top - PICKER_H_APPROX - GAP;
    // Keep the picker inside the viewport horizontally even if the
    // trigger sits near the right edge.
    const left = Math.min(
      Math.max(4, rect.left),
      window.innerWidth - PICKER_W_APPROX - 4,
    );
    setAnchor({ top, left, placement });
    setOpen(true);
  };

  return (
    <div className="section-editor__floating-dd" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`section-editor__floating-btn${open ? " is-open" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleOpen}
        title={t("editor.toolbar.insertTable")}
        aria-label={t("editor.toolbar.insertTable")}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <TableIcon size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={pickerRef}
            className="section-editor__grid-picker section-editor__grid-picker--portal"
            role="menu"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
            }}
          >
            <div
              className="section-editor__grid"
              style={{
                gridTemplateColumns: `repeat(${GRID_MAX_COLS}, 1fr)`,
              }}
              onMouseLeave={() => setHovered({ r: 0, c: 0 })}
            >
              {cells.map(({ r, c }) => {
                const active = r <= hovered.r && c <= hovered.c;
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`section-editor__grid-cell${active ? " is-active" : ""}`}
                    onMouseEnter={() => setHovered({ r, c })}
                    onClick={() => insert(r, c)}
                    role="menuitem"
                    aria-label={t("editor.aria.gridCell", { rows: r, cols: c })}
                  />
                );
              })}
            </div>
            <div className="section-editor__grid-label">{label}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6L.5a-γ — InsertImageButton (FloatingMenu)                          */
/* ------------------------------------------------------------------ */

/**
 * FloatingMenu button that opens the OS file picker for images. Sits
 * next to "Insert table" and only appears on empty paragraphs (the
 * FloatingMenu's default `shouldShow`). When the user picks images we
 * run them through the shared processAndInsertImages pipeline so that
 * the size-budget warn/reject callbacks fire exactly like drop/paste.
 *
 * Why a separate component
 * ------------------------
 * Keeps the editor ref and callbacks ref encapsulated — and mirrors the
 * InsertTableButton pattern for consistency. The button itself does no
 * state bookkeeping (no popover, no hover), so the component is thin.
 *
 * Why `callbacksRef` (not a plain callbacks prop)
 * -----------------------------------------------
 * The parent SectionEditor rebuilds the callbacks object every render
 * (it closes over the latest props). Passing a ref lets this button
 * always see the current values without triggering a re-render cascade,
 * same trick we use for the drop/paste handlers.
 */
function InsertImageButton({
  editor,
  callbacksRef,
  suppressBlurRef,
}: {
  editor: Editor;
  callbacksRef: React.MutableRefObject<ImageInsertCallbacks>;
  suppressBlurRef: React.MutableRefObject<boolean>;
}): JSX.Element {
  const t = useT();
  const onClick = (): void => {
    // The OS file picker steals window focus → the editor fires blur →
    // parent would unmount this whole editor instance. Flag the
    // suppressor ON *before* calling the picker so that spurious blur
    // doesn't tear the editor down. The picker's `change` and `cancel`
    // callbacks both clear the flag.
    suppressBlurRef.current = true;
    const release = () => {
      // Small trailing delay: any blur queued by the picker-close that
      // hasn't fired yet still sees the suppressor set.
      setTimeout(() => {
        suppressBlurRef.current = false;
      }, 100);
    };
    openImageFilePicker(
      (files) => {
        if (files.length === 0) {
          release();
          return;
        }
        // Keep the flag set until the async insert resolves; release in
        // a single `finally` so both success and failure restore normal
        // blur behaviour.
        void processAndInsertImages(
          editor,
          files,
          callbacksRef.current,
        ).finally(release);
      },
      release, // onCancel: user dismissed the picker — just restore state.
    );
  };

  return (
    <button
      type="button"
      className="section-editor__floating-btn"
      // preventDefault on mousedown keeps the editor selection intact —
      // otherwise clicking the button blurs the editor and the later
      // insertContent runs against a collapsed/wrong range.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={t("editor.toolbar.insertImage")}
      aria-label={t("editor.toolbar.insertImage")}
    >
      <ImagePickIcon size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/**
 * Bubble-menu dropdown with table operations. Only rendered when the
 * selection is inside a table (parent gates on `editor.isActive("table")`).
 *
 * Uses TipTap's built-in table commands; each returns false if it
 * can't run (e.g. `deleteRow` in a 1-row table), so we use `can()` to
 * disable buttons that would no-op. The list is short by design — the
 * advanced ops (merge cells, toggle header, per-cell alignment) live
 * in 6L.4-Advanced / icebox.
 */
function TableOpsDropdown({ editor }: { editor: Editor }): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const run = (fn: () => boolean) => {
    fn();
    setOpen(false);
  };

  const canAddRowBefore = editor.can().addRowBefore();
  const canAddRowAfter = editor.can().addRowAfter();
  const canAddColumnBefore = editor.can().addColumnBefore();
  const canAddColumnAfter = editor.can().addColumnAfter();
  const canDeleteRow = editor.can().deleteRow();
  const canDeleteColumn = editor.can().deleteColumn();
  const canDeleteTable = editor.can().deleteTable();

  return (
    <div className="section-editor__bubble-dd" ref={wrapRef}>
      <button
        type="button"
        className={`section-editor__bubble-btn${open ? " is-open" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title={t("editor.toolbar.table")}
        aria-label={t("editor.toolbar.table")}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <TableIcon size={14} strokeWidth={2.25} aria-hidden="true" />
        <span className="section-editor__bubble-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="section-editor__bubble-dd-panel section-editor__table-ops"
          role="menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          <TableOpButton
            label={t("editor.table.rowAbove")}
            disabled={!canAddRowBefore}
            onClick={() =>
              run(() => editor.chain().focus().addRowBefore().run())
            }
          />
          <TableOpButton
            label={t("editor.table.rowBelow")}
            disabled={!canAddRowAfter}
            onClick={() =>
              run(() => editor.chain().focus().addRowAfter().run())
            }
          />
          <TableOpButton
            label={t("editor.table.columnBefore")}
            disabled={!canAddColumnBefore}
            onClick={() =>
              run(() => editor.chain().focus().addColumnBefore().run())
            }
          />
          <TableOpButton
            label={t("editor.table.columnAfter")}
            disabled={!canAddColumnAfter}
            onClick={() =>
              run(() => editor.chain().focus().addColumnAfter().run())
            }
          />
          <div className="section-editor__table-ops-sep" aria-hidden="true" />
          <TableOpButton
            label={t("editor.table.deleteRow")}
            disabled={!canDeleteRow}
            onClick={() => run(() => editor.chain().focus().deleteRow().run())}
          />
          <TableOpButton
            label={t("editor.table.deleteColumn")}
            disabled={!canDeleteColumn}
            onClick={() =>
              run(() => editor.chain().focus().deleteColumn().run())
            }
          />
          <TableOpButton
            label={t("editor.table.deleteTable")}
            disabled={!canDeleteTable}
            destructive
            onClick={() =>
              run(() => editor.chain().focus().deleteTable().run())
            }
          />
        </div>
      )}
    </div>
  );
}

function TableOpButton({
  label,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`section-editor__table-op${destructive ? " is-destructive" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
    >
      {label}
    </button>
  );
}
