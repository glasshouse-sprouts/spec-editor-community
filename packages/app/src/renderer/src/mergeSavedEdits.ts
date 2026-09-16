/**
 * mergeSavedEdits — stitch the edit buffer into the in-memory file
 * payload after a successful save, so the UI reflects the saved state
 * without having to reload the file from disk.
 *
 * Why this exists
 * ───────────────
 *
 * When the user presses ⌘S, the renderer ships the `edits` buffer to
 * main, main applies the edits to the SQLite file and reports success.
 * The renderer then clears the edits buffer. But the in-memory
 * `state.data` payload that powers the UI was populated when the file
 * was first opened — it still reflects the pre-save values.
 *
 * Reloading the file from disk on every save would be correct but
 * costly (re-render of the entire tree, lost scroll position, etc.).
 * Instead we fold the edits into the in-memory payload: one tiny
 * rewrite per edited row.
 *
 * What it covers
 * ──────────────
 *
 *   - Section bodies (workSpec / bdb) — sanitised once more as a hard
 *     fence before they land in memory.
 *   - Control-plan titles — replace the title string on the matching
 *     `ControlPlanInfo`.
 *   - Control-plan row cells — replace the field on the matching
 *     `ControlPlanRowData`. `controlType` is the only non-string column:
 *     the patch value is stringified, so we coerce back to number here.
 *   - Contract rename — merge contractCode / contractName onto the
 *     matching `ContractInfo`; untouched fields stay as they were.
 *   - Work-area → contract assignment — replace `contractId` on the
 *     matching `WorkSpecInfo`. `null` clears the link.
 *   - Work-area metadata (workAreaCode, workAreaName, workAreaType,
 *     revision, revisionDate, issueDate, createdBy, createdByOrg,
 *     reviewedBy, approvedBy) — Slice 10E.
 *   - BDB metadata (name, isPfbb, and all the nullable text columns
 *     above) — Slice 10E + 10H. `isPfbb` round-trips as 0/1 on the wire
 *     but is a boolean on `BdbInfo`, so we coerce at the boundary.
 *   - Control-plan metadata (revision, revisionDate) — Slice 10F.
 *   - Project metadata (name, projectNumber, builder,
 *     molioReferencelistDate) — Slice 10D. Note the typo-preserving
 *     mapping from the edit-key `molioReferencelistDate` to the
 *     ProjectInfo field `moliioReferencelistDate` (double-i).
 *
 * History
 * ───────
 *
 * Slice 10E originally wired metadata edits end-to-end through IPC to
 * disk, but forgot to extend this merge. The bug was invisible for
 * months because BDB / work-spec / CP metadata edits still showed the
 * *new* value inside open tabs (which read through `getEffective*` from
 * the edits buffer before save) — only the sidebar pill / icon layer
 * read `state.data.*` directly, and nothing in that layer depended on
 * a metadata field until Slice 10H added the PFBB pill. That smoke test
 * exposed the hole, which this module now closes.
 */

import type {
  ControlPlanRowData,
  CpRowEditableField,
  FilePayload,
  ProjectInfo,
  SectionData,
} from "../../shared/ipc.js";
import {
  getEffectiveBdbField,
  getEffectiveBody,
  getEffectiveContractCode,
  getEffectiveContractName,
  getEffectiveCpField,
  getEffectiveCpRowCell,
  getEffectiveCpTitle,
  getEffectiveProjectField,
  getEffectiveWorkSpecContract,
  getEffectiveWorkSpecField,
  hasEdits,
  isAnyCpRowCellEdited,
  isBdbMetadataEdited,
  isContractEdited,
  isCpMetadataEdited,
  isCpTitleEdited,
  isProjectEdited,
  isSectionEdited,
  isWorkSpecContractEdited,
  isWorkSpecMetadataEdited,
  type EditMap,
  type SectionKind,
} from "./edits.js";
import { sanitizeBody } from "./sanitizeBody.js";

/** All editable columns on a CP row. Kept next to `CpRowEditableField`. */
const CP_ROW_FIELDS: readonly CpRowEditableField[] = [
  "controlType",
  "sectionNo",
  "subject",
  "reference",
  "method",
  "quantity",
  "time",
  "acceptanceCriteria",
  "documentation",
  "controlLevel",
  "sampleLevel",
];

export function mergeSavedEdits(
  data: FilePayload,
  edits: EditMap,
): FilePayload {
  if (!hasEdits(edits)) return data;

  // Section bodies ──
  const applyBody = (kind: SectionKind, s: SectionData): SectionData => {
    if (!isSectionEdited(edits, kind, s.id)) return s;
    const newBody = sanitizeBody(getEffectiveBody(edits, kind, s.id, s.body));
    return newBody === s.body ? s : { ...s, body: newBody };
  };
  const rewriteSections = (
    m: Record<number, SectionData[]>,
    kind: SectionKind,
  ): Record<number, SectionData[]> => {
    const out: Record<number, SectionData[]> = {};
    for (const k of Object.keys(m)) {
      const id = Number(k);
      out[id] = m[id]!.map((s) => applyBody(kind, s));
    }
    return out;
  };

  // CP titles + metadata (Slice 10F) ──
  // Two independent patch kinds per CP: `cpTitle:<id>` and `cpMeta:<id>`.
  // Collapsed into one pass so we allocate a new row at most once.
  const controlPlans = data.controlPlans.map((cp) => {
    const titleEdited = isCpTitleEdited(edits, cp.id);
    const metaEdited = isCpMetadataEdited(edits, cp.id);
    if (!titleEdited && !metaEdited) return cp;

    let next = cp;
    if (titleEdited) {
      const newTitle = getEffectiveCpTitle(edits, cp.id, cp.title);
      if (newTitle !== cp.title) next = { ...next, title: newTitle };
    }
    if (metaEdited) {
      const newRevision = getEffectiveCpField(
        edits,
        cp.id,
        "revision",
        cp.revision,
      );
      const newRevisionDate = getEffectiveCpField(
        edits,
        cp.id,
        "revisionDate",
        cp.revisionDate,
      );
      // 10I-followup gap 2 — number_text is NOT NULL in the schema,
      // so disk values are always strings (possibly empty). The
      // patch helper returns `string | null`; coerce null → "" so
      // the local state stays type-consistent with the disk.
      const origNumber = cp.numberText ?? "";
      const newNumberRaw = getEffectiveCpField(
        edits,
        cp.id,
        "numberText",
        origNumber,
      );
      const newNumberText = newNumberRaw == null ? "" : newNumberRaw;
      if (
        newRevision !== cp.revision ||
        newRevisionDate !== cp.revisionDate ||
        newNumberText !== cp.numberText
      ) {
        next = {
          ...next,
          revision: newRevision,
          revisionDate: newRevisionDate,
          numberText: newNumberText,
        };
      }
    }
    return next;
  });

  // CP rows ──
  const applyRow = (row: ControlPlanRowData): ControlPlanRowData => {
    if (!isAnyCpRowCellEdited(edits, row.id)) return row;
    let next: ControlPlanRowData = row;
    for (const field of CP_ROW_FIELDS) {
      const original = String(row[field] ?? "");
      const effective = getEffectiveCpRowCell(edits, row.id, field, original);
      if (effective === original) continue;
      if (field === "controlType") {
        const n = Number(effective);
        if (Number.isFinite(n)) next = { ...next, controlType: n };
      } else {
        next = { ...next, [field]: effective };
      }
    }
    return next;
  };
  const rewriteRows = (
    m: Record<number, ControlPlanRowData[]>,
  ): Record<number, ControlPlanRowData[]> => {
    const out: Record<number, ControlPlanRowData[]> = {};
    for (const k of Object.keys(m)) {
      const id = Number(k);
      out[id] = m[id]!.map(applyRow);
    }
    return out;
  };

  // Contracts ──
  const contracts = data.contracts.map((c) => {
    if (!isContractEdited(edits, c.id)) return c;
    const newCode = getEffectiveContractCode(edits, c.id, c.contractCode);
    const newName = getEffectiveContractName(edits, c.id, c.contractName);
    if (newCode === c.contractCode && newName === c.contractName) return c;
    return { ...c, contractCode: newCode, contractName: newName };
  });

  // Work-area: contract assignment + metadata (Slice 10E) ──
  // Two independent patch kinds per work-spec: `wsContract:<id>` and
  // `wsMeta:<id>`. Handle both in one pass.
  const workSpecs = data.workSpecs.map((w) => {
    const contractEdited = isWorkSpecContractEdited(edits, w.id);
    const metaEdited = isWorkSpecMetadataEdited(edits, w.id);
    if (!contractEdited && !metaEdited) return w;

    let next = w;
    if (contractEdited) {
      const newContractId = getEffectiveWorkSpecContract(
        edits,
        w.id,
        w.contractId,
      );
      if (newContractId !== w.contractId) {
        next = { ...next, contractId: newContractId };
      }
    }
    if (metaEdited) {
      next = {
        ...next,
        workAreaCode: getEffectiveWorkSpecField(
          edits,
          w.id,
          "workAreaCode",
          w.workAreaCode,
        ) as string | null,
        workAreaName: getEffectiveWorkSpecField(
          edits,
          w.id,
          "workAreaName",
          w.workAreaName,
        ) as string,
        workAreaType: getEffectiveWorkSpecField(
          edits,
          w.id,
          "workAreaType",
          w.workAreaType,
        ) as number,
        revision: getEffectiveWorkSpecField(
          edits,
          w.id,
          "revision",
          w.revision,
        ) as string | null,
        revisionDate: getEffectiveWorkSpecField(
          edits,
          w.id,
          "revisionDate",
          w.revisionDate,
        ) as string | null,
        createdBy: getEffectiveWorkSpecField(
          edits,
          w.id,
          "createdBy",
          w.createdBy,
        ) as string | null,
        createdByOrganization: getEffectiveWorkSpecField(
          edits,
          w.id,
          "createdByOrganization",
          w.createdByOrganization,
        ) as string | null,
        issueDate: getEffectiveWorkSpecField(
          edits,
          w.id,
          "issueDate",
          w.issueDate,
        ) as string | null,
        reviewedBy: getEffectiveWorkSpecField(
          edits,
          w.id,
          "reviewedBy",
          w.reviewedBy,
        ) as string | null,
        approvedBy: getEffectiveWorkSpecField(
          edits,
          w.id,
          "approvedBy",
          w.approvedBy,
        ) as string | null,
      };
    }
    return next;
  });

  // BDB metadata (Slice 10E + isPfbb for 10H) ──
  // `isPfbb` is stored as 0/1 in the edit buffer and on the wire to main,
  // but BdbInfo.isPfbb is a boolean. Coerce at this boundary so the rest
  // of the renderer can keep treating it as a boolean.
  const bdbs = data.bdbs.map((b) => {
    if (!isBdbMetadataEdited(edits, b.id)) return b;

    const newIsPfbbNum = getEffectiveBdbField(
      edits,
      b.id,
      "isPfbb",
      b.isPfbb ? 1 : 0,
    ) as number;

    return {
      ...b,
      name: getEffectiveBdbField(edits, b.id, "name", b.name) as string,
      isPfbb: newIsPfbbNum === 1,
      revision: getEffectiveBdbField(edits, b.id, "revision", b.revision) as
        | string
        | null,
      revisionDate: getEffectiveBdbField(
        edits,
        b.id,
        "revisionDate",
        b.revisionDate,
      ) as string | null,
      createdBy: getEffectiveBdbField(edits, b.id, "createdBy", b.createdBy) as
        | string
        | null,
      createdByOrganization: getEffectiveBdbField(
        edits,
        b.id,
        "createdByOrganization",
        b.createdByOrganization,
      ) as string | null,
      issueDate: getEffectiveBdbField(edits, b.id, "issueDate", b.issueDate) as
        | string
        | null,
      reviewedBy: getEffectiveBdbField(
        edits,
        b.id,
        "reviewedBy",
        b.reviewedBy,
      ) as string | null,
      approvedBy: getEffectiveBdbField(
        edits,
        b.id,
        "approvedBy",
        b.approvedBy,
      ) as string | null,
    };
  });

  // Project metadata (Slice 10D) ──
  // The editable key "molioReferencelistDate" maps to the ProjectInfo
  // field "moliioReferencelistDate" (note the schema's double-i typo,
  // preserved for historical compatibility with existing files).
  let project: ProjectInfo | null = data.project;
  if (project && isProjectEdited(edits)) {
    const p = project;
    project = {
      ...p,
      name:
        (getEffectiveProjectField(edits, "name", p.name) as string) ?? p.name,
      projectNumber:
        (getEffectiveProjectField(
          edits,
          "projectNumber",
          p.projectNumber,
        ) as string) ?? p.projectNumber,
      builder: getEffectiveProjectField(edits, "builder", p.builder) as
        | string
        | null,
      moliioReferencelistDate: getEffectiveProjectField(
        edits,
        "molioReferencelistDate",
        p.moliioReferencelistDate,
      ) as string | null,
    };
  }

  return {
    ...data,
    project,
    sectionsByWorkSpec: rewriteSections(data.sectionsByWorkSpec, "workSpec"),
    sectionsByBdb: rewriteSections(data.sectionsByBdb, "bdb"),
    controlPlans,
    cpRowsByPlan: rewriteRows(data.cpRowsByPlan),
    contracts,
    workSpecs,
    bdbs,
  };
}
