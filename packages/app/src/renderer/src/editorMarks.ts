/**
 * Custom TipTap marks (6L.1) and node overrides (6L.4) for the Molio
 * section editor.
 *
 * Why not use `@tiptap/extension-color` and `@tiptap/extension-highlight`?
 * Those emit inline `style="color: X"` / `style="background-color: X"`
 * attributes. Our sanitizer deliberately does NOT allow inline `style`
 * — it whitelists a tiny class-value set on `<mark>` / `<span>` instead.
 * Emitting classes keeps the single source of truth for color hexes in
 * one CSS file, keeps the sanitizer simple, and keeps hex values out of
 * pasted-HTML attack surface.
 *
 * Each mark stores one attribute: `color`, whose value is one of
 * `"yellow" | "blue" | "red" | "green" | null`. On render we translate
 * that into our class convention:
 *   TextColor "red"   → <span class="tc-red">
 *   BgColor   "yellow"→ <mark class="bg-yellow">
 *
 * On parse we read the class back, so pasted / round-tripped HTML keeps
 * its color. Unknown classes fall through as null → mark isn't applied.
 */

import { Mark, mergeAttributes } from "@tiptap/core";
import { TableCell, TableHeader } from "@tiptap/extension-table";

/** The four supported palette names. Kept in one place. */
export const PALETTE_COLORS = ["yellow", "blue", "red", "green"] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

/**
 * TipTap's command types live in module augmentation. Declaring the
 * custom commands here lets callers write
 * `editor.chain().setTextColor("red")` with full type support.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: PaletteColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    bgColor: {
      setBgColor: (color: PaletteColor) => ReturnType;
      unsetBgColor: () => ReturnType;
    };
  }
}

function parseColorFromClass(
  className: string | null | undefined,
  prefix: "tc" | "bg",
): PaletteColor | null {
  if (!className) return null;
  const m = className.match(
    new RegExp(`\\b${prefix}-(yellow|blue|red|green)\\b`),
  );
  return (m?.[1] as PaletteColor) ?? null;
}

/**
 * Text color mark. Emits `<span class="tc-red">…</span>`.
 */
export const TextColor = Mark.create({
  name: "textColor",

  addAttributes() {
    return {
      color: {
        default: null as PaletteColor | null,
        parseHTML: (el) => parseColorFromClass(el.getAttribute("class"), "tc"),
        renderHTML: (attrs) => {
          const color = attrs.color as PaletteColor | null;
          return color ? { class: `tc-${color}` } : {};
        },
      },
    };
  },

  parseHTML() {
    // Only match spans that already carry one of our tc-* classes; a
    // plain <span> is not something this mark should grab.
    return [
      {
        tag: "span",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const color = parseColorFromClass(node.getAttribute("class"), "tc");
          return color ? { color } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color: PaletteColor) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/**
 * Highlight background mark. Emits `<mark class="bg-yellow">…</mark>`.
 */
export const BgColor = Mark.create({
  name: "bgColor",

  addAttributes() {
    return {
      color: {
        default: null as PaletteColor | null,
        parseHTML: (el) => parseColorFromClass(el.getAttribute("class"), "bg"),
        renderHTML: (attrs) => {
          const color = attrs.color as PaletteColor | null;
          return color ? { class: `bg-${color}` } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const color = parseColorFromClass(node.getAttribute("class"), "bg");
          return color ? { color } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setBgColor:
        (color: PaletteColor) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetBgColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/* ------------------------------------------------------------------ */
/* 6L.4 — column-width persistence on table cells                     */
/* ------------------------------------------------------------------ */

/**
 * Read a `data-width` attribute off a <td>/<th> and turn it into the
 * single-element array shape TipTap uses internally (`colwidth: [N]`).
 * Returns null on anything that isn't a bare digit string so the
 * sanitizer's tighter rule (`/^\d{1,4}$/`) isn't accidentally
 * contradicted here.
 */
function parseDataWidth(el: HTMLElement): number[] | null {
  const dw = el.getAttribute("data-width");
  if (!dw || !/^\d{1,4}$/.test(dw)) return null;
  const n = parseInt(dw, 10);
  return Number.isFinite(n) && n > 0 ? [n] : null;
}

/**
 * Override TipTap's built-in `colwidth` attribute on cell extensions so
 * widths are persisted as `data-width="120"` on save (and read back on
 * load) — NOT as `style="width: 120px"`. This is what keeps our
 * sanitizer's "no inline style, ever" rule intact while still letting
 * ProseMirror's column-resize plugin work normally in the editor (the
 * plugin uses the in-memory `colwidth` attr, not the serialized HTML).
 *
 * Why override only the serialization and not the attribute shape?
 * TipTap's column-resize plugin expects `colwidth` to be an array of
 * numbers (one entry per column a cell spans, via colspan). Keep that
 * intact; just change how it's written to / read from HTML.
 */
const colwidthAttributeOverride = {
  colwidth: {
    default: null,
    parseHTML: (element: HTMLElement) => parseDataWidth(element),
    renderHTML: (attrs: { colwidth?: number[] | null }) => {
      const cw = attrs.colwidth;
      if (!cw || cw.length === 0 || !cw[0]) return {};
      // We persist only the first entry — we don't support colspan in
      // 6L.4 (cell merge is in 6L.4-Advanced / icebox). If a user
      // manages to paste in a multi-span cell, we save the widest
      // column width so at least nothing is lost visually.
      return { "data-width": String(Math.round(Math.max(...cw))) };
    },
  },
};

export const MolioTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...colwidthAttributeOverride,
    };
  },
});

export const MolioTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...colwidthAttributeOverride,
    };
  },
});
