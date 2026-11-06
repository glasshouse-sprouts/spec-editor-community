/**
 * Task 106 - main does not trust paths and file names from the renderer.
 *
 * Three layers:
 *   1. The rules themselves (pathGuards.ts, shared/fileNames.ts).
 *   2. Every IPC handler that takes a path refuses a bad one before it
 *      touches the disk. The handlers are registered against a fake
 *      ipcMain and called directly, as a compromised renderer could.
 *   3. The MCP export's output folder and file names - those tests
 *      are in mcpExportBridge.test.ts, because the Community export
 *      removes the MCP export handler and that test file with it.
 *
 * Card 106's acceptance test, point by point:
 *   1. a fileBase with ../ is refused in main         -> "batch exports"
 *   2. a fileBase with / or \ or NUL is refused        -> "isSafeFileBase"
 *   3. a path with the wrong extension is refused by
 *      every path channel                              -> "every channel"
 *   4. Danish letters and spaces still work            -> both layers
 */
import { describe, expect, it, vi } from "vitest";

const spy = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => unknown>(),
  dialogOpened: 0,
  opened: [] as string[],
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => {
      spy.handlers.set(ch, fn);
    },
    on: () => {},
  },
  app: {
    getPath: () => "/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
    getAppPath: () => "/tmp",
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: async () => {
      spy.dialogOpened++;
      return { canceled: true, filePaths: [] };
    },
    showSaveDialog: async () => {
      spy.dialogOpened++;
      return { canceled: true };
    },
  },
  shell: { openPath: async () => "" },
}));

// Any path that gets past a guard would reach core's openMoliospec.
vi.mock("@molio2-editor/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openMoliospec: async (p: string) => {
    spy.opened.push(p);
    throw new Error("openMoliospec must not be reached in this test");
  },
}));

const { assertMoliospecPath, PathRejectedError } =
  await import("../src/main/pathGuards.js");
const { isSafeFileBase, sanitiseFilePart } =
  await import("../src/shared/fileNames.js");
const { Channels } = await import("../src/shared/ipc.js");
await import("../src/main/handlers/attachments.js");
await import("../src/main/handlers/bdb.js");
await import("../src/main/handlers/contract.js");
await import("../src/main/handlers/cp.js");
await import("../src/main/handlers/import.js");
await import("../src/main/handlers/file.js");
await import("../src/main/handlers/cover.js");
await import("../src/main/handlers/pdf.js");
await import("../src/main/handlers/docx.js");

const GOOD = "/Users/test/Projekter/Skole på Åvej - fase 2.moliospec";

describe("assertMoliospecPath", () => {
  it.each([
    GOOD,
    "/x/fil.MOLIOSPEC",
    "/x/gammel.sqlite",
    "/x/skabelon.mspectpl",
    "/x/fil.mspec",
  ])("accepts %j", (p) => {
    expect(assertMoliospecPath(p)).toBe(p);
  });

  it.each([
    ["no path", ""],
    ["not a string", 42],
    ["relative", "Projekter/fil.moliospec"],
    ["parent dir", "/x/../etc/fil.moliospec"],
    ["NUL byte", "/x/fil.moliospec\0.txt"],
    ["wrong extension", "/x/passwd"],
    ["text file", "/x/noter.txt"],
    ["a folder", "/Users/test/Projekter"],
  ])("refuses %s", (_name, p) => {
    expect(() => assertMoliospecPath(p)).toThrow(PathRejectedError);
  });
});

describe("isSafeFileBase (the file names main joins onto a folder)", () => {
  it.each([
    "Projekt_S215.01 Beton - Råhus",
    "Skole på Åvej (2)",
    "a..b",
    sanitiseFilePart('S215/01 "Beton"'),
  ])("accepts %j", (b) => {
    expect(isSafeFileBase(b)).toBe(true);
  });

  it.each(["../evil", "..", ".", "a/b", "a\\b", "a\0b", "C:evil", "", "   "])(
    "refuses %j",
    (b) => {
      expect(isSafeFileBase(b)).toBe(false);
    },
  );
});

describe("every path channel refuses a bad path before touching the disk", () => {
  const C = Channels as unknown as Record<string, string>;
  /** channel -> how to put a bad path into its request. */
  const cases: Array<[string, (bad: string) => unknown]> = [
    ...[
      "addAttachment",
      "deleteAttachment",
      "replaceAttachment",
      "renameAttachment",
      "moveAttachment",
      "openAttachment",
      "readAttachmentBytes",
      "duplicateBdb",
      "createPfbbChild",
      "migrateOrphanPfbbMasters",
      "deleteWorkArea",
      "deleteBdb",
      "getDeleteImpact",
      "createContract",
      "seedDefaultContracts",
      "deleteContract",
      "createCp",
      "duplicateCp",
      "moveCp",
      "deleteCp",
      "addCpRow",
      "deleteCpRow",
      "addCpHeader",
      "deleteCpHeader",
      "saveFile",
      "fillEmptyWorkSpec",
    ].map(
      (name) =>
        [C[name]!, (bad: string) => ({ path: bad, sourcePath: GOOD })] as [
          string,
          (bad: string) => unknown,
        ],
    ),
    [C["fillEmptyWorkSpec"]!, (bad) => ({ path: GOOD, sourcePath: bad })],
    [C["openFile"]!, (bad) => bad],
    [C["saveFileAs"]!, (bad) => ({ sourcePath: bad, edits: [] })],
    ["import:precheck", (bad) => ({ sourcePath: bad, targetPath: GOOD })],
    ["import:precheck", (bad) => ({ sourcePath: GOOD, targetPath: bad })],
    ["import:read-source", (bad) => ({ sourcePath: bad })],
    ["import:apply", (bad) => ({ sourcePath: bad, path: GOOD })],
    ["import:apply", (bad) => ({ sourcePath: GOOD, path: bad })],
    ["cover:find-sibling", (bad) => ({ moliospecPath: bad })],
  ];

  it("covers 32 path channels (the 33rd, cover:read-template, below)", () => {
    expect(new Set(cases.map(([ch]) => ch)).size).toBe(32);
    for (const [ch] of cases) expect(spy.handlers.has(ch), ch).toBe(true);
  });

  for (const bad of [
    "/etc/passwd",
    "relative.moliospec",
    "/x/../y.moliospec",
  ]) {
    it(`refuses ${JSON.stringify(bad)} on every one`, async () => {
      for (const [ch, req] of cases) {
        spy.opened.length = 0;
        await expect(
          Promise.resolve().then(() => spy.handlers.get(ch)!({}, req(bad))),
          ch,
        ).rejects.toThrow(PathRejectedError);
        expect(spy.opened, ch).toEqual([]);
      }
    });
  }

  it("cover:read-template refuses a relative .speccustom path", async () => {
    await expect(
      Promise.resolve().then(() =>
        spy.handlers.get("cover:read-template")!({}, { path: "a.speccustom" }),
      ),
    ).rejects.toThrow(PathRejectedError);
  });
});

describe("batch exports refuse unsafe file names before anything happens", () => {
  for (const ch of ["pdf:save-batch", "docx:save-batch"]) {
    it(`${ch}: "../" is refused before the folder dialog opens`, async () => {
      spy.dialogOpened = 0;
      const items = [
        { fileBase: "Projekt_Råhus", bytes: new Uint8Array([1]) },
        { fileBase: "../../Startup/evil", bytes: new Uint8Array([1]) },
      ];
      await expect(
        Promise.resolve().then(() => spy.handlers.get(ch)!({}, { items })),
      ).rejects.toThrow(PathRejectedError);
      expect(spy.dialogOpened).toBe(0);
    });

    it(`${ch}: Danish names with spaces still reach the dialog`, async () => {
      spy.dialogOpened = 0;
      const items = [
        { fileBase: "Skole på Åvej - Råhus", bytes: new Uint8Array([1]) },
      ];
      const res = await spy.handlers.get(ch)!({}, { items });
      expect(spy.dialogOpened).toBe(1);
      expect(res).toEqual({ kind: "cancelled" });
    });
  }
});
