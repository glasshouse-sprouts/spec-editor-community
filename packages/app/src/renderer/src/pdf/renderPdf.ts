/**
 * pdfmake runtime wrapper.
 *
 * The pure builders (`buildSpecPdf`, `buildCpPdf`) return plain JSON
 * doc-definitions. This file does the actual "JSON → PDF bytes" step
 * using pdfmake, plus turns sanitised HTML into pdfmake Content via
 * `html-to-pdfmake`.
 *
 * Kept as a thin wrapper so unit tests can stay away from pdfmake
 * entirely (pdfmake loads fonts and needs a browser-ish global, which
 * we'd have to mock just to test a pure doc-def shape).
 */

// pdfmake ships its client bundle as a CJS UMD. ESM default-import of
// a CJS module hands us the namespace object on some bundlers and the
// inner default on others — we normalise below. Same story for
// vfs_fonts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import pdfMakeImport from "pdfmake/build/pdfmake.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import pdfFontsImport from "pdfmake/build/vfs_fonts.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import htmlToPdfmakeImport from "html-to-pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import { buildCpPdf, type BuildCpPdfArgs } from "./buildCpPdf.js";
import {
  buildCompositePdf,
  type BuildCompositePdfArgs,
} from "./buildCompositePdf.js";
import { buildSpecPdf, type BuildSpecPdfArgs } from "./buildSpecPdf.js";
import { normalizePdfmakeTables } from "./normalizeTables.js";
import {
  buildVersionSummaryPdf,
  type BuildVersionSummaryArgs,
} from "./buildVersionSummaryPdf.js";
// FONT slice 2026-05-12: Open Sans VFS module exists at ./openSansVfs.js
// but is intentionally not imported here — wiring it caused pdfmake to
// stall mid-export. Left in source for the diagnostic follow-up.

/* eslint-disable @typescript-eslint/no-explicit-any */
// Normalise "what the dynamic import gave us" into the actual objects
// we need. Works with both namespace-default and bare-default shapes.
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
const pdfFonts: any = (pdfFontsImport as any).default ?? pdfFontsImport;
const htmlToPdfmake: (html: string, opts?: any) => Content =
  (htmlToPdfmakeImport as any).default ?? (htmlToPdfmakeImport as any);
/* eslint-enable @typescript-eslint/no-explicit-any */

// Wire the bundled Roboto VFS so pdfmake can embed the font bytes.
// Without this pdfmake throws "File 'Roboto-Regular.ttf' not found in
// virtual file system". Done once at module load — cheap.
//
// FONT slice (2026-05-12): the Open Sans wiring is parked. Initial
// attempt to register Open Sans with pdfmake caused `getBuffer` to
// hang silently mid-export (stalls at 0/N on real files). Likely
// cause: pdfmake's font-loading pipeline rejects the bundled TTFs
// without throwing, or the `pdfMake.fonts` registration doesn't
// take effect on the build we're shipping. Editor-side Open Sans
// (CSS @font-face) is unaffected and stays on. PDF stays on
// pdfmake's bundled Roboto until we diagnose. The constants from
// openSansVfs.ts are imported below for reference but not wired
// into pdfMake.vfs / pdfMake.fonts.
if (pdfFonts?.pdfMake?.vfs) {
  pdfMake.vfs = pdfFonts.pdfMake.vfs;
} else if (pdfFonts?.vfs) {
  // pdfmake ≥ 0.2 ships vfs at the top level of the module.
  pdfMake.vfs = pdfFonts.vfs;
}

/**
 * Turn a finished pdfmake doc-definition into a byte buffer. Used by
 * the spec and CP renderers below; exported so a caller with their
 * own doc-def can re-use the buffer path without rebuilding anything.
 *
 * EXPORT-Hang safety net (part 2). pdfmake can throw DEEP inside its own
 * async measure step (e.g. "Malformed table row"). That throw lands in
 * pdfmake's internal promise chain, so the `getBuffer` callback never
 * fires and this promise would otherwise hang forever — freezing the
 * whole export. We catch it two ways:
 *   - an `unhandledrejection` listener active only during the build,
 *     which turns pdfmake's stray rejection into a normal rejection so
 *     the caller can show a real error message; and
 *   - a generous timeout backstop for any other "never calls back"
 *     failure mode.
 * The happy path is unchanged: `getBuffer` resolves, we clean both up.
 */
export function renderDocDefinitionToPdf(
  docDef: TDocumentDefinitions,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;

    // Backstop in case pdfmake neither calls back nor rejects. Generous
    // so a genuinely large export can't trip it; the rejection listener
    // below catches the common failure within milliseconds anyway.
    // Armed first so it can be a `const`: the handlers underneath only
    // read it once something has actually gone wrong, which is long
    // after this line has run.
    const timer = setTimeout(() => {
      finish(() => reject(new Error("PDF generation timed out.")));
    }, 120_000);

    const onUnhandled = (ev: PromiseRejectionEvent): void => {
      const reason: unknown = ev?.reason;
      finish(() =>
        reject(
          reason instanceof Error
            ? reason
            : new Error(String(reason ?? "PDF generation failed")),
        ),
      );
    };

    const cleanup = (): void => {
      if (typeof window !== "undefined") {
        window.removeEventListener("unhandledrejection", onUnhandled);
      }
      clearTimeout(timer);
    };

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("unhandledrejection", onUnhandled);
    }
    try {
      const pdfDoc = pdfMake.createPdf(docDef);
      pdfDoc.getBuffer((buf: Uint8Array) => finish(() => resolve(buf)));
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

/**
 * Palette used by 6L.1 text-color and highlight marks. Same hex values
 * as the CSS variables in `styles.css` — kept in sync manually. If this
 * list drifts the editor and the PDF will disagree on color, so the
 * sanitizer's class-value allowlist is effectively the third spot where
 * these four color names live. A future refactor could centralise them.
 */
const PALETTE_HEX = {
  yellow: "#fff26b",
  blue: "#9ed6ff",
  red: "#ff8b8b",
  green: "#b7f0a3",
} as const;

/**
 * `classStyles` map handed to html-to-pdfmake. Translates our eight
 * whitelisted class names into pdfmake style tokens so the PDF renders
 * the same colors the editor does. Strikethrough is handled by the
 * library natively via `<s>` → `decoration: "lineThrough"`, no entry
 * needed.
 */
export const HTML_TO_PDFMAKE_CLASS_STYLES = {
  "tc-yellow": { color: PALETTE_HEX.yellow },
  "tc-blue": { color: PALETTE_HEX.blue },
  "tc-red": { color: PALETTE_HEX.red },
  "tc-green": { color: PALETTE_HEX.green },
  "bg-yellow": { background: PALETTE_HEX.yellow },
  "bg-blue": { background: PALETTE_HEX.blue },
  "bg-red": { background: PALETTE_HEX.red },
  "bg-green": { background: PALETTE_HEX.green },
};

/**
 * Target total width (in pdfmake points) that data-width-driven column
 * widths are normalized to. A4 portrait has ~451pt of usable content
 * width after our page margins; landscape has ~770pt. 480pt is a middle
 * ground that pdfmake will auto-fit if it exceeds the page. Because we
 * normalize *proportions*, the shape of the table is what matters —
 * the absolute target just has to be plausibly sized.
 */
const PDFMAKE_TABLE_TARGET_POINTS = 480;

/**
 * Turn the `data-width="N"` attributes on a table's first-row cells into
 * a pdfmake `widths: [...]` array, injected via the `data-pdfmake`
 * attribute that html-to-pdfmake understands. Preserves proportions
 * (widths are scaled to sum to ~PDFMAKE_TABLE_TARGET_POINTS) so a table
 * edited at any screen size renders with the same column ratios in PDF.
 *
 * First-row cells without a data-width fall back to pdfmake's `"*"`
 * (equal share of remaining space). Tables with no data-width at all
 * are left untouched so html-to-pdfmake's defaults still apply.
 *
 * This only runs in the renderer (we're using DOMParser). Tests for
 * the pure builders never go through this path — they inject a fake
 * converter.
 */
export function preprocessTableWidths(html: string): string {
  if (!html || !html.includes("<table")) return html;
  // Guard against non-browser environments (unlikely here but cheap).
  if (typeof DOMParser === "undefined") return html;

  // Wrap in a fragment so we can serialize back without a full HTML
  // document chrome (<html><body>…).
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body><div id="__root__">${html}</div></body>`,
    "text/html",
  );
  const root = doc.getElementById("__root__");
  if (!root) return html;

  const tables = root.querySelectorAll("table");
  tables.forEach((tbl) => {
    const firstRow = tbl.querySelector("tr");
    if (!firstRow) return;
    const cells = Array.from(
      firstRow.querySelectorAll(":scope > td, :scope > th"),
    );
    if (cells.length === 0) return;

    const raw = cells.map((c) => {
      const dw = c.getAttribute("data-width");
      if (!dw || !/^\d{1,4}$/.test(dw)) return null;
      const n = parseInt(dw, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    });
    // If no cell provided a width, don't override html-to-pdfmake.
    if (raw.every((w) => w === null)) return;

    const total = raw.reduce<number>((sum, w) => sum + (w ?? 0), 0);
    const widths = raw.map((w): number | string => {
      if (w === null || total === 0) return "*";
      return Math.max(1, Math.round((w / total) * PDFMAKE_TABLE_TARGET_POINTS));
    });

    // Merge with any existing data-pdfmake JSON so we don't clobber
    // user-authored overrides (Molio content won't have any, but it's
    // cheap to be defensive).
    let existing: Record<string, unknown> = {};
    const prev = tbl.getAttribute("data-pdfmake");
    if (prev) {
      try {
        existing = JSON.parse(prev) as Record<string, unknown>;
      } catch {
        // Ignore malformed JSON — just overwrite.
      }
    }
    const merged = { ...existing, widths };
    tbl.setAttribute("data-pdfmake", JSON.stringify(merged));
  });

  return root.innerHTML;
}

/**
 * Maximum image width in pixels we hand to html-to-pdfmake (6L.5a-ε).
 *
 * html-to-pdfmake converts the `width` attribute on `<img>` from px to
 * pt using the 96 → 72 dpi ratio (× 0.75), so this px cap translates to
 * roughly 400 pt in the PDF. A4 portrait has ~451 pt of usable content
 * width after our page margins; 400 pt leaves a small visual margin so
 * images don't butt up against the text edge.
 *
 * Images whose `width` attribute is already ≤ this are untouched.
 * Images wider than this are scaled down proportionally (height too,
 * if a `height` attribute is present) so the aspect ratio is preserved.
 *
 * Note: our image processing pipeline caps natural width at 1600 px
 * (DEFAULT_MAX_WIDTH in imageProcess.ts). Without this clamp, a
 * freshly-dropped 1600 px image would render at 1200 pt in the PDF
 * and overflow the page.
 */
export const MAX_IMAGE_WIDTH_PX = 533; // ≈ 400 pt at 96 dpi

/**
 * Normalize `<img width="N">` attributes so oversized images fit the PDF
 * page. See MAX_IMAGE_WIDTH_PX for the rationale.
 *
 * This is a pure HTML-to-HTML transform (like preprocessTableWidths).
 * Uses DOMParser, so it only runs in the renderer / jsdom — callers in
 * non-browser environments get the input back unchanged.
 *
 * Behaviour:
 *   - Missing / non-numeric `width` → untouched.
 *   - `width` ≤ max             → untouched.
 *   - `width` >  max             → set to max, and `height` (if present
 *                                   and numeric) is scaled by the same
 *                                   ratio to preserve the aspect ratio.
 *
 * The `height` attribute is only adjusted if it was already present;
 * we do NOT synthesize one, because html-to-pdfmake will derive height
 * from the image's natural aspect ratio when it's absent.
 */
export function preprocessImageWidths(
  html: string,
  maxWidthPx: number = MAX_IMAGE_WIDTH_PX,
): string {
  if (!html || !html.includes("<img")) return html;
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(
    `<!doctype html><body><div id="__root__">${html}</div></body>`,
    "text/html",
  );
  const root = doc.getElementById("__root__");
  if (!root) return html;

  const imgs = root.querySelectorAll("img");
  imgs.forEach((img) => {
    const widthAttr = img.getAttribute("width");
    if (!widthAttr) return;
    const w = parseInt(widthAttr, 10);
    if (!Number.isFinite(w) || w <= 0) return;
    if (w <= maxWidthPx) return;

    // Clamp width, and scale height proportionally if present.
    const ratio = maxWidthPx / w;
    img.setAttribute("width", String(maxWidthPx));

    const heightAttr = img.getAttribute("height");
    if (heightAttr) {
      const h = parseInt(heightAttr, 10);
      if (Number.isFinite(h) && h > 0) {
        img.setAttribute("height", String(Math.max(1, Math.round(h * ratio))));
      }
    }
  });

  return root.innerHTML;
}

/**
 * HTML → pdfmake Content converter wired to the real library. This is
 * what production renderers inject into the pure builders' `htmlConverter`
 * argument. Tests inject an identity fake and never call into this.
 *
 * `html-to-pdfmake` mutates/expects a DOM — that's fine in the renderer
 * process, which is a browser context.
 */
export function htmlToContent(html: string): Content {
  if (!html) return { text: "" };
  // 6L.4: normalize table column widths first so they scale with the
  // PDF page rather than the screen size they were edited at.
  // 6L.5a-ε: clamp image widths so large pasted/dropped images don't
  // overflow the PDF page.
  const prepared = preprocessImageWidths(preprocessTableWidths(html));
  // `classStyles` gives us the 6L.1 color palette. Other defaults are
  // fine — html-to-pdfmake already handles <s> (strikethrough), <mark>
  // (yellow background by default, overridden by our bg-* classes),
  // lists, tables, and images (base64 data: URLs included).
  //
  // `defaultStyles.p` tightens the visible gap between consecutive
  // paragraphs. html-to-pdfmake's stock default is `[0, 5, 0, 10]` =
  // top 5 / bottom 10 → 15pt visible gap between two <p>s (margins
  // don't collapse in pdfmake). We first cut it to `[0, 2, 0, 5]` (7pt,
  // 2026-05-12), then `[0, 1, 0, 2.5]` (3.5pt), and finally to
  // `[0, 1, 0, 1]` = top 1 / bottom 1 → 2pt gap (Tore, 2026-07-01),
  // keeping a hint of top margin so the first paragraph after a heading
  // still breathes.
  const content = htmlToPdfmake(prepared, {
    classStyles: HTML_TO_PDFMAKE_CLASS_STYLES,
    defaultStyles: {
      p: { margin: [0, 1, 0, 1] },
    },
  }) as Content;
  // EXPORT-Hang: make any ragged / hole-containing table rectangular so
  // pdfmake can't throw "Malformed table row" mid-measure (an uncaught
  // throw there would freeze the whole export — see STATUS EXPORT-Hang).
  return normalizePdfmakeTables(content);
}

/**
 * Build + render a work-area / BDB spec PDF in one shot.
 * Caller already has a `FilePayload`; just pass the relevant slice.
 *
 * `stripBody` is propagated as-is to the builder; the wiring at the
 * call site (ExportCard.buildBytesFor) decides whether to bind it to
 * `stripHighlights` or leave it undefined.
 *
 * **6L.1 highlight + text-color rendering, fixed 2026-04-26.**
 * `html-to-pdfmake`'s `classStyles` option only stamps the class
 * names into each content node's `style: [...]` array — pdfmake
 * itself needs the same names defined in the doc-level `styles: {}`
 * map to actually paint the colours. The pure builder owns the
 * doc's `styles` map but is renderer-agnostic; merging the palette
 * here at the wrapper boundary gives us the paint without polluting
 * the builder with rendering concerns. Without this merge the eight
 * 6L.1 colours stamp into the content tree but pdfmake silently
 * ignores them, leaving black-on-white output.
 */
export function renderSpecPdf(
  args: Omit<BuildSpecPdfArgs, "htmlConverter">,
): Promise<Uint8Array> {
  const docDef = buildSpecPdf({ ...args, htmlConverter: htmlToContent });
  docDef.styles = { ...docDef.styles, ...HTML_TO_PDFMAKE_CLASS_STYLES };
  return renderDocDefinitionToPdf(docDef);
}

/**
 * Build + render a composite spec PDF (multi-chapter — "per work
 * area", "per contract", or "whole project" exports). Same wrapper
 * shape as `renderSpecPdf`: the caller passes everything except the
 * htmlConverter, which we inject from this module.
 */
export function renderCompositePdf(
  args: Omit<BuildCompositePdfArgs, "htmlConverter">,
): Promise<Uint8Array> {
  const docDef = buildCompositePdf({ ...args, htmlConverter: htmlToContent });
  docDef.styles = { ...docDef.styles, ...HTML_TO_PDFMAKE_CLASS_STYLES };
  return renderDocDefinitionToPdf(docDef);
}

/** Build + render a control-plan PDF in one shot. */
export function renderCpPdf(args: BuildCpPdfArgs): Promise<Uint8Array> {
  const docDef = buildCpPdf(args);
  return renderDocDefinitionToPdf(docDef);
}

/**
 * Build + render the version-summary PDF in one shot. The pure
 * builder doesn't need the htmlConverter (no HTML bodies in the
 * summary doc-def), so this wrapper is just `build → render`.
 */
export function renderVersionSummaryPdf(
  args: BuildVersionSummaryArgs,
): Promise<Uint8Array> {
  const docDef = buildVersionSummaryPdf(args);
  return renderDocDefinitionToPdf(docDef);
}
