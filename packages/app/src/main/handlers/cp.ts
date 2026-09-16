/**
 * Control-plan lifecycle IPC handlers: create / duplicate / move /
 * delete CP, plus add / delete CP rows and headers.
 *
 * Strategy ("Option A — immediate persistence"): each op opens the
 * file, mutates, saveAs, closes. Conflict detection (`preflight`)
 * runs before the open: if the on-disk mtime differs from what the
 * renderer last saw, we return `conflict` instead of stomping
 * concurrent edits.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { ipcMain } from "electron";

import {
  addControlPlanHeader,
  addControlPlanRow,
  createControlPlan,
  deleteControlPlan,
  deleteControlPlanHeader,
  deleteControlPlanRow,
  duplicateControlPlan,
  moveControlPlan,
} from "@molio2-editor/core";
import {
  Channels,
  type AddCpHeaderRequest,
  type AddCpHeaderResult,
  type AddCpRowRequest,
  type AddCpRowResult,
  type CreateCpRequest,
  type CreateCpResult,
  type DeleteCpHeaderRequest,
  type DeleteCpHeaderResult,
  type DeleteCpRequest,
  type DeleteCpResult,
  type DeleteCpRowRequest,
  type DeleteCpRowResult,
  type DuplicateCpRequest,
  type DuplicateCpResult,
  type MoveCpRequest,
  type MoveCpResult,
} from "../../shared/ipc.js";
import { preflight, withHandleForWrite } from "./shared.js";

ipcMain.handle(
  Channels.createCp,
  async (_event, req: CreateCpRequest): Promise<CreateCpResult> => {
    console.log("[main] createCp:", {
      path: req.path,
      bdbId: req.bdbId,
      slot: req.slot,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        createControlPlan(h, {
          bdbId: req.bdbId,
          slot: req.slot,
          title: req.title,
          numberText: req.numberText ?? "",
        }),
      );
      return {
        kind: "ok",
        controlPlanId: work.controlPlanId,
        headerId: work.headerId,
        rowId: work.rowId,
        mtimeMs,
      };
    } catch (err) {
      console.error("[main] createCp failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.duplicateCp,
  async (_event, req: DuplicateCpRequest): Promise<DuplicateCpResult> => {
    console.log("[main] duplicateCp:", {
      path: req.path,
      sourceCpId: req.sourceCpId,
      bdbId: req.bdbId,
      slot: req.slot,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        duplicateControlPlan(h, {
          sourceCpId: req.sourceCpId,
          bdbId: req.bdbId,
          slot: req.slot,
          title: req.title,
          ...(req.numberText !== undefined
            ? { numberText: req.numberText }
            : {}),
        }),
      );
      return {
        kind: "ok",
        controlPlanId: work.newControlPlanId,
        clonedHeaderCount: work.clonedHeaderCount,
        clonedRowCount: work.clonedRowCount,
        mtimeMs,
      };
    } catch (err) {
      console.error("[main] duplicateCp failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.moveCp,
  async (_event, req: MoveCpRequest): Promise<MoveCpResult> => {
    console.log("[main] moveCp:", {
      path: req.path,
      sourceCpId: req.sourceCpId,
      targetBdbId: req.targetBdbId,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        moveControlPlan(h, {
          sourceCpId: req.sourceCpId,
          targetBdbId: req.targetBdbId,
        }),
      );
      return {
        kind: "ok",
        slot: work.slot,
        previousBdbId: work.previousBdbId,
        previousSlot: work.previousSlot,
        mtimeMs,
      };
    } catch (err) {
      // Slot-occupied is a user-visible blocker — not a crash — so we
      // convert it to a typed result instead of letting it reject the
      // IPC promise. Anything else (unknown ids, schema issues, etc.)
      // bubbles up as a renderer-side exception so bugs aren't hidden.
      const message = err instanceof Error ? err.message : String(err);
      if (/already has a/.test(message)) {
        return { kind: "slot-occupied", message };
      }
      console.error("[main] moveCp failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.deleteCp,
  async (_event, req: DeleteCpRequest): Promise<DeleteCpResult> => {
    console.log("[main] deleteCp:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { mtimeMs } = await withHandleForWrite(req.path, (h) => {
        deleteControlPlan(h, req.controlPlanId);
      });
      return { kind: "ok", mtimeMs };
    } catch (err) {
      console.error("[main] deleteCp failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.addCpRow,
  async (_event, req: AddCpRowRequest): Promise<AddCpRowResult> => {
    console.log("[main] addCpRow:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work: rowId, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        addControlPlanRow(h, {
          controlPlanId: req.controlPlanId,
          headerId: req.headerId,
          sectionNo: req.sectionNo ?? "",
        }),
      );
      return { kind: "ok", rowId, mtimeMs };
    } catch (err) {
      console.error("[main] addCpRow failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.deleteCpRow,
  async (_event, req: DeleteCpRowRequest): Promise<DeleteCpRowResult> => {
    console.log("[main] deleteCpRow:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { mtimeMs } = await withHandleForWrite(req.path, (h) => {
        deleteControlPlanRow(h, req.rowId);
      });
      return { kind: "ok", mtimeMs };
    } catch (err) {
      console.error("[main] deleteCpRow failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.addCpHeader,
  async (_event, req: AddCpHeaderRequest): Promise<AddCpHeaderResult> => {
    console.log("[main] addCpHeader:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work: headerId, mtimeMs } = await withHandleForWrite(
        req.path,
        (h) =>
          addControlPlanHeader(h, {
            controlPlanId: req.controlPlanId,
            header: req.header,
            headerNo: req.headerNo,
          }),
      );
      return { kind: "ok", headerId, mtimeMs };
    } catch (err) {
      console.error("[main] addCpHeader failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.deleteCpHeader,
  async (_event, req: DeleteCpHeaderRequest): Promise<DeleteCpHeaderResult> => {
    console.log("[main] deleteCpHeader:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { mtimeMs } = await withHandleForWrite(req.path, (h) => {
        deleteControlPlanHeader(h, req.headerId);
      });
      return { kind: "ok", mtimeMs };
    } catch (err) {
      console.error("[main] deleteCpHeader failed:", err);
      throw err;
    }
  },
);
