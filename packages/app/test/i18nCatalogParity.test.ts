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

/**
 * Task 178. "fagområde" and "arbejdsområde" are two DIFFERENT levels in
 * Molio 2.0, and the app only ever deals with the second one:
 *
 *   fagområde      S240          (vindue/dør/port)
 *   arbejdsområde  S240.01 /.02  (leverance / montage)  <- work_spec
 *
 * The Danish catalogue called the work area a "fagområde" in 14 strings,
 * including the Molio spec GUID label on a BDB. Nothing breaks when the
 * wrong word is used - the app just teaches the user a wrong model of
 * Molio, which the owner reported on 2026-10-02 as "central to
 * understanding it". Hence this guard: the word must not come back.
 *
 * The English catalogue says "work area" in all 14 and is not guarded
 * here; "work area" is not a word that can drift back by accident.
 */
describe("the Danish catalogue never calls a work area a fagområde", () => {
  const labels = da as Record<string, string>;

  // Catches every inflection: fagområde, fagområder, fagområdet,
  // fagområderne, and the capitalised forms.
  const FAGOMRAADE = /fagområd/i;

  /**
   * Keys that are ALLOWED to say "fagområde" because they really do mean
   * the S240 level. Empty on purpose: as of Task 178 no string in the app
   * needs the word. Adding a key here is a decision, not a fix - write
   * the string and the reason in a comment above the entry.
   */
  const ALLOWED: readonly string[] = [];

  it("has no value containing fagområde outside the allow-list", () => {
    const offenders = Object.keys(labels).filter(
      (k) => FAGOMRAADE.test(labels[k]) && !ALLOWED.includes(k),
    );
    expect(offenders).toEqual([]);
  });

  it("labels the locked BDB metadata field with arbejdsområde", () => {
    expect(labels["modal.editBdb.locked.molioSpecGuid"]).toBe(
      "Molio spec GUID (arbejdsområde)",
    );
  });
});

/**
 * Task 179 - THE RULE for the two Danish words (owner, 2026-10-05).
 * Both are correct Molio words, for two different things:
 *
 *   arbejdsbeskrivelse = the DOCUMENT the user edits, deletes, imports
 *                        and exports: a node in the tree, a dialog title,
 *                        a PDF, a count of things to import
 *   arbejdsområde      = Molio's LEVEL / classification: the code
 *                        (S240.01), the GUID, the revision, the
 *                        reference-list date and where it is inherited from
 *
 * (And "fagområde" is the S240 level above - see the test above.)
 *
 * When you add or change a Danish string that names the work_spec level,
 * decide which of the two it means. A string that says "arbejdsområde"
 * must be on ALLOWED_ARBEJDSOMRAADE below; adding a key there is a
 * decision, like the fagområde allow-list. A string about the document can
 * say "arbejdsbeskrivelse" freely. Task 179's review of every string, with
 * the reason for each, is the table on tracker card 179.
 *
 * English says "work area" for both and is not guarded here.
 */
describe("the Danish catalogue follows the arbejdsbeskrivelse/arbejdsområde rule", () => {
  const labels = da as Record<string, string>;

  // Every inflection: arbejdsområde, -områder, -området, -områdets, ...
  const ARBEJDSOMRAADE = /arbejdsområd/i;

  /** Keys that say "arbejdsområde" because they are about the LEVEL. */
  const ALLOWED_ARBEJDSOMRAADE: readonly string[] = [
    // The reference-list date belongs to the level, and is inherited
    // BDB -> work area -> project (Task 155).
    "modal.referencelistDate.fromWorkArea",
    "modal.referencelistCascade.bodyWithDate",
    "modal.referencelistCascade.bodyCleared",
    "modal.referencelistCascade.counts",
    "ref.referencelist.dateSource.workArea",
    "ref.referencelist.dateInvalid.workArea",
    "ref.referencelist.noListForDate",
    // The Molio spec GUID belongs to the level (Task 178).
    "modal.editBdb.locked.molioSpecGuid",
    // The code (S240.01) belongs to the level: the contract mapping is
    // keyed on it.
    "settings.defaults.hint",
    "settings.defaults.mapping",
  ];

  it("says arbejdsområde only in strings about the level", () => {
    const offenders = Object.keys(labels).filter(
      (k) =>
        ARBEJDSOMRAADE.test(labels[k]) && !ALLOWED_ARBEJDSOMRAADE.includes(k),
    );
    expect(offenders).toEqual([]);
  });

  it("every allow-listed key exists and still says arbejdsområde", () => {
    for (const k of ALLOWED_ARBEJDSOMRAADE) {
      expect(labels[k], k).toMatch(ARBEJDSOMRAADE);
    }
  });

  it("the import dialog imports arbejdsbeskrivelser (documents)", () => {
    expect(labels["importSource.title"]).toBe("Importér arbejdsbeskrivelser");
    expect(labels["modal.import.chooseWorkArea"]).toBe(
      "(vælg arbejdsbeskrivelse)",
    );
  });

  it("the work-area type options use Molio's own spellings", () => {
    expect(labels["modal.editWorkSpec.typeArbejdsbeskrivelse"]).toBe(
      "Arbejdsbeskrivelse",
    );
    expect(labels["modal.editWorkSpec.typeFaellesBeskrivelse"]).toBe(
      "Fælles beskrivelse",
    );
    expect(
      labels["modal.editWorkSpec.typeParadigmeForArbejdsbeskrivelse"],
    ).toBe("Paradigme for arbejdsbeskrivelse");
  });

  it("has a warning for an unreadable reference-list date on every level, in both catalogues", () => {
    // ReferencePanel.tsx picks the key per level; the level type is
    // MolioReferencelistDateLevel in shared/ipc.ts.
    for (const level of ["project", "workArea", "bdb"]) {
      const key = `ref.referencelist.dateInvalid.${level}`;
      expect(key in da, key).toBe(true);
      expect(key in en, key).toBe(true);
    }
    // The old single text that always said "Ret den i Rediger projekt".
    expect("ref.referencelist.dateInvalid" in da).toBe(false);
  });
});
