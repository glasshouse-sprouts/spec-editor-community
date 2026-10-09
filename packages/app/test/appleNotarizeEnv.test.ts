/**
 * Tests for scripts/check-apple-notarize-env.cjs (Task 136) - the check that
 * stops a macOS build before electron-builder can skip notarization in
 * silence.
 *
 * Tested on both sides, like the signing checks: it must stop a mac build
 * with a variable missing AND let every other build through. A guard that
 * also stops Windows builds gets switched off, and then it guards nothing.
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const guard = require("../scripts/check-apple-notarize-env.cjs") as {
  isMacBuild: (args: string[]) => boolean;
  checkAppleNotarizeEnv: (
    args: string[],
    env: Record<string, string | undefined>,
    fileExists?: (p: string) => boolean,
  ) => { action: string; missing: string[]; badKeyFile: boolean };
  runGuard: (args: string[], env: Record<string, string | undefined>) => number;
};

const FULL = {
  APPLE_API_KEY: "/keys/AuthKey_TESTKEYID.p8",
  APPLE_API_KEY_ID: "TESTKEYID",
  APPLE_API_ISSUER: "test-issuer-uuid",
};
const exists = () => true;

afterEach(() => vi.restoreAllMocks());

describe("which builds are checked", () => {
  it("checks the mac flags and nothing else", () => {
    expect(guard.isMacBuild(["--mac"])).toBe(true);
    expect(guard.isMacBuild(["-m"])).toBe(true);
    expect(guard.isMacBuild(["--macos"])).toBe(true);
    for (const args of [["--win"], ["--linux"], ["--dir"], []]) {
      expect(guard.isMacBuild(args)).toBe(false);
    }
  });

  it("lets Windows, linux and --dir builds through with NO variables set", () => {
    for (const args of [["--win"], ["--linux"], ["--dir"]]) {
      expect(guard.checkAppleNotarizeEnv(args, {}, exists).action).toBe("skip");
    }
  });
});

describe("a mac build", () => {
  it("passes when all three are set and the key file exists", () => {
    expect(guard.checkAppleNotarizeEnv(["--mac"], FULL, exists).action).toBe(
      "ok",
    );
  });

  it("stops when any one of the three is missing, and names it", () => {
    for (const name of Object.keys(FULL)) {
      const env: Record<string, string | undefined> = { ...FULL };
      delete env[name];
      const r = guard.checkAppleNotarizeEnv(["--mac"], env, exists);
      expect(r.action).toBe("stop");
      expect(r.missing).toEqual([name]);
    }
  });

  it("treats an empty or whitespace-only value as missing", () => {
    const r = guard.checkAppleNotarizeEnv(
      ["--mac"],
      { ...FULL, APPLE_API_KEY_ID: "  " },
      exists,
    );
    expect(r.action).toBe("stop");
    expect(r.missing).toEqual(["APPLE_API_KEY_ID"]);
  });

  it("stops when APPLE_API_KEY names a file that does not exist", () => {
    const r = guard.checkAppleNotarizeEnv(["--mac"], FULL, () => false);
    expect(r.action).toBe("stop");
    expect(r.missing).toEqual([]);
    expect(r.badKeyFile).toBe(true);
  });

  it("lets SKIP_NOTARIZE=1 through, but only the exact value 1", () => {
    expect(
      guard.checkAppleNotarizeEnv(["--mac"], { SKIP_NOTARIZE: "1" }, exists)
        .action,
    ).toBe("override");
    for (const v of ["true", "yes", "0", ""]) {
      expect(
        guard.checkAppleNotarizeEnv(["--mac"], { SKIP_NOTARIZE: v }, exists)
          .action,
      ).toBe("stop");
    }
  });
});

describe("what it prints", () => {
  it("returns 1 and names the missing variable, the file and the override", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      guard.runGuard(["--mac"], {
        APPLE_API_KEY_ID: "x",
        APPLE_API_ISSUER: "y",
      }),
    ).toBe(1);
    const out = err.mock.calls.flat().join("\n");
    expect(out).toContain("APPLE_API_KEY is not set");
    expect(out).toContain("source ~/.config/apple-notarize.env");
    expect(out).toContain("SKIP_NOTARIZE=1");
  });

  it("never prints a variable's value", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Key file missing -> stop message; then the override message.
    const env = { ...FULL, APPLE_API_KEY: "/no/such/AuthKey_SECRETPATH.p8" };
    guard.runGuard(["--mac"], env);
    guard.runGuard(["--mac"], { ...env, SKIP_NOTARIZE: "1" });
    const out = [...err.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(out.length).toBeGreaterThan(0);
    for (const secret of ["SECRETPATH", "TESTKEYID", "test-issuer-uuid"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("returns 0 and prints nothing for a Windows build", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(guard.runGuard(["--win"], {})).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
