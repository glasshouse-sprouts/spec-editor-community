/**
 * Contract lifecycle IPC handlers: create + delete contract.
 *
 * The delete handler pre-checks `work_spec` references so it can
 * return a structured `referenced` result instead of surfacing the
 * raw core error — the UI wants a list of ids, not a stringly-typed
 * message.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { ipcMain, shell } from "electron";
import { existsSync, unlinkSync } from "node:fs";

import {
  createContract,
  deleteContract,
  openMoliospec,
} from "@molio2-editor/core";
import {
  Channels,
  type CreateContractRequest,
  type CreateContractResult,
  type DeleteContractRequest,
  type DeleteContractResult,
  type SeedDefaultContractsRequest,
  type SeedDefaultContractsResult,
  type DefaultsFileRequest,
  type DefaultsFileResult,
} from "../../shared/ipc.js";
import {
  readContractDefaults,
  readWorkAreaMapDefaults,
  ensureUserDefault,
  userDefaultPath,
  CONTRACTS_CSV,
  WORKAREA_MAP_CSV,
} from "./defaults.js";
import { saveAsSelfWrite } from "../fileWatcher.js";
import { openForInPlaceWrite } from "./openForInPlaceWrite.js";
import { preflight, withHandleForWrite } from "./shared.js";

ipcMain.handle(
  Channels.createContract,
  async (_event, req: CreateContractRequest): Promise<CreateContractResult> => {
    console.log("[main] createContract:", {
      path: req.path,
      hasCode: req.contractCode != null,
      hasName: req.contractName != null,
    });
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const { work, mtimeMs } = await withHandleForWrite(req.path, (h) =>
        createContract(h, {
          contractCode: req.contractCode ?? null,
          contractName: req.contractName ?? null,
        }),
      );
      return { kind: "ok", contractId: work.contractId, mtimeMs };
    } catch (err) {
      console.error("[main] createContract failed:", err);
      throw err;
    }
  },
);

ipcMain.handle(
  Channels.seedDefaultContracts,
  async (
    _event,
    req: SeedDefaultContractsRequest,
  ): Promise<SeedDefaultContractsResult> => {
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;
    try {
      const defaults = readContractDefaults();
      const { work: created, mtimeMs } = await withHandleForWrite(
        req.path,
        (h) => {
          // Existing contract codes (case-insensitive) so we never add a
          // duplicate — the button is safe to run more than once.
          let existing = new Set<string>();
          try {
            const rows = h.db
              .prepare("select contract_code from contracts")
              .all() as { contract_code: string | null }[];
            existing = new Set(
              rows
                .map((r) => (r.contract_code ?? "").trim().toLowerCase())
                .filter((c) => c.length > 0),
            );
          } catch {
            // No contracts table yet — createContract creates it. Treat
            // as "nothing exists".
          }
          let added = 0;
          for (const row of defaults) {
            const code = row.code.trim().toLowerCase();
            if (code && existing.has(code)) continue;
            createContract(h, {
              contractCode: row.code,
              contractName: row.name,
            });
            if (code) existing.add(code);
            added++;
          }
          return added;
        },
      );
      return { kind: "ok", created, mtimeMs };
    } catch (err) {
      console.error("[main] seedDefaultContracts failed:", err);
      throw err;
    }
  },
);

// #250 — hand the renderer the work-area -> contract mapping so the
// import dialog can pre-select a landing contract. Read-only; returns []
// when no mapping ships / is readable.
ipcMain.handle(Channels.getContractWorkAreaMapping, async () => {
  try {
    return readWorkAreaMapDefaults();
  } catch (err) {
    console.error("[main] getContractWorkAreaMapping failed:", err);
    return [];
  }
});

// #250 (2D) — open the user's editable default CSV in the OS default app.
ipcMain.handle(
  Channels.openDefaultsFile,
  async (_event, req: DefaultsFileRequest): Promise<DefaultsFileResult> => {
    const filename = req.which === "mapping" ? WORKAREA_MAP_CSV : CONTRACTS_CSV;
    const p = ensureUserDefault(filename);
    if (!p) return { ok: false, error: "default-file-missing" };
    try {
      const err = await shell.openPath(p); // "" on success
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// #250 (2D) — reset a default CSV: delete the user copy, restore the
// shipped default. This is how the user picks up an updated shipped file.
ipcMain.handle(
  Channels.resetDefaultsFile,
  async (_event, req: DefaultsFileRequest): Promise<DefaultsFileResult> => {
    const filename = req.which === "mapping" ? WORKAREA_MAP_CSV : CONTRACTS_CSV;
    try {
      const userPath = userDefaultPath(filename);
      if (existsSync(userPath)) unlinkSync(userPath);
      const restored = ensureUserDefault(filename); // re-copy the shipped one
      return restored
        ? { ok: true }
        : { ok: false, error: "default-file-missing" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  Channels.deleteContract,
  async (_event, req: DeleteContractRequest): Promise<DeleteContractResult> => {
    console.log("[main] deleteContract:", req);
    const pre = await preflight(req.path, req.storedMtimeMs, req.force);
    if (pre) return pre;

    // Open once, check for references, and only save if we actually
    // delete. The pre-check mirrors core.deleteContract's internal
    // guard but lets us return a typed `referenced` result instead of
    // propagating a thrown Error.
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      handle = await openForInPlaceWrite(req.path);
      const refRows = handle.db
        .prepare("select id from work_spec where contract_id = ?")
        .all(req.contractId) as { id: number }[];
      if (refRows.length > 0) {
        return {
          kind: "referenced",
          workSpecIds: refRows.map((r) => r.id),
        };
      }
      deleteContract(handle, req.contractId);
      const mtimeMs = await saveAsSelfWrite(handle, req.path);
      return { kind: "ok", mtimeMs };
    } catch (err) {
      console.error("[main] deleteContract failed:", err);
      throw err;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] deleteContract: handle.close failed:", err);
        }
      }
    }
  },
);
