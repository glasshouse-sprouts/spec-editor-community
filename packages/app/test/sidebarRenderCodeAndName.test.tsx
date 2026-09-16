/**
 * Lock in the de-duplication behaviour of `renderCodeAndName` — the
 * helper Sidebar.tsx uses to render "code + name" tree rows without
 * showing the name twice when the data is already self-describing.
 *
 * Scenarios covered:
 *   1. null / empty code  → only the name, no `<code>` tag
 *   2. code === name      → only the name
 *   3. name starts with   → only the name (e.g. code "1.1" + title
 *      "1.1 Fundering" previously rendered "1.1 1.1 Fundering")
 *   4. distinct code+name → `<code>code</code> name`
 *
 * Uses renderToStaticMarkup because the helper is a plain JSX fragment
 * — no effects, no state, no DOM needed. Keeps the test fast.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Import the .tsx source directly — vitest's resolver prefers the
// compiled `.js` sibling when using the .js extension, and that file
// is stale in source-controlled form (no build step for tests).
import { renderCodeAndName } from "../src/renderer/src/Sidebar.tsx";

function html(code: string | null, name: string | null): string {
  return renderToStaticMarkup(renderCodeAndName(code, name));
}

describe("renderCodeAndName", () => {
  it("drops the <code> wrapper when the code is missing", () => {
    expect(html(null, "Fundering")).toBe("Fundering");
    expect(html("", "Fundering")).toBe("Fundering");
    expect(html("   ", "Fundering")).toBe("Fundering");
  });

  it("shows the name only when code equals name", () => {
    expect(html("Fundering", "Fundering")).toBe("Fundering");
    // Trims whitespace before comparing.
    expect(html(" Fundering ", "Fundering")).toBe("Fundering");
  });

  it("shows the name only when it already starts with the code", () => {
    expect(html("1.1", "1.1 Fundering")).toBe("1.1 Fundering");
    // Tab separator counts too.
    expect(html("1.1", "1.1\tFundering")).toBe("1.1\tFundering");
  });

  it("wraps the code in <code> when code and name are distinct", () => {
    expect(html("E00", "Generelle beskrivelser")).toBe(
      "<code>E00</code> Generelle beskrivelser",
    );
  });

  it("does not prefix-match when the name merely contains the code mid-string", () => {
    // "X1" is not a prefix of "Beton X1 Fundering" so we still want
    // the code to show separately — otherwise we'd hide valid codes.
    expect(html("X1", "Beton X1 Fundering")).toBe(
      "<code>X1</code> Beton X1 Fundering",
    );
  });
});
