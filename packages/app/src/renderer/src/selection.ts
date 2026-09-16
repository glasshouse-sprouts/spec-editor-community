/**
 * Selection state for the project tree.
 *
 * One of: nothing selected, project root, a work spec, a BDB, or a control
 * plan. Kept in a single discriminated union so the main pane can switch on
 * `.kind` and render the right view.
 */

export type Selection =
  | { kind: "none" }
  | { kind: "project" }
  | { kind: "workSpec"; id: number }
  | { kind: "bdb"; id: number }
  | { kind: "controlPlan"; id: number };
