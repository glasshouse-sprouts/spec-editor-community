/**
 * Tests for the pure layer of imageProcess.ts.
 *
 * The DOM-dependent wrappers (loadImage, processImageFile) are not
 * directly unit-tested here — jsdom's canvas is a stub without the
 * optional `canvas` package, and every piece of logic worth verifying
 * lives in the pure functions anyway. Integration coverage for the
 * wrappers comes later via the SectionEditor tests (6L.5a-β).
 */

import { describe, expect, it } from "vitest";

import {
  ALLOWED_OUTPUT_MIMES,
  computeTargetSize,
  dataUrlByteCount,
  DEFAULT_MAX_WIDTH,
  HARD_SIZE_LIMIT_BYTES,
  isAllowedImageDataUrl,
  parseDataUrlMime,
  pickOutputMime,
  sizeBudgetDecision,
  SOFT_SIZE_LIMIT_BYTES,
} from "../src/renderer/src/imageProcess.js";

describe("computeTargetSize", () => {
  it("returns source size unchanged when already within max width", () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales down proportionally when wider than max", () => {
    // 3200 → 1600 (halved); 2400 → 1200.
    expect(computeTargetSize(3200, 2400)).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it("scales down non-integer ratios and rounds height", () => {
    // 2000 × 1333 → ratio 1600/2000 = 0.8; height becomes 1066.4 → 1066.
    expect(computeTargetSize(2000, 1333)).toEqual({
      width: 1600,
      height: 1066,
    });
  });

  it("respects a custom maxWidth", () => {
    expect(computeTargetSize(1000, 800, 500)).toEqual({
      width: 500,
      height: 400,
    });
  });

  it("does NOT upscale images smaller than max width", () => {
    expect(computeTargetSize(100, 80, 1600)).toEqual({
      width: 100,
      height: 80,
    });
  });

  it("handles portrait orientation (taller than wide)", () => {
    // Only width is clamped; tall-and-thin images get their width capped at
    // 1600 and height scaled proportionally.
    expect(computeTargetSize(1000, 4000)).toEqual({
      width: 1000,
      height: 4000,
    });
    expect(computeTargetSize(2000, 4000)).toEqual({
      width: 1600,
      height: 3200,
    });
  });

  it("clamps pathological inputs to 1×1 rather than throwing", () => {
    expect(computeTargetSize(NaN, 100)).toEqual({ width: 1, height: 1 });
    expect(computeTargetSize(100, Infinity)).toEqual({ width: 1, height: 1 });
  });

  it("rounds very small heights to at least 1 px after scaling", () => {
    // 3200 × 1 → width 1600, height would be 0.5 → must round up to 1.
    expect(computeTargetSize(3200, 1)).toEqual({ width: 1600, height: 1 });
  });

  it("exports a sensible default max width", () => {
    expect(DEFAULT_MAX_WIDTH).toBe(1600);
  });
});

describe("pickOutputMime", () => {
  it("keeps PNG as PNG", () => {
    expect(pickOutputMime("image/png")).toBe("image/png");
  });

  it("keeps JPEG as JPEG", () => {
    expect(pickOutputMime("image/jpeg")).toBe("image/jpeg");
  });

  it("treats 'image/jpg' (non-standard) as JPEG", () => {
    // Some file-type detectors emit `image/jpg`; normalise.
    expect(pickOutputMime("image/jpg")).toBe("image/jpeg");
  });

  it("converts GIF to PNG (preserves possible transparency)", () => {
    expect(pickOutputMime("image/gif")).toBe("image/png");
  });

  it("converts WebP to PNG (broadest consumer support)", () => {
    expect(pickOutputMime("image/webp")).toBe("image/png");
  });

  it("falls back to JPEG for unknown / missing MIME", () => {
    expect(pickOutputMime("")).toBe("image/jpeg");
    expect(pickOutputMime(null)).toBe("image/jpeg");
    expect(pickOutputMime(undefined)).toBe("image/jpeg");
    expect(pickOutputMime("application/octet-stream")).toBe("image/jpeg");
    expect(pickOutputMime("image/heic")).toBe("image/jpeg");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(pickOutputMime("  IMAGE/PNG  ")).toBe("image/png");
    expect(pickOutputMime("Image/Jpeg")).toBe("image/jpeg");
  });
});

describe("parseDataUrlMime", () => {
  it("reads mime from a base64 data URL", () => {
    expect(parseDataUrlMime("data:image/png;base64,AAAA")).toBe("image/png");
  });

  it("reads mime from a non-base64 data URL (ends at ',')", () => {
    expect(parseDataUrlMime("data:image/svg+xml,<svg/>")).toBe("image/svg+xml");
  });

  it("returns '' for the bare 'data:,...' form", () => {
    // RFC-2397 allows `data:,hello` with the text/plain default omitted.
    // We return the empty string here, not null — caller decides what to
    // do with it (isAllowedImageDataUrl rejects it anyway).
    expect(parseDataUrlMime("data:,hello")).toBe("");
  });

  it("is case-insensitive (returns lowercase mime)", () => {
    expect(parseDataUrlMime("data:IMAGE/PNG;base64,AAAA")).toBe("image/png");
  });

  it("returns null for non-data URLs", () => {
    expect(parseDataUrlMime("https://example.com/a.png")).toBe(null);
    expect(parseDataUrlMime("/tmp/a.png")).toBe(null);
    expect(parseDataUrlMime("")).toBe(null);
  });

  it("returns null for data URLs missing comma/semicolon", () => {
    expect(parseDataUrlMime("data:badness")).toBe(null);
  });

  it("returns null for non-string input", () => {
    expect(parseDataUrlMime(null as unknown as string)).toBe(null);
    expect(parseDataUrlMime(123 as unknown as string)).toBe(null);
  });
});

describe("isAllowedImageDataUrl", () => {
  it("accepts all four whitelisted image types", () => {
    expect(isAllowedImageDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isAllowedImageDataUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isAllowedImageDataUrl("data:image/gif;base64,AAAA")).toBe(true);
    expect(isAllowedImageDataUrl("data:image/webp;base64,AAAA")).toBe(true);
  });

  it("rejects SVG (scriptable, XSS vector)", () => {
    expect(isAllowedImageDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isAllowedImageDataUrl("data:image/svg+xml,<svg/>")).toBe(false);
  });

  it("rejects http and https URLs", () => {
    expect(isAllowedImageDataUrl("http://evil.example/a.png")).toBe(false);
    expect(isAllowedImageDataUrl("https://example.com/a.png")).toBe(false);
  });

  it("rejects javascript: and file: URLs", () => {
    expect(isAllowedImageDataUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedImageDataUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects non-image data URLs (text/html, etc.)", () => {
    expect(isAllowedImageDataUrl("data:text/html;base64,AAAA")).toBe(false);
    expect(isAllowedImageDataUrl("data:application/pdf;base64,AAAA")).toBe(
      false,
    );
  });

  it("rejects malformed data URLs", () => {
    expect(isAllowedImageDataUrl("data:,")).toBe(false);
    expect(isAllowedImageDataUrl("")).toBe(false);
  });

  it("the allowed-output MIME list is stable", () => {
    // Sanitiser + imageProcess share this list — protect against typos
    // that would silently open / close the whitelist.
    expect([...ALLOWED_OUTPUT_MIMES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });
});

describe("dataUrlByteCount", () => {
  it("measures the byte count of a base64 payload without padding", () => {
    // "AAAA" = 3 decoded bytes.
    expect(dataUrlByteCount("data:image/png;base64,AAAA")).toBe(3);
  });

  it("subtracts 1 for single '=' padding", () => {
    // "AAA=" decodes to 2 bytes.
    expect(dataUrlByteCount("data:image/png;base64,AAA=")).toBe(2);
  });

  it("subtracts 2 for double '==' padding", () => {
    // "AA==" decodes to 1 byte.
    expect(dataUrlByteCount("data:image/png;base64,AA==")).toBe(1);
  });

  it("ignores the data URL header (only counts the payload)", () => {
    // Header length shouldn't influence the byte count.
    const short = "data:image/png;base64,AAAA";
    const longHeader = "data:image/webp;base64,AAAA";
    expect(dataUrlByteCount(short)).toBe(dataUrlByteCount(longHeader));
  });

  it("returns 0 for empty payload", () => {
    expect(dataUrlByteCount("data:image/png;base64,")).toBe(0);
  });

  it("returns 0 for non-base64 and non-data URLs", () => {
    expect(dataUrlByteCount("data:image/png,AAAA")).toBe(0);
    expect(dataUrlByteCount("https://example.com/a.png")).toBe(0);
    expect(dataUrlByteCount("")).toBe(0);
  });

  it("returns 0 for non-string input", () => {
    expect(dataUrlByteCount(null as unknown as string)).toBe(0);
    expect(dataUrlByteCount({} as unknown as string)).toBe(0);
  });
});

describe("sizeBudgetDecision", () => {
  it("returns 'ok' below the soft limit", () => {
    expect(sizeBudgetDecision(0)).toBe("ok");
    expect(sizeBudgetDecision(SOFT_SIZE_LIMIT_BYTES - 1)).toBe("ok");
  });

  it("returns 'warn' at and above the soft limit, below the hard limit", () => {
    expect(sizeBudgetDecision(SOFT_SIZE_LIMIT_BYTES)).toBe("warn");
    expect(sizeBudgetDecision(HARD_SIZE_LIMIT_BYTES - 1)).toBe("warn");
  });

  it("returns 'reject' at and above the hard limit", () => {
    expect(sizeBudgetDecision(HARD_SIZE_LIMIT_BYTES)).toBe("reject");
    expect(sizeBudgetDecision(HARD_SIZE_LIMIT_BYTES * 10)).toBe("reject");
  });

  it("treats invalid / negative inputs as 'ok' (defensive default)", () => {
    expect(sizeBudgetDecision(-1)).toBe("ok");
    expect(sizeBudgetDecision(NaN)).toBe("ok");
    expect(sizeBudgetDecision(Infinity)).toBe("reject"); // isFinite rules this out of "ok"
  });

  it("exports sensible default thresholds", () => {
    expect(SOFT_SIZE_LIMIT_BYTES).toBe(500 * 1024);
    expect(HARD_SIZE_LIMIT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("accepts custom limits", () => {
    expect(sizeBudgetDecision(50, 100, 200)).toBe("ok");
    expect(sizeBudgetDecision(150, 100, 200)).toBe("warn");
    expect(sizeBudgetDecision(250, 100, 200)).toBe("reject");
  });
});
