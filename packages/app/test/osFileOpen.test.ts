/**
 * Task 83 — tests for the OS "open this file" plumbing.
 *
 * Two things are worth pinning down here:
 *
 *   1. The argv matcher. Electron's command line is noisy — the
 *      executable, a script path in dev, a varying set of Chromium
 *      switches — and on Windows this is the ONLY way the path
 *      reaches us while the app runs. A matcher that is too generous
 *      opens whatever happens to be lying in argv; one that is too
 *      strict silently does nothing, which is the bug we are fixing.
 *   2. That the module takes the single-instance lock and stands down
 *      when it does not get it. Without the lock, a double-click on a
 *      running app starts a rival copy and the file opens in the
 *      wrong window.
 *
 * Electron is mocked — these tests run in plain Node, and the real
 * `app` object only exists inside a running Electron process.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  app: {
    on: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn((): unknown[] => []),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 2 })),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock("electron", () => electronMock);

const { initOsFileOpen, moliospecPathFromArgv, takePendingOpenPath } =
  await import("../src/main/osFileOpen.js");

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.app.requestSingleInstanceLock.mockReturnValue(true);
  electronMock.BrowserWindow.getAllWindows.mockReturnValue([]);
});

describe("moliospecPathFromArgv", () => {
  it("finds the file a Windows double-click puts on the command line", () => {
    expect(
      moliospecPathFromArgv([
        "C:\\Program Files\\bskriver\\bskriver.exe",
        "C:\\Users\\me\\Projekter\\hus.moliospec",
      ]),
    ).toBe("C:\\Users\\me\\Projekter\\hus.moliospec");
  });

  it("ignores Chromium switches and the executable itself", () => {
    expect(
      moliospecPathFromArgv([
        "/Applications/bskriver.app/Contents/MacOS/bskriver",
        "--allow-file-access-from-files",
        "--user-data-dir=/tmp/whatever.moliospec",
      ]),
    ).toBe(null);
  });

  it("is null for an ordinary launch with no file", () => {
    expect(moliospecPathFromArgv(["/usr/bin/bskriver"])).toBe(null);
    expect(moliospecPathFromArgv([])).toBe(null);
  });

  it("only accepts our own extension", () => {
    expect(moliospecPathFromArgv(["/bin/app", "/Users/me/notes.txt"])).toBe(
      null,
    );
    // Legacy Molio samples are plain .sqlite. The installers do not
    // claim that extension, so the OS never hands one to us this way
    // and we do not guess.
    expect(
      moliospecPathFromArgv(["/bin/app", "/Users/me/old-project.sqlite"]),
    ).toBe(null);
  });

  it("is case-insensitive about the extension", () => {
    expect(moliospecPathFromArgv(["/bin/app", "/Users/me/Hus.MOLIOSPEC"])).toBe(
      "/Users/me/Hus.MOLIOSPEC",
    );
  });

  it("takes the first file when several are passed", () => {
    expect(
      moliospecPathFromArgv([
        "/bin/app",
        "/a/one.moliospec",
        "/a/two.moliospec",
      ]),
    ).toBe("/a/one.moliospec");
  });

  it("resolves a relative path against the launching directory", () => {
    expect(
      moliospecPathFromArgv(["/bin/app", "demo.moliospec"], "/Users/me/work"),
    ).toBe("/Users/me/work/demo.moliospec");
  });

  it("survives junk in the argv array", () => {
    expect(
      moliospecPathFromArgv([
        "/bin/app",
        undefined as unknown as string,
        42 as unknown as string,
        "/a/one.moliospec",
      ]),
    ).toBe("/a/one.moliospec");
  });
});

describe("initOsFileOpen", () => {
  it("takes the lock and registers the handlers on the first instance", () => {
    expect(initOsFileOpen()).toBe(true);
    expect(electronMock.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    const events = electronMock.app.on.mock.calls.map(([name]) => name);
    expect(events).toContain("open-file");
    expect(events).toContain("second-instance");
    expect(electronMock.app.quit).not.toHaveBeenCalled();
  });

  /**
   * The renderer collects the launch file by asking, so the channel
   * has to be answerable from the moment the app starts — before
   * `ready`, and certainly before the window exists.
   */
  it("registers the channel the renderer collects the launch file on", () => {
    initOsFileOpen();
    const channels = electronMock.ipcMain.handle.mock.calls.map(
      ([name]) => name,
    );
    expect(channels).toContain("app:take-pending-open-path");
  });

  it("stands down when another copy already holds the lock", () => {
    electronMock.app.requestSingleInstanceLock.mockReturnValue(false);
    expect(initOsFileOpen()).toBe(false);
    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
    // No second-instance listener on a process that is quitting.
    const events = electronMock.app.on.mock.calls.map(([name]) => name);
    expect(events).not.toContain("second-instance");
  });
});

describe("takePendingOpenPath", () => {
  /**
   * "Take" is the whole point. A reload remounts the renderer, which
   * asks again; if main kept answering with the same path, the file
   * would reopen underneath the user every time — including right
   * after they deliberately opened something else.
   */
  it("answers at most once for a given launch", () => {
    // A launch with no file: nothing to hand over, ever.
    initOsFileOpen();
    expect(takePendingOpenPath()).toBe(null);
    expect(takePendingOpenPath()).toBe(null);
  });
});
