/**
 * Image processing pipeline for inline base64 images (6L.5a).
 *
 * What this module does
 * ---------------------
 * When a user drops / pastes / picks an image into a section body, we want
 * to embed it directly into the .moliospec as a `data:` URL (no external
 * attachments, no http URLs — see 6L design notes). Before embedding we
 * do three things to keep files sane:
 *
 *   1. **Resize** to a max width (default 1600 px). Hi-DPI source files
 *      from phones/DSLRs are typically 3–6000 px wide — storing them
 *      unchanged blows up the .moliospec file size and slows down every
 *      open/save cycle. 1600 px is enough for crisp A4 print at ~200 dpi.
 *
 *   2. **Choose an output encoding**:
 *        - Source MIME is PNG / GIF / WebP → output PNG (preserves
 *          possible transparency — logos, diagrams, screenshots).
 *        - Source MIME is JPEG or unknown → output JPEG (smaller,
 *          transparency-incapable, fine for photos).
 *      We deliberately don't do per-pixel alpha scanning; the MIME-based
 *      heuristic is close enough and much cheaper. A JPEG photo stays a
 *      JPEG; a PNG logo stays a PNG.
 *
 *   3. **Check the size budget** against two thresholds:
 *        - >= 500 KB → **warn** (non-blocking banner in the UI).
 *        - >= 5 MB   → **reject** (toast, don't insert).
 *      These are per-image, not cumulative. The 5 MB hard limit is very
 *      generous for a 1600 px JPEG at q=0.82 (typically 100–400 KB).
 *
 * The module is deliberately split into:
 *
 *   - **Pure helpers** (computeTargetSize, pickOutputMime, dataUrlByteCount,
 *     parseDataUrlMime, isAllowedImageDataUrl, sizeBudgetDecision).
 *     No DOM / no I/O — fully unit-testable in node/jsdom.
 *
 *   - **DOM-dependent wrappers** (loadImage, processImageFile). Thin
 *     layer that glues the pure helpers to HTMLImageElement + canvas.
 *     Tested indirectly via integration tests in jsdom; jsdom's canvas
 *     is a stub so pixel-level tests stay in the pure layer.
 *
 * Why isAllowedImageDataUrl is exported
 * -------------------------------------
 * The sanitizer (sanitizeBody.ts) uses this check to enforce that any
 * `<img src="...">` has a `data:image/(png|jpeg|gif|webp)` URL. `http(s):`,
 * `file:`, `javascript:`, and — critically — `data:image/svg+xml` are all
 * rejected. SVG is XML + scriptable and must never pass through an `img`
 * whitelist.
 */

/** The list of image MIME types we will emit as output (data:URL). */
export const ALLOWED_OUTPUT_MIMES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Default max width in pixels for inserted images. */
export const DEFAULT_MAX_WIDTH = 1600;

/** Default JPEG quality when re-encoding. 0.82 is a good point on the
 *  size/quality curve for typical spec photos. */
export const DEFAULT_JPEG_QUALITY = 0.82;

/** Soft size threshold — image is inserted but the UI shows a warning. */
export const SOFT_SIZE_LIMIT_BYTES = 500 * 1024; // 500 KB

/** Hard size threshold — image is rejected, never inserted. */
export const HARD_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Pure: compute target width/height after clamping to maxWidth while
 * preserving aspect ratio. If the source is already within maxWidth,
 * return it unchanged (no up-scaling).
 */
export function computeTargetSize(
  natWidth: number,
  natHeight: number,
  maxWidth: number = DEFAULT_MAX_WIDTH,
): { width: number; height: number } {
  // Defensive: any non-positive input collapses to 1×1 so canvas work
  // downstream doesn't throw. Callers should never hit this, but the
  // alternative (throwing) bubbles into the UI unhelpfully.
  if (!isFinite(natWidth) || !isFinite(natHeight)) {
    return { width: 1, height: 1 };
  }
  const w = Math.max(1, Math.round(natWidth));
  const h = Math.max(1, Math.round(natHeight));
  if (w <= maxWidth) return { width: w, height: h };
  const ratio = maxWidth / w;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(h * ratio)),
  };
}

/**
 * Pure: decide which output MIME to emit for a given source MIME.
 *
 * Rules:
 *   - `image/png`   → `image/png`
 *   - `image/gif`   → `image/png`  (preserve possible transparency)
 *   - `image/webp`  → `image/png`  (not all consumers handle webp)
 *   - `image/jpeg`  → `image/jpeg`
 *   - anything else → `image/jpeg` (safe fallback)
 */
export function pickOutputMime(sourceMime: string | null | undefined): string {
  const m = (sourceMime ?? "").toLowerCase().trim();
  if (m === "image/png") return "image/png";
  if (m === "image/gif") return "image/png";
  if (m === "image/webp") return "image/png";
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  return "image/jpeg";
}

/**
 * Pure: extract the MIME type from a data URL, or null if malformed /
 * not a data URL. Does NOT validate the base64 payload.
 *
 * Examples:
 *   "data:image/png;base64,AAAA"           → "image/png"
 *   "data:image/svg+xml;base64,..."        → "image/svg+xml"
 *   "data:text/html;base64,..."            → "text/html"
 *   "data:,hello"                          → ""          (no mime part)
 *   "https://example.com/a.png"            → null        (not a data URL)
 */
export function parseDataUrlMime(dataUrl: string): string | null {
  if (typeof dataUrl !== "string") return null;
  if (!dataUrl.startsWith("data:")) return null;
  const afterPrefix = dataUrl.slice(5); // strip "data:"
  // MIME ends at the first `,` or `;`.
  const end = afterPrefix.search(/[,;]/);
  if (end === -1) return null; // malformed — no comma/semicolon
  return afterPrefix.slice(0, end).toLowerCase();
}

/**
 * Pure: is this src a data URL of a whitelisted image type?
 *
 * Rejects (among others):
 *   - `http(s):` / `file:` / `javascript:` schemes
 *   - `data:image/svg+xml` (scriptable, XSS risk)
 *   - `data:text/html` and similar non-image data URLs
 *   - malformed data URLs with no MIME
 *
 * This is what the `<img src="...">` sanitizer rule calls.
 */
export function isAllowedImageDataUrl(src: string): boolean {
  const mime = parseDataUrlMime(src);
  if (!mime) return false;
  return ALLOWED_OUTPUT_MIMES.includes(mime);
}

/**
 * Pure: compute the approximate byte length of the payload inside a
 * base64-encoded data URL.
 *
 * Base64 encodes 3 bytes as 4 characters, minus `=` padding. We don't
 * count the `data:...;base64,` header — that's negligible + overhead the
 * caller isn't being charged for either.
 *
 * Returns 0 for non-base64 / non-data URLs (we don't try to measure
 * plain-text data URLs; callers using this module always base64-encode).
 */
export function dataUrlByteCount(dataUrl: string): number {
  if (typeof dataUrl !== "string") return 0;
  const base64Idx = dataUrl.indexOf(";base64,");
  if (base64Idx === -1) return 0;
  const payload = dataUrl.slice(base64Idx + ";base64,".length);
  if (payload.length === 0) return 0;
  // Count `=` padding (0, 1, or 2) — each `=` reduces the byte count by 1.
  let pad = 0;
  if (payload.endsWith("==")) pad = 2;
  else if (payload.endsWith("=")) pad = 1;
  return Math.floor((payload.length * 3) / 4) - pad;
}

/** Size-budget decision for a processed image. */
export type SizeBudgetDecision = "ok" | "warn" | "reject";

/**
 * Pure: categorise a size in bytes against the soft/hard thresholds.
 *
 *   bytes <  500 KB → "ok"
 *   bytes <  5 MB   → "warn"
 *   bytes >= 5 MB   → "reject"
 */
export function sizeBudgetDecision(
  bytes: number,
  softLimit: number = SOFT_SIZE_LIMIT_BYTES,
  hardLimit: number = HARD_SIZE_LIMIT_BYTES,
): SizeBudgetDecision {
  // Defensive: treat NaN and negatives as "ok" (we don't have a byte
  // count we can act on). Infinity still flows through so it hits the
  // hard-limit branch below and returns "reject".
  if (Number.isNaN(bytes) || bytes < 0) return "ok";
  if (bytes >= hardLimit) return "reject";
  if (bytes >= softLimit) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// DOM-dependent layer. These functions assume a real browser / jsdom and
// touch `Image`, `HTMLCanvasElement`, `URL.createObjectURL`, `FileReader`.
// Tests that exercise them must run with `@vitest-environment jsdom` and
// may need to mock canvas (jsdom doesn't implement getContext('2d') by
// default without the `canvas` package).
// ---------------------------------------------------------------------------

/** Result returned by processImageFile. */
export interface ProcessedImage {
  /** The embedded `data:image/...;base64,...` URL ready for `<img src=>`. */
  dataUrl: string;
  /** Chosen output MIME. */
  mime: string;
  /** Natural width of the source (pre-resize), used as aspect source. */
  naturalWidth: number;
  /** Natural height of the source (pre-resize). */
  naturalHeight: number;
  /** Final width actually stored (may be < natural after resize). */
  width: number;
  /** Final height actually stored. */
  height: number;
  /** Byte count of the base64 payload — for the size budget decision. */
  bytes: number;
  /** Same byte count, run through `sizeBudgetDecision`. */
  decision: SizeBudgetDecision;
}

/**
 * Load a File/Blob as an HTMLImageElement. Resolves once the image has
 * finished decoding; rejects on parse error.
 *
 * Uses `URL.createObjectURL` + revoke-on-load to avoid memory leaks.
 */
export function loadImage(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err instanceof Event ? new Error("Image failed to load") : err);
    };
    img.src = url;
  });
}

/**
 * Full pipeline: File → ProcessedImage.
 *
 * Resizes (if needed), re-encodes to PNG or JPEG, and returns a
 * `data:...;base64,...` URL plus sizing + size-budget metadata. The
 * caller is expected to check `decision`:
 *   - `"ok"`     → insert silently
 *   - `"warn"`   → insert, show non-blocking warning banner
 *   - `"reject"` → don't insert, show error
 */
export async function processImageFile(
  file: File,
  options: {
    maxWidth?: number;
    jpegQuality?: number;
  } = {},
): Promise<ProcessedImage> {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  const img = await loadImage(file);
  const { width, height } = computeTargetSize(
    img.naturalWidth,
    img.naturalHeight,
    maxWidth,
  );
  const outputMime = pickOutputMime(file.type);

  // Canvas path does the actual resize + re-encode.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // jsdom without the `canvas` package lands here; production browsers
    // never do. We throw a clear error so tests can distinguish missing-
    // canvas from genuine image processing failures.
    throw new Error("2D canvas context not available in this environment");
  }
  ctx.drawImage(img, 0, 0, width, height);

  // Second arg of toDataURL is JPEG quality (ignored for PNG).
  const dataUrl = canvas.toDataURL(outputMime, quality);
  const bytes = dataUrlByteCount(dataUrl);

  return {
    dataUrl,
    mime: outputMime,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    width,
    height,
    bytes,
    decision: sizeBudgetDecision(bytes),
  };
}
