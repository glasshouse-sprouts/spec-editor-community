/**
 * Slice #41 — ⌘1–9 / Ctrl+1–9 jump-to-tab keyboard shortcuts.
 *
 * Why this lives in a renderer-side keydown listener rather than the
 * Electron menu like every other shortcut:
 *
 *   - Tabs are dynamic. Wiring nine menu items + their accelerators
 *     requires rebuilding the menu every time a tab opens or closes,
 *     plus you'd see "Switch to Tab 5" greyed out when there are
 *     only four tabs. Keeping it in the renderer keeps the menu
 *     static (good UX) at the cost of slightly less discoverability
 *     (the cheat sheet covers that).
 *
 * Behaviour:
 *
 *   - ⌘1 selects the first tab (the project tab, always present).
 *   - ⌘2..⌘9 select the 2nd..9th tab if it exists; no-op otherwise.
 *   - Plain "1"–"9" do nothing — the modifier is required so users
 *     can still type digits into inputs.
 *   - Ignored when the focus is on an editable element (input,
 *     textarea, contentEditable) so typing isn't intercepted. The
 *     ⌘ modifier alone wouldn't normally collide with text input,
 *     but TipTap and other rich editors sometimes have their own
 *     ⌘1 / ⌘2 bindings for headings — we yield to those.
 */

import { useEffect } from "react";

/**
 * True when the keypress originated inside an editable element. We
 * treat any `<input>`, `<textarea>`, or `[contentEditable]` element
 * as a text-input context — we don't want to steal ⌘1 from a TipTap
 * editor that uses it for "Heading 1".
 */
function isFromTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  // contentEditable can be "true" or "inherit". `isContentEditable`
  // walks the ancestor chain, which is what we want.
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Mount the ⌘1–9 listener. Calls `onSelect(index)` with a 0-based
 * index when a matching combo fires; the caller looks up the tab id
 * and selects it (or no-ops if the index is out of range).
 */
export function useTabSwitchShortcuts(
  onSelect: (zeroBasedIndex: number) => void,
): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const hasModifier = e.metaKey || e.ctrlKey;
      if (!hasModifier) return;
      // We don't claim Shift- or Alt-modified digits — those collide
      // with native shortcuts and OS-level ime input.
      if (e.shiftKey || e.altKey) return;
      if (isFromTextInput(e.target)) return;
      // Match the digit keys "1"..."9". `e.key` is the printable
      // character, which on US layouts is the digit; on other
      // layouts the digit may need Shift, but we only want the bare
      // ⌘1 case for now.
      const code = e.code;
      // KeyboardEvent.code uses "Digit1".."Digit9" for the top-row
      // numerals — stable across keyboard layouts.
      const m = /^Digit([1-9])$/.exec(code);
      if (!m) return;
      const oneBased = Number.parseInt(m[1]!, 10);
      e.preventDefault();
      onSelect(oneBased - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);
}
