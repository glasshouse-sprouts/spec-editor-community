import { describe, expect, it } from "vitest";

import { railLabel } from "../src/renderer/src/Sidebar.js";

describe("railLabel", () => {
  it("prefers a short code over the name", () => {
    expect(railLabel("BI 2", "Bygningsinstallationer 2")).toBe("BI2");
    expect(railLabel("2.5", "Whatever")).toBe("2.5");
  });

  it("truncates long codes to 4 chars", () => {
    expect(railLabel("ABCDEFG", "name")).toBe("ABCD");
  });

  it("strips whitespace inside codes", () => {
    expect(railLabel("  BI   2  ", "name")).toBe("BI2");
  });

  it("falls back to the first word's first 2 chars when no code", () => {
    expect(railLabel(null, "Fundament")).toBe("FU");
    expect(railLabel("", "terrændæk")).toBe("TE");
    expect(railLabel("   ", "IKT beskrivelse")).toBe("IK");
  });

  it('returns "?" when there is nothing usable', () => {
    expect(railLabel(null, "")).toBe("?");
    expect(railLabel("", "   ")).toBe("?");
  });
});
