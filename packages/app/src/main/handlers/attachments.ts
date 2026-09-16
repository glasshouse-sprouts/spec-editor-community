/**
 * Attachment IPC handlers: add / delete / replace / rename / move /
 * open (in default OS app) / read bytes.
 *
 * Same immediate-persistence envelope as contracts: open → mutate
 * → saveAs → close. The size-cap is enforced up front so we never
 * allocate a gigantic Buffer in main just to reject it post-open.
 * For delete and replace we do a row-existence pre-check so we can
 * return a typed `not-found` result instead of letting the core
 * error bubble up as an IPC rejection — the UI can then refresh
 * its attachment list quietly.
 *
 * `openAttachment` is the odd one out: read-only, writes the bytes
 * to a temp file, hands off to the OS via `shell.openPath`.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ipcMain, shell } from "electron";

import {
  addAttachment,
  deleteAttachment,
  DuplicateAttachmentError,
  moveAttachment,
  openMoliospec,
  readAttachmentBytes,
  renameAttachment,
  replaceAttachment,
} from "@molio2-editor/core";
import {
  Channels,
  MAX_ATTACHMENT_BYTES,
  type AddAttachmentRequest,
  type AddAttachmentResult,
  type DeleteAttachmentRequest,
  type DeleteAttachmentResult,
  type MoveAttachmentRequest,
  type MoveAttachmentResult,
  type OpenAttachmentRequest,
  type OpenAttachmentResult,
  type ReadAttachmentBytesRequest,
  type ReadAttachmentBytesResult,
  type RenameAttachmentRequest,
  type RenameAttachmentResult,
  type ReplaceAttachmentRequest,
  type ReplaceAttachmentResult,
} from "../../shared/ipc.js";
import { saveAsSelfWrite } from "../fileWatcher.js";
import {
  attachmentExtension,
  isSafeToOpenAttachment,
} from "./attachmentSafety.js";
import { openForInPlaceWrite } from "./openForInPlaceWrite.js";
import {
  attachmentRowToInfo,
  preflight,
  withHandleForWrite,
} from "./shared.js";

ipcMain.handle(
  Channels.addAttachment,
  async (_event, req: AddAttachmentRequest): Promise<AddAttachmentResult> => {
    console.log("[main] addAttachment:", {
      path: req.path,
      workSpecId: req.workSpecId,
      name: req.name,
      mimeType: req.mimeType,
      byteLength: req.content.byteLength,
    });
    if (req.content.byteLength > MAX_ATTACHMENT_BYTES) {
      return {
        kind: "too-large",
        maxBytes: MAX_ATTACHMENT_BYTES,
        actualBytes: req.content.byteLength,
      };
    }
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        addAttachment(h, {
          workSpecId: req.workSpecId,
          name: req.name,
          mimeType: req.mimeType,
          // Core expects a Node Buffer; wrap Uint8Array coming from
          // the renderer. Buffer.from on a Uint8Array is a zero-copy
          // view, so this is cheap even for ~90 MB payloads.
          content: Buffer.from(req.content),
          attachmentTypeId: req.attachmentTypeId,
        }),
      );
      return {
        kind: "ok",
        mtimeMs,
        attachment: attachmentRowToInfo(work),
      };
    } catch (err) {
      // The Molio schema enforces UNIQUE(sha1_hash). Core throws a
      // typed DuplicateAttachmentError when the incoming bytes
      // already exist as another attachment — we translate that into
      // a clean result shape so the UI can show a user-friendly
      // message.
      if (err instanceof DuplicateAttachmentError) {
        console.warn(
          "[main] addAttachment: duplicate sha1 — existing id=" +
            err.existingId +
            ", name=" +
            JSON.stringify(err.existingName),
        );
        return {
          kind: "duplicate",
          existing: {
            id: err.existingId,
            name: err.existingName,
            workSpecId: err.existingWorkSpecId,
          },
        };
      }
      console.error("[main] addAttachment failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.deleteAttachment,
  async (
    _event,
    req: DeleteAttachmentRequest,
  ): Promise<DeleteAttachmentResult> => {
    console.log("[main] deleteAttachment:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      // Pre-check so we can return a typed `not-found` result instead
      // of letting core's "no such attachment" error bubble up.
      const row = handle.db
        .prepare("select 1 from attachment where id = ? limit 1")
        .get(req.attachmentId);
      if (!row) {
        return { kind: "not-found" };
      }
      deleteAttachment(handle, req.attachmentId);
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return { kind: "ok", mtimeMs };
    } catch (err) {
      console.error("[main] deleteAttachment failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] deleteAttachment: handle.close failed:", err);
        }
      }
    }
  },
);

ipcMain.handle(
  Channels.replaceAttachment,
  async (
    _event,
    req: ReplaceAttachmentRequest,
  ): Promise<ReplaceAttachmentResult> => {
    console.log("[main] replaceAttachment:", {
      path: req.path,
      attachmentId: req.attachmentId,
      hasContent: req.content != null,
      byteLength: req.content?.byteLength ?? 0,
      hasName: req.name != null,
      hasMime: req.mimeType != null,
      hasType: req.attachmentTypeId != null,
    });
    if (
      req.content !== undefined &&
      req.content.byteLength > MAX_ATTACHMENT_BYTES
    ) {
      return {
        kind: "too-large",
        maxBytes: MAX_ATTACHMENT_BYTES,
        actualBytes: req.content.byteLength,
      };
    }
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      const row = handle.db
        .prepare("select 1 from attachment where id = ? limit 1")
        .get(req.attachmentId);
      if (!row) {
        return { kind: "not-found" };
      }
      const updated = replaceAttachment(handle, req.attachmentId, {
        name: req.name,
        mimeType: req.mimeType,
        content:
          req.content !== undefined ? Buffer.from(req.content) : undefined,
        attachmentTypeId: req.attachmentTypeId,
      });
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return {
        kind: "ok",
        mtimeMs,
        attachment: attachmentRowToInfo(updated),
      };
    } catch (err) {
      console.error("[main] replaceAttachment failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] replaceAttachment: handle.close failed:", err);
        }
      }
    }
  },
);

ipcMain.handle(
  Channels.renameAttachment,
  async (
    _event,
    req: RenameAttachmentRequest,
  ): Promise<RenameAttachmentResult> => {
    console.log("[main] renameAttachment:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      const row = handle.db
        .prepare("select 1 from attachment where id = ? limit 1")
        .get(req.attachmentId);
      if (!row) {
        return { kind: "not-found" };
      }
      const updated = renameAttachment(handle, req.attachmentId, req.name);
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return {
        kind: "ok",
        mtimeMs,
        attachment: attachmentRowToInfo(updated),
      };
    } catch (err) {
      console.error("[main] renameAttachment failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] renameAttachment: handle.close failed:", err);
        }
      }
    }
  },
);

ipcMain.handle(
  Channels.moveAttachment,
  async (_event, req: MoveAttachmentRequest): Promise<MoveAttachmentResult> => {
    console.log("[main] moveAttachment:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      const attRow = handle.db
        .prepare("select 1 from attachment where id = ? limit 1")
        .get(req.attachmentId);
      if (!attRow) {
        return { kind: "not-found" };
      }
      const wsRow = handle.db
        .prepare("select 1 from work_spec where id = ? limit 1")
        .get(req.newWorkSpecId);
      if (!wsRow) {
        // Target work area missing — UI should refresh.
        return { kind: "not-found" };
      }
      const updated = moveAttachment(
        handle,
        req.attachmentId,
        req.newWorkSpecId,
      );
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return {
        kind: "ok",
        mtimeMs,
        attachment: attachmentRowToInfo(updated),
      };
    } catch (err) {
      console.error("[main] moveAttachment failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] moveAttachment: handle.close failed:", err);
        }
      }
    }
  },
);

/**
 * Sanitize a filename so it's safe to drop into a temp path. Replaces
 * path separators and control chars with underscores, collapses runs,
 * and trims length. Keeps the extension so the OS can pick a handler.
 */
function sanitizeAttachmentFilename(raw: string): string {
  const cleaned = raw
    .replace(/[/\\\0\r\n]+/g, "_")
    .replace(/[\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 128);
  return cleaned.length === 0 ? "attachment" : cleaned;
}

ipcMain.handle(
  Channels.openAttachment,
  async (_event, req: OpenAttachmentRequest): Promise<OpenAttachmentResult> => {
    // NOTE: Read-only. We don't take the storedMtimeMs envelope —
    // opening is a view operation and shouldn't block on unsaved
    // renderer edits (the bytes on disk haven't changed since the
    // attachment was added).
    console.log("[main] openAttachment:", {
      path: req.path,
      attachmentId: req.attachmentId,
    });

    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openMoliospec(req.path);
      const row = handle.db
        .prepare("select name, content from attachment where id = ? limit 1")
        .get(req.attachmentId) as { name: string; content: Buffer } | undefined;
      if (!row) {
        return { kind: "not-found" };
      }

      // 5d — deny-by-default open-safety allowlist. The attachment name +
      // bytes are attacker-controlled; only auto-open known-safe types.
      // Executable/script/HTML/SVG types are blocked and the user warned.
      if (!isSafeToOpenAttachment(row.name)) {
        return { kind: "blocked", extension: attachmentExtension(row.name) };
      }

      const dir = join(tmpdir(), `molio-editor-${process.pid}`);
      await mkdir(dir, { recursive: true });
      const safeName = sanitizeAttachmentFilename(row.name);
      const outPath = join(dir, `att-${req.attachmentId}-${safeName}`);
      await writeFile(outPath, row.content);

      const errMessage = await shell.openPath(outPath);
      if (errMessage && errMessage.length > 0) {
        return { kind: "error", message: errMessage };
      }
      return { kind: "ok", tempPath: outPath };
    } catch (err) {
      console.error("[main] openAttachment failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] openAttachment: handle.close failed:", err);
        }
      }
    }
  },
);

/**
 * Read attachment bytes (Slice 10L — PDF export appendix).
 *
 * Read-only, no mtime envelope. The renderer uses this to pull image
 * bytes into pdfmake as data URLs when building the per-work-spec
 * attachments appendix.
 */
ipcMain.handle(
  Channels.readAttachmentBytes,
  async (
    _event,
    req: ReadAttachmentBytesRequest,
  ): Promise<ReadAttachmentBytesResult> => {
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openMoliospec(req.path);
      const row = readAttachmentBytes(handle, req.attachmentId);
      if (!row) return { kind: "not-found" };
      // Convert the Node Buffer to a plain Uint8Array view. Electron's
      // structured clone handles both, but Uint8Array is what the
      // renderer expects (no Buffer class in browser globals).
      const bytes = new Uint8Array(
        row.content.buffer,
        row.content.byteOffset,
        row.content.byteLength,
      );
      return {
        kind: "ok",
        bytes,
        mimeType: row.mimeType,
        name: row.name,
      };
    } catch (err) {
      console.error("[main] readAttachmentBytes failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error(
            "[main] readAttachmentBytes: handle.close failed:",
            err,
          );
        }
      }
    }
  },
);
