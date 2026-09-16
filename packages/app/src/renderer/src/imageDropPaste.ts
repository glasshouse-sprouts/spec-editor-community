/**
 * Paste / drop pipeline for inline base64 images (6L.5a-β).
 *
 * What this module does
 * ---------------------
 * When the user drops image files on the editor or pastes images from
 * the clipboard, this module:
 *
 *   1. Filters the transfer to only `image/*` files. No images → we
 *      return `false` so ProseMirror (and, for drops, the app-level
 *      .moliospec drop handler in App.tsx — "Slice D") can handle it.
 *
 *   2. When there IS at least one image, we call `preventDefault()` and
 *      `stopPropagation()` on the native event. This is critical for
 *      drops: without `stopPropagation`, the event bubbles up through
 *      the React tree to the app-level drop handler which would pop an
 *      "not a .moliospec file" error. With `stopPropagation` the editor
 *      claims ownership of the event.
 *
 *   3. Each image file is run through `processImageFile` (resize +
 *      re-encode + size-budget decision):
 *        - `"reject"` → don't insert, call `onReject`.
 *        - `"warn"`   → insert, call `onWarn` (UI shows a soft banner).
 *        - `"ok"`     → insert silently.
 *      If processing throws, we call `onError` and skip that file.
 *
 *   4. Images are inserted as one `<p><img ...></p>` per file. For drops
 *      we translate the drop point into a document position with
 *      `view.posAtCoords` and insert there; for pastes we insert at the
 *      current selection. Multi-file drops/pastes land one image per
 *      paragraph at the same anchor (successive inserts push each other
 *      down — natural reading order is preserved).
 *
 * Why a standalone module
 * -----------------------
 * TipTap's editor is not pleasant to unit-test (jsdom's canvas is a
 * stub, useEditor creates a full ProseMirror view, etc.). Pulling the
 * drop/paste orchestration into a pure-ish module lets us:
 *
 *   - Inject `processFile` as a dep, so tests use a fake that doesn't
 *     need a real canvas.
 *   - Inject a minimal editor-shaped stub, so we assert that
 *     `insertContent` is called with the right HTML without spinning up
 *     a real TipTap instance.
 *   - Assert `preventDefault`/`stopPropagation` behaviour against fake
 *     DOM events — that's the "drop-image-doesn't-pop-the-open-modal"
 *     regression guarantee.
 *
 * The module is loaded by SectionEditor, which wires
 * `handleImageDrop`/`handleImagePaste` into TipTap's `editorProps`.
 */

import {
  processImageFile as defaultProcessImageFile,
  type ProcessedImage,
} from "./imageProcess.js";

/**
 * Minimal shape of the things we need from the TipTap editor to insert
 * images. Defined as a local type rather than importing `Editor` so the
 * tests can stub this without pulling in ProseMirror.
 */
/**
 * Content argument accepted by TipTap's `insertContent`. We use both
 * shapes: a PM-node-shape object for the image insert (reliable: skips
 * HTML parsing entirely) and an empty string for the no-op selection
 * seed used by the drop handler.
 */
export type InsertContent =
  | string
  | { type: string; attrs?: Record<string, unknown> };

export interface EditorLike {
  view: {
    posAtCoords: (pos: {
      left: number;
      top: number;
    }) => { pos: number } | null | undefined;
  };
  chain: () => {
    focus: () => {
      setTextSelection: (pos: number) => {
        insertContent: (content: InsertContent) => {
          run: () => boolean;
        };
      };
      insertContent: (content: InsertContent) => {
        run: () => boolean;
      };
    };
  };
}

/** Information passed to the UI callbacks. */
export interface ImageInsertNotice {
  /** Original filename (if available from the transfer). */
  fileName: string | null;
  /** Final byte count of the processed base64 payload. */
  bytes: number;
}

/** Callbacks the UI layer provides so it can show banners/toasts. */
export interface ImageInsertCallbacks {
  /** Called after a successful insert that exceeded the soft size limit. */
  onWarn?: (n: ImageInsertNotice) => void;
  /** Called when an image is rejected (over the hard size limit). */
  onReject?: (n: ImageInsertNotice) => void;
  /** Called when `processFile` throws (decode error, canvas issue, …). */
  onError?: (n: { fileName: string | null; error: unknown }) => void;
}

/** Optional deps for drop/paste; the processor is swappable for tests. */
export interface ImageDropPasteDeps extends ImageInsertCallbacks {
  /** Defaults to `processImageFile` from imageProcess.ts. */
  processFile?: (file: File) => Promise<ProcessedImage>;
}

/**
 * Build the ProseMirror-node-shape payload we hand to
 * `editor.chain().insertContent(...)` for one processed image.
 *
 * Why node-shape instead of an HTML string
 * ----------------------------------------
 * Earlier slices built an `<img>` HTML string and let TipTap parse it
 * through ProseMirror's DOMParser. That parse silently dropped the
 * image in two real-world cases:
 *
 *   (1) A bare `<img>` string — PM's parser wrapped it in a paragraph
 *       (its default "top-level inline → wrap" fixup), and the Image
 *       extension is configured `inline: false` (block), so the
 *       paragraph-with-a-block-child was illegal and PM discarded it.
 *   (2) An `<p><img></p>` string — the paragraph parsed fine but the
 *       block `<img>` inside isn't valid inline content → also
 *       dropped.
 *
 * TipTap's own `setImage` command in extension-image avoids parsing
 * entirely and hands PM a node-shape object directly. We do the same
 * here; it's the reliable path regardless of schema wrinkles.
 *
 * Attributes
 * ----------
 *   - `src`    — the processed data URL. No quote escaping needed
 *                because we're not building HTML; the value round-trips
 *                verbatim into the PM attrs and back out only via
 *                `renderHTML`, which handles escaping.
 *   - `width`  — pixel width. The Image extension's default schema
 *                includes `width` as an attr, so it round-trips into
 *                the document model and back out on save.
 *   - `alt`    — empty string for now. Inline alt-text editing is a
 *                later slice; the attribute is present so the sanitizer
 *                exercises its alt-pass-through rule.
 */
export function buildImageInsertContent(p: ProcessedImage): {
  type: "image";
  attrs: { src: string; width: number; alt: string };
} {
  return {
    type: "image",
    attrs: {
      src: p.dataUrl,
      width: p.width,
      alt: "",
    },
  };
}

/**
 * Extract image files from a DataTransfer. Handles both the `files`
 * list (drops, paste of image files from OS) and the `items` list
 * (paste of an image bitmap from clipboard). Filters to `image/*`
 * MIME types.
 *
 * Returns a fresh array — we can't rely on DataTransferList iteration
 * past the synchronous event handler, so we materialise files up front.
 */
export function extractImageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  // Prefer `files` where present (drop case, clipboard file paste).
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith("image/")) out.push(f);
    }
  }
  // Also scan `items` (clipboard-image-bitmap paste). Some platforms
  // report the same image under both — dedupe by reference identity.
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

/**
 * Core insert-orchestration: for each file, call `processFile`, route
 * the size-budget decision to the right callback, and insert the HTML
 * into the editor at the current selection.
 *
 * Exported for testing. SectionEditor doesn't call this directly; the
 * drop/paste wrappers below position the selection first, then call
 * through to this.
 */
export async function processAndInsertImages(
  editor: EditorLike,
  files: File[],
  deps: ImageDropPasteDeps,
): Promise<void> {
  const processFile = deps.processFile ?? defaultProcessImageFile;
  for (const file of files) {
    let processed: ProcessedImage;
    try {
      processed = await processFile(file);
    } catch (error) {
      // Log to devtools so a failed decode/canvas path is visible during
      // development even when the UI doesn't wire an `onError` callback.
      // (6L.5a-γ debug aid — the previous silent-swallow made failures
      // indistinguishable from "nothing happened".)
      console.warn("[imageDropPaste] processFile threw:", file.name, error);
      deps.onError?.({ fileName: file.name ?? null, error });
      continue;
    }
    const notice: ImageInsertNotice = {
      fileName: file.name ?? null,
      bytes: processed.bytes,
    };
    if (processed.decision === "reject") {
      deps.onReject?.(notice);
      continue;
    }
    const content = buildImageInsertContent(processed);
    editor.chain().focus().insertContent(content).run();
    if (processed.decision === "warn") {
      deps.onWarn?.(notice);
    }
  }
}

/**
 * Drop handler for TipTap's `editorProps.handleDrop`.
 *
 * Contract:
 *   - Returns `true` to signal "we handled it" (ProseMirror skips its
 *     default drop, and we've already called `stopPropagation` so the
 *     app-level handler won't fire either).
 *   - Returns `false` when the drop contains no image files — this
 *     lets ProseMirror fall through to its default behaviour and, if
 *     the file is a `.moliospec`, the app-level handler picks it up.
 *
 * The actual insert is async (image decode + canvas work), but that's
 * fine: returning `true` synchronously prevents default, and then the
 * editor state updates when the promise resolves.
 */
export function handleImageDrop(
  editor: EditorLike,
  event: DragEvent,
  deps: ImageDropPasteDeps,
): boolean {
  const files = extractImageFiles(event.dataTransfer);
  if (files.length === 0) return false;

  // Claim the event. `preventDefault` stops the browser from navigating
  // to the dropped image; `stopPropagation` keeps the app-level drop
  // handler in App.tsx from treating an image drop as an attempt to
  // open a .moliospec file (which would pop an error banner).
  event.preventDefault();
  event.stopPropagation();

  // Position the caret at the drop point, falling back to the current
  // selection if posAtCoords returns nothing useful.
  try {
    const hit = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    if (hit && typeof hit.pos === "number") {
      editor.chain().focus().setTextSelection(hit.pos).insertContent("").run();
    } else {
      editor.chain().focus().insertContent("").run();
    }
  } catch {
    // `posAtCoords` or `setTextSelection` can throw if the coordinates
    // are outside the layout. Fall back to inserting at the current
    // selection — not ideal UX but better than silently dropping.
    editor.chain().focus().insertContent("").run();
  }

  // Fire-and-forget: the async insert is safe to run in the background
  // because the ProseMirror transaction is dispatched on each insert.
  void processAndInsertImages(editor, files, deps);
  return true;
}

/**
 * Pop an OS file picker restricted to image files and deliver the
 * chosen list of image `File`s to the callback. Used by the
 * FloatingMenu "Insert image" button (6L.5a-γ).
 *
 * Implementation notes
 * --------------------
 * We create a throw-away `<input type="file">` off-DOM, click it, and
 * read the selected files on the `change` event. The input is never
 * attached to the page — browsers happily fire the native picker from a
 * detached input as long as the `.click()` happens inside a trusted
 * user gesture (button onClick qualifies).
 *
 * `accept="image/*"` narrows the picker to common image MIME types.
 * Most platforms also honour it to filter the OS file chooser so the
 * user only sees images. We still post-filter the results by `type`
 * just in case (some platforms let the user bypass `accept`).
 *
 * `onCancel` fires when the user dismisses the picker (Chromium's
 * native `cancel` event, supported in Electron). The caller uses this
 * to restore UI state that was pre-configured on behalf of the picker
 * (e.g. clearing a "don't blur-unmount me right now" flag — see
 * SectionEditor's `suppressBlurRef`).
 *
 * The helper is deliberately callback-based (not a Promise): the
 * change/cancel event pair covers both success and dismissal, whereas
 * a single Promise would have to conflate them.
 */
export function openImageFilePicker(
  onFiles: (files: File[]) => void,
  onCancel?: () => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", () => {
    const picked = input.files ? Array.from(input.files) : [];
    const images = picked.filter((f) => f.type.startsWith("image/"));
    onFiles(images);
  });
  if (onCancel) {
    // `cancel` fires on Chromium ≥113 when the user dismisses the
    // picker (Esc, close button, etc.). Electron bundles a recent
    // Chromium so this is reliable in the app runtime.
    input.addEventListener("cancel", onCancel);
  }
  input.click();
}

/**
 * Paste handler for TipTap's `editorProps.handlePaste`.
 *
 * Same contract as `handleImageDrop`. Uses `clipboardData` instead of
 * `dataTransfer`. Inserts at the current editor selection (no
 * screen-coordinate translation needed for paste).
 */
export function handleImagePaste(
  editor: EditorLike,
  event: ClipboardEvent,
  deps: ImageDropPasteDeps,
): boolean {
  const files = extractImageFiles(event.clipboardData);
  if (files.length === 0) return false;

  event.preventDefault();
  event.stopPropagation();

  void processAndInsertImages(editor, files, deps);
  return true;
}
