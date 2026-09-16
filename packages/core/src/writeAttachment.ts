/**
 * Attachment write operations: add / delete / replace / rename / move.
 *
 * Storage model: `attachment` rows are content-addressed via
 * `UNIQUE(sha1_hash)` so two rows with identical bytes cannot
 * coexist. `addAttachment` enforces this with a typed
 * `DuplicateAttachmentError` instead of letting the raw SQLite
 * constraint failure bubble up. The other operations don't need
 * special handling because they update an existing row (no new SHA
 * added to the unique index).
 *
 * Every write here also bumps `project.modified_date` to keep that
 * field in sync — same policy as `applyEdits`.
 *
 * Extracted from `write.ts` in slice #233-followup.
 */

import { createHash } from "node:crypto";

import { CoreError } from "./errors.js";
import type { MoliospecHandle } from "./io.js";
import { type Attachment, AttachmentType } from "./types.js";

/**
 * Arguments to `addAttachment`. `content` is the raw bytes. The
 * caller supplies `mimeType` (the renderer can sniff from the File
 * API) and `name` (filename). `attachmentTypeId` defaults to `Bilag`
 * when omitted.
 */
export interface AddAttachmentArgs {
  workSpecId: number;
  name: string;
  mimeType: string;
  content: Buffer;
  attachmentTypeId?: AttachmentType;
}

/**
 * Arguments to `replaceAttachment`. Every field is optional —
 * omitted fields keep their previous value. `sha1_hash` is recomputed
 * when `content` is provided and kept as-is otherwise.
 */
export interface ReplaceAttachmentArgs {
  name?: string;
  mimeType?: string;
  content?: Buffer;
  attachmentTypeId?: AttachmentType;
}

/** Compute SHA-1 of an attachment's bytes. */
function computeAttachmentSha1(content: Buffer): Buffer {
  return createHash("sha1").update(content).digest();
}

/**
 * Thrown by `addAttachment` when the uploaded bytes collide with an
 * existing attachment's SHA-1. The Molio 2.0 schema enforces a
 * UNIQUE constraint on `attachment.sha1_hash` — content is stored
 * by-content, so two rows with identical bytes cannot coexist (even
 * under different filenames or work areas).
 *
 * Carries the existing row's id / name / work-spec id so the caller
 * can surface a useful message ("File already exists as X under
 * work area Y").
 */
export class DuplicateAttachmentError extends Error {
  existingId: number;
  existingName: string;
  existingWorkSpecId: number;

  constructor(existing: { id: number; name: string; workSpecId: number }) {
    super(
      `addAttachment: an attachment with identical bytes already exists ` +
        `(id=${existing.id}, name=${existing.name}, ` +
        `workSpecId=${existing.workSpecId}).`,
    );
    this.name = "DuplicateAttachmentError";
    this.existingId = existing.id;
    this.existingName = existing.name;
    this.existingWorkSpecId = existing.workSpecId;
  }
}

/** Bump `project.modified_date` to now. Matches the applyEdits policy. */
function bumpProjectModifiedDate(handle: MoliospecHandle): void {
  handle.db
    .prepare(
      "update project set modified_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .run();
}

/**
 * Add a new attachment to a work spec (work area, i.e. the Danish
 * "arbejdsbeskrivelse"). Returns the freshly-inserted row (including
 * the generated `id` and the server-computed `sha1_hash`). Throws if
 * the work spec does not exist.
 *
 * Attachments are stored in the `attachment` table with a FK to
 * `work_spec.id`. The Molio 2.0 schema does NOT support attaching
 * directly to BDBs (construction_element_spec), sections, or the
 * project — only to work specs.
 */
export function addAttachment(
  handle: MoliospecHandle,
  args: AddAttachmentArgs,
): Attachment {
  const db = handle.db;
  const typeId = args.attachmentTypeId ?? AttachmentType.Bilag;
  const sha = computeAttachmentSha1(args.content);
  const tx = db.transaction((): number => {
    const exists = db
      .prepare("select 1 from work_spec where id = ? limit 1")
      .get(args.workSpecId);
    if (!exists) {
      throw new CoreError(
        "INTERNAL",
        { workSpecId: args.workSpecId },
        `addAttachment: no such work spec id=${args.workSpecId}`,
      );
    }
    // Pre-check the SHA-1 uniqueness constraint so the caller can
    // get a typed error (with the existing row's id / name / owner)
    // instead of a bare SqliteError that only says "UNIQUE
    // constraint failed".
    const dup = db
      .prepare(
        "select id, name, work_spec_id as workSpecId " +
          "from attachment where sha1_hash = ? limit 1",
      )
      .get(sha) as { id: number; name: string; workSpecId: number } | undefined;
    if (dup) {
      throw new DuplicateAttachmentError({
        id: dup.id,
        name: dup.name,
        workSpecId: dup.workSpecId,
      });
    }
    const info = db
      .prepare(
        "insert into attachment " +
          "(mime_type, content, name, sha1_hash, work_spec_id, attachment_type_id) " +
          "values (?, ?, ?, ?, ?, ?)",
      )
      .run(
        args.mimeType,
        args.content,
        args.name,
        sha,
        args.workSpecId,
        typeId,
      );
    bumpProjectModifiedDate(handle);
    return Number(info.lastInsertRowid);
  });
  const id = tx();
  return {
    id,
    mime_type: args.mimeType,
    content: args.content,
    name: args.name,
    sha1_hash: sha,
    work_spec_id: args.workSpecId,
    attachment_type_id: typeId,
  };
}

/**
 * Permanently remove an attachment. Throws if no row exists for the
 * given id (same loud-fail style as the rest of the write API).
 */
export function deleteAttachment(
  handle: MoliospecHandle,
  attachmentId: number,
): void {
  const db = handle.db;
  const tx = db.transaction((): void => {
    const info = db
      .prepare("delete from attachment where id = ?")
      .run(attachmentId);
    if (info.changes === 0) {
      throw new CoreError(
        "INTERNAL",
        { attachmentId },
        `deleteAttachment: no such attachment id=${attachmentId}`,
      );
    }
    bumpProjectModifiedDate(handle);
  });
  tx();
}

/**
 * Replace one or more fields on an existing attachment. Keeps the
 * row id so any external references survive. When `content` is
 * provided, `sha1_hash` is recomputed; otherwise it is preserved.
 * Throws if the target row does not exist. `work_spec_id` cannot be
 * changed — use delete + add if you really need to move an
 * attachment between work specs (rare, and avoids ambiguity about
 * whether sha should update).
 */
export function replaceAttachment(
  handle: MoliospecHandle,
  attachmentId: number,
  args: ReplaceAttachmentArgs,
): Attachment {
  const db = handle.db;
  const tx = db.transaction((): Attachment => {
    const row = db
      .prepare("select * from attachment where id = ?")
      .get(attachmentId) as Attachment | undefined;
    if (!row) {
      throw new CoreError(
        "INTERNAL",
        { attachmentId },
        `replaceAttachment: no such attachment id=${attachmentId}`,
      );
    }
    const nextName = args.name ?? row.name;
    const nextMime = args.mimeType ?? row.mime_type;
    const nextContent = args.content ?? row.content;
    const nextType = args.attachmentTypeId ?? row.attachment_type_id;
    const nextSha =
      args.content !== undefined
        ? computeAttachmentSha1(nextContent)
        : row.sha1_hash;
    db.prepare(
      "update attachment set " +
        "name = ?, mime_type = ?, content = ?, sha1_hash = ?, attachment_type_id = ? " +
        "where id = ?",
    ).run(nextName, nextMime, nextContent, nextSha, nextType, attachmentId);
    bumpProjectModifiedDate(handle);
    return {
      id: attachmentId,
      mime_type: nextMime,
      content: nextContent,
      name: nextName,
      sha1_hash: nextSha,
      work_spec_id: row.work_spec_id,
      attachment_type_id: nextType,
    };
  });
  return tx();
}

/**
 * Rename an attachment in place. Only updates `name` — leaves bytes,
 * sha, type, and parent work_spec alone. Thin wrapper around
 * `replaceAttachment` exposed as its own API for clarity at call
 * sites (the UI right-click → "Rename…" path). Throws if the row is
 * missing.
 */
export function renameAttachment(
  handle: MoliospecHandle,
  attachmentId: number,
  newName: string,
): Attachment {
  return replaceAttachment(handle, attachmentId, { name: newName });
}

/**
 * Move an attachment to a different work area. Changes only
 * `work_spec_id`; bytes / sha / type / name are preserved. Throws
 * if either the attachment or the target work spec is missing. The
 * Molio 2.0 UNIQUE constraint on `sha1_hash` still applies — but
 * because we're updating the existing row (not inserting a new one)
 * the constraint is not violated.
 */
export function moveAttachment(
  handle: MoliospecHandle,
  attachmentId: number,
  newWorkSpecId: number,
): Attachment {
  const db = handle.db;
  const tx = db.transaction((): Attachment => {
    const row = db
      .prepare("select * from attachment where id = ?")
      .get(attachmentId) as Attachment | undefined;
    if (!row) {
      throw new CoreError(
        "INTERNAL",
        { attachmentId },
        `moveAttachment: no such attachment id=${attachmentId}`,
      );
    }
    const wsExists = db
      .prepare("select 1 from work_spec where id = ? limit 1")
      .get(newWorkSpecId);
    if (!wsExists) {
      throw new CoreError(
        "INTERNAL",
        { workSpecId: newWorkSpecId },
        `moveAttachment: no such work spec id=${newWorkSpecId}`,
      );
    }
    db.prepare("update attachment set work_spec_id = ? where id = ?").run(
      newWorkSpecId,
      attachmentId,
    );
    bumpProjectModifiedDate(handle);
    return { ...row, work_spec_id: newWorkSpecId };
  });
  return tx();
}
