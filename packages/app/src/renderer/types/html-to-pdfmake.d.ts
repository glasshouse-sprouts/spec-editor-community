/**
 * Ambient types for `html-to-pdfmake`.
 *
 * The package ships no .d.ts and no DefinitelyTyped entry. We only
 * touch a single call site (`renderPdf.ts`) and cast the result to
 * pdfmake's `Content`, so a minimal module declaration is enough —
 * no need to model the full option surface.
 *
 * If we ever need richer typing, upgrade this to named exports or
 * migrate to @types/html-to-pdfmake when one exists.
 */

declare module "html-to-pdfmake" {
  import type { Content } from "pdfmake/interfaces";

  interface HtmlToPdfMakeOptions {
    // Keep open for now — html-to-pdfmake exposes many knobs (imagesByReference,
    // tableAutoSize, ignoreStyles, styleMap, etc.). Typing them all is more
    // noise than value at this stage.
    [key: string]: unknown;
  }

  export default function htmlToPdfmake(
    html: string,
    options?: HtmlToPdfMakeOptions,
  ): Content | Content[];
}
