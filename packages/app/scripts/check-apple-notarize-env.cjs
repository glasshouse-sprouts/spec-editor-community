#!/usr/bin/env node
/**
 * Stop a macOS build BEFORE electron-builder starts if notarization would be
 * skipped (Task 136).
 *
 * Why this exists
 * ---------------
 * electron-builder notarizes only when APPLE_API_KEY, APPLE_API_KEY_ID and
 * APPLE_API_ISSUER are set in the shell that builds. Without them it skips
 * the Apple round-trip WITHOUT AN ERROR and produces a build that looks
 * finished; Gatekeeper refuses it later, on the user's machine. It happened
 * twice: during Task 124 (2026-09-17, a second terminal window) and during
 * the 1.0.3 release (2026-09-23, where the .zip that macOS updates from
 * shipped an app without a stapled ticket and had to be rebuilt). A file to
 * source makes the mistake less likely; only a check can remove it.
 *
 * What it checks
 * --------------
 * Only macOS builds (`--mac`, `-m`, `--macos` in the electron-builder
 * arguments). A Windows build, a linux build and `package:dir` (the
 * cross-platform check without signing) are never stopped.
 *
 * The three variables must be set and non-empty, and APPLE_API_KEY must name
 * a file that exists. VALUES ARE NEVER PRINTED - only names. The key file's
 * path is not a secret in itself, but it sits next to things that are, and a
 * build log is copied into tracker comments.
 *
 * Deliberately un-notarized builds
 * --------------------------------
 * Two exist: a verification build that only needs to read app-update.yml
 * (notarization takes 5-30 minutes and is irrelevant there), and anyone
 * building from source without Apple credentials. SKIP_NOTARIZE=1 lets them
 * through, with a warning that cannot be missed. It has to be typed on
 * purpose, so it cannot happen by forgetting - which is the failure this
 * file exists for.
 *
 * Used by run-electron-builder.cjs (before anything else happens, so it
 * cannot be bypassed by calling the workspace script directly) and at the
 * start of the root `package:mac` script (so it fails in seconds, before the
 * MCP deploy and the vite build).
 */
const fs = require("node:fs");

const VARS = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
const ENV_FILE = "~/.config/apple-notarize.env";
const MAC_FLAGS = new Set(["--mac", "-m", "--macos"]);

/** True when the electron-builder arguments ask for a macOS build. */
function isMacBuild(args) {
  return args.some((a) => MAC_FLAGS.has(a));
}

/**
 * Decide, without side effects. `fileExists` is injectable for the tests.
 * Returns { action: "skip" | "ok" | "override" | "stop", missing, badKeyFile }.
 */
function checkAppleNotarizeEnv(args, env, fileExists = fs.existsSync) {
  if (!isMacBuild(args))
    return { action: "skip", missing: [], badKeyFile: false };
  const missing = VARS.filter((v) => !env[v] || !String(env[v]).trim());
  const badKeyFile =
    !missing.includes("APPLE_API_KEY") &&
    !fileExists(String(env.APPLE_API_KEY).trim());
  if (missing.length === 0 && !badKeyFile)
    return { action: "ok", missing, badKeyFile };
  if (env.SKIP_NOTARIZE === "1")
    return { action: "override", missing, badKeyFile };
  return { action: "stop", missing, badKeyFile };
}

function problemLines(result) {
  const lines = result.missing.map((v) => `    ${v} is not set (or empty)`);
  if (result.badKeyFile) {
    lines.push(
      "    APPLE_API_KEY is set, but no file exists at the path it names",
    );
  }
  return lines.join("\n");
}

function stopMessage(result) {
  return [
    "",
    "✗ STOP: this macOS build would NOT be notarized.",
    "",
    problemLines(result),
    "",
    "  electron-builder would skip notarization without an error, and",
    "  Gatekeeper would refuse the app on the user's machine. Nothing has",
    "  been built yet.",
    "",
    "  Fix: load the three variables into THIS terminal, then build again:",
    "",
    `    source ${ENV_FILE}`,
    "    npm run package:mac",
    "",
    `  ${ENV_FILE} lives outside every repo and holds the three`,
    "  export lines. Environment variables only exist in the terminal that",
    "  set them, so a new window needs the source line again.",
    "",
    "  Deliberately building WITHOUT notarization (a verification build,",
    "  or no Apple credentials at all)? Say so explicitly:",
    "",
    "    SKIP_NOTARIZE=1 npm run package:mac",
    "",
  ].join("\n");
}

function overrideMessage(result) {
  return [
    "",
    "!!! SKIP_NOTARIZE=1 - this macOS build will NOT be notarized.",
    problemLines(result),
    "!!! Gatekeeper refuses it on other machines. Never publish it.",
    "",
  ].join("\n");
}

/** Print and return the exit code. Used by the CLI and run-electron-builder. */
function runGuard(args, env = process.env) {
  const result = checkAppleNotarizeEnv(args, env);
  if (result.action === "stop") {
    console.error(stopMessage(result));
    return 1;
  }
  if (result.action === "override") console.warn(overrideMessage(result));
  return 0;
}

module.exports = {
  isMacBuild,
  checkAppleNotarizeEnv,
  runGuard,
  VARS,
  ENV_FILE,
};

if (require.main === module) {
  // CLI: pass the electron-builder platform flag, e.g. `--mac`.
  process.exit(runGuard(process.argv.slice(2)));
}
