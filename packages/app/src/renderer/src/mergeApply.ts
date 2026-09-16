/**
 * RELOAD-Merge M4 — turn the resolved merge into an edit buffer.
 *
 * After the user resolves conflicts in the Merge dialog, M5 calls
 * `buildMergedEditMap` with the winning units (auto-applied units +
 * the conflicts kept "mine"). It folds each winner through the
 * normal `edits.ts` setters, producing the `EditMap` the editor
 * uses for unsaved edits.
 *
 * The new base is the disk version (M5 sets `state.data = disk`), so
 * every setter's `originalValue` is the disk value — that's `unit.theirs`,
 * which the merge brain already captured. The setters only use
 * `originalValue` for revert-detection, and for a winning unit
 * `mine !== theirs` always holds, so every winner produces a real
 * patch.
 *
 * Pure: data in, EditMap out. See mergeApply.test.ts.
 */

import type { EditRequest, FilePayload } from "../../shared/ipc.js";
import {
  EMPTY_EDITS,
  setBdbField,
  setContractCode,
  setContractName,
  setCpField,
  setCpHeaderField,
  setCpRowCell,
  setCpTitle,
  setProjectField,
  setSectionBody,
  setWorkSpecContract,
  setWorkSpecField,
  type BdbEditableField,
  type CpEditableField,
  type CpHeaderEditableField,
  type EditMap,
  type ProjectEditableField,
  type WorkSpecEditableField,
} from "./edits.js";
import type { MergeUnit } from "./mergeOnReload.js";

/** Identity-key names that are NOT a metadata edit's data field. */
const META_ID_KEYS = ["target", "id", "projectGuid", "headerId", "workSpecId"];

/**
 * RELOAD-Merge "edit a merged draft" — return a copy of `unit` whose
 * value is replaced by `value` (the user's hand-edited draft). Used
 * when a conflict is resolved to a custom merged version rather than
 * a straight keep-mine / keep-theirs.
 */
export function withMergedValue(unit: MergeUnit, value: string): MergeUnit {
  const e = unit.edit;
  let edit: EditRequest;
  switch (e.target) {
    case "workSpec":
    case "bdb":
      edit = { ...e, body: value };
      break;
    case "cpTitle":
      edit = { ...e, title: value };
      break;
    case "cpRow":
      edit = { ...e, value };
      break;
    default: {
      // A single-field metadata edit — replace its one data field.
      const obj: Record<string, unknown> = {
        ...(e as unknown as Record<string, unknown>),
      };
      for (const k of Object.keys(obj)) {
        if (!META_ID_KEYS.includes(k)) obj[k] = value;
      }
      edit = obj as unknown as EditRequest;
      break;
    }
  }
  return { ...unit, edit, mine: value };
}

/**
 * Extract the single data field from a one-field metadata edit (M1
 * produces one MergeUnit, hence one single-field edit, per field).
 * Returns the field name + its (original-typed) value, or null.
 */
function metaField(
  edit: EditRequest,
  idKeys: readonly string[],
): { key: string; value: unknown } | null {
  const obj = edit as unknown as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === "target" || idKeys.includes(k)) continue;
    return { key: k, value: obj[k] };
  }
  return null;
}

/**
 * Fold the winning merge units into an `EditMap`. `disk` is the
 * version being adopted as the new base — used only to look up the
 * disk-side value where a setter needs a typed `originalValue` that
 * `unit.theirs` (a display string) can't supply.
 */
export function buildMergedEditMap(
  winners: MergeUnit[],
  disk: FilePayload,
): EditMap {
  let map: EditMap = EMPTY_EDITS;

  for (const u of winners) {
    const e = u.edit;
    switch (e.target) {
      case "workSpec":
      case "bdb":
        map = setSectionBody(map, e.target, e.sectionId, e.body, u.theirs);
        break;
      case "cpTitle":
        map = setCpTitle(map, e.controlPlanId, e.title, u.theirs);
        break;
      case "cpRow":
        map = setCpRowCell(map, e.rowId, e.field, e.value, u.theirs);
        break;
      case "contractRename":
        if (e.contractCode !== undefined) {
          map = setContractCode(map, e.id, e.contractCode, u.theirs);
        }
        if (e.contractName !== undefined) {
          map = setContractName(map, e.id, e.contractName, u.theirs);
        }
        break;
      case "workSpecContract": {
        // setWorkSpecContract needs a typed (number|null) original —
        // u.theirs is a display string, so look the disk value up.
        const diskWs = disk.workSpecs.find((w) => w.id === e.workSpecId);
        map = setWorkSpecContract(
          map,
          e.workSpecId,
          e.contractId,
          diskWs?.contractId ?? null,
        );
        break;
      }
      case "project": {
        const f = metaField(e, ["projectGuid"]);
        if (f) {
          map = setProjectField(
            map,
            e.projectGuid,
            f.key as ProjectEditableField,
            f.value as string | null,
            u.theirs,
          );
        }
        break;
      }
      case "workSpecMetadata": {
        const f = metaField(e, ["id"]);
        if (f) {
          map = setWorkSpecField(
            map,
            e.id,
            f.key as WorkSpecEditableField,
            f.value as string | number | null,
            u.theirs,
          );
        }
        break;
      }
      case "bdbMetadata": {
        const f = metaField(e, ["id"]);
        if (f) {
          map = setBdbField(
            map,
            e.id,
            f.key as BdbEditableField,
            f.value as string | number | null,
            u.theirs,
          );
        }
        break;
      }
      case "cpMetadata": {
        const f = metaField(e, ["id"]);
        if (f) {
          map = setCpField(
            map,
            e.id,
            f.key as CpEditableField,
            f.value as string | null,
            u.theirs,
          );
        }
        break;
      }
      case "cpHeaderUpdate": {
        const f = metaField(e, ["headerId"]);
        if (f) {
          map = setCpHeaderField(
            map,
            e.headerId,
            f.key as CpHeaderEditableField,
            String(f.value ?? ""),
            u.theirs,
          );
        }
        break;
      }
      default:
        // Structural targets never reach a winning unit (the merge
        // would have been blocked). Ignore defensively.
        break;
    }
  }

  return map;
}
