#!/usr/bin/env node
/**
 * Restore workspace symlinks hidden during packaging.
 * See `hide-workspace-symlinks.cjs` for the why.
 *
 * Idempotent: if the symlink is already in place, we don't overwrite
 * it — leaves whatever's there alone.
 */
const fs = require("node:fs");
const path = require("node:path");

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
  if (fs.existsSync(visible)) {
    // Already restored.
    continue;
  }
  if (
    !fs.existsSync(hidden) &&
    !fs.lstatSync(hidden, { throwIfNoEntry: false })
  ) {
    // Nothing to restore — fine.
    continue;
  }
  try {
    fs.renameSync(hidden, visible);
    console.log(
      `[restore] ${path.basename(hidden)} → ${path.relative(process.cwd(), visible)}`,
    );
  } catch (err) {
    console.error(`[restore] failed for ${hidden}:`, err.message);
    process.exit(1);
  }
}
