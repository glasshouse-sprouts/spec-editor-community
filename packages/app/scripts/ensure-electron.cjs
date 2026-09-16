#!/usr/bin/env node
/**
 * Make sure the Electron binary is actually downloaded.
 *
 * Electron has a postinstall script (`install.js`) that downloads its
 * ~150 MB binary. If that script ever gets skipped (e.g. `npm install
 * --ignore-scripts`), the package is installed but electron-vite will
 * fail at startup with "Error: Electron uninstall".
 *
 * This script is idempotent: if the binary is already there, it exits
 * immediately. If not, it runs the install script to fetch it.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

try {
  const installJs = require.resolve("electron/install.js");
  const electronDir = path.dirname(installJs);
  const distDir = path.join(electronDir, "dist");

  if (fs.existsSync(distDir) && fs.readdirSync(distDir).length > 0) {
    // Already installed. No-op.
    process.exit(0);
  }

  console.log(
    "Electron binary missing — running electron/install.js to download it.",
  );
  execFileSync("node", [installJs], { stdio: "inherit", cwd: electronDir });
} catch (err) {
  console.error("ensure-electron failed:", err.message);
  process.exit(1);
}
