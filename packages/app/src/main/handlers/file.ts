/**
 * File-level IPC handlers: open dialog, open file (full payload read),
 * save file (with edits + PFBB auto-move), set-dirty cache update.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import { app, dialog, ipcMain } from "electron";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  applyEdits,
  createContract,
  moveBdbToVirtualWorkSpec,
  openMoliospec,
  planMigration,
  readMoliospec,
} from "@molio2-editor/core";
import {
  Channels,
  type AttachmentInfo,
  type ContractInfo,
  type CreateEmptyProjectResult,
  type CustomDataEntryInfo,
  type FilePayload,
  type SaveFileAsRequest,
  type SaveFileAsResult,
  type SaveFileRequest,
  type SaveFileResult,
  type SectionData,
} from "../../shared/ipc.js";
import {
  recordDirtyChanged,
  recordFileOpened,
  recordFileSaved,
} from "../sessionLockfile.js";
import {
  armFileWatch,
  beginSelfWrite,
  disarmFileWatch,
  endSelfWrite,
  noteSelfWrite,
} from "../fileWatcher.js";
import { controlPlanIsEmpty } from "../../shared/cpEmpty.js";
import { readContractDefaults } from "./defaults.js";
import { setDirty } from "./dirtyState.js";
import {
  groupControlPlanHeaders,
  groupControlPlanRows,
  safeMtimeMs,
  withHandleForWrite,
} from "./shared.js";

ipcMain.handle(Channels.openFileDialog, async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Molio file",
    properties: ["openFile"],
    filters: [
      {
        name: "Molio files",
        extensions: ["moliospec", "mspec", "mspectpl", "sqlite"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(
  Channels.openFile,
  async (_event, path: string): Promise<FilePayload> => {
    console.log("[main] openFile start:", path);
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    try {
      // `migrate: true` upgrades a pre-01.00.03 file to the current
      // schema — on the temp copy only, never on the user's file. This
      // is what stops the old "no such table: contracts" save failure:
      // once the schema is complete, the write path has nothing missing
      // to trip over. Task 1 / M1.
      handle = await openMoliospec(path, { migrate: true });
      console.log("[main] openMoliospec ok", {
        migrated: handle.migration?.migrated ?? false,
      });

      const file = readMoliospec(handle);
      console.log("[main] readMoliospec ok", {
        dbVersion: file.dbVersion,
        workSpecs: file.workSpecs.length,
        bdbs: file.constructionElementSpecs.length,
        controlPlans: file.controlPlans.length,
        workSpecSections: file.workSpecSections.length,
        bdbSections: file.constructionElementSpecSections.length,
      });

      // Group sections by their parent spec. Sort by section_no so the UI can
      // render them in the file's natural order without re-sorting.
      const sectionsByWorkSpec: Record<number, SectionData[]> = {};
      for (const s of [...file.workSpecSections].sort(
        (a, b) => a.section_no - b.section_no,
      )) {
        (sectionsByWorkSpec[s.work_spec_id] ??= []).push({
          id: s.id,
          sectionNo: s.section_no,
          heading: s.heading,
          body: s.body,
          parentId: s.parent_id,
          // work_spec_section has no pfbb_section_id column — always null.
          pfbbSectionId: null,
        });
      }

      const sectionsByBdb: Record<number, SectionData[]> = {};
      for (const s of [...file.constructionElementSpecSections].sort(
        (a, b) => a.section_no - b.section_no,
      )) {
        (sectionsByBdb[s.construction_element_spec_id] ??= []).push({
          id: s.id,
          sectionNo: s.section_no,
          heading: s.heading,
          body: s.body,
          parentId: s.parent_id,
          pfbbSectionId: s.pfbb_section_id,
        });
      }
      console.log("[main] grouped sections ok");

      // Capture mtime alongside the data so the renderer can later detect
      // if another program writes to the file while we have it open.
      const mtimeMs = (await safeMtimeMs(path)) ?? 0;

      // Group the CP detail rows once: we both expose the map to the
      // renderer and use it to flag empty control plans (#255).
      const cpRowsByPlan = groupControlPlanRows(file.controlPlanSections);

      const migration = handle.migration;
      const payload: FilePayload = {
        path,
        dbVersion: file.dbVersion,
        // Non-null only when this open actually converted something.
        // The renderer uses it for two things: the dialog the user has
        // to click away, and routing Save to "Save as".
        schemaUpgrade:
          migration && migration.migrated
            ? {
                fromVersion: migration.fromVersion,
                toVersion: migration.toVersion,
                losesControlPlanLinks: migration.losesControlPlanLinks,
                droppedControlPlanLinks: migration.droppedControlPlanLinks,
              }
            : null,
        mtimeMs,
        project: file.project
          ? {
              projectGuid: file.project.project_guid,
              name: file.project.name,
              projectNumber: file.project.project_number,
              builder: file.project.builder,
              createdBySystem: file.project.created_by_system,
              createdDate: file.project.created_date,
              modifiedDate: file.project.modified_date,
              moliioReferencelistDate: file.project.molio_referencelist_date,
            }
          : null,
        workSpecs: file.workSpecs.map((w) => ({
          id: w.id,
          workAreaCode: w.work_area_code,
          workAreaName: w.work_area_name,
          workAreaType: w.work_area_type,
          revision: w.revision,
          revisionDate: w.revision_date,
          contractId: w.contract_id,
          refs: {
            basisGuid: w.molio_spec_guid,
            basisRevisionGuid: w.molio_spec_revision_guid,
            paradigmGuid: w.molio_work_spec_paradigm_guid,
            paradigmRevisionGuid: w.molio_work_spec_paradigm_revision_guid,
            referencelistArea: w.molio_referencelist_area,
            referencelistAreaDate: w.molio_referencelist_area_date,
          },
          // Slice 10E — editable & locked metadata surfaces.
          createdBy: w.created_by,
          createdByOrganization: w.created_by_organization,
          issueDate: w.issue_date,
          reviewedBy: w.reviewed_by,
          approvedBy: w.approved_by,
          locked: {
            molioSpecRevisionNo: w.molio_spec_revision_no,
            molioSpecRevisionDate: w.molio_spec_revision_date,
          },
        })),
        bdbs: file.constructionElementSpecs.map((b) => {
          // The schema stores controlplan_design_id / controlplan_production_id
          // as TEXT. In practice Molio tools write them as the string form of
          // the control_plan.id integer — so we parse and check membership.
          // If the mapping is something else in real files (e.g. a GUID), this
          // simply returns an empty array and we see it in the tree.
          const cpIds = new Set(file.controlPlans.map((c) => c.id));
          const refs: number[] = [];
          for (const raw of [
            b.controlplan_design_id,
            b.controlplan_production_id,
          ]) {
            if (raw == null) continue;
            const asNum = Number.parseInt(raw, 10);
            if (Number.isFinite(asNum) && cpIds.has(asNum)) refs.push(asNum);
          }
          return {
            id: b.id,
            name: b.name,
            workSpecId: b.work_spec_id,
            isPfbb: b.is_pfbb !== 0,
            pfbbId: b.pfbb_id ?? null,
            revision: b.revision,
            revisionDate: b.revision_date,
            controlPlanIds: refs,
            refs: {
              basisGuid: b.molio_spec_guid,
              basisRevisionGuid: b.molio_spec_revision_guid,
              // BDB paradigm fields don't exist in the construction-element schema —
              // the paradigm concept is work-area-only. Keep null here so the UI
              // can just hide the paradigm row on BDB sub-tabs.
              paradigmGuid: null,
              paradigmRevisionGuid: null,
              referencelistArea: b.molio_referencelist_area,
              referencelistAreaDate: b.molio_referencelist_area_date,
            },
            // Slice 10E — editable & locked metadata surfaces.
            createdBy: b.created_by,
            createdByOrganization: b.created_by_organization,
            issueDate: b.issue_date,
            reviewedBy: b.reviewed_by,
            approvedBy: b.approved_by,
            locked: {
              molioSpecRevisionNo: b.molio_spec_revision_no,
              molioSpecRevisionDate: b.molio_spec_revision_date,
              controlplanDesignId: b.controlplan_design_id,
              controlplanProductionId: b.controlplan_production_id,
              commonControlplanDesignGuid: b.common_controlplan_design_guid,
              commonControlplanProductionGuid:
                b.common_controlplan_production_guid,
              molioConstructionElementSpecGuid:
                b.molio_construction_element_spec_guid,
              molioConstructionElementSpecRevisionGuid:
                b.molio_construction_element_spec_revision_guid,
              molioConstructionElementSpecRevisionNo:
                b.molio_construction_element_spec_revision_no,
              molioConstructionElementSpecRevisionDate:
                b.molio_construction_element_spec_revision_date,
            },
          };
        }),
        controlPlans: file.controlPlans.map((c) => ({
          id: c.id,
          numberText: c.number_text,
          title: c.title,
          controlPlanType: c.control_plan_type,
          revision: c.revision,
          revisionDate: c.revision_date,
          isEmpty: controlPlanIsEmpty(cpRowsByPlan[c.id] ?? []),
        })),
        contracts: file.contracts.map<ContractInfo>((c) => ({
          id: c.id,
          contractCode: c.contract_code,
          contractName: c.contract_name,
        })),
        sectionsByWorkSpec,
        sectionsByBdb,
        cpHeadersByPlan: groupControlPlanHeaders(
          file.controlPlanSectionHeaders,
        ),
        cpRowsByPlan,
        // Slice 10K — expose attachment summaries (no bytes) so the
        // Attachments modal can list them without an extra round-trip.
        attachments: file.attachments.map<AttachmentInfo>((a) => ({
          id: a.id,
          workSpecId: a.work_spec_id ?? 0,
          name: a.name,
          mimeType: a.mime_type,
          attachmentTypeId: a.attachment_type_id,
          byteLength: a.content.byteLength,
          sha1Hex: (a.sha1_hash ?? Buffer.alloc(0)).toString("hex"),
        })),
        // Slice 10I — surface `custom_data` rows read-only. Values are
        // stored as BLOB, so we base64-encode for IPC (Node Buffers
        // don't cross Electron IPC cleanly). Usually this array is
        // empty; non-empty means a third-party tool stashed something
        // in the file that we want the user to be aware of.
        customData: file.customData.map<CustomDataEntryInfo>((e) => ({
          key: e.key,
          valueBase64: e.value.toString("base64"),
          byteLength: e.value.byteLength,
        })),
      };

      // Rough serialization-size check: if IPC chokes on the payload we want to
      // know here rather than via a silent window-gone.
      try {
        const bytes = JSON.stringify(payload).length;
        console.log("[main] payload JSON bytes:", bytes);
      } catch (err) {
        console.error("[main] payload not JSON-serializable:", err);
        throw err;
      }

      // Update the active-session lockfile so the MCP server can see
      // which file is currently open in the editor (used to warn the
      // AI before overwriting on disk).
      recordFileOpened(path);

      console.log("[main] openFile returning payload");
      return payload;
    } catch (err) {
      console.error("[main] openFile failed:", err);
      throw err;
    } finally {
      // Close-after-read: renderer holds the data, main process holds nothing.
      if (handle) {
        try {
          await handle.close();
          console.log("[main] handle closed");
        } catch (err) {
          console.error("[main] handle.close failed:", err);
        }
      }
    }
  },
);

/*
 * Note on crash safety (H1, previously the local `atomicSaveAs` helper
 * here): writing to a sibling temp file and renaming it over the target
 * now happens inside core's `handle.saveAs()`, so EVERY save in the app
 * inherits it instead of only the two handlers below. See
 * `packages/core/src/atomicReplace.ts`.
 */

/**
 * Save the current file back to disk (Phase 6 Slice A+B).
 *
 * Flow:
 *   1. Stat the target; bail with "missing" or "conflict" as appropriate.
 *   2. Open the source file.
 *   3. Run `applyEdits` in a single transaction if the renderer sent any.
 *   4. Atomically write back to the same path (temp file + rename).
 *   5. Close the handle.
 *
 * If applyEdits throws, we abort before the write — the on-disk file
 * stays untouched. The renderer surfaces the error message in its
 * save banner.
 */
ipcMain.handle(
  Channels.saveFile,
  async (_event, req: SaveFileRequest): Promise<SaveFileResult> => {
    console.log("[main] saveFile start:", req.path, {
      force: req.force,
      edits: req.edits?.length ?? 0,
    });

    // 1. Stat check (unless caller forced the write).
    const currentMtimeMs = await safeMtimeMs(req.path);
    if (currentMtimeMs === null) {
      console.warn("[main] saveFile: source missing", req.path);
      return { kind: "missing" };
    }
    if (!req.force && currentMtimeMs !== req.storedMtimeMs) {
      console.log("[main] saveFile: conflict", {
        stored: req.storedMtimeMs,
        current: currentMtimeMs,
      });
      return { kind: "conflict", currentMtimeMs };
    }

    // 2. Open → applyEdits → saveAs → close. Edits may be empty (plain
    //    round-trip save) which is fine — applyEdits returns fast.
    //
    //    RELOAD-2: bracket the whole write in beginSelfWrite/endSelfWrite
    //    so the file watcher doesn't mistake our own save for an
    //    external change.
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    beginSelfWrite();
    try {
      // Opened WITHOUT migrate on purpose: this handler overwrites the
      // file in place, and an old file must never be converted in
      // place. If it turns out to be old, we refuse and let the
      // renderer run "Save as" instead. Task 1 / M1.
      handle = await openMoliospec(req.path);
      const plan = planMigration(handle);
      if (plan.needed) {
        console.log("[main] saveFile: refusing in-place save of legacy file", {
          path: req.path,
          fromVersion: plan.fromVersion,
        });
        return { kind: "needsSaveAs", fromVersion: plan.fromVersion };
      }
      if (req.edits && req.edits.length > 0) {
        const result = applyEdits(handle, req.edits);
        console.log("[main] applyEdits ok", result);

        // Slice 10H.6c — auto-move on isPfbb 0→1 transitions.
        // For every BDB whose edit set is_pfbb to 1, ensure it lives in
        // the virtual "Projektfælles bygningsdelsbeskrivelser" work_spec
        // (creating that row on the fly if missing). Idempotent per BDB,
        // so if the user toggled isPfbb back and forth without saving,
        // or the BDB was already in the virtual row, this is a no-op.
        // We deliberately do NOT run the full orphan sweep here — that
        // would override a "Not now" dismissal on the 10H.6b banner.
        for (const e of req.edits) {
          if (e.target !== "bdbMetadata") continue;
          if (e.isPfbb !== 1) continue;
          const mv = moveBdbToVirtualWorkSpec(handle, e.id);
          if (mv.moved) {
            console.log("[main] saveFile: PFBB auto-move", {
              bdbId: e.id,
              virtualWorkSpecId: mv.virtualWorkSpecId,
              createdVirtual: mv.createdVirtual,
            });
          }
        }
      }
      await handle.saveAs(req.path);
      const newMtimeMs = (await safeMtimeMs(req.path)) ?? Date.now();
      console.log("[main] saveFile ok", { newMtimeMs });
      // RELOAD-2: advance the watcher's baseline to the mtime we just
      // wrote, so the next poll sees "no change".
      noteSelfWrite(req.path, newMtimeMs);
      // Refresh the lockfile — path is unchanged on a regular save
      // but we re-write to bump updatedAt + keep pid current.
      recordFileSaved(req.path);
      return { kind: "saved", mtimeMs: newMtimeMs };
    } catch (err) {
      console.error("[main] saveFile failed:", err);
      throw err;
    } finally {
      endSelfWrite();
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] saveFile: handle.close failed:", err);
        }
      }
    }
  },
);

/**
 * Save As — show an OS save dialog, write the file at the chosen
 * destination, return the new path + mtime. Slice #41.
 *
 * Differences from the regular `saveFile`:
 *   - No mtime conflict check. The user is explicitly choosing a new
 *     path; if it happens to already exist, the OS dialog already
 *     prompts about overwriting.
 *   - If the user dismisses the dialog we return `cancelled` rather
 *     than throwing — the renderer treats it as a no-op (no banner).
 *
 * Implementation: open the source file, applyEdits, then `saveAs` to
 * the new path. The original file stays untouched until the renderer
 * decides what to do with it (typically: switch the tab to the new
 * path, then keep editing).
 */
ipcMain.handle(
  Channels.saveFileAs,
  async (_event, req: SaveFileAsRequest): Promise<SaveFileAsResult> => {
    console.log("[main] saveFileAs start:", {
      suggestedName: req.suggestedName,
      edits: req.edits?.length ?? 0,
    });

    const dialogResult = await dialog.showSaveDialog({
      title: "Save Molio file as…",
      defaultPath: req.suggestedName,
      filters: [
        { name: "Molio files", extensions: ["moliospec"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { kind: "cancelled" };
    }
    const targetPath = dialogResult.filePath;
    console.log("[main] saveFileAs target:", targetPath);

    // The renderer always passes the *current* file's path as the
    // source. Save-As is only a thing when a file is open, so we can
    // recover that from the renderer side. To keep the IPC contract
    // narrow we don't take the source path here — the renderer is
    // expected to send a fresh edit set against a known-open file. We
    // open `targetPath` if it exists, otherwise create-and-write it
    // empty first by serializing from a temp source.
    //
    // Simpler approach for the MVP: write the renderer's full payload
    // to a fresh handle on `targetPath` directly. We don't need to
    // re-read the source — the renderer has the data it wants saved
    // already in `edits`.
    //
    // …but applyEdits needs a source DB to apply ON TOP of. So we
    // need a source path. The cleanest extension is to add `path` to
    // SaveFileAsRequest. Done in the IPC type. Read it here.
    // RELOAD-2: same self-write bracket as saveFile — Save As may
    // even target the file the watcher is currently pointed at.
    let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;
    beginSelfWrite();
    try {
      // This is the one path where converting an old file is correct:
      // the user picked a new destination, so the original stays as
      // their copy of the old format. Task 1 / M1.
      handle = await openMoliospec(req.sourcePath, { migrate: true });
      if (handle.migration?.migrated) {
        console.log("[main] saveFileAs: upgraded schema on the way out", {
          from: handle.migration.fromVersion,
          to: handle.migration.toVersion,
          droppedControlPlanLinks: handle.migration.droppedControlPlanLinks,
        });
      }
      if (req.edits && req.edits.length > 0) {
        const result = applyEdits(handle, req.edits);
        console.log("[main] saveFileAs applyEdits ok", result);
        for (const e of req.edits) {
          if (e.target !== "bdbMetadata") continue;
          if (e.isPfbb !== 1) continue;
          const mv = moveBdbToVirtualWorkSpec(handle, e.id);
          if (mv.moved) {
            console.log("[main] saveFileAs: PFBB auto-move", {
              bdbId: e.id,
              virtualWorkSpecId: mv.virtualWorkSpecId,
              createdVirtual: mv.createdVirtual,
            });
          }
        }
      }
      // A migrated file goes out gzipped whatever the source was: it is
      // a new 01.00.04 `.moliospec`, and Molio ships those gzipped.
      // Without this an old raw `.sqlite` would be written as raw bytes
      // under a `.moliospec` name.
      await handle.saveAs(targetPath, {
        gzip: handle.migration?.migrated ? true : undefined,
      });
      const newMtimeMs = (await safeMtimeMs(targetPath)) ?? Date.now();
      console.log("[main] saveFileAs ok", { targetPath, newMtimeMs });
      // RELOAD-2: if the watcher happens to be on this path, sync its
      // baseline. (Usually a no-op — Save As writes a different file.)
      noteSelfWrite(targetPath, newMtimeMs);
      // Save As changes the active path — keep the lockfile in sync
      // so the MCP server now sees the new path as "the open file".
      recordFileSaved(targetPath);
      return { kind: "ok", path: targetPath, mtimeMs: newMtimeMs };
    } catch (err) {
      console.error("[main] saveFileAs failed:", err);
      throw err;
    } finally {
      endSelfWrite();
      if (handle) {
        try {
          await handle.close();
        } catch (err) {
          console.error("[main] saveFileAs: handle.close failed:", err);
        }
      }
    }
  },
);

/**
 * Renderer → main: update our cached dirty flag. Used by the window
 * close handler (in main/index.ts) to decide whether to prompt the
 * user. Kept intentionally fire-and-forget.
 */
ipcMain.on(Channels.setDirty, (_event, dirty: boolean) => {
  setDirty(dirty);
  // Reflect the dirty state in the lockfile so the MCP server can
  // tell whether a save would clobber pending UI edits.
  recordDirtyChanged(dirty);
});

/**
 * RELOAD-2 — point the file watcher at the currently-open file.
 *
 * The renderer re-sends this on every open / save / reload so the
 * watcher's baseline mtime stays in sync. A null path (or a
 * non-positive mtime, which means "no real file") disarms the watch
 * entirely — e.g. when the user is back on the Welcome screen.
 */
ipcMain.on(
  Channels.watchActiveFile,
  (_event, req: { path: string | null; mtimeMs: number }) => {
    if (req.path && req.mtimeMs > 0) {
      armFileWatch(req.path, req.mtimeMs);
    } else {
      disarmFileWatch();
    }
  },
);

/* ------------------------------------------------------------------ */
/*  IMP-API — Start from scratch                                      */
/* ------------------------------------------------------------------ */

/**
 * Locate the bundled `blank.moliospec` template. Two search paths
 * cover both dev (`electron-vite dev`) and packaged builds:
 *
 *   1. `<resources>/blank.moliospec` — production. Electron-builder
 *      copies anything listed under `extraResources` into the app
 *      bundle's resources folder, exposed at `process.resourcesPath`.
 *   2. `<repo>/packages/app/resources/blank.moliospec` — dev. The
 *      asset lives in the source tree and isn't copied anywhere by
 *      electron-vite, so we reach it relative to `app.getAppPath()`.
 */
function locateBlankTemplate(): string | null {
  const candidates = [
    join(process.resourcesPath ?? "", "blank.moliospec"),
    join(app.getAppPath(), "resources", "blank.moliospec"),
    // Workspace fallback — useful when the renderer is served by
    // `electron-vite dev` from the source tree.
    join(
      app.getAppPath(),
      "..",
      "..",
      "packages",
      "app",
      "resources",
      "blank.moliospec",
    ),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

ipcMain.handle(
  Channels.createEmptyProject,
  async (): Promise<CreateEmptyProjectResult> => {
    const blank = locateBlankTemplate();
    if (!blank) {
      return {
        kind: "error",
        message:
          "blank.moliospec template not found. The app bundle is missing a required resource.",
      };
    }
    const result = await dialog.showSaveDialog({
      title: "New Molio project",
      defaultPath: "Untitled.moliospec",
      filters: [
        { name: "Molio files", extensions: ["moliospec"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { kind: "cancelled" };
    }
    try {
      // Plain byte copy: the bundled file is already a valid
      // gzipped SQLite with empty content tables + a placeholder
      // project row. The renderer follows up with `openFile(path)`
      // for the same load path it uses for any other file.
      copyFileSync(blank, result.filePath);
      // #250 — seed the user's default contracts into the fresh project so
      // a new project starts with the standard "fagentrepriser". Reads the
      // user's editable CSV (or the shipped default on first run). Failure
      // here is non-fatal: the empty project is still valid.
      try {
        const defaults = readContractDefaults();
        if (defaults.length > 0) {
          await withHandleForWrite(result.filePath, (h) => {
            for (const row of defaults) {
              createContract(h, {
                contractCode: row.code,
                contractName: row.name,
              });
            }
          });
        }
      } catch (err) {
        console.error(
          "[main] createEmptyProject: seeding default contracts failed:",
          err,
        );
      }
      return { kind: "ok", path: result.filePath };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
);
