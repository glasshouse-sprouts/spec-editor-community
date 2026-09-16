/**
 * Remove the user-applied formatting marks from a section body
 * without touching anything else. Pure function: input HTML in,
 * cleaned HTML out, no I/O.
 *
 * Slice "Highlights & formatting" — used by the PDF build path
 * when the user toggles "Hide highlights" / "Hide font colors" in
 * the Export options modal. The on-disk file is never mutated; the
 * strip happens at the HTML preprocessing step inside `buildSpecPdf`
 * just before we hand the body to `html-to-pdfmake`.
 *
 * Strip semantics
 * ---------------
 * For each element matching one of the kinds in `kindsToStrip`, the
 * element itself (`<mark>` / `<span>`) is dropped while its inner
 * children (text + nested marks) are preserved in place. So
 *
 *   <mark class="bg-yellow">important <strong>thing</strong></mark>
 *
 * with `kindsToStrip = {"bg-yellow"}` becomes
 *
 *   important <strong>thing</strong>
 *
 * Other formatting (bold, links, tables, images, etc.) and other
 * mark kinds are untouched. Nested formatting survives.
 */

import type { MarkKind } from "./markKinds.js";

/**
 * Return a new body string with every run carrying one of
 * `kindsToStrip` "unwrapped" — the wrapping `<mark>` / `<span>` is
 * removed, the inner content stays in document order.
 *
 * No-ops cleanly when `kindsToStrip` is empty or the body has no
 * matching marks. Empty / nullish input is returned as `""`.
 */
export function stripHighlights(
  html: string | null | undefined,
  kindsToStrip: ReadonlySet<MarkKind>,
): string {
  if (!html) return "";
  if (kindsToStrip.size === 0) return html;
  // Tiny optimisation — most bodies don't carry marks at all.
  if (!html.includes("bg-") && !html.includes("tc-")) return html;

  // Wrap so we have a single root to read innerHTML from.
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild;
  if (!root) return html;

  // Build a selector that matches every element to strip in one
  // querySelectorAll pass. We then iterate in document order and
  // unwrap each — important to grab the list before mutation,
  // because removing nodes invalidates a live NodeList.
  const selectors: string[] = [];
  for (const k of kindsToStrip) {
    const tag = k.startsWith("bg-") ? "mark" : "span";
    selectors.push(`${tag}.${k}`);
  }
  const matches = Array.from(
    root.querySelectorAll<HTMLElement>(selectors.join(",")),
  );
  for (const el of matches) {
    unwrap(el);
  }
  return root.innerHTML;
}

/**
 * Replace `el` with its child nodes in-place. The element's
 * children become siblings of where it used to be; the element
 * itself is detached.
 */
function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}
