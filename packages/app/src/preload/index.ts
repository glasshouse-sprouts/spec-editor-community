/**
 * Preload script.
 *
 * Runs in a privileged but isolated context. Its only job is to expose a
 * narrow, typed API to the renderer via `contextBridge`. The renderer NEVER
 * gets raw `ipcRenderer` — that would be a security escape hatch.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
  Channels,
  type AddAttachmentRequest,
  type AddAttachmentResult,
  type AddCpHeaderRequest,
  type AddCpHeaderResult,
  type AddCpRowRequest,
  type AddCpRowResult,
  type CreateContractRequest,
  type CreateContractResult,
  type CreateCpRequest,
  type CreateCpResult,
  type CreatePfbbChildRequest,
  type CreatePfbbChildResult,
  type MigrateOrphanPfbbMastersRequest,
  type MigrateOrphanPfbbMastersResult,
  type DeleteAttachmentRequest,
  type DeleteAttachmentResult,
  type DuplicateCpRequest,
  type DuplicateCpResult,
  type MoveCpRequest,
  type MoveCpResult,
  type DeleteBdbRequest,
  type DeleteBdbResult,
  type DeleteContractRequest,
  type DeleteContractResult,
  type SeedDefaultContractsRequest,
  type SeedDefaultContractsResult,
  type DefaultsFileRequest,
  type DefaultsFileResult,
  type DeleteCpHeaderRequest,
  type DeleteCpHeaderResult,
  type DeleteCpRequest,
  type DeleteCpResult,
  type DeleteCpRowRequest,
  type DeleteCpRowResult,
  type DeleteWorkAreaRequest,
  type DeleteWorkAreaResult,
  type DuplicateBdbRequest,
  type DuplicateBdbResult,
  type FileChangedOnDiskEvent,
  type FilePayload,
  type GetDeleteImpactRequest,
  type GetDeleteImpactResult,
  type FillEmptyWorkSpecRequest,
  type FillEmptyWorkSpecResult,
  type ImportApplyRequest,
  type ImportApplyResult,
  type ImportPrecheckRequest,
  type ImportPrecheckResult,
  type MolioBridge,
  type ReadImportSourceRequest,
  type ReadImportSourceResult,
  type ReplaceAttachmentRequest,
  type ReplaceAttachmentResult,
  type RenameAttachmentRequest,
  type RenameAttachmentResult,
  type CreateEmptyProjectResult,
  type DownloadMolioFileRequest,
  type DownloadMolioFileResult,
  type LicenseStatus,
  type GetMolioControlPlanRequest,
  type GetMolioControlPlanResult,
  type GetMolioReferenceRequest,
  type GetMolioReferenceResult,
  type GetMolioReferencelistRequest,
  type GetMolioReferencelistResult,
  type ListMolioFilesResult,
  type McpBuildDocxRequest,
  type McpBuildDocxReply,
  type McpBuildPdfsRequest,
  type McpBuildPdfsReply,
  type McpSetActiveFileRequest,
  type McpSetActiveFileReply,
  type MolioConfigView,
  type MoveAttachmentRequest,
  type MoveAttachmentResult,
  type OpenAttachmentRequest,
  type OpenAttachmentResult,
  type ReadAttachmentBytesRequest,
  type ReadAttachmentBytesResult,
  type SetMolioConfigRequest,
  type TestMolioConnectionRequest,
  type TestMolioConnectionResult,
  type GlasshouseSignInRequest,
  type GlasshouseSignInResult,
  type GlasshouseSessionStatus,
  type SaveFileAsRequest,
  type SaveFileAsResult,
  type SaveFileRequest,
  type SaveFileResult,
  type SaveDocxBatchRequest,
  type SaveDocxBatchResult,
  type SaveDocxRequest,
  type SaveDocxResult,
  type SavePdfBatchRequest,
  type SavePdfBatchResult,
  type SavePdfRequest,
  type SavePdfResult,
  type CoverFindSiblingRequest,
  type CoverFindSiblingResult,
  type CoverReadTemplateRequest,
  type CoverReadTemplateResult,
  type CoverSaveTemplateRequest,
  type CoverSaveTemplateResult,
  type CoverOpenTemplateResult,
  type CoverOpenUnderlayResult,
  type CoverPreviewRequest,
  type CoverPreviewResult,
  type CoverCurrentPathResult,
  type MenuAction,
  type UpdateState,
  type InstallUpdateResult,
  type AppInfo,
} from "../shared/ipc.js";
import type { WorkAreaContractMapRow } from "../shared/defaultsCsv.js";

const bridge: MolioBridge = {
  openFileDialog: () =>
    ipcRenderer.invoke(Channels.openFileDialog) as Promise<string | null>,
  openFile: (path: string) =>
    ipcRenderer.invoke(Channels.openFile, path) as Promise<FilePayload>,
  saveFile: (req: SaveFileRequest) =>
    ipcRenderer.invoke(Channels.saveFile, req) as Promise<SaveFileResult>,
  createControlPlan: (req: CreateCpRequest) =>
    ipcRenderer.invoke(Channels.createCp, req) as Promise<CreateCpResult>,
  duplicateControlPlan: (req: DuplicateCpRequest) =>
    ipcRenderer.invoke(Channels.duplicateCp, req) as Promise<DuplicateCpResult>,
  moveControlPlan: (req: MoveCpRequest) =>
    ipcRenderer.invoke(Channels.moveCp, req) as Promise<MoveCpResult>,
  deleteControlPlan: (req: DeleteCpRequest) =>
    ipcRenderer.invoke(Channels.deleteCp, req) as Promise<DeleteCpResult>,
  addControlPlanRow: (req: AddCpRowRequest) =>
    ipcRenderer.invoke(Channels.addCpRow, req) as Promise<AddCpRowResult>,
  deleteControlPlanRow: (req: DeleteCpRowRequest) =>
    ipcRenderer.invoke(Channels.deleteCpRow, req) as Promise<DeleteCpRowResult>,
  addControlPlanHeader: (req: AddCpHeaderRequest) =>
    ipcRenderer.invoke(Channels.addCpHeader, req) as Promise<AddCpHeaderResult>,
  deleteControlPlanHeader: (req: DeleteCpHeaderRequest) =>
    ipcRenderer.invoke(
      Channels.deleteCpHeader,
      req,
    ) as Promise<DeleteCpHeaderResult>,
  duplicateBdb: (req: DuplicateBdbRequest) =>
    ipcRenderer.invoke(
      Channels.duplicateBdb,
      req,
    ) as Promise<DuplicateBdbResult>,
  createPfbbChild: (req: CreatePfbbChildRequest) =>
    ipcRenderer.invoke(
      Channels.createPfbbChild,
      req,
    ) as Promise<CreatePfbbChildResult>,
  migrateOrphanPfbbMasters: (req: MigrateOrphanPfbbMastersRequest) =>
    ipcRenderer.invoke(
      Channels.migrateOrphanPfbbMasters,
      req,
    ) as Promise<MigrateOrphanPfbbMastersResult>,
  createContract: (req: CreateContractRequest) =>
    ipcRenderer.invoke(
      Channels.createContract,
      req,
    ) as Promise<CreateContractResult>,
  deleteContract: (req: DeleteContractRequest) =>
    ipcRenderer.invoke(
      Channels.deleteContract,
      req,
    ) as Promise<DeleteContractResult>,
  seedDefaultContracts: (req: SeedDefaultContractsRequest) =>
    ipcRenderer.invoke(
      Channels.seedDefaultContracts,
      req,
    ) as Promise<SeedDefaultContractsResult>,
  getContractWorkAreaMapping: () =>
    ipcRenderer.invoke(Channels.getContractWorkAreaMapping) as Promise<
      WorkAreaContractMapRow[]
    >,
  openDefaultsFile: (req: DefaultsFileRequest) =>
    ipcRenderer.invoke(
      Channels.openDefaultsFile,
      req,
    ) as Promise<DefaultsFileResult>,
  resetDefaultsFile: (req: DefaultsFileRequest) =>
    ipcRenderer.invoke(
      Channels.resetDefaultsFile,
      req,
    ) as Promise<DefaultsFileResult>,
  addAttachment: (req: AddAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.addAttachment,
      req,
    ) as Promise<AddAttachmentResult>,
  deleteAttachment: (req: DeleteAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.deleteAttachment,
      req,
    ) as Promise<DeleteAttachmentResult>,
  replaceAttachment: (req: ReplaceAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.replaceAttachment,
      req,
    ) as Promise<ReplaceAttachmentResult>,
  renameAttachment: (req: RenameAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.renameAttachment,
      req,
    ) as Promise<RenameAttachmentResult>,
  moveAttachment: (req: MoveAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.moveAttachment,
      req,
    ) as Promise<MoveAttachmentResult>,
  openAttachment: (req: OpenAttachmentRequest) =>
    ipcRenderer.invoke(
      Channels.openAttachment,
      req,
    ) as Promise<OpenAttachmentResult>,
  readAttachmentBytes: (req: ReadAttachmentBytesRequest) =>
    ipcRenderer.invoke(
      Channels.readAttachmentBytes,
      req,
    ) as Promise<ReadAttachmentBytesResult>,
  deleteWorkArea: (req: DeleteWorkAreaRequest) =>
    ipcRenderer.invoke(
      Channels.deleteWorkArea,
      req,
    ) as Promise<DeleteWorkAreaResult>,
  deleteBdb: (req: DeleteBdbRequest) =>
    ipcRenderer.invoke(Channels.deleteBdb, req) as Promise<DeleteBdbResult>,
  getDeleteImpact: (req: GetDeleteImpactRequest) =>
    ipcRenderer.invoke(
      Channels.getDeleteImpact,
      req,
    ) as Promise<GetDeleteImpactResult>,
  // NOTE: literal strings here instead of `Channels.importPrecheck` /
  // `Channels.importApply` — Rollup DCE's those two properties out of the
  // bundled Channels object (see the matching note in main/index.ts).
  importPrecheck: (req: ImportPrecheckRequest) =>
    ipcRenderer.invoke("import:precheck", req) as Promise<ImportPrecheckResult>,
  importApply: (req: ImportApplyRequest) =>
    ipcRenderer.invoke("import:apply", req) as Promise<ImportApplyResult>,
  fillEmptyWorkSpec: (req: FillEmptyWorkSpecRequest) =>
    ipcRenderer.invoke(
      Channels.fillEmptyWorkSpec,
      req,
    ) as Promise<FillEmptyWorkSpecResult>,
  // Literal string for the same Rollup DCE reason as the two import
  // handlers above.
  readImportSource: (req: ReadImportSourceRequest) =>
    ipcRenderer.invoke(
      "import:read-source",
      req,
    ) as Promise<ReadImportSourceResult>,
  // Fire-and-forget — main caches the flag on its end so the close handler
  // can synchronously prompt the user without an extra IPC round-trip at
  // close time.
  setDirty: (dirty: boolean) => {
    ipcRenderer.send(Channels.setDirty, dirty);
  },
  // One-way subscription — main posts on Channels.triggerSaveAndClose when
  // the user picks "Save" in the close-window dialog. Returns a disposer
  // so the renderer can clean up on unmount.
  onTriggerSaveAndClose: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(Channels.triggerSaveAndClose, listener);
    return () => {
      ipcRenderer.removeListener(Channels.triggerSaveAndClose, listener);
    };
  },
  // Task 83 — sibling of the subscription above. Main posts on
  // Channels.triggerSaveAndOpen when the user picks "Save" in the
  // dialog raised by double-clicking a file with unsaved edits open.
  // The payload is the path to open once the save succeeds.
  onTriggerSaveAndOpen: (callback: (path: string) => void) => {
    const listener = (_e: unknown, path: string): void => callback(path);
    ipcRenderer.on(Channels.triggerSaveAndOpen, listener);
    return () => {
      ipcRenderer.removeListener(Channels.triggerSaveAndOpen, listener);
    };
  },
  // Task 83 — "was this app started to open a file?". The renderer
  // asks; main answers once and forgets.
  takePendingOpenPath: () =>
    ipcRenderer.invoke(Channels.takePendingOpenPath) as Promise<string | null>,
  getAppInfo: () => ipcRenderer.invoke(Channels.getAppInfo) as Promise<AppInfo>,
  // Automatic updates. Main owns the state; the renderer subscribes,
  // and can ask for a check or an early restart.
  onUpdateState: (callback: (s: UpdateState) => void) => {
    const listener = (_e: unknown, s: UpdateState): void => callback(s);
    ipcRenderer.on(Channels.updateStateChanged, listener);
    return () => {
      ipcRenderer.removeListener(Channels.updateStateChanged, listener);
    };
  },
  getUpdateState: () =>
    ipcRenderer.invoke(Channels.getUpdateState) as Promise<UpdateState>,
  checkForUpdates: () =>
    ipcRenderer.invoke(Channels.checkForUpdates) as Promise<UpdateState>,
  installUpdateNow: () =>
    ipcRenderer.invoke(
      Channels.installUpdateNow,
    ) as Promise<InstallUpdateResult>,
  closeWindow: () => {
    ipcRenderer.send(Channels.closeWindow);
  },
  // Task 64 — hamburger in the Windows title strip. Fire-and-forget:
  // main pops the installed application menu at these coordinates.
  popupAppMenu: (position?: { x: number; y: number }) => {
    ipcRenderer.send(Channels.popupAppMenu, position);
  },
  // `webUtils.getPathForFile` is Electron's replacement for the removed
  // `File.path` property. It takes the DOM File object the renderer got
  // from a drop event and returns the absolute path on disk. Running it
  // in the preload context is the only place we're allowed to call it —
  // the renderer's sandbox can't see `electron.webUtils`.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  savePdf: (req: SavePdfRequest) =>
    ipcRenderer.invoke(Channels.savePdf, req) as Promise<SavePdfResult>,
  // Literal string here for the same Rollup DCE reason as the import
  // channels above — property-chain on `Channels` gets stripped from
  // the preload bundle if it's the last entry on the object.
  savePdfBatch: (req: SavePdfBatchRequest) =>
    ipcRenderer.invoke("pdf:save-batch", req) as Promise<SavePdfBatchResult>,
  saveDocx: (req: SaveDocxRequest) =>
    ipcRenderer.invoke(Channels.saveDocx, req) as Promise<SaveDocxResult>,
  // Literal-string-safe (same Rollup DCE caveat as savePdfBatch).
  saveDocxBatch: (req: SaveDocxBatchRequest) =>
    ipcRenderer.invoke("docx:save-batch", req) as Promise<SaveDocxBatchResult>,
  saveFileAs: (req: SaveFileAsRequest) =>
    ipcRenderer.invoke(Channels.saveFileAs, req) as Promise<SaveFileAsResult>,
  // Custom cover (#249 COVER). Literal channel strings — same Rollup DCE
  // caveat as savePdfBatch (tail entries get stripped from the bundle).
  coverFindSibling: (req: CoverFindSiblingRequest) =>
    ipcRenderer.invoke(
      "cover:find-sibling",
      req,
    ) as Promise<CoverFindSiblingResult>,
  coverReadTemplate: (req: CoverReadTemplateRequest) =>
    ipcRenderer.invoke(
      "cover:read-template",
      req,
    ) as Promise<CoverReadTemplateResult>,
  coverSaveTemplate: (req: CoverSaveTemplateRequest) =>
    ipcRenderer.invoke(
      "cover:save-template",
      req,
    ) as Promise<CoverSaveTemplateResult>,
  coverOpenTemplate: () =>
    ipcRenderer.invoke(
      "cover:open-template",
    ) as Promise<CoverOpenTemplateResult>,
  coverOpenUnderlay: () =>
    ipcRenderer.invoke(
      "cover:open-underlay",
    ) as Promise<CoverOpenUnderlayResult>,
  coverPreview: (req: CoverPreviewRequest) =>
    ipcRenderer.invoke("cover:preview", req) as Promise<CoverPreviewResult>,
  coverCurrentMoliospecPath: () =>
    ipcRenderer.invoke(
      "cover:current-moliospec-path",
    ) as Promise<CoverCurrentPathResult>,
  // Subscribe to menu-driven actions from the main process. Slice #41.
  onMenuAction: (callback: (action: MenuAction) => void) => {
    const listener = (_e: unknown, action: MenuAction): void =>
      callback(action);
    ipcRenderer.on(Channels.menuAction, listener);
    return () => {
      ipcRenderer.removeListener(Channels.menuAction, listener);
    };
  },
  // Task 71 — the `glasshousespec://signed-up` deep link. No payload:
  // main only ever signals THAT it happened, never anything from the
  // URL. See main/glasshouseDeepLink.ts.
  onGlasshouseSignedUp: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(Channels.glasshouseSignedUpDeepLink, listener);
    return () => {
      ipcRenderer.removeListener(Channels.glasshouseSignedUpDeepLink, listener);
    };
  },
  // RELOAD-2 — point the main-process file watcher at the open file.
  // Fire-and-forget; re-sent on every open / save / reload.
  watchActiveFile: (path: string | null, mtimeMs: number) => {
    ipcRenderer.send(Channels.watchActiveFile, { path, mtimeMs });
  },
  // RELOAD-2 — subscribe to "file changed on disk" events from main.
  onFileChangedOnDisk: (callback: (event: FileChangedOnDiskEvent) => void) => {
    const listener = (_e: unknown, event: FileChangedOnDiskEvent): void =>
      callback(event);
    ipcRenderer.on(Channels.fileChangedOnDisk, listener);
    return () => {
      ipcRenderer.removeListener(Channels.fileChangedOnDisk, listener);
    };
  },
  // EXP-MCP slice: subscribe to "build PDFs" requests from main.
  // The renderer runs the existing PDF build pipeline and replies via
  // `sendMcpBuildPdfsReply`. See main/mcpRequestRenderer.ts for the
  // server side of this handshake.
  onMcpBuildPdfsRequest: (callback: (req: McpBuildPdfsRequest) => void) => {
    const listener = (_e: unknown, req: McpBuildPdfsRequest): void =>
      callback(req);
    ipcRenderer.on(Channels.mcpBuildPdfsRequest, listener);
    return () => {
      ipcRenderer.removeListener(Channels.mcpBuildPdfsRequest, listener);
    };
  },
  sendMcpBuildPdfsReply: (reply: McpBuildPdfsReply) => {
    ipcRenderer.send(Channels.mcpBuildPdfsReply, reply);
  },
  onMcpBuildDocxRequest: (callback: (req: McpBuildDocxRequest) => void) => {
    const listener = (_e: unknown, req: McpBuildDocxRequest): void =>
      callback(req);
    ipcRenderer.on(Channels.mcpBuildDocxRequest, listener);
    return () => {
      ipcRenderer.removeListener(Channels.mcpBuildDocxRequest, listener);
    };
  },
  sendMcpBuildDocxReply: (reply: McpBuildDocxReply) => {
    ipcRenderer.send(Channels.mcpBuildDocxReply, reply);
  },
  // EXP-MCP slice: subscribe to "set active file" requests from main.
  onMcpSetActiveFileRequest: (
    callback: (req: McpSetActiveFileRequest) => void,
  ) => {
    const listener = (_e: unknown, req: McpSetActiveFileRequest): void =>
      callback(req);
    ipcRenderer.on(Channels.mcpSetActiveFileRequest, listener);
    return () => {
      ipcRenderer.removeListener(Channels.mcpSetActiveFileRequest, listener);
    };
  },
  sendMcpSetActiveFileReply: (reply: McpSetActiveFileReply) => {
    ipcRenderer.send(Channels.mcpSetActiveFileReply, reply);
  },
  platform:
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux",
  // Molio API config (Phase 7.5 — MAPI3). Renderer never sees the
  // actual subscription keys; main returns a redacted view.
  getMolioConfig: () =>
    ipcRenderer.invoke(Channels.getMolioConfig) as Promise<MolioConfigView>,
  setMolioConfig: (req: SetMolioConfigRequest) =>
    ipcRenderer.invoke(
      Channels.setMolioConfig,
      req,
    ) as Promise<MolioConfigView>,
  testMolioConnection: (req: TestMolioConnectionRequest) =>
    ipcRenderer.invoke(
      Channels.testMolioConnection,
      req,
    ) as Promise<TestMolioConnectionResult>,
  // RELEASE-A5 — Glasshouse sign-in / sign-out / session status.
  glasshouseSignIn: (req: GlasshouseSignInRequest) =>
    ipcRenderer.invoke(
      Channels.glasshouseSignIn,
      req,
    ) as Promise<GlasshouseSignInResult>,
  glasshouseSignOut: () =>
    ipcRenderer.invoke(Channels.glasshouseSignOut) as Promise<MolioConfigView>,
  glasshouseSessionStatus: () =>
    ipcRenderer.invoke(
      Channels.glasshouseSessionStatus,
    ) as Promise<GlasshouseSessionStatus>,
  getMolioReference: (req: GetMolioReferenceRequest) =>
    ipcRenderer.invoke(
      Channels.getMolioReference,
      req,
    ) as Promise<GetMolioReferenceResult>,
  getMolioReferencelist: (req: GetMolioReferencelistRequest) =>
    ipcRenderer.invoke(
      Channels.getMolioReferencelist,
      req,
    ) as Promise<GetMolioReferencelistResult>,
  getMolioControlPlan: (req: GetMolioControlPlanRequest) =>
    ipcRenderer.invoke(
      Channels.getMolioControlPlan,
      req,
    ) as Promise<GetMolioControlPlanResult>,
  listMolioFiles: () =>
    ipcRenderer.invoke(
      Channels.listMolioFiles,
    ) as Promise<ListMolioFilesResult>,
  downloadMolioFile: (req: DownloadMolioFileRequest) =>
    ipcRenderer.invoke(
      Channels.downloadMolioFile,
      req,
    ) as Promise<DownloadMolioFileResult>,
  createEmptyProject: () =>
    ipcRenderer.invoke(
      Channels.createEmptyProject,
    ) as Promise<CreateEmptyProjectResult>,
  getLicenseStatus: () =>
    ipcRenderer.invoke(Channels.getLicenseStatus) as Promise<LicenseStatus>,
  // Community edition: the MCP server path bridge is removed.
  // PREFS — renderer-prefs storage. The `initial` snapshot is fetched
  // synchronously at preload time (BEFORE the renderer code runs) so
  // hooks with `useState` lazy initializers can read it without
  // refactoring to async.
  prefs: {
    initial: (() => {
      try {
        const v = ipcRenderer.sendSync(Channels.prefsGetAllSync);
        return v && typeof v === "object" && !Array.isArray(v)
          ? (v as Record<string, string>)
          : {};
      } catch {
        // Worst case: renderer boots with defaults.
        return {} as Record<string, string>;
      }
    })(),
    set: (key: string, value: string) =>
      ipcRenderer.invoke(Channels.prefsSet, { key, value }) as Promise<void>,
    delete: (key: string) =>
      ipcRenderer.invoke(Channels.prefsDelete, { key }) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld("molio", bridge);
