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

/**
 * Task 143. The two long Danish counter labels carry a SOFT HYPHEN,
 * written as the JSON escape \u00ad in messages.da.json. It is what
 * makes them break as "Bygningsdels-" / "beskrivelser" in the narrow
 * counter tiles on the project overview instead of mid-word.
 *
 * The character is invisible in an editor, so it is easy to delete by
 * accident - and nothing visible breaks when it goes: the label just
 * starts wrapping in the wrong place again. Hence this guard.
 */
describe("soft hyphens in the Danish counter labels", () => {
  const SOFT_HYPHEN = "\u00ad";
  const labels = da as Record<string, string>;

  it.each([
    ["projectOverview.counters.workAreas", "Arbejds-beskrivelser"],
    ["projectOverview.counters.bdbs", "Bygningsdels-beskrivelser"],
  ])("%s breaks as %s", (key, expected) => {
    expect(labels[key]).toContain(SOFT_HYPHEN);
    expect(labels[key].replace(SOFT_HYPHEN, "-")).toBe(expected);
  });

  it("has exactly one break point in each label", () => {
    for (const key of [
      "projectOverview.counters.workAreas",
      "projectOverview.counters.bdbs",
    ]) {
      expect(labels[key].split(SOFT_HYPHEN)).toHaveLength(2);
    }
  });

  it("leaves the short labels alone", () => {
    for (const key of [
      "projectOverview.counters.controlPlans",
      "projectOverview.counters.attachments",
    ]) {
      expect(labels[key]).not.toContain(SOFT_HYPHEN);
    }
  });
});
