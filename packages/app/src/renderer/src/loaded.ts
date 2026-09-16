/**
 * Helpers that resolve a row id back to its FilePayload entity.
 *
 * Slice #233 DRY pass — the renderer had 56 occurrences of
 * `data.<entity>.find(x => x.id === id)` across App.tsx, MainPane,
 * ExportCard, TabBar, Sidebar, and a few modal files. Five named
 * helpers are easier to grep / refactor / cache later than the
 * inline `.find` pattern.
 *
 * No memoised id-Map yet — premature. Linear scan over a few
 * hundred entries is the right cost-perf trade today; if a
 * profiler later shows it's hot, swap the implementation in here
 * without touching call sites.
 */

import type {
  AttachmentInfo,
  BdbInfo,
  ContractInfo,
  ControlPlanInfo,
  FilePayload,
  WorkSpecInfo,
} from "../../shared/ipc.js";

export function findBdbById(
  data: FilePayload,
  id: number,
): BdbInfo | undefined {
  return data.bdbs.find((b) => b.id === id);
}

export function findWorkSpecById(
  data: FilePayload,
  id: number,
): WorkSpecInfo | undefined {
  return data.workSpecs.find((w) => w.id === id);
}

export function findControlPlanById(
  data: FilePayload,
  id: number,
): ControlPlanInfo | undefined {
  return data.controlPlans.find((c) => c.id === id);
}

export function findContractById(
  data: FilePayload,
  id: number,
): ContractInfo | undefined {
  return data.contracts.find((c) => c.id === id);
}

export function findAttachmentById(
  data: FilePayload,
  id: number,
): AttachmentInfo | undefined {
  return data.attachments.find((a) => a.id === id);
}
