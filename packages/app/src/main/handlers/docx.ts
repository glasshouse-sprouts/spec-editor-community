/**
 * DOCX export IPC handler.
 *
 * The renderer builds the .docx bytes in-process (via fflate +
 * the OOXML builders in `renderer/src/word/`). Main's only job is
 * the OS save dialog + disk write — same shape as the PDF
 * single-save handler.
 *
 * Channel: `docx:save` (`Channels.saveDocx`).
 */

import { readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { dialog, ipcMain } from "electron";

import {
  Channels,
  type SaveDocxBatchRequest,
  type SaveDocxBatchResult,
  type SaveDocxRequest,
  type SaveDocxResult,
} from "../../shared/ipc.js";
import { dedupeAgainstDisk } from "../../shared/pdfExportUtils.js";

ipcMain.handle(
  Channels.saveDocx,
  async (_event, req: SaveDocxRequest): Promise<SaveDocxResult> => {
    const suggestedFileName =
      req.suggestedFileName && req.suggestedFileName.trim().length > 0
        ? req.suggestedFileName
        : "export.docx";
    console.log("[main] saveDocx:", {
      name: suggestedFileName,
      bytes: req.bytes?.byteLength ?? 0,
    });

    try {
      const result = await dialog.showSaveDialog({
        title: "Save Word document",
        defaultPath: suggestedFileName,
        filters: [
          { name: "Word documents", extensions: ["docx"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { kind: "cancelled" };
      }
      await writeFile(result.filePath, req.bytes);
      console.log("[main] saveDocx ok:", result.filePath);
      return { kind: "saved", path: result.filePath };
    } catch (err) {
      console.error("[main] saveDocx failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

/**
 * Batch DOCX export — mirror of `pdf:save-batch`. One directory
 * picker, then writes every .docx item with collision-safe filenames.
 * Per-file write errors do NOT abort the batch.
 */
ipcMain.handle(
  "docx:save-batch",
  async (_event, req: SaveDocxBatchRequest): Promise<SaveDocxBatchResult> => {
    const items = Array.isArray(req.items) ? req.items : [];
    console.log("[main] saveDocxBatch:", { count: items.length });
    if (items.length === 0) {
      return { kind: "error", message: "Nothing to export." };
    }

    try {
      const result = await dialog.showOpenDialog({
        title:
          req.dialogTitle?.trim() || "Choose a folder for the Word documents",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { kind: "cancelled" };
      }
      const directory = result.filePaths[0]!;

      // List existing .docx basenames in the target folder so we
      // can dedupe-against-disk like the PDF batch does.
      let existingBases: Set<string>;
      try {
        const entries = await readdir(directory);
        existingBases = new Set(
          entries
            .filter((n) => extname(n).toLowerCase() === ".docx")
            .map((n) => n.slice(0, -".docx".length)),
        );
      } catch (err) {
        console.error("[main] saveDocxBatch readdir failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "error", message };
      }

      const finalBases = dedupeAgainstDisk(
        items.map((it) => it.fileBase),
        existingBases,
      );

      const written: string[] = [];
      const errors: Array<{ fileBase: string; message: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const safeBase = finalBases[i] ?? item.fileBase;
        const fullPath = join(directory, `${safeBase}.docx`);
        try {
          await writeFile(fullPath, item.bytes);
          written.push(fullPath);
        } catch (err) {
          console.error("[main] saveDocxBatch write failed:", fullPath, err);
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ fileBase: item.fileBase, message });
        }
      }
      console.log("[main] saveDocxBatch ok:", {
        directory,
        written: written.length,
        errors: errors.length,
      });
      return { kind: "saved", directory, written, errors };
    } catch (err) {
      console.error("[main] saveDocxBatch failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);
