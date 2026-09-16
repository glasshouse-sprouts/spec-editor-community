#!/usr/bin/env node
/**
 * Hide workspace symlinks from electron-builder's asar file scanner.
 *
 * Why this exists
 * ---------------
 * In an npm workspace, `node_modules/@molio2-editor/core` is a symlink
 * pointing at `../../packages/core/`. When electron-builder builds the
 * asar archive, its file-list construction follows that symlink and
 * collects files whose absolute path lies *outside* `packages/app/`.
 * The asar packager later refuses any path it can't relativise to the
 * project dir and aborts with:
 *
 *     ⨯ packages/core/dist/<file> must be under packages/app/
 *
 * The renderer + main bundles already inline the core package via
 * vite's `externalizeDepsPlugin({ exclude: ["@molio2-editor/core"] })`,
 * so the symlink isn't needed at packaging or runtime — only during
 * development for tsc resolution and for the typecheck pass.
 *
 * What this script does
 * ---------------------
 * Renames the symlink to a side-name so the file scanner can't see
 * it during packaging. The companion script
 * `restore-workspace-symlinks.cjs` puts it back. We use rename
 * (cheap, atomic) rather than delete+recreate so we never lose the
 * link target.
 *
 * If the symlink is already hidden (e.g. a previous run aborted),
 * we exit cleanly — the rename target already exists.
 */
const fs = require("node:fs");
const path = require("node:path");

// npm workspaces hoist node_modules to the repo root, so the actual
// symlinks live at <repo>/node_modules/@molio2-editor/, not at
// packages/app/node_modules/. Resolve relative to this script.
const ROOT_NODE_MODULES = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
);
const PAIRS = [
  {
    visible: path.join(ROOT_NODE_MODULES, "@molio2-editor", "core"),
    hidden: path.join(ROOT_NODE_MODULES, "@molio2-editor", ".core.hidden"),
  },
];

for (const { visible, hidden } of PAIRS) {
  if (fs.existsSync(hidden)) {
    // Already hidden from a previous run — nothing to do.
    continue;
  }
  if (
    !fs.existsSync(visible) &&
    !fs.lstatSync(visible, { throwIfNoEntry: false })
  ) {
    // Nothing here to hide; that's fine for non-workspace installs.
    continue;
  }
  try {
    fs.renameSync(visible, hidden);
    console.log(
      `[hide] ${path.relative(process.cwd(), visible)} → ${path.basename(hidden)}`,
    );
  } catch (err) {
    console.error(`[hide] failed for ${visible}:`, err.message);
    process.exit(1);
  }
}
