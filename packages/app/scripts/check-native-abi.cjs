#!/usr/bin/env node
/**
 * check-native-abi.cjs
 *
 * Runs before `npm run dev`. Ensures the better-sqlite3 native binary
 * on disk is actually compatible with the *host* OS.
 *
 * Why this exists: the core package's tests rebuild better-sqlite3 for
 * Node's ABI and — if Claude runs the tests from a Linux sandbox that
 * shares the same node_modules with a developer's Mac — leaves a Linux
 * ELF binary where macOS expects a Mach-O. Electron then silently
 * crashes at `new Database()`.
 *
 * Strategy: look at the first 4 bytes of the native module. Each OS has
 * a known magic number. If the bytes don't match the current host OS,
 * kick off a full electron-rebuild (with `-f`) before handing off to
 * electron-vite. If they do match, skip the rebuild entirely — the
 * whole check finishes in a few milliseconds.
 *
 * This is more reliable than relying on `@electron/rebuild`'s own
 * short-circuit logic, which has been seen to cache a stale "already
 * built" decision even after the .node file was clobbered by a Node
 * rebuild on a different OS.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const appDir = path.resolve(__dirname, "..");
// better-sqlite3 is hoisted to the root in a workspaces monorepo.
const binaryPath = path.resolve(
  appDir,
  "../../node_modules/better-sqlite3/build/Release/better_sqlite3.node",
);

function readMagic() {
  try {
    const fd = fs.openSync(binaryPath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf;
  } catch (err) {
    return null;
  }
}

function isElf(magic) {
  // 7F 45 4C 46  == ".ELF"
  return (
    magic[0] === 0x7f &&
    magic[1] === 0x45 &&
    magic[2] === 0x4c &&
    magic[3] === 0x46
  );
}

function isMachO(magic) {
  // Mach-O magic numbers (several variants, little + big endian):
  //   FEEDFACE / FEEDFACF / CEFAEDFE / CFFAEDFE
  // and fat/universal: CAFEBABE / BEBAFECA
  const first = magic.readUInt32LE(0);
  const firstBE = magic.readUInt32BE(0);
  const machoMagics = new Set([
    0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
  ]);
  return machoMagics.has(first) || machoMagics.has(firstBE);
}

function binaryMatchesHost(magic) {
  if (!magic) return false;
  if (process.platform === "darwin") return isMachO(magic);
  if (process.platform === "linux") return isElf(magic);
  if (process.platform === "win32") {
    // PE/COFF: first two bytes are "MZ" (0x4D 0x5A).
    return magic[0] === 0x4d && magic[1] === 0x5a;
  }
  // Unknown OS — don't interfere.
  return true;
}

const magic = readMagic();
if (binaryMatchesHost(magic)) {
  // Fast path: on-disk binary targets this OS. If it turns out the ABI
  // is still wrong for Electron specifically, electron-vite will crash
  // and the developer can run `npm run rebuild-native` manually. In
  // practice the OS check catches 99% of the real-world churn we see.
  process.exit(0);
}

console.log(
  "[check-native-abi] better-sqlite3 binary doesn't match this OS — " +
    `found magic ${magic ? magic.toString("hex") : "missing"} on ` +
    `${process.platform}. Rebuilding for Electron...`,
);

const res = spawnSync(
  "npx",
  ["electron-rebuild", "-f", "-w", "better-sqlite3", "--module-dir", "../.."],
  { cwd: appDir, stdio: "inherit" },
);

if (res.status !== 0) {
  console.error(
    "[check-native-abi] electron-rebuild failed. Run " +
      "`npm run rebuild-native` inside packages/app to see the full " +
      "error.",
  );
  process.exit(res.status ?? 1);
}

// Verify the rebuild actually produced a binary for this OS before we
// hand off to electron-vite — otherwise we'd just crash again.
const after = readMagic();
if (!binaryMatchesHost(after)) {
  console.error(
    "[check-native-abi] rebuild finished but the binary still doesn't " +
      "match this OS. Something is off with the install; try removing " +
      "node_modules/better-sqlite3 and reinstalling.",
  );
  process.exit(1);
}

console.log("[check-native-abi] rebuild complete. Starting electron-vite...");
process.exit(0);
