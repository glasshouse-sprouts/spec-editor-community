/** @vitest-environment jsdom */

/**
 * Tests for the 6L.5a-ε HTML → pdfmake image-width clamp preprocessor.
 *
 * The editor stores inserted images as
 *   <img src="data:image/png;base64,…" width="NNN" alt="">
 * where `NNN` is the image's current display width in pixels (either
 * the post-resize width from imageProcess.ts, or an on-screen resized
 * width from 6L.5a-δ once that ships).
 *
 * html-to-pdfmake converts that px value to pt using × 0.75 (96→72 dpi).
 * pdfmake does NOT auto-fit images to the page, so a 1600 px image
 * would emit 1200 pt (~16.7 inches) and overflow A4. This preprocessor
 * caps the px value at MAX_IMAGE_WIDTH_PX (~533 px, i.e. ~400 pt) and
 * scales any explicit `height` attribute by the same ratio so the
 * aspect ratio is preserved.
 *
 * We test behavior: clamping, height scaling, missing/invalid inputs,
 * and that the data: URL is never touched.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_WIDTH_PX,
  preprocessImageWidths,
} from "../src/renderer/src/pdf/renderPdf.js";

/**
 * Pull the first `<img>` element's `width`/`height` attrs out of a
 * processed HTML fragment. Returns null for width/height when the attr
 * is missing.
 */
function imgAttrs(html: string): {
  width: string | null;
  height: string | null;
  src: string | null;
} {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`,
    "text/html",
  );
  const img = doc.querySelector("img");
  if (!img) return { width: null, height: null, src: null };
  return {
    width: img.getAttribute("width"),
    height: img.getAttribute("height"),
    src: img.getAttribute("src"),
  };
}

// Tiny 1×1 transparent PNG; serves as a realistic data: URL payload.
const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("preprocessImageWidths", () => {
  it("returns the input unchanged when there is no <img> tag", () => {
    const html = "<p>Just text.</p><p>More text.</p>";
    expect(preprocessImageWidths(html)).toBe(html);
  });

  it("returns the input unchanged when width attribute is absent", () => {
    const html = `<p><img src="${DATA_URL}" alt=""></p>`;
    const out = preprocessImageWidths(html);
    // No width was specified, so nothing to clamp — let html-to-pdfmake
    // derive the natural size.
    expect(imgAttrs(out).width).toBeNull();
  });

  it("leaves a small image untouched (width below the cap)", () => {
    const html = `<p><img src="${DATA_URL}" width="200" height="150" alt=""></p>`;
    const { width, height, src } = imgAttrs(preprocessImageWidths(html));
    expect(width).toBe("200");
    expect(height).toBe("150");
    expect(src).toBe(DATA_URL);
  });

  it("leaves an image exactly at the cap untouched", () => {
    const html = `<p><img src="${DATA_URL}" width="${MAX_IMAGE_WIDTH_PX}" alt=""></p>`;
    const { width } = imgAttrs(preprocessImageWidths(html));
    expect(width).toBe(String(MAX_IMAGE_WIDTH_PX));
  });

  it("clamps an oversized width to the cap", () => {
    const html = `<p><img src="${DATA_URL}" width="1600" alt=""></p>`;
    const { width } = imgAttrs(preprocessImageWidths(html));
    expect(width).toBe(String(MAX_IMAGE_WIDTH_PX));
  });

  it("scales height proportionally when width is clamped", () => {
    // 1600 × 1200 (4:3). After clamp to 533, height should be ~400.
    const html = `<p><img src="${DATA_URL}" width="1600" height="1200" alt=""></p>`;
    const { width, height } = imgAttrs(preprocessImageWidths(html));
    expect(width).toBe(String(MAX_IMAGE_WIDTH_PX));
    const ratio = MAX_IMAGE_WIDTH_PX / 1600;
    const expectedH = Math.round(1200 * ratio);
    expect(height).toBe(String(expectedH));
  });

  it("does not synthesize a height when none was provided", () => {
    const html = `<p><img src="${DATA_URL}" width="2000" alt=""></p>`;
    const { height } = imgAttrs(preprocessImageWidths(html));
    expect(height).toBeNull();
  });

  it("preserves the data: URL payload exactly", () => {
    const html = `<p><img src="${DATA_URL}" width="5000" alt=""></p>`;
    const { src } = imgAttrs(preprocessImageWidths(html));
    expect(src).toBe(DATA_URL);
  });

  it("handles multiple images in the same HTML", () => {
    const html = `
      <p><img src="${DATA_URL}" width="100" alt="small"></p>
      <p><img src="${DATA_URL}" width="3000" height="2000" alt="big"></p>
      <p><img src="${DATA_URL}" width="${MAX_IMAGE_WIDTH_PX}" alt="exact"></p>
    `;
    const doc = new DOMParser().parseFromString(
      `<!doctype html><body>${preprocessImageWidths(html)}</body>`,
      "text/html",
    );
    const imgs = Array.from(doc.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("width"))).toEqual([
      "100",
      String(MAX_IMAGE_WIDTH_PX),
      String(MAX_IMAGE_WIDTH_PX),
    ]);
    // Second image: height should have been scaled 2000 * (533/3000) ≈ 355.
    const ratio = MAX_IMAGE_WIDTH_PX / 3000;
    expect(imgs[1].getAttribute("height")).toBe(
      String(Math.round(2000 * ratio)),
    );
  });

  it("ignores non-numeric width attributes", () => {
    const html = `<p><img src="${DATA_URL}" width="auto" alt=""></p>`;
    const { width } = imgAttrs(preprocessImageWidths(html));
    // Untouched — we don't invent a value.
    expect(width).toBe("auto");
  });

  it("ignores zero and negative widths", () => {
    const html = `<p><img src="${DATA_URL}" width="0" alt=""></p>
                  <p><img src="${DATA_URL}" width="-100" alt=""></p>`;
    const doc = new DOMParser().parseFromString(
      `<!doctype html><body>${preprocessImageWidths(html)}</body>`,
      "text/html",
    );
    const imgs = Array.from(doc.querySelectorAll("img"));
    expect(imgs[0].getAttribute("width")).toBe("0");
    expect(imgs[1].getAttribute("width")).toBe("-100");
  });

  it("honors a custom maxWidthPx override", () => {
    const html = `<p><img src="${DATA_URL}" width="800" alt=""></p>`;
    const out = preprocessImageWidths(html, 300);
    expect(imgAttrs(out).width).toBe("300");
  });

  it("leaves images with width at or below a custom override untouched", () => {
    const html = `<p><img src="${DATA_URL}" width="250" alt=""></p>`;
    const out = preprocessImageWidths(html, 300);
    expect(imgAttrs(out).width).toBe("250");
  });
});
