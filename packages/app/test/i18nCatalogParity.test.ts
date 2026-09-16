/**
 * Catalog parity — the two i18n catalogs must carry the same keys.
 *
 * The lookup in i18n.ts falls back `catalog[key] ?? fallback[key] ?? key`
 * with Danish as the fallback locale. A key missing from messages.en.json
 * therefore shows Danish text to an English user: no error, no warning,
 * nothing that breaks. This test is the only thing that catches it.
 */

import { describe, expect, it } from "vitest";

import da from "../src/renderer/src/i18n/messages.da.json";
import en from "../src/renderer/src/i18n/messages.en.json";

describe("i18n catalog parity", () => {
  const daKeys = Object.keys(da).sort();
  const enKeys = Object.keys(en).sort();

  it("has no key in Danish that is missing from English", () => {
    expect(daKeys.filter((k) => !(k in en))).toEqual([]);
  });

  it("has no key in English that is missing from Danish", () => {
    expect(enKeys.filter((k) => !(k in da))).toEqual([]);
  });

  it("has no empty values in either catalog", () => {
    const empty = [
      ...daKeys.filter((k) => (da as Record<string, string>)[k] === ""),
      ...enKeys.filter((k) => (en as Record<string, string>)[k] === ""),
    ];
    expect(empty).toEqual([]);
  });
});
