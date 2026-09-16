#!/usr/bin/env node
/**
 * test-with-rebuild — wraps `npm test` with the native-module dance.
 *
 * Why this exists
 * ---------------
 * `better-sqlite3` is a native module (compiled C++ → a single
 * `.node` binary). The binary is tied to one ABI version, expressed
 * as Node's NODE_MODULE_VERSION. We have TWO runtimes that need it:
 *
 *   - vitest runs in system Node      (one ABI)
 *   - the Electron app runs in        (different ABI)
 *     Electron's bundled Node
 *
 * You can only have one compiled `.node` file at a time, so the
 * naïve workflow is "rebuild before tests, rebuild back before
 * launching the app" — manual and error-prone.
 *
 * This script eliminates that dance for `npm test`:
 *
 *   1. Rebuild better-sqlite3 for system Node.
 *   2. Run the test suite.
 *   3. ALWAYS rebuild back for Electron — even if step 2 failed,
 *      even if step 2 was interrupted with Ctrl-C.
 *
 * The end-user-facing effect: `npm test` "just works" and leaves
 * the repo in app-runnable state when it finishes. The cost is
 * roughly 20–40 s of extra rebuild time per `npm test` invocation,
 * which is fine for a manual test run.
 *
 * If interrupted hard (e.g. process killed -9) before step 3 runs,
 * the user can recover with `npm run rebuild-native -w
 * @molio2-editor/app` from the repo root.
 *
 * Tech-debt note (#252 DEV-Native): the "right" long-term fix is
 * running vitest under Electron's runtime so both consumers share
 * the same .node binary. This script is the pragmatic interim.
 */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Spawn a command, inherit stdio so the user sees real-time output. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      cwd: REPO_ROOT,
      ...opts,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code == null ? 1 : code));
  });
}

async function rebuildForSystemNode() {
  console.log(
    "\n[test-with-rebuild] step 1/3 — rebuilding better-sqlite3 for system Node…",
  );
  return run("npm", ["rebuild", "better-sqlite3", "--build-from-source"]);
}

async function rebuildForElectron() {
  console.log(
    "\n[test-with-rebuild] step 3/3 — rebuilding better-sqlite3 for Electron…",
  );
  return run("npm", ["run", "rebuild-native", "-w", "@molio2-editor/app"]);
}

async function runTestsViaWorkspaces() {
  console.log("\n[test-with-rebuild] step 2/3 — running test suite…");
  return run("npm", ["run", "test", "--workspaces", "--if-present"]);
}

async function main() {
  // Step 1 — swap to system-Node ABI. If this fails, abort early;
  // tests can't run without it and Electron's binary is still
  // intact (untouched), so the app is fine.
  const swapOut = await rebuildForSystemNode();
  if (swapOut !== 0) {
    console.error(
      "\n[test-with-rebuild] ERROR: rebuild for system Node failed. Tests not run.",
    );
    console.error(
      "[test-with-rebuild] Your app is still in app-mode — you can launch the editor.",
    );
    process.exit(swapOut);
  }

  // Step 2 — run tests. Capture the exit code; do NOT exit yet —
  // we MUST swap back to Electron ABI no matter what.
  let testExit = 0;
  try {
    testExit = await runTestsViaWorkspaces();
  } catch (err) {
    console.error("[test-with-rebuild] tests threw:", err);
    testExit = 1;
  }

  // Step 3 — swap back to Electron ABI. Runs unconditionally.
  // If the swap-back itself fails, we tell the user how to recover
  // and surface that failure only if tests passed (otherwise the
  // test failure is the more important signal).
  const swapBack = await rebuildForElectron();
  if (swapBack !== 0) {
    console.error(
      "\n[test-with-rebuild] WARNING: rebuild-native failed; your app may not start.",
    );
    console.error(
      "[test-with-rebuild] Recover with: `npm run rebuild-native -w @molio2-editor/app`",
    );
    if (testExit === 0) {
      // Tests passed, but app is broken — surface the rebuild
      // failure as the script's exit code.
      process.exit(swapBack);
    }
  }

  process.exit(testExit);
}

// Make Ctrl-C friendly: if the user kills us with SIGINT during
// step 2 (tests), still attempt the swap-back. SIGINT propagates to
// child processes via stdio: "inherit", so the tests will already
// be stopping; we use a one-shot handler to make sure step 3 runs.
let cleaningUp = false;
process.on("SIGINT", () => {
  if (cleaningUp) {
    // Second Ctrl-C — give up.
    console.error(
      "\n[test-with-rebuild] aborting cleanup; you'll need to run rebuild-native manually.",
    );
    process.exit(130);
  }
  cleaningUp = true;
  console.error(
    "\n[test-with-rebuild] caught SIGINT — finishing the dance before exiting (press Ctrl-C again to abort)…",
  );
  rebuildForElectron()
    .catch(() => {})
    .finally(() => process.exit(130));
});

main().catch((err) => {
  console.error("[test-with-rebuild] fatal:", err);
  // Best-effort restore before dying.
  rebuildForElectron()
    .catch(() => {})
    .finally(() => process.exit(1));
});
