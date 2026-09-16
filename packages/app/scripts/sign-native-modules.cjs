#!/usr/bin/env node
/**
 * Ad-hoc-sign every freshly rebuilt `.node` native module on macOS.
 *
 * Why this exists
 * ---------------
 * On macOS 15+ (Apple Silicon especially), the hardened runtime that
 * Electron's binary ships with refuses to load a `.node` shared
 * library that has no code signature at all. When `electron-rebuild`
 * compiles `better-sqlite3` from source, the resulting
 * `better_sqlite3.node` is unsigned. Loading it then fails with
 *
 *     SIGKILL (Code Signature Invalid)
 *     namespace: CODESIGNING, indicator: Invalid Page
 *
 * …and the Electron main process dies silently right when the
 * renderer first imports the module.
 *
 * The fix is the macOS ad-hoc signature `codesign --sign -`. It
 * doesn't require a Developer ID — it just produces a SHA-based
 * self-signature that satisfies the OS's "this binary was signed
 * by SOMEBODY" check. Sufficient for development; for release
 * builds, electron-builder applies a real Developer ID signature
 * over the whole bundle.
 *
 * What it does
 * ------------
 * Walks the workspace's hoisted `node_modules`, finds every
 * `.node` file (matches better-sqlite3's binding plus any
 * future native modules), and signs each one ad-hoc. Idempotent:
 * `--force` re-signs even if a signature already exists, so
 * running this on a clean tree is a safe no-op.
 *
 * No-op on non-macOS hosts (Linux/Windows have different signing
 * semantics; this script just exits 0 quietly there).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  process.exit(0);
}

const ROOT_NODE_MODULES = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
);

/**
 * Recursively find every `.node` file. Skips `.bin/` directories
 * (npm script shims, never native binaries). We don't try to be
 * clever about which packages — anything that ships a `.node` and
 * lives under our node_modules gets signed.
 */
function findNodeFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === ".bin") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      findNodeFiles(full, out);
    } else if (e.isFile() && e.name.endsWith(".node")) {
      out.push(full);
    }
  }
  return out;
}

const found = findNodeFiles(ROOT_NODE_MODULES);
if (found.length === 0) {
  // Nothing to do.
  process.exit(0);
}

let failed = 0;
for (const f of found) {
  try {
    // `--force`     — overwrite any prior signature
    // `--sign -`    — ad-hoc signature (no Developer ID needed)
    // `--timestamp=none` — skip Apple's timestamp server (we're offline-capable)
    execFileSync(
      "codesign",
      ["--force", "--sign", "-", "--timestamp=none", f],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    failed += 1;
    console.error(
      `[sign-native-modules] codesign failed for ${path.relative(
        process.cwd(),
        f,
      )}: ${err.message}`,
    );
  }
}

if (failed > 0) {
  console.error(
    `[sign-native-modules] ${failed} module(s) failed to sign — Electron will refuse to load them.`,
  );
  process.exit(1);
}
console.log(
  `[sign-native-modules] signed ${found.length} native module(s) ad-hoc.`,
);
