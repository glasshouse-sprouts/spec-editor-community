/**
 * BDB / structural-delete IPC handlers: duplicate BDB, delete BDB,
 * delete work area, getDeleteImpact (read-only precheck), create
 * PFBB child, migrate orphan PFBB masters.
 *
 * Grouped together because they all mutate (or read) the same
 * `construction_element_spec` / `work_spec` graph. The PFBB handlers
 * sit here too — they're BDB-shaped operations, not their own
 * domain.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { ipcMain } from "electron";

import {
  createPfbbChild,
  deleteBdb,
  deleteWorkArea,
  duplicateBdb,
  getDeleteImpact,
  migrateOrphanPfbbMasters,
  openMoliospec,
} from "@molio2-editor/core";
import {
  Channels,
  type CreatePfbbChildRequest,
  type CreatePfbbChildResult,
  type DeleteBdbRequest,
  type DeleteBdbResult,
  type DeleteWorkAreaRequest,
  type DeleteWorkAreaResult,
  type DuplicateBdbRequest,
  type DuplicateBdbResult,
  type GetDeleteImpactRequest,
  type GetDeleteImpactResult,
  type MigrateOrphanPfbbMastersRequest,
  type MigrateOrphanPfbbMastersResult,
} from "../../shared/ipc.js";
import { saveAsSelfWrite } from "../fileWatcher.js";
import { openForInPlaceWrite } from "./openForInPlaceWrite.js";
import { preflight, safeMtimeMs, withHandleForWrite } from "./shared.js";

ipcMain.handle(
  Channels.duplicateBdb,
  async (_event, req: DuplicateBdbRequest): Promise<DuplicateBdbResult> => {
    console.log("[main] duplicateBdb:", {
      path: req.path,
      bdbId: req.bdbId,
      hasNewName: Boolean(req.newName),
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        duplicateBdb(h, {
          bdbId: req.bdbId,
          newName: req.newName,
          includeControlPlans: req.includeControlPlans ?? false,
        }),
      );
      return { kind: "ok", newBdbId: work.newBdbId, mtimeMs };
    } catch (err) {
      console.error("[main] duplicateBdb failed:", err);
      throw err;
    }
  },
);

/**
 * Same open → mutate → saveAs → close envelope as the BDB duplicate
 * handler. Validation happens inside core.createPfbbChild — the
 * renderer should do a friendlier precheck before calling, but any
 * bad input here throws loudly rather than silently writing a
 * malformed row.
 */
ipcMain.handle(
  Channels.createPfbbChild,
  async (
    _event,
    req: CreatePfbbChildRequest,
  ): Promise<CreatePfbbChildResult> => {
    console.log("[main] createPfbbChild:", {
      path: req.path,
      masterId: req.masterId,
      targetWorkSpecId: req.targetWorkSpecId,
      hasName: Boolean(req.name),
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        createPfbbChild(h, {
          masterId: req.masterId,
          targetWorkSpecId: req.targetWorkSpecId,
          name: req.name,
        }),
      );
      return { kind: "ok", newBdbId: work.newBdbId, mtimeMs };
    } catch (err) {
      console.error("[main] createPfbbChild failed:", err);
      throw err;
    }
  },
);

/**
 * On-open banner calls this when the renderer detects masters living
 * in regular work areas. Idempotent: no file write happens when
 * there are zero orphans — so a repeat click, or a stale request
 * after another writer already migrated, is safe.
 */
ipcMain.handle(
  Channels.migrateOrphanPfbbMasters,
  async (
    _event,
    req: MigrateOrphanPfbbMastersRequest,
  ): Promise<MigrateOrphanPfbbMastersResult> => {
    console.log("[main] migrateOrphanPfbbMasters:", { path: req.path });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    // Custom envelope: the writer is fully idempotent, but we must
    // NOT call saveAs when nothing changed — doing so bumps the
    // mtime and breaks dirty-detection / conflict-checks for any
    // other renderer (or our own stale request after someone else
    // already migrated).
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      const work = migrateOrphanPfbbMasters(handle);
      if (work.movedCount === 0) {
        // Nothing to do — don't touch the file.
        return {
          kind: "ok",
          movedCount: 0,
          movedBdbIds: [],
          virtualWorkSpecId: work.virtualWorkSpecId,
          createdVirtual: false,
          mtimeMs: req.storedMtimeMs,
        };
      }
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return {
        kind: "ok",
        movedCount: work.movedCount,
        movedBdbIds: work.movedBdbIds,
        virtualWorkSpecId: work.virtualWorkSpecId,
        createdVirtual: work.createdVirtual,
        mtimeMs,
      };
    } catch (err) {
      console.error("[main] migrateOrphanPfbbMasters failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error(
            "[main] migrateOrphanPfbbMasters: handle.close failed:",
            err,
          );
        }
      }
    }
  },
);

ipcMain.handle(
  Channels.deleteWorkArea,
  async (_event, req: DeleteWorkAreaRequest): Promise<DeleteWorkAreaResult> => {
    console.log("[main] deleteWorkArea:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        deleteWorkArea(h, { id: req.workSpecId }),
      );
      return {
        kind: "ok",
        mtimeMs,
        summary: {
          bdbs: work.bdbs,
          sections: work.sections,
          attachmentsOrphaned: work.attachmentsOrphaned,
          controlPlansUnlinked: work.controlPlansUnlinked,
        },
      };
    } catch (err) {
      console.error("[main] deleteWorkArea failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.deleteBdb,
  async (_event, req: DeleteBdbRequest): Promise<DeleteBdbResult> => {
    console.log("[main] deleteBdb:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        deleteBdb(h, { id: req.bdbId }),
      );
      return {
        kind: "ok",
        mtimeMs,
        summary: {
          bdbs: work.bdbs,
          sections: work.sections,
          attachmentsOrphaned: work.attachmentsOrphaned,
          controlPlansUnlinked: work.controlPlansUnlinked,
        },
      };
    } catch (err) {
      console.error("[main] deleteBdb failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.getDeleteImpact,
  async (
    _event,
    req: GetDeleteImpactRequest,
  ): Promise<GetDeleteImpactResult> => {
    // Read-only — no mtime check, no saveAs, no force. If the file
    // disappeared between renderer and main, report `missing`.
    const stillThere = await safeMtimeMs(req.path);
    if (stillThere === null) return { kind: "missing" };
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openMoliospec(req.path);
      const impact = getDeleteImpact(handle, req.target);
      return { kind: "ok", impact };
    } catch (err) {
      console.error("[main] getDeleteImpact failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] getDeleteImpact: handle.close failed:", err);
        }
      }
    }
  },
);
