/**
 * Tests for how update failures are described to the user.
 *
 * The state machine itself is event plumbing around electron-updater
 * and is only meaningful against a real feed, which is what the
 * two-version acceptance test covers. What IS worth pinning down here
 * is the translation of an error into something a person reads,
 * because two of the three cases are not errors at all:
 *
 *   - a build with no update channel is a fact about the build, not a
 *     fault, and must not show a red error the user cannot act on
 *   - being offline is normal on a laptop and says nothing about the
 *     app being broken
 *
 * Get those wrong and every Community user, and everyone on a train,
 * sees a failure message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
    },
  },
}));

const { describeUpdateError } = await import("../src/main/appUpdater.js");

describe("describeUpdateError", () => {
  it("treats a missing update channel as unsupported, not an error", () => {
    const s = describeUpdateError(
      new Error("ENOENT: no such file or directory, open 'app-update.yml'"),
    );
    expect(s.kind).toBe("unsupported");
  });

  it("says something a person can act on when the network is down", () => {
    for (const msg of [
      "getaddrinfo ENOTFOUND bskriver-releases.s3.fr-par.scw.cloud",
      "connect ECONNREFUSED 1.2.3.4:443",
      "getaddrinfo EAI_AGAIN example",
    ]) {
      const s = describeUpdateError(new Error(msg));
      expect(s.kind).toBe("error");
      // No hostnames, no error codes - the user's move is the same in
      // all three cases: check the connection.
      if (s.kind === "error") {
        expect(s.message).toContain("connection");
        expect(s.message).not.toContain("ENOTFOUND");
      }
    }
  });

  it("passes an unexpected failure through rather than hiding it", () => {
    const s = describeUpdateError(new Error("sha512 checksum mismatch"));
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.message).toContain("sha512");
  });

  it("survives something that is not an Error", () => {
    expect(describeUpdateError("plain string").kind).toBe("error");
    expect(describeUpdateError(undefined).kind).toBe("error");
  });
});


describe("the state a build starts in (Task 128)", () => {
  // Both "unsupported" reasons are knowable at startup without any
  // network. Leaving them to be DISCOVERED by a failing check 20
  // seconds later meant the About panel described automatic updating
  // to a build that has none, for the whole of that window.
  const originalResourcesPath = process.resourcesPath;

  function setResourcesPath(value: string | undefined): void {
    Object.defineProperty(process, "resourcesPath", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    setResourcesPath(originalResourcesPath);
  });

  /** Boot the updater in a made-up build and report where it lands. */
  async function initIn(opts: {
    packaged: boolean;
    channelFile: boolean;
  }): Promise<{ state: string; timers: number }> {
    vi.useFakeTimers();
    vi.resetModules();
    setResourcesPath("/fake/Resources");
    vi.doMock("electron", () => ({
      app: { isPackaged: opts.packaged },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { handle: vi.fn() },
    }));
    vi.doMock("electron-updater", () => ({
      default: {
        autoUpdater: {
          on: vi.fn(),
          checkForUpdates: vi.fn(),
          quitAndInstall: vi.fn(),
          autoDownload: false,
          autoInstallOnAppQuit: false,
        },
      },
    }));
    vi.doMock("node:fs", () => ({ existsSync: () => opts.channelFile }));

    const mod = await import("../src/main/appUpdater.js");
    mod.initAppUpdater();
    const s = mod.getUpdateState();
    return {
      state: s.kind === "unsupported" ? `unsupported:${s.reason}` : s.kind,
      timers: vi.getTimerCount(),
    };
  }

  it("a packaged build with no app-update.yml says so at once", async () => {
    const r = await initIn({ packaged: true, channelFile: false });
    expect(r.state).toBe("unsupported:noChannel");
    // And it does not sit waiting to fail a check it cannot pass.
    expect(r.timers).toBe(0);
  });

  it("a development run says so at once", async () => {
    const r = await initIn({ packaged: false, channelFile: false });
    expect(r.state).toBe("unsupported:dev");
    expect(r.timers).toBe(0);
  });

  it("a build WITH a channel is untouched and still schedules checks", async () => {
    const r = await initIn({ packaged: true, channelFile: true });
    // Nothing is claimed before the first check has anything to say.
    expect(r.state).toBe("idle");
    // The delayed first check plus the recurring one.
    expect(r.timers).toBe(2);
  });
});
