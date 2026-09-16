/**
 * Project-tab "Forside" card (#249 COVER, Skive 4a-2).
 *
 * Entry point to the in-app cover editor. This file is KEPT in Community
 * (it only talks to the cover seam, never imports cover/), but renders
 * nothing there: the cover engine's no-op default reports `enabled:
 * false`, so the card returns null. In Glasshouse the stateful provider
 * supplies the real engine and the card shows up next to the Export card.
 */

import { useCoverEngine } from "./coverContext.js";

export function CoverCard(): JSX.Element | null {
  const cover = useCoverEngine();
  if (!cover.enabled) return null;

  const active = cover.activeTemplateLabel;
  return (
    <section className="export-card" aria-labelledby="cover-card-title">
      <div className="export-card__header">
        <h3 id="cover-card-title">Forside</h3>
      </div>
      <div className="export-card__body">
        <p className="hint">
          {active ??
            "Ingen custom forside valgt — eksport bruger standardforsiden."}
        </p>
        <div className="export-card__actions">
          <button
            type="button"
            className="export-card__button"
            onClick={cover.openEditor}
          >
            Rediger forside…
          </button>
        </div>
      </div>
    </section>
  );
}
