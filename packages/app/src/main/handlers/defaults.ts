/**
 * #250 — the two user-editable default CSVs (contracts + work-area ->
 * contract mapping).
 *
 * Storage model (locked 2026-06-19): the app ships read-only defaults in
 * its Resources/defaults folder; on first use we copy each into the
 * user's data folder (`userData/defaults`). From then on the user owns
 * that copy and edits it freely - a shipped update NEVER overwrites it.
 *
 * This module is main-process only (uses Node fs + Electron `app`). The
 * actual CSV parsing lives in the cross-process `shared/defaultsCsv.ts`.
 */

import { app } from "electron";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseContractsCsv,
  parseWorkAreaMapCsv,
  type ContractDefaultRow,
  type WorkAreaContractMapRow,
} from "../../shared/defaultsCsv.js";

export const CONTRACTS_CSV = "contracts.csv";
export const WORKAREA_MAP_CSV = "contract-workarea-map.csv";

/**
 * Locate a shipped default (Resources/defaults/<file>), with a dev-tree
 * fallback so `electron-vite dev` finds it too. Mirrors
 * `locateBlankTemplate` in file.ts.
 */
function locateShippedDefault(filename: string): string | null {
  const candidates = [
    join(process.resourcesPath ?? "", "defaults", filename),
    join(app.getAppPath(), "resources", "defaults", filename),
    join(
      app.getAppPath(),
      "..",
      "..",
      "packages",
      "app",
      "resources",
      "defaults",
      filename,
    ),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

/** The user's editable copy: userData/defaults/<file>. */
export function userDefaultPath(filename: string): string {
  return join(app.getPath("userData"), "defaults", filename);
}

/**
 * Ensure the user's editable copy exists, copying the shipped default on
 * first run ONLY. Never overwrites an existing user copy (the locked
 * "never overwrite" guarantee). Returns the path to read from (the user
 * copy, or the shipped file if the copy couldn't be written), or null
 * when no default ships at all.
 */
export function ensureUserDefault(filename: string): string | null {
  const userPath = userDefaultPath(filename);
  if (existsSync(userPath)) return userPath;
  const shipped = locateShippedDefault(filename);
  if (!shipped) return null;
  try {
    mkdirSync(join(app.getPath("userData"), "defaults"), { recursive: true });
    copyFileSync(shipped, userPath);
    return userPath;
  } catch {
    // Couldn't write the user copy - read the shipped file directly so
    // seeding/mapping still work this session.
    return shipped;
  }
}

function readDefaultText(filename: string): string | null {
  const p = ensureUserDefault(filename);
  if (!p) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Parsed default contracts (user copy), or [] when unavailable. */
export function readContractDefaults(): ContractDefaultRow[] {
  const text = readDefaultText(CONTRACTS_CSV);
  return text ? parseContractsCsv(text).rows : [];
}

/** Parsed work-area -> contract mapping (user copy), or [] when absent. */
export function readWorkAreaMapDefaults(): WorkAreaContractMapRow[] {
  const text = readDefaultText(WORKAREA_MAP_CSV);
  return text ? parseWorkAreaMapCsv(text).rows : [];
}
