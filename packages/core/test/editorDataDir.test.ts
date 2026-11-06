/**
 * Task 192 - which folder the editor keeps its data in.
 *
 * The rule these tests lock: a packaged app keeps its folder, whatever
 * the environment says (moving it would lose every user's settings);
 * a dev run never uses that folder; and a dev profile gives each git
 * worktree a folder of its own.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_DEV_PROFILE,
  EDITOR_DEV_PROFILE_ENV,
  editorDevProfile,
  editorUserDataDirName,
  mcpStateDirName,
  readEditorDevProfile,
} from "../src/editorDataDir.js";

const BASE = "GlasshouseSpec";

/** The folder name the editor ends up with for this run. */
function dirFor(isPackaged: boolean, env: Record<string, string>): string {
  return editorUserDataDirName(BASE, editorDevProfile(isPackaged, env));
}

describe("editor userData folder", () => {
  it("keeps the base name for a packaged app", () => {
    expect(dirFor(true, {})).toBe(BASE);
  });

  it("ignores the dev profile variable in a packaged app", () => {
    expect(dirFor(true, { [EDITOR_DEV_PROFILE_ENV]: "192" })).toBe(BASE);
  });

  it("gives a dev run a different folder even with no profile set", () => {
    expect(dirFor(false, {})).toBe(`${BASE}-dev-${DEFAULT_EDITOR_DEV_PROFILE}`);
    expect(dirFor(false, {})).not.toBe(BASE);
  });

  it("gives two dev profiles two different folders", () => {
    const a = dirFor(false, { [EDITOR_DEV_PROFILE_ENV]: "192" });
    const b = dirFor(false, { [EDITOR_DEV_PROFILE_ENV]: "138-sanering" });
    expect(a).toBe(`${BASE}-dev-192`);
    expect(b).toBe(`${BASE}-dev-138-sanering`);
  });

  it("treats an empty or blank variable as unset", () => {
    expect(readEditorDevProfile({ [EDITOR_DEV_PROFILE_ENV]: "" })).toBe(
      undefined,
    );
    expect(readEditorDevProfile({ [EDITOR_DEV_PROFILE_ENV]: "  " })).toBe(
      undefined,
    );
  });

  it.each(["../escape", "a/b", "a\\b", ".hidden", "-dash", "x".repeat(65)])(
    "rejects %j as a profile name",
    (bad) => {
      expect(() =>
        readEditorDevProfile({ [EDITOR_DEV_PROFILE_ENV]: bad }),
      ).toThrow(EDITOR_DEV_PROFILE_ENV);
    },
  );
});

describe("MCP state folder", () => {
  it("is the shared folder when no profile is set", () => {
    expect(mcpStateDirName(undefined)).toBe("molio-mcp-server");
  });

  it("is a per-profile folder for a dev profile", () => {
    expect(mcpStateDirName("192")).toBe("molio-mcp-server-dev-192");
  });
});
