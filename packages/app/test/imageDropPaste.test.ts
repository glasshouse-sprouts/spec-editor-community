/** @vitest-environment jsdom */

/**
 * Tests for the 6L.5a-β drop/paste orchestration.
 *
 * The real `processImageFile` needs a working `<canvas>`, which jsdom
 * doesn't provide without the optional `canvas` package. These tests
 * bypass that by injecting a fake `processFile` dep — we exercise the
 * orchestration logic (file filtering, callback routing, HTML building,
 * event consumption) without touching the DOM beyond what jsdom gives
 * us for free.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildImageInsertContent,
  extractImageFiles,
  handleImageDrop,
  handleImagePaste,
  openImageFilePicker,
  processAndInsertImages,
  type EditorLike,
  type ImageInsertCallbacks,
  type InsertContent,
} from "../src/renderer/src/imageDropPaste.js";
import type {
  ProcessedImage,
  SizeBudgetDecision,
} from "../src/renderer/src/imageProcess.js";

/**
 * Build a `ProcessedImage` fixture with knobs for the fields the
 * orchestration actually uses (dataUrl, width, bytes, decision).
 */
function fakeProcessed(
  overrides: Partial<ProcessedImage> = {},
): ProcessedImage {
  return {
    dataUrl: "data:image/png;base64,AAAA",
    mime: "image/png",
    naturalWidth: 800,
    naturalHeight: 600,
    width: 800,
    height: 600,
    bytes: 3,
    decision: "ok",
    ...overrides,
  };
}

/**
 * Build a minimal TipTap-Editor-shaped stub. `chain().focus().insertContent(html).run()`
 * and the setTextSelection variant both record into the `calls` array
 * so tests can assert on the sequence.
 *
 * `posAtCoords` defaults to returning `{ pos: 10 }` — tests that want
 * to exercise the null-return path override it.
 */
function makeEditor(
  posAtCoords: EditorLike["view"]["posAtCoords"] = () => ({ pos: 10 }),
): {
  editor: EditorLike;
  inserts: InsertContent[];
  selections: number[];
} {
  const inserts: InsertContent[] = [];
  const selections: number[] = [];

  const editor: EditorLike = {
    view: { posAtCoords },
    chain: () => {
      const chain = {
        focus: () => chain,
        setTextSelection: (pos: number) => {
          selections.push(pos);
          return chain;
        },
        insertContent: (content: InsertContent) => {
          inserts.push(content);
          return chain;
        },
        run: () => true,
      };
      // The real type says focus() returns an object without a `.focus`
      // method recursively; the chain here is simpler for testing but
      // satisfies the structural EditorLike contract.
      return chain as unknown as ReturnType<EditorLike["chain"]>;
    },
  };
  return { editor, inserts, selections };
}

/**
 * Build a minimal DragEvent-shaped fake. jsdom supports `new Event("drop")`
 * but not `new DragEvent`, and DragEvent's dataTransfer is read-only —
 * easier to construct our own plain object matching the shape we use.
 */
function makeDropEvent(
  files: File[],
  options: { clientX?: number; clientY?: number } = {},
): DragEvent & { preventedDefault: boolean; stoppedPropagation: boolean } {
  const dt = makeDataTransfer(files);
  const ev = {
    clientX: options.clientX ?? 100,
    clientY: options.clientY ?? 200,
    dataTransfer: dt,
    preventedDefault: false,
    stoppedPropagation: false,
    preventDefault() {
      this.preventedDefault = true;
    },
    stopPropagation() {
      this.stoppedPropagation = true;
    },
  };
  return ev as unknown as DragEvent & {
    preventedDefault: boolean;
    stoppedPropagation: boolean;
  };
}

function makePasteEvent(
  files: File[],
): ClipboardEvent & { preventedDefault: boolean; stoppedPropagation: boolean } {
  const dt = makeDataTransfer(files);
  const ev = {
    clipboardData: dt,
    preventedDefault: false,
    stoppedPropagation: false,
    preventDefault() {
      this.preventedDefault = true;
    },
    stopPropagation() {
      this.stoppedPropagation = true;
    },
  };
  return ev as unknown as ClipboardEvent & {
    preventedDefault: boolean;
    stoppedPropagation: boolean;
  };
}

/**
 * Minimal DataTransfer stub — jsdom's DataTransfer doesn't let you
 * populate `files` post-hoc, so we fake the whole thing. Only exposes
 * the `files` and `items` properties the module reads.
 */
function makeDataTransfer(files: File[]): DataTransfer {
  const items = files.map((f) => ({
    kind: "file" as const,
    type: f.type,
    getAsFile: () => f,
  }));
  return {
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "all",
    setData: () => {},
    getData: () => "",
    clearData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

describe("extractImageFiles", () => {
  it("returns empty when dataTransfer is null", () => {
    expect(extractImageFiles(null)).toEqual([]);
  });

  it("filters out non-image files", () => {
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const doc = new File(["x"], "draft.moliospec", { type: "" });
    const got = extractImageFiles(makeDataTransfer([doc, image]));
    expect(got).toEqual([image]);
  });

  it("returns all image files when every transfer entry is an image", () => {
    const a = new File(["x"], "a.png", { type: "image/png" });
    const b = new File(["y"], "b.jpg", { type: "image/jpeg" });
    expect(extractImageFiles(makeDataTransfer([a, b]))).toEqual([a, b]);
  });

  it("dedupes files appearing in both files and items", () => {
    // Our makeDataTransfer populates both `files` and `items` with the
    // same File references — dedup must keep only one copy.
    const image = new File(["x"], "photo.png", { type: "image/png" });
    expect(extractImageFiles(makeDataTransfer([image]))).toEqual([image]);
  });
});

describe("buildImageInsertContent", () => {
  it("emits a ProseMirror-node-shape object with the image attrs", () => {
    // We use node-shape (not an HTML string) because PM's DOMParser
    // silently dropped bare `<img>` inserts when the Image extension is
    // `inline: false` — see the big comment in imageDropPaste.ts.
    const p = fakeProcessed({
      dataUrl: "data:image/png;base64,AAAA",
      width: 400,
    });
    expect(buildImageInsertContent(p)).toEqual({
      type: "image",
      attrs: {
        src: "data:image/png;base64,AAAA",
        width: 400,
        alt: "",
      },
    });
  });

  it("passes the dataUrl through verbatim (no escaping — PM handles it)", () => {
    // Unlike the earlier HTML-string builder, there's no quote escaping
    // to do: the src goes straight into PM attrs and is escaped only
    // when the image finally renders to HTML via the Image extension's
    // renderHTML. Verify the value is not mangled.
    const p = fakeProcessed({
      dataUrl: 'data:image/png;base64,AAAA"raw',
      width: 100,
    });
    const content = buildImageInsertContent(p);
    expect(content.attrs.src).toBe('data:image/png;base64,AAAA"raw');
  });
});

describe("processAndInsertImages", () => {
  let callbacks: ImageInsertCallbacks & {
    onWarn: ReturnType<typeof vi.fn>;
    onReject: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    callbacks = {
      onWarn: vi.fn(),
      onReject: vi.fn(),
      onError: vi.fn(),
    };
  });

  it("inserts each 'ok' file silently", async () => {
    const { editor, inserts } = makeEditor();
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ];
    const processFile = vi.fn(async (f: File) =>
      fakeProcessed({ dataUrl: `data:image/png;base64,${f.name}` }),
    );

    await processAndInsertImages(editor, files, { ...callbacks, processFile });

    expect(processFile).toHaveBeenCalledTimes(2);
    expect(inserts).toHaveLength(2);
    // Each insert is a PM-node-shape object; the src carries the per-file
    // marker we baked into the fake processed dataUrl above.
    expect(inserts[0]).toMatchObject({
      type: "image",
      attrs: { src: expect.stringContaining("a.png") },
    });
    expect(inserts[1]).toMatchObject({
      type: "image",
      attrs: { src: expect.stringContaining("b.png") },
    });
    expect(callbacks.onWarn).not.toHaveBeenCalled();
    expect(callbacks.onReject).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("inserts 'warn' files and fires onWarn", async () => {
    const { editor, inserts } = makeEditor();
    const file = new File(["x"], "big.png", { type: "image/png" });
    const processFile = async () =>
      fakeProcessed({
        decision: "warn" as SizeBudgetDecision,
        bytes: 800 * 1024,
      });

    await processAndInsertImages(editor, [file], { ...callbacks, processFile });

    expect(inserts).toHaveLength(1);
    expect(callbacks.onWarn).toHaveBeenCalledTimes(1);
    expect(callbacks.onWarn).toHaveBeenCalledWith({
      fileName: "big.png",
      bytes: 800 * 1024,
    });
    expect(callbacks.onReject).not.toHaveBeenCalled();
  });

  it("does NOT insert 'reject' files, fires onReject instead", async () => {
    const { editor, inserts } = makeEditor();
    const file = new File(["x"], "huge.png", { type: "image/png" });
    const processFile = async () =>
      fakeProcessed({
        decision: "reject" as SizeBudgetDecision,
        bytes: 10 * 1024 * 1024,
      });

    await processAndInsertImages(editor, [file], { ...callbacks, processFile });

    expect(inserts).toHaveLength(0);
    expect(callbacks.onReject).toHaveBeenCalledWith({
      fileName: "huge.png",
      bytes: 10 * 1024 * 1024,
    });
    expect(callbacks.onWarn).not.toHaveBeenCalled();
  });

  it("calls onError and skips when processFile throws", async () => {
    const { editor, inserts } = makeEditor();
    const fileOk = new File(["x"], "ok.png", { type: "image/png" });
    const fileBad = new File(["y"], "bad.png", { type: "image/png" });
    const err = new Error("decode failed");
    const processFile = vi.fn(async (f: File) => {
      if (f.name === "bad.png") throw err;
      return fakeProcessed();
    });
    // Swallow the expected console.warn from our dev-aid log so the test
    // output stays quiet.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processAndInsertImages(editor, [fileOk, fileBad], {
      ...callbacks,
      processFile,
    });

    expect(inserts).toHaveLength(1); // only the ok file
    expect(callbacks.onError).toHaveBeenCalledWith({
      fileName: "bad.png",
      error: err,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("mixed batch: ok + warn + reject routes each to the right outcome", async () => {
    const { editor, inserts } = makeEditor();
    const files = [
      new File(["1"], "ok.png", { type: "image/png" }),
      new File(["2"], "warn.png", { type: "image/png" }),
      new File(["3"], "reject.png", { type: "image/png" }),
    ];
    const processFile = async (f: File) => {
      if (f.name === "warn.png") {
        return fakeProcessed({ decision: "warn" as SizeBudgetDecision });
      }
      if (f.name === "reject.png") {
        return fakeProcessed({ decision: "reject" as SizeBudgetDecision });
      }
      return fakeProcessed();
    };

    await processAndInsertImages(editor, files, { ...callbacks, processFile });

    expect(inserts).toHaveLength(2); // ok + warn
    expect(callbacks.onWarn).toHaveBeenCalledTimes(1);
    expect(callbacks.onReject).toHaveBeenCalledTimes(1);
  });
});

describe("handleImageDrop", () => {
  it("returns false when no image files are dropped (lets app handler run)", () => {
    const { editor } = makeEditor();
    const doc = new File(["x"], "draft.moliospec", { type: "" });
    const event = makeDropEvent([doc]);

    const handled = handleImageDrop(editor, event, {});

    expect(handled).toBe(false);
    // IMPORTANT: we must NOT call preventDefault / stopPropagation when
    // we're not claiming the event — otherwise the .moliospec drop path
    // would silently break.
    expect(event.preventedDefault).toBe(false);
    expect(event.stoppedPropagation).toBe(false);
  });

  it("stops propagation when claiming an image drop (blocks app-level modal)", () => {
    const { editor } = makeEditor();
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const event = makeDropEvent([image]);

    const handled = handleImageDrop(editor, event, {
      processFile: async () => fakeProcessed(),
    });

    expect(handled).toBe(true);
    // This is the regression guard: without stopPropagation, the
    // .moliospec drop handler in App.tsx would fire and show
    // "...is not a .moliospec file."
    expect(event.stoppedPropagation).toBe(true);
    expect(event.preventedDefault).toBe(true);
  });

  it("uses drop coordinates to set the caret position", () => {
    const posAtCoords = vi.fn(() => ({ pos: 42 }));
    const { editor, selections } = makeEditor(posAtCoords);
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const event = makeDropEvent([image], { clientX: 150, clientY: 300 });

    handleImageDrop(editor, event, {
      processFile: async () => fakeProcessed(),
    });

    expect(posAtCoords).toHaveBeenCalledWith({ left: 150, top: 300 });
    expect(selections).toEqual([42]);
  });

  it("falls back to current selection when posAtCoords returns null", () => {
    const { editor, selections } = makeEditor(() => null);
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const event = makeDropEvent([image]);

    const handled = handleImageDrop(editor, event, {
      processFile: async () => fakeProcessed(),
    });

    expect(handled).toBe(true);
    // No setTextSelection was called (because null hit).
    expect(selections).toEqual([]);
  });

  it("survives posAtCoords throwing without propagating the error", () => {
    const { editor } = makeEditor(() => {
      throw new Error("layout not ready");
    });
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const event = makeDropEvent([image]);

    expect(() =>
      handleImageDrop(editor, event, {
        processFile: async () => fakeProcessed(),
      }),
    ).not.toThrow();
  });
});

describe("handleImagePaste", () => {
  it("returns false when no image files are in the clipboard", () => {
    const { editor } = makeEditor();
    const event = makePasteEvent([]);

    const handled = handleImagePaste(editor, event, {});

    expect(handled).toBe(false);
    expect(event.preventedDefault).toBe(false);
  });

  it("claims the paste and prevents default when an image is present", () => {
    const { editor } = makeEditor();
    const image = new File(["x"], "clip.png", { type: "image/png" });
    const event = makePasteEvent([image]);

    const handled = handleImagePaste(editor, event, {
      processFile: async () => fakeProcessed(),
    });

    expect(handled).toBe(true);
    expect(event.preventedDefault).toBe(true);
    // Paste doesn't have a propagation-to-app-handler concern like drop
    // does, but we stop it anyway for consistency.
    expect(event.stoppedPropagation).toBe(true);
  });

  it("filters mixed clipboard content to image-only", () => {
    const { editor } = makeEditor();
    const image = new File(["x"], "clip.png", { type: "image/png" });
    const text = new File(["hello"], "note.txt", { type: "text/plain" });
    const event = makePasteEvent([text, image]);
    const processFile = vi.fn(async () => fakeProcessed());

    handleImagePaste(editor, event, { processFile });

    // Wait for the fire-and-forget async chain.
    return Promise.resolve().then(() => {
      expect(processFile).toHaveBeenCalledTimes(1);
      expect(processFile).toHaveBeenCalledWith(image);
    });
  });
});

describe("openImageFilePicker", () => {
  /**
   * The helper builds an off-DOM `<input type="file">`, clicks it, and
   * hands back the chosen files via callback. jsdom doesn't open a real
   * file chooser, so we hijack `createElement` to return a spyable input,
   * then drive `change` manually.
   */
  it("creates a correctly-configured <input> and delivers image files", () => {
    const onFiles = vi.fn();
    const realCreate = document.createElement.bind(document);

    // Intercept the single `input` createElement call to capture the node.
    let captured: HTMLInputElement | null = null;
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = realCreate(tag) as HTMLElement;
        if (tag === "input") {
          captured = el as HTMLInputElement;
          // Stub `.click()` so jsdom doesn't try to actually open a picker.
          (el as HTMLInputElement).click = () => {};
        }
        return el;
      });

    openImageFilePicker(onFiles);

    expect(captured).not.toBeNull();
    const input = captured as unknown as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);

    // Simulate the user picking one image + one non-image. The non-image
    // gets filtered (defence in case a platform ignores the accept filter).
    const image = new File(["x"], "photo.png", { type: "image/png" });
    const text = new File(["y"], "note.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      value: [image, text] as unknown as FileList,
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([image]);

    createSpy.mockRestore();
  });

  it("delivers an empty list when the user cancels with no files", () => {
    const onFiles = vi.fn();
    const realCreate = document.createElement.bind(document);
    let captured: HTMLInputElement | null = null;
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = realCreate(tag) as HTMLElement;
        if (tag === "input") {
          captured = el as HTMLInputElement;
          (el as HTMLInputElement).click = () => {};
        }
        return el;
      });

    openImageFilePicker(onFiles);
    const input = captured as unknown as HTMLInputElement;
    // Simulate a `change` event with no files (this shouldn't happen on
    // cancel on most browsers — cancel fires no event — but guards against
    // platforms that do fire an empty change).
    Object.defineProperty(input, "files", {
      value: null,
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));

    expect(onFiles).toHaveBeenCalledWith([]);
    createSpy.mockRestore();
  });

  it("fires onCancel when the native cancel event dispatches", () => {
    // 6L.5a-γ2: the button uses the cancel event to clear the blur
    // suppressor when the user dismisses the picker. Verify the
    // callback wires up.
    const onFiles = vi.fn();
    const onCancel = vi.fn();
    const realCreate = document.createElement.bind(document);
    let captured: HTMLInputElement | null = null;
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = realCreate(tag) as HTMLElement;
        if (tag === "input") {
          captured = el as HTMLInputElement;
          (el as HTMLInputElement).click = () => {};
        }
        return el;
      });

    openImageFilePicker(onFiles, onCancel);
    const input = captured as unknown as HTMLInputElement;
    input.dispatchEvent(new Event("cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onFiles).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
