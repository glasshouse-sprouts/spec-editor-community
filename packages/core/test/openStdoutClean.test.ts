/**
 * Regression test for the MCP JSON-RPC channel.
 *
 * For the MCP server, stdout IS the protocol channel: any stray line
 * written there corrupts JSON-RPC and some clients hang up. `openMoliospec`
 * is called on every tool invocation, so it must stay completely silent on
 * stdout (it used to emit "step 1…step 6" debug lines — now removed).
 *
 * We capture both `process.stdout.write` and `console.log` while opening a
 * real sample file and assert nothing reached stdout.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { openMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

describe("openMoliospec — stdout stays clean", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes nothing to stdout while opening a sample", async () => {
    const samples = findAllSamples();
    expect(samples.length).toBeGreaterThan(0);

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const handle = await openMoliospec(samples[0]!.path);
    try {
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      await handle.close();
    }
  });
});
