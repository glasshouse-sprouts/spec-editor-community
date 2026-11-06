/**
 * Card 195 - Molio's `<specialchar>` survives core's sanitizer as the
 * symbol it stands for, on the write path (`applyEdits`) too.
 *
 * The HTML below is copied from Molio's own content, found on
 * 2026-11-03 (card 195 has the full table): the .moliospec files of
 * S245.01 R00/R01, S230.01 R00-R02 and S210.01/S210.02 R00, and the
 * basis/vejledning texts of S201.01, S236.01 and S245.01 from Molio's
 * API. Before this card each of them lost the symbol and kept the
 * plain letter.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyEdits,
  openMoliospec,
  readMoliospec,
  sanitizeSectionBody,
} from "../src/index.js";
import {
  SYMBOL_FONT_CHARS,
  UNKNOWN_SYMBOL_MARK,
  translateSymbolFontChars,
} from "../src/symbolFontChars.js";
import { findAllSamples } from "./samples.js";

/** [what, Molio's HTML, what core must write] */
const FOUND_IN_MOLIO: Array<[string, string, string]> = [
  [
    "m = µ (S245.01 R00/R01, 3 Lakering)",
    "<p>Lagtykkelse: &lt;x&gt; <specialchar>m</specialchar>m</p>",
    "<p>Lagtykkelse: &lt;x&gt; µm</p>",
  ],
  [
    "l = λ (S230.01 R00-R02, 9 Isoleringsmateriale)",
    "<p>varmeledningsevne <specialchar>l</specialchar><sub>deklareret</sub>: &lt;x&gt; W/mK</p>",
    "<p>varmeledningsevne λ<sub>deklareret</sub>: &lt;x&gt; W/mK</p>",
  ],
  [
    "e = ε (S210.01/S210.02 R00, 2 Spændarmering)",
    "<table><tbody><tr><td>Duktilitet<specialchar>e</specialchar><sub>uk</sub> &ge; (%)</td><td></td></tr></tbody></table>",
    "<table><tbody><tr><td>Duktilitetε<sub>uk</sub> &ge; (%)</td><td></td></tr></tbody></table>",
  ],
  [
    "h = η (S201.01 basis, Afstivning og indfatning)",
    "<p>den effektive faldh&oslash;jde ( <specialchar>h</specialchar>h )</p>",
    "<p>den effektive faldh&oslash;jde ( ηh )</p>",
  ],
  [
    "specialChar with a capital C (S245.01 basis, Lakering)",
    "<p>min. 50 <specialChar>m</specialChar>m max. 120 <specialChar>m</specialChar>m</p>",
    "<p>min. 50 µm max. 120 µm</p>",
  ],
  [
    "an entity that already is the symbol, and an empty tag (S236.01)",
    "<li>Maksimal varmeledningsevne <specialchar></specialchar><specialchar>&lambda;</specialchar><sub>deklareret&nbsp;</sub>i W/mK</li>",
    "<li>Maksimal varmeledningsevne &lambda;<sub>deklareret&nbsp;</sub>i W/mK</li>",
  ],
];

describe("card 195 - <specialchar> in core's sanitizer", () => {
  it.each(FOUND_IN_MOLIO)("%s", (_what, molio, expected) => {
    expect(sanitizeSectionBody(molio)).toBe(expected);
  });

  it("writes µ as MICRO SIGN U+00B5", () => {
    expect(SYMBOL_FONT_CHARS["m"]).toBe("µ");
    expect(sanitizeSectionBody("<specialchar>m</specialchar>m")).toBe("µm");
  });

  it("keeps an unknown symbol visible, marked [?]", () => {
    expect(UNKNOWN_SYMBOL_MARK).toBe("[?]");
    expect(sanitizeSectionBody("<p>x <specialchar>@</specialchar></p>")).toBe(
      "<p>x @[?]</p>",
    );
    expect(sanitizeSectionBody("<specialchar>ab</specialchar>")).toBe("ab[?]");
    // An already translated symbol is not marked.
    expect(sanitizeSectionBody("<specialchar>λ</specialchar>")).toBe("λ");
  });

  it("is idempotent: sanitizing twice gives the same body", () => {
    const all = [
      ...FOUND_IN_MOLIO.map(([, molio]) => molio),
      "<p><specialchar>@</specialchar> <specialchar>q</specialchar></p>",
    ];
    for (const molio of all) {
      const once = sanitizeSectionBody(molio);
      expect(sanitizeSectionBody(once)).toBe(once);
      expect(translateSymbolFontChars(once)).toBe(once);
    }
  });
});

describe("card 195 - the write path through applyEdits", () => {
  const showoff = findAllSamples().find((s) =>
    s.label.toLowerCase().includes("showoff"),
  );
  let workDir = "";
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-specialchar-"));
  });
  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("saves <specialchar>m</specialchar>m as µm", async () => {
    expect(showoff).toBeDefined();
    const h = await openMoliospec(showoff!.path);
    const section = readMoliospec(h).constructionElementSpecSections[0]!;
    applyEdits(h, [
      { target: "bdb", sectionId: section.id, body: FOUND_IN_MOLIO[0]![1] },
    ]);
    const out = join(workDir, "specialchar.moliospec");
    await h.saveAs(out);
    await h.close();
    const reopened = await openMoliospec(out);
    try {
      const body = readMoliospec(reopened).constructionElementSpecSections.find(
        (s) => s.id === section.id,
      )!.body;
      expect(body).toBe(FOUND_IN_MOLIO[0]![2]);
    } finally {
      await reopened.close();
    }
  });
});
