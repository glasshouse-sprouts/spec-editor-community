/**
 * Custom-cover IPC handlers (#249 COVER, Skive 3c-2).
 *
 * Generic file IO only — find a `.speccustom` next to the open
 * .moliospec, and read a `.speccustom` by path. No pdf-lib, no template
 * parsing (that happens in the renderer). Because there is nothing
 * Glasshouse-specific here, these handlers stay in Community too; they
 * are simply never invoked there (no cover engine calls them).
 *
 * Channel strings are literals for the same Rollup property-DCE reason
 * as the PDF/import handlers — see handlers/pdf.ts.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { dialog, ipcMain, shell } from "electron";

import { getCurrentFilePath } from "../sessionLockfile.js";

import type {
  CoverCurrentPathResult,
  CoverFindSiblingRequest,
  CoverFindSiblingResult,
  CoverOpenTemplateResult,
  CoverOpenUnderlayResult,
  CoverPreviewRequest,
  CoverPreviewResult,
  CoverReadTemplateRequest,
  CoverReadTemplateResult,
  CoverSaveTemplateRequest,
  CoverSaveTemplateResult,
} from "../../shared/ipc.js";

const EXT = ".speccustom";

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

ipcMain.handle(
  "cover:find-sibling",
  async (
    _event,
    req: CoverFindSiblingRequest,
  ): Promise<CoverFindSiblingResult> => {
    const moliospecPath = req?.moliospecPath ?? "";
    if (!moliospecPath) return { kind: "none" };
    try {
      const dir = dirname(moliospecPath);
      const entries = await readdir(dir);
      // Deterministic pick when several exist: first by name.
      const match = entries
        .filter((n) => n.toLowerCase().endsWith(EXT))
        .sort((a, b) => a.localeCompare(b))[0];
      if (!match) return { kind: "none" };
      const full = join(dir, match);
      const buf = await readFile(full);
      return { kind: "found", path: full, bytes: new Uint8Array(buf) };
    } catch (err) {
      if (isEnoent(err)) return { kind: "none" };
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

ipcMain.handle(
  "cover:read-template",
  async (
    _event,
    req: CoverReadTemplateRequest,
  ): Promise<CoverReadTemplateResult> => {
    const path = req?.path ?? "";
    if (!path.toLowerCase().endsWith(EXT)) {
      return { kind: "error", message: `Not a ${EXT} file.` };
    }
    try {
      const buf = await readFile(path);
      return { kind: "ok", bytes: new Uint8Array(buf) };
    } catch (err) {
      if (isEnoent(err)) return { kind: "not-found" };
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

ipcMain.handle(
  "cover:save-template",
  async (
    _event,
    req: CoverSaveTemplateRequest,
  ): Promise<CoverSaveTemplateResult> => {
    try {
      const suggested =
        (req?.suggestedName && req.suggestedName.trim()) ||
        `forside${EXT}`;
      // A full path (the project's sibling) pre-selects the file so "Gem…"
      // overwrites it; otherwise just a suggested filename.
      const defaultPath =
        (req?.defaultPath && req.defaultPath.trim()) || suggested;
      const result = await dialog.showSaveDialog({
        title: "Gem forside-skabelon",
        defaultPath,
        filters: [{ name: "Spec forside", extensions: ["speccustom"] }],
      });
      if (result.canceled || !result.filePath) return { kind: "cancelled" };
      let path = result.filePath;
      if (!path.toLowerCase().endsWith(EXT)) path += EXT;
      await writeFile(path, req?.bytes ?? new Uint8Array());
      return { kind: "saved", path };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

ipcMain.handle(
  "cover:open-template",
  async (): Promise<CoverOpenTemplateResult> => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Åbn forside-skabelon",
        properties: ["openFile"],
        filters: [{ name: "Spec forside", extensions: ["speccustom"] }],
      });
      if (result.canceled) return { kind: "cancelled" };
      const path = result.filePaths[0];
      if (!path) return { kind: "cancelled" };
      const buf = await readFile(path);
      return { kind: "ok", path, bytes: new Uint8Array(buf) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

ipcMain.handle(
  "cover:open-underlay",
  async (): Promise<CoverOpenUnderlayResult> => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Vælg underlags-PDF",
        properties: ["openFile"],
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled) return { kind: "cancelled" };
      const path = result.filePaths[0];
      if (!path) return { kind: "cancelled" };
      const bytes = await readFile(path);
      return {
        kind: "ok",
        base64: bytes.toString("base64"),
        name: basename(path),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

ipcMain.handle(
  "cover:preview",
  async (_event, req: CoverPreviewRequest): Promise<CoverPreviewResult> => {
    try {
      const path = join(tmpdir(), `forside-preview-${Date.now()}.pdf`);
      await writeFile(path, req.bytes);
      // Returns "" on success, or an error string.
      const err = await shell.openPath(path);
      if (err) return { kind: "error", message: err };
      return { kind: "ok" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "error", message };
    }
  },
);

// Generic: the path of the open .moliospec, so the cover engine can look
// for a sibling `.speccustom` when the editor opens (no dialog). Generic
// IO, so it stays in Community too — simply never called there.
ipcMain.handle(
  "cover:current-moliospec-path",
  (): CoverCurrentPathResult => ({ path: getCurrentFilePath() }),
);
