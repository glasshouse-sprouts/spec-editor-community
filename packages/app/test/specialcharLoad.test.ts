/** @vitest-environment jsdom */

/**
 * Card 195 - Molio's `<specialchar>` survives loading as the symbol it
 * stands for.
 *
 * Every body goes through `sanitizeLoadedFile` (and so `sanitizeBody`)
 * when a file is opened, and Molio's reference texts go through
 * `sanitizeBody` too. Before this card the tag was dropped and the
 * plain letter kept: "µm" was shown, and later saved, as "mm".
 *
 * The HTML is copied from Molio's own content, found on 2026-11-03
 * (card 195 has the table). DOMPurify writes named entities back as
 * characters, so the expected strings use ≥ and ø where Molio wrote
 * `&ge;` and `&oslash;`.
 */
import { describe, expect, it } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import { sanitizeBody } from "../src/renderer/src/sanitizeBody.js";
import { sanitizeLoadedFile } from "../src/renderer/src/sanitizeLoadedFile.js";

/** [what, Molio's HTML, what the editor must show] */
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
    "<table><tbody><tr><td>Duktilitetε<sub>uk</sub> ≥ (%)</td><td></td></tr></tbody></table>",
  ],
  [
    "h = η (S201.01 basis, Afstivning og indfatning)",
    "<p>den effektive faldh&oslash;jde ( <specialchar>h</specialchar>h )</p>",
    "<p>den effektive faldhøjde ( ηh )</p>",
  ],
  [
    "specialChar with a capital C (S245.01 basis, Lakering)",
    "<p>min. 50 <specialChar>m</specialChar>m max. 120 <specialChar>m</specialChar>m</p>",
    "<p>min. 50 µm max. 120 µm</p>",
  ],
  [
    "an entity that already is the symbol, and an empty tag (S236.01)",
    "<ul><li>Maksimal varmeledningsevne <specialchar></specialchar><specialchar>&lambda;</specialchar><sub>deklareret</sub> i W/mK</li></ul>",
    "<ul><li>Maksimal varmeledningsevne λ<sub>deklareret</sub> i W/mK</li></ul>",
  ],
];

function payloadWith(body: string): FilePayload {
  const section = {
    id: 1,
    body,
  } as FilePayload["sectionsByBdb"][number][number];
  return {
    sectionsByWorkSpec: {},
    sectionsByBdb: { 7: [section] },
  } as unknown as FilePayload;
}

const loadedBody = (body: string) =>
  sanitizeLoadedFile(payloadWith(body)).sectionsByBdb[7]![0]!.body;

describe("card 195 - <specialchar> when a file is opened", () => {
  it.each(FOUND_IN_MOLIO)("%s", (_what, molio, expected) => {
    expect(loadedBody(molio)).toBe(expected);
  });

  it("keeps an unknown symbol visible, marked [?]", () => {
    expect(loadedBody("<p>x <specialchar>@</specialchar></p>")).toBe(
      "<p>x @[?]</p>",
    );
  });

  it("is idempotent: opening, saving and opening again changes nothing more", () => {
    for (const [, molio] of FOUND_IN_MOLIO) {
      const once = loadedBody(molio);
      expect(loadedBody(once)).toBe(once);
      expect(sanitizeBody(once)).toBe(once);
    }
    const marked = loadedBody("<p><specialchar>@</specialchar></p>");
    expect(loadedBody(marked)).toBe(marked);
  });
});
