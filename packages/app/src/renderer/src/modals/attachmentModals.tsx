/**
 * Attachment modals — extracted from App.tsx in slice #233.
 *
 *   - AttachmentsDialogError  — error union shared by all 5 dialogs
 *   - AttachmentsModal        — per-work-area attachments management
 *   - GlobalAttachmentsModal  — project-wide attachments overview
 *   - RenameAttachmentModal   — rename one attachment
 *   - ConfirmDeleteAttachmentModal
 *   - MoveAttachmentModal     — reassign attachment to a different work area
 *
 * Stateless components — dialog state lives in App.tsx; here we just
 * render and report changes.
 */

import { RefreshCw as ReplaceIcon, Trash2 as TrashIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_ATTACHMENT_BYTES,
  type AttachmentInfo,
  type ContractInfo,
  type WorkSpecInfo,
} from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
import { danishCollator } from "../sortHelpers.js";
import { contractLabel } from "./contractModals.js";
import { DialogError } from "./DialogError.js";
import { useEscToClose } from "./useEscToClose.js";

export type AttachmentsDialogError =
  | { kind: "dirty" }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "too-large"; maxBytes: number; actualBytes: number }
  /**
   * An attachment with identical bytes already exists somewhere in
   * the project. Molio enforces content-addressed storage: each byte
   * payload can appear only once. We surface the existing row's name
   * + its work-area label so the user knows where the duplicate
   * lives and can pick a different file.
   */
  | {
      kind: "duplicate";
      existingName: string;
      existingWorkSpecLabel: string;
    }
  | { kind: "other"; message: string };

export function AttachmentsModal({
  dialog,
  rows,
  onCancel,
  onPickFile,
  onChangeType,
  onConfirmAdd,
  onDelete,
  onReplace,
}: {
  dialog: {
    workSpecId: number;
    workSpecLabel: string;
    pending: { file: File; attachmentTypeId: 1 | 2 } | null;
    saving: boolean;
    error: AttachmentsDialogError | null;
  };
  rows: AttachmentInfo[];
  onCancel: () => void;
  onPickFile: (file: File | null) => void;
  onChangeType: (t: 1 | 2) => void;
  onConfirmAdd: () => void;
  onDelete: (attachmentId: number) => void;
  onReplace: (attachmentId: number, file: File) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRefs = useRef<Map<number, HTMLInputElement | null>>(
    new Map(),
  );

  // Human-readable byte count: 1 decimal past kB, integer at MB.
  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const attachmentTypeLabel = (id: number): string => {
    if (id === 1) return t("attachment.type.bilag");
    if (id === 2) return t("attachment.type.graensefladeskema");
    return t("attachment.type.unknown", { id });
  };

  const canAdd = dialog.pending !== null && !dialog.saving;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachments-title"
    >
      <div className="modal modal--xl">
        <h2 id="attachments-title" className="modal__title">
          {t("modal.attachments.title", {
            workSpecLabel: dialog.workSpecLabel,
          })}
        </h2>
        <p className="modal__body">
          {t("modal.attachments.body", {
            maxSize: formatBytes(MAX_ATTACHMENT_BYTES),
          })}
        </p>

        {/* Existing rows */}
        <div className="modal__body">
          {rows.length === 0 ? (
            <p style={{ opacity: 0.7, fontStyle: "italic" }}>
              {t("modal.attachments.empty")}
            </p>
          ) : (
            <table className="attachments-table">
              {/* Fixed column widths so "Type", "Size" and "Actions"
               * don't jump around when a filename changes length.
               * The Name column has no explicit width — it absorbs
               * remaining space and ellipsises long filenames. */}
              <colgroup>
                <col />
                <col style={{ width: 160 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t("modal.attachments.colName")}</th>
                  <th>{t("modal.attachments.colType")}</th>
                  <th className="attachments-table__col--right">
                    {t("modal.attachments.colSize")}
                  </th>
                  <th className="attachments-table__col--right">
                    {t("modal.attachments.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="attachments-table__name" title={row.name}>
                      {row.name}
                    </td>
                    <td>{attachmentTypeLabel(row.attachmentTypeId)}</td>
                    <td className="attachments-table__col--right">
                      {formatBytes(row.byteLength)}
                    </td>
                    <td className="attachments-table__col--right">
                      <input
                        ref={(el) => {
                          replaceInputRefs.current.set(row.id, el);
                        }}
                        type="file"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onReplace(row.id, f);
                          e.target.value = "";
                        }}
                      />
                      <div className="attachments-table__actions">
                        <button
                          type="button"
                          className="icon-button"
                          disabled={dialog.saving}
                          title={t("modal.attachments.replaceTitle")}
                          aria-label={t("modal.attachments.replaceAriaLabel", {
                            name: row.name,
                          })}
                          onClick={() =>
                            replaceInputRefs.current.get(row.id)?.click()
                          }
                        >
                          <ReplaceIcon size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          disabled={dialog.saving}
                          title={t("common.delete")}
                          aria-label={t("modal.attachments.deleteAriaLabel", {
                            name: row.name,
                          })}
                          onClick={() => onDelete(row.id)}
                        >
                          <TrashIcon size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add-new form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canAdd) onConfirmAdd();
          }}
        >
          <div className="meta-modal__grid">
            <label className="modal__field meta-modal__field--wide">
              <span className="modal__field-label">
                {t("modal.attachments.addFileLabel")}
              </span>
              <input
                ref={addInputRef}
                type="file"
                className="modal__input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  onPickFile(f ?? null);
                }}
                disabled={dialog.saving}
              />
            </label>
            <fieldset
              className="modal__field"
              style={{ border: "none", padding: 0, margin: 0 }}
            >
              <span className="modal__field-label">
                {t("modal.attachments.attachmentTypeLabel")}
              </span>
              <label style={{ marginRight: 12 }}>
                <input
                  type="radio"
                  name="attachment-type"
                  checked={
                    dialog.pending
                      ? dialog.pending.attachmentTypeId === 1
                      : true
                  }
                  onChange={() => onChangeType(1)}
                  disabled={dialog.saving || dialog.pending === null}
                />{" "}
                {t("attachment.type.bilag")}
              </label>
              <label>
                <input
                  type="radio"
                  name="attachment-type"
                  checked={
                    dialog.pending
                      ? dialog.pending.attachmentTypeId === 2
                      : false
                  }
                  onChange={() => onChangeType(2)}
                  disabled={dialog.saving || dialog.pending === null}
                />{" "}
                {t("attachment.type.graensefladeskema")}
              </label>
            </fieldset>
          </div>

          <DialogError
            error={dialog.error}
            otherPrefix={t("modal.attachments.errorPrefix")}
            copy={{
              missing: t("modal.attachments.errorMissing"),
            }}
            extra={(e) => {
              if (e.kind === "too-large") {
                return t("modal.attachments.errorTooLarge", {
                  actualMb: (e.actualBytes / (1024 * 1024)).toFixed(1),
                  maxMb: (e.maxBytes / (1024 * 1024)).toFixed(0),
                });
              }
              if (e.kind === "duplicate") {
                return t("modal.attachments.errorDuplicate", {
                  existingName: e.existingName,
                  existingWorkSpecLabel: e.existingWorkSpecLabel,
                });
              }
              return null;
            }}
          />

          <div className="modal__actions">
            <button
              type="button"
              className="modal__button"
              onClick={onCancel}
              disabled={dialog.saving}
            >
              {t("common.close")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={!canAdd}
            >
              {dialog.saving
                ? t("modal.attachments.uploading")
                : t("modal.attachments.addButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function GlobalAttachmentsModal({
  dialog,
  rows,
  workSpecs,
  contracts,
  effectiveContractCodeFor,
  effectiveContractNameFor,
  effectiveWorkSpecContractFor,
  onCancel,
  onDelete,
  onGoToWorkSpec,
  onMove,
}: {
  dialog: {
    saving: boolean;
    savingId: number | null;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  rows: AttachmentInfo[];
  workSpecs: WorkSpecInfo[];
  contracts: ContractInfo[];
  effectiveContractCodeFor: (id: number, orig: string | null) => string | null;
  effectiveContractNameFor: (id: number, orig: string | null) => string | null;
  effectiveWorkSpecContractFor: (
    wsId: number,
    orig: number | null,
  ) => number | null;
  onCancel: () => void;
  onDelete: (attachmentId: number) => void;
  onGoToWorkSpec: (workSpecId: number) => void;
  /** Slice 10K.8 — "Move…" opens the MoveAttachmentModal seeded with
   *  this row's id. No-op for orphaned attachments (no current parent
   *  to move from). */
  onMove: (attachmentId: number) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  // Lookup maps for O(1) parent resolution per row.
  const wsById = new Map<number, WorkSpecInfo>(workSpecs.map((w) => [w.id, w]));
  const contractById = new Map<number, ContractInfo>(
    contracts.map((c) => [c.id, c]),
  );

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const attachmentTypeLabel = (id: number): string => {
    if (id === 1) return t("attachment.type.bilag");
    if (id === 2) return t("attachment.type.graensefladeskema");
    return t("attachment.type.unknown", { id });
  };

  // Parent resolution for one attachment row. Returns a display-ready
  // breadcrumb plus the work area id (or null for orphans — no Go-to
  // action).
  function resolveParent(att: AttachmentInfo): {
    breadcrumb: string;
    workSpecId: number | null;
  } {
    // Per the Molio 2.0 schema, AttachmentInfo.workSpecId is a FK to
    // `work_spec(id)` — the work area. If the work area is missing from
    // the reload payload (deleted), the row shows as "(unlinked)".
    const ws = wsById.get(att.workSpecId);
    if (!ws) {
      return {
        breadcrumb: t("modal.globalAttachments.unlinked"),
        workSpecId: null,
      };
    }
    const wsLabel = ws.workAreaCode
      ? `${ws.workAreaCode} – ${ws.workAreaName}`
      : ws.workAreaName;
    const effectiveContractId = effectiveWorkSpecContractFor(
      ws.id,
      ws.contractId,
    );
    const contract =
      effectiveContractId != null
        ? contractById.get(effectiveContractId)
        : null;
    const contractLabelStr = contract
      ? (() => {
          const code = effectiveContractCodeFor(
            contract.id,
            contract.contractCode,
          );
          const name = effectiveContractNameFor(
            contract.id,
            contract.contractName,
          );
          if (code && name) return `${code} – ${name}`;
          return code ?? name ?? t("modal.globalAttachments.untitledContract");
        })()
      : t("modal.globalAttachments.noContract");
    return {
      breadcrumb: `${contractLabelStr} / ${wsLabel}`,
      workSpecId: ws.id,
    };
  }

  // Sort: by breadcrumb (alphabetical), then by attachment name. Groups
  // all attachments of the same work area together.
  const sortedRows = [...rows].sort((a, b) => {
    const pa = resolveParent(a);
    const pb = resolveParent(b);
    const cmp = danishCollator.compare(pa.breadcrumb, pb.breadcrumb);
    if (cmp !== 0) return cmp;
    return danishCollator.compare(a.name, b.name);
  });

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-attachments-title"
    >
      <div className="modal modal--xl">
        <h2 id="global-attachments-title" className="modal__title">
          {t("modal.globalAttachments.title", { count: rows.length })}
        </h2>
        <p className="modal__body">{t("modal.globalAttachments.body")}</p>

        <div className="modal__body">
          {sortedRows.length === 0 ? (
            <p style={{ opacity: 0.7, fontStyle: "italic" }}>
              {t("modal.globalAttachments.empty")}
            </p>
          ) : (
            <table className="attachments-table">
              {/* Fixed column widths so the Type / Size / Actions
               * columns don't shift as filenames / breadcrumbs vary.
               * Name + Location both absorb remaining space (50/50
               * via `1fr`-style equal widths) and ellipsise when
               * their content is too long. */}
              <colgroup>
                <col style={{ width: "35%" }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 90 }} />
                <col />
                <col style={{ width: 280 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t("modal.globalAttachments.colName")}</th>
                  <th>{t("modal.globalAttachments.colType")}</th>
                  <th className="attachments-table__col--right">
                    {t("modal.globalAttachments.colSize")}
                  </th>
                  <th>{t("modal.globalAttachments.colLocation")}</th>
                  <th className="attachments-table__col--right">
                    {t("modal.globalAttachments.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const { breadcrumb, workSpecId } = resolveParent(row);
                  const isSavingThis = dialog.savingId === row.id;
                  const anyBusy = dialog.saving;
                  return (
                    <tr key={row.id}>
                      <td className="attachments-table__name" title={row.name}>
                        {row.name}
                      </td>
                      <td>{attachmentTypeLabel(row.attachmentTypeId)}</td>
                      <td className="attachments-table__col--right">
                        {formatBytes(row.byteLength)}
                      </td>
                      <td
                        className="attachments-table__name"
                        title={breadcrumb}
                        style={{
                          color:
                            workSpecId == null
                              ? "var(--c-text-muted)"
                              : undefined,
                          fontStyle: workSpecId == null ? "italic" : undefined,
                        }}
                      >
                        {breadcrumb}
                      </td>
                      <td className="attachments-table__col--right">
                        <div className="attachments-table__actions">
                          {workSpecId != null && (
                            <button
                              type="button"
                              className="modal__button"
                              disabled={anyBusy}
                              onClick={() => onGoToWorkSpec(workSpecId)}
                            >
                              {t("modal.globalAttachments.goToWorkArea")}
                            </button>
                          )}
                          {workSpecId != null && (
                            <button
                              type="button"
                              className="modal__button"
                              disabled={anyBusy}
                              onClick={() => onMove(row.id)}
                            >
                              {t("modal.globalAttachments.move")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="modal__button"
                            disabled={anyBusy}
                            onClick={() => onDelete(row.id)}
                          >
                            {isSavingThis
                              ? t("common.deleting")
                              : t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogError
          error={dialog.error}
          otherPrefix={t("modal.globalAttachments.errorPrefix")}
          copy={{
            missing: t("modal.globalAttachments.errorMissing"),
          }}
        />

        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            disabled={dialog.saving}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RenameAttachmentModal({
  dialog,
  onCancel,
  onConfirm,
  onChangeName,
}: {
  dialog: {
    attachmentId: number;
    originalName: string;
    name: string;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  onCancel: () => void;
  onConfirm: () => void;
  onChangeName: (name: string) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const trimmed = dialog.name.trim();
  const okDisabled =
    dialog.saving ||
    trimmed.length === 0 ||
    dialog.error?.kind === "dirty" ||
    dialog.error?.kind === "missing";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-attachment-title"
    >
      <div className="modal">
        <h2 id="rename-attachment-title" className="modal__title">
          {t("modal.renameAttachment.title")}
        </h2>
        <p className="modal__body">
          {t("modal.renameAttachment.bodyPrefix")}{" "}
          <strong>{dialog.originalName}</strong>
          {t("modal.renameAttachment.bodySuffix")}
        </p>
        {dialog.error?.kind === "dirty" && (
          <p className="modal__error">
            {t("modal.renameAttachment.errorDirty")}
          </p>
        )}
        {dialog.error?.kind === "conflict" && (
          <p className="modal__error">
            {t("modal.renameAttachment.errorConflict")}
          </p>
        )}
        {dialog.error?.kind === "missing" && (
          <p className="modal__error">
            {t("modal.renameAttachment.errorMissing")}
          </p>
        )}
        {dialog.error?.kind === "other" && (
          <p className="modal__error">{dialog.error.message}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!okDisabled) onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.renameAttachment.newNameLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.name}
              onChange={(e) => onChangeName(e.target.value)}
              autoFocus
              disabled={dialog.saving}
            />
          </label>
          <div className="modal__actions">
            <button
              type="button"
              className="modal__button"
              onClick={onCancel}
              disabled={dialog.saving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={okDisabled}
            >
              {dialog.saving ? t("common.saving") : t("common.ok")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ConfirmDeleteAttachmentModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: {
    attachmentId: number;
    attachmentName: string;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-attachment-title"
    >
      <div className="modal">
        <h2 id="delete-attachment-title" className="modal__title">
          {t("modal.confirmDeleteAttachment.title")}
        </h2>
        <p className="modal__body">
          {t("modal.confirmDeleteAttachment.bodyPrefix")}{" "}
          <strong>{dialog.attachmentName}</strong>
          {t("modal.confirmDeleteAttachment.bodySuffix")}
        </p>
        <DialogError
          error={dialog.error}
          otherPrefix={t("modal.confirmDeleteAttachment.errorPrefix")}
        />
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={onCancel}
            disabled={dialog.saving}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--danger"
            onClick={onConfirm}
            disabled={
              dialog.saving ||
              dialog.error?.kind === "dirty" ||
              dialog.error?.kind === "missing"
            }
            autoFocus
          >
            {dialog.saving ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MoveAttachmentModal({
  dialog,
  allWorkSpecs,
  allContracts,
  onCancel,
  onConfirm,
  onChangeFilter,
  onChangeTarget,
}: {
  dialog: {
    attachmentId: number;
    attachmentName: string;
    currentWorkSpecId: number;
    filter: string;
    targetWorkSpecId: number | null;
    saving: boolean;
    error:
      | { kind: "dirty" }
      | { kind: "conflict" }
      | { kind: "missing" }
      | { kind: "other"; message: string }
      | null;
  };
  allWorkSpecs: WorkSpecInfo[];
  allContracts: ContractInfo[];
  onCancel: () => void;
  onConfirm: () => void;
  onChangeFilter: (f: string) => void;
  onChangeTarget: (id: number) => void;
}): JSX.Element {
  useEscToClose(onCancel);
  const t = useT();
  const collator = danishCollator;
  const q = dialog.filter.trim().toLowerCase();

  // Build grouped view: contract → work areas. Skip the attachment's
  // current work area so the user can't "move to self".
  const grouped = useMemo(() => {
    const cById = new Map<number, ContractInfo>(
      allContracts.map((c) => [c.id, c]),
    );
    type Group = {
      contractKey: string;
      contractLabel: string;
      workAreas: { ws: WorkSpecInfo; label: string }[];
    };
    const groups = new Map<string, Group>();

    for (const ws of allWorkSpecs) {
      if (ws.id === dialog.currentWorkSpecId) continue;
      const c = ws.contractId != null ? cById.get(ws.contractId) : undefined;
      const cKey = c ? `c:${c.id}` : "c:none";
      const cLabel = c
        ? contractLabel(c)
        : t("modal.moveAttachment.noContract");
      const wsLabel = ws.workAreaCode
        ? `${ws.workAreaCode} — ${ws.workAreaName}`
        : ws.workAreaName;

      if (!groups.has(cKey)) {
        groups.set(cKey, {
          contractKey: cKey,
          contractLabel: cLabel,
          workAreas: [],
        });
      }
      groups.get(cKey)!.workAreas.push({ ws, label: wsLabel });
    }

    if (q.length > 0) {
      for (const g of Array.from(groups.values())) {
        const contractHit = g.contractLabel.toLowerCase().includes(q);
        if (contractHit) continue;
        g.workAreas = g.workAreas.filter((w) =>
          w.label.toLowerCase().includes(q),
        );
        if (g.workAreas.length === 0) groups.delete(g.contractKey);
      }
    }

    const arr = Array.from(groups.values());
    arr.sort((a, b) => collator.compare(a.contractLabel, b.contractLabel));
    for (const g of arr) {
      g.workAreas.sort((a, b) => collator.compare(a.label, b.label));
    }
    return arr;
  }, [allWorkSpecs, allContracts, dialog.currentWorkSpecId, q, collator, t]);

  const okDisabled =
    dialog.saving ||
    dialog.error?.kind === "dirty" ||
    dialog.error?.kind === "missing" ||
    dialog.targetWorkSpecId == null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-attachment-title"
    >
      <div className="modal">
        <h2 id="move-attachment-title" className="modal__title">
          {t("modal.moveAttachment.title")}
        </h2>
        <p className="modal__body">
          {t("modal.moveAttachment.bodyPrefix")}{" "}
          <strong>{dialog.attachmentName}</strong>
          {t("modal.moveAttachment.bodySuffix")}
        </p>
        {dialog.error?.kind === "dirty" && (
          <p className="modal__error">{t("modal.moveAttachment.errorDirty")}</p>
        )}
        {dialog.error?.kind === "conflict" && (
          <p className="modal__error">
            {t("modal.moveAttachment.errorConflict")}
          </p>
        )}
        {dialog.error?.kind === "missing" && (
          <p className="modal__error">
            {t("modal.moveAttachment.errorMissing")}
          </p>
        )}
        {dialog.error?.kind === "other" && (
          <p className="modal__error">{dialog.error.message}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!okDisabled) onConfirm();
          }}
        >
          <label className="modal__field">
            <span className="modal__field-label">
              {t("modal.moveAttachment.filterLabel")}
            </span>
            <input
              type="text"
              className="modal__input"
              value={dialog.filter}
              onChange={(e) => onChangeFilter(e.target.value)}
              autoFocus
              placeholder={t("modal.moveAttachment.filterPlaceholder")}
            />
          </label>
          <div className="modal__picker-list" role="listbox">
            {grouped.length === 0 && (
              <div className="modal__picker-empty">
                {q.length > 0
                  ? t("modal.moveAttachment.noMatches", {
                      filter: dialog.filter,
                    })
                  : t("modal.moveAttachment.noOthers")}
              </div>
            )}
            {grouped.map((g) => (
              <div key={g.contractKey} className="modal__picker-group">
                <div className="modal__picker-group-header">
                  {g.contractLabel}
                </div>
                {g.workAreas.map((w) => (
                  <label key={w.ws.id} className="modal__picker-row">
                    <input
                      type="radio"
                      name="move-attachment-target"
                      checked={dialog.targetWorkSpecId === w.ws.id}
                      onChange={() => onChangeTarget(w.ws.id)}
                    />
                    <span>{w.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="modal__button"
              onClick={onCancel}
              disabled={dialog.saving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="modal__button modal__button--primary"
              disabled={okDisabled}
            >
              {dialog.saving
                ? t("modal.moveAttachment.moving")
                : t("modal.moveAttachment.moveButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
