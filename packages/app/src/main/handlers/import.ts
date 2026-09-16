/**
 * Import-from-another-moliospec IPC handlers (Slice 6K).
 *
 * Three handlers:
 *   - `import:read-source`  read-only: returns just enough of the
 *                           source file for the Import modal to
 *                           render its tree (contracts, work areas,
 *                           BDBs). No section bodies.
 *   - `import:precheck`     read-only on both source + target;
 *                           returns the collision report so the UI
 *                           can build the per-item resolution
 *                           dialogs.
 *   - `import:apply`        opens target (with mtime check), opens
 *                           source read-only, runs
 *                           core.importFromMoliospec inside a
 *                           transaction on target, saveAs target,
 *                           closes both. Returns new mtime + summary
 *                           counts.
 *
 * NOTE: We use string literals for the channel names instead of
 * `Channels.importPrecheck` etc. Rollup's property-DCE quirk dropped
 * those keys from the bundled `Channels` object (even though the
 * source has them), making both accesses resolve to `undefined` —
 * Electron then threw "Attempted to register a second handler for
 * 'undefined'" on startup. The Channels entries are kept in
 * shared/ipc.ts for typing consistency; the wire-level strings are
 * the same ("import:precheck" / "import:apply" /
 * "import:read-source").
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { ipcMain } from "electron";

import {
  fillEmptyWorkSpec,
  getImportPrecheck,
  importFromMoliospec,
  openMoliospec,
  readMoliospec,
} from "@molio2-editor/core";
import {
  Channels,
  type ContractInfo,
  type FillEmptyWorkSpecRequest,
  type FillEmptyWorkSpecResult,
  type ImportApplyRequest,
  type ImportApplyResult,
  type ImportPrecheckRequest,
  type ImportPrecheckResult,
  type ReadImportSourceRequest,
  type ReadImportSourceResult,
} from "../../shared/ipc.js";
import { saveAsSelfWrite } from "../fileWatcher.js";
import { openForInPlaceWrite } from "./openForInPlaceWrite.js";
import { preflight, safeMtimeMs } from "./shared.js";

ipcMain.handle(
  "import:precheck",
  async (_event, req: ImportPrecheckRequest): Promise<ImportPrecheckResult> => {
    console.log("[main] importPrecheck:", {
      source: req.sourcePath,
      target: req.targetPath,
      wsN: req.plan.workAreas.length,
      bdbN: req.plan.bdbs.length,
    });
    const tgtOk = await safeMtimeMs(req.targetPath);
    if (tgtOk === null) return { kind: "missing", which: "target" };
    const srcOk = await safeMtimeMs(req.sourcePath);
    if (srcOk === null) return { kind: "missing", which: "source" };
    let tgt: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    let src: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      // The precheck only reads, but it reads the target on behalf of
      // an in-place import, and it asks about `work_spec.contract_id` -
      // a column an old file does not have. Guarding here means the
      // user gets the "save it as a new file first" message before the
      // import dialog, instead of a raw SQLite error inside it.
      tgt = await openForInPlaceWrite(req.targetPath);
      // The import SOURCE is only ever read, so upgrading it costs
      // nothing and the file on disk is never written back. Doing it
      // means an old file can still be raided for content - the one
      // rescue path a user has for a project they cannot edit
      // otherwise - and the import code gets the schema it expects
      // instead of one missing tables. Task 1 / M1.
      src = await openMoliospec(req.sourcePath, { migrate: true });
      const precheck = getImportPrecheck(tgt, src, req.plan);
      return { kind: "ok", precheck };
    } catch (err) {
      console.error("[main] importPrecheck failed:", err);
      throw err;
    } finally {
      if (src) {
        try {
          await src.close();
        } catch (err) {
          console.error("[main] importPrecheck: src.close failed:", err);
        }
      }
      if (tgt) {
        try {
          await tgt.close();
        } catch (err) {
          console.error("[main] importPrecheck: tgt.close failed:", err);
        }
      }
    }
  },
);

ipcMain.handle(
  "import:read-source",
  async (
    _event,
    req: ReadImportSourceRequest,
  ): Promise<ReadImportSourceResult> => {
    console.log("[main] readImportSource:", req.sourcePath);
    const mtime = await safeMtimeMs(req.sourcePath);
    if (mtime === null) return { kind: "missing" };
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openMoliospec(req.sourcePath, { migrate: true });
      const file = readMoliospec(handle);
      return {
        kind: "ok",
        summary: {
          contracts: file.contracts.map<ContractInfo>((c) => ({
            id: c.id,
            contractCode: c.contract_code,
            contractName: c.contract_name,
          })),
          workAreas: file.workSpecs.map((w) => ({
            id: w.id,
            workAreaCode: w.work_area_code,
            workAreaName: w.work_area_name,
            contractId: w.contract_id,
          })),
          bdbs: file.constructionElementSpecs.map((b) => ({
            id: b.id,
            name: b.name,
            workSpecId: b.work_spec_id,
          })),
        },
      };
    } catch (err) {
      console.error("[main] readImportSource failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] readImportSource: close failed:", err);
        }
      }
    }
  },
);

ipcMain.handle(
  "import:apply",
  async (_event, req: ImportApplyRequest): Promise<ImportApplyResult> => {
    console.log("[main] importApply:", {
      source: req.sourcePath,
      target: req.path,
      wsN: req.plan.workAreas.length,
      bdbN: req.plan.bdbs.length,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    const srcExists = await safeMtimeMs(req.sourcePath);
    if (srcExists === null) return { kind: "source-missing" };

    let tgt: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    let src: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      tgt = await openForInPlaceWrite(req.path);
      src = await openMoliospec(req.sourcePath, { migrate: true });
      const result = importFromMoliospec(tgt, src, req.plan);
      const mtimeMs = await saveAsSelfWrite(tgt, req.path);
      return {
        kind: "ok",
        mtimeMs,
        summary: {
          workAreasImported: result.workAreasImported,
          bdbsImported: result.bdbsImported,
          controlPlansImported: result.controlPlansImported,
          skippedWorkAreas: result.skippedWorkAreas,
          skippedBdbs: result.skippedBdbs,
        },
      };
    } catch (err) {
      console.error("[main] importApply failed:", err);
      throw err;
    } finally {
      if (src) {
        try {
          await src.close();
        } catch (err) {
          console.error("[main] importApply: src.close failed:", err);
        }
      }
      if (tgt) {
        try {
          await tgt.close();
        } catch (err) {
          console.error("[main] importApply: tgt.close failed:", err);
        }
      }
    }
  },
);

/* ------------------------------------------------------------------ */
/*  SPLIT-Merge (#248) — fillEmptyWorkSpec                            */
/* ------------------------------------------------------------------ */

/**
 * Surgical alternative to `importApply` that only copies sections
 * (no BDBs, no control plans, no metadata) from a chosen source
 * work area into an empty target work area. Same on-disk + mtime
 * pattern as importApply so the editor's reload-detection picks
 * up the change naturally.
 *
 * The actual section copy + empty-target enforcement lives in
 * core (`fillEmptyWorkSpec`); this handler only wires it to IPC
 * and handles open/close + mtime book-keeping.
 */
ipcMain.handle(
  Channels.fillEmptyWorkSpec,
  async (
    _event,
    req: FillEmptyWorkSpecRequest,
  ): Promise<FillEmptyWorkSpecResult> => {
    console.log("[main] fillEmptyWorkSpec:", {
      source: req.sourcePath,
      target: req.path,
      sourceWsId: req.sourceWorkSpecId,
      targetWsId: req.targetWorkSpecId,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    const srcExists = await safeMtimeMs(req.sourcePath);
    if (srcExists === null) return { kind: "source-missing" };

    let tgt: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    let src: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      tgt = await openForInPlaceWrite(req.path);
      src = await openMoliospec(req.sourcePath, { migrate: true });
      const result = fillEmptyWorkSpec(
        tgt,
        src,
        req.targetWorkSpecId,
        req.sourceWorkSpecId,
      );
      const mtimeMs = await saveAsSelfWrite(tgt, req.path);
      return {
        kind: "ok",
        mtimeMs,
        summary: { sectionsCopied: result.sectionsCopied },
      };
    } catch (err) {
      console.error("[main] fillEmptyWorkSpec failed:", err);
      throw err;
    } finally {
      if (src) {
        try {
          await src.close();
        } catch (err) {
          console.error("[main] fillEmptyWorkSpec: src.close failed:", err);
        }
      }
      if (tgt) {
        try {
          await tgt.close();
        } catch (err) {
          console.error("[main] fillEmptyWorkSpec: tgt.close failed:", err);
        }
      }
    }
  },
);
