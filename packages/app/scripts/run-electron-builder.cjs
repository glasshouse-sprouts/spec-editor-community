#!/usr/bin/env node
/**
 * Run electron-builder with workspace-symlink hiding wrapped around it.
 *
 * Sequence
 * --------
 *   1. (Caller already ran `npm run build` first.)
 *   2. Hide the workspace symlink at
 *      `<repo>/node_modules/@molio2-editor/core` so the asar packager
 *      can't follow it into a path outside `packages/app/`. The
 *      renderer + main bundles already have core inlined, so we don't
 *      need the symlink at packaging or runtime.
 *   3. Run `electron-builder` with whatever flags this script was
 *      called with (e.g. `--mac`, `--win`, `--linux`, `--dir`).
 *   4. Always restore the symlink afterwards — wrapped in
 *      try/finally so it runs even if electron-builder fails.
 *
 * Why a wrapper instead of npm pre/post hooks
 * -------------------------------------------
 * `prepackage` runs BEFORE the npm `package` script, including its
 * `npm run build` first half. If we hide the symlink in `prepackage`
 * the build itself fails because vite can't resolve the package.
 * Doing the dance inside one process keeps the ordering correct and
 * makes the cleanup unconditional.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT_DIR = __dirname;

function run(name, extraArgs = []) {
  const script = path.join(SCRIPT_DIR, `${name}.cjs`);
  const r = spawnSync(process.execPath, [script, ...extraArgs], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    throw new Error(`${name} exited with ${r.status}`);
  }
}

async function main() {
  // The arguments after `--` (or just everything passed) are forwarded
  // to electron-builder. We don't try to parse them; just pass through.
  const args = process.argv.slice(2);
  let exitCode = 0;
  // Always start by restoring any previously-hidden symlink. Defensive
  // — if a previous run crashed before the finally cleanup, the dev
  // tree could be left with a hidden link and subsequent commands
  // (e.g. typecheck) would fail. The restore script is idempotent:
  // no-op when nothing to restore.
  run("restore-workspace-symlinks");
  run("hide-workspace-symlinks");
  try {
    const r = spawnSync(
      process.execPath,
      [require.resolve("electron-builder/out/cli/cli.js"), ...args],
      { stdio: "inherit", cwd: path.resolve(SCRIPT_DIR, "..") },
    );
    exitCode = r.status ?? 1;
  } finally {
    // Always run; bubble any restore error AFTER returning the
    // electron-builder exit code so the latter is the primary signal.
    try {
      run("restore-workspace-symlinks");
    } catch (e) {
      console.error("[run-electron-builder] restore failed:", e.message);
      if (exitCode === 0) exitCode = 1;
    }
  }
  process.exit(exitCode);
}

void main();
