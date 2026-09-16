/**
 * PFBB migration banner (Slice 10H.6b).
 *
 * Shown once-per-open at the top of the main pane when the currently
 * loaded `.moliospec` has PFBB masters (`is_pfbb=1`, `pfbb_id` null)
 * sitting in regular work areas instead of the virtual
 * "Projektfælles bygningsdelsbeskrivelser" work_spec.
 *
 * This component is purely presentational — all detection, IPC, and
 * state handling live in `App.tsx`. The copy is English for now
 * (translation pass comes in a later phase).
 */
import type { JSX } from "react";

import { summarizeSourceWorkAreaNames } from "./pfbbMigration.js";

export interface PfbbMigrationBannerProps {
  /** How many orphan masters were detected. Must be > 0 to render. */
  orphanCount: number;
  /** Distinct work-area names the orphans live in (already deduped + sorted). */
  sourceWorkAreaNames: string[];
  /** User clicked "Move them now". */
  onMigrate: () => void;
  /** User clicked "Not now" (dismiss for this project/session). */
  onDismiss: () => void;
  /** While the move is in flight, both buttons are disabled. */
  isMigrating: boolean;
}

export function PfbbMigrationBanner(
  props: PfbbMigrationBannerProps,
): JSX.Element | null {
  const {
    orphanCount,
    sourceWorkAreaNames,
    onMigrate,
    onDismiss,
    isMigrating,
  } = props;

  if (orphanCount <= 0) return null;

  const plural = orphanCount === 1 ? "master" : "masters";
  const areaPlural = sourceWorkAreaNames.length === 1 ? "area" : "areas";
  const namesList = summarizeSourceWorkAreaNames(sourceWorkAreaNames);

  return (
    <div
      className="pfbb-migration-banner"
      role="status"
      aria-live="polite"
      data-testid="pfbb-migration-banner"
    >
      <div className="pfbb-migration-banner__body">
        <div className="pfbb-migration-banner__title">
          Non-standard PFBB placement detected
        </div>
        <div className="pfbb-migration-banner__text">
          {orphanCount} PFBB {plural} in this project{" "}
          {orphanCount === 1 ? "lives" : "live"} in regular work {areaPlural}
          {namesList ? <>: {namesList}</> : null}. The Molio convention expects
          them in the shared{" "}
          <em>&lsquo;Projektfælles bygningsdelsbeskrivelser&rsquo;</em> work
          area.
        </div>
        <div className="pfbb-migration-banner__hint">
          Moving only changes each master&rsquo;s work-area link. Nothing is
          deleted, and child (subscriber) BDBs keep working.
        </div>
      </div>
      <div className="pfbb-migration-banner__actions">
        <button
          type="button"
          className="pfbb-migration-banner__btn pfbb-migration-banner__btn--primary"
          onClick={onMigrate}
          disabled={isMigrating}
          data-testid="pfbb-migration-banner-move"
        >
          {isMigrating ? "Moving…" : "Move them now"}
        </button>
        <button
          type="button"
          className="pfbb-migration-banner__btn pfbb-migration-banner__btn--secondary"
          onClick={onDismiss}
          disabled={isMigrating}
          data-testid="pfbb-migration-banner-dismiss"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
