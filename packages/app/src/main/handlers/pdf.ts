/**
 * PDF export IPC handlers (Phase 7.1 + 7.3).
 *
 * The renderer builds PDF bytes in-process using pdfmake (runs fine
 * in a browser context, no native deps). Main's only job is the
 * dialog + disk write. Kept deliberately dumb — there is no
 * "what to export" logic here because that lives in the renderer.
 *
 * NOTE: `pdf:save-batch` is a literal channel string for the same
 * Rollup property-DCE reason as the import handlers. See the
 * comment in handlers/import.ts.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { dialog, ipcMain } from "electron";

import {
  Channels,
  type SavePdfBatchRequest,
  type SavePdfBatchResult,
  type SavePdfRequest,
  type SavePdfResult,
} from "../../shared/ipc.js";
import { dedupeAgainstDisk } from "../../shared/pdfExportUtils.js";

ipcMain.handle(
  Channels.savePdf,
  async (_event, req: SavePdfRequest): Promise<SavePdfResult> => {
    const suggestedFileName =
      req.suggestedFileName && req.suggestedFileName.trim().length > 0
        ? req.suggestedFileName
        : "export.pdf";
    console.log("[main] savePdf:", {
      name: suggestedFileName,
      bytes: req.bytes?.byteLength ?? 0,
    });

    try {
      const result = await dialog.showSaveDialog({
        title: "Save PDF",
        defaultPath: suggestedFileName,
        filters: [
          { name: "PDF files", extensions: ["pdf"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { kind: "cancelled" };
      }
      // `req.bytes` crosses IPC as a structured-cloned Uint8Array.
      // `writeFile` accepts Uint8Array directly, so no conversion
      // needed.
      await writeFile(result.filePath, req.bytes);
      console.log("[main] savePdf ok:", result.filePath);
      return { kind: "saved", path: result.filePath };
    } catch (err) {
      console.error("[main] savePdf failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

/**
 * Batch PDF export (Phase 7.3).
 *
 * The renderer pre-builds every PDF in-process, then hands main the
 * full array with one IPC call. Main shows ONE directory picker,
 * lists what's already there to avoid clobbering existing files, and
 * writes each item. Per-file errors are collected — one failed write
 * does NOT abort the batch. The caller decides how to surface
 * partial success.
 */
ipcMain.handle(
  "pdf:save-batch",
  async (_event, req: SavePdfBatchRequest): Promise<SavePdfBatchResult> => {
    const items = Array.isArray(req.items) ? req.items : [];
    console.log("[main] savePdfBatch:", { count: items.length });
    if (items.length === 0) {
      return { kind: "error", message: "Nothing to export." };
    }

    try {
      const result = await dialog.showOpenDialog({
        title: req.dialogTitle?.trim() || "Choose a folder for the PDFs",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { kind: "cancelled" };
      }
      const directory = result.filePaths[0]!;

      // Collect existing .pdf basenames in the target directory so we
      // can pick collision-safe filenames. `readdir` returns
      // everything, so filter by extension and strip it.
      let existingBases: Set<string>;
      try {
        const entries = await readdir(directory);
        existingBases = new Set(
          entries
            .filter((n) => extname(n).toLowerCase() === ".pdf")
            .map((n) => n.slice(0, -".pdf".length)),
        );
      } catch (err) {
        console.error("[main] savePdfBatch readdir failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "error", message };
      }

      // Dedupe the incoming file bases: first against each other,
      // then against the disk. Same helper both sides of the IPC
      // boundary use (see shared/pdfExportUtils.ts).
      const finalBases = dedupeAgainstDisk(
        items.map((it) => it.fileBase),
        existingBases,
      );

      const written: string[] = [];
      const errors: Array<{ fileBase: string; message: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const safeBase = finalBases[i] ?? item.fileBase;
        const fullPath = join(directory, `${safeBase}.pdf`);
        try {
          await writeFile(fullPath, item.bytes);
          written.push(fullPath);
        } catch (err) {
          console.error("[main] savePdfBatch write failed:", fullPath, err);
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ fileBase: item.fileBase, message });
        }
      }
      console.log("[main] savePdfBatch ok:", {
        directory,
        written: written.length,
        errors: errors.length,
      });
      return { kind: "saved", directory, written, errors };
    } catch (err) {
      console.error("[main] savePdfBatch failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);
