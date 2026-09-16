#!/usr/bin/env node
/**
 * Post-build sanity check for a packaged macOS build.
 *
 * Why this exists
 * ----------------
 * `npm run package:mac` can succeed with exit code 0 even when signing
 * or notarization silently did NOT happen — e.g. the App Store Connect
 * API key env vars were missing, or a "Developer ID Application"
 * certificate isn't in the keychain electron-builder looked in. A green
 * build is not proof of a signed, notarized build. Run this script
 * right after packaging to actually check.
 *
 * What it checks
 * ---------------
 *   1. Finds the built .app under packages/app/dist/.
 *   2. `codesign --verify --deep --strict` on the whole bundle.
 *   3. Reports the signing identity + whether the hardened runtime
 *      flag is set, for the app itself.
 *   4. Same identity/hardened-runtime check for any bundled helper
 *      binaries (a "*-mcp-server" folder under Contents/Resources/,
 *      holding its own Node executable and a native .node module) —
 *      historically the part most likely to have been missed, because
 *      electron-builder signs what it packages and these arrive as
 *      extraResources. See electron-builder.yml's own comments.
 *
 *      NOT EVERY BUILD HAS THEM. This edition of the app ships without
 *      bundled helper binaries, and that is normal, not a failure. The
 *      check is skipped in that case and SAYS SO on screen: a check
 *      that is quietly skipped is a check somebody later believes was
 *      run.
 *   5. `spctl --assess` (Gatekeeper) on the .app — with an explicit
 *      caveat: this can still say "rejected" on a correctly signed
 *      app if it hasn't been notarized+stapled yet, or if
 *      notarization is still processing. Don't read a spctl failure
 *      here as proof signing is broken on its own — check step 2-4
 *      first.
 *   6. If a .dmg is found next to the .app, runs `xcrun stapler
 *      validate` on it — this is the real proof notarization
 *      completed and the ticket is attached (works offline for a
 *      Gatekeeper check afterwards, which is the whole point).
 *
 * Usage: node scripts/verify-mac-signing.cjs [dist-dir]
 *   Run from packages/app/, or via `npm run verify:mac-signing` from
 *   that workspace. With no argument it checks this package's own
 *   dist/ — the normal case, right after packaging. An optional path
 *   points it at some other build output instead.
 *
 * This script ships with the source on purpose: anyone who downloads a
 * release can run it against the .app they unpacked and check our
 * signature themselves, rather than taking our word for it. Being able
 * to check is the whole reason the binaries are published next to the
 * code they were built from.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  console.error("verify-mac-signing: only meaningful on macOS. Skipping.");
  process.exit(0);
}

const APP_DIR = path.resolve(__dirname, "..");
// Optional first argument: a dist directory to check instead of this
// package's own. Without it the behaviour is exactly what it has always
// been, so the Glasshouse release routine is unaffected.
const DIST_DIR = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(APP_DIR, "dist");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function info(msg) {
  console.log(`  ${msg}`);
}

// NOTE: `codesign -d`/`spctl --assess` write their actual output to
// STDERR even on success (exit code 0) — this is a longstanding macOS
// tool quirk, not an error. Using spawnSync and always merging both
// streams avoids silently losing that output on the success path,
// which an earlier version of this script did (it used execFileSync's
// return value, which is stdout-only on success).
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: r.status ?? 1,
    out: (r.stdout || "") + (r.stderr || ""),
  };
}

function findAppBundle(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return full;
    }
    if (entry.isDirectory()) {
      const nested = findAppBundle(full);
      if (nested) return nested;
    }
  }
  return null;
}

function findFirst(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (predicate(entry.name)) return full;
    if (entry.isDirectory() && !entry.name.endsWith(".app")) {
      const nested = findFirst(full, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function reportBinary(label, filePath) {
  console.log(`\n--- ${label} ---`);
  info(filePath);
  if (!fs.existsSync(filePath)) {
    fail(`Not found: ${filePath}`);
    return;
  }
  const { status, out } = run("codesign", ["-dvvv", filePath]);
  if (status !== 0) {
    fail(`codesign -dvvv failed (unsigned or broken signature):\n${out}`);
    return;
  }
  const authorityLines = out.split("\n").filter((l) => l.startsWith("Authority="));
  // The hardened-runtime flag is NOT on its own line — it's embedded
  // mid-line in the CodeDirectory summary, e.g.:
  //   "CodeDirectory v=20500 size=... flags=0x10000(runtime) hashes=..."
  // An earlier version of this script looked for a line starting with
  // "flags=" and never found one, wrongly reporting hardened runtime as
  // missing on a build that Apple had already notarized (which requires
  // hardened runtime) — .includes(), not .startsWith().
  const flagsLine = out.split("\n").find((l) => l.includes("flags="));
  if (authorityLines.length === 0) {
    fail("No Authority= line — likely ad-hoc signed, not Developer ID.");
  } else {
    ok(`Signed by: ${authorityLines[0].replace("Authority=", "")}`);
    if (!authorityLines[0].includes("Developer ID")) {
      fail(`Expected a "Developer ID Application" signature, got: ${authorityLines[0]}`);
    }
  }
  if (flagsLine && flagsLine.includes("runtime")) {
    ok(`Hardened runtime enabled (${flagsLine.trim()})`);
  } else {
    fail(`Hardened runtime flag NOT found (${flagsLine ? flagsLine.trim() : "no flags= line"}). Notarization will reject this.`);
  }
}

console.log("=== macOS signing verification ===\n");

const appBundle = findAppBundle(DIST_DIR);
if (!appBundle) {
  fail(`No .app bundle found under ${DIST_DIR}. Run "npm run package:mac" first.`);
  process.exit(1);
}
console.log(`App bundle: ${appBundle}\n`);

// 1. Deep verify of the whole bundle.
console.log("--- codesign --verify --deep --strict (whole bundle) ---");
{
  const { status, out } = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);
  if (status === 0) {
    ok("Deep verification passed.");
  } else {
    fail(`Deep verification FAILED:\n${out}`);
  }
}

// 2. The app itself.
reportBinary("Main app bundle", appBundle);

// 3. Bundled helper binaries, if this build has any.
//
// These arrive as extraResources rather than as part of the Electron
// app itself, which is why they are the classic thing to miss (Task 8's
// own risk assessment said so, and it was right). Not every edition
// bundles them: an app built without them has nothing here to check.
//
// The folder is found by SHAPE, not by a hardcoded name — a directory
// under Contents/Resources/ whose name ends in "-mcp-server". That keeps
// this script honest in any edition without naming one edition's
// internals in a file that ships publicly.
console.log("\n--- bundled helper binaries ---");
const resourcesDir = path.join(appBundle, "Contents", "Resources");
const mcpDir = fs.existsSync(resourcesDir)
  ? (fs
      .readdirSync(resourcesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith("-mcp-server"))
      .map((e) => path.join(resourcesDir, e.name))[0] ?? null)
  : null;

if (!mcpDir) {
  // Deliberately loud, and deliberately NOT a failure. This build simply
  // has no bundled helper binaries; steps 1, 2, 5 and 6 still cover the
  // whole .app and are what proves it is signed and notarized.
  info("SKIPPED: this build bundles no helper binaries (no *-mcp-server");
  info("folder under Contents/Resources/). Nothing to check here - the");
  info("whole-bundle checks above and below still apply.");
} else {
  info(`Found: ${mcpDir}`);
  const nodeBinary = path.join(mcpDir, "node");
  reportBinary("Helper Node executable", nodeBinary);

  const nodeAddon = findFirst(mcpDir, (name) => name.endsWith(".node"));
  if (nodeAddon) {
    reportBinary("Helper native module (better_sqlite3.node)", nodeAddon);
  } else {
    fail(`Could not find a .node file under ${mcpDir} — expected better_sqlite3.node.`);
    // Diagnostic dump instead of guessing — print what's actually there so
    // the real structure is visible instead of a second blind guess.
    const { out } = run("find", [mcpDir]);
    info("Actual contents of that folder:");
    console.log(out);
  }
}

// 4. Gatekeeper assessment — informational, with the notarization caveat.
console.log("\n--- spctl --assess (Gatekeeper) ---");
{
  const { status, out } = run("spctl", ["--assess", "--type", "execute", "--verbose", appBundle]);
  if (status === 0) {
    ok(`Gatekeeper accepts the app:\n${out.trim()}`);
  } else {
    info(`spctl says: ${out.trim()}`);
    info("This is EXPECTED to fail before notarization + stapling. It is not");
    info("proof signing is broken on its own — check the codesign results above first.");
  }
}

// 5. Stapled ticket check. electron-builder notarizes + staples the
// .app BEFORE building the .dmg around it (see the build log: "signing"
// / "notarization successful" happen before "building target=DMG") —
// so the .app itself is the authoritative place to check. The .dmg is
// checked too, but a stale .dmg from an earlier/different version left
// over in dist/ is a false alarm, not a real problem — dist/ is not
// cleaned between builds with different version numbers, so old
// artifacts pile up. Picking the most-recently-modified .dmg (not just
// the first one found) avoids reporting on a leftover file by mistake.
console.log("\n--- xcrun stapler validate (notarization ticket) ---");
{
  info(`App: ${appBundle}`);
  const { status, out } = run("xcrun", ["stapler", "validate", appBundle]);
  if (status === 0) {
    ok(`Notarization ticket is stapled to the .app:\n${out.trim()}`);
  } else {
    fail(`No valid stapled ticket on the .app yet:\n${out.trim()}`);
  }
}

function findAllDmgsWithMtime(dir) {
  const results = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isFile() && entry.name.endsWith(".dmg")) {
        results.push({ full, mtime: fs.statSync(full).mtimeMs });
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  }
  walk(dir);
  return results.sort((a, b) => b.mtime - a.mtime);
}

const dmgs = findAllDmgsWithMtime(DIST_DIR);
if (dmgs.length > 0) {
  const dmg = dmgs[0].full;
  if (dmgs.length > 1) {
    info(`\nNote: ${dmgs.length} .dmg files found under dist/ — using the newest (${path.basename(dmg)}).`);
    info("Older ones are leftovers from previous builds/versions, safe to delete if they clutter dist/.");
  }
  info(`\nDMG: ${dmg}`);
  const { status, out } = run("xcrun", ["stapler", "validate", dmg]);
  if (status === 0) {
    ok(`Notarization ticket is stapled to the .dmg:\n${out.trim()}`);
  } else {
    info(`.dmg itself is not separately stapled:\n${out.trim()}`);
    info("This is often fine — what matters for Gatekeeper is whether the .app INSIDE");
    info("the dmg is stapled (checked above). Not a failure on its own.");
  }
} else {
  info(`\nNo .dmg found under ${DIST_DIR} — skipping .dmg stapler check.`);
}

console.log("\n===================================");
if (process.exitCode === 1) {
  console.log("Result: ISSUES FOUND — see ✗ lines above.");
} else {
  console.log("Result: all checks passed.");
}
