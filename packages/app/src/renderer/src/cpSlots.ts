/**
 * Pure helpers for the control-plan lifecycle UI (Slice 6H — #40, Wave D).
 *
 * The core enforces that each BDB may have at most one "design" and one
 * "production" control plan (see the schema's
 * `controlplan_design_id` / `controlplan_production_id` columns).
 * Attempting to create a second one in the same slot rolls back, so the
 * UI pre-filters the slot picker here to avoid a guaranteed-fail click.
 *
 * The helpers are DOM-free so tests can render them without jsdom.
 */

import type { BdbInfo } from "../../shared/ipc.js";

/** Which slots on this BDB are still free? */
export interface SlotAvailability {
  design: boolean;
  production: boolean;
}

/**
 * The BDB's control-plan IDs come from `BdbInfo.controlPlanIds` — the
 * renderer already receives them in `[design, production]` order when
 * both exist. The two underlying columns are nullable, so the array
 * length tells us how many slots are taken:
 *
 *   - length 0 → both slots free
 *   - length 1 → design filled, production free (main sorts this way)
 *   - length 2 → both filled
 *
 * This mirrors how `groupBdbsByControlPlan` already interprets the
 * column layout, so we don't have to pipe the raw id columns through
 * a second time.
 */
export function availableSlots(bdb: BdbInfo): SlotAvailability {
  const filled = bdb.controlPlanIds.length;
  // `controlPlanIds` is packed [design, production] when both are
  // present; a single entry in design is main's canonical shape for
  // "design only". The core reports empty slots as absent ids rather
  // than nulls in the array.
  return {
    design: filled < 1,
    production: filled < 2,
  };
}

/** True if any slot is still open. */
export function hasFreeSlot(bdb: BdbInfo): boolean {
  const s = availableSlots(bdb);
  return s.design || s.production;
}

/**
 * True if the row has any non-empty content in the visible columns.
 * Used to decide whether the Delete Row confirm dialog should warn the
 * user that they're about to discard actual data (vs. a blank placeholder
 * row they probably added by mistake).
 */
export function rowHasContent(row: {
  controlType: number;
  sectionNo: string;
  subject: string;
  reference: string;
  method: string;
  quantity: string;
  time: string;
  acceptanceCriteria: string;
  documentation: string;
  controlLevel: string;
  sampleLevel: string;
}): boolean {
  if (row.controlType !== 0) return true;
  const texts = [
    row.sectionNo,
    row.subject,
    row.reference,
    row.method,
    row.quantity,
    row.time,
    row.acceptanceCriteria,
    row.documentation,
    row.controlLevel,
    row.sampleLevel,
  ];
  return texts.some((s) => s != null && s.trim().length > 0);
}
